// R3-BUG-001 slice B: the one vault writer, driven by a fake store. Nothing
// here touches the Keychain, the disk or a sidecar.
// Items only main.rs uses are dead code in this test crate.
#[allow(dead_code)]
#[path = "../src/vault_coordinator.rs"]
mod vault_coordinator;
#[allow(dead_code)]
#[path = "../src/secret_sync.rs"]
mod secret_sync;

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use vault_coordinator::*;

const LONG: Duration = Duration::from_secs(5);
const SHORT: Duration = Duration::from_millis(60);
const PANIC_VALUE: &str = "PANIC-IN-STORE";

fn map(pairs: &[(&str, &str)]) -> HashMap<String, String> {
    pairs.iter().map(|(k, v)| ((*k).to_string(), (*v).to_string())).collect()
}

fn fmt(secrets: &HashMap<String, String>) -> String {
    let mut pairs: Vec<String> = secrets.iter().map(|(k, v)| format!("{k}={v}")).collect();
    pairs.sort();
    pairs.join(",")
}

#[derive(Default)]
struct FakeStore {
    events: Mutex<Vec<String>>,
    holds: Mutex<VecDeque<mpsc::Receiver<Result<(), String>>>>,
    entered: Mutex<Option<mpsc::Sender<()>>>,
    late: Mutex<Vec<LateOutcome>>,
    fail_writes: AtomicBool,
}

impl FakeStore {
    /// The next vault write blocks until the returned sender delivers its result.
    fn hold_next_write(&self) -> mpsc::Sender<Result<(), String>> {
        let (tx, rx) = mpsc::channel();
        self.holds.lock().unwrap().push_back(rx);
        tx
    }

    /// Signals once per vault write, as soon as the write begins.
    fn watch_entries(&self) -> mpsc::Receiver<()> {
        let (tx, rx) = mpsc::channel();
        *self.entered.lock().unwrap() = Some(tx);
        rx
    }

    fn events(&self) -> Vec<String> {
        self.events.lock().unwrap().clone()
    }

    fn record(&self, event: String) {
        self.events.lock().unwrap().push(event);
    }

