use serde::Serialize;
#[cfg(any(target_os = "macos", test))]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(any(target_os = "macos", test))]
use std::sync::mpsc::{self, RecvTimeoutError, SyncSender};
#[cfg(any(target_os = "macos", test))]
use std::time::{Duration, Instant};

#[cfg(any(target_os = "macos", test))]
pub const LOCATION_DEADLINE_MS: u64 = 15_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NativeLocationErrorCode {
    #[cfg(any(target_os = "macos", test))]
    Denied,
    #[cfg(any(target_os = "macos", test))]
    Restricted,
    #[cfg(any(target_os = "macos", test))]
    Disabled,
    #[cfg(any(target_os = "macos", test))]
    Timeout,
    #[cfg(any(target_os = "macos", test))]
    Unavailable,
    #[cfg(any(target_os = "macos", test))]
    Busy,
    Unsupported,
}

#[cfg(any(target_os = "macos", test))]
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeLocationFix {
    pub(super) latitude: f64,
    pub(super) longitude: f64,
    pub(super) horizontal_accuracy_meters: f64,
    pub(super) observed_at_unix_ms: i64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub struct NativeLocationError {
    code: NativeLocationErrorCode,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(untagged)]
pub enum NativeLocationResponse {
    #[cfg(any(target_os = "macos", test))]
    Success {
        ok: bool,
        fix: NativeLocationFix,
    },
    Failure {
        ok: bool,
        error: NativeLocationError,
    },
}

impl NativeLocationResponse {
    #[cfg(any(target_os = "macos", test))]
    pub(super) fn success(fix: NativeLocationFix) -> Self {
        Self::Success { ok: true, fix }
    }

    pub(super) fn failure(code: NativeLocationErrorCode) -> Self {
        Self::Failure {
            ok: false,
            error: NativeLocationError { code },
        }
    }
}

#[cfg(any(target_os = "macos", test))]
#[derive(Debug)]
pub(super) enum BackendEvent {
    Fix(NativeLocationFix),
    Failure(NativeLocationErrorCode),
}

#[cfg(any(target_os = "macos", test))]
pub(super) trait LocationBackend: Send + Sync {
    type Session: Send;

    fn start(
        &self,
        sender: SyncSender<BackendEvent>,
    ) -> Result<Self::Session, NativeLocationErrorCode>;
    fn cleanup(&self, session: Self::Session) -> bool;
}

#[cfg(any(target_os = "macos", test))]
pub(super) struct OneShotController<B> {
    backend: B,
    in_flight: AtomicBool,
}

#[cfg(any(target_os = "macos", test))]
impl<B: LocationBackend> OneShotController<B> {
    pub(super) fn new(backend: B) -> Self {
        Self {
            backend,
            in_flight: AtomicBool::new(false),
        }
    }

    pub(super) fn run(&self, deadline: Duration) -> NativeLocationResponse {
        if self
            .in_flight
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return NativeLocationResponse::failure(NativeLocationErrorCode::Busy);
        }
        let mut in_flight = InFlightGuard::new(&self.in_flight);
        let started_at = Instant::now();
        let (sender, receiver) = mpsc::sync_channel(1);
        let session = match self.backend.start(sender) {
            Ok(session) => session,
            Err(code) => return NativeLocationResponse::failure(code),
        };
        let remaining = deadline.saturating_sub(started_at.elapsed());
        let event = receiver.recv_timeout(remaining);
        if !self.backend.cleanup(session) {
            in_flight.keep_busy();
            return NativeLocationResponse::failure(NativeLocationErrorCode::Unavailable);
        }
        match event {
            Ok(BackendEvent::Fix(fix)) if valid_native_fix(&fix) => {
                NativeLocationResponse::success(fix)
            }
            Ok(BackendEvent::Fix(_)) => {
                NativeLocationResponse::failure(NativeLocationErrorCode::Unavailable)
            }
            Ok(BackendEvent::Failure(code)) => NativeLocationResponse::failure(code),
            Err(RecvTimeoutError::Timeout) => {
                NativeLocationResponse::failure(NativeLocationErrorCode::Timeout)
            }
            Err(RecvTimeoutError::Disconnected) => {
                NativeLocationResponse::failure(NativeLocationErrorCode::Unavailable)
            }
        }
    }
}

