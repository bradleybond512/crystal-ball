#[path = "../src/notify_policy.rs"]
mod notify_policy;
use notify_policy::*;

#[test]
fn critical_is_delivered_right_after_a_normal_notification() {
    let mut lanes = LaneState::new();
    assert_eq!(lanes.admit(0, Priority::Normal), Admission::Deliver);
    assert_eq!(lanes.admit(1_000, Priority::Critical), Admission::Deliver);
}

#[test]
fn two_criticals_one_second_apart_are_both_delivered() {
    let mut lanes = LaneState::new();
    assert_eq!(lanes.admit(0, Priority::Critical), Admission::Deliver);
    assert_eq!(lanes.admit(1_000, Priority::Critical), Admission::Deliver);
}

#[test]
fn critical_burst_is_capped_then_refills_one_per_period() {
    let mut lanes = LaneState::new();
    for i in 0..CRITICAL_BURST {
        assert_eq!(lanes.admit(u64::from(i), Priority::Critical), Admission::Deliver, "burst #{i}");
    }
    assert_eq!(lanes.admit(100, Priority::Critical), Admission::RateLimited);
    assert_eq!(lanes.admit(CRITICAL_REFILL_MS - 1, Priority::Critical), Admission::RateLimited);
    assert_eq!(lanes.admit(CRITICAL_REFILL_MS, Priority::Critical), Admission::Deliver);
    assert_eq!(lanes.admit(CRITICAL_REFILL_MS + 1, Priority::Critical), Admission::RateLimited);
    assert_eq!(lanes.admit(2 * CRITICAL_REFILL_MS, Priority::Critical), Admission::Deliver);
}

#[test]
fn a_long_quiet_period_refills_to_the_burst_cap_only() {
    let mut lanes = LaneState::new();
    for i in 0..CRITICAL_BURST {
        lanes.admit(u64::from(i), Priority::Critical);
    }
    let later = 1_000 * CRITICAL_REFILL_MS;
    for i in 0..CRITICAL_BURST {
        assert_eq!(lanes.admit(later + u64::from(i), Priority::Critical), Admission::Deliver);
    }
    assert_eq!(lanes.admit(later + 100, Priority::Critical), Admission::RateLimited);
}

#[test]
fn high_is_never_blocked_by_normal_and_keeps_its_own_spacing() {
    let mut lanes = LaneState::new();
    assert_eq!(lanes.admit(0, Priority::Normal), Admission::Deliver);
    assert_eq!(lanes.admit(1, Priority::High), Admission::Deliver);
    assert_eq!(lanes.admit(HIGH_SPACING_MS, Priority::High), Admission::RateLimited);
    assert_eq!(lanes.admit(HIGH_SPACING_MS + 1, Priority::High), Admission::Deliver);
}

#[test]
fn normal_keeps_the_thirty_second_spacing_among_normals_only() {
    let mut lanes = LaneState::new();
    assert_eq!(lanes.admit(0, Priority::Normal), Admission::Deliver);
    assert_eq!(lanes.admit(1_000, Priority::Critical), Admission::Deliver);
    assert_eq!(lanes.admit(1_000, Priority::High), Admission::Deliver);
    assert_eq!(lanes.admit(NORMAL_SPACING_MS - 1, Priority::Normal), Admission::RateLimited);
    assert_eq!(lanes.admit(NORMAL_SPACING_MS, Priority::Normal), Admission::Deliver);
}

#[test]
fn unknown_or_missing_priority_never_escalates() {
    assert_eq!(Priority::parse(None), Priority::Normal);
    assert_eq!(Priority::parse(Some("")), Priority::Normal);
    assert_eq!(Priority::parse(Some("emergency")), Priority::Normal);
    assert_eq!(Priority::parse(Some("CRITICAL")), Priority::Critical);
    assert_eq!(Priority::parse(Some(" high ")), Priority::High);
}