    fn wait_for_late(&self, count: usize) -> Vec<LateOutcome> {
        let deadline = Instant::now() + LONG;
        loop {
            let late = self.late.lock().unwrap().clone();
            if late.len() >= count || Instant::now() > deadline {
                return late;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}

impl VaultStore for FakeStore {
    fn write_vault(&self, secrets: &HashMap<String, String>) -> Result<(), String> {
        if let Some(tx) = self.entered.lock().unwrap().as_ref() {
            let _ = tx.send(());
        }
        assert!(!secrets.values().any(|v| v == PANIC_VALUE), "store panicked");
        let hold = self.holds.lock().unwrap().pop_front();
        let result = match hold {
            Some(release) => release.recv().unwrap_or_else(|_| Err("released".to_string())),
            None if self.fail_writes.load(Ordering::SeqCst) => Err("keychain refused".to_string()),
            None => Ok(()),
        };
        if result.is_ok() {
            self.record(format!("vault:{}", fmt(secrets)));
        }
        result
    }

    fn write_shadow(&self, secrets: &HashMap<String, String>) {
        self.record(format!("shadow:{}", fmt(secrets)));
    }

    fn push_key(&self, key: &str, value: Option<&str>) {
        self.record(format!("push:{key}={}", value.unwrap_or("<unset>")));
    }

    fn push_all(&self, secrets: &HashMap<String, String>) {
        self.record(format!("pushall:{}", fmt(secrets)));
    }

    fn push_launch_keys(&self, generation: u64, keys: Vec<String>) {
        self.events.lock().unwrap().push(format!("launch:{generation}:{}", keys.join(",")));
    }

    fn finish_migration(&self, migrated_keys: &[String]) {
        self.record(format!("migrated:{}", migrated_keys.join(",")));
    }

    fn late_outcome(&self, outcome: &LateOutcome) {
        self.late.lock().unwrap().push(outcome.clone());
    }
}

fn start() -> (VaultCoordinator, Arc<FakeStore>) {
    let store = Arc::new(FakeStore::default());
    let (writer, _handle) = VaultCoordinator::start(Arc::new(VaultState::new()), store.clone()).unwrap();
    (writer, store)
}

fn start_loaded(initial: &[(&str, &str)]) -> (VaultCoordinator, Arc<FakeStore>) {
    let (writer, store) = start();
    let generation = writer.state().generation();
    assert_eq!(writer.load(ReadResult::Vault(map(initial)), generation, LONG), Some(VaultSource::Vault));
    store.events.lock().unwrap().clear();
    (writer, store)
}

fn set(writer: &VaultCoordinator, key: &str, value: &str) -> MutateOutcome {
    writer.mutate(key, Some(value.to_string()), LONG)
}

#[test]
fn saves_are_refused_until_the_vault_source_is_known_and_complete() {
    let (writer, store) = start();
    assert_eq!(set(&writer, "A", "1"), MutateOutcome::Refused(LOADING_MESSAGE));

    let generation = writer.state().generation();
    writer.load(ReadResult::Shadow(map(&[("A", "old")])), generation, LONG);
    assert_eq!(writer.state().source(), VaultSource::Shadow);
    assert_eq!(set(&writer, "B", "2"), MutateOutcome::Refused(SHADOW_GATE_MESSAGE));

    let (unavailable, _) = start();
    unavailable.load(ReadResult::Unavailable(HashMap::new()), 0, LONG);
    assert_eq!(set(&unavailable, "B", "2"), MutateOutcome::Refused(UNAVAILABLE_GATE_MESSAGE));

    assert!(store.events().iter().all(|e| !e.starts_with("vault:")), "a gated save must never write the vault");
    assert!(!VaultSource::Shadow.writable() && !VaultSource::Unavailable.writable() && !VaultSource::Pending.writable());
}

#[test]
fn the_real_vault_replaces_a_shadow_cache_and_lifts_the_gate() {
    let (writer, store) = start();
    writer.load(ReadResult::Shadow(map(&[("A", "stale"), ("GONE", "x")])), 0, LONG);
    let generation = writer.state().generation();
    assert_eq!(
        writer.load(ReadResult::Vault(map(&[("A", "fresh"), ("B", "2")])), generation, LONG),
        Some(VaultSource::Vault),
    );
    assert_eq!(fmt(&writer.state().snapshot()), "A=fresh,B=2");
    assert_eq!(set(&writer, "C", "3"), MutateOutcome::Saved);
    assert!(store.events().contains(&"vault:A=fresh,B=2,C=3".to_string()));
}

#[test]
fn a_confirmed_absent_vault_allows_the_first_save() {
    let (writer, store) = start();
    assert_eq!(writer.load(ReadResult::Absent, 0, LONG), Some(VaultSource::Absent));
    assert_eq!(set(&writer, "K", "v"), MutateOutcome::Saved);
    assert_eq!(writer.state().source(), VaultSource::Vault);
    assert_eq!(store.events()[0], "vault:K=v");
}

#[test]
fn a_verified_session_ignores_a_later_shadow_or_failed_read() {
    let (writer, _store) = start_loaded(&[("A", "1")]);
    writer.load(ReadResult::Shadow(map(&[("A", "old"), ("Z", "stale")])), writer.state().generation(), LONG);
    writer.load(ReadResult::Unavailable(map(&[("Y", "partial")])), writer.state().generation(), LONG);
    assert_eq!(writer.state().source(), VaultSource::Vault);
    assert_eq!(fmt(&writer.state().snapshot()), "A=1");
}

#[test]
fn a_reload_into_a_verified_session_never_replaces_a_held_value() {
    let (writer, _store) = start_loaded(&[("A", "1")]);
    let generation = writer.state().generation();
    writer.load(ReadResult::Vault(map(&[("A", "changed-elsewhere"), ("B", "2")])), generation, LONG);
    assert_eq!(fmt(&writer.state().snapshot()), "A=1,B=2");
}

#[test]
fn concurrent_saves_lose_nothing() {
    let (writer, store) = start_loaded(&[("BASE", "0")]);
    let threads: Vec<_> = (0..6)
        .map(|i| {
            let writer = writer.clone();
            std::thread::spawn(move || set(&writer, &format!("K{i}"), &format!("v{i}")))
        })
        .collect();
    for thread in threads {
        assert_eq!(thread.join().unwrap(), MutateOutcome::Saved);
    }
    let expected = "BASE=0,K0=v0,K1=v1,K2=v2,K3=v3,K4=v4,K5=v5";
    assert_eq!(fmt(&writer.state().snapshot()), expected);
    let last_vault = store.events().into_iter().filter(|e| e.starts_with("vault:")).last().unwrap();
    assert_eq!(last_vault, format!("vault:{expected}"));
    assert_eq!(writer.write_state().revision, 6);
}

#[test]
fn set_and_delete_keep_their_order_through_vault_shadow_and_sidecar() {
    let (writer, store) = start_loaded(&[]);
    assert_eq!(set(&writer, "A", "1"), MutateOutcome::Saved);
    assert_eq!(writer.mutate("A", None, LONG), MutateOutcome::Saved);
    assert_eq!(set(&writer, "A", "2"), MutateOutcome::Saved);
    assert_eq!(
        store.events(),
        vec![
            "vault:A=1", "shadow:A=1", "push:A=1",
            "vault:", "shadow:", "push:A=<unset>",
            "vault:A=2", "shadow:A=2", "push:A=2",
        ],
    );
}

#[test]
fn a_save_still_queued_when_its_caller_gives_up_never_runs() {
    let (writer, store) = start_loaded(&[]);
    let entered = store.watch_entries();
    let release = store.hold_next_write();
    let first = {
        let writer = writer.clone();
        std::thread::spawn(move || set(&writer, "A", "1"))
    };
    entered.recv_timeout(LONG).unwrap();

    let busy = {
        let writer = writer.clone();
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let started = Instant::now();
            let outcome = writer.mutate("B", Some("2".to_string()), SHORT);
            let _ = tx.send((outcome, started.elapsed()));
        });
        rx
    };
    let (outcome, elapsed) = busy.recv_timeout(Duration::from_secs(2)).expect("a queued save's caller gives up on time");
    assert_eq!(outcome, MutateOutcome::Busy);
    assert!(elapsed >= SHORT, "Busy came from the caller's own deadline");

    release.send(Ok(())).unwrap();
    assert_eq!(first.join().unwrap(), MutateOutcome::Saved);
    assert_eq!(set(&writer, "C", "3"), MutateOutcome::Saved);
    let vault_writes: Vec<String> = store.events().into_iter().filter(|e| e.starts_with("vault:")).collect();
    assert_eq!(vault_writes, vec!["vault:A=1", "vault:A=1,C=3"]);
    assert_eq!(writer.state().get("B"), None);
}

#[test]
fn a_started_save_reports_pending_then_commits_and_reports_its_late_success() {
    let (writer, store) = start_loaded(&[("A", "0")]);
    let release = store.hold_next_write();
    assert_eq!(writer.mutate("A", Some("1".to_string()), SHORT), MutateOutcome::Pending);
    assert_eq!(writer.write_state().pending, 1);
    assert_eq!(writer.state().get("A").as_deref(), Some("0"), "nothing commits before the Keychain answers");

    release.send(Ok(())).unwrap();
    let late = store.wait_for_late(1);
    assert_eq!(late, vec![LateOutcome { revision: 1, key: "A".to_string(), status: OutcomeStatus::Saved }]);
    assert_eq!(writer.state().get("A").as_deref(), Some("1"));
    assert_eq!(writer.write_state(), WriteState { revision: 1, pending: 0 });
    assert!(store.events().contains(&"push:A=1".to_string()));
}

#[test]
fn a_pending_save_that_fails_late_commits_nothing() {
    let (writer, store) = start_loaded(&[("A", "0")]);
    let release = store.hold_next_write();
    assert_eq!(writer.mutate("A", None, SHORT), MutateOutcome::Pending);
    release.send(Err("user denied".to_string())).unwrap();
    let late = store.wait_for_late(1);
    assert_eq!(late[0].status, OutcomeStatus::Failed);
    assert_eq!(late[0].revision, 0);
    assert_eq!(writer.state().get("A").as_deref(), Some("0"));
    assert_eq!(writer.write_state().pending, 0);
    assert!(store.events().is_empty(), "no vault, shadow or sidecar change after a failed write");
}

#[test]
fn a_hung_write_never_blocks_readers_and_later_saves_fail_fast() {
    let (writer, store) = start_loaded(&[("A", "0")]);
    let release = store.hold_next_write();
    assert_eq!(writer.mutate("A", Some("1".to_string()), SHORT), MutateOutcome::Pending);

    let readers = {
        let state = writer.state().clone();
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send((state.get("A"), state.snapshot().len(), state.source()));
        });
        rx
    };
    let (value, len, source) = readers.recv_timeout(Duration::from_secs(1)).expect("readers never wait on the Keychain");
    assert_eq!(value.as_deref(), Some("0"));
    assert_eq!(len, 1);
    assert_eq!(source, VaultSource::Vault);

    // Fill the queue (8 jobs, as approved) with saves whose callers give up:
    // each is cancelled but keeps its slot until the writer reaches it.
    assert_eq!(QUEUE_CAPACITY, 8);
    for i in 0..8 {
        assert_eq!(writer.mutate(&format!("Q{i}"), Some("x".to_string()), Duration::from_millis(5)), MutateOutcome::Busy);
    }
    let started = Instant::now();
    assert_eq!(writer.mutate("FULL", Some("x".to_string()), LONG), MutateOutcome::Busy);
    assert!(started.elapsed() < Duration::from_millis(500), "a full queue answers busy at once");

    release.send(Ok(())).unwrap();
    store.wait_for_late(1);
    assert_eq!(set(&writer, "B", "2"), MutateOutcome::Saved);
    let vault_writes: Vec<String> = store.events().into_iter().filter(|e| e.starts_with("vault:")).collect();
    assert_eq!(vault_writes, vec!["vault:A=1", "vault:A=1,B=2"], "cancelled saves never ran");
}

