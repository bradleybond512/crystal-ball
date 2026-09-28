#[path = "../src/imessage.rs"]
mod imessage;
use imessage::*;
use std::sync::{Arc, Mutex};
use std::time::Instant;

#[derive(Clone)]
struct Fake {
    hooks: Arc<Hooks>,
    store: Arc<Mutex<Snapshot>>,
    sent: Arc<Mutex<Vec<(String, String)>>>,
    prompts: Arc<Mutex<Vec<String>>>,
    allow: bool,
    fail_write: bool,
}
impl Fake {
    fn new(snapshot: Snapshot) -> Self {
        Self {
            hooks: Arc::new(Hooks::default()),
            store: Arc::new(Mutex::new(snapshot)),
            sent: Default::default(),
            prompts: Default::default(),
            allow: true,
            fail_write: false,
        }
    }
}
struct Done(Arc<Hooks>);
impl PendingSend for Done {
    fn wait(self: Box<Self>) -> Result<(), ImessageError> {
        if let Some(hook) = &self.0.wait {
            hook();
        }
        if self.0.wait_error {
            return Err(ImessageError {
                code: "send_uncertain",
            });
        }
        Ok(())
    }
}
#[derive(Default)]
struct Hooks {
    auth_lock: Arc<std::sync::atomic::AtomicBool>,
    prompt_lock: Arc<std::sync::atomic::AtomicBool>,
    proposals: Mutex<Vec<(String, bool)>>,
    confirm: Option<Box<dyn Fn() + Send + Sync>>,
    spawn: Option<Box<dyn Fn() + Send + Sync>>,
    wait: Option<Box<dyn Fn() + Send + Sync>>,
    fail_load: bool,
    fail_enabled_write: bool,
    confirm_error: Option<&'static str>,
    spawn_error: bool,
    wait_error: bool,
}
struct FakeLock(Arc<std::sync::atomic::AtomicBool>);
impl Drop for FakeLock {
    fn drop(&mut self) {
        self.0.store(false, std::sync::atomic::Ordering::SeqCst);
    }
}
impl Effects for Fake {
    fn lock(&self, prompt: bool) -> Result<Box<dyn Send>, ImessageError> {
        let flag = if prompt {
            self.hooks.prompt_lock.clone()
        } else {
            self.hooks.auth_lock.clone()
        };
        if flag.swap(true, std::sync::atomic::Ordering::SeqCst) {
            return Err(ImessageError { code: "busy" });
        }
        Ok(Box::new(FakeLock(flag)))
    }
    fn load(&self) -> Result<Snapshot, ImessageError> {
        if self.hooks.fail_load {
            return Err(ImessageError {
                code: "unavailable",
            });
        }
        Ok(self.store.lock().unwrap().clone())
    }
    fn persist(&self, c: &Config) -> Result<(), ImessageError> {
        if self.fail_write || (c.enabled && self.hooks.fail_enabled_write) {
            return Err(ImessageError {
                code: "persistence_failed",
            });
        }
        *self.store.lock().unwrap() = Snapshot::Valid(c.clone());
        Ok(())
    }
    fn confirm(&self, r: &str, enabled: bool) -> Result<bool, ImessageError> {
        self.prompts.lock().unwrap().push(r.into());
        self.hooks
            .proposals
            .lock()
            .unwrap()
            .push((r.into(), enabled));
        if let Some(hook) = &self.hooks.confirm {
            hook();
        }
        if let Some(code) = self.hooks.confirm_error {
            return Err(ImessageError { code });
        }
        Ok(self.allow)
    }
    fn spawn(&self, r: &str, b: &str) -> Result<Box<dyn PendingSend>, ImessageError> {
        if let Some(hook) = &self.hooks.spawn {
            hook();
        }
        if self.hooks.spawn_error {
            return Err(ImessageError {
                code: "send_failed",
            });
        }
        self.sent.lock().unwrap().push((r.into(), b.into()));
        Ok(Box::new(Done(self.hooks.clone())))
    }
    fn now(&self) -> Instant {
        Instant::now()
    }
}
fn configured(enabled: bool) -> Snapshot {
    Snapshot::Valid(Config {
        version: 1,
        revision: 1,
        enabled,
        recipient: Some("+15551234567".into()),
        migration_attempted: true,
    })
}
#[test]
fn recipient_boundaries() {
    for r in ["+12", "+123456789012345", "User.name+tag@example.com"] {
        assert!(valid_recipient(r), "{r}");
    }
    for r in [
        "+1",
        "+012",
        "+1234567890123456",
        "Bradley",
        "a@localhost",
        "a..b@example.com",
        "a@-example.com",
        "a@exam_ple.com",
        " a@example.com",
        "a@example.com\n",
        "a@example.com,b@example.com",
        "a\\b@example.com",
        "a\"b@example.com",
    ] {
        assert!(!valid_recipient(r), "{r}");
    }
}
#[test]
fn missing_is_disabled_and_migration_available() {
    let f = Fake::new(Snapshot::Missing);
    let s = Service::new(f.clone());
    assert_eq!(
        s.settings().unwrap(),
        ImessageSettings {
            enabled: false,
            recipient: None,
            ready: true,
            migration_available: true
        }
    );
    assert_eq!(s.send("hello".into()).unwrap_err().code, "disabled");
    assert!(f.sent.lock().unwrap().is_empty());
}
#[test]
fn disabled_never_spawns() {
    let f = Fake::new(configured(false));
    let s = Service::new(f.clone());
    assert_eq!(s.send("hello".into()).unwrap_err().code, "disabled");
    assert!(f.sent.lock().unwrap().is_empty());
}
#[test]
fn send_uses_saved_recipient_and_reserves_quota() {
    let f = Fake::new(configured(true));
    let s = Service::new(f.clone());
    s.send("hello".into()).unwrap();
    assert_eq!(
        *f.sent.lock().unwrap(),
        vec![("+15551234567".into(), "hello".into())]
    );
    assert_eq!(s.send("again".into()).unwrap_err().code, "rate_limited");
}
#[test]
fn canceled_migration_stays_disabled_and_consumed() {
    let mut f = Fake::new(Snapshot::Missing);
    f.allow = false;
    let s = Service::new(f.clone());
    assert_eq!(
        s.configure("a@example.com".into(), true).unwrap_err().code,
        "canceled"
    );
    let v = s.settings().unwrap();
    assert!(!v.enabled);
    assert!(!v.migration_available);
    assert_eq!(f.prompts.lock().unwrap().as_slice(), ["a@example.com"]);
}
#[test]
fn approved_config_persists_exact_candidate() {
    let f = Fake::new(Snapshot::Missing);
    let s = Service::new(f.clone());
    let v = s.configure("Case+tag@example.com".into(), true).unwrap();
    assert!(v.enabled);
    assert_eq!(v.recipient.as_deref(), Some("Case+tag@example.com"));
    assert_eq!(
        f.prompts.lock().unwrap().as_slice(),
        ["Case+tag@example.com"]
    );
    s.send("hello".into()).unwrap();
    assert_eq!(f.sent.lock().unwrap()[0].0, "Case+tag@example.com");
}
#[test]
fn failed_migration_persistence_cannot_prompt() {
    let mut f = Fake::new(Snapshot::Missing);
    f.fail_write = true;
    let s = Service::new(f.clone());
    assert_eq!(
        s.configure("a@example.com".into(), true).unwrap_err().code,
        "persistence_failed"
    );
    assert!(f.prompts.lock().unwrap().is_empty());
}
#[test]
fn failed_disable_blocks_process() {
    let mut f = Fake::new(configured(true));
    f.fail_write = true;
    let s = Service::new(f.clone());
    assert_eq!(s.disable().unwrap_err().code, "persistence_failed");
    assert_eq!(s.send("hello".into()).unwrap_err().code, "disabled");
    assert!(!s.settings().unwrap().enabled);
    assert!(f.sent.lock().unwrap().is_empty());
}
#[test]
fn corrupt_requires_confirmation_to_repair() {
    let f = Fake::new(Snapshot::Invalid(b"invalid".to_vec()));
    let s = Service::new(f.clone());
    assert_eq!(s.settings().unwrap_err().code, "unavailable");
    assert_eq!(s.send("hello".into()).unwrap_err().code, "unavailable");
    s.configure("a@example.com".into(), true).unwrap();
    assert_eq!(f.prompts.lock().unwrap().len(), 1);
    assert!(s.settings().unwrap().enabled);
}
#[test]
fn unchanged_enabled_config_skips_prompt() {
    let f = Fake::new(configured(true));
    let s = Service::new(f.clone());
    s.configure("+15551234567".into(), true).unwrap();
    assert!(f.prompts.lock().unwrap().is_empty());
}
#[test]
fn invalid_proposals_never_prompt_or_persist() {
    let f = Fake::new(Snapshot::Missing);
    let s = Service::new(f.clone());
    assert_eq!(
        s.configure("Bradley".into(), true).unwrap_err().code,
        "invalid_recipient"
    );
    assert!(f.prompts.lock().unwrap().is_empty());
    assert_eq!(*f.store.lock().unwrap(), Snapshot::Missing);
}
#[test]
fn disabled_destination_change_has_exact_disabled_consent() {
    let f = Fake::new(configured(false));
    let s = Service::new(f.clone());
    let v = s.configure("a@example.com".into(), false).unwrap();
    assert!(!v.enabled);
    assert_eq!(v.recipient.as_deref(), Some("a@example.com"));
    assert_eq!(
        f.hooks.proposals.lock().unwrap().as_slice(),
        [("a@example.com".into(), false)]
    );
    assert_eq!(s.send("hello".into()).unwrap_err().code, "disabled");
}
#[test]
fn confirmed_write_failure_never_authorizes() {
    let mut f = Fake::new(Snapshot::Missing);
    Arc::get_mut(&mut f.hooks).unwrap().fail_enabled_write = true;
    let s = Service::new(f.clone());
    assert_eq!(
        s.configure("a@example.com".into(), true).unwrap_err().code,
        "persistence_failed"
    );
    assert!(!s.settings().unwrap().enabled);
    assert_eq!(s.send("hello".into()).unwrap_err().code, "disabled");
    assert!(f.sent.lock().unwrap().is_empty());
}
#[test]
fn rejected_dialog_errors_preserve_old_recipient() {
    for code in ["canceled", "unavailable"] {
        let mut f = Fake::new(configured(true));
        Arc::get_mut(&mut f.hooks).unwrap().confirm_error = Some(code);
        let s = Service::new(f.clone());
        assert_eq!(
            s.configure("other@example.com".into(), true)
                .unwrap_err()
                .code,
            code
        );
        assert_eq!(
            s.settings().unwrap().recipient.as_deref(),
            Some("+15551234567")
        );
    }
}
#[test]
fn canceled_corrupt_repair_does_not_import_or_reset() {
    let mut f = Fake::new(Snapshot::Invalid(b"bad".to_vec()));
    f.allow = false;
    let s = Service::new(f.clone());
    assert_eq!(
        s.configure("a@example.com".into(), true).unwrap_err().code,
        "canceled"
    );
    assert_eq!(*f.store.lock().unwrap(), Snapshot::Invalid(b"bad".to_vec()));
    assert_eq!(s.settings().unwrap_err().code, "unavailable");
}
#[test]
fn body_is_bounded_utf8_and_sanitized_before_spawn() {
    let f = Fake::new(configured(true));
    let s = Service::new(f.clone());
    s.send(format!("\"\\\n\r\0{}", "界".repeat(300))).unwrap();
    let sent = f.sent.lock().unwrap();
    assert!(sent[0].1.len() <= 512);
    assert!(sent[0].1.chars().all(|c| c == '界'));
    assert_eq!(sent[0].1.len(), 507);
}
#[test]
fn empty_body_does_not_reserve_quota() {
    let f = Fake::new(configured(true));
    let s = Service::new(f.clone());
    assert_eq!(s.send("\n\"\\".into()).unwrap_err().code, "invalid_body");
    s.send("valid".into()).unwrap();
    assert_eq!(f.sent.lock().unwrap().len(), 1);
}
#[test]
fn failed_spawn_and_uncertain_wait_reserve_quota() {
    for spawn in [true, false] {
        let mut f = Fake::new(configured(true));
        let h = Arc::get_mut(&mut f.hooks).unwrap();
        h.spawn_error = spawn;
        h.wait_error = !spawn;
        let s = Service::new(f.clone());
        assert_eq!(
            s.send("first".into()).unwrap_err().code,
            if spawn {
                "send_failed"
            } else {
                "send_uncertain"
            }
        );
        assert_eq!(s.send("retry".into()).unwrap_err().code, "rate_limited");
    }
}
#[test]
fn unreadable_config_is_not_migration() {
    let mut f = Fake::new(Snapshot::Missing);
    Arc::get_mut(&mut f.hooks).unwrap().fail_load = true;
    let s = Service::new(f.clone());
    assert_eq!(s.settings().unwrap_err().code, "unavailable");
    assert_eq!(
        s.configure("a@example.com".into(), true).unwrap_err().code,
        "unavailable"
    );
    assert_eq!(s.send("body".into()).unwrap_err().code, "unavailable");
    assert!(f.prompts.lock().unwrap().is_empty());
    assert!(f.sent.lock().unwrap().is_empty());
}
#[test]
fn migration_marker_is_durable_before_prompt() {
    let mut f = Fake::new(Snapshot::Missing);
    let store = f.store.clone();
    Arc::get_mut(&mut f.hooks).unwrap().confirm = Some(Box::new(move || {
        assert!(
            matches!(&*store.lock().unwrap(),Snapshot::Valid(c) if c.migration_attempted && !c.enabled && c.recipient.is_none())
        );
    }));
    Service::new(f)
        .configure("a@example.com".into(), true)
        .unwrap();
}
#[test]
fn prompt_cooldown_prevents_repeated_native_dialogs() {
    let mut f = Fake::new(configured(false));
    f.allow = false;
    let s = Service::new(f.clone());
    assert_eq!(
        s.configure("a@example.com".into(), true).unwrap_err().code,
        "canceled"
    );
    assert_eq!(
        s.configure("b@example.com".into(), true).unwrap_err().code,
        "busy"
    );
    assert_eq!(f.prompts.lock().unwrap().len(), 1);
}
#[test]
fn disable_never_prompts_and_preserves_saved_destination() {
    let f = Fake::new(configured(true));
    let s = Service::new(f.clone());
    let v = s.disable().unwrap();
    assert!(!v.enabled);
    assert_eq!(v.recipient.as_deref(), Some("+15551234567"));
    assert!(f.prompts.lock().unwrap().is_empty());
    assert_eq!(s.send("hello".into()).unwrap_err().code, "disabled");
}
#[test]
fn persisted_revision_overflow_fails_closed() {
    let mut c = match configured(true) {
        Snapshot::Valid(c) => c,
        _ => unreachable!(),
    };
    c.revision = u64::MAX;
    let f = Fake::new(Snapshot::Valid(c));
    let s = Service::new(f.clone());
    assert_eq!(
        s.configure("a@example.com".into(), true).unwrap_err().code,
        "unavailable"
    );
    assert_eq!(
        s.settings().unwrap().recipient.as_deref(),
        Some("+15551234567")
    );
}

