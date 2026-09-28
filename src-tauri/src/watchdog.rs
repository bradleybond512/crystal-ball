use std::sync::atomic::{AtomicU64, Ordering};

pub const BOOT_GRACE_MS: u64 = 60_000;
const FOCUS_GRACE_MS: u64 = 12_000;
const HEARTBEAT_STALE_MS: u64 = 60_000;
const RELOAD_COOLDOWN_MS: u64 = 120_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FocusSnapshot {
    pub focused: bool,
    pub generation: u64,
}

pub struct MainFocus {
    state: AtomicU64,
}
impl MainFocus {
    pub const fn new() -> Self {
        Self {
            state: AtomicU64::new(0),
        }
    }
    pub fn update(&self, label: &str, focused: bool) {
        if label != "main" {
            return;
        }
        let _ = self
            .state
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |state| {
                if (state & 1 != 0) == focused {
                    return None;
                }
                // A single snapshot retains a loss/regain between watchdog ticks.
                Some((state.wrapping_add(2) & !1) | u64::from(focused))
            });
    }
    pub fn snapshot(&self) -> FocusSnapshot {
        let state = self.state.load(Ordering::Acquire);
        FocusSnapshot {
            focused: state & 1 != 0,
            generation: state >> 1,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    Idle,
    Rebaseline,
    Reload,
}

pub struct WatchdogPolicy {
    started_ms: u64,
    focus_generation: Option<u64>,
    focused_since_ms: Option<u64>,
    last_reload_ms: Option<u64>,
}
impl WatchdogPolicy {
    pub fn new(started_ms: u64) -> Self {
        Self {
            started_ms,
            focus_generation: None,
            focused_since_ms: None,
            last_reload_ms: None,
        }
    }
    pub fn tick(&mut self, now_ms: u64, focus: FocusSnapshot, heartbeat_age_ms: u64) -> Decision {
        if now_ms.saturating_sub(self.started_ms) < BOOT_GRACE_MS {
            return Decision::Idle;
        }
        if !focus.focused {
            self.focus_generation = Some(focus.generation);
            self.focused_since_ms = None;
            return Decision::Idle;
        }
        if self.focus_generation != Some(focus.generation) || self.focused_since_ms.is_none() {
            self.focus_generation = Some(focus.generation);
            self.focused_since_ms = Some(now_ms);
            return Decision::Rebaseline;
        }
        if now_ms.saturating_sub(self.focused_since_ms.unwrap_or(now_ms)) < FOCUS_GRACE_MS {
            return Decision::Idle;
        }
        if heartbeat_age_ms <= HEARTBEAT_STALE_MS {
            return Decision::Idle;
        }
        if self
            .last_reload_ms
            .is_some_and(|last| now_ms.saturating_sub(last) < RELOAD_COOLDOWN_MS)
        {
            return Decision::Idle;
        }
        Decision::Reload
    }
    pub fn did_reload(&mut self, now_ms: u64) {
        self.last_reload_ms = Some(now_ms);
        self.focused_since_ms = Some(now_ms);
    }
}
