//! Priority-aware admission for native notifications (R4-BUG-002).
//!
//! Pure policy: callers pass a monotonic millisecond clock, which keeps this
//! unit-testable without sleeping. Each priority owns an independent lane, so
//! a lower-priority notification can never consume the budget of a higher one.
//! The previous design shared one 30 s window across every caller and returned
//! success while dropping, so a routine notification could silently swallow a
//! tornado warning fired seconds later.

pub const CRITICAL_BURST: u32 = 6;
pub const CRITICAL_REFILL_MS: u64 = 10_000;
pub const HIGH_SPACING_MS: u64 = 5_000;
pub const NORMAL_SPACING_MS: u64 = 30_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Priority {
    Critical,
    High,
    Normal,
}

impl Priority {
    /// Missing or unrecognised values map to `Normal`, never to a higher lane.
    pub fn parse(raw: Option<&str>) -> Self {
        match raw.map(str::trim) {
            Some(value) if value.eq_ignore_ascii_case("critical") => Priority::Critical,
            Some(value) if value.eq_ignore_ascii_case("high") => Priority::High,
            _ => Priority::Normal,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Admission {
    Deliver,
    RateLimited,
}

#[derive(Debug, Clone)]
pub struct LaneState {
    critical_tokens: u32,
    critical_refill_anchor: Option<u64>,
    high_last: Option<u64>,
    normal_last: Option<u64>,
}

impl Default for LaneState {
    fn default() -> Self {
        Self::new()
    }
}

impl LaneState {
    pub const fn new() -> Self {
        Self {
            critical_tokens: CRITICAL_BURST,
            critical_refill_anchor: None,
            high_last: None,
            normal_last: None,
        }
    }

    pub fn admit(&mut self, now_ms: u64, priority: Priority) -> Admission {
        match priority {
            Priority::Critical => self.admit_critical(now_ms),
            Priority::High => admit_spaced(&mut self.high_last, now_ms, HIGH_SPACING_MS),
            Priority::Normal => admit_spaced(&mut self.normal_last, now_ms, NORMAL_SPACING_MS),
        }
    }

    fn admit_critical(&mut self, now_ms: u64) -> Admission {
        self.refill_critical(now_ms);
        if self.critical_tokens == 0 {
            return Admission::RateLimited;
        }
        self.critical_tokens -= 1;
        Admission::Deliver
    }

    fn refill_critical(&mut self, now_ms: u64) {
        let Some(anchor) = self.critical_refill_anchor else {
            self.critical_refill_anchor = Some(now_ms);
            return;
        };
        if self.critical_tokens >= CRITICAL_BURST {
            // A full bucket earns nothing; restart the refill clock from now.
            self.critical_refill_anchor = Some(now_ms);
            return;
        }
        let periods = now_ms.saturating_sub(anchor) / CRITICAL_REFILL_MS;
        if periods == 0 {
            return;
        }
        let earned = u32::try_from(periods).unwrap_or(u32::MAX);
        self.critical_tokens = self.critical_tokens.saturating_add(earned).min(CRITICAL_BURST);
        // Advance by whole periods only, keeping any partial period's progress.
        self.critical_refill_anchor = Some(anchor.saturating_add(periods.saturating_mul(CRITICAL_REFILL_MS)));
    }
}

fn admit_spaced(last: &mut Option<u64>, now_ms: u64, spacing_ms: u64) -> Admission {
    if let Some(previous) = *last {
        if now_ms.saturating_sub(previous) < spacing_ms {
            return Admission::RateLimited;
        }
    }
    *last = Some(now_ms);
    Admission::Deliver
}
