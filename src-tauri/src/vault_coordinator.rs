//! One vault writer (R3-BUG-001 slice B, approved by Bradley on 2026-10-03).
//!
//! Every change to the in-memory secrets cache, every physical vault write,
//! every shadow refresh and every sidecar push runs on ONE dedicated thread,
//! in submission order. Readers take the cache lock only to copy or inspect
//! it; nothing holds that lock across the Keychain or the disk.
//!
//! A Settings save waits a bounded time. A job that has not started by then is
//! cancelled and never runs; a job that has started keeps ownership of the
//! writer until the Keychain answers, so no later write can overtake it, and
//! its late outcome is counted and reported instead of lost.
//!
//! Saves are gated on the vault source: only after the real vault was read
//! this session, or the Keychain confirmed there is none yet, is the cache a
//! complete base for a new vault. Otherwise a save could erase keys.
//!
//! Pure: no Tauri types. The store is a trait so the contract tests drive the
//! writer with a fake and never touch the Keychain.

use std::collections::{HashMap, HashSet};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender, TrySendError};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::Duration;

/// Jobs waiting behind the one in progress. A full queue answers "busy".
pub const QUEUE_CAPACITY: usize = 8;

pub const LOADING_MESSAGE: &str =
    "Secrets are still loading from the keychain; please try again in a moment.";
pub const LOAD_FAILED_MESSAGE: &str =
    "Secrets failed to load. Use \"Reload keys from Keychain\" in Settings, or restart Crystal Ball.";
pub const SHADOW_GATE_MESSAGE: &str = "Your keys were loaded from the backup copy because the Keychain didn't answer. Saving now could erase keys. Use \"Reload keys from Keychain\" in Settings (approve the prompt), then save again.";
pub const UNAVAILABLE_GATE_MESSAGE: &str = "Crystal Ball couldn't read your keys from the Keychain (no answer, access refused, or an unreadable vault). Saving now could erase keys. Use \"Reload keys from Keychain\" in Settings (approve the prompt), then save again.";
pub const BUSY_MESSAGE: &str =
    "The Keychain is still busy with an earlier change. Nothing was saved; try again in a moment.";
pub const PENDING_MESSAGE: &str = "Waiting for the Keychain to confirm this change. If a Keychain prompt is showing, approve it. The change finishes on its own and Settings updates when it does.";
pub const STOPPED_MESSAGE: &str = "The secrets writer stopped. Restart Crystal Ball and try again.";

/// Where this session's cache came from. Only `Vault` and `Absent` allow a save.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VaultSource {
    /// Nothing loaded yet.
    Pending,
    /// The real vault was read (or written) this session.
    Vault,
    /// The Keychain confirmed there is no vault yet.
    Absent,
    /// The Keychain did not answer; the shadow copy is in use.
    Shadow,
    /// A read error, a timeout with no shadow copy, an unreadable vault, or an
    /// incomplete legacy migration.
    Unavailable,
}

impl VaultSource {
    pub fn writable(self) -> bool {
        matches!(self, VaultSource::Vault | VaultSource::Absent)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            VaultSource::Pending => "pending",
            VaultSource::Vault => "vault",
            VaultSource::Absent => "absent",
            VaultSource::Shadow => "shadow",
            VaultSource::Unavailable => "unavailable",
        }
    }
}

/// Why a save is refused for this source, if it is.
pub fn gate_message(source: VaultSource) -> Option<&'static str> {
    match source {
        VaultSource::Vault | VaultSource::Absent => None,
        VaultSource::Pending => Some(LOADING_MESSAGE),
        VaultSource::Shadow => Some(SHADOW_GATE_MESSAGE),
        VaultSource::Unavailable => Some(UNAVAILABLE_GATE_MESSAGE),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoadPhase {
    Loading,
    Ready,
    Failed,
}

/// What one Keychain read produced, classified off the writer thread.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReadResult {
    Vault(HashMap<String, String>),
    Absent,
    Shadow(HashMap<String, String>),
    Unavailable(HashMap<String, String>),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OutcomeStatus {
    Saved,
    Failed,
}

/// A write whose caller stopped waiting ("pending") has finished. Value-free.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LateOutcome {
    pub revision: u64,
    pub key: String,
    pub status: OutcomeStatus,
}