struct BoundedBarrier {
    state: Mutex<(usize, u64)>,
    changed: std::sync::Condvar,
}
impl BoundedBarrier {
    fn new() -> Self {
        Self {
            state: Mutex::new((0, 0)),
            changed: std::sync::Condvar::new(),
        }
    }
    fn wait(&self) {
        let mut state = self.state.lock().unwrap();
        let generation = state.1;
        state.0 += 1;
        if state.0 == 2 {
            state.0 = 0;
            state.1 += 1;
            self.changed.notify_all();
            return;
        }
        let (state, timeout) = self
            .changed
            .wait_timeout_while(state, std::time::Duration::from_secs(5), |s| {
                s.1 == generation
            })
            .unwrap();
        assert!(
            !timeout.timed_out() || state.1 != generation,
            "authorization ordering barrier was never reached"
        );
    }
}
fn gate() -> (Arc<BoundedBarrier>, Arc<BoundedBarrier>) {
    (
        Arc::new(BoundedBarrier::new()),
        Arc::new(BoundedBarrier::new()),
    )
}
#[test]
fn pending_consent_cannot_override_same_process_disable() {
    let mut f = Fake::new(configured(true));
    let (entered, release) = gate();
    let e = entered.clone();
    let r = release.clone();
    Arc::get_mut(&mut f.hooks).unwrap().confirm = Some(Box::new(move || {
        e.wait();
        r.wait();
    }));
    let s = Arc::new(Service::new(f.clone()));
    let worker = s.clone();
    let task = std::thread::spawn(move || worker.configure("a@example.com".into(), true));
    entered.wait();
    s.disable().unwrap();
    release.wait();
    assert_eq!(task.join().unwrap().unwrap_err().code, "stale_consent");
    assert!(!s.settings().unwrap().enabled);
    assert!(f.sent.lock().unwrap().is_empty());
}
#[test]
fn failed_local_disable_invalidates_pending_consent_generation() {
    let mut f = Fake::new(configured(true));
    f.fail_write = true;
    let (entered, release) = gate();
    let e = entered.clone();
    let r = release.clone();
    Arc::get_mut(&mut f.hooks).unwrap().confirm = Some(Box::new(move || {
        e.wait();
        r.wait();
    }));
    let s = Arc::new(Service::new(f));
    let worker = s.clone();
    let task = std::thread::spawn(move || worker.configure("a@example.com".into(), true));
    entered.wait();
    assert_eq!(s.disable().unwrap_err().code, "persistence_failed");
    release.wait();
    assert_eq!(task.join().unwrap().unwrap_err().code, "stale_consent");
    assert_eq!(s.send("body".into()).unwrap_err().code, "disabled");
}
#[test]
fn second_instance_disable_invalidates_revision_and_reloads_send_authority() {
    let mut f = Fake::new(configured(true));
    let (entered, release) = gate();
    let e = entered.clone();
    let r = release.clone();
    Arc::get_mut(&mut f.hooks).unwrap().confirm = Some(Box::new(move || {
        e.wait();
        r.wait();
    }));
    let a = Arc::new(Service::new(f.clone()));
    let b = Service::new(f.clone());
    let worker = a.clone();
    let task = std::thread::spawn(move || worker.configure("a@example.com".into(), true));
    entered.wait();
    b.disable().unwrap();
    release.wait();
    assert_eq!(task.join().unwrap().unwrap_err().code, "stale_consent");
    assert_eq!(a.send("body".into()).unwrap_err().code, "disabled");
    assert!(f.sent.lock().unwrap().is_empty());
}
#[test]
fn second_instance_prompt_is_busy_while_first_dialog_open() {
    let mut f = Fake::new(configured(false));
    let (entered, release) = gate();
    let e = entered.clone();
    let r = release.clone();
    Arc::get_mut(&mut f.hooks).unwrap().confirm = Some(Box::new(move || {
        e.wait();
        r.wait();
    }));
    let a = Arc::new(Service::new(f.clone()));
    let b = Service::new(f.clone());
    let task = std::thread::spawn(move || a.configure("a@example.com".into(), true));
    entered.wait();
    assert_eq!(
        b.configure("b@example.com".into(), true).unwrap_err().code,
        "busy"
    );
    release.wait();
    task.join().unwrap().unwrap();
    assert_eq!(f.prompts.lock().unwrap().len(), 1);
}
#[test]
fn spawned_send_wait_releases_locks_and_disable_prevents_next_start() {
    let mut f = Fake::new(configured(true));
    let (entered, release) = gate();
    let e = entered.clone();
    let r = release.clone();
    Arc::get_mut(&mut f.hooks).unwrap().wait = Some(Box::new(move || {
        e.wait();
        r.wait();
    }));
    let a = Arc::new(Service::new(f.clone()));
    let b = Service::new(f.clone());
    let worker = a.clone();
    let task = std::thread::spawn(move || worker.send("first".into()));
    entered.wait();
    a.disable().unwrap();
    assert_eq!(b.send("second".into()).unwrap_err().code, "disabled");
    release.wait();
    task.join().unwrap().unwrap();
    assert_eq!(f.sent.lock().unwrap().len(), 1);
}
#[test]
fn spawn_holds_cross_instance_authorization_lock_until_started() {
    let mut f = Fake::new(configured(true));
    let (entered, release) = gate();
    let e = entered.clone();
    let r = release.clone();
    Arc::get_mut(&mut f.hooks).unwrap().spawn = Some(Box::new(move || {
        e.wait();
        r.wait();
    }));
    let a = Arc::new(Service::new(f.clone()));
    let b = Service::new(f.clone());
    let task = std::thread::spawn(move || a.send("first".into()));
    entered.wait();
    assert_eq!(b.disable().unwrap_err().code, "busy");
    release.wait();
    task.join().unwrap().unwrap();
    b.disable().unwrap();
    assert_eq!(b.send("second".into()).unwrap_err().code, "disabled");
    assert_eq!(f.sent.lock().unwrap().len(), 1);
}