#[test]
fn a_stale_read_does_not_refresh_the_shadow_copy() {
    let (writer, store) = start_loaded(&[("A", "1")]);
    let before_save = writer.state().generation();
    assert_eq!(set(&writer, "B", "2"), MutateOutcome::Saved);
    writer.load(ReadResult::Vault(map(&[("A", "1")])), before_save, LONG);
    let shadows: Vec<String> = store.events().into_iter().filter(|e| e.starts_with("shadow:")).collect();
    assert_eq!(shadows, vec!["shadow:A=1,B=2"], "the stale read must not write an older shadow");
    assert_eq!(fmt(&writer.state().snapshot()), "A=1,B=2");

    let current = writer.state().generation();
    writer.load(ReadResult::Vault(map(&[("A", "1"), ("B", "2")])), current, LONG);
    assert_eq!(store.events().last().unwrap(), "shadow:A=1,B=2", "a current read refreshes the shadow");
}

#[test]
fn a_merge_never_resurrects_a_deleted_key_or_overrides_a_set_one() {
    let (writer, _store) = start_loaded(&[("A", "1"), ("B", "1")]);
    assert_eq!(writer.mutate("A", None, LONG), MutateOutcome::Saved);
    assert_eq!(set(&writer, "B", "2"), MutateOutcome::Saved);
    let generation = writer.state().generation();
    writer.load(ReadResult::Vault(map(&[("A", "1"), ("B", "1"), ("C", "3")])), generation, LONG);
    assert_eq!(fmt(&writer.state().snapshot()), "B=2,C=3");
}