/// The physical side effects. Only the writer thread calls these, one at a time.
pub trait VaultStore: Send + Sync + 'static {
    /// Write the whole vault (the Keychain item). May block indefinitely.
    fn write_vault(&self, secrets: &HashMap<String, String>) -> Result<(), String>;
    /// Refresh the encrypted shadow copy. Best effort.
    fn write_shadow(&self, secrets: &HashMap<String, String>);
    /// Push one change to the running sidecar (`None` = unset). Best effort, bounded.
    fn push_key(&self, key: &str, value: Option<&str>);
    /// Push the whole cache to the running sidecar. Best effort, bounded.
    fn push_all(&self, secrets: &HashMap<String, String>);
    /// Generation-owned launch selections, executed only by this writer.
    fn push_launch_keys(&self, generation: u64, keys: Vec<String>);
    /// After a successful migration write: remove the legacy per-key entries
    /// that were read and mark the migration done.
    fn finish_migration(&self, migrated_keys: &[String]);
    /// A pending write finished.
    fn late_outcome(&self, outcome: &LateOutcome);
}

struct Inner {
    map: HashMap<String, String>,
    /// Keys the user set or deleted this session. A merge never overrides them.
    touched: HashSet<String>,
    source: VaultSource,
    /// Committed vault writes this session. A read that started at an older
    /// generation is stale and must not refresh the shadow copy.
    generation: u64,
}

/// The cache plus load readiness. Readers use it directly; only the writer
/// thread changes the cache.
pub struct VaultState {
    inner: Mutex<Inner>,
    phase: Mutex<LoadPhase>,
    loaded: Condvar,
}

impl Default for VaultState {
    fn default() -> Self {
        Self::new()
    }
}

impl VaultState {
    pub fn new() -> Self {
        VaultState {
            inner: Mutex::new(Inner {
                map: HashMap::new(),
                touched: HashSet::new(),
                source: VaultSource::Pending,
                generation: 0,
            }),
            phase: Mutex::new(LoadPhase::Loading),
            loaded: Condvar::new(),
        }
    }

    // Critical sections only copy or swap, so a poisoned lock still guards
    // consistent data; recover it instead of failing every later reader.
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn lock_phase(&self) -> MutexGuard<'_, LoadPhase> {
        self.phase.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Run `f` against the cache while holding the lock briefly.
    pub fn read<R>(&self, f: impl FnOnce(&HashMap<String, String>) -> R) -> R {
        f(&self.lock().map)
    }

    /// Transport must fail closed on poison; ordinary reader recovery is separate.
    pub(crate) fn with_transport_map<R>(&self, f: impl FnOnce(&HashMap<String, String>) -> Result<R, ()>) -> Result<R, ()> {
        let inner = self.inner.lock().map_err(|_| ())?;
        f(&inner.map)
    }

    pub(crate) fn transport_snapshot(&self, clock: &crate::secret_sync::RevisionClock, key: &str) -> Result<crate::secret_sync::Snapshot, ()> {
        self.with_transport_map(|map| clock.snapshot_owned_map(map, key))
    }

    pub(crate) fn transport_launch(&self, clock: &crate::secret_sync::RevisionClock) -> Result<(HashMap<String, String>, String), ()> {
        self.with_transport_map(|map| clock.launch_owned_map(map))
    }

    pub fn snapshot(&self) -> HashMap<String, String> {
        self.lock().map.clone()
    }

    pub fn get(&self, key: &str) -> Option<String> {
        self.lock().map.get(key).cloned()
    }

    pub fn source(&self) -> VaultSource {
        self.lock().source
    }

    pub fn generation(&self) -> u64 {
        self.lock().generation
    }

