//! Restart policy for the local API sidecar (R4-BUG-004).
//!
//! Pure: no I/O, no clock, no process handles. Callers pass monotonic
//! milliseconds and act on the returned [`Decision`]. `main.rs` owns the
//! process; this module only decides *whether* and *when* to restart.
//!
//! Policy:
//! - restart after an unexpected exit with exponential backoff
//!   (1 s, 2 s, 4 s … capped at 60 s);
//! - a run that stayed up for [`STABLE_UPTIME_MS`] resets the backoff;
//! - [`FLAP_LIMIT`] failures inside [`FLAP_WINDOW_MS`] stop restarting until
//!   the user asks for a manual retry (a crash loop must not burn CPU or spam
//!   upstream providers forever);
//! - nothing restarts once shutdown has begun.

use std::collections::VecDeque;

pub const BACKOFF_BASE_MS: u64 = 1_000;
pub const BACKOFF_MAX_MS: u64 = 60_000;
pub const FLAP_WINDOW_MS: u64 = 300_000;
pub const FLAP_LIMIT: usize = 5;
pub const STABLE_UPTIME_MS: u64 = 120_000;

/// Delay before restart attempt `attempt` (0-based): 1 s doubling to 60 s.
pub fn backoff_ms(attempt: u32) -> u64 {
    let factor = 1u64 << attempt.min(16);
    BACKOFF_BASE_MS.saturating_mul(factor).min(BACKOFF_MAX_MS)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    RestartAfter(u64),
    GiveUp,
    /// Shutdown has begun; the caller must not restart.
    Ignore,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PhaseLabel {
    Idle,
    Running,
    Restarting,
    Stopped,
    ShuttingDown,
}

impl PhaseLabel {
    pub fn as_str(self) -> &'static str {
        match self {
            PhaseLabel::Idle => "idle",
            PhaseLabel::Running => "running",
            PhaseLabel::Restarting => "restarting",
            PhaseLabel::Stopped => "stopped",
            PhaseLabel::ShuttingDown => "shutting_down",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExitRecord {
    pub at_ms: u64,
    pub code: Option<i32>,
    pub signal: Option<i32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Snapshot {
    pub phase: PhaseLabel,
    pub restarts: u32,
    pub last_exit: Option<ExitRecord>,
    pub next_retry_in_ms: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Idle,
    Running { since_ms: u64 },
    Restarting { due_ms: u64 },
    Stopped,
    ShuttingDown,
}

#[derive(Debug)]
pub struct SupervisorState {
    phase: Phase,
    failures: VecDeque<u64>,
    attempt: u32,
    starts: u32,
    last_exit: Option<ExitRecord>,
}

impl Default for SupervisorState {
    fn default() -> Self {
        Self::new()
    }
}

impl SupervisorState {
    pub fn new() -> Self {
        Self {
            phase: Phase::Idle,
            failures: VecDeque::new(),
            attempt: 0,
            starts: 0,
            last_exit: None,
        }
    }

    /// A sidecar process was spawned successfully.
    pub fn on_started(&mut self, now_ms: u64) {
        if self.phase == Phase::ShuttingDown {
            return;
        }
        self.starts = self.starts.saturating_add(1);
        self.phase = Phase::Running { since_ms: now_ms };
    }

    /// The sidecar exited without `stop_local_api` asking it to.
    pub fn on_exit(&mut self, now_ms: u64, code: Option<i32>, signal: Option<i32>) -> Decision {
        if self.phase == Phase::ShuttingDown {
            return Decision::Ignore;
        }
        self.last_exit = Some(ExitRecord { at_ms: now_ms, code, signal });
        if let Phase::Running { since_ms } = self.phase {
            if now_ms.saturating_sub(since_ms) >= STABLE_UPTIME_MS {
                self.attempt = 0;
            }
        }
        self.record_failure(now_ms)
    }

    /// A restart attempt could not spawn the sidecar.
    pub fn on_start_failed(&mut self, now_ms: u64) -> Decision {
        if self.phase == Phase::ShuttingDown {
            return Decision::Ignore;
        }
        self.record_failure(now_ms)
    }

    /// User-initiated retry. Only honoured after the supervisor gave up, so a
    /// caller can never use it to kill or churn a running sidecar.
    pub fn on_manual_retry(&mut self, now_ms: u64) -> bool {
        if self.phase != Phase::Stopped {
            return false;
        }
        self.failures.clear();
        self.attempt = 0;
        self.phase = Phase::Restarting { due_ms: now_ms };
        true
    }

    pub fn on_shutdown(&mut self) {
        self.phase = Phase::ShuttingDown;
    }

    pub fn snapshot(&self, now_ms: u64) -> Snapshot {
        let (phase, next_retry_in_ms) = match self.phase {
            Phase::Idle => (PhaseLabel::Idle, None),
            Phase::Running { .. } => (PhaseLabel::Running, None),
            Phase::Restarting { due_ms } => (PhaseLabel::Restarting, Some(due_ms.saturating_sub(now_ms))),
            Phase::Stopped => (PhaseLabel::Stopped, None),
            Phase::ShuttingDown => (PhaseLabel::ShuttingDown, None),
        };
        Snapshot {
            phase,
            restarts: self.starts.saturating_sub(1),
            last_exit: self.last_exit,
            next_retry_in_ms,
        }
    }

    fn record_failure(&mut self, now_ms: u64) -> Decision {
        while let Some(&oldest) = self.failures.front() {
            if now_ms.saturating_sub(oldest) >= FLAP_WINDOW_MS {
                self.failures.pop_front();
            } else {
                break;
            }
        }
        self.failures.push_back(now_ms);
        if self.failures.len() >= FLAP_LIMIT {
            self.phase = Phase::Stopped;
            return Decision::GiveUp;
        }
        let delay = backoff_ms(self.attempt);
        self.attempt = self.attempt.saturating_add(1);
        self.phase = Phase::Restarting { due_ms: now_ms.saturating_add(delay) };
        Decision::RestartAfter(delay)
    }
}

/// True only when a port listener's full command line (`ps -ww -o args=`) is
/// exactly this install's `<node> <local-api-server.mjs>`: an orphan from our
/// own earlier session. Any other listener (another app such as the legacy
/// World Monitor, a dev build, an unrelated tool, a squatter) is not ours and
/// must never be signalled.
pub fn is_own_sidecar_command(args: &str, node_bin: &str, script: &str) -> bool {
    if node_bin.is_empty() || script.is_empty() {
        return false;
    }
    let observed = args.trim_end_matches(['\n', '\r']);
    observed.len() == node_bin.len() + 1 + script.len()
        && observed.starts_with(node_bin)
        && observed.as_bytes()[node_bin.len()] == b' '
        && observed.ends_with(script)
}