#[test]
fn migration_merges_into_the_cache_and_cleans_up_only_after_its_write() {
    let (writer, store) = start();
    writer.load(ReadResult::Absent, 0, LONG);
    assert_eq!(set(&writer, "K", "new"), MutateOutcome::Saved);
    assert_eq!(writer.migrate(map(&[("K", "old"), ("M", "1")]), LONG), Some(VaultSource::Vault));
    assert_eq!(fmt(&writer.state().snapshot()), "K=new,M=1");
    let events = store.events();
    let vault_at = events.iter().position(|e| e == "vault:K=new,M=1").expect("merged vault write");
    let migrated_at = events.iter().position(|e| e == "migrated:K,M").expect("cleanup");
    assert!(vault_at < migrated_at);
}

#[test]
fn a_failed_migration_write_keeps_saves_gated_and_cleans_up_nothing() {
    let (writer, store) = start();
    store.fail_writes.store(true, Ordering::SeqCst);
    assert_eq!(writer.migrate(map(&[("M", "1")]), LONG), Some(VaultSource::Unavailable));
    assert_eq!(writer.state().get("M").as_deref(), Some("1"));
    assert!(store.events().iter().all(|e| !e.starts_with("migrated:")));
    assert_eq!(set(&writer, "X", "1"), MutateOutcome::Refused(UNAVAILABLE_GATE_MESSAGE));
}

#[test]
fn a_full_push_runs_in_order_with_the_cache_as_of_its_turn() {
    let (writer, store) = start_loaded(&[("A", "1")]);
    let entered = store.watch_entries();
    let release = store.hold_next_write();
    let save = {
        let writer = writer.clone();
        std::thread::spawn(move || set(&writer, "A", "2"))
    };
    entered.recv_timeout(LONG).unwrap();
    assert!(writer.push_all());
    release.send(Ok(())).unwrap();
    assert_eq!(save.join().unwrap(), MutateOutcome::Saved);
    let deadline = Instant::now() + LONG;
    while !store.events().iter().any(|e| e.starts_with("pushall:")) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(store.events(), vec!["vault:A=2", "shadow:A=2", "push:A=2", "pushall:A=2"]);
}