    pub fn phase(&self) -> LoadPhase {
        *self.lock_phase()
    }

    /// Wait until the load is no longer `Loading`, at most `timeout`. The
    /// predicate is checked under the lock, so a wakeup cannot be missed.
    pub fn wait_loaded(&self, timeout: Duration) -> LoadPhase {
        let guard = self.lock_phase();
        let (guard, _) = self
            .loaded
            .wait_timeout_while(guard, timeout, |phase| *phase == LoadPhase::Loading)
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *guard
    }

    fn mark_ready(&self) {
        let mut phase = self.lock_phase();
        *phase = LoadPhase::Ready;
        self.loaded.notify_all();
    }

    /// Only a load still in progress can fail; a finished load stays finished.
    pub fn mark_failed(&self) {
        let mut phase = self.lock_phase();
        if *phase == LoadPhase::Loading {
            *phase = LoadPhase::Failed;
            self.loaded.notify_all();
        }
    }
}

/// Marks the load `Failed` when dropped while it is still `Loading`, for
/// example when the boot task panics before handing its result to the writer.
pub struct LoadGuard(Arc<VaultState>);

impl LoadGuard {
    pub fn new(state: Arc<VaultState>) -> Self {
        LoadGuard(state)
    }
}

impl Drop for LoadGuard {
    fn drop(&mut self) {
        self.0.mark_failed();
    }
}

const QUEUED: u8 = 0;
const STARTED: u8 = 1;
const CANCELLED: u8 = 2;
const DONE: u8 = 3;
const ABANDONED: u8 = 4;

/// Who owns a save's outcome. Every transition is a single compare-and-swap,
/// so the caller and the writer always agree on what happened.
struct Ticket(AtomicU8);

impl Ticket {
    fn new() -> Self {
        Ticket(AtomicU8::new(QUEUED))
    }

    fn swap(&self, from: u8, to: u8) -> bool {
        self.0.compare_exchange(from, to, Ordering::AcqRel, Ordering::Acquire).is_ok()
    }
}

enum Job {
    Mutate {
        ticket: Arc<Ticket>,
        key: String,
        value: Option<String>,
        reply: mpsc::Sender<Result<(), String>>,
    },
    Load {
        result: ReadResult,
        started_generation: u64,
        reply: mpsc::Sender<VaultSource>,
    },
    Migrate {
        secrets: HashMap<String, String>,
        reply: mpsc::Sender<VaultSource>,
    },
    PushAll,
    PushKeys { generation: u64, keys: Vec<String> },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MutateOutcome {
    Saved,
    /// Started but not confirmed in time; finishes in the background.
    Pending,
    /// Not started in time, or the queue is full. Never runs later.
    Busy,
    Refused(&'static str),
    Failed(String),
}

impl MutateOutcome {
    pub fn into_result(self) -> Result<(), String> {
        match self {
            MutateOutcome::Saved => Ok(()),
            MutateOutcome::Pending => Err(PENDING_MESSAGE.to_string()),
            MutateOutcome::Busy => Err(BUSY_MESSAGE.to_string()),
            MutateOutcome::Refused(message) => Err(message.to_string()),
            MutateOutcome::Failed(error) => Err(error),
        }
    }
}

/// Value-free write status for the renderer: the committed revision and the
/// number of saves still waiting on the Keychain after their caller gave up.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WriteState {
    pub revision: u64,
    pub pending: u64,
}

#[derive(Clone)]
pub struct VaultCoordinator {
    state: Arc<VaultState>,
    tx: SyncSender<Job>,
    pending: Arc<AtomicU64>,
}

impl VaultCoordinator {
    /// Start the one writer thread.
    pub fn start(
        state: Arc<VaultState>,
        store: Arc<dyn VaultStore>,
    ) -> std::io::Result<(Self, JoinHandle<()>)> {
        let (tx, rx) = mpsc::sync_channel(QUEUE_CAPACITY);
        let pending = Arc::new(AtomicU64::new(0));
        let writer = Writer { state: state.clone(), store, pending: pending.clone() };
        let handle = std::thread::Builder::new()
            .name("vault-writer".to_string())
            .spawn(move || writer.run(rx))?;
        Ok((VaultCoordinator { state, tx, pending }, handle))
    }

