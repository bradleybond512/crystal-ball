#[path = "../src/sidecar_supervisor.rs"]
mod sidecar_supervisor;
use sidecar_supervisor::*;

const NODE: &str = "/Users/me/Applications/Crystal Ball.app/Contents/Resources/sidecar/node/node";
const SCRIPT: &str = "/Users/me/Applications/Crystal Ball.app/Contents/Resources/sidecar/local-api-server.mjs";

fn started_at(now: u64) -> SupervisorState {
    let mut s = SupervisorState::new();
    s.on_started(now);
    s
}

#[test]
fn backoff_doubles_from_one_second_and_caps_at_sixty() {
    let delays: Vec<u64> = (0..9).map(backoff_ms).collect();
    assert_eq!(delays, vec![1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000]);
    assert_eq!(backoff_ms(u32::MAX), BACKOFF_MAX_MS);
}

#[test]
fn an_unexpected_exit_schedules_a_restart_after_one_second() {
    let mut s = started_at(0);
    assert_eq!(s.on_exit(10_000, Some(0), None), Decision::RestartAfter(1_000));
    let snap = s.snapshot(10_000);
    assert_eq!(snap.phase, PhaseLabel::Restarting);
    assert_eq!(snap.next_retry_in_ms, Some(1_000));
    assert_eq!(snap.last_exit, Some(ExitRecord { at_ms: 10_000, code: Some(0), signal: None }));
}

#[test]
fn consecutive_quick_exits_back_off_then_give_up_on_the_fifth_in_five_minutes() {
    let mut s = started_at(0);
    let mut now = 1_000;
    let mut delays = Vec::new();
    for _ in 0..(FLAP_LIMIT - 1) {
        match s.on_exit(now, None, Some(9)) {
            Decision::RestartAfter(ms) => delays.push(ms),
            other => panic!("expected restart, got {other:?}"),
        }
        now += 5_000;
        s.on_started(now);
        now += 1_000;
    }
    assert_eq!(delays, vec![1_000, 2_000, 4_000, 8_000]);
    assert_eq!(s.on_exit(now, None, Some(9)), Decision::GiveUp);
    assert_eq!(s.snapshot(now).phase, PhaseLabel::Stopped);
    assert_eq!(s.snapshot(now).next_retry_in_ms, None);
}

#[test]
fn exits_older_than_the_flap_window_are_forgotten() {
    let mut s = started_at(0);
    let mut now = 0;
    for _ in 0..(FLAP_LIMIT - 1) {
        now += 1_000;
        assert!(matches!(s.on_exit(now, None, None), Decision::RestartAfter(_)));
        s.on_started(now);
    }
    // The first exit (t = 1 s) leaves the window once more than 5 min pass.
    now = 1_000 + FLAP_WINDOW_MS + 1;
    assert!(matches!(s.on_exit(now, None, None), Decision::RestartAfter(_)));
}

#[test]
fn a_stable_run_resets_the_backoff() {
    let mut s = started_at(0);
    assert_eq!(s.on_exit(1_000, None, None), Decision::RestartAfter(1_000));
    s.on_started(2_000);
    assert_eq!(s.on_exit(3_000, None, None), Decision::RestartAfter(2_000));
    s.on_started(5_000);
    // This run lasts exactly the stable threshold.
    assert_eq!(s.on_exit(5_000 + STABLE_UPTIME_MS, None, None), Decision::RestartAfter(1_000));
}

#[test]
fn a_short_run_does_not_reset_the_backoff() {
    let mut s = started_at(0);
    assert_eq!(s.on_exit(1_000, None, None), Decision::RestartAfter(1_000));
    s.on_started(2_000);
    assert_eq!(s.on_exit(2_000 + STABLE_UPTIME_MS - 1, None, None), Decision::RestartAfter(2_000));
}

#[test]
fn start_failures_count_toward_giving_up() {
    let mut s = started_at(0);
    assert!(matches!(s.on_exit(1_000, None, None), Decision::RestartAfter(1_000)));
    assert_eq!(s.on_start_failed(2_000), Decision::RestartAfter(2_000));
    assert_eq!(s.on_start_failed(4_000), Decision::RestartAfter(4_000));
    assert_eq!(s.on_start_failed(8_000), Decision::RestartAfter(8_000));
    assert_eq!(s.on_start_failed(16_000), Decision::GiveUp);
}

