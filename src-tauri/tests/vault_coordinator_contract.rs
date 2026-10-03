// R3-BUG-001 slice B: the one vault writer, driven by a fake store. Nothing
// here touches the Keychain, the disk or a sidecar.
// Items only main.rs uses are dead code in this test crate.
#[allow(dead_code)]
#[path = "../src/vault_coordinator.rs"]
mod vault_coordinator;

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