    pub fn state(&self) -> &Arc<VaultState> {
        &self.state
    }

    pub fn write_state(&self) -> WriteState {
        WriteState {
            revision: self.state.generation(),
            pending: self.pending.load(Ordering::Acquire),
        }
    }

    /// Set (`Some`) or delete (`None`) one key: write the vault, then commit,
    /// refresh the shadow and push to the sidecar. Waits at most `wait`.
    pub fn mutate(&self, key: &str, value: Option<String>, wait: Duration) -> MutateOutcome {
        if let Some(message) = gate_message(self.state.source()) {
            return MutateOutcome::Refused(message);
        }
        let ticket = Arc::new(Ticket::new());
        let (reply, replies) = mpsc::channel();
        let job = Job::Mutate { ticket: ticket.clone(), key: key.to_string(), value, reply };
        match self.tx.try_send(job) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) => return MutateOutcome::Busy,
            Err(TrySendError::Disconnected(_)) => return MutateOutcome::Failed(STOPPED_MESSAGE.to_string()),
        }
        match replies.recv_timeout(wait) {
            Ok(result) => outcome_of(result),
            Err(RecvTimeoutError::Disconnected) => MutateOutcome::Failed(STOPPED_MESSAGE.to_string()),
            Err(RecvTimeoutError::Timeout) => {
                if ticket.swap(QUEUED, CANCELLED) {
                    return MutateOutcome::Busy;
                }
                // Count first, so the writer can never decrement before this.
                self.pending.fetch_add(1, Ordering::AcqRel);
                if ticket.swap(STARTED, ABANDONED) {
                    return MutateOutcome::Pending;
                }
                self.pending.fetch_sub(1, Ordering::AcqRel);
                // DONE: the writer is sending the reply right now.
                match replies.recv() {
                    Ok(result) => outcome_of(result),
                    Err(_) => MutateOutcome::Failed(STOPPED_MESSAGE.to_string()),
                }
            }
        }
    }

    /// Apply a classified read (boot, reload or retry). `started_generation`
    /// is `state().generation()` taken before the read began. Returns the
    /// resulting source, or `None` if the writer did not apply it in time.
    pub fn load(&self, result: ReadResult, started_generation: u64, wait: Duration) -> Option<VaultSource> {
        let (reply, replies) = mpsc::channel();
        self.tx.try_send(Job::Load { result, started_generation, reply }).ok()?;
        replies.recv_timeout(wait).ok()
    }

    /// Consolidate legacy per-key secrets into a new vault (the vault was
    /// absent and the per-key scan was clean).
    pub fn migrate(&self, secrets: HashMap<String, String>, wait: Duration) -> Option<VaultSource> {
        let (reply, replies) = mpsc::channel();
        self.tx.try_send(Job::Migrate { secrets, reply }).ok()?;
        replies.recv_timeout(wait).ok()
    }

    /// Nonblocking FIFO admission; selections contain no credential values.
    pub fn try_push_keys(&self, generation: u64, mut keys: Vec<String>) -> crate::secret_sync::PushAdmission {
        keys.sort();
        keys.dedup();
        match self.tx.try_send(Job::PushKeys { generation, keys }) {
            Ok(()) => crate::secret_sync::PushAdmission::Accepted,
            Err(TrySendError::Full(_)) => crate::secret_sync::PushAdmission::Full,
            Err(TrySendError::Disconnected(_)) => crate::secret_sync::PushAdmission::Stopped,
        }
    }

    /// Queue a full push of the cache, taken when the job runs, so it is
    /// ordered with every per-key push. Returns false if the queue is full.
    pub fn push_all(&self) -> bool {
        self.tx.try_send(Job::PushAll).is_ok()
    }
}