#[test]
fn manual_retry_only_acts_when_stopped_and_clears_the_breaker() {
    let mut s = started_at(0);
    assert_eq!(s.on_manual_retry(500), false, "running sidecar must not be restartable from the renderer");
    for i in 0..FLAP_LIMIT {
        let _ = s.on_exit(1_000 + i as u64, None, None);
    }
    assert_eq!(s.snapshot(10_000).phase, PhaseLabel::Stopped);
    assert!(s.on_manual_retry(10_000));
    assert_eq!(s.snapshot(10_000).phase, PhaseLabel::Restarting);
    s.on_started(11_000);
    assert_eq!(s.on_exit(12_000, None, None), Decision::RestartAfter(1_000));
}

#[test]
fn nothing_restarts_after_shutdown() {
    let mut s = started_at(0);
    s.on_shutdown();
    assert_eq!(s.on_exit(1_000, Some(0), None), Decision::Ignore);
    assert_eq!(s.on_start_failed(2_000), Decision::Ignore);
    assert_eq!(s.on_manual_retry(2_500), false, "no manual retry once shutdown began");
    s.on_started(3_000);
    assert_eq!(s.snapshot(3_000).phase, PhaseLabel::ShuttingDown);
}

#[test]
fn restart_count_excludes_the_boot_start() {
    let mut s = started_at(0);
    assert_eq!(s.snapshot(0).restarts, 0);
    let _ = s.on_exit(1_000, None, None);
    s.on_started(2_000);
    assert_eq!(s.snapshot(2_000).restarts, 1);
    assert_eq!(s.snapshot(2_000).phase, PhaseLabel::Running);
}

#[test]
fn own_sidecar_command_is_an_exact_match() {
    let own = format!("{NODE} {SCRIPT}");
    assert!(is_own_sidecar_command(&own, NODE, SCRIPT));
    assert!(is_own_sidecar_command(&format!("{own}\n"), NODE, SCRIPT));
}

#[test]
fn foreign_listeners_are_never_treated_as_ours() {
    let world_monitor = "/Users/me/Applications/World Monitor.app/Contents/Resources/sidecar/node/node \
/Users/me/Applications/World Monitor.app/Contents/Resources/sidecar/local-api-server.mjs";
    let foreign = [
        (world_monitor.to_string(), NODE, SCRIPT),
        (format!("{NODE} {SCRIPT} --inspect"), NODE, SCRIPT),
        (format!("{NODE} --inspect {SCRIPT}"), NODE, SCRIPT),
        (format!("/usr/local/bin/node {SCRIPT}"), NODE, SCRIPT),
        (format!("{NODE} {SCRIPT}.evil"), NODE, SCRIPT),
        (NODE.to_string(), NODE, SCRIPT),
        (String::new(), NODE, SCRIPT),
        (" ".to_string(), "", ""),
    ];
    for (command, node, script) in &foreign {
        assert_eq!(is_own_sidecar_command(command, node, script), false, "{command:?} would be signalled as ours");
    }
}

#[test]
fn phase_labels_are_the_renderer_contract() {
    let labels: Vec<&str> = [
        PhaseLabel::Idle,
        PhaseLabel::Running,
        PhaseLabel::Restarting,
        PhaseLabel::Stopped,
        PhaseLabel::ShuttingDown,
    ]
    .into_iter()
    .map(PhaseLabel::as_str)
    .collect();
    assert_eq!(labels, vec!["idle", "running", "restarting", "stopped", "shutting_down"]);
}

// ── Port publication across generations (Sol's review of 6a4f6170b) ──
// These drive the real sidecar_publication module that main.rs uses, with a
// fake child whose exit the test controls. No real process or signal is used.

#[path = "../src/sidecar_publication.rs"]
mod sidecar_publication;
use sidecar_publication::{PortCell, Publication, SidecarChild, Tick};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::cell::Cell;
use std::sync::{mpsc, Arc, Mutex, TryLockError};
use std::time::Duration;

const DEFAULT: u16 = 46_123;