#[cfg(any(target_os = "macos", test))]
struct InFlightGuard<'a> {
    in_flight: &'a AtomicBool,
    clear_on_drop: bool,
}

#[cfg(any(target_os = "macos", test))]
impl<'a> InFlightGuard<'a> {
    fn new(in_flight: &'a AtomicBool) -> Self {
        Self {
            in_flight,
            clear_on_drop: true,
        }
    }

    fn keep_busy(&mut self) {
        self.clear_on_drop = false;
    }
}

#[cfg(any(target_os = "macos", test))]
impl Drop for InFlightGuard<'_> {
    fn drop(&mut self) {
        if self.clear_on_drop {
            self.in_flight.store(false, Ordering::Release);
        }
    }
}

pub(super) fn is_main_window(label: &str) -> bool {
    label == "main"
}

#[cfg(any(target_os = "macos", test))]
fn valid_native_fix(fix: &NativeLocationFix) -> bool {
    fix.latitude.is_finite()
        && (-90.0..=90.0).contains(&fix.latitude)
        && fix.longitude.is_finite()
        && (-180.0..=180.0).contains(&fix.longitude)
        && fix.horizontal_accuracy_meters.is_finite()
        && fix.horizontal_accuracy_meters >= 0.0
        && fix.observed_at_unix_ms > 0
}

#[cfg(test)]
mod tests {
    #[test]
    fn native_error_serialization_preserves_wire_values() {
        use super::NativeLocationErrorCode::*;
        for (code, expected) in [(Denied, "denied"), (Restricted, "restricted"), (Disabled, "disabled"), (Timeout, "timeout"), (Unavailable, "unavailable"), (Busy, "busy"), (Unsupported, "unsupported")] {
            assert_eq!(serde_json::to_value(code).unwrap(), serde_json::json!(expected));
        }
    }

    use super::*;
    use std::collections::HashMap;
    use std::sync::{Arc, Condvar, Mutex};
    use std::thread;
    use std::time::Duration;

    #[derive(Clone, Default)]
    struct FakeBackend {
        inner: Arc<(Mutex<FakeState>, Condvar)>,
    }

    #[derive(Default)]
    struct FakeState {
        next_id: u64,
        senders: HashMap<u64, std::sync::mpsc::SyncSender<BackendEvent>>,
        cleanup_counts: HashMap<u64, usize>,
        cleanup_blocked: bool,
    }

    impl FakeBackend {
        fn wait_for_session(&self) -> u64 {
            let (lock, ready) = &*self.inner;
            let mut state = lock.lock().unwrap();
            while state.senders.is_empty() {
                state = ready.wait(state).unwrap();
            }
            *state.senders.keys().next().unwrap()
        }

        fn send(&self, id: u64, event: BackendEvent) -> bool {
            let state = self.inner.0.lock().unwrap();
            state
                .senders
                .get(&id)
                .is_some_and(|sender| sender.try_send(event).is_ok())
        }

        fn cleanup_count(&self, id: u64) -> usize {
            self.inner
                .0
                .lock()
                .unwrap()
                .cleanup_counts
                .get(&id)
                .copied()
                .unwrap_or(0)
        }

        fn block_cleanup(&self) {
            self.inner.0.lock().unwrap().cleanup_blocked = true;
        }
    }

    impl LocationBackend for FakeBackend {
        type Session = u64;