fn outcome_of(result: Result<(), String>) -> MutateOutcome {
    match result {
        Ok(()) => MutateOutcome::Saved,
        Err(error) => MutateOutcome::Failed(error),
    }
}

struct Writer {
    state: Arc<VaultState>,
    store: Arc<dyn VaultStore>,
    pending: Arc<AtomicU64>,
}

impl Writer {
    fn run(self, jobs: Receiver<Job>) {
        while let Ok(job) = jobs.recv() {
            // A panicking job drops its reply sender, so its caller sees a
            // failure; the writer itself keeps serving later jobs.
            let _ = catch_unwind(AssertUnwindSafe(|| self.handle(job)));
        }
    }

    fn handle(&self, job: Job) {
        match job {
            Job::Mutate { ticket, key, value, reply } => {
                if !ticket.swap(QUEUED, STARTED) {
                    return; // cancelled while queued: never runs
                }
                let result = self.mutate(&key, value.as_deref());
                if ticket.swap(STARTED, DONE) {
                    let _ = reply.send(result);
                } else {
                    // ABANDONED: the caller was told "pending".
                    let status = if result.is_ok() { OutcomeStatus::Saved } else { OutcomeStatus::Failed };
                    let revision = self.state.generation();
                    self.pending.fetch_sub(1, Ordering::AcqRel);
                    self.store.late_outcome(&LateOutcome { revision, key, status });
                }
            }
            Job::Load { result, started_generation, reply } => {
                let source = self.apply_load(result, started_generation);
                self.state.mark_ready();
                let _ = reply.send(source);
            }
            Job::Migrate { secrets, reply } => {
                let source = self.migrate(secrets);
                self.state.mark_ready();
                let _ = reply.send(source);
            }
            Job::PushKeys { generation, keys } => self.store.push_launch_keys(generation, keys),
            Job::PushAll => {
                let snapshot = self.state.snapshot();
                if !snapshot.is_empty() {
                    self.store.push_all(&snapshot);
                }
            }
        }
    }

    fn mutate(&self, key: &str, value: Option<&str>) -> Result<(), String> {
        let proposed = {
            let inner = self.state.lock();
            if let Some(message) = gate_message(inner.source) {
                return Err(message.to_string());
            }
            let mut proposed = inner.map.clone();
            match value {
                Some(v) => {
                    proposed.insert(key.to_string(), v.to_string());
                }
                None => {
                    proposed.remove(key);
                }
            }
            proposed
        };
        // No lock is held here: readers never wait on the Keychain.
        self.store.write_vault(&proposed)?;
        {
            let mut inner = self.state.lock();
            // Only this thread changes the cache, so it still equals the
            // snapshot the proposal was built from.
            inner.map = proposed.clone();
            inner.touched.insert(key.to_string());
            inner.generation += 1;
            inner.source = VaultSource::Vault;
        }
        self.store.write_shadow(&proposed);
        self.store.push_key(key, value);
        Ok(())
    }

    fn apply_load(&self, result: ReadResult, started_generation: u64) -> VaultSource {
        let mut shadow_refresh = None;
        let mut removed = Vec::new();
        let source = {
            let mut inner = self.state.lock();
            let stale = inner.generation != started_generation;
            match result {
                ReadResult::Vault(map) => {
                    if inner.source.writable() {
                        merge_without_overriding(&mut inner, &map);
                    } else {
                        // The cache came from the shadow copy, an error, or
                        // nothing. The real vault is authoritative, and no
                        // save could have happened while saves were gated.
                        removed = inner.map.keys().filter(|key| !map.contains_key(*key)).cloned().collect();
                        removed.sort();
                        inner.map = map.clone();
                        inner.source = VaultSource::Vault;
                    }
                    if !stale {
                        shadow_refresh = Some(map);
                    }
                }
                ReadResult::Absent => {
                    if !inner.source.writable() {
                        inner.source = VaultSource::Absent;
                    }
                }
                ReadResult::Shadow(map) => {
                    // A verified session ignores the backup copy.
                    if !inner.source.writable() {
                        merge_without_overriding(&mut inner, &map);
                        inner.source = VaultSource::Shadow;
                    }
                }
                ReadResult::Unavailable(map) => {
                    if !inner.source.writable() {
                        merge_without_overriding(&mut inner, &map);
                        if inner.source == VaultSource::Pending {
                            inner.source = VaultSource::Unavailable;
                        }
                    }
                }
            }
            inner.source
        };
        if let Some(map) = shadow_refresh {
            self.store.write_shadow(&map);
        }
        // These removals belong to this Load even if the queue is full.
        // Complete them before readiness/reply and before the next writer job.
        for key in removed { self.store.push_key(&key, None); }
        source
    }