struct FakeChild {
    exited: Arc<AtomicBool>,
    code: i32,
    failing: bool,
}

impl SidecarChild for FakeChild {
    type Status = i32;
    fn poll_exit(&mut self) -> std::io::Result<Option<i32>> {
        if self.failing {
            return Err(std::io::Error::other("try_wait failed"));
        }
        Ok(self.exited.load(Ordering::SeqCst).then_some(self.code))
    }
}

#[derive(Default)]
struct Shared {
    child: Mutex<Option<FakeChild>>,
    port: Mutex<Option<u16>>,
    confirmed: AtomicBool,
    generation: AtomicU64,
    shutting_down: AtomicBool,
}

impl Shared {
    fn cell(&self) -> PortCell<'_, FakeChild> {
        PortCell {
            child: &self.child,
            port: &self.port,
            confirmed: &self.confirmed,
            generation: &self.generation,
            shutting_down: &self.shutting_down,
        }
    }

    /// What start_local_api does under the child lock: clear the port, then
    /// store the new child.
    fn start(&self, code: i32) -> (u64, Arc<AtomicBool>) {
        let exited = Arc::new(AtomicBool::new(false));
        let mut slot = self.child.lock().unwrap();
        *self.port.lock().unwrap() = None;
        self.confirmed.store(false, Ordering::SeqCst);
        let generation = self.cell().install(&mut slot, FakeChild { exited: Arc::clone(&exited), code, failing: false });
        (generation, exited)
    }

    fn published(&self) -> (Option<u16>, bool) {
        (*self.port.lock().unwrap(), self.confirmed.load(Ordering::SeqCst))
    }
}

/// What a tick did, as a value assertions can compare (`io::Error` is not
/// `PartialEq`).
#[derive(Debug, PartialEq)]
enum Seen {
    Running(Option<u16>),
    Exited(i32),
    Gone,
    Failed(std::io::ErrorKind),
}

fn seen(tick: Tick<i32>) -> Seen {
    match tick {
        Tick::Running(late) => Seen::Running(late),
        Tick::Exited(code) => Seen::Exited(code),
        Tick::Gone => Seen::Gone,
        Tick::Failed(error) => Seen::Failed(error.kind()),
    }
}

/// Resumes a parked starter when dropped, so a failed assertion never leaves
/// the thread waiting.
struct Resume(Option<mpsc::Sender<()>>);

impl Drop for Resume {
    fn drop(&mut self) {
        if let Some(tx) = self.0.take() {
            let _ = tx.send(());
        }
    }
}

#[test]
fn a_starter_parked_after_reading_its_port_cannot_publish_it_once_the_next_child_confirms() {
    let shared = Arc::new(Shared::default());
    let (a, a_exited) = shared.start(1);
    let (read_tx, read_rx) = mpsc::channel();
    let (resume_tx, resume_rx) = mpsc::channel::<()>();
    let resume = Resume(Some(resume_tx));
    let starter = {
        let shared = Arc::clone(&shared);
        std::thread::spawn(move || {
            // A's port-file wait returned 40001; A's starter stalls before publishing.
            let waited = Some(40_001);
            read_tx.send(()).unwrap();
            let _ = resume_rx.recv_timeout(Duration::from_secs(5));
            shared.cell().publish_start(a, waited, DEFAULT)
        })
    };
    read_rx.recv_timeout(Duration::from_secs(5)).expect("A's starter read its port");

    a_exited.store(true, Ordering::SeqCst);
    assert_eq!(seen(shared.cell().tick(a, || None)), Seen::Exited(1), "A's monitor reaps A");
    assert_eq!(shared.published(), (None, false), "A's exit revokes its port");
    let (b, _) = shared.start(0);
    assert_eq!(shared.cell().publish_start(b, Some(40_002), DEFAULT), Publication::Confirmed(40_002));

    drop(resume);
    assert_eq!(starter.join().unwrap(), Publication::Stale, "A's starter is no longer live");
    assert_eq!(shared.published(), (Some(40_002), true), "B's confirmed port survives");
}