struct TempDirectory(std::path::PathBuf);
impl TempDirectory {
    fn new() -> Self {
        static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let p = std::env::temp_dir().join(format!(
            "crystalball-imessage-test-{}-{}",
            std::process::id(),
            N.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        ));
        std::fs::create_dir(&p).unwrap();
        Self(p)
    }
    fn effects(&self) -> NativeEffects {
        NativeEffects::new(self.0.clone())
    }
}
impl Drop for TempDirectory {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.0).unwrap();
    }
}
fn config() -> Config {
    match configured(true) {
        Snapshot::Valid(c) => c,
        _ => unreachable!(),
    }
}
#[cfg(unix)]
fn raw_config(dir: &TempDirectory, bytes: &[u8], mode: u32) {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(mode)
        .open(dir.0.join("imessage.json"))
        .unwrap();
    f.write_all(bytes).unwrap();
}
#[test]
#[cfg(unix)]
fn storage_is_private_atomic_and_leaves_no_temporary_files() {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    let d = TempDirectory::new();
    let e = d.effects();
    assert_eq!(e.load().unwrap(), Snapshot::Missing);
    e.persist(&config()).unwrap();
    let p = d.0.join("imessage.json");
    let original = std::fs::metadata(&p).unwrap();
    assert_eq!(original.permissions().mode() & 0o777, 0o600);
    let mut c = config();
    c.revision = 2;
    c.enabled = false;
    e.persist(&c).unwrap();
    assert_eq!(e.load().unwrap(), Snapshot::Valid(c));
    assert_ne!(std::fs::metadata(p).unwrap().ino(), original.ino());
    assert_eq!(std::fs::read_dir(&d.0).unwrap().count(), 1);
}
#[test]
#[cfg(unix)]
fn strict_schema_never_authorizes_malformed_configuration() {
    for raw in [
        r#"{"version":2,"revision":1,"enabled":true,"recipient":"a@example.com","migrationAttempted":true}"#,
        r#"{"version":1,"revision":-1,"enabled":true,"recipient":"a@example.com","migrationAttempted":true}"#,
        r#"{"version":1,"revision":1,"enabled":true,"recipient":null,"migrationAttempted":true}"#,
        r#"{"version":1,"revision":1,"enabled":true,"recipient":"Bradley","migrationAttempted":true}"#,
        r#"{"version":1,"revision":1,"enabled":true,"recipient":"a@example.com","migrationAttempted":false}"#,
        r#"{"version":1,"revision":1,"enabled":true,"recipient":"a@example.com","migrationAttempted":true,"approved":true}"#,
        r#"{"version":1,"revision":1,"enabled":true,"recipient":"a@example.com"}"#,
    ] {
        let d = TempDirectory::new();
        raw_config(&d, raw.as_bytes(), 0o600);
        assert_eq!(
            d.effects().load().unwrap(),
            Snapshot::Invalid(raw.as_bytes().to_vec())
        );
    }
}
#[test]
#[cfg(unix)]
fn oversized_storage_is_unavailable_without_migration() {
    let d = TempDirectory::new();
    raw_config(&d, &vec![b' '; 4097], 0o600);
    assert_eq!(d.effects().load().unwrap_err().code, "unavailable");
}
#[test]
#[cfg(unix)]
fn permissive_storage_is_not_read_or_overwritten() {
    let d = TempDirectory::new();
    raw_config(&d, b"untrusted", 0o644);
    assert_eq!(d.effects().load().unwrap_err().code, "unavailable");
    assert_eq!(
        d.effects().persist(&config()).unwrap_err().code,
        "persistence_failed"
    );
    assert_eq!(
        std::fs::read(d.0.join("imessage.json")).unwrap(),
        b"untrusted"
    );
}
#[test]
#[cfg(unix)]
fn symlink_storage_is_not_followed_or_overwritten() {
    use std::os::unix::fs::symlink;
    let d = TempDirectory::new();
    let target = d.0.join("target");
    std::fs::write(&target, b"untouched").unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o600)).unwrap();
    symlink(&target, d.0.join("imessage.json")).unwrap();
    assert_eq!(d.effects().load().unwrap_err().code, "unavailable");
    assert_eq!(
        d.effects().persist(&config()).unwrap_err().code,
        "persistence_failed"
    );
    assert_eq!(std::fs::read(target).unwrap(), b"untouched");
}
#[test]
#[cfg(unix)]
fn nonregular_storage_and_config_directory_fail_closed() {
    let d = TempDirectory::new();
    std::fs::create_dir(d.0.join("imessage.json")).unwrap();
    assert_eq!(d.effects().load().unwrap_err().code, "unavailable");
    assert_eq!(
        d.effects().persist(&config()).unwrap_err().code,
        "persistence_failed"
    );
    assert_eq!(std::fs::read_dir(&d.0).unwrap().count(), 1);
}
#[test]
#[cfg(unix)]
fn hardlinked_storage_is_rejected() {
    let d = TempDirectory::new();
    d.effects().persist(&config()).unwrap();
    std::fs::hard_link(d.0.join("imessage.json"), d.0.join("alias")).unwrap();
    assert_eq!(d.effects().load().unwrap_err().code, "unavailable");
}
#[test]
#[cfg(unix)]
fn native_locks_exclude_other_instances_and_release_on_drop() {
    use std::os::unix::fs::PermissionsExt;
    let d = TempDirectory::new();
    let a = d.effects();
    let b = d.effects();
    let prompt = a.lock(true).unwrap();
    assert_eq!(b.lock(true).err().unwrap().code, "busy");
    let auth = a.lock(false).unwrap();
    assert_eq!(
        std::fs::metadata(d.0.join("imessage.lock"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    assert!(b.lock(false).is_err());
    drop(auth);
    assert!(b.lock(false).is_ok());
    drop(prompt);
    assert!(b.lock(true).is_ok());
}
#[test]
#[cfg(unix)]
fn symlink_lock_fails_closed() {
    use std::os::unix::fs::symlink;
    let d = TempDirectory::new();
    let target = d.0.join("target");
    std::fs::write(&target, b"untouched").unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o600)).unwrap();
    symlink(&target, d.0.join("imessage.lock")).unwrap();
    assert_eq!(d.effects().lock(false).err().unwrap().code, "unavailable");
    assert_eq!(std::fs::read(target).unwrap(), b"untouched");
}
#[test]
fn native_consent_accepts_only_exact_successful_allow_output() {
    assert!(consent_result(true, b"Allow\n"));
    for output in [
        b"Cancel\n".as_slice(),
        b"Allow ",
        b"Allow\nextra",
        b"",
        b"true",
    ] {
        assert!(!consent_result(true, output));
    }
    assert!(!consent_result(false, b"Allow\n"));
}
struct FakeClock {
    start: Instant,
    ticks: std::sync::atomic::AtomicU64,
}
impl FakeClock {
    fn new() -> Self {
        Self {
            start: Instant::now(),
            ticks: std::sync::atomic::AtomicU64::new(0),
        }
    }
}
impl WaitClock for FakeClock {
    fn now(&self) -> Instant {
        self.start
            + std::time::Duration::from_secs(self.ticks.load(std::sync::atomic::Ordering::SeqCst))
    }
    fn pause(&self) {
        self.ticks.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    }
}
struct FakeProcess {
    status: Result<Option<bool>, ImessageError>,
    output: Option<Vec<u8>>,
    killed: Arc<std::sync::atomic::AtomicBool>,
}
impl Process for FakeProcess {
    fn poll(&mut self) -> Result<Option<bool>, ImessageError> {
        self.status
    }
    fn output(&mut self) -> Result<Option<Vec<u8>>, ImessageError> {
        Ok(self.output.take())
    }
    fn terminate(&mut self) {
        self.killed.store(true, std::sync::atomic::Ordering::SeqCst);
    }
}
#[test]
fn process_wait_deadlines_kill_and_report_uncertainty_without_retry() {
    for dialog in [true, false] {
        let killed = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let clock = FakeClock::new();
        let child = FakeProcess {
            status: Ok(None),
            output: None,
            killed: killed.clone(),
        };
        let timeout = if dialog { 60 } else { 30 };
        assert_eq!(
            wait_process(
                child,
                std::time::Duration::from_secs(timeout),
                dialog,
                &clock
            )
            .unwrap_err()
            .code,
            if dialog { "canceled" } else { "send_uncertain" }
        );
        assert!(killed.load(std::sync::atomic::Ordering::SeqCst));
        assert_eq!(
            clock.ticks.load(std::sync::atomic::Ordering::SeqCst),
            timeout
        );
    }
}
#[test]
fn process_wait_poll_failure_and_stalled_pipe_are_bounded() {
    for status in [
        Err(ImessageError {
            code: "unavailable",
        }),
        Ok(Some(true)),
    ] {
        let killed = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let child = FakeProcess {
            status,
            output: None,
            killed: killed.clone(),
        };
        assert_eq!(
            wait_process(
                child,
                std::time::Duration::from_secs(30),
                false,
                &FakeClock::new()
            )
            .unwrap_err()
            .code,
            "send_uncertain"
        );
        assert!(killed.load(std::sync::atomic::Ordering::SeqCst));
    }
}
#[test]
fn completed_child_returns_actual_result_without_termination() {
    for success in [true, false] {
        let killed = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let child = FakeProcess {
            status: Ok(Some(success)),
            output: Some(b"Allow\n".to_vec()),
            killed: killed.clone(),
        };
        assert_eq!(
            wait_process(
                child,
                std::time::Duration::from_secs(60),
                true,
                &FakeClock::new()
            )
            .unwrap(),
            (success, b"Allow\n".to_vec())
        );
        assert!(!killed.load(std::sync::atomic::Ordering::SeqCst));
    }
}
#[test]
#[cfg(unix)]
fn failed_partial_write_cleans_only_owned_temp_and_preserves_committed_state() {
    use std::io::Write;
    let d = TempDirectory::new();
    let e = d.effects();
    e.persist(&config()).unwrap();
    let original = std::fs::read(d.0.join("imessage.json")).unwrap();
    let unrelated = d.0.join(".imessage-unrelated.tmp");
    std::fs::write(&unrelated, b"untouched").unwrap();
    assert_eq!(
        e.persist_with(&config(), |file, _| {
            file.write_all(b"partial")?;
            Err(std::io::Error::other("synthetic sync failure"))
        })
        .unwrap_err()
        .code,
        "persistence_failed"
    );
    assert_eq!(std::fs::read(d.0.join("imessage.json")).unwrap(), original);
    assert_eq!(std::fs::read(unrelated).unwrap(), b"untouched");
    assert_eq!(std::fs::read_dir(&d.0).unwrap().count(), 2);
}
#[test]
#[cfg(unix)]
fn failed_atomic_rename_cleans_owned_temp_and_reports_failure() {
    use std::io::Write;
    let d = TempDirectory::new();
    let e = d.effects();
    e.persist(&config()).unwrap();
    let dest = d.0.join("imessage.json");
    assert_eq!(
        e.persist_with(&config(), |file, bytes| {
            file.write_all(bytes)?;
            file.sync_all()?;
            std::fs::remove_file(&dest)?;
            std::fs::create_dir(&dest)
        })
        .unwrap_err()
        .code,
        "persistence_failed"
    );
    assert!(dest.is_dir());
    assert_eq!(std::fs::read_dir(&d.0).unwrap().count(), 1);
}