        fn start(
            &self,
            sender: std::sync::mpsc::SyncSender<BackendEvent>,
        ) -> Result<Self::Session, NativeLocationErrorCode> {
            let (lock, ready) = &*self.inner;
            let mut state = lock.lock().unwrap();
            state.next_id += 1;
            let id = state.next_id;
            state.senders.insert(id, sender);
            ready.notify_all();
            Ok(id)
        }

        fn cleanup(&self, session: Self::Session) -> bool {
            let mut state = self.inner.0.lock().unwrap();
            if state.cleanup_blocked {
                return false;
            }
            if state.senders.remove(&session).is_some() {
                *state.cleanup_counts.entry(session).or_default() += 1;
            }
            true
        }
    }

    impl FakeBackend {
        fn cleanup_on_exit(&self) {
            let mut state = self.inner.0.lock().unwrap();
            let sessions: Vec<_> = state.senders.drain().collect();
            for (id, sender) in sessions {
                let _ =
                    sender.try_send(BackendEvent::Failure(NativeLocationErrorCode::Unavailable));
                *state.cleanup_counts.entry(id).or_default() += 1;
            }
        }
    }

    #[test]
    fn only_the_main_window_is_allowed() {
        assert!(is_main_window("main"));
        for label in ["settings", "live-channels", "youtube-login", "*"] {
            assert!(!is_main_window(label));
        }
    }

    #[test]
    fn native_envelopes_are_exact_and_camel_case() {
        let success = NativeLocationResponse::success(NativeLocationFix {
            latitude: 0.0,
            longitude: 0.0,
            horizontal_accuracy_meters: 25.0,
            observed_at_unix_ms: 1_777_777_777_000,
        });
        assert_eq!(
            serde_json::to_value(success).unwrap(),
            serde_json::json!({
                "ok": true,
                "fix": {
                    "latitude": 0.0,
                    "longitude": 0.0,
                    "horizontalAccuracyMeters": 25.0,
                    "observedAtUnixMs": 1_777_777_777_000_i64,
                },
            }),
        );

        let failure = NativeLocationResponse::failure(NativeLocationErrorCode::Busy);
        assert_eq!(
            serde_json::to_value(failure).unwrap(),
            serde_json::json!({ "ok": false, "error": { "code": "busy" } }),
        );
    }

    #[test]
    fn native_fix_validation_accepts_zero_and_rejects_invalid_values() {
        assert!(valid_native_fix(&NativeLocationFix {
            latitude: 0.0,
            longitude: 0.0,
            horizontal_accuracy_meters: 0.0,
            observed_at_unix_ms: 1,
        }));
        for fix in [
            NativeLocationFix {
                latitude: f64::NAN,
                longitude: 0.0,
                horizontal_accuracy_meters: 1.0,
                observed_at_unix_ms: 1,
            },
            NativeLocationFix {
                latitude: 91.0,
                longitude: 0.0,
                horizontal_accuracy_meters: 1.0,
                observed_at_unix_ms: 1,
            },
            NativeLocationFix {
                latitude: 0.0,
                longitude: 181.0,
                horizontal_accuracy_meters: 1.0,
                observed_at_unix_ms: 1,
            },
            NativeLocationFix {
                latitude: 0.0,
                longitude: 0.0,
                horizontal_accuracy_meters: -1.0,
                observed_at_unix_ms: 1,
            },
            NativeLocationFix {
                latitude: 0.0,
                longitude: 0.0,
                horizontal_accuracy_meters: 1.0,
                observed_at_unix_ms: 0,
            },
        ] {
            assert!(!valid_native_fix(&fix));
        }
    }

    #[test]
    fn the_native_deadline_is_exactly_fifteen_seconds() {
        assert_eq!(LOCATION_DEADLINE_MS, 15_000);
    }