#[test]
fn a_stale_timeout_fallback_cannot_clear_the_next_childs_confirmation() {
    let shared = Shared::default();
    let (a, a_exited) = shared.start(1);
    a_exited.store(true, Ordering::SeqCst);
    assert_eq!(seen(shared.cell().tick(a, || None)), Seen::Exited(1));
    let (b, _) = shared.start(0);
    assert_eq!(shared.cell().publish_start(b, Some(40_002), DEFAULT), Publication::Confirmed(40_002));

    assert_eq!(shared.cell().publish_start(a, None, DEFAULT), Publication::Stale);
    assert_eq!(shared.published(), (Some(40_002), true));
}

#[test]
fn a_replaced_monitor_neither_confirms_nor_reaps_for_the_next_child() {
    let shared = Shared::default();
    let (a, a_exited) = shared.start(1);
    a_exited.store(true, Ordering::SeqCst);
    assert_eq!(seen(shared.cell().tick(a, || None)), Seen::Exited(1));
    let (b, b_exited) = shared.start(0);

    assert_eq!(seen(shared.cell().tick(a, || Some(40_001))), Seen::Gone);
    assert_eq!(shared.published(), (None, false), "a replaced monitor confirms nothing");
    assert_eq!(seen(shared.cell().tick(b, || Some(40_002))), Seen::Running(Some(40_002)));
    assert_eq!(seen(shared.cell().tick(b, || Some(40_003))), Seen::Running(None), "a confirmation is never replaced");

    b_exited.store(true, Ordering::SeqCst);
    assert_eq!(seen(shared.cell().tick(a, || None)), Seen::Gone, "A's monitor never reaps B");
    assert_eq!(shared.published(), (Some(40_002), true));
    assert_eq!(seen(shared.cell().tick(b, || None)), Seen::Exited(0));
    assert_eq!(shared.published(), (None, false));
}

#[test]
fn an_exited_child_is_never_published_even_before_its_monitor_reaps_it() {
    let shared = Shared::default();
    let (a, a_exited) = shared.start(1);
    a_exited.store(true, Ordering::SeqCst);
    assert_eq!(shared.cell().publish_start(a, Some(40_001), DEFAULT), Publication::Stale);
    assert_eq!(shared.cell().publish_start(a, None, DEFAULT), Publication::Stale);
    assert_eq!(shared.published(), (None, false));
}

#[test]
fn nothing_is_published_or_confirmed_late_once_shutdown_begins() {
    let shared = Shared::default();
    let (a, _) = shared.start(0);
    shared.shutting_down.store(true, Ordering::SeqCst);
    assert_eq!(shared.cell().publish_start(a, Some(40_001), DEFAULT), Publication::Stale);
    assert_eq!(seen(shared.cell().tick(a, || Some(40_001))), Seen::Running(None));
    assert_eq!(shared.published(), (None, false));
}

#[test]
fn shutdown_takes_the_child_and_revokes_its_confirmed_port() {
    let shared = Shared::default();
    let (a, _) = shared.start(0);
    assert_eq!(shared.cell().publish_start(a, Some(40_001), DEFAULT), Publication::Confirmed(40_001));
    shared.shutting_down.store(true, Ordering::SeqCst);
    assert!(shared.cell().take_for_shutdown().is_some());
    assert_eq!(shared.published(), (None, false));
    assert_eq!(seen(shared.cell().tick(a, || Some(40_001))), Seen::Gone);
    assert_eq!(shared.published(), (None, false));
}

#[test]
fn the_timeout_fallback_records_the_default_unconfirmed_and_never_undoes_a_confirmation() {
    let shared = Shared::default();
    let (a, _) = shared.start(0);
    assert_eq!(shared.cell().publish_start(a, None, DEFAULT), Publication::Unconfirmed(DEFAULT));
    assert_eq!(shared.published(), (Some(DEFAULT), false));
    assert_eq!(seen(shared.cell().tick(a, || Some(40_001))), Seen::Running(Some(40_001)));
    assert_eq!(shared.cell().publish_start(a, None, DEFAULT), Publication::Confirmed(40_001));
    assert_eq!(shared.published(), (Some(40_001), true));
}