    fn migrate(&self, secrets: HashMap<String, String>) -> VaultSource {
        let proposed = {
            let inner = self.state.lock();
            let mut proposed = inner.map.clone();
            for (key, value) in &secrets {
                if !inner.touched.contains(key) {
                    proposed.entry(key.clone()).or_insert_with(|| value.clone());
                }
            }
            proposed
        };
        match self.store.write_vault(&proposed) {
            Ok(()) => {
                {
                    let mut inner = self.state.lock();
                    inner.map = proposed.clone();
                    inner.generation += 1;
                    inner.source = VaultSource::Vault;
                }
                self.store.write_shadow(&proposed);
                let mut keys: Vec<String> = secrets.into_keys().collect();
                keys.sort();
                self.store.finish_migration(&keys);
                VaultSource::Vault
            }
            Err(_) => {
                // The migrated values are usable this session, but no vault
                // exists yet: saves stay gated and the next launch retries.
                let mut inner = self.state.lock();
                merge_without_overriding(&mut inner, &secrets);
                if !inner.source.writable() {
                    inner.source = VaultSource::Unavailable;
                }
                inner.source
            }
        }
    }
}

/// Add keys the cache lacks; never override a key the user set or deleted,
/// and never replace a value already held.
fn merge_without_overriding(inner: &mut Inner, entries: &HashMap<String, String>) {
    for (key, value) in entries {
        if inner.touched.contains(key) {
            continue;
        }
        inner.map.entry(key.clone()).or_insert_with(|| value.clone());
    }
}

#[cfg(test)]
mod transport_tests {
    use super::*;
    use crate::secret_sync::{self, Outcome, RevisionClock};
    const DEADLINE: Duration = Duration::from_secs(3);

    #[test]
    fn actual_state_snapshot_and_launch_allocate_after_current_owner() {
        for launch in [false, true] {
            let state = Arc::new(VaultState::new());
            let clock = Arc::new(RevisionClock::default());
            let mut owned = state.inner.lock().unwrap();
            owned.map.insert("A".into(), "old".into());
            let (entered_tx, entered_rx) = mpsc::channel();
            let (done_tx, done_rx) = mpsc::channel();
            let waiting_state = state.clone();
            let waiting_clock = clock.clone();
            let worker = std::thread::spawn(move || {
                entered_tx.send(()).unwrap();
                let result = if launch {
                    waiting_state.transport_launch(&waiting_clock).map(|(map, floor)| (map.get("A").cloned(), floor))
                } else {
                    waiting_state.transport_snapshot(&waiting_clock, "A").map(|snapshot| (snapshot.value, snapshot.revision))
                };
                let _ = done_tx.send(result);
            });
            entered_rx.recv_timeout(DEADLINE).unwrap();
            assert!(done_rx.recv_timeout(Duration::from_millis(40)).is_err(), "actual inner blocks transport");
            let held_revision = clock.snapshot_owned_map(&owned.map, "A").unwrap().revision;
            owned.map.insert("A".into(), "current".into());
            drop(owned); // released on assertion unwind as well
            let (value, revision) = done_rx.recv_timeout(DEADLINE).unwrap().unwrap();
            worker.join().unwrap();
            assert_eq!(value.as_deref(), Some("current"), "actual ownership returns current map");
            assert!(revision.parse::<u64>().unwrap() > held_revision.parse().unwrap(), "allocation follows held owner revision");
        }
    }