#[test]
fn readiness_wakes_waiters_and_a_dropped_guard_fails_an_unfinished_load() {
    let (writer, _store) = start();
    let state = writer.state().clone();
    assert_eq!(state.phase(), LoadPhase::Loading);
    let early = {
        let state = state.clone();
        std::thread::spawn(move || {
            let started = Instant::now();
            (state.wait_loaded(LONG), started.elapsed())
        })
    };
    std::thread::sleep(Duration::from_millis(30));
    writer.load(ReadResult::Absent, 0, LONG);
    let (phase, waited) = early.join().unwrap();
    assert_eq!(phase, LoadPhase::Ready);
    assert!(waited < Duration::from_secs(2), "the waiter woke on the change, not the timeout");
    assert_eq!(state.wait_loaded(Duration::ZERO), LoadPhase::Ready, "a later waiter returns at once");
    drop(LoadGuard::new(state.clone()));
    assert_eq!(state.phase(), LoadPhase::Ready, "a guard never undoes a finished load");

    let failing = Arc::new(VaultState::new());
    let waiter = {
        let failing = failing.clone();
        std::thread::spawn(move || failing.wait_loaded(LONG))
    };
    std::thread::sleep(Duration::from_millis(30));
    drop(LoadGuard::new(failing.clone()));
    assert_eq!(waiter.join().unwrap(), LoadPhase::Failed);
    assert_eq!(failing.wait_loaded(Duration::from_millis(1)), LoadPhase::Failed);
}

#[test]
fn a_panicking_store_call_fails_that_save_and_the_writer_keeps_serving() {
    let (writer, store) = start_loaded(&[]);
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));
    let outcome = set(&writer, "A", PANIC_VALUE);
    std::panic::set_hook(previous);
    assert_eq!(outcome, MutateOutcome::Failed(STOPPED_MESSAGE.to_string()));
    assert_eq!(set(&writer, "B", "2"), MutateOutcome::Saved);
    assert_eq!(store.events()[0], "vault:B=2");
}

#[test]
fn outcomes_map_to_the_messages_the_renderer_shows() {
    assert_eq!(MutateOutcome::Saved.into_result(), Ok(()));
    assert_eq!(MutateOutcome::Pending.into_result(), Err(PENDING_MESSAGE.to_string()));
    assert_eq!(MutateOutcome::Busy.into_result(), Err(BUSY_MESSAGE.to_string()));
    assert_eq!(MutateOutcome::Refused(SHADOW_GATE_MESSAGE).into_result(), Err(SHADOW_GATE_MESSAGE.to_string()));
    assert_eq!(gate_message(VaultSource::Vault), None);
    assert_eq!(gate_message(VaultSource::Absent), None);
    assert_eq!(VaultSource::Shadow.as_str(), "shadow");
}

/// A stateful, revision-aware effects sink driven by the actual controller and
/// VaultState adapter. No Keychain, native IPC, listener or filesystem IO.
#[derive(Default)]
struct RevisionSink {
    floor: u64,
    revisions: HashMap<String, u64>,
    values: HashMap<String, String>,
    requests: Vec<(String, secret_sync::Snapshot)>,
}
impl RevisionSink {
    fn apply(&mut self, key: &str, snapshot: secret_sync::Snapshot) {
        let revision = snapshot.revision.parse::<u64>().unwrap();
        self.requests.push((key.into(), snapshot.clone()));
        if revision <= self.floor || revision <= *self.revisions.get(key).unwrap_or(&0) { return; }
        self.revisions.insert(key.into(), revision);
        match snapshot.value {
            Some(value) => { self.values.insert(key.into(), value); }
            None => { self.values.remove(key); }
        }
    }
}
struct CurrentStore {
    state: Arc<VaultState>,
    clock: secret_sync::RevisionClock,
    sink: Mutex<RevisionSink>,
    events: Mutex<Vec<String>>,
    owner: std::sync::atomic::AtomicU64,
    hold_removal: Mutex<Option<mpsc::Receiver<()>>>,
    removal_entered: Mutex<Option<mpsc::Sender<()>>>,
    hold_write: Mutex<Option<mpsc::Receiver<()>>>,
    write_entered: Mutex<Option<mpsc::Sender<()>>>,
}
impl CurrentStore {
    fn send(&self, key: &str, expected: Option<u64>) {
        let outcome = tauri::async_runtime::block_on(secret_sync::send(
            || self.state.transport_snapshot(&self.clock, key),
            || secret_sync::target_for_generation(expected, || self.owner.load(Ordering::SeqCst), || Ok(())),
            |_, snapshot| { self.sink.lock().unwrap().apply(key, snapshot); std::future::ready(true) },
            || std::future::ready(()),
        ));
        if expected.is_none() { assert_eq!(outcome, secret_sync::Outcome::Accepted); }
    }
}
impl VaultStore for CurrentStore {
    fn write_vault(&self, _: &HashMap<String, String>) -> Result<(), String> {
        if let Some(tx) = self.write_entered.lock().unwrap().take() { let _ = tx.send(()); }
        if let Some(rx) = self.hold_write.lock().unwrap().take() { rx.recv_timeout(LONG).unwrap(); }
        self.events.lock().unwrap().push("vault".into()); Ok(())
    }
    fn write_shadow(&self, _: &HashMap<String, String>) {}
    fn push_key(&self, key: &str, value: Option<&str>) {
        if value.is_none() {
            if let Some(tx) = self.removal_entered.lock().unwrap().take() { let _ = tx.send(()); }
            if let Some(rx) = self.hold_removal.lock().unwrap().take() { rx.recv_timeout(LONG).unwrap(); }
        }
        self.events.lock().unwrap().push(format!("push:{key}:{}", value.is_none()));
        self.send(key, None);
    }
    fn push_all(&self, map: &HashMap<String, String>) {
        let mut keys: Vec<_> = map.keys().collect(); keys.sort();
        for key in keys { self.send(key, None); }
    }
    fn push_launch_keys(&self, generation: u64, keys: Vec<String>) {
        for key in keys { self.send(&key, Some(generation)); }
    }
    fn finish_migration(&self, _: &[String]) {}
    fn late_outcome(&self, _: &LateOutcome) {}
}
fn current_store() -> (VaultCoordinator, Arc<CurrentStore>, std::thread::JoinHandle<()>) {
    let state = Arc::new(VaultState::new());
    let store = Arc::new(CurrentStore {
        state: state.clone(), clock: secret_sync::RevisionClock::default(), sink: Mutex::new(RevisionSink::default()),
        events: Mutex::new(Vec::new()), owner: std::sync::atomic::AtomicU64::new(1),
        hold_removal: Mutex::new(None), removal_entered: Mutex::new(None), hold_write: Mutex::new(None), write_entered: Mutex::new(None),
    });
    let (writer, handle) = VaultCoordinator::start(state, store.clone()).unwrap();
    (writer, store, handle)
}
fn flush(writer: &VaultCoordinator) {
    let deadline = Instant::now() + LONG;
    loop {
        if let Some(source) = writer.load(ReadResult::Unavailable(HashMap::new()), writer.state().generation(), LONG) {
            assert_eq!(source, writer.state().source()); return;
        }
        assert!(Instant::now() < deadline, "writer did not drain bounded queue");
        std::thread::yield_now();
    }
}

