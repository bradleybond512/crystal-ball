use crate::current_location::*;
use tauri::Webview;
#[cfg(target_os = "macos")]
use tauri::Manager;
#[cfg(target_os = "macos")]
use std::sync::{mpsc::{self, SyncSender}, OnceLock};
#[cfg(target_os = "macos")]
use std::sync::atomic::Ordering;
#[cfg(target_os = "macos")]
use std::time::Duration;

#[tauri::command]
pub async fn get_native_location(webview: Webview) -> NativeLocationResponse {
    if !is_main_window(webview.label()) {
        return NativeLocationResponse::failure(NativeLocationErrorCode::Unsupported);
    }

    #[cfg(target_os = "macos")]
    {
        let app = webview.app_handle().clone();
        match tauri::async_runtime::spawn_blocking(move || {
            platform_controller(app).run(Duration::from_millis(LOCATION_DEADLINE_MS))
        })
        .await
        {
            Ok(response) => response,
            Err(_) => NativeLocationResponse::failure(NativeLocationErrorCode::Unavailable),
        }
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
        let ivar = class_getInstanceVariable(cls, c"_rustState".as_ptr().cast::<u8>());
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
        let existing = objc_getClass(c"CrystalBallCurrentLocationDelegate".as_ptr().cast::<u8>());
        if !existing.is_null() {
            let _ = DELEGATE_CLASS.set(existing as usize);
            return Some(existing);
        }
        let superclass = objc_getClass(c"NSObject".as_ptr().cast::<u8>());
        if superclass.is_null() {
            return None;
        }
        let class = objc_allocateClassPair(
            superclass,
            c"CrystalBallCurrentLocationDelegate".as_ptr().cast::<u8>(),
            0,
        );
        if class.is_null() {
            return None;
        }
        let alignment = std::mem::align_of::<*mut c_void>().trailing_zeros() as u8;
        let valid = class_addIvar(
            class,
            c"_rustState".as_ptr().cast::<u8>(),
            std::mem::size_of::<*mut c_void>(),
            alignment,
            c"^v".as_ptr().cast::<u8>(),
        ) != 0
            && class_addMethod(
                class,
                selector(b"locationManager:didUpdateLocations:\0"),
                did_update_locations as *const () as *mut c_void,
                c"v@:@@".as_ptr().cast::<u8>(),
            ) != 0
            && class_addMethod(
                class,
                selector(b"locationManager:didFailWithError:\0"),
                did_fail as *const () as *mut c_void,
                c"v@:@@".as_ptr().cast::<u8>(),
            ) != 0
            && class_addMethod(
                class,
                selector(b"locationManagerDidChangeAuthorization:\0"),
                did_change_authorization as *const () as *mut c_void,
                c"v@:@".as_ptr().cast::<u8>(),
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
        let manager_class = objc_getClass(c"CLLocationManager".as_ptr().cast::<u8>());
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
        let ivar = class_getInstanceVariable(delegate_class, c"_rustState".as_ptr().cast::<u8>());
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
                let ivar = class_getInstanceVariable(class, c"_rustState".as_ptr().cast::<u8>());
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
