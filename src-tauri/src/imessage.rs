use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Instant;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ImessageError {
    pub code: &'static str,
}
fn error(code: &'static str) -> ImessageError {
    ImessageError { code }
}
type Result<T> = std::result::Result<T, ImessageError>;
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImessageSettings {
    pub enabled: bool,
    pub recipient: Option<String>,
    pub ready: bool,
    pub migration_available: bool,
}
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Config {
    pub version: u8,
    pub revision: u64,
    pub enabled: bool,
    pub recipient: Option<String>,
    pub migration_attempted: bool,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Snapshot {
    Missing,
    Valid(Config),
    Invalid(Vec<u8>),
}
pub trait PendingSend: Send {
    fn wait(self: Box<Self>) -> Result<()>;
}
pub trait Effects: Send + Sync {
    fn lock(&self, prompt: bool) -> Result<Box<dyn Send>>;
    fn load(&self) -> Result<Snapshot>;
    fn persist(&self, config: &Config) -> Result<()>;
    fn confirm(&self, recipient: &str, enabled: bool) -> Result<bool>;
    fn spawn(&self, recipient: &str, body: &str) -> Result<Box<dyn PendingSend>>;
    fn now(&self) -> Instant;
}
#[derive(Default)]
struct State {
    blocked: bool,
    generation: u64,
    last_send: Option<Instant>,
    last_prompt: Option<Instant>,
}
pub struct Service<E: Effects> {
    effects: E,
    state: Mutex<State>,
}
impl<E: Effects> Service<E> {
    pub fn new(effects: E) -> Self {
        Self {
            effects,
            state: Mutex::new(State::default()),
        }
    }
    pub fn settings(&self) -> Result<ImessageSettings> {
        let state = self.state.lock().map_err(|_| error("unavailable"))?;
        let _lock = self.effects.lock(false)?;
        view(&self.effects.load()?, state.blocked)
    }
    pub fn configure(&self, recipient: String, enabled: bool) -> Result<ImessageSettings> {
        if !valid_recipient(&recipient) {
            return Err(error("invalid_recipient"));
        }
        let (snapshot, generation, _prompt_lock) = {
            let mut state = self.state.lock().map_err(|_| error("unavailable"))?;
            let _lock = self.effects.lock(false)?;
            let mut snapshot = self.effects.load()?;
            if let Snapshot::Valid(c) = &snapshot {
                if c.enabled == enabled
                    && c.recipient.as_deref() == Some(&recipient)
                    && !state.blocked
                {
                    return view(&snapshot, false);
                }
            }
            let now = self.effects.now();
            if state.last_prompt.is_some_and(|t| {
                now.saturating_duration_since(t) < std::time::Duration::from_secs(30)
            }) {
                return Err(error("busy"));
            }
            let prompt_lock = self.effects.lock(true)?;
            state.last_prompt = Some(now);
            if snapshot == Snapshot::Missing {
                let marker = Config {
                    version: 1,
                    revision: 1,
                    enabled: false,
                    recipient: None,
                    migration_attempted: true,
                };
                self.effects.persist(&marker)?;
                snapshot = Snapshot::Valid(marker);
            }
            (snapshot, state.generation, prompt_lock)
        };
        if !self.effects.confirm(&recipient, enabled)? {
            return Err(error("canceled"));
        }
        let mut state = self.state.lock().map_err(|_| error("unavailable"))?;
        let _lock = self.effects.lock(false)?;
        if state.generation != generation || self.effects.load()? != snapshot {
            return Err(error("stale_consent"));
        }
        let config = Config {
            version: 1,
            revision: next_revision(&snapshot)?,
            enabled,
            recipient: Some(recipient),
            migration_attempted: true,
        };
        let next_generation = state
            .generation
            .checked_add(1)
            .ok_or(error("unavailable"))?;
        self.effects.persist(&config)?;
        state.blocked = false;
        state.generation = next_generation;
        view(&Snapshot::Valid(config), false)
    }
    pub fn disable(&self) -> Result<ImessageSettings> {
        let mut state = self.state.lock().map_err(|_| error("unavailable"))?;
        state.blocked = true;
        state.generation = state
            .generation
            .checked_add(1)
            .ok_or(error("unavailable"))?;
        let _lock = self.effects.lock(false)?;
        let snapshot = self.effects.load()?;
        let recipient = match &snapshot {
            Snapshot::Valid(c) => c.recipient.clone(),
            Snapshot::Missing => None,
            Snapshot::Invalid(_) => return Err(error("unavailable")),
        };
        let config = Config {
            version: 1,
            revision: next_revision(&snapshot)?,
            enabled: false,
            recipient,
            migration_attempted: true,
        };
        self.effects.persist(&config)?;
        state.blocked = false;
        view(&Snapshot::Valid(config), false)
    }
    pub fn send(&self, body: String) -> Result<()> {
        let body = safe_body(&body)?;
        let child = {
            let mut state = self.state.lock().map_err(|_| error("unavailable"))?;
            let _lock = self.effects.lock(false)?;
            if state.blocked {
                return Err(error("disabled"));
            }
            let snapshot = self.effects.load()?;
            let config = match snapshot {
                Snapshot::Valid(c) => c,
                Snapshot::Missing => return Err(error("disabled")),
                Snapshot::Invalid(_) => return Err(error("unavailable")),
            };
            if !config.enabled {
                return Err(error("disabled"));
            }
            let recipient = config
                .recipient
                .as_deref()
                .filter(|r| valid_recipient(r))
                .ok_or(error("unavailable"))?;
            let now = self.effects.now();
            if state.last_send.is_some_and(|t| {
                now.saturating_duration_since(t) < std::time::Duration::from_secs(30)
            }) {
                return Err(error("rate_limited"));
            }
            state.last_send = Some(now);
            self.effects.spawn(recipient, &body)?
        };
        child.wait()
    }
}
fn next_revision(snapshot: &Snapshot) -> Result<u64> {
    let revision = match snapshot {
        Snapshot::Valid(c) => c.revision,
        _ => 0,
    };
    revision.checked_add(1).ok_or(error("unavailable"))
}
fn view(snapshot: &Snapshot, blocked: bool) -> Result<ImessageSettings> {
    match snapshot {
        Snapshot::Missing => Ok(ImessageSettings {
            enabled: false,
            recipient: None,
            ready: true,
            migration_available: true,
        }),
        Snapshot::Valid(c) => Ok(ImessageSettings {
            enabled: c.enabled && !blocked,
            recipient: c.recipient.clone(),
            ready: !blocked,
            migration_available: false,
        }),
        Snapshot::Invalid(_) => Err(error("unavailable")),
    }
}
pub fn valid_recipient(value: &str) -> bool {
    if value.is_empty() || value.len() > 64 || !value.is_ascii() {
        return false;
    }
    if let Some(digits) = value.strip_prefix('+') {
        return (2..=15).contains(&digits.len())
            && matches!(digits.as_bytes()[0], b'1'..=b'9')
            && digits.bytes().all(|b| b.is_ascii_digit());
    }
    let Some((local, domain)) = value.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && !local.starts_with('.')
        && !local.ends_with('.')
        && !local.contains("..")
        && local
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._%+-".contains(&b))
        && domain.contains('.')
        && domain.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
}
fn safe_body(value: &str) -> Result<String> {
    let mut end = value.len().min(512);
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    let body: String = value[..end]
        .chars()
        .filter(|c| !matches!(c, '"' | '\\' | '\n' | '\r' | '\x00'..='\x1f'))
        .collect();
    if body.trim().is_empty() {
        Err(error("invalid_body"))
    } else {
        Ok(body)
    }
}

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

pub struct NativeEffects {
    directory: PathBuf,
}
impl NativeEffects {
    pub fn new(directory: PathBuf) -> Self {
        Self { directory }
    }
    fn directory(&self) -> Result<()> {
        fs::create_dir_all(&self.directory).map_err(|_| error("unavailable"))?;
        let metadata = fs::symlink_metadata(&self.directory).map_err(|_| error("unavailable"))?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(error("unavailable"));
        }
        Ok(())
    }
}
impl NativeEffects {
    pub fn persist_with(
        &self,
        config: &Config,
        write: impl FnOnce(&mut File, &[u8]) -> std::io::Result<()>,
    ) -> Result<()> {
        let result = (|| {
            self.directory()?;
            let destination = self.directory.join("imessage.json");
            match fs::symlink_metadata(&destination) {
                Ok(_) => {
                    open_private(&destination, false)?;
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                Err(_) => return Err(error("unavailable")),
            }
            let bytes = serde_json::to_vec(config).map_err(|_| error("unavailable"))?;
            let temporary = self.directory.join(format!(
                ".imessage-{}-{}.tmp",
                std::process::id(),
                TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            let mut file = private_options(&mut options)
                .open(&temporary)
                .map_err(|_| error("unavailable"))?;
            let write_result = (|| {
                write(&mut file, &bytes).map_err(|_| error("unavailable"))?;
                fs::rename(&temporary, &destination).map_err(|_| error("unavailable"))?;
                Ok(())
            })();
            if write_result.is_err() {
                let _ = fs::remove_file(&temporary);
            }
            write_result
        })();
        result.map_err(|_| error("persistence_failed"))
    }
}
#[cfg(unix)]
fn private_options(options: &mut OpenOptions) -> &mut OpenOptions {
    use std::os::unix::fs::OpenOptionsExt;
    #[cfg(target_os = "macos")]
    const NO_FOLLOW: i32 = 0x100;
    #[cfg(not(target_os = "macos"))]
    const NO_FOLLOW: i32 = 0x20000;
    options.mode(0o600).custom_flags(NO_FOLLOW)
}
#[cfg(not(unix))]
fn private_options(options: &mut OpenOptions) -> &mut OpenOptions {
    options
}
fn check_file(file: &File) -> Result<()> {
    let metadata = file.metadata().map_err(|_| error("unavailable"))?;
    if !metadata.is_file() {
        return Err(error("unavailable"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        unsafe extern "C" {
            fn geteuid() -> u32;
        }
        if metadata.permissions().mode() & 0o777 != 0o600
            || metadata.nlink() != 1
            || metadata.uid() != unsafe { geteuid() }
        {
            return Err(error("unavailable"));
        }
    }
    Ok(())
}
fn open_private(path: &Path, create: bool) -> Result<File> {
    let mut options = OpenOptions::new();
    options.read(true).write(create).create(create);
    let file = private_options(&mut options)
        .open(path)
        .map_err(|_| error("unavailable"))?;
    check_file(&file)?;
    Ok(file)
}
struct FileLock {
    _file: File,
}
#[cfg(unix)]
fn try_lock(file: &File) -> bool {
    use std::os::fd::AsRawFd;
    unsafe extern "C" {
        fn flock(fd: i32, operation: i32) -> i32;
    }
    unsafe { flock(file.as_raw_fd(), 2 | 4) == 0 }
}
#[cfg(not(unix))]
fn try_lock(_file: &File) -> bool {
    false
}
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);
impl Effects for NativeEffects {
    fn lock(&self, prompt: bool) -> Result<Box<dyn Send>> {
        self.directory()?;
        let name = if prompt {
            "imessage-prompt.lock"
        } else {
            "imessage.lock"
        };
        let file = open_private(&self.directory.join(name), true)?;
        let started = Instant::now();
        loop {
            if try_lock(&file) {
                return Ok(Box::new(FileLock { _file: file }));
            }
            if prompt || started.elapsed() >= Duration::from_millis(250) {
                return Err(error("busy"));
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }
    fn load(&self) -> Result<Snapshot> {
        let path = self.directory.join("imessage.json");
        match fs::symlink_metadata(&path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Snapshot::Missing),
            Err(_) => return Err(error("unavailable")),
            Ok(metadata) if !metadata.is_file() || metadata.file_type().is_symlink() => {
                return Err(error("unavailable"))
            }
            _ => (),
        }
        let file = open_private(&path, false)?;
        let mut bytes = Vec::new();
        file.take(4097)
            .read_to_end(&mut bytes)
            .map_err(|_| error("unavailable"))?;
        if bytes.len() > 4096 {
            return Err(error("unavailable"));
        }
        match serde_json::from_slice::<Config>(&bytes) {
            Ok(c)
                if c.version == 1
                    && c.migration_attempted
                    && c.recipient.as_deref().is_none_or(valid_recipient)
                    && (!c.enabled || c.recipient.is_some()) =>
            {
                Ok(Snapshot::Valid(c))
            }
            _ => Ok(Snapshot::Invalid(bytes)),
        }
    }
    fn persist(&self, config: &Config) -> Result<()> {
        self.persist_with(config, |file, bytes| {
            file.write_all(bytes)?;
            file.sync_all()
        })
    }
    fn confirm(&self, recipient: &str, enabled: bool) -> Result<bool> {
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (recipient, enabled);
            return Err(error("unavailable"));
        }
        #[cfg(target_os = "macos")]
        {
            let intent = if enabled {
                "Enable iMessage sending to this exact recipient?"
            } else {
                "Save this exact iMessage recipient while keeping sending disabled?"
            };
            let script = r#"on run argv
set response to display dialog (item 2 of argv & return & return & item 1 of argv) with title "Crystal Ball iMessage permission" buttons {"Cancel", "Allow"} default button "Cancel" cancel button "Cancel" giving up after 60
if gave up of response then return "Cancel"
return button returned of response
end run"#;
            let child = Command::new("/usr/bin/osascript")
                .args(["-e", script, "--", recipient, intent])
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|_| error("unavailable"))?;
            let (success, output) = bounded_wait(child, Duration::from_secs(60), true)?;
            Ok(consent_result(success, &output))
        }
    }
    fn spawn(&self, recipient: &str, body: &str) -> Result<Box<dyn PendingSend>> {
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (recipient, body);
            return Err(error("unavailable"));
        }
        #[cfg(target_os = "macos")]
        {
            let script = r#"on run argv
tell application "Messages"
set targetService to 1st service whose service type = iMessage
set targetBuddy to buddy (item 1 of argv) of targetService
send (item 2 of argv) to targetBuddy
end tell
end run"#;
            let child = Command::new("/usr/bin/osascript")
                .args(["-e", script, "--", recipient, body])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|_| error("send_failed"))?;
            Ok(Box::new(NativeSend(child)))
        }
    }
    fn now(&self) -> Instant {
        Instant::now()
    }
}
struct NativeSend(Child);
impl PendingSend for NativeSend {
    fn wait(self: Box<Self>) -> Result<()> {
        let (success, _) = bounded_wait(self.0, Duration::from_secs(30), false)?;
        if success {
            Ok(())
        } else {
            Err(error("send_failed"))
        }
    }
}
pub trait Process {
    fn poll(&mut self) -> Result<Option<bool>>;
    fn output(&mut self) -> Result<Option<Vec<u8>>>;
    fn terminate(&mut self);
}
pub trait WaitClock {
    fn now(&self) -> Instant;
    fn pause(&self);
}
pub fn wait_process<P: Process, C: WaitClock>(
    mut child: P,
    timeout: Duration,
    dialog: bool,
    clock: &C,
) -> Result<(bool, Vec<u8>)> {
    let started = clock.now();
    loop {
        match child.poll() {
            Ok(Some(success)) => match child.output() {
                Ok(Some(output)) => return Ok((success, output)),
                Ok(None) => (),
                Err(_) => {
                    child.terminate();
                    return Err(error(if dialog { "canceled" } else { "send_uncertain" }));
                }
            },
            Ok(None) => (),
            Err(_) => {
                child.terminate();
                return Err(error(if dialog { "canceled" } else { "send_uncertain" }));
            }
        }
        if clock.now().saturating_duration_since(started) >= timeout {
            child.terminate();
            return Err(error(if dialog { "canceled" } else { "send_uncertain" }));
        }
        clock.pause();
    }
}
struct NativeClock;
impl WaitClock for NativeClock {
    fn now(&self) -> Instant {
        Instant::now()
    }
    fn pause(&self) {
        std::thread::sleep(Duration::from_millis(10));
    }
}
struct NativeProcess {
    child: Child,
    output: Vec<u8>,
}
impl Process for NativeProcess {
    fn poll(&mut self) -> Result<Option<bool>> {
        self.child
            .try_wait()
            .map(|s| s.map(|s| s.success()))
            .map_err(|_| error("unavailable"))
    }
    fn output(&mut self) -> Result<Option<Vec<u8>>> {
        let Some(stdout) = self.child.stdout.as_mut() else {
            return Ok(Some(Vec::new()));
        };
        let mut bytes = [0; 65];
        match stdout.read(&mut bytes) {
            Ok(0) => Ok(Some(std::mem::take(&mut self.output))),
            Ok(count) => {
                self.output.extend_from_slice(&bytes[..count]);
                if self.output.len() > 64 {
                    return Err(error("unavailable"));
                }
                Ok(None)
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => Ok(None),
            Err(_) => Err(error("unavailable")),
        }
    }
    fn terminate(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
fn bounded_wait(child: Child, timeout: Duration, dialog: bool) -> Result<(bool, Vec<u8>)> {
    let mut process = NativeProcess {
        child,
        output: Vec::new(),
    };
    #[cfg(unix)]
    if let Some(stdout) = &process.child.stdout {
        use std::os::fd::AsRawFd;
        unsafe extern "C" {
            fn fcntl(fd: i32, command: i32, ...) -> i32;
        }
        #[cfg(target_os = "macos")]
        const NONBLOCK: i32 = 4;
        #[cfg(not(target_os = "macos"))]
        const NONBLOCK: i32 = 2048;
        let flags = unsafe { fcntl(stdout.as_raw_fd(), 3) };
        if flags < 0 || unsafe { fcntl(stdout.as_raw_fd(), 4, flags | NONBLOCK) } < 0 {
            process.terminate();
            return Err(error("unavailable"));
        }
    }
    wait_process(process, timeout, dialog, &NativeClock)
}
pub fn consent_result(success: bool, output: &[u8]) -> bool {
    success && output == b"Allow\n"
}