    #[test]
    fn lifecycle_cleans_up_exactly_once_on_success() {
        let backend = FakeBackend::default();
        let controller = Arc::new(OneShotController::new(backend.clone()));
        let runner = Arc::clone(&controller);
        let handle = thread::spawn(move || runner.run(Duration::from_secs(1)));
        let id = backend.wait_for_session();
        assert!(backend.send(
            id,
            BackendEvent::Fix(NativeLocationFix {
                latitude: 0.0,
                longitude: 0.0,
                horizontal_accuracy_meters: 5.0,
                observed_at_unix_ms: 1,
            })
        ));

        assert!(matches!(
            handle.join().unwrap(),
            NativeLocationResponse::Success { .. }
        ));
        assert_eq!(backend.cleanup_count(id), 1);
    }

    #[test]
    fn timeout_cleans_up_and_ignores_a_late_callback() {
        let backend = FakeBackend::default();
        let controller = OneShotController::new(backend.clone());

        assert!(matches!(
            controller.run(Duration::from_millis(1)),
            NativeLocationResponse::Failure {
                error: NativeLocationError {
                    code: NativeLocationErrorCode::Timeout
                },
                ..
            }
        ));
        let id = 1;
        assert_eq!(backend.cleanup_count(id), 1);
        assert!(!backend.send(
            id,
            BackendEvent::Failure(NativeLocationErrorCode::Unavailable)
        ));
        assert_eq!(backend.cleanup_count(id), 1);
    }

    #[test]
    fn concurrent_attempts_fail_busy_without_starting_a_second_session() {
        let backend = FakeBackend::default();
        let controller = Arc::new(OneShotController::new(backend.clone()));
        let runner = Arc::clone(&controller);
        let handle = thread::spawn(move || runner.run(Duration::from_secs(1)));
        let id = backend.wait_for_session();

        assert!(matches!(
            controller.run(Duration::from_millis(1)),
            NativeLocationResponse::Failure {
                error: NativeLocationError {
                    code: NativeLocationErrorCode::Busy
                },
                ..
            }
        ));
        assert_eq!(backend.inner.0.lock().unwrap().next_id, 1);
        assert!(backend.send(id, BackendEvent::Failure(NativeLocationErrorCode::Denied)));
        let _ = handle.join().unwrap();
        assert_eq!(backend.cleanup_count(id), 1);
    }

    #[test]
    fn unconfirmed_cleanup_keeps_the_controller_fail_closed() {
        let backend = FakeBackend::default();
        backend.block_cleanup();
        let controller = Arc::new(OneShotController::new(backend.clone()));
        let runner = Arc::clone(&controller);
        let handle = thread::spawn(move || runner.run(Duration::from_secs(1)));
        let id = backend.wait_for_session();
        assert!(backend.send(id, BackendEvent::Failure(NativeLocationErrorCode::Denied)));
        assert!(matches!(
            handle.join().unwrap(),
            NativeLocationResponse::Failure {
                error: NativeLocationError {
                    code: NativeLocationErrorCode::Unavailable
                },
                ..
            }
        ));

        assert!(matches!(
            controller.run(Duration::ZERO),
            NativeLocationResponse::Failure {
                error: NativeLocationError {
                    code: NativeLocationErrorCode::Busy
                },
                ..
            }
        ));
        assert_eq!(backend.inner.0.lock().unwrap().next_id, 1);
    }

    #[test]
    fn app_exit_cleanup_wakes_the_request_and_remains_idempotent() {
        let backend = FakeBackend::default();
        let controller = Arc::new(OneShotController::new(backend.clone()));
        let runner = Arc::clone(&controller);
        let handle = thread::spawn(move || runner.run(Duration::from_secs(1)));
        let id = backend.wait_for_session();

        backend.cleanup_on_exit();
        backend.cleanup_on_exit();
        assert!(matches!(
            handle.join().unwrap(),
            NativeLocationResponse::Failure {
                error: NativeLocationError {
                    code: NativeLocationErrorCode::Unavailable
                },
                ..
            }
        ));
        assert_eq!(backend.cleanup_count(id), 1);
    }
}
