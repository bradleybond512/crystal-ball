use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, SyncSender};
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tauri::{Manager, Webview};

pub const LOCATION_DEADLINE_MS: u64 = 15_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NativeLocationErrorCode {
    Denied,
    Restricted,
    Disabled,
    Timeout,
    Unavailable,
    Busy,
    Unsupported,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeLocationFix {
    latitude: f64,
    longitude: f64,
    horizontal_accuracy_meters: f64,
    observed_at_unix_ms: i64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub struct NativeLocationError {
    code: NativeLocationErrorCode,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(untagged)]
pub enum NativeLocationResponse {
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
    fn success(fix: NativeLocationFix) -> Self {
        Self::Success { ok: true, fix }
    }

    fn failure(code: NativeLocationErrorCode) -> Self {
        Self::Failure {
            ok: false,
            error: NativeLocationError { code },
        }
    }
}

#[derive(Debug)]
enum BackendEvent {
    Fix(NativeLocationFix),
    Failure(NativeLocationErrorCode),
}

trait LocationBackend: Send + Sync {
    type Session: Send;

    fn start(
        &self,
        sender: SyncSender<BackendEvent>,
    ) -> Result<Self::Session, NativeLocationErrorCode>;
    fn cleanup(&self, session: Self::Session) -> bool;
}

struct OneShotController<B> {
    backend: B,
    in_flight: AtomicBool,
}

impl<B: LocationBackend> OneShotController<B> {
    fn new(backend: B) -> Self {
        Self {
            backend,
            in_flight: AtomicBool::new(false),
        }
    }

    fn run(&self, deadline: Duration) -> NativeLocationResponse {
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

struct InFlightGuard<'a> {
    in_flight: &'a AtomicBool,
    clear_on_drop: bool,
}

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

impl Drop for InFlightGuard<'_> {
    fn drop(&mut self) {
        if self.clear_on_drop {
            self.in_flight.store(false, Ordering::Release);
        }
    }
}

fn is_main_window(label: &str) -> bool {
    label == "main"
}

fn valid_native_fix(fix: &NativeLocationFix) -> bool {
    fix.latitude.is_finite()
        && (-90.0..=90.0).contains(&fix.latitude)
        && fix.longitude.is_finite()
        && (-180.0..=180.0).contains(&fix.longitude)
        && fix.horizontal_accuracy_meters.is_finite()
        && fix.horizontal_accuracy_meters >= 0.0
        && fix.observed_at_unix_ms > 0
}

#[tauri::command]
pub async fn get_native_location(webview: Webview) -> NativeLocationResponse {
    if !is_main_window(webview.label()) {
        return NativeLocationResponse::failure(NativeLocationErrorCode::Unsupported);
    }

    #[cfg(target_os = "macos")]
    {
        let app = webview.app_handle().clone();
        return match tauri::async_runtime::spawn_blocking(move || {
            platform_controller(app).run(Duration::from_millis(LOCATION_DEADLINE_MS))
        })
        .await
        {
            Ok(response) => response,
            Err(_) => NativeLocationResponse::failure(NativeLocationErrorCode::Unavailable),
        };
    }

    #[cfg(not(target_os = "macos"))]
    NativeLocationResponse::failure(NativeLocationErrorCode::Unsupported)
}

pub fn cleanup_on_exit() {
    #[cfg(target_os = "macos")]
    unsafe {
        macos::cleanup_all_sessions_on_main_thread();
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicBool, AtomicU64};
    use std::sync::Arc;
    use tauri::AppHandle;

    static NEXT_SESSION_ID: AtomicU64 = AtomicU64::new(1);
    static DELEGATE_CLASS: OnceLock<usize> = OnceLock::new();

    thread_local! {
        static SESSIONS: RefCell<HashMap<u64, NativeSession>> = RefCell::new(HashMap::new());
    }

    struct CallbackState {
        request_id: u64,
        sender: SyncSender<BackendEvent>,
    }

    struct NativeSession {
        manager: *mut c_void,
        delegate: *mut c_void,
        callback_state: *mut CallbackState,
        requested_location: bool,
    }

    pub(super) struct MacBackend {
        app: AppHandle,
    }

    impl MacBackend {
        pub(super) fn new(app: AppHandle) -> Self {
            Self { app }
        }
    }

    impl LocationBackend for MacBackend {
        type Session = u64;

        fn start(
            &self,
            sender: SyncSender<BackendEvent>,
        ) -> Result<Self::Session, NativeLocationErrorCode> {
            let (started_sender, started_receiver) = mpsc::sync_channel(1);
            let cancelled = Arc::new(AtomicBool::new(false));
            let closure_cancelled = Arc::clone(&cancelled);
            self.app
                .run_on_main_thread(move || {
                    if closure_cancelled.load(Ordering::Acquire) {
                        return;
                    }
                    match unsafe { start_session(sender) } {
                        Ok(request_id) => {
                            if started_sender.send(Ok(request_id)).is_err() {
                                unsafe { cleanup_session(request_id) };
                            }
                        }
                        Err(code) => {
                            let _ = started_sender.send(Err(code));
                        }
                    }
                })
                .map_err(|_| NativeLocationErrorCode::Unavailable)?;
            match started_receiver.recv_timeout(Duration::from_secs(1)) {
                Ok(result) => result,
                Err(_) => {
                    cancelled.store(true, Ordering::Release);
                    Err(NativeLocationErrorCode::Unavailable)
                }
            }
        }

        fn cleanup(&self, request_id: Self::Session) -> bool {
            let (done_sender, done_receiver) = mpsc::sync_channel(1);
            if self
                .app
                .run_on_main_thread(move || {
                    unsafe { cleanup_session(request_id) };
                    let _ = done_sender.send(());
                })
                .is_err()
            {
                return false;
            }
            done_receiver.recv_timeout(Duration::from_secs(1)).is_ok()
        }
    }

    extern "C" {
        fn objc_getClass(name: *const u8) -> *mut c_void;
        fn objc_allocateClassPair(
            superclass: *mut c_void,
            name: *const u8,
            extra_bytes: usize,
        ) -> *mut c_void;
        fn objc_registerClassPair(cls: *mut c_void);
        fn objc_disposeClassPair(cls: *mut c_void);
        fn class_addIvar(
            cls: *mut c_void,
            name: *const u8,
            size: usize,
            alignment: u8,
            types: *const u8,
        ) -> i8;
        fn class_addMethod(
            cls: *mut c_void,
            name: *mut c_void,
            implementation: *mut c_void,
            types: *const u8,
        ) -> i8;
        fn class_getInstanceVariable(cls: *mut c_void, name: *const u8) -> *mut c_void;
        fn object_getIvar(object: *mut c_void, ivar: *mut c_void) -> *mut c_void;
        fn object_setIvar(object: *mut c_void, ivar: *mut c_void, value: *mut c_void);
        fn sel_registerName(name: *const u8) -> *mut c_void;
        fn objc_msgSend(receiver: *mut c_void, selector: *mut c_void, ...) -> *mut c_void;
        fn objc_release(object: *mut c_void);
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CLLocationCoordinate2D {
        latitude: f64,
        longitude: f64,
    }

    unsafe fn selector(name: &'static [u8]) -> *mut c_void {
        sel_registerName(name.as_ptr())
    }

    unsafe fn send_no_args(receiver: *mut c_void, name: &'static [u8]) -> *mut c_void {
        objc_msgSend(receiver, selector(name))
    }

    unsafe fn send_object(receiver: *mut c_void, name: &'static [u8], argument: *mut c_void) {
        let function: unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_void) =
            std::mem::transmute(objc_msgSend as *const ());
        function(receiver, selector(name), argument);
    }

    unsafe fn authorization_status(manager: *mut c_void) -> i32 {
        let function: unsafe extern "C" fn(*mut c_void, *mut c_void) -> i32 =
            std::mem::transmute(objc_msgSend as *const ());
        function(manager, selector(b"authorizationStatus\0"))
    }

    unsafe fn callback_state(delegate: *mut c_void) -> Option<&'static CallbackState> {
        let cls = delegate_class()?;
        let ivar = class_getInstanceVariable(cls, b"_rustState\0".as_ptr());
        if ivar.is_null() {
            return None;
        }
        let state = object_getIvar(delegate, ivar).cast::<CallbackState>();
        state.as_ref()
    }

    unsafe extern "C" fn did_update_locations(
        delegate: *mut c_void,
        _selector: *mut c_void,
        _manager: *mut c_void,
        locations: *mut c_void,
    ) {
        let _ = std::panic::catch_unwind(|| unsafe {
            let Some(state) = callback_state(delegate) else {
                return;
            };
            let location = send_no_args(locations, b"lastObject\0");
            if location.is_null() {
                let _ = state
                    .sender
                    .try_send(BackendEvent::Failure(NativeLocationErrorCode::Unavailable));
                return;
            }
            let coordinate_function: unsafe extern "C" fn(
                *mut c_void,
                *mut c_void,
            ) -> CLLocationCoordinate2D = std::mem::transmute(objc_msgSend as *const ());
            let double_function: unsafe extern "C" fn(*mut c_void, *mut c_void) -> f64 =
                std::mem::transmute(objc_msgSend as *const ());
            let coordinate = coordinate_function(location, selector(b"coordinate\0"));
            let accuracy = double_function(location, selector(b"horizontalAccuracy\0"));
            let timestamp = send_no_args(location, b"timestamp\0");
            if timestamp.is_null() {
                let _ = state
                    .sender
                    .try_send(BackendEvent::Failure(NativeLocationErrorCode::Unavailable));
                return;
            }
            let seconds = double_function(timestamp, selector(b"timeIntervalSince1970\0"));
            let milliseconds = seconds * 1_000.0;
            if !milliseconds.is_finite() || milliseconds <= 0.0 || milliseconds > i64::MAX as f64 {
                let _ = state
                    .sender
                    .try_send(BackendEvent::Failure(NativeLocationErrorCode::Unavailable));
                return;
            }
            let _ = state.sender.try_send(BackendEvent::Fix(NativeLocationFix {
                latitude: coordinate.latitude,
                longitude: coordinate.longitude,
                horizontal_accuracy_meters: accuracy,
                observed_at_unix_ms: milliseconds.round() as i64,
            }));
        });
    }

    unsafe extern "C" fn did_fail(
        delegate: *mut c_void,
        _selector: *mut c_void,
        manager: *mut c_void,
        error: *mut c_void,
    ) {
        let _ = std::panic::catch_unwind(|| unsafe {
            let Some(state) = callback_state(delegate) else {
                return;
            };
            let integer_function: unsafe extern "C" fn(*mut c_void, *mut c_void) -> isize =
                std::mem::transmute(objc_msgSend as *const ());
            let code = if error.is_null() {
                0
            } else {
                integer_function(error, selector(b"code\0"))
            };
            let mapped = if code == 1 {
                match authorization_status(manager) {
                    1 => NativeLocationErrorCode::Restricted,
                    2 => NativeLocationErrorCode::Denied,
                    _ => NativeLocationErrorCode::Unavailable,
                }
            } else {
                NativeLocationErrorCode::Unavailable
            };
            let _ = state.sender.try_send(BackendEvent::Failure(mapped));
        });
    }

    unsafe extern "C" fn did_change_authorization(
        delegate: *mut c_void,
        _selector: *mut c_void,
        manager: *mut c_void,
    ) {
        let _ = std::panic::catch_unwind(|| unsafe {
            let Some(state) = callback_state(delegate) else {
                return;
            };
            handle_authorization(state.request_id, manager, authorization_status(manager));
        });
    }

    unsafe fn delegate_class() -> Option<*mut c_void> {
        if let Some(class) = DELEGATE_CLASS.get() {
            return Some(*class as *mut c_void);
        }
        let existing = objc_getClass(b"CrystalBallCurrentLocationDelegate\0".as_ptr());
        if !existing.is_null() {
            let _ = DELEGATE_CLASS.set(existing as usize);
            return Some(existing);
        }
        let superclass = objc_getClass(b"NSObject\0".as_ptr());
        if superclass.is_null() {
            return None;
        }
        let class = objc_allocateClassPair(
            superclass,
            b"CrystalBallCurrentLocationDelegate\0".as_ptr(),
            0,
        );
        if class.is_null() {
            return None;
        }
        let alignment = std::mem::align_of::<*mut c_void>().trailing_zeros() as u8;
        let valid = class_addIvar(
            class,
            b"_rustState\0".as_ptr(),
            std::mem::size_of::<*mut c_void>(),
            alignment,
            b"^v\0".as_ptr(),
        ) != 0
            && class_addMethod(
                class,
                selector(b"locationManager:didUpdateLocations:\0"),
                did_update_locations as *const () as *mut c_void,
                b"v@:@@\0".as_ptr(),
            ) != 0
            && class_addMethod(
                class,
                selector(b"locationManager:didFailWithError:\0"),
                did_fail as *const () as *mut c_void,
                b"v@:@@\0".as_ptr(),
            ) != 0
            && class_addMethod(
                class,
                selector(b"locationManagerDidChangeAuthorization:\0"),
                did_change_authorization as *const () as *mut c_void,
                b"v@:@\0".as_ptr(),
            ) != 0;
        if !valid {
            objc_disposeClassPair(class);
            return None;
        }
        objc_registerClassPair(class);
        let _ = DELEGATE_CLASS.set(class as usize);
        Some(class)
    }

    unsafe fn handle_authorization(request_id: u64, manager: *mut c_void, status: i32) {
        match status {
            0 => {}
            1 | 2 => {
                SESSIONS.with(|sessions| {
                    if let Some(session) = sessions.borrow().get(&request_id) {
                        let code = if status == 1 {
                            NativeLocationErrorCode::Restricted
                        } else {
                            NativeLocationErrorCode::Denied
                        };
                        let _ = (*session.callback_state)
                            .sender
                            .try_send(BackendEvent::Failure(code));
                    }
                });
            }
            3 | 4 => {
                SESSIONS.with(|sessions| {
                    let mut sessions = sessions.borrow_mut();
                    if let Some(session) = sessions.get_mut(&request_id) {
                        if !session.requested_location {
                            session.requested_location = true;
                            let _ = send_no_args(manager, b"requestLocation\0");
                        }
                    }
                });
            }
            _ => {
                SESSIONS.with(|sessions| {
                    if let Some(session) = sessions.borrow().get(&request_id) {
                        let _ = (*session.callback_state)
                            .sender
                            .try_send(BackendEvent::Failure(NativeLocationErrorCode::Unavailable));
                    }
                });
            }
        }
    }

    unsafe fn start_session(
        sender: SyncSender<BackendEvent>,
    ) -> Result<u64, NativeLocationErrorCode> {
        let manager_class = objc_getClass(b"CLLocationManager\0".as_ptr());
        let delegate_class = delegate_class().ok_or(NativeLocationErrorCode::Unavailable)?;
        if manager_class.is_null() {
            return Err(NativeLocationErrorCode::Unsupported);
        }
        let bool_function: unsafe extern "C" fn(*mut c_void, *mut c_void) -> i8 =
            std::mem::transmute(objc_msgSend as *const ());
        if bool_function(manager_class, selector(b"locationServicesEnabled\0")) == 0 {
            return Err(NativeLocationErrorCode::Disabled);
        }
        let manager = send_no_args(send_no_args(manager_class, b"alloc\0"), b"init\0");
        let delegate = send_no_args(send_no_args(delegate_class, b"alloc\0"), b"init\0");
        if manager.is_null() || delegate.is_null() {
            if !manager.is_null() {
                objc_release(manager);
            }
            if !delegate.is_null() {
                objc_release(delegate);
            }
            return Err(NativeLocationErrorCode::Unavailable);
        }

        let request_id = NEXT_SESSION_ID.fetch_add(1, Ordering::Relaxed);
        let state = Box::into_raw(Box::new(CallbackState { request_id, sender }));
        let ivar = class_getInstanceVariable(delegate_class, b"_rustState\0".as_ptr());
        if ivar.is_null() {
            drop(Box::from_raw(state));
            objc_release(manager);
            objc_release(delegate);
            return Err(NativeLocationErrorCode::Unavailable);
        }
        object_setIvar(delegate, ivar, state.cast());
        send_object(manager, b"setDelegate:\0", delegate);
        SESSIONS.with(|sessions| {
            sessions.borrow_mut().insert(
                request_id,
                NativeSession {
                    manager,
                    delegate,
                    callback_state: state,
                    requested_location: false,
                },
            );
        });

        let status = authorization_status(manager);
        if status == 0 {
            let _ = send_no_args(manager, b"requestWhenInUseAuthorization\0");
        } else {
            handle_authorization(request_id, manager, status);
        }
        Ok(request_id)
    }

    unsafe fn cleanup_session(request_id: u64) {
        SESSIONS.with(|sessions| {
            let Some(session) = sessions.borrow_mut().remove(&request_id) else {
                return;
            };
            send_object(session.manager, b"setDelegate:\0", std::ptr::null_mut());
            if let Some(class) = delegate_class() {
                let ivar = class_getInstanceVariable(class, b"_rustState\0".as_ptr());
                if !ivar.is_null() {
                    object_setIvar(session.delegate, ivar, std::ptr::null_mut());
                }
            }
            drop(Box::from_raw(session.callback_state));
            objc_release(session.manager);
            objc_release(session.delegate);
        });
    }

    unsafe fn cleanup_all_sessions() {
        let ids = SESSIONS.with(|sessions| sessions.borrow().keys().copied().collect::<Vec<_>>());
        for request_id in ids {
            SESSIONS.with(|sessions| {
                if let Some(session) = sessions.borrow().get(&request_id) {
                    let _ = (*session.callback_state)
                        .sender
                        .try_send(BackendEvent::Failure(NativeLocationErrorCode::Unavailable));
                }
            });
            cleanup_session(request_id);
        }
    }

    pub(super) unsafe fn cleanup_all_sessions_on_main_thread() {
        cleanup_all_sessions();
    }
}

#[cfg(target_os = "macos")]
use macos::MacBackend;

#[cfg(target_os = "macos")]
static PLATFORM_CONTROLLER: OnceLock<OneShotController<MacBackend>> = OnceLock::new();

#[cfg(target_os = "macos")]
fn platform_controller(app: tauri::AppHandle) -> &'static OneShotController<MacBackend> {
    PLATFORM_CONTROLLER.get_or_init(|| OneShotController::new(MacBackend::new(app)))
}

#[cfg(test)]
mod tests {
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