struct ReleaseOnDrop(Option<mpsc::Sender<()>>);
impl ReleaseOnDrop { fn release(&mut self) { if let Some(tx) = self.0.take() { let _ = tx.send(()); } } }
impl Drop for ReleaseOnDrop { fn drop(&mut self) { self.release(); } }

#[test]
fn authoritative_partial_and_empty_load_remove_effective_credentials() {
    for incoming in [map(&[("A", "new")]), HashMap::new()] {
        let (writer, store, handle) = current_store();
        assert_eq!(writer.load(ReadResult::Shadow(map(&[("A", "old"), ("B", "stale")])), 0, LONG), Some(VaultSource::Shadow));
        store.sink.lock().unwrap().values.insert("inherited".into(), "fallback".into());
        assert!(writer.push_all()); flush(&writer);
        assert_eq!(writer.load(ReadResult::Vault(incoming.clone()), 0, LONG), Some(VaultSource::Vault));
        assert!(writer.push_all()); flush(&writer);
        assert_eq!(writer.state().snapshot(), incoming);
        let sink = store.sink.lock().unwrap();
        let mut expected = incoming; expected.insert("inherited".into(), "fallback".into());
        assert_eq!(sink.values, expected, "actual effects remove managed credentials only");
        assert!(sink.requests.iter().any(|(key, snapshot)| key == "B" && snapshot.value.is_none()), "removed B is an explicit revisioned tombstone");
        assert!(!sink.requests.iter().any(|(key, _)| key == "inherited"), "unowned fallback never selected");
        drop(sink); drop(writer); handle.join().unwrap();
    }
}

#[test]
fn empty_load_removals_survive_full_queue_and_finish_before_later_save() {
    let (writer, store, handle) = current_store();
    writer.load(ReadResult::Shadow(map(&[("A", "old"), ("B", "stale")])), 0, LONG).unwrap();
    writer.push_all(); flush(&writer);
    let (release_tx, release_rx) = mpsc::channel(); let mut release = ReleaseOnDrop(Some(release_tx));
    let (entered_tx, entered_rx) = mpsc::channel();
    *store.hold_removal.lock().unwrap() = Some(release_rx);
    *store.removal_entered.lock().unwrap() = Some(entered_tx);
    let loading = writer.clone();
    let loader = std::thread::spawn(move || loading.load(ReadResult::Vault(HashMap::new()), 0, LONG));
    entered_rx.recv_timeout(LONG).unwrap();
    for _ in 0..QUEUE_CAPACITY { assert!(writer.push_all()); }
    assert!(!writer.push_all(), "queue really full while Load removal is in flight");
    release.release();
    assert_eq!(loader.join().unwrap(), Some(VaultSource::Vault));
    flush(&writer);
    assert_eq!(set(&writer, "B", "later"), MutateOutcome::Saved);
    let events = store.events.lock().unwrap();
    let tombstone = events.iter().position(|event| event == "push:B:true").unwrap();
    let save = events.iter().position(|event| event == "vault").unwrap();
    assert!(tombstone < save, "all Load removals finish before next save");
    assert_eq!(store.sink.lock().unwrap().values, map(&[("B", "later")]));
    drop(events); drop(writer); handle.join().unwrap();
}

