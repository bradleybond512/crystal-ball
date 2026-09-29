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
    assert!(!s.on_manual_retry(500), "running sidecar must not be restartable from the renderer");
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
    assert!(!s.on_manual_retry(2_500));
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
    assert!(!is_own_sidecar_command(world_monitor, NODE, SCRIPT));
    assert!(!is_own_sidecar_command(&format!("{NODE} {SCRIPT} --inspect"), NODE, SCRIPT));
    assert!(!is_own_sidecar_command(&format!("{NODE} --inspect {SCRIPT}"), NODE, SCRIPT));
    assert!(!is_own_sidecar_command(&format!("/usr/local/bin/node {SCRIPT}"), NODE, SCRIPT));
    assert!(!is_own_sidecar_command(&format!("{NODE} {SCRIPT}.evil"), NODE, SCRIPT));
    assert!(!is_own_sidecar_command(NODE, NODE, SCRIPT));
    assert!(!is_own_sidecar_command("", NODE, SCRIPT));
    assert!(!is_own_sidecar_command(" ", "", ""));
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
