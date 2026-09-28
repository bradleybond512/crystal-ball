#[path = "../src/watchdog.rs"]
mod watchdog;
use watchdog::*;

#[test]
fn main_focus_tracks_gain_and_loss() {
    let focus = MainFocus::new();
    assert!(!focus.snapshot().focused);
    let initial = focus.snapshot().generation;
    focus.update("main", true);
    let gained = focus.snapshot();
    assert!(gained.focused);
    assert_ne!(gained.generation, initial);
    focus.update("main", false);
    let lost = focus.snapshot();
    assert!(!lost.focused);
    assert_ne!(lost.generation, gained.generation);
}
#[test]
fn auxiliary_focus_cannot_change_main_authority() {
    let focus = MainFocus::new();
    focus.update("main", true);
    let main = focus.snapshot();
    assert!(main.focused);
    for label in ["settings", "live-channels", "Main", ""] {
        focus.update(label, false);
        assert_eq!(focus.snapshot(), main);
    }
}
#[test]
fn duplicate_events_do_not_reset_focus_generation() {
    let focus = MainFocus::new();
    focus.update("main", true);
    let first = focus.snapshot();
    assert!(first.focused);
    focus.update("main", true);
    assert_eq!(focus.snapshot(), first);
    focus.update("main", false);
    let lost = focus.snapshot();
    focus.update("main", false);
    assert_eq!(focus.snapshot(), lost);
}
#[test]
fn boot_grace_ends_once_at_sixty_seconds() {
    let focus = MainFocus::new();
    focus.update("main", true);
    let mut policy = WatchdogPolicy::new(500);
    assert_eq!(
        policy.tick(60_499, focus.snapshot(), 900_000),
        Decision::Idle
    );
    assert_eq!(
        policy.tick(60_500, focus.snapshot(), 900_000),
        Decision::Rebaseline
    );
    assert_eq!(
        policy.tick(72_500, focus.snapshot(), 60_001),
        Decision::Reload
    );
}
#[test]
fn focus_grace_and_heartbeat_threshold_keep_exact_boundaries() {
    let focus = MainFocus::new();
    focus.update("main", true);
    let mut policy = WatchdogPolicy::new(0);
    assert_eq!(
        policy.tick(60_000, focus.snapshot(), 900_000),
        Decision::Rebaseline
    );
    assert_eq!(
        policy.tick(71_999, focus.snapshot(), 900_000),
        Decision::Idle
    );
    assert_eq!(
        policy.tick(72_000, focus.snapshot(), 60_000),
        Decision::Idle
    );
    assert_eq!(
        policy.tick(72_000, focus.snapshot(), 60_001),
        Decision::Reload
    );
}
#[test]
fn unfocused_window_stays_exempt_and_regain_rebaselines() {
    let focus = MainFocus::new();
    focus.update("main", true);
    let mut policy = WatchdogPolicy::new(0);
    assert_eq!(
        policy.tick(60_000, focus.snapshot(), 900_000),
        Decision::Rebaseline
    );
    focus.update("main", false);
    assert_eq!(
        policy.tick(600_000, focus.snapshot(), 900_000),
        Decision::Idle
    );
    focus.update("main", true);
    assert_eq!(
        policy.tick(603_000, focus.snapshot(), 900_000),
        Decision::Rebaseline
    );
    assert_eq!(
        policy.tick(614_999, focus.snapshot(), 900_000),
        Decision::Idle
    );
    assert_eq!(
        policy.tick(615_000, focus.snapshot(), 60_001),
        Decision::Reload
    );
}
#[test]
fn loss_and_regain_between_ticks_reset_grace() {
    let focus = MainFocus::new();
    focus.update("main", true);
    let mut policy = WatchdogPolicy::new(0);
    assert_eq!(
        policy.tick(60_000, focus.snapshot(), 900_000),
        Decision::Rebaseline
    );
    let before = focus.snapshot();
    focus.update("main", false);
    focus.update("main", true);
    let after = focus.snapshot();
    assert!(after.focused);
    assert_ne!(before.generation, after.generation);
    assert_eq!(policy.tick(75_000, after, 900_000), Decision::Rebaseline);
    assert_eq!(policy.tick(86_999, after, 900_000), Decision::Idle);
    assert_eq!(policy.tick(87_000, after, 60_001), Decision::Reload);
}
#[test]
fn successful_reload_enforces_exact_two_minute_cooldown() {
    let focus = MainFocus::new();
    focus.update("main", true);
    let mut policy = WatchdogPolicy::new(0);
    assert_eq!(
        policy.tick(60_000, focus.snapshot(), 900_000),
        Decision::Rebaseline
    );
    assert_eq!(
        policy.tick(72_000, focus.snapshot(), 60_001),
        Decision::Reload
    );
    policy.did_reload(72_100);
    assert_eq!(
        policy.tick(84_099, focus.snapshot(), 900_000),
        Decision::Idle
    );
    assert_eq!(
        policy.tick(192_099, focus.snapshot(), 900_000),
        Decision::Idle
    );
    assert_eq!(
        policy.tick(192_100, focus.snapshot(), 60_001),
        Decision::Reload
    );
}
#[test]
fn focus_changes_do_not_erase_reload_cooldown() {
    let focus = MainFocus::new();
    focus.update("main", true);
    let mut policy = WatchdogPolicy::new(0);
    assert_eq!(
        policy.tick(60_000, focus.snapshot(), 900_000),
        Decision::Rebaseline
    );
    policy.did_reload(72_000);
    focus.update("main", false);
    focus.update("main", true);
    assert_eq!(
        policy.tick(90_000, focus.snapshot(), 900_000),
        Decision::Rebaseline
    );
    assert_eq!(
        policy.tick(102_000, focus.snapshot(), 900_000),
        Decision::Idle
    );
    assert_eq!(
        policy.tick(192_000, focus.snapshot(), 60_001),
        Decision::Reload
    );
}