    #[test]
    fn actual_transport_reservation_occurs_inside_inner_for_snapshot_and_launch() {
        let state = Arc::new(VaultState::new());
        state.lock().map.insert("A".into(), "current".into());
        let inspected = state.clone();
        let probes = Arc::new(std::sync::atomic::AtomicU64::new(0));
        let counted = probes.clone();
        let clock = RevisionClock::with_reservation_probe_for_test(move || {
            assert!(matches!(inspected.inner.try_lock(), Err(std::sync::TryLockError::WouldBlock)),
                "transport revision allocation must own the actual authoritative inner");
            counted.fetch_add(1, Ordering::SeqCst);
        });
        assert_eq!(state.transport_snapshot(&clock, "A").unwrap().value.as_deref(), Some("current"));
        assert_eq!(state.transport_launch(&clock).unwrap().0.get("A").map(String::as_str), Some("current"));
        assert_eq!(probes.load(Ordering::SeqCst), 2, "both real adapter paths reserved under actual ownership");
    }

    #[test]
    fn actual_state_poison_and_exhaustion_issue_zero_transport_requests() {
        for poison in [true, false] {
            let state = Arc::new(VaultState::new());
            let clock = if poison { RevisionClock::default() } else { RevisionClock::exhausted_for_test() };
            if poison {
                let shared = state.clone();
                let _ = std::thread::spawn(move || {
                    let _guard = shared.inner.lock().unwrap();
                    panic!("fake poison");
                }).join();
            }
            let mut requests = 0;
            let outcome = tauri::async_runtime::block_on(secret_sync::send(
                || state.transport_snapshot(&clock, "A"), || Ok(()),
                |_, _| { requests += 1; std::future::ready(true) },
                || std::future::ready(()),
            ));
            assert_eq!(outcome, Outcome::CacheUnavailable);
            assert_eq!(requests, 0, "unavailable state never becomes a tombstone");
            assert!(state.transport_launch(&clock).is_err(), "unavailable floor refuses launch");
        }
        assert_eq!(VaultState::new().transport_snapshot(&RevisionClock::default(), "missing").unwrap().value, None);
    }

    #[test]
    fn actual_state_retry_resnapshots_delete_rotation_and_revoked_target() {
        for next in [None, Some("rotated")] {
            let state = VaultState::new();
            state.lock().map.insert("A".into(), "old".into());
            let clock = RevisionClock::default();
            let mut snapshots = Vec::new();
            assert_eq!(tauri::async_runtime::block_on(secret_sync::send(
                || state.transport_snapshot(&clock, "A"), || Ok(()),
                |_, snapshot| { snapshots.push(snapshot); std::future::ready(snapshots.len() == 2) },
                || {
                    let mut inner = state.lock(); inner.map.remove("A");
                    if let Some(value) = next { inner.map.insert("A".into(), value.into()); }
                    std::future::ready(())
                },
            )), Outcome::Accepted);
            assert_eq!(snapshots[1].value.as_deref(), next);
            assert!(snapshots[1].revision.parse::<u64>().unwrap() > snapshots[0].revision.parse().unwrap());
        }
        let state = VaultState::new(); let clock = RevisionClock::default();
        let live = std::cell::Cell::new(true); let mut requests = 0;
        assert_eq!(tauri::async_runtime::block_on(secret_sync::send(
            || state.transport_snapshot(&clock, "A"),
            || if live.get() { Ok(()) } else { Err(()) },
            |_, _| { requests += 1; std::future::ready(false) },
            || { live.set(false); std::future::ready(()) },
        )), Outcome::TargetUnavailable);
        assert_eq!(requests, 1);
    }
}