#[test]
fn launch_full_retains_and_recomputes_then_admits_once_on_later_tick() {
    use secret_sync::{PushAdmission, ReconcileAdmission};
    let (writer, store, handle) = current_store();
    writer.load(ReadResult::Vault(map(&[("A", "old")])), 0, LONG).unwrap();
    let (launch, floor) = writer.state().transport_launch(&store.clock).unwrap();
    { let mut sink = store.sink.lock().unwrap(); sink.floor = floor.parse().unwrap(); sink.values = launch.clone(); }
    let pending = secret_sync::LaunchReconciliation::default(); pending.install(1, launch).unwrap();
    let (release_tx, release_rx) = mpsc::channel(); let mut release = ReleaseOnDrop(Some(release_tx));
    let (entered_tx, entered_rx) = mpsc::channel();
    *store.hold_write.lock().unwrap() = Some(release_rx); *store.write_entered.lock().unwrap() = Some(entered_tx);
    let saving = writer.clone(); let save = std::thread::spawn(move || set(&saving, "A", "new"));
    entered_rx.recv_timeout(LONG).unwrap();
    for _ in 0..QUEUE_CAPACITY { assert!(writer.push_all()); }
    // Launch current is still old here; select deletion/new-key delta by using a
    // newer launch snapshot, then recompute through actual state each tick.
    pending.install(1, map(&[("A", "launch"), ("B", "stale")])).unwrap();
    for _fake_tick in 0..121 { // no wall-clock cutoff after a simulated 180s stall
        assert_eq!(pending.try_enqueue_changed(1, || writer.state().with_transport_map(|map| Ok(map.clone())), |keys| writer.try_push_keys(1, keys)).unwrap(), ReconcileAdmission::Full);
    }
    release.release(); assert_eq!(save.join().unwrap(), MutateOutcome::Saved);
    flush(&writer);
    let mut admitted = Vec::new();
    assert_eq!(pending.try_enqueue_changed(1, || writer.state().with_transport_map(|map| Ok(map.clone())), |keys| {
        admitted = keys.clone(); writer.try_push_keys(1, keys)
    }).unwrap(), ReconcileAdmission::Accepted);
    assert_eq!(admitted, ["A", "B"], "Full retained original launch and recomputed latest delta");
    assert_eq!(pending.try_enqueue_changed(1, || panic!("consumed exactly once"), |_| PushAdmission::Accepted).unwrap(), ReconcileAdmission::Idle);
    flush(&writer);
    assert_eq!(store.sink.lock().unwrap().values, map(&[("A", "new")]));
    drop(writer); handle.join().unwrap();
}

#[test]
fn queued_old_generation_cannot_clear_new_child_inherited_fallback() {
    use secret_sync::PushAdmission;
    let (writer, store, handle) = current_store();
    writer.load(ReadResult::Vault(HashMap::new()), 0, LONG).unwrap();
    let (release_tx, release_rx) = mpsc::channel(); let mut release = ReleaseOnDrop(Some(release_tx));
    let (entered_tx, entered_rx) = mpsc::channel();
    *store.hold_write.lock().unwrap() = Some(release_rx); *store.write_entered.lock().unwrap() = Some(entered_tx);
    let saving = writer.clone(); let save = std::thread::spawn(move || set(&saving, "A", "new"));
    entered_rx.recv_timeout(LONG).unwrap();
    assert_eq!(writer.try_push_keys(1, vec!["B".into()]), PushAdmission::Accepted);
    store.owner.store(2, Ordering::SeqCst);
    store.sink.lock().unwrap().values.insert("B".into(), "new-child-fallback".into());
    release.release(); assert_eq!(save.join().unwrap(), MutateOutcome::Saved); flush(&writer);
    let sink = store.sink.lock().unwrap();
    assert_eq!(sink.values.get("B").map(String::as_str), Some("new-child-fallback"));
    assert!(!sink.requests.iter().any(|(key, _)| key == "B"), "queued old owner issues no request");
    drop(sink); drop(writer); handle.join().unwrap();
}