#[test]
fn publication_waits_for_the_child_lock_before_it_touches_the_port() {
    let shared = Arc::new(Shared::default());
    let (a, _) = shared.start(0);
    let held = shared.child.lock().unwrap();
    let (started_tx, started_rx) = mpsc::channel();
    let publisher = {
        let shared = Arc::clone(&shared);
        std::thread::spawn(move || {
            started_tx.send(()).unwrap();
            shared.cell().publish_start(a, Some(40_001), DEFAULT)
        })
    };
    started_rx.recv_timeout(Duration::from_secs(5)).expect("publisher started");
    std::thread::sleep(Duration::from_millis(100));
    // try_lock, not lock: a publisher holding the port while it waits for the
    // child lock is exactly the inverted order this test rejects.
    let port = match shared.port.try_lock() {
        Ok(port) => Ok(*port),
        Err(TryLockError::WouldBlock) => Err("held without the child lock"),
        Err(TryLockError::Poisoned(_)) => Err("poisoned"),
    };
    assert_eq!(port, Ok(None), "the publisher must not touch the port before it holds the child lock");
    assert_eq!(shared.confirmed.load(Ordering::SeqCst), false, "nothing is confirmed while another holder owns the child lock");
    drop(held);
    assert_eq!(publisher.join().unwrap(), Publication::Confirmed(40_001));
}

#[test]
fn a_late_confirmation_is_read_and_published_under_the_child_lock() {
    let shared = Shared::default();
    let (a, _) = shared.start(0);
    let child_lock = Cell::new("not read");
    let ticked = shared.cell().tick(a, || {
        child_lock.set(match shared.child.try_lock() {
            Err(TryLockError::WouldBlock) => "held",
            Ok(_) => "free",
            Err(TryLockError::Poisoned(_)) => "poisoned",
        });
        Some(40_001)
    });
    assert_eq!(seen(ticked), Seen::Running(Some(40_001)));
    assert_eq!(child_lock.get(), "held", "a revocation could interleave with the late confirmation");
    assert_eq!(shared.published(), (Some(40_001), true));
}

#[test]
fn secret_injection_gets_only_a_confirmed_port_of_the_live_child_and_never_a_default() {
    let shared = Shared::default();
    let (a, a_exited) = shared.start(0);
    assert_eq!(shared.cell().confirmed_live_port(), None, "nothing confirmed yet");
    assert_eq!(shared.cell().publish_start(a, None, DEFAULT), Publication::Unconfirmed(DEFAULT));
    assert_eq!(shared.cell().confirmed_live_port(), None, "the unconfirmed default");
    assert_eq!(shared.cell().publish_start(a, Some(40_001), DEFAULT), Publication::Confirmed(40_001));
    assert_eq!(shared.cell().confirmed_live_port(), Some(40_001));

    // Mid-revocation as an unlocked reader could observe it: still confirmed,
    // port already gone. The reader must not substitute a default.
    *shared.port.lock().unwrap() = None;
    assert_eq!(shared.cell().confirmed_live_port(), None, "a revoked port is never replaced by a default");
    *shared.port.lock().unwrap() = Some(40_001);

    a_exited.store(true, Ordering::SeqCst);
    assert_eq!(shared.cell().confirmed_live_port(), None, "exited before its monitor reaped it");
    a_exited.store(false, Ordering::SeqCst);
    shared.shutting_down.store(true, Ordering::SeqCst);
    assert_eq!(shared.cell().confirmed_live_port(), None, "shutdown has begun");
}

#[test]
fn a_failed_exit_poll_neither_reaps_nor_changes_the_publication() {
    let shared = Shared::default();
    let (a, _) = shared.start(0);
    assert_eq!(shared.cell().publish_start(a, Some(40_001), DEFAULT), Publication::Confirmed(40_001));
    shared.child.lock().unwrap().as_mut().unwrap().failing = true;
    assert_eq!(seen(shared.cell().tick(a, || Some(40_002))), Seen::Failed(std::io::ErrorKind::Other));
    assert_eq!(shared.published(), (Some(40_001), true), "a poll error changes nothing");
    assert!(shared.child.lock().unwrap().is_some(), "a poll error does not reap the child");
    assert_eq!(shared.cell().confirmed_live_port(), None, "a child that cannot be polled is not known to be live");
}