#[test]
fn generation_guard_detects_supersession_during_lookup_and_each_retry() {
    let owner = std::cell::Cell::new(1); let mut posts = 0;
    assert!(secret_sync::target_for_generation(Some(1), || owner.get(), || { owner.set(2); Ok(()) }).is_err());
    owner.set(1); let state = VaultState::new(); let clock = secret_sync::RevisionClock::default();
    assert_eq!(tauri::async_runtime::block_on(secret_sync::send(
        || state.transport_snapshot(&clock, "B"),
        || secret_sync::target_for_generation(Some(1), || owner.get(), || Ok(())),
        |_, _| { posts += 1; std::future::ready(false) },
        || { owner.set(2); std::future::ready(()) },
    )), secret_sync::Outcome::TargetUnavailable);
    assert_eq!(posts, 1);
    assert!(secret_sync::target_for_generation(None, || owner.get(), || Ok(())).is_ok(), "normal mutations use fresh live target without launch owner restriction");
}

#[test]
fn transactional_pending_keeps_owner_on_read_failure_stopped_and_foreign_confirmation() {
    use secret_sync::{PushAdmission, ReconcileAdmission};
    let pending = secret_sync::LaunchReconciliation::default();
    pending.install(7, map(&[("B", "launch")])).unwrap();
    assert_eq!(pending.try_enqueue_changed(6, || panic!("foreign owner must not inspect state"), |_| panic!("foreign owner must not enqueue")).unwrap(), ReconcileAdmission::Idle);
    assert!(pending.try_enqueue_changed(7, || Err(()), |_| panic!("failed read must not enqueue")).is_err());
    assert_eq!(pending.try_enqueue_changed(7, || Ok(HashMap::new()), |_| PushAdmission::Stopped).unwrap(), ReconcileAdmission::Stopped);
    assert_eq!(pending.try_enqueue_changed(7, || Ok(HashMap::new()), |_| PushAdmission::Stopped).unwrap(), ReconcileAdmission::StoppedPreviouslyReported);
    assert_eq!(pending.try_enqueue_changed(7, || Ok(HashMap::new()), |keys| { assert_eq!(keys, ["B"]); PushAdmission::Accepted }).unwrap(), ReconcileAdmission::Accepted);
    assert_eq!(pending.try_enqueue_changed(7, || panic!("once"), |_| panic!("once")).unwrap(), ReconcileAdmission::Idle);
}

#[test]
fn concurrent_normal_and_late_confirmation_admit_actual_state_delta_once() {
    use secret_sync::{PushAdmission, ReconcileAdmission};
    let (writer, store, handle) = current_store();
    writer.load(ReadResult::Shadow(map(&[("B", "launch")])), 0, LONG).unwrap();
    let (launch, _) = writer.state().transport_launch(&store.clock).unwrap();
    let pending = Arc::new(secret_sync::LaunchReconciliation::default()); pending.install(1, launch).unwrap();
    writer.load(ReadResult::Vault(HashMap::new()), 0, LONG).unwrap();
    let barrier = Arc::new(std::sync::Barrier::new(3)); let admissions = Arc::new(Mutex::new(Vec::new()));
    let mut workers = Vec::new();
    for _ in 0..2 {
        let state = writer.state().clone(); let pending = pending.clone(); let barrier = barrier.clone(); let admissions = admissions.clone();
        workers.push(std::thread::spawn(move || {
            barrier.wait();
            pending.try_enqueue_changed(1, || state.with_transport_map(|map| Ok(map.clone())), |keys| {
                admissions.lock().unwrap().push(keys); PushAdmission::Accepted
            }).unwrap()
        }));
    }
    barrier.wait();
    let results: Vec<_> = workers.into_iter().map(|worker| worker.join().unwrap()).collect();
    assert_eq!(results.iter().filter(|result| **result == ReconcileAdmission::Accepted).count(), 1);
    assert_eq!(results.iter().filter(|result| **result == ReconcileAdmission::Idle).count(), 1);
    assert_eq!(*admissions.lock().unwrap(), vec![vec!["B".to_string()]]);
    drop(writer); handle.join().unwrap();
}

#[test]
fn actual_launch_floor_rejects_delayed_request_for_absent_native_key() {
    let state = VaultState::new(); let clock = secret_sync::RevisionClock::default();
    let delayed = state.transport_snapshot(&clock, "B").unwrap();
    let (launch, floor) = state.transport_launch(&clock).unwrap(); assert!(launch.is_empty());
    let mut sink = RevisionSink { floor: floor.parse().unwrap(), values: map(&[("B", "inherited")]), ..RevisionSink::default() };
    sink.apply("B", delayed);
    assert_eq!(sink.values.get("B").map(String::as_str), Some("inherited"));
    sink.apply("B", state.transport_snapshot(&clock, "B").unwrap());
    assert!(sink.values.is_empty(), "post-floor managed unset applies");
}
