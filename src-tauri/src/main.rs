#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::{HashMap, HashSet};
use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, Write};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use keyring::Entry;
use reqwest::Url;
use sha2::{Digest, Sha256};
use aes_gcm::{Aes256Gcm, Nonce, aead::{Aead, KeyInit}};
use serde::Serialize;
use serde_json::{Map, Value};
use tauri::menu::{AboutMetadata, Menu, MenuItemKind, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, RunEvent, TitleBarStyle, Webview, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_biometry;

mod corelocation;

const DEFAULT_LOCAL_API_PORT: u16 = 46123;
const KEYRING_SERVICE: &str = "crystal-ball";
const LOCAL_API_LOG_FILE: &str = "local-api.log";
const DESKTOP_LOG_FILE: &str = "desktop.log";
const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024; // 5 MB per log file before rotation
const MAX_LOG_BACKUPS: u32 = 3; // keep .log.1 .log.2 .log.3
const MENU_FILE_SETTINGS_ID: &str = "file.settings";
const MENU_FILE_GHOST_MODE_ID: &str = "file.ghost_mode";
const MENU_HELP_GITHUB_ID: &str = "help.github";
const MENU_HELP_CHECK_UPDATES_ID: &str = "help.check_updates";
const MENU_HELP_OPEN_LOGS_ID: &str = "help.open_logs";
const MENU_VIEW_MODE_ID: &str = "view.mode_status";
#[cfg(feature = "devtools")]
const MENU_HELP_DEVTOOLS_ID: &str = "help.devtools";
const TRUSTED_WINDOWS: [&str; 3] = ["main", "settings", "live-channels"];
const SUPPORTED_SECRET_KEYS: [&str; 77] = [
 "CRYSTALBALL_API_KEY",
 "ANTHROPIC_API_KEY",
 "GROQ_API_KEY",
 "OPENROUTER_API_KEY",
 "FRED_API_KEY",
 "EIA_API_KEY",
 "CLOUDFLARE_API_TOKEN",
 "ACLED_ACCESS_TOKEN",
 "ACLED_EMAIL",
 "ACLED_REFRESH_TOKEN",
 "URLHAUS_AUTH_KEY",
 "OTX_API_KEY",
 "ABUSEIPDB_API_KEY",
 "WINGBITS_API_KEY",
 "WS_RELAY_URL",
 "VITE_OPENSKY_RELAY_URL",
 "OPENSKY_CLIENT_ID",
 "OPENSKY_CLIENT_SECRET",
 "AISSTREAM_API_KEY",
 "VITE_WS_RELAY_URL",
 "FINNHUB_API_KEY",
 "NASA_FIRMS_API_KEY",
 "AIRNOW_API_KEY",
 "PURPLEAIR_API_KEY",
 "OLLAMA_API_URL",
 "OLLAMA_MODEL",
 "WTO_API_KEY",
 "AVIATIONSTACK_API",
 "ICAO_API_KEY",
 "THREATFOX_API_KEY",
 "NEWSAPI_KEY",
 "NEWSDATA_API_KEY",
 "VIRUSTOTAL_API_KEY",
 "SHODAN_API_KEY",
 "UCDP_API_TOKEN",
 "FMP_API_KEY",
 "OWM_API_KEY",
 "GREYNOISE_API_KEY",
 "NASA_API_KEY",
 "URLSCAN_API_KEY",
 "BITCOINABUSE_API_KEY",
 "VULNERS_API_KEY",
 "MEDIASTACK_API_KEY",
 "PULSEDIVE_API_KEY",
 "HIBP_API_KEY",
 "GEONAMES_USERNAME",
 "IPINFO_TOKEN",
 "CESIUM_ION_TOKEN",
 "GOOGLE_MAPS_API_KEY",
 "MAPBOX_API_KEY",
 "MAPTILER_API_KEY",
 "S2U_XMPP_JID",
 "S2U_XMPP_SECRET",
 "S2U_TAK_URL",
 "S2U_TAK_USERNAME",
 "S2U_TAK_SECRET",
 "S2U_TLS_INSECURE_OPT_IN",
 "NSW_API_KEY",
 "UK_HIGHWAYS_API_KEY",
 "ROAD511_API_KEY",
 "CENSYS_API_ID",
 "CENSYS_API_SECRET",
 "SECURITYTRAILS_API_KEY",
 "WHOISXML_API_KEY",
 "MISP_URL",
 "MISP_API_KEY",
 "OPENCTI_URL",
 "OPENCTI_API_KEY",
 "PATREON_OAUTH_CLIENT_ID",
 "PATREON_OAUTH_CLIENT_SECRET",
 "PATREON_ACCESS_TOKEN",
 "PATREON_REFRESH_TOKEN",
 "PATREON_AUDIO_RSS_URL",
 "OPENAQ_API_KEY",
 "WINDY_WEBCAMS_API_KEY",
 "NPS_API_KEY",
 "TWILIO_AUTH_TOKEN",
];

// Rate-limit native notifications: no more than 1 per 30 seconds across all threads.
static NOTIFICATION_LAST_SENT: Mutex<Option<Instant>> = Mutex::new(None);
const NOTIFICATION_RATE_LIMIT: Duration = Duration::from_secs(30);

// iMessage has its own rate-limit state so user-initiated Test sends aren't
// blocked by background native notifications. Same 30s window between iMessages.
static IMESSAGE_LAST_SENT: Mutex<Option<Instant>> = Mutex::new(None);
// Voice alerts (`say`) are more disruptive than push, so we use a 5s
// floor to avoid stacked utterances when several alerts fire at once.
static VOICE_LAST_SENT: Mutex<Option<Instant>> = Mutex::new(None);
const VOICE_RATE_LIMIT: Duration = Duration::from_secs(5);
const MIN_CACHE_FLUSH_INTERVAL: Duration = Duration::from_secs(2);
const CACHE_TTL_MILLIS: u64 = 7 * 24 * 60 * 60 * 1000; // 7 days
const CACHE_MAX_BYTES: usize = 32 * 1024 * 1024; // 32 MB

struct LocalApiState {
 child: Mutex<Option<Child>>,
 token: Mutex<Option<String>>,
 port: Mutex<Option<u16>>,
 // True only once the sidecar has written its real bound port to the port
 // file. On the timeout fallback we record the default port but leave this
 // false — secret injection must not post plaintext to a port we never
 // confirmed is actually our child (a squatter on 46123 would receive it).
 port_confirmed: AtomicBool,
 restart_count: Mutex<u32>,
 last_restart_at: Mutex<Option<Instant>>,
}

const BUILD_SHA: &str = match option_env!("WM_BUILD_SHA") {
 Some(s) => s,
 None => "dev",
};

impl Default for LocalApiState {
 fn default() -> Self {
 Self {
 child: Mutex::new(None),
 token: Mutex::new(None),
 port: Mutex::new(None),
 port_confirmed: AtomicBool::new(false),
 restart_count: Mutex::new(0),
 last_restart_at: Mutex::new(None),
 }
 }
}

/// In-memory cache for keychain secrets. Populated once at startup to avoid
/// repeated macOS Keychain prompts (each `Entry::get_password()` triggers one).
struct SecretsCache {
 secrets: Mutex<HashMap<String, String>>,
 // Keys the user explicitly set or deleted via Settings since launch. The
 // async keychain read works from a snapshot taken before these edits, so its
 // merge must skip them — otherwise a just-deleted key gets resurrected (and
 // re-injected into the sidecar). Lock order is always `secrets` then this.
 user_mutated: Mutex<HashSet<String>>,
 // False until the async keychain read finishes (success, empty, or timeout).
 // The renderer's boot-time secret load must wait on this — reading the cache
 // before it flips would memoize a null for every key for the whole session.
 loaded: AtomicBool,
}

/// In-memory mirror of persistent-cache.json. The file can grow to 10+ MB,
/// so reading/parsing/writing it on every IPC call blocks the main thread.
/// Instead, load once into RAM and serialize writes to preserve ordering.
struct PersistentCache {
 data: Mutex<Map<String, Value>>,
 dirty: Mutex<bool>,
 write_lock: Mutex<()>,
 flush_scheduled: Mutex<bool>,
 last_flush_at: Mutex<Option<Instant>>,
}

/// Maximum time we'll wait on a single `Entry::get_password()` call.
/// macOS will block that call indefinitely if the user has an ACL
/// dialog pending or Keychain Access is unlocked mid-fetch — this
/// timeout lets the sidecar boot anyway.
const KEYCHAIN_PER_CALL_TIMEOUT: Duration = Duration::from_secs(3);

/// The consolidated `secrets-vault` read surfaces a macOS "Always Allow" ACL
/// dialog after every re-signed build. macOS Keychain ACL tracks applications
/// by CDHash (per-binary), so each new build requires one "Always Allow" click.
/// 10s is enough to click the prompt; if dismissed, the shadow file fallback
/// returns cached secrets instantly so the sidecar boots with keys regardless.
const KEYCHAIN_VAULT_TIMEOUT: Duration = Duration::from_secs(10);

/// Timeout for a USER-INITIATED vault read (the `reload_secrets_from_keychain`
/// command). Much longer than the boot read: the user just clicked a button with
/// the window frontmost, so the macOS "Always Allow" ACL dialog can present and
/// be answered without the boot path's need to fail fast so the app isn't
/// blocked. Nothing waits on this — it runs on a spawn_blocking worker.
const KEYCHAIN_VAULT_INTERACTIVE_TIMEOUT: Duration = Duration::from_secs(60);

/// Timeout for the automatic background retry fired when the boot vault read
/// times out. The macOS keychain often answers seconds after the 10s boot
/// deadline (the boot read fails fast so the app isn't blocked, then orphans
/// the worker and discards its late answer). This retry re-reads the vault with
/// a long deadline and, on success, re-injects into the running sidecar — so a
/// slow keychain self-heals within the session without a relaunch or prompt.
const KEYCHAIN_VAULT_RETRY_TIMEOUT: Duration = Duration::from_secs(120);

/// Filename for the encrypted (AES-256-GCM) shadow copy of the secrets vault
/// written to the app data directory (mode 0600). Read as a fallback when the
/// keychain prompt is dismissed or times out. Written only when a machine-bound
/// key is derivable; never persisted in plaintext.
const VAULT_SHADOW_FILE: &str = "secrets-vault-shadow.json";

/// Run a single keychain `get_password()` call on a worker thread
/// and wait at most `timeout` for the answer. Returns:
///   - `Ok(Some(value))` if the entry was read and is non-empty
///   - `Ok(None)` if the entry is absent or the read errored
///   - `Err(())` if the timeout elapsed first
///
/// On timeout the worker thread is intentionally orphaned: the
/// `keyring` crate has no cancel API, so the only option is to
/// stop waiting on the channel. The leaked thread will resolve
/// (or be reaped at shutdown) once the keychain finally responds.
fn read_keychain_entry_with_timeout(
 service: &'static str,
 key: String,
 timeout: Duration,
) -> Result<Option<String>, ()> {
 let (tx, rx) = mpsc::channel::<Option<String>>();
 std::thread::spawn(move || {
 let value = Entry::new(service, &key)
 .ok()
 .and_then(|e| e.get_password().ok())
 .map(|s| s.trim().to_string())
 .filter(|s| !s.is_empty());
 // Receiver may be gone (timeout already fired); ignore send failure.
 let _ = tx.send(value);
 });
 rx.recv_timeout(timeout).map_err(|_| ())
}

impl SecretsCache {
 /// Empty cache, ready to be `manage()`d at builder time without
 /// touching the macOS Keychain. The actual secrets are populated
 /// asynchronously from `setup()` so the UI window renders before
 /// any blocking keychain calls happen — see issue notes on the
 /// startup-freeze bug this fixes.
 fn empty() -> Self {
 SecretsCache {
 secrets: Mutex::new(HashMap::new()),
 user_mutated: Mutex::new(HashSet::new()),
 loaded: AtomicBool::new(false),
 }
 }

 /// Blocking keychain query. Replaces the in-memory map atomically.
 /// MUST be called off the main thread (`spawn_blocking` etc.).
 ///
 /// `app` is optional so non-Tauri callers (tests, the
 /// `load_from_keychain` shim) can invoke this without an
 /// `AppHandle`. When provided, timeout warnings land in the
 /// desktop log so the operator can tell which keychain entries
 /// are blocked by an ACL prompt.
 fn populate_from_keychain(&self, app: Option<&AppHandle>, vault_timeout: Duration) -> bool {
 let (loaded, vault_timed_out) = Self::read_keychain_blocking(app, vault_timeout);
 if let Ok(mut guard) = self.secrets.lock() {
 // Preserve edits made concurrently with the (up to 120s) keychain
 // read — the UI is usable before boot finishes, so a Settings save
 // or delete can land mid-flight. Those edits are newer than this
 // snapshot: skip any key the user touched (a delete leaves it absent
 // from the map, so a blind or_insert would resurrect it), and never
 // clobber a key we already hold.
 let touched = self.user_mutated.lock().ok();
 for (key, value) in loaded {
 if touched.as_ref().is_some_and(|t| t.contains(&key)) {
 continue;
 }
 guard.entry(key).or_insert(value);
 }
 }
 // Mark ready even on timeout/empty — the read is done, the cache is as
 // populated as it will get this launch, and the renderer should stop
 // waiting and reload from whatever loaded.
 self.loaded.store(true, Ordering::SeqCst);
 vault_timed_out
 }

 /// Vault-ONLY re-read for the boot self-heal retry. Reads solely the
 /// consolidated `secrets-vault` entry and NEVER the legacy per-key
 /// migration scan — that scan issues a keychain call (and a delete) per
 /// supported key, which we must not do from a background retry (per-key
 /// ACL prompts + the delete path that caused a past key-loss incident).
 /// On a successful vault read the recovered keys are merged into the cache
 /// (respecting concurrent user edits, never clobbering held keys) and the
 /// shadow file is refreshed. Returns true only when the vault read
 /// succeeded; a timeout or absent entry returns false and touches nothing.
 fn repopulate_vault_only(&self, app: &AppHandle, timeout: Duration) -> bool {
 let json = match read_keychain_entry_with_timeout(
 KEYRING_SERVICE,
 "secrets-vault".to_string(),
 timeout,
 ) {
 Ok(Some(json)) => json,
 // Err(()) = timed out again, Ok(None) = entry absent. Either way do
 // NOT fall through to migration — just leave the shadow in place.
 _ => return false,
 };
 let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&json) else {
 return false;
 };
 let secrets: HashMap<String, String> = map
 .into_iter()
 .filter(|(k, v)| SUPPORTED_SECRET_KEYS.contains(&k.as_str()) && !v.trim().is_empty())
 .map(|(k, v)| (k, v.trim().to_string()))
 .collect();
 if let Ok(mut guard) = self.secrets.lock() {
 let touched = self.user_mutated.lock().ok();
 for (key, value) in secrets.iter() {
 if touched.as_ref().is_some_and(|t| t.contains(key)) {
 continue;
 }
 guard.entry(key.clone()).or_insert_with(|| value.clone());
 }
 }
 // Refresh the shadow so the next launch's timeout fallback is current.
 write_vault_shadow(app, &secrets);
 true
 }

 /// Pulled out so callers can run the load on whichever thread they
 /// like and write the result into a shared cache themselves.
 ///
 /// Each `Entry::get_password()` call is wrapped in
 /// `read_keychain_entry_with_timeout` so a hung ACL prompt on
 /// any single key does NOT stall the rest of the load (or the
 /// sidecar startup that depends on it). On timeout we log a
 /// warning and skip that key — features that need it will return
 /// the existing 503 + `keyMissing` error path until it's
 /// re-fetched on the next launch.
 fn read_keychain_blocking(app: Option<&AppHandle>, vault_timeout: Duration) -> (HashMap<String, String>, bool) {
 // `vault_timed_out` tells the caller the consolidated read hit its deadline
 // (as opposed to the entry being absent) — the boot path uses it to fire a
 // longer background retry that captures the keychain's late answer.
 let mut vault_timed_out = false;
 // Try consolidated vault first — single keychain read.
 match read_keychain_entry_with_timeout(
 KEYRING_SERVICE,
 "secrets-vault".to_string(),
 vault_timeout,
 ) {
 Ok(Some(json)) => {
 if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&json) {
 let secrets: HashMap<String, String> = map
 .into_iter()
 .filter(|(k, v)| {
 SUPPORTED_SECRET_KEYS.contains(&k.as_str()) && !v.trim().is_empty()
 })
 .map(|(k, v)| (k, v.trim().to_string()))
 .collect();
 // Update the shadow file so the next timeout-fallback is fresh.
 if let Some(a) = app { write_vault_shadow(a, &secrets); }
 return (secrets, vault_timed_out);
 }
 }
 Ok(None) => {
     // No vault entry. If migration was already attempted, there is nothing to
     // migrate — skip the 73-key scan to avoid one macOS ACL prompt per key.
     if app.is_some_and(|a| migration_done(a)) {
         return (HashMap::new(), vault_timed_out);
     }
 }
 Err(()) => {
 vault_timed_out = true;
 log_keychain_timeout(app, "secrets-vault", vault_timeout);
 // Keychain prompt dismissed or timed out — fall back to the
 // shadow file written on the last successful save/read.
 if let Some(secrets) = app.and_then(read_vault_shadow) {
     if let Some(a) = app {
         append_desktop_log(a, "INFO", &format!(
             "secrets-cache: keychain timed out, loaded {} keys from shadow vault",
             secrets.len(),
         ));
     }
     return (secrets, vault_timed_out);
 }
 }
 }

 // Migration: read individual keys (old format), consolidate into vault.
 // Each call has its own timeout so a single stuck ACL prompt can't
 // halt the whole loop.
 let mut secrets = HashMap::new();
 let mut migration_attempted = false;
 let mut migration_had_timeout = false;
 for key in SUPPORTED_SECRET_KEYS.iter() {
 migration_attempted = true;
 match read_keychain_entry_with_timeout(
 KEYRING_SERVICE,
 (*key).to_string(),
 KEYCHAIN_PER_CALL_TIMEOUT,
 ) {
 Ok(Some(value)) => {
 secrets.insert((*key).to_string(), value);
 }
 Ok(None) => { /* not present; skip silently */ }
 Err(()) => {
 log_keychain_timeout(app, key, KEYCHAIN_PER_CALL_TIMEOUT);
 migration_had_timeout = true;
 // continue — other keys may still respond
 }
 }
 }
 let _ = migration_attempted;

 // Write consolidated vault and clean up individual entries —
 // only if we actually loaded something. Vault writes are also
 // best-effort: if Keychain refuses, the next launch will retry.
 let mut vault_written = false;
 // Don't write a partial vault if any per-key reads timed out: the timed-out
 // keys would become unreachable once a vault entry exists (the next launch
 // returns the vault directly and never re-runs migration). Wait for a clean
 // scan before committing.
 if !secrets.is_empty() && !migration_had_timeout {
 if let Ok(json) = serde_json::to_string(&secrets) {
 if let Ok(vault_entry) = Entry::new(KEYRING_SERVICE, "secrets-vault") {
 if vault_entry.set_password(&json).is_ok() {
 vault_written = true;
 if let Some(a) = app { write_vault_shadow(a, &secrets); }
 // Only delete keys we successfully read — not the full set.
 // Non-timeout errors collapse to Ok(None) so those entries
 // stay untouched and can be retried next launch.
 for key in secrets.keys() {
 if let Ok(entry) = Entry::new(KEYRING_SERVICE, key.as_str()) {
 let _ = entry.delete_credential();
 }
 }
 }
 }
 }
 }

 // Mark migration done ONLY when the scan was clean (no per-key timeouts)
 // AND either (a) nothing was found — nothing to migrate, or (b) secrets
 // were found AND the consolidated vault write succeeded. If the vault
 // write failed, leave the marker unset so the next launch retries.
 let migration_complete = !migration_had_timeout
 && (secrets.is_empty() || vault_written);
 if migration_complete {
 if let Some(app) = app { mark_migration_done(app); }
 }

 (secrets, vault_timed_out)
 }

 /// Convenience constructor — synchronous load for tests + any
 /// non-Tauri caller. Behaviour identical to the pre-fix version
 /// except that per-call timeouts now apply (so this can no longer
 /// hang on a stuck ACL prompt).
 #[allow(dead_code)]
 fn load_from_keychain() -> Self {
 let cache = Self::empty();
 cache.populate_from_keychain(None, KEYCHAIN_VAULT_TIMEOUT);
 cache
 }
}

/// Standalone helper so callers can log keychain timeouts without
/// needing access to `SecretsCache` internals (the desktop-log
/// helper requires an `AppHandle`, which tests don't have).
fn log_keychain_timeout(app: Option<&AppHandle>, key: &str, timeout: Duration) {
 let secs = timeout.as_secs();
 let msg = format!("Keychain entry '{key}' timed out after {secs}s — skipping");
 match app {
 Some(handle) => append_desktop_log(handle, "WARN", &msg),
 None => eprintln!("[secrets] {msg}"),
 }
}

impl PersistentCache {
 fn load(path: &Path) -> Self {
 let data = if path.exists() {
 std::fs::read_to_string(path)
 .ok()
 .and_then(|s| serde_json::from_str::<Value>(&s).ok())
 .and_then(|v| v.as_object().cloned())
 .unwrap_or_default()
 } else {
 Map::new()
 };
 PersistentCache {
 data: Mutex::new(data),
 dirty: Mutex::new(false),
 write_lock: Mutex::new(()),
 flush_scheduled: Mutex::new(false),
 last_flush_at: Mutex::new(None),
 }
 }

 fn get(&self, key: &str) -> Option<Value> {
 let data = self.data.lock().unwrap_or_else(|e| e.into_inner());
 let entry = data.get(key)?;
 // Entries without stored_at are pre-migration legacy entries → treat as expired.
 let stored_at = entry.get("stored_at").and_then(|v| v.as_u64())?;
 // Per-entry TTL stored at write time; fall back to default 7 days for old entries.
 let ttl = entry.get("ttl_ms").and_then(|v| v.as_u64()).unwrap_or(CACHE_TTL_MILLIS);
 let now_ms = SystemTime::now()
  .duration_since(UNIX_EPOCH)
  .map(|d| d.as_millis() as u64)
  .unwrap_or(0);
 if now_ms.saturating_sub(stored_at) > ttl {
  return None;
 }
 entry.get("v").cloned()
 }

 /// Flush to disk only if dirty. Returns Ok(true) if written.
 fn flush(&self, path: &Path, force: bool) -> Result<bool, String> {
 let _write_guard = self.write_lock.lock().unwrap_or_else(|e| e.into_inner());

 let is_dirty = {
 let dirty = self.dirty.lock().unwrap_or_else(|e| e.into_inner());
 *dirty
 };
 if !is_dirty {
 return Ok(false);
 }

 if !force {
 let last_flush_at = self.last_flush_at.lock().unwrap_or_else(|e| e.into_inner());
 if last_flush_at
 .as_ref()
 .map(|at| at.elapsed() < MIN_CACHE_FLUSH_INTERVAL)
 .unwrap_or(false)
 {
 return Ok(false);
 }
 }

 let mut data = self.data.lock().unwrap_or_else(|e| e.into_inner());

 // Evict expired and legacy (no stored_at) entries before persisting.
 let now_ms = SystemTime::now()
  .duration_since(UNIX_EPOCH)
  .map(|d| d.as_millis() as u64)
  .unwrap_or(0);
 data.retain(|_, v| {
  let ttl = v.get("ttl_ms").and_then(|t| t.as_u64()).unwrap_or(CACHE_TTL_MILLIS);
  v.get("stored_at")
   .and_then(|t| t.as_u64())
   .map(|t| now_ms.saturating_sub(t) <= ttl)
   .unwrap_or(false)
 });

 // Enforce 32 MB total cap: evict oldest-stored_at-first.
 let serialized_size = serde_json::to_vec(&*data).map(|v| v.len()).unwrap_or(0);
 if serialized_size > CACHE_MAX_BYTES {
  let mut keys_by_age: Vec<(String, u64)> = data
   .iter()
   .map(|(k, v)| {
    let t = v.get("stored_at").and_then(|t| t.as_u64()).unwrap_or(0);
    (k.clone(), t)
   })
   .collect();
  keys_by_age.sort_by_key(|(_, t)| *t);
  let mut remaining = serialized_size;
  for (key, _) in keys_by_age {
   if remaining <= CACHE_MAX_BYTES {
    break;
   }
   if let Some(removed) = data.remove(&key) {
    let removed_size = serde_json::to_vec(&removed).map(|v| v.len()).unwrap_or(0);
    remaining = remaining.saturating_sub(removed_size + key.len() + 6);
   }
  }
 }

 let tmp_path = path.with_extension("json.tmp");
 let tmp_file = File::create(&tmp_path)
 .map_err(|e| format!("Failed to create cache temp file {}: {e}", tmp_path.display()))?;

 #[cfg(unix)]
 {
  use std::os::unix::fs::PermissionsExt;
  let _ = fs::set_permissions(&tmp_path, fs::Permissions::from_mode(0o600));
 }

 let mut writer = BufWriter::new(tmp_file);
 serde_json::to_writer(&mut writer, &*data)
 .map_err(|e| format!("Failed to serialize cache: {e}"))?;
 writer
 .flush()
 .map_err(|e| format!("Failed to flush cache temp file {}: {e}", tmp_path.display()))?;
 drop(data);

 #[cfg(windows)]
 if path.exists() {
 let _ = std::fs::remove_file(path);
 }

 std::fs::rename(&tmp_path, path).map_err(|e| {
 let _ = std::fs::remove_file(&tmp_path);
 format!(
 "Failed to replace cache {} from {}: {e}",
 path.display(),
 tmp_path.display()
 )
 })?;
 let mut dirty = self.dirty.lock().unwrap_or_else(|e| e.into_inner());
 *dirty = false;
 drop(dirty);
 let mut last_flush_at = self.last_flush_at.lock().unwrap_or_else(|e| e.into_inner());
 *last_flush_at = Some(Instant::now());
 Ok(true)
 }
}

fn schedule_cache_flush(app: &AppHandle) {
 let should_spawn = match app.try_state::<PersistentCache>() {
 Some(cache) => {
 let mut scheduled = cache.flush_scheduled.lock().unwrap_or_else(|e| e.into_inner());
 if *scheduled {
 false
 } else {
 *scheduled = true;
 true
 }
 }
 None => false,
 };
 if !should_spawn {
 return;
 }

 let app_handle = app.clone();
 std::thread::spawn(move || {
 std::thread::sleep(Duration::from_millis(750));

 let flush_result = if let Ok(path) = cache_file_path(&app_handle) {
 if let Some(cache) = app_handle.try_state::<PersistentCache>() {
 cache.flush(&path, false)
 } else {
 Ok(false)
 }
 } else {
 Ok(false)
 };

 if let Some(cache) = app_handle.try_state::<PersistentCache>() {
 {
 let mut scheduled = cache.flush_scheduled.lock().unwrap_or_else(|e| e.into_inner());
 *scheduled = false;
 }

 if flush_result.is_ok() {
 let is_dirty = {
 let dirty = cache.dirty.lock().unwrap_or_else(|e| e.into_inner());
 *dirty
 };
 if is_dirty {
 schedule_cache_flush(&app_handle);
 }
 }
 }
 });
}

fn humanize_user_name(value: &str) -> Option<String> {
 let mut parts = Vec::new();
 for raw in value.split(|c: char| c == '.' || c == '_' || c == '-' || c.is_whitespace()) {
 let trimmed = raw.trim();
 if trimmed.is_empty() {
 continue;
 }
 let mut chars = trimmed.chars();
 if let Some(first) = chars.next() {
 let first_upper = first.to_uppercase().collect::<String>();
 let rest = chars.as_str().to_lowercase();
 parts.push(format!("{first_upper}{rest}"));
 }
 }

 if parts.is_empty() {
 None
 } else {
 Some(parts.join(" "))
 }
}

fn resolve_runtime_user_name() -> Option<String> {
 env::var("USER")
 .ok()
 .or_else(|| env::var("USERNAME").ok())
 .map(|value| value.trim().to_string())
 .filter(|value| !value.is_empty())
}

fn resolve_runtime_display_name(username: Option<&String>) -> Option<String> {
 #[cfg(target_os = "macos")]
 {
 if let Ok(output) = Command::new("id").arg("-F").output() {
 if output.status.success() {
 let display_name = String::from_utf8_lossy(&output.stdout).trim().to_string();
 if !display_name.is_empty() {
 return Some(display_name);
 }
 }
 }
 }

 username.and_then(|value| humanize_user_name(value))
}

fn save_vault(cache: &HashMap<String, String>) -> Result<(), String> {
 let json =
 serde_json::to_string(cache).map_err(|e| format!("Failed to serialize vault: {e}"))?;
 let entry = Entry::new(KEYRING_SERVICE, "secrets-vault")
 .map_err(|e| format!("Keyring init failed: {e}"))?;
 entry
 .set_password(&json)
 .map_err(|e| format!("Failed to write vault: {e}"))?;
 Ok(())
}

/// AES-256-GCM envelope for the at-rest shadow vault. `n` = 12-byte nonce,
/// `c` = ciphertext+tag. Bytes serialize as JSON arrays so no base64 dep/version
/// is involved. `v` versions the format for any future migration.
#[derive(Serialize, serde::Deserialize)]
struct ShadowEnvelope {
 v: u8,
 n: Vec<u8>,
 c: Vec<u8>,
}

/// Derive a 32-byte AES key bound to this machine for the shadow vault.
/// Deliberately NOT keychain-backed: the shadow vault exists to survive keychain
/// timeouts, so its key must be derivable WITHOUT the keychain. Bind to the macOS
/// hardware IOPlatformUUID so the at-rest secrets can't be decrypted from a
/// copied / backed-up / leaked file on another machine. An on-host attacker with
/// code execution can still re-derive it — the accepted limit absent a
/// keychain-free secure enclave. None → the shadow copy is skipped entirely
/// (no stable id); secrets are never written to disk in plaintext.
#[cfg(target_os = "macos")]
fn vault_shadow_key() -> Option<[u8; 32]> {
 let out = std::process::Command::new("ioreg")
     .args(["-rd1", "-c", "IOPlatformExpertDevice"])
     .output()
     .ok()?;
 let text = String::from_utf8_lossy(&out.stdout);
 let uuid = text
     .lines()
     .find(|l| l.contains("IOPlatformUUID"))
     .and_then(|l| l.split('"').nth(3))?;
 if uuid.len() < 16 {
     return None;
 }
 let mut hasher = Sha256::new();
 hasher.update(b"crystalball-vault-shadow-key-v2\0");
 hasher.update(uuid.as_bytes());
 Some(hasher.finalize().into())
}

#[cfg(not(target_os = "macos"))]
fn vault_shadow_key() -> Option<[u8; 32]> {
 None
}

/// Encrypt the shadow-vault JSON with AES-256-GCM under the machine-bound key.
fn encrypt_vault_shadow(key: &[u8; 32], plaintext: &str) -> Option<String> {
 let cipher = Aes256Gcm::new_from_slice(key).ok()?;
 let mut nonce_bytes = [0u8; 12];
 getrandom::fill(&mut nonce_bytes).ok()?;
 let ct = cipher
     .encrypt(Nonce::from_slice(&nonce_bytes), plaintext.as_bytes())
     .ok()?;
 serde_json::to_string(&ShadowEnvelope { v: 2, n: nonce_bytes.to_vec(), c: ct }).ok()
}

/// Decrypt a v2 AES-256-GCM envelope. None if `raw` is not a v2 envelope (e.g. a
/// legacy plaintext file, or one written on a different machine) or if the GCM
/// tag fails to authenticate — callers fall back to treating `raw` as plaintext.
fn decrypt_vault_shadow(key: &[u8; 32], raw: &str) -> Option<String> {
 let env: ShadowEnvelope = serde_json::from_str(raw).ok()?;
 if env.v != 2 || env.n.len() != 12 {
     return None;
 }
 let cipher = Aes256Gcm::new_from_slice(key).ok()?;
 let pt = cipher.decrypt(Nonce::from_slice(&env.n), env.c.as_ref()).ok()?;
 String::from_utf8(pt).ok()
}

/// Write an encrypted shadow copy of the vault to the app data dir (mode 0600).
/// Encrypted at rest under a machine-bound key (AES-256-GCM). Where no stable
/// machine id exists (non-macOS) the shadow copy is skipped rather than written
/// in plaintext. Best-effort — non-fatal; the keychain remains authoritative.
fn write_vault_shadow(app: &AppHandle, secrets: &HashMap<String, String>) {
 let Ok(path) = vault_shadow_path(app) else { return };
 let json = match serde_json::to_string(secrets) {
     Ok(j) => j,
     Err(_) => return,
 };
 // Never persist secrets to disk in plaintext. If there is no machine-bound
 // key (non-macOS) or encryption fails, skip the shadow copy entirely — the
 // OS keychain / credential manager remains authoritative; we only forgo the
 // keychain-timeout fallback cache here. Also delete any pre-existing shadow
 // file (e.g. a legacy plaintext copy from an older build) so read_vault_shadow
 // can't load it back as stale secrets during keychain fallback.
 let Some(payload) = vault_shadow_key().and_then(|k| encrypt_vault_shadow(&k, &json)) else {
     let _ = fs::remove_file(&path);
     return;
 };
 if let Some(parent) = path.parent() {
     let _ = fs::create_dir_all(parent);
 }
 // Write to a temp file then rename for atomic update.
 let tmp = path.with_extension("tmp");
 let wrote = (|| -> std::io::Result<()> {
     fs::write(&tmp, payload.as_bytes())?;
     #[cfg(unix)]
     {
         use std::os::unix::fs::PermissionsExt;
         fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600))?;
     }
     fs::rename(&tmp, &path)?;
     Ok(())
 })();
 if let Err(e) = wrote {
     eprintln!("[secrets] shadow vault write failed: {e}");
     let _ = fs::remove_file(&tmp);
 } else {
     // Exclude the shadow vault file itself from Time Machine / iCloud backups.
     // The parent app_data_dir already has the xattr, but per-file exclusion
     // protects against iCloud snapshotting the file before the dir xattr is set.
     #[cfg(target_os = "macos")]
     {
         let _ = std::process::Command::new("xattr")
             .args([
                 "-w",
                 "com.apple.metadata:com_apple_backup_excludeItem",
                 "com.apple.backup.excludeItem",
                 &path.to_string_lossy(),
             ])
             .output();
     }
 }
}

/// Read the shadow vault file if it exists. Returns a filtered map of valid keys.
/// A v2 AES-256-GCM envelope is decrypted under the machine-bound key; anything
/// else is treated as a legacy plaintext file so existing installs are never
/// locked out (the next successful keychain read re-writes it encrypted).
fn read_vault_shadow(app: &AppHandle) -> Option<HashMap<String, String>> {
 let path = vault_shadow_path(app).ok()?;
 let raw = fs::read_to_string(&path).ok()?;
 // Only accept an authenticated AES-256-GCM envelope. Never fall back to
 // parsing the file as raw plaintext — a legacy or tampered plaintext shadow
 // must not be trusted as secrets. Pairs with write_vault_shadow, which now
 // only ever writes encrypted (and deletes the file when it cannot).
 let key = vault_shadow_key()?;
 let json = decrypt_vault_shadow(&key, &raw)?;
 let map: HashMap<String, String> = serde_json::from_str(&json).ok()?;
 let filtered: HashMap<String, String> = map
     .into_iter()
     .filter(|(k, v)| SUPPORTED_SECRET_KEYS.contains(&k.as_str()) && !v.trim().is_empty())
     .map(|(k, v)| (k, v.trim().to_string()))
     .collect();
 if filtered.is_empty() { None } else { Some(filtered) }
}

fn vault_shadow_path(app: &AppHandle) -> Result<PathBuf, String> {
 let dir = app.path().app_data_dir()
     .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
 Ok(dir.join(VAULT_SHADOW_FILE))
}

fn generate_local_token() -> String {
 let mut buf = [0u8; 32];
 getrandom::fill(&mut buf).expect("OS CSPRNG unavailable");
 buf.iter().map(|b| format!("{b:02x}")).collect()
}

fn require_trusted_window(label: &str) -> Result<(), String> {
 if TRUSTED_WINDOWS.contains(&label) {
 Ok(())
 } else {
 Err(format!("Command not allowed from window '{label}'"))
 }
}

#[tauri::command]
fn get_local_api_token(webview: Webview, state: tauri::State<'_, LocalApiState>) -> Result<String, String> {
 require_trusted_window(webview.label())?;
 let token = state
 .token
 .lock()
 .map_err(|_| "Failed to lock local API token".to_string())?;
 token
 .clone()
 .ok_or_else(|| "Token not generated".to_string())
}

/// Holds the retained NSProcessInfo activity token (as a pointer-sized int so the
/// state is Send+Sync). None when no activity is held.
struct AlwaysOnGuard(std::sync::Mutex<Option<usize>>);

#[cfg(target_os = "macos")]
fn begin_activity_macos() -> Option<usize> {
    use std::ffi::c_void;
    extern "C" {
        fn objc_getClass(name: *const u8) -> *mut c_void;
        fn sel_registerName(name: *const u8) -> *mut c_void;
        fn objc_msgSend(receiver: *mut c_void, sel: *mut c_void, ...) -> *mut c_void;
    }
    // NSActivityUserInitiated prevents App Nap; clear IdleSystemSleepDisabled so the
    // Mac may still sleep normally (lid close). bit14=SuddenTermination, bit20=IdleSystemSleep.
    const NS_SUDDEN_TERM_DISABLED: u64 = 1 << 14;
    const NS_IDLE_SYSTEM_SLEEP_DISABLED: u64 = 1 << 20;
    const NS_USER_INITIATED: u64 = 0x00FF_FFFF | NS_SUDDEN_TERM_DISABLED;
    let options: u64 = NS_USER_INITIATED & !NS_IDLE_SYSTEM_SLEEP_DISABLED;
    unsafe {
        let pi_cls = objc_getClass(b"NSProcessInfo\0".as_ptr());
        let str_cls = objc_getClass(b"NSString\0".as_ptr());
        if pi_cls.is_null() || str_cls.is_null() {
            return None;
        }
        let process_info = objc_msgSend(pi_cls, sel_registerName(b"processInfo\0".as_ptr()));
        if process_info.is_null() {
            return None;
        }
        let with_utf8 = sel_registerName(b"stringWithUTF8String:\0".as_ptr());
        let reason_fn: unsafe extern "C" fn(*mut c_void, *mut c_void, *const u8) -> *mut c_void =
            std::mem::transmute(objc_msgSend as *const ());
        let reason = reason_fn(str_cls, with_utf8, b"Crystal Ball 24/7 monitoring\0".as_ptr());
        let begin_sel = sel_registerName(b"beginActivityWithOptions:reason:\0".as_ptr());
        let begin_fn: unsafe extern "C" fn(*mut c_void, *mut c_void, u64, *mut c_void) -> *mut c_void =
            std::mem::transmute(objc_msgSend as *const ());
        let token = begin_fn(process_info, begin_sel, options, reason);
        if token.is_null() {
            return None;
        }
        // retain so it survives past this scope
        objc_msgSend(token, sel_registerName(b"retain\0".as_ptr()));
        Some(token as usize)
    }
}

#[cfg(target_os = "macos")]
fn end_activity_macos(token: usize) {
    use std::ffi::c_void;
    extern "C" {
        fn objc_getClass(name: *const u8) -> *mut c_void;
        fn sel_registerName(name: *const u8) -> *mut c_void;
        fn objc_msgSend(receiver: *mut c_void, sel: *mut c_void, ...) -> *mut c_void;
    }
    unsafe {
        let pi_cls = objc_getClass(b"NSProcessInfo\0".as_ptr());
        if pi_cls.is_null() {
            return;
        }
        let process_info = objc_msgSend(pi_cls, sel_registerName(b"processInfo\0".as_ptr()));
        let end_sel = sel_registerName(b"endActivity:\0".as_ptr());
        let end_fn: unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_void) -> *mut c_void =
            std::mem::transmute(objc_msgSend as *const ());
        end_fn(process_info, end_sel, token as *mut c_void);
        objc_msgSend(token as *mut c_void, sel_registerName(b"release\0".as_ptr()));
    }
}

#[cfg(not(target_os = "macos"))]
fn begin_activity_macos() -> Option<usize> {
    None
}
#[cfg(not(target_os = "macos"))]
fn end_activity_macos(_token: usize) {}

#[tauri::command]
fn set_always_on(webview: Webview, state: tauri::State<AlwaysOnGuard>, enabled: bool) -> Result<bool, String> {
    require_trusted_window(webview.label())?;
    let mut held = state.0.lock().unwrap_or_else(|e| e.into_inner());
    if enabled && held.is_none() {
        *held = begin_activity_macos();
    } else if !enabled {
        if let Some(token) = held.take() {
            end_activity_macos(token);
        }
    }
    Ok(held.is_some())
}

#[tauri::command]
fn get_local_api_port(webview: Webview, state: tauri::State<'_, LocalApiState>) -> Result<u16, String> {
 require_trusted_window(webview.label())?;
 state.port.lock()
 .map_err(|_| "Failed to lock port state".to_string())?
 .ok_or_else(|| "Port not yet assigned".to_string())
}

#[tauri::command]
fn list_supported_secret_keys(webview: Webview) -> Result<Vec<String>, String> {
 require_trusted_window(webview.label())?;
 Ok(SUPPORTED_SECRET_KEYS
 .iter()
 .map(|key| (*key).to_string())
 .collect())
}

/// Whether the async keychain load has finished. The renderer's boot-time
/// secret load polls this before reading any key, so it never memoizes a null
/// for a key that simply hadn't loaded yet (see the async-boot reordering).
#[tauri::command]
fn secrets_ready(webview: Webview, cache: tauri::State<'_, SecretsCache>) -> Result<bool, String> {
 require_trusted_window(webview.label())?;
 Ok(cache.loaded.load(Ordering::SeqCst))
}

#[tauri::command]
fn get_secret(
 webview: Webview,
 key: String,
 cache: tauri::State<'_, SecretsCache>,
) -> Result<Option<String>, String> {
 require_trusted_window(webview.label())?;
 if !SUPPORTED_SECRET_KEYS.contains(&key.as_str()) {
 return Err(format!("Unsupported secret key: {key}"));
 }
 let secrets = cache
 .secrets
 .lock()
 .map_err(|_| "Lock poisoned".to_string())?;
 Ok(secrets.get(&key).cloned())
}

/// Block until the async keychain load has finished before a Settings write
/// builds its `proposed` vault. The window now renders before hydration, so a
/// user can hit Save while the in-memory cache is still empty; cloning that
/// partial snapshot as the save base would persist a vault containing only the
/// edited key and wipe every other stored secret. Waiting guarantees the cache
/// is the full source of truth first. Bounded by the same worst-case the
/// renderer waits on (`save_vault` already blocks on the keychain, so blocking
/// here is consistent). Returns false if it never loads — the caller then
/// refuses the write rather than risk a partial-vault overwrite.
fn wait_until_secrets_loaded(cache: &SecretsCache) -> bool {
 if cache.loaded.load(Ordering::SeqCst) {
 return true;
 }
 // Match the keychain read's own worst case: the 120s vault read plus, on a
 // one-time migration from the legacy per-key format, up to one 3s ACL timeout
 // per supported key. Giving up sooner would reject a save while the cache is
 // still legitimately loading. Mirrors the renderer's waitUntilLoaded cap.
 let max_wait = KEYCHAIN_VAULT_TIMEOUT
 + KEYCHAIN_PER_CALL_TIMEOUT * (SUPPORTED_SECRET_KEYS.len() as u32)
 + Duration::from_secs(30);
 let deadline = Instant::now() + max_wait;
 while Instant::now() < deadline {
 if cache.loaded.load(Ordering::SeqCst) {
 return true;
 }
 std::thread::sleep(Duration::from_millis(50));
 }
 cache.loaded.load(Ordering::SeqCst)
}

#[tauri::command]
fn set_secret(
 webview: Webview,
 key: String,
 value: String,
 cache: tauri::State<'_, SecretsCache>,
) -> Result<(), String> {
 require_trusted_window(webview.label())?;
 if !SUPPORTED_SECRET_KEYS.contains(&key.as_str()) {
 return Err(format!("Unsupported secret key: {key}"));
 }
 if !wait_until_secrets_loaded(&cache) {
 return Err("Secrets are still loading from the keychain; please try again in a moment.".to_string());
 }
 let mut secrets = cache
 .secrets
 .lock()
 .map_err(|_| "Lock poisoned".to_string())?;
 let trimmed = value.trim().to_string();
 // Build proposed state, persist first, then commit to cache
 let mut proposed = secrets.clone();
 if trimmed.is_empty() {
 proposed.remove(&key);
 } else {
 proposed.insert(key.clone(), trimmed);
 }
 save_vault(&proposed)?;
 write_vault_shadow(&webview.app_handle(), &proposed);
 *secrets = proposed;
 // Shield this edit from a still-in-flight async keychain read (see merge).
 if let Ok(mut touched) = cache.user_mutated.lock() {
 touched.insert(key);
 }
 Ok(())
}

/// User-initiated re-read of the keychain vault. The boot read runs on a
/// background worker with a fail-fast 10s timeout so a not-yet-granted ACL can't
/// stall startup — which means if the macOS "Always Allow" dialog isn't answered
/// in that window (e.g. it never surfaced because the app wasn't frontmost), the
/// app falls back to the shadow vault and never retries until the next launch.
/// This command lets the user force the read on demand from Settings: the window
/// is frontmost and they just clicked, so the ACL dialog reliably presents, and
/// a generous 60s timeout gives them time to answer. On success the freshly
/// loaded keys are re-injected into the running sidecar so keyed feeds recover
/// without a relaunch. Returns the number of keys now in the cache.
#[tauri::command]
async fn reload_secrets_from_keychain(webview: Webview) -> Result<usize, String> {
 require_trusted_window(webview.label())?;
 let app = webview.app_handle().clone();
 let load_app = app.clone();
 let secrets: Vec<(String, String)> = tauri::async_runtime::spawn_blocking(move || {
 let cache = load_app.state::<SecretsCache>();
 cache.populate_from_keychain(Some(&load_app), KEYCHAIN_VAULT_INTERACTIVE_TIMEOUT);
 cache
 .secrets
 .lock()
 .map(|m| m.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
 .unwrap_or_default()
 })
 .await
 .map_err(|e| format!("keychain reload task failed: {e}"))?;
 let count = secrets.len();
 inject_secrets_into_running_sidecar(&app, secrets).await;
 append_desktop_log(
 &app,
 "INFO",
 &format!("reload_secrets_from_keychain: loaded {count} keys, re-injected into sidecar"),
 );
 Ok(count)
}

#[tauri::command]
fn delete_secret(webview: Webview, key: String, cache: tauri::State<'_, SecretsCache>) -> Result<(), String> {
 require_trusted_window(webview.label())?;
 if !SUPPORTED_SECRET_KEYS.contains(&key.as_str()) {
 return Err(format!("Unsupported secret key: {key}"));
 }
 if !wait_until_secrets_loaded(&cache) {
 return Err("Secrets are still loading from the keychain; please try again in a moment.".to_string());
 }
 let mut secrets = cache
 .secrets
 .lock()
 .map_err(|_| "Lock poisoned".to_string())?;
 let mut proposed = secrets.clone();
 proposed.remove(&key);
 save_vault(&proposed)?;
 write_vault_shadow(&webview.app_handle(), &proposed);
 *secrets = proposed;
 // Shield this deletion from a still-in-flight async keychain read (see merge).
 if let Ok(mut touched) = cache.user_mutated.lock() {
 touched.insert(key);
 }
 Ok(())
}

/// Sentinel that marks "migration from individual keys has been attempted".
/// Prevents 73 per-key keychain lookups (and their ACL prompts) on every
/// launch once migration has run at least once. Only gates the migration
/// loop — the main secrets-vault read still runs unconditionally.
fn migration_marker_path(app: &AppHandle) -> Option<PathBuf> {
    cache_file_path(app).ok().map(|p| p.with_file_name("secrets-migration-done"))
}

fn migration_done(app: &AppHandle) -> bool {
    migration_marker_path(app).is_some_and(|p| p.exists())
}

fn mark_migration_done(app: &AppHandle) {
    if let Some(path) = migration_marker_path(app) {
        if let Some(parent) = path.parent() { let _ = std::fs::create_dir_all(parent); }
        let _ = std::fs::write(path, b"1");
    }
}

fn cache_file_path(app: &AppHandle) -> Result<PathBuf, String> {
 let dir = app
 .path()
 .app_data_dir()
 .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
 std::fs::create_dir_all(&dir)
 .map_err(|e| format!("Failed to create app data directory {}: {e}", dir.display()))?;
 Ok(dir.join("persistent-cache.json"))
}

// Exclude the app data directory from Time Machine / iCloud backups.
// The persistent-cache.json contains plaintext intelligence data that should
// not leave the machine. Uses the com.apple.metadata:com_apple_backup_excludeItem
// xattr, which is the same mechanism Xcode uses for DerivedData.
#[cfg(target_os = "macos")]
fn exclude_app_data_from_backup(dir: &std::path::Path) {
 let _ = std::process::Command::new("xattr")
 .args([
 "-w",
 "com.apple.metadata:com_apple_backup_excludeItem",
 "com.apple.backup.excludeItem",
 &dir.to_string_lossy(),
 ])
 .output();
}

#[cfg(not(target_os = "macos"))]
fn exclude_app_data_from_backup(_dir: &std::path::Path) {}

#[tauri::command]
fn read_cache_entry(webview: Webview, cache: tauri::State<'_, PersistentCache>, key: String) -> Result<Option<Value>, String> {
 require_trusted_window(webview.label())?;
 Ok(cache.get(&key))
}

#[tauri::command]
fn delete_cache_entry(webview: Webview, app: AppHandle, cache: tauri::State<'_, PersistentCache>, key: String) -> Result<(), String> {
 require_trusted_window(webview.label())?;
 let _write_guard = cache.write_lock.lock().unwrap_or_else(|e| e.into_inner());
 {
 let mut data = cache.data.lock().unwrap_or_else(|e| e.into_inner());
 data.remove(&key);
 }
 {
 let mut dirty = cache.dirty.lock().unwrap_or_else(|e| e.into_inner());
 *dirty = true;
 }
 drop(_write_guard);
 schedule_cache_flush(&app);
 Ok(())
}

#[tauri::command]
fn write_cache_entry(webview: Webview, app: AppHandle, cache: tauri::State<'_, PersistentCache>, key: String, value: String, ttl_ms: Option<u64>) -> Result<(), String> {
 require_trusted_window(webview.label())?;
 if key.len() > 256 {
  return Err("Cache key exceeds 256 byte limit".into());
 }
 if value.len() > 5 * 1024 * 1024 {
  return Err("Cache value exceeds 5 MB limit".into());
 }
 let parsed_value: Value = serde_json::from_str(&value)
 .map_err(|e| format!("Invalid cache payload JSON: {e}"))?;
 let stored_at = SystemTime::now()
  .duration_since(UNIX_EPOCH)
  .map(|d| d.as_millis() as u64)
  .unwrap_or(0);
 let ttl = ttl_ms.unwrap_or(CACHE_TTL_MILLIS);
 let envelope = serde_json::json!({ "v": parsed_value, "stored_at": stored_at, "ttl_ms": ttl });
 let _write_guard = cache.write_lock.lock().unwrap_or_else(|e| e.into_inner());
 {
 let mut data = cache.data.lock().unwrap_or_else(|e| e.into_inner());
 data.insert(key, envelope);
 }
 {
 let mut dirty = cache.dirty.lock().unwrap_or_else(|e| e.into_inner());
 *dirty = true;
 }
 drop(_write_guard);
 schedule_cache_flush(&app);
 Ok(())
}

/// Save a PDF brief to ~/Documents/Crystal Ball Briefs/<filename>.
/// Creates the directory if absent. Restricted to the trusted window list.
#[tauri::command]
fn save_brief(webview: Webview, filename: String, bytes: Vec<u8>) -> Result<String, String> {
 require_trusted_window(webview.label())?;
 if filename.is_empty() || filename.contains('/') || filename.contains('\\') {
  return Err("Invalid filename".into());
 }
 if bytes.len() > 64 * 1024 * 1024 {
  return Err("Brief exceeds 64 MB limit".into());
 }
 let home = std::env::var_os("HOME")
  .map(PathBuf::from)
  .ok_or_else(|| "Cannot determine home directory".to_string())?;
 let dir = home.join("Documents").join("Crystal Ball Briefs");
 fs::create_dir_all(&dir)
  .map_err(|e| format!("Failed to create briefs directory: {e}"))?;
 let path = dir.join(&filename);
 fs::write(&path, &bytes)
  .map_err(|e| format!("Failed to write brief: {e}"))?;
 #[cfg(unix)]
 {
  use std::os::unix::fs::PermissionsExt;
  let perms = fs::Permissions::from_mode(0o600);
  fs::set_permissions(&path, perms).ok();
 }
 Ok(path.display().to_string())
}

fn logs_dir_path(app: &AppHandle) -> Result<PathBuf, String> {
 let dir = app
 .path()
 .app_log_dir()
 .map_err(|e| format!("Failed to resolve app log dir: {e}"))?;
 fs::create_dir_all(&dir)
 .map_err(|e| format!("Failed to create app log dir {}: {e}", dir.display()))?;
 Ok(dir)
}

fn sidecar_log_path(app: &AppHandle) -> Result<PathBuf, String> {
 Ok(logs_dir_path(app)?.join(LOCAL_API_LOG_FILE))
}

fn desktop_log_path(app: &AppHandle) -> Result<PathBuf, String> {
 Ok(logs_dir_path(app)?.join(DESKTOP_LOG_FILE))
}

/// Rotate `path` if it exceeds MAX_LOG_BYTES. Keeps MAX_LOG_BACKUPS numbered copies.
fn rotate_log_if_needed(path: &Path) {
 let size = path.metadata().map(|m| m.len()).unwrap_or(0);
 if size < MAX_LOG_BYTES {
 return;
 }
 // Shift existing backups up: .log.2 → .log.3, .log.1 → .log.2, etc.
 for i in (1..MAX_LOG_BACKUPS).rev() {
 let from = path.with_extension(format!("log.{i}"));
 let to = path.with_extension(format!("log.{}", i + 1));
 let _ = fs::rename(&from, &to);
 }
 // Move current log to .log.1
 let first_backup = path.with_extension("log.1");
 let _ = fs::rename(path, &first_backup);
}

fn append_desktop_log(app: &AppHandle, level: &str, message: &str) {
 let Ok(path) = desktop_log_path(app) else {
 return;
 };

 rotate_log_if_needed(&path);

 let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) else {
 return;
 };
 #[cfg(unix)]
 {
  use std::os::unix::fs::PermissionsExt;
  let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
 }

 // Replace embedded CR/LF so frontend-supplied content can't inject forged
 // log entries into subsequent lines. Each `append_desktop_log` call MUST
 // produce exactly one line.
 let sanitized: String = message
 .chars()
 .map(|c| match c {
 '\n' => ' ',
 '\r' => ' ',
 _ => c,
 })
 .collect();

 let timestamp = SystemTime::now()
 .duration_since(UNIX_EPOCH)
 .map(|d| d.as_secs())
 .unwrap_or(0);
 let _ = writeln!(
 file,
 "[{timestamp}][v{}+{}][{level}] {sanitized}",
 env!("CARGO_PKG_VERSION"),
 BUILD_SHA
 );
}

fn open_in_shell(arg: &str) -> Result<(), String> {
 #[cfg(target_os = "macos")]
 let mut command = {
 let mut cmd = Command::new("open");
 cmd.arg(arg);
 cmd
 };

 #[cfg(target_os = "windows")]
 let mut command = {
 let mut cmd = Command::new("explorer");
 cmd.arg(arg);
 cmd
 };

 #[cfg(all(unix, not(target_os = "macos")))]
 let mut command = {
 let mut cmd = Command::new("xdg-open");
 cmd.arg(arg);
 cmd
 };

 command
 .spawn()
 .map(|_| ())
 .map_err(|e| format!("Failed to open {}: {e}", arg))
}

fn open_path_in_shell(path: &Path) -> Result<(), String> {
 open_in_shell(&path.to_string_lossy())
}

#[tauri::command]
fn open_url(webview: Webview, url: String) -> Result<(), String> {
 require_trusted_window(webview.label())?;
 let parsed = Url::parse(&url).map_err(|_| "Invalid URL".to_string())?;

 // Only HTTPS is allowed. Local/internal URLs must never be opened via this command
 // to prevent a compromised webview from hitting the local API server (127.0.0.1:46123)
 // or other internal services through the system browser.
 if parsed.scheme() != "https" {
 return Err("Only https:// URLs may be opened via open_url".to_string());
 }

 // Block loopback, link-local, and private network hosts even over HTTPS
 let host = parsed.host_str().unwrap_or("");
 let blocked = host == "localhost"
 || host == "127.0.0.1"
 || host == "::1"
 || host.starts_with("192.168.")
 || host.starts_with("10.")
 || host.ends_with(".local");
 if blocked {
 return Err("Internal/private addresses may not be opened via open_url".to_string());
 }

 // URL length guard — browsers accept long URLs but this prevents log spam
 if url.len() > 4096 {
 return Err("URL exceeds maximum allowed length".to_string());
 }

 open_in_shell(parsed.as_str())
}

#[tauri::command]
fn open_system_prefs_location(webview: Webview) -> Result<(), String> {
 require_trusted_window(webview.label())?;
 open_in_shell("x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices")
}

/// Get device location via native CoreLocation (bypasses WKWebView geolocation block).
/// Gated by `require_trusted_window` so an external-origin window (e.g. the
/// YouTube login WebView) cannot exfiltrate GPS coordinates even if its
/// capability config is ever broadened.
#[tauri::command]
fn get_native_location(webview: Webview) -> Result<(f64, f64), String> {
 require_trusted_window(webview.label())?;
 get_native_location_impl()
}

#[cfg(target_os = "macos")]
fn get_native_location_impl() -> Result<(f64, f64), String> {
 use std::ffi::c_void;
 extern "C" {
 fn objc_getClass(name: *const u8) -> *mut c_void;
 fn sel_registerName(name: *const u8) -> *mut c_void;
 fn objc_msgSend(receiver: *mut c_void, sel: *mut c_void, ...) -> *mut c_void;
 fn objc_retain(obj: *mut c_void) -> *mut c_void;
 fn objc_release(obj: *mut c_void);
 }

 #[repr(C)]
 #[derive(Copy, Clone)]
 struct CLLocationCoordinate2D { latitude: f64, longitude: f64 }

 unsafe {
 let cls = objc_getClass(b"CLLocationManager\0".as_ptr());
 if cls.is_null() { return Err("CoreLocation not available".into()); }
 let alloc = sel_registerName(b"alloc\0".as_ptr());
 let init = sel_registerName(b"init\0".as_ptr());
 let mgr = objc_msgSend(objc_msgSend(cls, alloc), init);
 if mgr.is_null() { return Err("Could not create CLLocationManager".into()); }

 // Only proceed if the app is ALREADY authorized. Authorization is requested
 // exactly once by the app-retained manager in setup(); calling
 // startUpdatingLocation on an undetermined manager here spawns a SECOND
 // prompt racing that request (the "double prompt on first run"). When not yet
 // authorized, release + return so the caller falls back (IP geolocation)
 // until the single prompt is answered; later calls then succeed silently.
 let auth_sel = sel_registerName(b"authorizationStatus\0".as_ptr());
 let auth_fn: unsafe extern "C" fn(*mut c_void, *mut c_void) -> i32 =
  std::mem::transmute(objc_msgSend as *const ());
 let status = auth_fn(mgr, auth_sel);
 // CLAuthorizationStatus: 3 = authorizedAlways, 4 = authorizedWhenInUse.
 if status != 3 && status != 4 {
  let release = sel_registerName(b"release\0".as_ptr());
  objc_msgSend(mgr, release);
  return Err("Location not yet authorized — grant Location Services for Crystal Ball in System Settings, then retry".into());
 }

 let start = sel_registerName(b"startUpdatingLocation\0".as_ptr());
 objc_msgSend(mgr, start);

 // Poll for a location fix (up to 10 seconds)
 let location_sel = sel_registerName(b"location\0".as_ptr());
 let coord_sel = sel_registerName(b"coordinate\0".as_ptr());
 let mut loc: *mut c_void = std::ptr::null_mut();
 for _ in 0..100 {
  loc = objc_msgSend(mgr, location_sel);
  if !loc.is_null() { break; }
  std::thread::sleep(Duration::from_millis(100));
 }

 // The manager owns `loc`; retain it before releasing the manager so the
 // coordinate read below is not a use-after-free.
 if !loc.is_null() {
  objc_retain(loc);
 }

 let stop = sel_registerName(b"stopUpdatingLocation\0".as_ptr());
 objc_msgSend(mgr, stop);
 let release = sel_registerName(b"release\0".as_ptr());
 objc_msgSend(mgr, release);

 if loc.is_null() {
  return Err("Location not available — ensure Location Services is enabled for Crystal Ball in System Settings".into());
 }

 // On ARM64, CLLocationCoordinate2D (16 bytes) is returned in registers.
 // We hold our own retain on `loc`, so this is safe after the manager release.
 let coord_fn: unsafe extern "C" fn(*mut c_void, *mut c_void) -> CLLocationCoordinate2D =
  std::mem::transmute(objc_msgSend as *const ());
 let coord = coord_fn(loc, coord_sel);
 objc_release(loc);

 if coord.latitude == 0.0 && coord.longitude == 0.0 {
  return Err("Location returned 0,0 — GPS may not have a fix yet".into());
 }

 Ok((coord.latitude, coord.longitude))
 }
}

#[cfg(not(target_os = "macos"))]
fn get_native_location_impl() -> Result<(f64, f64), String> {
 Err("Native location only supported on macOS".into())
}

fn open_logs_folder_impl(app: &AppHandle) -> Result<PathBuf, String> {
 let dir = logs_dir_path(app)?;
 open_path_in_shell(&dir)?;
 Ok(dir)
}

fn open_sidecar_log_impl(app: &AppHandle) -> Result<PathBuf, String> {
 let log_path = sidecar_log_path(app)?;
 if !log_path.exists() {
 File::create(&log_path)
 .map_err(|e| format!("Failed to create sidecar log {}: {e}", log_path.display()))?;
 #[cfg(unix)]
 {
 use std::os::unix::fs::PermissionsExt;
 let _ = fs::set_permissions(&log_path, fs::Permissions::from_mode(0o600));
 }
 }
 open_path_in_shell(&log_path)?;
 Ok(log_path)
}

#[tauri::command]
fn open_logs_folder(webview: Webview, app: AppHandle) -> Result<String, String> {
 require_trusted_window(webview.label())?;
 open_logs_folder_impl(&app).map(|path| path.display().to_string())
}

#[tauri::command]
fn open_sidecar_log_file(webview: Webview, app: AppHandle) -> Result<String, String> {
 require_trusted_window(webview.label())?;
 open_sidecar_log_impl(&app).map(|path| path.display().to_string())
}

#[tauri::command]
async fn open_settings_window_command(webview: Webview, app: AppHandle) -> Result<(), String> {
 require_trusted_window(webview.label())?;
 if let Some(win) = app.get_webview_window("main") {
 let _ = win.eval("document.dispatchEvent(new CustomEvent('wm:open-settings'))");
 }
 Ok(())
}

#[tauri::command]
fn close_settings_window(webview: Webview, app: AppHandle) -> Result<(), String> {
 require_trusted_window(webview.label())?;
 if let Some(window) = app.get_webview_window("settings") {
 window
 .close()
 .map_err(|e| format!("Failed to close settings window: {e}"))?;
 }
 Ok(())
}

/// Truncate a UTF-8 string to at most `max_bytes` bytes without splitting a multi-byte codepoint.
fn truncate_to_bytes(s: &str, max_bytes: usize) -> &str {
 if s.len() <= max_bytes {
 return s;
 }
 let mut boundary = max_bytes;
 while !s.is_char_boundary(boundary) {
 boundary -= 1;
 }
 &s[..boundary]
}

/// Send a native macOS notification via osascript. No-op on non-macOS platforms.
/// Rate-limited to 1 notification per 30 seconds to prevent notification spam.
/// Input fields are length-capped and sanitized before interpolation into AppleScript.
#[tauri::command]
fn send_notification(webview: Webview, title: String, body: String, sound: Option<String>) -> Result<(), String> {
 require_trusted_window(webview.label())?;
 #[cfg(not(target_os = "macos"))]
 {
 let _ = (title, body, sound);
 return Ok(());
 }
 #[cfg(target_os = "macos")]
 {
 // Rate limit: silently drop if fired too recently
 {
 let mut last = NOTIFICATION_LAST_SENT.lock().unwrap_or_else(|p| p.into_inner());
 if let Some(t) = *last {
 if t.elapsed() < NOTIFICATION_RATE_LIMIT {
 return Ok(()); // suppressed — too soon
 }
 }
 *last = Some(Instant::now());
 }

 // Enforce length limits to bound log size and script length
 let title = truncate_to_bytes(&title, 128);
 let body  = truncate_to_bytes(&body, 256);
 let sound_name = sound.as_deref().unwrap_or("Ping");
 let sound_name = truncate_to_bytes(sound_name, 64);

 // Sanitize: remove characters that have meaning in AppleScript string literals.
 // We use double-quoted AppleScript strings so we strip " and \ (escape char).
 // Newlines and control chars are also removed to prevent multi-statement injection.
 let sanitize = |s: &str| -> String {
 s.chars()
 .filter(|c| !matches!(c, '"' | '\\' | '\n' | '\r' | '\x00'..='\x1f'))
 .collect()
 };
 let safe_title = sanitize(title);
 let safe_body  = sanitize(body);
 let safe_sound = sanitize(sound_name);

 let script = format!(
 r#"display notification "{safe_body}" with title "{safe_title}" sound name "{safe_sound}""#
 );
 Command::new("osascript")
 .args(["-e", &script])
 .stdout(Stdio::null())
 .stderr(Stdio::null())
 .spawn()
 .map_err(|e| format!("osascript spawn failed: {e}"))?;
 Ok(())
 }
}

/// Send an iMessage / SMS to a contact via the user's signed-in macOS Messages
/// app. No-op on non-macOS. Reuses the same sanitization, length-cap, and
/// trusted-window pattern as send_notification — recipient and body are
/// stripped of AppleScript-meaningful characters before interpolation, so a
/// hostile body string can't escape the quoted literal and run extra
/// statements.
///
/// Rate-limited to 1 message per 30 seconds (shared with the notification
/// limiter) so a runaway alert source can't burn through the user's Messages.
#[tauri::command]
fn send_imessage(webview: Webview, recipient: String, body: String) -> Result<(), String> {
 require_trusted_window(webview.label())?;
 #[cfg(not(target_os = "macos"))]
 {
 let _ = (recipient, body);
 return Err("iMessage is only available on macOS".to_string());
 }
 #[cfg(target_os = "macos")]
 {
 {
 let mut last = IMESSAGE_LAST_SENT.lock().unwrap_or_else(|p| p.into_inner());
 if let Some(t) = *last {
 if t.elapsed() < NOTIFICATION_RATE_LIMIT {
 return Err("Rate limit: too soon since the last iMessage".to_string());
 }
 }
 *last = Some(Instant::now());
 }

 let recipient = truncate_to_bytes(&recipient, 64);
 let body = truncate_to_bytes(&body, 512);
 if recipient.trim().is_empty() {
 return Err("Recipient is required".to_string());
 }
 if body.trim().is_empty() {
 return Err("Message body is required".to_string());
 }

 let sanitize = |s: &str| -> String {
 s.chars()
 .filter(|c| !matches!(c, '"' | '\\' | '\n' | '\r' | '\x00'..='\x1f'))
 .collect()
 };
 let safe_recipient = sanitize(&recipient);
 let safe_body = sanitize(&body);

 // Use the iMessage service explicitly — falls back gracefully if the
 // recipient is only reachable via SMS by erroring inside Messages.
 let script = format!(
 r#"tell application "Messages"
  set targetService to 1st service whose service type = iMessage
  set targetBuddy to buddy "{safe_recipient}" of targetService
  send "{safe_body}" to targetBuddy
end tell"#
 );

 let status = Command::new("osascript")
 .args(["-e", &script])
 .stdout(Stdio::null())
 .stderr(Stdio::null())
 .status()
 .map_err(|e| format!("osascript spawn failed: {e}"))?;
 if !status.success() {
 return Err("Messages app rejected the send (recipient unreachable, not signed in, or blocked)".to_string());
 }
 Ok(())
 }
}

/// Speak a short alert message aloud via macOS `say`. No-op on non-macOS.
/// Same trusted-window + length-cap + sanitization pattern as
/// `send_notification`, with a separate 5-second rate limit so stacked
/// alerts don't queue overlapping utterances.
#[tauri::command]
fn speak_aloud(
 webview: Webview,
 text: String,
 voice: Option<String>,
 rate: Option<u32>,
) -> Result<(), String> {
 require_trusted_window(webview.label())?;
 #[cfg(not(target_os = "macos"))]
 {
 let _ = (text, voice, rate);
 return Ok(());
 }
 #[cfg(target_os = "macos")]
 {
 {
 let mut last = VOICE_LAST_SENT.lock().unwrap_or_else(|p| p.into_inner());
 if let Some(t) = *last {
 if t.elapsed() < VOICE_RATE_LIMIT {
 return Ok(()); // suppressed — too soon
 }
 }
 *last = Some(Instant::now());
 }

 let text = truncate_to_bytes(&text, 256);
 let voice_name = voice.as_deref().unwrap_or("Samantha");
 let voice_name = truncate_to_bytes(voice_name, 32);
 let speech_rate = rate.unwrap_or(180).clamp(90, 360);

 // Sanitize: strip control chars + characters that could break `say` argv
 // parsing. `say` takes the message as a positional arg via std::process::Command,
 // so shell metacharacters aren't an issue, but we still reject control chars
 // to avoid embedded escape sequences.
 let sanitize = |s: &str| -> String {
 s.chars()
 .filter(|c| !matches!(c, '\x00'..='\x1f' | '\x7f'))
 .collect()
 };
 let safe_text = sanitize(text);
 let safe_voice = sanitize(voice_name);
 if safe_text.trim().is_empty() {
 return Err("speak_aloud: empty text".to_string());
 }

 Command::new("say")
 .args(["-v", &safe_voice, "-r", &speech_rate.to_string(), &safe_text])
 .stdout(Stdio::null())
 .stderr(Stdio::null())
 .spawn()
 .map_err(|e| format!("say spawn failed: {e}"))?;
 Ok(())
 }
}

/// Download a macOS DMG release, mount it, copy the app bundle to /Applications, and relaunch.
/// On non-macOS platforms returns an error immediately (no-op — only called on macOS).
#[cfg(target_os = "macos")]
fn resolve_update_install_path() -> Result<String, String> {
 let current_exe = env::current_exe()
 .map_err(|e| format!("Resolve current executable failed: {e}"))?;
 let mut cursor = current_exe.as_path();
 loop {
 if cursor
 .extension()
 .and_then(|ext| ext.to_str())
 .map(|ext| ext.eq_ignore_ascii_case("app"))
 .unwrap_or(false)
 {
 return Ok(cursor.to_string_lossy().to_string());
 }
 cursor = cursor
 .parent()
 .ok_or_else(|| "Could not resolve active app bundle path".to_string())?;
 }
}

/// R2-SEC-009/011: mandatory expected-SHA-256 validation for the updater.
/// Returns the normalized lowercase hex string, or an error describing why
/// the value is unusable (missing, malformed, wrong length). Pure / side-effect
/// free so it can be unit-tested without the macOS cfg gate.
fn validate_expected_sha256(raw: Option<&str>) -> Result<String, String> {
 let trimmed = raw.map(|s| s.trim()).unwrap_or("");
 if trimmed.is_empty() {
 return Err(
 "Aborting update: no expected SHA-256 supplied (release manifest missing or unreadable)"
 .to_string(),
 );
 }
 let normalized = trimmed.to_ascii_lowercase();
 if normalized.len() != 64 || !normalized.chars().all(|c| c.is_ascii_hexdigit()) {
 return Err(format!(
 "Aborting update: expected SHA-256 is malformed (must be 64 hex chars), got {} chars",
 normalized.len()
 ));
 }
 Ok(normalized)
}

/// R2-SEC-009/011: host allowlist enforced for any URL the updater
/// will download from. Returns Ok if the URL parses and its host is
/// one of GitHub's release-asset hosts; Err otherwise.
fn validate_update_url(raw: &str) -> Result<(), String> {
 let parsed = reqwest::Url::parse(raw).map_err(|e| format!("Invalid update URL: {e}"))?;
 let host = parsed.host_str().unwrap_or("");
 if !matches!(host, "objects.githubusercontent.com" | "github.com" | "codeload.github.com") {
 return Err(format!(
 "Update URL host '{host}' is not trusted — must be from github.com"
 ));
 }
 Ok(())
}

#[cfg(target_os = "macos")]
fn verify_app_bundle_signature(app_path: &str, label: &str) -> Result<(), String> {
 let verify = Command::new("codesign")
 .args(["--verify", "--deep", "--strict", app_path])
 .output()
 .map_err(|e| format!("codesign verify failed for {label}: {e}"))?;
 if !verify.status.success() {
 return Err(format!(
 "{label} signature verification failed: {}",
 String::from_utf8_lossy(&verify.stderr)
 ));
 }
 Ok(())
}

#[cfg(target_os = "macos")]
fn copy_app_bundle_preserving_signature(source: &str, dest: &str) -> Result<(), String> {
 let copy = Command::new("ditto")
 .args([source, dest])
 .output()
 .map_err(|e| format!("ditto failed: {e}"))?;
 if !copy.status.success() {
 return Err(format!(
 "Copy to install path failed: {}",
 String::from_utf8_lossy(&copy.stderr)
 ));
 }
 Ok(())
}

#[tauri::command]
async fn install_update(webview: Webview, download_url: String, expected_sha256: Option<String>) -> Result<(), String> {
 require_trusted_window(webview.label())?;
 // R2-SEC-009/011: enforce GitHub-host allowlist + mandatory hash up-front
 // so a bad request is rejected before any network or filesystem activity.
 validate_update_url(&download_url)?;
 let _ = validate_expected_sha256(expected_sha256.as_deref())?;

 #[cfg(not(target_os = "macos"))]
 {
 let _ = (download_url, expected_sha256);
 return Err("Auto-install is only supported on macOS".into());
 }

 #[cfg(target_os = "macos")]
 {
 let tmp_dmg = "/tmp/wm-update.dmg";
 let mount_point = "/tmp/wm-update-vol";

 // 1. Download the DMG
 let client = reqwest::Client::builder()
 .use_native_tls()
 .user_agent(concat!("CrystalBall-Desktop/", env!("CARGO_PKG_VERSION")))
 .timeout(std::time::Duration::from_secs(300))
 .build()
 .map_err(|e| format!("HTTP client init failed: {e}"))?;

 let resp = client
 .get(&download_url)
 .send()
 .await
 .map_err(|e| format!("Download failed: {e}"))?;

 if !resp.status().is_success() {
 return Err(format!("Download HTTP {}", resp.status()));
 }

 let bytes = resp.bytes().await
 .map_err(|e| format!("Download read failed: {e}"))?;

 // 1a. Verify SHA-256 of downloaded bytes BEFORE writing to disk or mounting.
 // This detects corruption and MITM-served payloads before the OS processes the file.
 // R2-SEC-009/011: hash verification is MANDATORY. An absent or empty expected
 // hash means the release manifest was missing or tampered with — abort rather
 // than fall through to codesign-only verification.
 let expected_hex = validate_expected_sha256(expected_sha256.as_deref())?;
 let actual_sha256 = {
 let mut hasher = Sha256::new();
 hasher.update(&bytes);
 hasher.finalize().iter().map(|b| format!("{:02x}", b)).collect::<String>()
 };
 if actual_sha256 != expected_hex {
 return Err(format!(
 "SHA-256 mismatch — aborting update: expected {expected_hex}, got {actual_sha256}"
 ));
 }

 std::fs::write(tmp_dmg, &bytes)
 .map_err(|e| format!("Write DMG to /tmp failed: {e}"))?;

 // 2. Mount the DMG
 let attach = Command::new("hdiutil")
 .args(["attach", tmp_dmg, "-mountpoint", mount_point, "-nobrowse", "-quiet"])
 .output()
 .map_err(|e| format!("hdiutil attach failed: {e}"))?;

 if !attach.status.success() {
 let _ = std::fs::remove_file(tmp_dmg);
 return Err(format!(
 "hdiutil attach error: {}",
 String::from_utf8_lossy(&attach.stderr)
 ));
 }

 // 3. Verify the app bundle identifier before replacing the active install.
 // This prevents a compromised GitHub account or MITM from replacing the app
 // with a malicious binary that passes the host check but is not Crystal Ball.
 let source = format!("{}/Crystal Ball.app", mount_point);
 let dest = resolve_update_install_path()?;
 let staged = format!("{dest}.update-staged");
 let backup = format!("{dest}.update-backup");

 const EXPECTED_BUNDLE_ID: &str = "com.bradleybond.crystalball";
 let plist = format!("{source}/Contents/Info.plist");
 let id_check = Command::new("plutil")
 .args(["-extract", "CFBundleIdentifier", "raw", "-o", "-", &plist])
 .output();
 match id_check {
 Ok(out) if out.status.success() => {
 let bundle_id = String::from_utf8_lossy(&out.stdout).trim().to_string();
 if bundle_id != EXPECTED_BUNDLE_ID {
 let _ = Command::new("hdiutil").args(["detach", mount_point, "-quiet"]).output();
 let _ = std::fs::remove_file(tmp_dmg);
 return Err(format!(
 "Bundle identifier mismatch: expected '{EXPECTED_BUNDLE_ID}', got '{bundle_id}'"
 ));
 }
 }
 _ => {
 let _ = Command::new("hdiutil").args(["detach", mount_point, "-quiet"]).output();
 let _ = std::fs::remove_file(tmp_dmg);
 return Err("Could not verify bundle identifier — aborting update".into());
 }
 }

 verify_app_bundle_signature(&source, "Mounted app bundle")?;
 let _ = fs::remove_dir_all(&staged);
 let _ = fs::remove_dir_all(&backup);

 let install_result = (|| -> Result<(), String> {
 copy_app_bundle_preserving_signature(&source, &staged)?;
 verify_app_bundle_signature(&staged, "Staged app")?;

 if Path::new(&dest).exists() {
 fs::rename(&dest, &backup)
 .map_err(|e| format!("Move existing install to backup failed: {e}"))?;
 }

 if let Err(e) = fs::rename(&staged, &dest) {
 let _ = fs::remove_dir_all(&dest);
 if Path::new(&backup).exists() {
 let _ = fs::rename(&backup, &dest);
 }
 return Err(format!("Swap staged app into install path failed: {e}"));
 }

 verify_app_bundle_signature(&dest, "Installed app")?;
 let _ = fs::remove_dir_all(&backup);
 Ok(())
 })();

 // 4. Detach the DMG and clean up regardless of install result
 let _ = Command::new("hdiutil").args(["detach", mount_point, "-quiet"]).output();
 let _ = std::fs::remove_file(tmp_dmg);

 install_result?;

 // 5. Relaunch and exit
 let _ = Command::new("open").arg(&dest).spawn();
 std::process::exit(0);
 }
}

/// Fetch JSON from Polymarket Gamma API using native TLS (bypasses Cloudflare JA3 blocking).
/// Called from frontend when browser CORS and sidecar Node.js TLS both fail.
#[tauri::command]
async fn fetch_polymarket(webview: Webview, path: String, params: String) -> Result<String, String> {
 require_trusted_window(webview.label())?;
 let allowed = ["events", "markets", "tags"];
 let segment = path.trim_start_matches('/');
 if !allowed.iter().any(|a| segment.starts_with(a)) {
 return Err("Invalid Polymarket path".into());
 }
 // Reject path traversal and unusual characters in the path segment
 if segment.contains("..") || segment.contains('\n') || segment.contains('\r') {
 return Err("Invalid characters in Polymarket path".into());
 }
 // Guard against extremely long params strings that could be used for log injection
 if params.len() > 2048 {
 return Err("Polymarket query params exceed maximum allowed length".into());
 }
 if params.contains('\n') || params.contains('\r') || params.contains('#') {
 return Err("invalid params".to_string());
 }
 let url = format!("https://gamma-api.polymarket.com/{}?{}", segment, params);
 let client = reqwest::Client::builder()
 .use_native_tls()
 .build()
 .map_err(|e| format!("HTTP client error: {e}"))?;
 let resp = client
 .get(&url)
 .header("Accept", "application/json")
 .timeout(std::time::Duration::from_secs(10))
 .send()
 .await
 .map_err(|e| format!("Polymarket fetch failed: {e}"))?;
 if !resp.status().is_success() {
 return Err(format!("Polymarket HTTP {}", resp.status()));
 }
 resp.text()
 .await
 .map_err(|e| format!("Read body failed: {e}"))
}


/// Navigation guard for the live-channels auxiliary window.
///
/// This window carries the same `require_trusted_window` IPC privileges as
/// `main` (it can read secrets), so it must follow the same release-build rule:
/// never navigable to an arbitrary loopback service, or a compromised renderer
/// could redirect it to a sibling port and inherit those privileges.
///
/// - Production: `tauri://` bundled content, plus the `tauri.localhost`
///   WebView2 workaround origin (parity with `is_main_window_navigation`). The
///   window loads its document from the bundled asset and only *fetches* (never
///   navigates to) the sidecar, so loopback is not needed.
/// - Debug builds only: the Vite dev server / sidecar loopback origins, because
///   in dev the window is loaded directly from one of them and reloads re-enter
///   this guard. Compiled out of release builds.
fn is_trusted_window_navigation(url: &Url) -> bool {
 if url.scheme() == "tauri" {
  return true;
 }
 if matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost") {
  return true;
 }
 #[cfg(debug_assertions)]
 if matches!(url.scheme(), "http" | "https")
  && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1" | "[::1]"))
 {
  return true;
 }
 false
}

/// Tighter navigation guard for the main window only.
///
/// The main window holds all trusted-window IPC privileges. Unlike auxiliary
/// windows (live-channels) it never needs to navigate to a local HTTP service,
/// so the allowed set is stricter:
/// - Production: `tauri://` bundled content, plus the `tauri.localhost`
///   WebView2 workaround origin that serves bundled app content on Windows.
/// - Debug builds: also `localhost` (the Vite dev server at `devUrl`).
///
/// `127.0.0.1` at any port is intentionally excluded — a compromised renderer
/// that redirected `main` to a sibling service on loopback would inherit all
/// `require_trusted_window` privileges.
fn is_main_window_navigation(url: &Url) -> bool {
 if url.scheme() == "tauri" {
  return true;
 }
 // Windows production builds serve bundled `WebviewUrl::App` content through
 // the WebView2 workaround origin `http(s)://tauri.localhost` rather than the
 // `tauri://` scheme. That host resolves to the bundled app itself — not a
 // real loopback service — so it carries the same trust as `tauri://` and must
 // be allowed; otherwise same-origin `window.location.reload()` after
 // settings / API-key changes is canceled on Windows.
 if matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost") {
  return true;
 }
 // Dev server only; compile-gated so the loopback escape hatch is absent
 // from release builds.
 #[cfg(debug_assertions)]
 if url.host_str() == Some("localhost") {
  return true;
 }
 false
}

fn open_live_channels_window(app: &AppHandle, base_url: Option<String>) -> Result<(), String> {
 if let Some(window) = app.get_webview_window("live-channels") {
 let _ = window.show();
 window
 .set_focus()
 .map_err(|e| format!("Failed to focus live channels window: {e}"))?;
 return Ok(());
 }

 // In dev, use the same origin as the main window (e.g. http://localhost:3001) so we don't
 // get "connection refused" when Vite runs on a different port than devUrl.
 let url = match base_url {
 Some(ref origin) if !origin.is_empty() => {
 let path = origin.trim_end_matches('/');
 let full_url = format!("{}/live-channels.html", path);
 let parsed = Url::parse(&full_url).map_err(|_| "Invalid base URL".to_string())?;
 // This window holds the same IPC trust as `main`, so it must never be
 // navigated to an attacker-supplied origin. Only loopback dev origins are
 // honored; anything else falls back to the bundled app asset.
 let host = parsed.host_str().unwrap_or("");
 let is_loopback_dev = matches!(parsed.scheme(), "http" | "https")
 && matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]");
 if is_loopback_dev {
 WebviewUrl::External(parsed)
 } else {
 WebviewUrl::App("live-channels.html".into())
 }
 }
 _ => WebviewUrl::App("live-channels.html".into()),
 };

 let _live_channels_window = WebviewWindowBuilder::new(app, "live-channels", url)
 .title("Channel management - Crystal Ball")
 .inner_size(680.0, 760.0)
 .min_inner_size(520.0, 600.0)
 .resizable(true)
 .on_navigation(is_trusted_window_navigation)
 .background_color(tauri::webview::Color(26, 28, 30, 255))
 .build()
 .map_err(|e| format!("Failed to create live channels window: {e}"))?;

 #[cfg(not(target_os = "macos"))]
 let _ = _live_channels_window.remove_menu();

 Ok(())
}

fn open_youtube_login_window(app: &AppHandle) -> Result<(), String> {
 if let Some(window) = app.get_webview_window("youtube-login") {
 let _ = window.show();
 window
 .set_focus()
 .map_err(|e| format!("Failed to focus YouTube login window: {e}"))?;
 return Ok(());
 }

 let url = WebviewUrl::External(
 Url::parse("https://accounts.google.com/ServiceLogin?service=youtube&continue=https://www.youtube.com/")
 .map_err(|e| format!("Invalid URL: {e}"))?
 );

 let notified = Arc::new(AtomicBool::new(false));
 let notified_nav = notified.clone();
 let app_nav = app.clone();

 let _yt_window = WebviewWindowBuilder::new(app, "youtube-login", url)
 .title("Sign in to YouTube")
 .inner_size(500.0, 700.0)
 .resizable(true)
 .on_navigation(move |nav_url| {
 let host = nav_url.host_str().unwrap_or("");
 if (host == "www.youtube.com" || host == "youtube.com")
 && !notified_nav.swap(true, Ordering::SeqCst)
 {
 let app_clone = app_nav.clone();
 std::thread::spawn(move || {
 if let Some(main_win) = app_clone.get_webview_window("main") {
 let _ = main_win.eval(
 "document.dispatchEvent(new CustomEvent('wm:youtube-signed-in'))"
 );
 }
 std::thread::sleep(std::time::Duration::from_millis(800));
 if let Some(w) = app_clone.get_webview_window("youtube-login") {
 let _ = w.close();
 }
 });
 }
 true
 })
 .build()
 .map_err(|e| format!("Failed to create YouTube login window: {e}"))?;

 #[cfg(not(target_os = "macos"))]
 let _ = _yt_window.remove_menu();

 Ok(())
}

#[tauri::command]
async fn open_youtube_login(webview: Webview, app: AppHandle) -> Result<(), String> {
 require_trusted_window(webview.label())?;
 open_youtube_login_window(&app)
}

#[tauri::command]
async fn open_youtube_logout(webview: Webview, app: AppHandle) -> Result<(), String> {
 require_trusted_window(webview.label())?;
 if let Some(main_win) = app.get_webview_window("main") {
 let _ = main_win.eval(
 "document.dispatchEvent(new CustomEvent('wm:youtube-signed-out'))"
 );
 }
 Ok(())
}

/// Update the macOS dock badge with an unread-alert count.
///
/// `count == 0` clears the badge. We use objc directly rather than Tauri's
/// platform helper because it avoids enabling additional Tauri features and
/// matches the pattern already used for `CLLocationManager` initialization.
/// No-op on non-macOS platforms.
#[tauri::command]
fn set_dock_badge(webview: Webview, count: u32) -> Result<(), String> {
 require_trusted_window(webview.label())?;
 #[cfg(target_os = "macos")]
 {
  use std::ffi::{c_char, c_void, CString};
  extern "C" {
   fn objc_getClass(name: *const u8) -> *mut c_void;
   fn sel_registerName(name: *const u8) -> *mut c_void;
   fn objc_msgSend(receiver: *mut c_void, sel: *mut c_void, ...) -> *mut c_void;
  }
  unsafe {
   // Apple Silicon ABI: variadic args are always passed on the stack, but
   // `objc_msgSend` itself is non-variadic and reads its args from
   // registers (x2+). Calling the variadic-typed `objc_msgSend` with any
   // trailing argument therefore reads garbage from x2 — which is what
   // caused `+[NSString stringWithUTF8String:]` to segfault inside
   // `strlen` on every launch. Cast to concrete non-variadic signatures
   // for the two calls that actually pass an argument; the zero-arg
   // calls (`sharedApplication`, `dockTile`) are safe via the variadic
   // declaration because no varargs means no ABI mismatch.
   let msgsend_cstr: unsafe extern "C" fn(*mut c_void, *mut c_void, *const c_char) -> *mut c_void =
    std::mem::transmute(objc_msgSend as *const ());
   let msgsend_obj: unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_void) -> *mut c_void =
    std::mem::transmute(objc_msgSend as *const ());

   let nsapp_cls = objc_getClass(b"NSApplication\0".as_ptr());
   if nsapp_cls.is_null() { return Ok(()); }
   let shared_sel = sel_registerName(b"sharedApplication\0".as_ptr());
   let app_inst = objc_msgSend(nsapp_cls, shared_sel);
   if app_inst.is_null() { return Ok(()); }
   let dock_tile_sel = sel_registerName(b"dockTile\0".as_ptr());
   let tile = objc_msgSend(app_inst, dock_tile_sel);
   if tile.is_null() { return Ok(()); }

   // Build an NSString from the count (or empty string to clear).
   let cstr = if count == 0 { CString::new("").unwrap() } else { CString::new(count.to_string()).unwrap() };
   let nsstring_cls = objc_getClass(b"NSString\0".as_ptr());
   let from_utf8_sel = sel_registerName(b"stringWithUTF8String:\0".as_ptr());
   let label = msgsend_cstr(nsstring_cls, from_utf8_sel, cstr.as_ptr());

   let set_label_sel = sel_registerName(b"setBadgeLabel:\0".as_ptr());
   msgsend_obj(tile, set_label_sel, label);
  }
 }
 let _ = count;
 Ok(())
}

/// Update the macOS menubar (system tray) status indicator. Accepts one of
/// "green", "yellow", "red"; anything else clears to green.
///
/// The status item itself is created lazily by `ensure_menubar_status_item`
/// the first time this command runs, and intentionally leaked so it survives
/// for the process lifetime (NSStatusBar will release it otherwise).
#[tauri::command]
fn set_menubar_status(webview: Webview, level: String) -> Result<(), String> {
 require_trusted_window(webview.label())?;
 #[cfg(target_os = "macos")]
 {
  let icon = match level.as_str() {
   "red" => "🔴 Crystal Ball",
   "yellow" => "🟡 Crystal Ball",
   _ => "🟢 Crystal Ball",
  };
  unsafe { ensure_menubar_status_item(icon) };
 }
 let _ = level;
 Ok(())
}

#[cfg(target_os = "macos")]
static MENUBAR_STATUS_ITEM: std::sync::OnceLock<usize> = std::sync::OnceLock::new();

#[cfg(target_os = "macos")]
unsafe fn ensure_menubar_status_item(title: &str) {
 use std::ffi::{c_char, c_void, CString};
 extern "C" {
  fn objc_getClass(name: *const u8) -> *mut c_void;
  fn sel_registerName(name: *const u8) -> *mut c_void;
  fn objc_msgSend(receiver: *mut c_void, sel: *mut c_void, ...) -> *mut c_void;
  fn objc_retain(obj: *mut c_void) -> *mut c_void;
 }

 // Apple Silicon ABI: the variadic-typed `objc_msgSend` passes trailing
 // arguments on the stack, but the real (non-variadic) `objc_msgSend` reads
 // them from registers (x2+) — so any call that passes an argument through
 // the variadic declaration reads garbage. That crashed
 // `+[NSString stringWithUTF8String:]` inside `strlen` on every launch (the
 // same bug already fixed in `set_dock_badge`). Cast to concrete signatures
 // for the calls that pass an argument; the zero-arg calls
 // (`systemStatusBar`, `button`) stay safe via the variadic declaration.
 let msgsend_f64: unsafe extern "C" fn(*mut c_void, *mut c_void, f64) -> *mut c_void =
  std::mem::transmute(objc_msgSend as *const ());
 let msgsend_cstr: unsafe extern "C" fn(*mut c_void, *mut c_void, *const c_char) -> *mut c_void =
  std::mem::transmute(objc_msgSend as *const ());
 let msgsend_obj: unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_void) -> *mut c_void =
  std::mem::transmute(objc_msgSend as *const ());

 // Lazily create the NSStatusItem once.
 let item_ptr = MENUBAR_STATUS_ITEM.get_or_init(|| {
  let bar_cls = objc_getClass(b"NSStatusBar\0".as_ptr());
  if bar_cls.is_null() { return 0; }
  let system_sel = sel_registerName(b"systemStatusBar\0".as_ptr());
  let bar = objc_msgSend(bar_cls, system_sel);
  if bar.is_null() { return 0; }
  // -1 == NSVariableStatusItemLength so the title sizes the item.
  let new_item_sel = sel_registerName(b"statusItemWithLength:\0".as_ptr());
  let item = msgsend_f64(bar, new_item_sel, -1.0f64);
  if item.is_null() { return 0; }
  // Retain so the system status bar can't drop it after our scope.
  let _ = objc_retain(item);
  item as usize
 });
 if *item_ptr == 0 { return; }
 let item = *item_ptr as *mut c_void;

 // statusItem.button.title = title
 let button_sel = sel_registerName(b"button\0".as_ptr());
 let btn = objc_msgSend(item, button_sel);
 if btn.is_null() { return; }
 let cstr = CString::new(title).unwrap_or_else(|_| CString::new("Crystal Ball").unwrap());
 let nsstring_cls = objc_getClass(b"NSString\0".as_ptr());
 let from_utf8_sel = sel_registerName(b"stringWithUTF8String:\0".as_ptr());
 let ns_title = msgsend_cstr(nsstring_cls, from_utf8_sel, cstr.as_ptr());
 let set_title_sel = sel_registerName(b"setTitle:\0".as_ptr());
 msgsend_obj(btn, set_title_sel, ns_title);
}

#[tauri::command]
fn update_mode_label(webview: Webview, app: AppHandle, mode: String) -> Result<(), String> {
 require_trusted_window(webview.label())?;
 let label = match mode.as_str() {
 "peace" => "Mode: \u{1F54A} Peace",
 "finance" => "Mode: \u{1F4B0} Finance",
 "war" => "Mode: \u{2694} War",
 "disaster"=> "Mode: \u{1F30B} Disaster",
 "ghost" => "Mode: \u{1F47B} Ghost",
 _ => "Mode: \u{1F54A} Peace",
 };
 if let Some(menu) = app.menu() {
 if let Some(item_kind) = menu.get(MENU_VIEW_MODE_ID) {
 if let MenuItemKind::MenuItem(item) = item_kind {
 item.set_text(label).map_err(|e| format!("Failed to update mode label: {e}"))?;
 }
 }
 }
 Ok(())
}

fn build_app_menu(handle: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
 let settings_item = MenuItem::with_id(
 handle,
 MENU_FILE_SETTINGS_ID,
 "Settings...",
 true,
 Some("CmdOrCtrl+,"),
 )?;
 let ghost_mode_item = MenuItem::with_id(
 handle,
 MENU_FILE_GHOST_MODE_ID,
 "Toggle Ghost Mode",
 true,
 Some("CmdOrCtrl+Shift+G"),
 )?;
 let separator = PredefinedMenuItem::separator(handle)?;
 let ghost_separator = PredefinedMenuItem::separator(handle)?;
 let quit_item = PredefinedMenuItem::quit(handle, Some("Quit"))?;
 let file_menu = Submenu::with_items(
 handle,
 "File",
 true,
 &[&settings_item, &ghost_separator, &ghost_mode_item, &separator, &quit_item],
 )?;

 let about_metadata = AboutMetadata {
 name: Some("Crystal Ball".into()),
 version: Some(env!("CARGO_PKG_VERSION").into()),
 copyright: Some("\u{00a9} 2024\u{2013}2026 . Modifications \u{00a9} 2026 Bradley Bond.".into()),
 website: Some("https://github.com/bradleybond512/crystal-ball".into()),
 website_label: Some("GitHub Repository".into()),
 ..Default::default()
 };
 let about_item =
 PredefinedMenuItem::about(handle, Some("About Crystal Ball"), Some(about_metadata))?;
 let github_item = MenuItem::with_id(
 handle,
 MENU_HELP_GITHUB_ID,
 "GitHub Repository",
 true,
 None::<&str>,
 )?;
 let check_updates_item = MenuItem::with_id(
 handle,
 MENU_HELP_CHECK_UPDATES_ID,
 "Check for Updates…",
 true,
 None::<&str>,
 )?;
 let open_logs_item = MenuItem::with_id(
 handle,
 MENU_HELP_OPEN_LOGS_ID,
 "Open Logs Folder",
 true,
 None::<&str>,
 )?;
 let help_separator = PredefinedMenuItem::separator(handle)?;
 let help_separator2 = PredefinedMenuItem::separator(handle)?;

 #[cfg(feature = "devtools")]
 let help_menu = {
 let devtools_item = MenuItem::with_id(
 handle,
 MENU_HELP_DEVTOOLS_ID,
 "Toggle Developer Tools",
 true,
 Some("CmdOrCtrl+Alt+I"),
 )?;
 Submenu::with_items(
 handle,
 "Help",
 true,
 &[&about_item, &help_separator, &check_updates_item, &github_item, &help_separator2, &open_logs_item, &devtools_item],
 )?
 };

 #[cfg(not(feature = "devtools"))]
 let help_menu = Submenu::with_items(
 handle,
 "Help",
 true,
 &[&about_item, &help_separator, &check_updates_item, &github_item, &help_separator2, &open_logs_item],
 )?;

 let mode_status_item = MenuItem::with_id(
 handle,
 MENU_VIEW_MODE_ID,
 "Mode: \u{1F54A} Peace",
 false, // non-interactive — status display only
 None::<&str>,
 )?;
 let view_mode_sep = PredefinedMenuItem::separator(handle)?;
 let view_menu = Submenu::with_items(
 handle,
 "View",
 true,
 &[&mode_status_item, &view_mode_sep],
 )?;

 let window_menu = {
 let minimize = PredefinedMenuItem::minimize(handle, None)?;
 let maximize = PredefinedMenuItem::maximize(handle, None)?;
 let close = PredefinedMenuItem::close_window(handle, None)?;
 Submenu::with_items(handle, "Window", true, &[&minimize, &maximize, &close])?
 };

 let edit_menu = {
 let undo = PredefinedMenuItem::undo(handle, None)?;
 let redo = PredefinedMenuItem::redo(handle, None)?;
 let sep1 = PredefinedMenuItem::separator(handle)?;
 let cut = PredefinedMenuItem::cut(handle, None)?;
 let copy = PredefinedMenuItem::copy(handle, None)?;
 let paste = PredefinedMenuItem::paste(handle, None)?;
 let select_all = PredefinedMenuItem::select_all(handle, None)?;
 Submenu::with_items(
 handle,
 "Edit",
 true,
 &[&undo, &redo, &sep1, &cut, &copy, &paste, &select_all],
 )?
 };

 Menu::with_items(handle, &[&file_menu, &edit_menu, &view_menu, &window_menu, &help_menu])
}

fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
 match event.id().as_ref() {
 MENU_FILE_SETTINGS_ID => {
 if let Some(win) = app.get_webview_window("main") {
 let _ = win.eval("document.dispatchEvent(new CustomEvent('wm:open-settings'))");
 }
 }
 MENU_FILE_GHOST_MODE_ID => {
 if let Some(win) = app.get_webview_window("main") {
 let _ = win.eval("document.dispatchEvent(new CustomEvent('wm:toggle-ghost-mode'))");
 }
 }
 MENU_HELP_GITHUB_ID => {
 let _ = open_in_shell("https://github.com/bradleybond512/crystal-ball");
 }
 MENU_HELP_CHECK_UPDATES_ID => {
 if let Some(win) = app.get_webview_window("main") {
 let _ = win.eval("document.dispatchEvent(new CustomEvent('wm:check-for-updates'))");
 }
 }
 MENU_HELP_OPEN_LOGS_ID => {
 let _ = open_logs_folder_impl(app);
 }
 #[cfg(feature = "devtools")]
 MENU_HELP_DEVTOOLS_ID => {
 if let Some(window) = app.get_webview_window("main") {
 if window.is_devtools_open() {
 window.close_devtools();
 } else {
 window.open_devtools();
 }
 }
 }
 _ => {}
 }
}

/// Strip Windows extended-length path prefixes that `canonicalize()` adds.
/// Preserve UNC semantics: `\\?\UNC\server\share\...` must become
/// `\\server\share\...` (not `UNC\server\share\...`).
fn sanitize_path_for_node(p: &Path) -> String {
 let s = p.to_string_lossy();
 if let Some(stripped_unc) = s.strip_prefix("\\\\?\\UNC\\") {
 format!("\\\\{stripped_unc}")
 } else if let Some(stripped) = s.strip_prefix("\\\\?\\") {
 stripped.to_string()
 } else {
 s.into_owned()
 }
}

#[cfg(test)]
mod updater_gate_tests {
 use super::{validate_expected_sha256, validate_update_url};

 // ── validate_expected_sha256 ──────────────────────────────────────

 #[test]
 fn rejects_missing_hash() {
 let err = validate_expected_sha256(None).unwrap_err();
 assert!(err.contains("no expected SHA-256 supplied"), "{err}");
 }

 #[test]
 fn rejects_empty_hash() {
 assert!(validate_expected_sha256(Some("")).is_err());
 assert!(validate_expected_sha256(Some(" \t ")).is_err());
 }

 #[test]
 fn rejects_short_hash() {
 let err = validate_expected_sha256(Some("abc123")).unwrap_err();
 assert!(err.contains("malformed"), "{err}");
 }

 #[test]
 fn rejects_non_hex_hash() {
 let bad = "g".repeat(64);
 assert!(validate_expected_sha256(Some(&bad)).is_err());
 }

 #[test]
 fn accepts_valid_hash_and_normalizes_case() {
 let upper = "A".repeat(64);
 let got = validate_expected_sha256(Some(&upper)).expect("should accept");
 assert_eq!(got, "a".repeat(64));
 }

 #[test]
 fn accepts_valid_hash_with_surrounding_whitespace() {
 let raw = format!("  {}  ", "0".repeat(64));
 let got = validate_expected_sha256(Some(&raw)).expect("should accept");
 assert_eq!(got, "0".repeat(64));
 }

 // ── validate_update_url ──────────────────────────────────────────

 #[test]
 fn accepts_objects_githubusercontent_com() {
 validate_update_url("https://objects.githubusercontent.com/abc/Crystal-Ball.dmg")
 .expect("github asset host should be allowed");
 }

 #[test]
 fn accepts_github_com() {
 validate_update_url("https://github.com/bradleybond512/crystal-ball/releases/download/v1.0.0/Crystal-Ball.dmg")
 .expect("github.com should be allowed");
 }

 #[test]
 fn accepts_codeload_github_com() {
 validate_update_url("https://codeload.github.com/x/y/zip/refs/tags/v1").expect("codeload allowed");
 }

 #[test]
 fn rejects_unknown_host() {
 let err = validate_update_url("https://evil.example.com/Crystal-Ball.dmg").unwrap_err();
 assert!(err.contains("is not trusted"), "{err}");
 }

 #[test]
 fn rejects_lookalike_host() {
 assert!(validate_update_url("https://github.com.evil.com/x.dmg").is_err());
 }

 #[test]
 fn rejects_invalid_url() {
 assert!(validate_update_url("not a url").is_err());
 }
}

#[cfg(test)]
mod sanitize_path_tests {
 use super::sanitize_path_for_node;
 use std::path::Path;

 #[test]
 fn strips_extended_drive_prefix() {
 let raw = Path::new(r"\\?\C:\Program Files\nodejs\node.exe");
 assert_eq!(
 sanitize_path_for_node(raw),
 r"C:\Program Files\nodejs\node.exe".to_string()
 );
 }

 #[test]
 fn strips_extended_unc_prefix_and_preserves_unc_root() {
 let raw = Path::new(r"\\?\UNC\server\share\sidecar\local-api-server.mjs");
 assert_eq!(
 sanitize_path_for_node(raw),
 r"\\server\share\sidecar\local-api-server.mjs".to_string()
 );
 }

 #[test]
 fn leaves_standard_paths_unchanged() {
 let raw = Path::new(r"C:\Users\alice\sidecar\local-api-server.mjs");
 assert_eq!(
 sanitize_path_for_node(raw),
 r"C:\Users\alice\sidecar\local-api-server.mjs".to_string()
 );
 }
}

#[cfg(test)]
mod vault_shadow_crypto_tests {
 use super::{decrypt_vault_shadow, encrypt_vault_shadow};

 #[test]
 fn roundtrip_recovers_plaintext_and_hides_secret() {
 let key = [7u8; 32];
 let plaintext = r#"{"ANTHROPIC_API_KEY":"sk-secret-123","GROQ_API_KEY":"gk-x"}"#;
 let enc = encrypt_vault_shadow(&key, plaintext).expect("encrypt");
 // The on-disk envelope must not leak the plaintext secret, and must be v2.
 assert!(!enc.contains("sk-secret-123"), "ciphertext leaked the secret");
 assert!(enc.contains("\"v\":2"));
 assert_eq!(decrypt_vault_shadow(&key, &enc).expect("decrypt"), plaintext);
 }

 #[test]
 fn legacy_plaintext_is_not_a_v2_envelope() {
 // A legacy plaintext map must decrypt to None so the caller falls back to
 // reading it as-is (no lockout for existing installs).
 let key = [7u8; 32];
 assert!(decrypt_vault_shadow(&key, r#"{"ANTHROPIC_API_KEY":"sk-x"}"#).is_none());
 }

 #[test]
 fn wrong_key_fails_authentication() {
 // A file copied to another machine (different derived key) must not decrypt.
 let enc = encrypt_vault_shadow(&[1u8; 32], r#"{"A":"b"}"#).expect("encrypt");
 assert!(decrypt_vault_shadow(&[2u8; 32], &enc).is_none());
 }

 #[test]
 fn tampered_ciphertext_is_rejected() {
 let key = [9u8; 32];
 let enc = encrypt_vault_shadow(&key, r#"{"A":"b"}"#).expect("encrypt");
 // Flip a byte inside the ciphertext array — GCM auth must reject it.
 let tampered = enc.replacen("\"c\":[", "\"c\":[255,", 1);
 assert!(decrypt_vault_shadow(&key, &tampered).is_none());
 }
}

#[cfg(test)]
mod secret_ipc_tests {
 use super::{require_trusted_window, SUPPORTED_SECRET_KEYS, TRUSTED_WINDOWS};

 // ── trusted-window guard ─────────────────────────────────────────────────

 #[test]
 fn trusted_window_allows_main() {
 assert!(require_trusted_window("main").is_ok());
 }

 #[test]
 fn trusted_window_allows_settings() {
 assert!(require_trusted_window("settings").is_ok());
 }

 #[test]
 fn trusted_window_allows_live_channels() {
 assert!(require_trusted_window("live-channels").is_ok());
 }

 #[test]
 fn trusted_window_rejects_unknown_label() {
 assert!(require_trusted_window("evil-popup").is_err());
 }

 #[test]
 fn trusted_window_error_names_the_rejected_label() {
 let err = require_trusted_window("attacker").unwrap_err();
 assert!(err.contains("attacker"), "error should name the label: {err}");
 }

 #[test]
 fn trusted_windows_does_not_contain_wildcard() {
 assert!(!TRUSTED_WINDOWS.contains(&"*"), "wildcard must never be trusted");
 }

 // ── SUPPORTED_SECRET_KEYS allowlist ─────────────────────────────────────

 #[test]
 fn allowlist_contains_anthropic_api_key() {
 assert!(SUPPORTED_SECRET_KEYS.contains(&"ANTHROPIC_API_KEY"));
 }

 #[test]
 fn allowlist_rejects_arbitrary_key() {
 assert!(!SUPPORTED_SECRET_KEYS.contains(&"TOTALLY_MADE_UP_KEY"));
 }

 #[test]
 fn allowlist_rejects_empty_string() {
 assert!(!SUPPORTED_SECRET_KEYS.contains(&""));
 }

 #[test]
 fn allowlist_rejects_sql_injection_attempt() {
 assert!(!SUPPORTED_SECRET_KEYS.contains(&"' OR 1=1 --"));
 }

 #[test]
 fn allowlist_is_non_empty() {
 assert!(!SUPPORTED_SECRET_KEYS.is_empty());
 }

 #[test]
 fn get_secret_key_validation_rejects_disallowed_key() {
 // Mirrors the guard in the get_secret / set_secret / delete_secret handlers.
 let key = "NOT_IN_ALLOWLIST";
 let allowed = SUPPORTED_SECRET_KEYS.contains(&key);
 assert!(!allowed, "key outside allowlist must be rejected");
 }

 #[test]
 fn get_secret_key_validation_accepts_allowed_key() {
 let key = "ANTHROPIC_API_KEY";
 let allowed = SUPPORTED_SECRET_KEYS.contains(&key);
 assert!(allowed, "known key must be accepted");
 }
}

#[cfg(test)]
mod persistent_cache_tests {
 use super::{PersistentCache, CACHE_MAX_BYTES, CACHE_TTL_MILLIS};
 use serde_json::{json, Value};
 use std::path::Path;
 use std::time::{SystemTime, UNIX_EPOCH};

 fn now_ms() -> u64 {
  SystemTime::now()
   .duration_since(UNIX_EPOCH)
   .map(|d| d.as_millis() as u64)
   .unwrap_or(0)
 }

 fn cache_with(entries: Vec<(&str, Value)>) -> PersistentCache {
  let cache = PersistentCache::load(Path::new("/nonexistent_cb_test_xyz"));
  let mut data = cache.data.lock().unwrap();
  for (k, v) in entries {
   data.insert(k.to_string(), v);
  }
  drop(data);
  cache
 }

 #[test]
 fn fresh_entry_returns_inner_value() {
  let ts = now_ms();
  let cache = cache_with(vec![
   ("k1", json!({ "v": { "data": "hello" }, "stored_at": ts })),
  ]);
  assert_eq!(cache.get("k1"), Some(json!({ "data": "hello" })));
 }

 #[test]
 fn expired_entry_returns_none() {
  let ts = now_ms().saturating_sub(CACHE_TTL_MILLIS + 1);
  let cache = cache_with(vec![
   ("k1", json!({ "v": { "data": "stale" }, "stored_at": ts })),
  ]);
  assert_eq!(cache.get("k1"), None, "entry older than TTL must be a miss");
 }

 #[test]
 fn entry_without_stored_at_returns_none() {
  // Pre-migration format: raw CacheEnvelope with no stored_at wrapper.
  let cache = cache_with(vec![
   ("k1", json!({ "key": "k1", "data": "legacy", "updatedAt": 1718000000000_u64 })),
  ]);
  assert_eq!(cache.get("k1"), None, "legacy entry without stored_at must be a miss");
 }

 #[test]
 fn missing_key_returns_none() {
  let cache = cache_with(vec![]);
  assert_eq!(cache.get("nonexistent"), None);
 }

 #[test]
 fn flush_evicts_expired_entries() {
  let now = now_ms();
  let expired_ts = now.saturating_sub(CACHE_TTL_MILLIS + 1);
  let fresh_ts = now.saturating_sub(60_000); // 1 minute ago

  let cache = cache_with(vec![
   ("expired", json!({ "v": "old", "stored_at": expired_ts })),
   ("fresh", json!({ "v": "new", "stored_at": fresh_ts })),
   ("no_ts", json!({ "key": "no_ts", "data": "legacy" })),
  ]);
  *cache.dirty.lock().unwrap() = true;

  let tmp = std::env::temp_dir().join("cb_flush_evict_test.json");
  cache.flush(&tmp, true).expect("flush should succeed");

  let data = cache.data.lock().unwrap();
  assert!(!data.contains_key("expired"), "expired entry must be evicted on flush");
  assert!(!data.contains_key("no_ts"), "legacy entry without stored_at must be evicted on flush");
  assert!(data.contains_key("fresh"), "fresh entry must survive flush");
  drop(data);

  let contents = std::fs::read_to_string(&tmp).unwrap_or_default();
  assert!(!contents.contains("\"expired\""));
  assert!(contents.contains("\"fresh\""));
  let _ = std::fs::remove_file(&tmp);
 }

 #[test]
 fn flush_evicts_oldest_when_over_size_cap() {
  let now = now_ms();
  let old_ts = now.saturating_sub(2 * 24 * 60 * 60 * 1000); // 2 days old
  let new_ts = now.saturating_sub(1 * 24 * 60 * 60 * 1000); // 1 day old

  // Two entries totalling well over 32 MB so the size cap kicks in.
  let big: String = "a".repeat(CACHE_MAX_BYTES / 2 + 1024 * 1024);
  let cache = cache_with(vec![
   ("oldest", json!({ "v": big.clone(), "stored_at": old_ts })),
   ("newest", json!({ "v": big, "stored_at": new_ts })),
  ]);
  *cache.dirty.lock().unwrap() = true;

  let tmp = std::env::temp_dir().join("cb_cap_evict_test.json");
  cache.flush(&tmp, true).expect("flush should succeed");

  let data = cache.data.lock().unwrap();
  assert!(!data.contains_key("oldest"), "oldest entry must be evicted when over size cap");
  assert!(data.contains_key("newest"), "newest entry must survive size-cap eviction");
  drop(data);

  let _ = std::fs::remove_file(&tmp);
 }
}

fn local_api_paths(app: &AppHandle) -> (PathBuf, PathBuf) {
 let resource_dir = app
 .path()
 .resource_dir()
 .unwrap_or_else(|_| PathBuf::from("."));

 let sidecar_script = if cfg!(debug_assertions) {
 PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("sidecar/local-api-server.mjs")
 } else {
 resource_dir.join("sidecar/local-api-server.mjs")
 };

 let api_dir_root = if cfg!(debug_assertions) {
 PathBuf::from(env!("CARGO_MANIFEST_DIR"))
 .parent()
 .map(PathBuf::from)
 .unwrap_or_else(|| PathBuf::from("."))
 } else {
 let direct_api = resource_dir.join("api");
 let lifted_root = resource_dir.join("_up_");
 let lifted_api = lifted_root.join("api");
 if direct_api.exists() {
 resource_dir
 } else if lifted_api.exists() {
 lifted_root
 } else {
 resource_dir
 }
 };

 (sidecar_script, api_dir_root)
}

fn resolve_node_binary(app: &AppHandle) -> Option<PathBuf> {
 // The LOCAL_API_NODE_BIN override is honored in debug builds only. In a
 // release build, an attacker who can set this env var could redirect the
 // sidecar to an arbitrary executable that inherits the injected keychain
 // secrets, so the override must be ignored outside development.
 #[cfg(debug_assertions)]
 if let Ok(explicit) = env::var("LOCAL_API_NODE_BIN") {
 let explicit_path = PathBuf::from(explicit);
 if explicit_path.is_file() {
 return Some(explicit_path);
 }
 append_desktop_log(
 app,
 "WARN",
 &format!(
 "LOCAL_API_NODE_BIN is set but not a valid file: {}",
 explicit_path.display()
 ),
 );
 }

 if !cfg!(debug_assertions) {
 let node_name = if cfg!(windows) { "node.exe" } else { "node" };
 if let Ok(resource_dir) = app.path().resource_dir() {
 let mut candidates = vec![resource_dir.join("sidecar").join("node").join(node_name)];
 if cfg!(windows) {
 // NSIS resource paths can flatten nested names in some upgrade scenarios.
 // Keep this fallback so sidecar startup still succeeds if the runtime is
 // materialized as sidecar\node.node.exe instead of sidecar\node\node.exe.
 candidates.push(resource_dir.join("sidecar").join("node.node.exe"));
 }
 for bundled in candidates {
 if bundled.is_file() {
 return Some(bundled);
 }
 }
 }
 }

 let node_name = if cfg!(windows) { "node.exe" } else { "node" };
 if let Some(path_var) = env::var_os("PATH") {
 for dir in env::split_paths(&path_var) {
 let candidate = dir.join(node_name);
 if candidate.is_file() {
 return Some(candidate);
 }
 }
 }

 let common_locations = if cfg!(windows) {
 vec![
 PathBuf::from(r"C:\Program Files\nodejs\node.exe"),
 PathBuf::from(r"C:\Program Files (x86)\nodejs\node.exe"),
 ]
 } else {
 vec![
 PathBuf::from("/opt/homebrew/bin/node"),
 PathBuf::from("/usr/local/bin/node"),
 PathBuf::from("/usr/bin/node"),
 PathBuf::from("/opt/local/bin/node"),
 ]
 };

 common_locations.into_iter().find(|path| path.is_file())
}

fn read_port_file(path: &Path, timeout_ms: u64) -> Option<u16> {
 let start = std::time::Instant::now();
 let interval = std::time::Duration::from_millis(100);
 let timeout = std::time::Duration::from_millis(timeout_ms);
 while start.elapsed() < timeout {
 if let Ok(contents) = fs::read_to_string(path) {
 if let Ok(port) = contents.trim().parse::<u16>() {
 if port > 0 {
 return Some(port);
 }
 }
 }
 std::thread::sleep(interval);
 }
 None
}

fn start_local_api(app: &AppHandle) -> Result<(), String> {
 let state = app.state::<LocalApiState>();
 let mut slot = state
 .child
 .lock()
 .map_err(|_| "Failed to lock local API state".to_string())?;
 if slot.is_some() {
 return Ok(());
 }

 // Clear port state for fresh start
 if let Ok(mut port_slot) = state.port.lock() {
 *port_slot = None;
 }
 state.port_confirmed.store(false, Ordering::SeqCst);

 // ── Restart counter / flap detector ──────────────────────────────
 if let (Ok(mut count), Ok(mut last)) = (state.restart_count.lock(), state.last_restart_at.lock()) {
 *count += 1;
 let total = *count;
 let now = Instant::now();
 let recent = last.map(|t| now.duration_since(t) < Duration::from_secs(300)).unwrap_or(false);
 *last = Some(now);
 if total > 1 {
 append_desktop_log(
 app,
 if recent && total >= 4 { "WARN" } else { "INFO" },
 &format!("sidecar restart_count={total} recent_window=5min flapping={}", recent && total >= 4),
 );
 }
 }

 // ── Stale-sidecar reaper ─────────────────────────────────────────
 // Scan port 46123 for an existing listener. If it's an orphaned node
 // process (not us), log it and kill it so the new sidecar can claim
 // the canonical port instead of falling back to a random one.
 #[cfg(unix)]
 {
 if let Ok(out) = Command::new("lsof")
 .args(["-nP", "-tiTCP:46123", "-sTCP:LISTEN"])
 .output()
 {
 let stdout = String::from_utf8_lossy(&out.stdout);
 for line in stdout.lines() {
 if let Ok(pid) = line.trim().parse::<u32>() {
 if pid != std::process::id() {
 append_desktop_log(
 app,
 "WARN",
 &format!("pre-existing listener on port 46123 pid={pid} — killing"),
 );
 let _ = Command::new("kill").args(["-TERM", &pid.to_string()]).status();
 std::thread::sleep(Duration::from_millis(300));
 let _ = Command::new("kill").args(["-KILL", &pid.to_string()]).status();
 }
 }
 }
 }
 }

 let (script, resource_root) = local_api_paths(app);
 if !script.exists() {
 return Err(format!(
 "Local API sidecar script missing at {}",
 script.display()
 ));
 }
 let node_binary = resolve_node_binary(app).ok_or_else(|| {
 "Node.js executable not found. Install Node 18+ or set LOCAL_API_NODE_BIN".to_string()
 })?;

 let port_file = logs_dir_path(app)?.join("sidecar.port");
 let _ = fs::remove_file(&port_file);
 let token_file_cleanup = logs_dir_path(app)?.join("sidecar.token");
 let _ = fs::remove_file(&token_file_cleanup);

 let log_path = sidecar_log_path(app)?;
 rotate_log_if_needed(&log_path);
 let log_file = OpenOptions::new()
 .create(true)
 .append(true)
 .open(&log_path)
 .map_err(|e| format!("Failed to open local API log {}: {e}", log_path.display()))?;
 #[cfg(unix)]
 {
 use std::os::unix::fs::PermissionsExt;
 let _ = fs::set_permissions(&log_path, fs::Permissions::from_mode(0o600));
 }
 let log_file_err = log_file
 .try_clone()
 .map_err(|e| format!("Failed to clone local API log handle: {e}"))?;

 append_desktop_log(
 app,
 "INFO",
 &format!(
 "starting local API sidecar script={} resource_root={} log={}",
 script.display(),
 resource_root.display(),
 log_path.display()
 ),
 );
 append_desktop_log(
 app,
 "INFO",
 &format!("resolved node binary={}", node_binary.display()),
 );
 append_desktop_log(
 app,
 "INFO",
 &format!(
 "local API sidecar preferred port={} port_file={}",
 DEFAULT_LOCAL_API_PORT,
 port_file.display()
 ),
 );

 // Generate a unique token for local API auth (prevents other local processes from accessing sidecar)
 let mut token_slot = state
 .token
 .lock()
 .map_err(|_| "Failed to lock token slot")?;
 if token_slot.is_none() {
 *token_slot = Some(generate_local_token());
 }
 let local_api_token = token_slot.clone().unwrap();
 // Write token to file so MCP server and other local tools can authenticate.
 // Create the file with 0600 atomically (O_CREAT|O_TRUNC + mode) so a freshly
 // created inode is never world-readable. mode() only governs newly created
 // inodes, so when sidecar.token already exists we also re-assert 0600 on the
 // open handle while it is still truncated/empty — before the bearer token is
 // written — so a stale, permissively-moded file can't leak the new secret.
 let token_file = logs_dir_path(app)?.join("sidecar.token");
 let write_token = || -> std::io::Result<()> {
 let mut opts = std::fs::OpenOptions::new();
 opts.write(true).create(true).truncate(true);
 #[cfg(unix)]
 {
 use std::os::unix::fs::OpenOptionsExt;
 opts.mode(0o600);
 }
 let mut file = opts.open(&token_file)?;
 #[cfg(unix)]
 {
 use std::os::unix::fs::PermissionsExt;
 file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
 }
 file.write_all(local_api_token.as_bytes())?;
 Ok(())
 };
 if let Err(e) = write_token() {
 append_desktop_log(app, "WARN", &format!("failed to write token file: {e}"));
 }
 drop(token_slot);

 let mut cmd = Command::new(&node_binary);
 // Strip dangerous Node runtime env vars inherited from the parent process so
 // a co-resident attacker who controls the app's environment can't inject
 // code into the sidecar (which receives the keychain secrets). We do NOT
 // env_clear() because PATH-based Node resolution still relies on the
 // inherited environment.
 cmd.env_remove("NODE_OPTIONS")
 .env_remove("NODE_PATH")
 .env_remove("NODE_REPL_EXTERNAL_MODULE")
 .env_remove("NODE_REPL_HISTORY")
 .env_remove("NODE_EXTRA_CA_CERTS");
 #[cfg(windows)]
 cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW — hide the node.exe console
 // Sanitize paths for Node.js on Windows: strip \\?\ UNC prefix and set
 // explicit working directory to avoid bare drive-letter CWD issues that
 // cause EISDIR errors in Node.js module resolution.
 let script_for_node = sanitize_path_for_node(&script);
 let resource_for_node = sanitize_path_for_node(&resource_root);
 append_desktop_log(
 app,
 "INFO",
 &format!("node args: script={script_for_node} resource_dir={resource_for_node}"),
 );
 let data_dir = logs_dir_path(app)
 .map(|p| sanitize_path_for_node(&p))
 .unwrap_or_else(|_| resource_for_node.clone());
 cmd.arg(&script_for_node)
 .env("LOCAL_API_PORT", DEFAULT_LOCAL_API_PORT.to_string())
 .env("LOCAL_API_PORT_FILE", &port_file)
 .env("LOCAL_API_RESOURCE_DIR", &resource_for_node)
 .env("LOCAL_API_DATA_DIR", &data_dir)
 .env("LOCAL_API_MODE", "tauri-sidecar")
 .env("LOCAL_API_TOKEN", &local_api_token)
 .env("WM_BUILD_TAG", format!("v{}+{}", env!("CARGO_PKG_VERSION"), BUILD_SHA))
 .stdout(Stdio::from(log_file))
 .stderr(Stdio::from(log_file_err));
 if std::env::var("WM_TRACE").ok().as_deref() == Some("1") {
 cmd.env("WM_TRACE", "1");
 }
 if let Some(parent) = script.parent() {
 cmd.current_dir(parent);
 }

 // Pass cached keychain secrets to sidecar as env vars (no keychain re-read)
 let mut secret_count = 0u32;
 let secrets_cache = app.state::<SecretsCache>();
 if let Ok(secrets) = secrets_cache.secrets.lock() {
 for (key, value) in secrets.iter() {
 cmd.env(key, value);
 secret_count += 1;
 }
 }
 append_desktop_log(
 app,
 "INFO",
 &format!("injected {secret_count} keychain secrets into sidecar env"),
 );

 // Inject build-time secrets (CI) with runtime env fallback (dev)
 if let Some(url) = option_env!("CONVEX_URL") {
 cmd.env("CONVEX_URL", url);
 } else if let Ok(url) = std::env::var("CONVEX_URL") {
 cmd.env("CONVEX_URL", url);
 }

 let child = cmd
 .spawn()
 .map_err(|e| format!("Failed to launch local API: {e}"))?;
 let child_pid = child.id();
 append_desktop_log(
 app,
 "INFO",
 &format!("local API sidecar started pid={child_pid}"),
 );
 *slot = Some(child);
 drop(slot);

 // Watcher thread: poll for sidecar exit so we can log status code / signal
 // when it dies unexpectedly. Without this we only see "sidecar stopped" from
 // stop_local_api(), which masks crashes from manual kills or external signals.
 // Also tails the heartbeat file and warns if it goes stale (event-loop hang).
 {
 let app_handle = app.clone();
 let heartbeat_path = logs_dir_path(app)
 .ok()
 .map(|p| p.join("sidecar.health.json"));
 let mut last_heartbeat_age_warn = false;
 std::thread::spawn(move || {
 loop {
 std::thread::sleep(std::time::Duration::from_millis(1500));
 // Heartbeat staleness check
 if let Some(ref hb_path) = heartbeat_path {
 if let Ok(meta) = fs::metadata(hb_path) {
 if let Ok(modified) = meta.modified() {
 if let Ok(age) = SystemTime::now().duration_since(modified) {
 let stale = age > Duration::from_secs(30);
 if stale && !last_heartbeat_age_warn {
 append_desktop_log(
 &app_handle,
 "WARN",
 &format!("sidecar heartbeat stale age={}s pid={child_pid}", age.as_secs()),
 );
 last_heartbeat_age_warn = true;
 } else if !stale && last_heartbeat_age_warn {
 append_desktop_log(&app_handle, "INFO", "sidecar heartbeat recovered");
 last_heartbeat_age_warn = false;
 }
 }
 }
 }
 }
 let Some(state) = app_handle.try_state::<LocalApiState>() else { return; };
 let Ok(mut slot) = state.child.lock() else { return; };
 let Some(child) = slot.as_mut() else { return; }; // already cleared by stop_local_api
 if child.id() != child_pid { return; } // a newer sidecar replaced us
 match child.try_wait() {
 Ok(Some(status)) => {
 append_desktop_log(
 &app_handle,
 "WARN",
 &format!(
 "sidecar pid={child_pid} exited unexpectedly status={status:?} code={:?} signal={:?}",
 status.code(),
 {
 #[cfg(unix)]
 { use std::os::unix::process::ExitStatusExt; status.signal() }
 #[cfg(not(unix))]
 { None::<i32> }
 }
 ),
 );
 *slot = None;
 return;
 }
 Ok(None) => continue, // still running
 Err(e) => {
 append_desktop_log(
 &app_handle,
 "ERROR",
 &format!("sidecar try_wait pid={child_pid} failed: {e}"),
 );
 return;
 }
 }
 }
 });
 }

 // Wait for sidecar to write confirmed port (up to 15s — Node.js ESM startup can be slow)
 if let Some(confirmed_port) = read_port_file(&port_file, 15000) {
 append_desktop_log(
 app,
 "INFO",
 &format!("sidecar confirmed port={confirmed_port}"),
 );
 if let Ok(mut port_slot) = state.port.lock() {
 *port_slot = Some(confirmed_port);
 }
 state.port_confirmed.store(true, Ordering::SeqCst);
 } else {
 append_desktop_log(
 app,
 "WARN",
 "sidecar port file not found within timeout, using default",
 );
 if let Ok(mut port_slot) = state.port.lock() {
 *port_slot = Some(DEFAULT_LOCAL_API_PORT);
 }
 state.port_confirmed.store(false, Ordering::SeqCst);
 }

 Ok(())
}

/// Frontend → desktop log bridge. JS calls this from window.onerror,
/// unhandledrejection, and key event handlers so renderer-side errors land
/// in desktop.log instead of dying in WebInspector.
/// Wall-clock millis since the UNIX epoch — renderer-watchdog timestamps.
fn renderer_now_ms() -> u64 {
 SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Last time the renderer's 3s heartbeat reached us (ms since epoch). A hung
/// renderer main thread (Defect A's infinite JS loop) stops updating this; the
/// watchdog thread below notices the silence and reloads the webview.
static LAST_RENDERER_HEARTBEAT_MS: AtomicU64 = AtomicU64::new(0);

/// Renderer heartbeat sink. The paired renderer beats every 3s via log-bridge's
/// installRendererHeartbeat(); a wedged main thread simply stops calling this.
#[tauri::command]
fn renderer_heartbeat(webview: Webview, visible: bool) -> Result<(), String> {
 require_trusted_window(webview.label())?;
 let _ = visible; // reserved for future hidden-window policy
 LAST_RENDERER_HEARTBEAT_MS.store(renderer_now_ms(), Ordering::Relaxed);
 Ok(())
}

/// Set true by the renderer watchdog after it reloads a wedged webview. The
/// renderer consumes it once on the next boot (take_watchdog_recovery) to toast
/// "recovered". An atomic flag survives the reload race that an emit() to a
/// tearing-down webview would lose.
static WATCHDOG_RECOVERY_PENDING: AtomicBool = AtomicBool::new(false);

/// ~/Library/Logs/CrystalBall — the human-facing dated log the watchdog writes
/// heartbeats + stall/recovery evidence to (sibling of the app_log_dir bundle
/// folder that holds desktop.log). Created 0700 if missing.
fn crystalball_log_dir(app: &AppHandle) -> Option<PathBuf> {
 let dir = app.path().app_log_dir().ok()?.parent()?.join("CrystalBall");
 fs::create_dir_all(&dir).ok()?;
 #[cfg(unix)]
 {
  use std::os::unix::fs::PermissionsExt;
  let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
 }
 Some(dir)
}

/// Civil (UTC) date + time-of-day from a Unix timestamp — pure, no chrono dep.
/// Howard Hinnant's civil_from_days algorithm; drives the dated log filename.
fn epoch_to_utc(secs: i64) -> (i64, u32, u32, u32, u32, u32) {
 let days = secs.div_euclid(86_400);
 let rem = secs.rem_euclid(86_400);
 let (hh, mm, ss) = ((rem / 3600) as u32, ((rem % 3600) / 60) as u32, (rem % 60) as u32);
 let z = days + 719_468;
 let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
 let doe = z - era * 146_097;
 let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
 let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
 let mp = (5 * doy + 2) / 153;
 let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
 let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
 let mut y = yoe + era * 400;
 if m <= 2 { y += 1; }
 (y, m, d, hh, mm, ss)
}

/// Append one line to ~/Library/Logs/CrystalBall/crystal-ball.<YYYY-MM-DD>.log.
/// Purpose-built for watchdog heartbeats + stall/recovery evidence so the file
/// ticks as proof-of-life independent of the com.bradleybond desktop log.
fn append_watchdog_log(app: &AppHandle, level: &str, message: &str) {
 let Some(dir) = crystalball_log_dir(app) else { return };
 let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
 let (y, mo, d, h, mi, s) = epoch_to_utc(secs);
 let path = dir.join(format!("crystal-ball.{y:04}-{mo:02}-{d:02}.log"));
 let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) else { return };
 #[cfg(unix)]
 {
  use std::os::unix::fs::PermissionsExt;
  let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
 }
 let sanitized: String = message.chars().map(|c| if c == '\n' || c == '\r' { ' ' } else { c }).collect();
 let _ = writeln!(file, "{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z [{level}] {sanitized}");
}

/// Best-effort forensic capture for a renderer stall, on its OWN thread so it
/// can never delay the reload (a wedged `sample`/`ps` must not block recovery).
/// We `sample` our OWN process — identity-certain and safe. We deliberately do
/// NOT sample "the busiest WebKit.WebContent" process: that XPC service is
/// re-parented to launchd and shared across every WebKit app, so it can't be
/// attributed to us — sampling it risks dumping an unrelated app's memory into
/// our logs and may miss our actual renderer. Instead we log a non-invasive `ps`
/// CPU snapshot of the WebContent processes so the hot renderer is still evident.
fn spawn_stall_capture(app: AppHandle) {
 std::thread::spawn(move || {
  // Snapshot WebContent CPU and pick the hottest one to sample. The renderer
  // (WebContent) is where our JS burns during a stall; our own host process is
  // just waiting, so sampling it is useless (all threads in cvwait). The XPC
  // service can't be attributed with certainty, but our stalled renderer is
  // reliably the busiest WebContent — and `-mayDie` + this detached thread keep
  // a wedged `sample` from ever blocking recovery. Fall back to our own pid if
  // no WebContent is meaningfully busy.
  let mut hot_pid: Option<String> = None;
  let mut hot_cpu: f32 = 0.0;
  if let Ok(ps) = Command::new("/bin/ps").args(["-axo", "pid,pcpu,pmem,comm"]).output() {
   let text = String::from_utf8_lossy(&ps.stdout);
   for line in text.lines().filter(|l| l.contains("WebKit.WebContent")) {
    append_watchdog_log(&app, "INFO", &format!("stall: WebContent {}", line.trim()));
    let mut cols = line.split_whitespace();
    if let (Some(pid), Some(cpu)) = (cols.next(), cols.next()) {
     if let Ok(c) = cpu.parse::<f32>() {
      if c > hot_cpu { hot_cpu = c; hot_pid = Some(pid.to_string()); }
     }
    }
   }
  }
  let Some(dir) = crystalball_log_dir(&app) else { return };
  let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
  let out = dir.join(format!("crystal-ball-sample-{secs}.txt"));
  let out_str = out.to_string_lossy().to_string();
  let (target, label) = match hot_pid {
   Some(ref p) if hot_cpu >= 5.0 => (p.clone(), "webcontent"),
   _ => (std::process::id().to_string(), "app-process"),
  };
  let ok = Command::new("/usr/bin/sample")
   .args([&target, "2", "-file", &out_str, "-mayDie"])
   .output()
   .map(|o| o.status.success())
   .unwrap_or(false);
  if ok {
   append_watchdog_log(&app, "INFO", &format!("stall: {label} sample captured (pid={target} cpu={hot_cpu:.0}%): {out_str}"));
  } else {
   append_watchdog_log(&app, "WARN", &format!("stall: {label} sample capture failed (pid={target})"));
  }
 });
}

/// Consumed once by the renderer on boot: true iff the watchdog reloaded a
/// wedged webview since the last check, so the renderer can toast "recovered".
#[tauri::command]
fn take_watchdog_recovery(webview: Webview) -> Result<bool, String> {
 require_trusted_window(webview.label())?;
 Ok(WATCHDOG_RECOVERY_PENDING.swap(false, Ordering::Relaxed))
}

#[tauri::command]
fn log_frontend(webview: Webview, app: AppHandle, level: String, message: String, context: Option<String>) -> Result<(), String> {
 require_trusted_window(webview.label())?;
 let lvl = match level.to_uppercase().as_str() {
 "ERROR" | "WARN" | "INFO" | "DEBUG" => level.to_uppercase(),
 _ => "INFO".to_string(),
 };
 let ctx = context.unwrap_or_default();
 // Use byte-safe truncation — slicing &message[..1000] panics when the cut
 // bisects a multi-byte UTF-8 codepoint (emoji, non-Latin scripts), which the
 // frontend can easily trigger via breadcrumbs/log output.
 let truncated_msg = truncate_to_bytes(&message, 1000);
 let truncated_ctx = truncate_to_bytes(&ctx, 2000);
 append_desktop_log(
 &app,
 &lvl,
 &format!("[FRONTEND] {truncated_msg}{}", if truncated_ctx.is_empty() { String::new() } else { format!(" | {truncated_ctx}") }),
 );
 Ok(())
}

/// Returns a diagnostics bundle (last N log lines + sidecar /api/diag) as a
/// single string suitable for copying to the clipboard. Triggered by Cmd+Shift+D.
#[tauri::command]
async fn copy_diagnostics(webview: Webview, app: AppHandle) -> Result<String, String> {
 require_trusted_window(webview.label())?;
 let mut out = String::new();
 out.push_str(&format!(
 "=== Crystal Ball diagnostics ===\nversion: v{}+{}\ntime: {}\n\n",
 env!("CARGO_PKG_VERSION"),
 BUILD_SHA,
 SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
 ));

 // Tail desktop.log + local-api.log (last 200 lines each)
 for (label, getter) in &[
 ("desktop.log", desktop_log_path as fn(&AppHandle) -> Result<PathBuf, String>),
 ("local-api.log", sidecar_log_path as fn(&AppHandle) -> Result<PathBuf, String>),
 ] {
 out.push_str(&format!("--- {label} (last 200 lines) ---\n"));
 if let Ok(path) = getter(&app) {
 if let Ok(content) = fs::read_to_string(&path) {
 let lines: Vec<&str> = content.lines().collect();
 let start = lines.len().saturating_sub(200);
 for l in &lines[start..] {
 out.push_str(l);
 out.push('\n');
 }
 } else {
 out.push_str("(unreadable)\n");
 }
 }
 out.push('\n');
 }

 // Fetch /api/diag from the live sidecar
 let local_state = app.state::<LocalApiState>();
 let port = local_state.port.lock().ok().and_then(|p| *p).unwrap_or(DEFAULT_LOCAL_API_PORT);
 let token = local_state.token.lock().ok().and_then(|t| t.clone()).unwrap_or_default();
 out.push_str(&format!("--- /api/diag (port {port}) ---\n"));
 let client = reqwest::Client::builder()
 .timeout(Duration::from_secs(2))
 .build()
 .map_err(|e| e.to_string())?;
 match client.get(format!("http://127.0.0.1:{port}/api/diag"))
 .header("Authorization", format!("Bearer {}", token))
 .send().await {
 Ok(resp) => match resp.text().await {
 Ok(body) => out.push_str(&body),
 Err(e) => out.push_str(&format!("(diag body read failed: {e})")),
 },
 Err(e) => out.push_str(&format!("(diag fetch failed: {e})")),
 }
 out.push('\n');
 Ok(out)
}

/// Push freshly-loaded keychain secrets into the already-running sidecar via
/// its `/api/local-env-update` IPC endpoint — the same per-key channel the
/// renderer uses when the user edits a key in Settings (`pushSecretToSidecar`).
/// Secrets take effect without restarting the sidecar (or the app).
///
/// Used at boot so a slow Touch ID / Keychain read never gates sidecar startup:
/// the sidecar boots with zero secrets, then these get injected the moment the
/// keychain resolves. Best-effort — the keychain remains the source of truth,
/// so a failed push just means those routes return 503 until the next launch.
async fn inject_secrets_into_running_sidecar(app: &AppHandle, secrets: Vec<(String, String)>) {
 let total = secrets.len();
 if total == 0 {
 return;
 }
 let (token, port) = {
 let state = app.state::<LocalApiState>();
 // Confirm the sidecar we launched is still the live listener before
 // sending any secret bytes. If it exited during the keychain read, the
 // recorded port may now belong to a foreign local process, and posting
 // plaintext secrets there would leak them.
 let alive = match state.child.lock() {
 Ok(mut slot) => match slot.as_mut() {
 Some(child) => matches!(child.try_wait(), Ok(None)),
 None => false,
 },
 Err(_) => false,
 };
 if !alive {
 append_desktop_log(
 app,
 "WARN",
 "sidecar not alive at secret-injection time — secrets not pushed (will load on next launch)",
 );
 return;
 }
 // Only post to a port the sidecar actually confirmed via its port file. On
 // the timeout fallback the recorded port is just the default (46123), which
 // a foreign process could be squatting if our sidecar bound elsewhere after
 // EADDRINUSE — posting plaintext secrets there would leak them.
 if !state.port_confirmed.load(Ordering::SeqCst) {
 append_desktop_log(
 app,
 "WARN",
 "sidecar port unconfirmed at secret-injection time — secrets not pushed (will load on next launch)",
 );
 return;
 }
 let token = state.token.lock().ok().and_then(|t| t.clone()).unwrap_or_default();
 let port = state.port.lock().ok().and_then(|p| *p).unwrap_or(DEFAULT_LOCAL_API_PORT);
 (token, port)
 };
 let client = match reqwest::Client::builder()
 .timeout(Duration::from_secs(3))
 .build()
 {
 Ok(c) => c,
 Err(e) => {
 append_desktop_log(
 app,
 "WARN",
 &format!("secret injection skipped: http client build failed: {e}"),
 );
 return;
 }
 };
 let url = format!("http://127.0.0.1:{port}/api/local-env-update");
 let secrets_cache = app.state::<SecretsCache>();
 let mut pushed = 0usize;
 let mut skipped = 0usize;
 for (key, _snapshot) in secrets {
 // Re-read the live cache value per key rather than trusting this snapshot.
 // If the user edited the secret in Settings after the snapshot was taken,
 // the cache holds the newer value and we post that (never the stale one).
 // If the key was deleted since the snapshot it's gone from the cache, so
 // skip it rather than resurrect a just-removed credential. Posting the
 // current value is idempotent with the renderer's own push and recovers
 // any key whose early renderer push silently failed.
 let value = match secrets_cache.secrets.lock() {
 Ok(map) => match map.get(&key) {
 Some(v) => v.clone(),
 None => {
 skipped += 1;
 continue;
 }
 },
 Err(_) => {
 skipped += 1;
 continue;
 }
 };
 // start_local_api already confirmed the sidecar's port before this runs,
 // so a few quick attempts absorb any momentary unreadiness.
 for attempt in 0..3 {
 let result = client
 .post(&url)
 .header("Authorization", format!("Bearer {token}"))
 .json(&serde_json::json!({ "key": key, "value": value }))
 .send()
 .await;
 match result {
 Ok(resp) if resp.status().is_success() => {
 pushed += 1;
 break;
 }
 _ => {
 if attempt < 2 {
 // Sleep off the async executor (no tokio timer in scope).
 let _ = tauri::async_runtime::spawn_blocking(|| {
 std::thread::sleep(Duration::from_millis(400))
 })
 .await;
 }
 }
 }
 }
 }
 append_desktop_log(
 app,
 "INFO",
 &format!("injected {pushed}/{total} keychain secrets into running sidecar via IPC ({skipped} skipped: deleted or unreadable since load)"),
 );
}

fn stop_local_api(app: &AppHandle) {
 if let Ok(state) = app.try_state::<LocalApiState>().ok_or(()) {
 if let Ok(mut slot) = state.child.lock() {
 if let Some(mut child) = slot.take() {
 let _ = child.kill();
 append_desktop_log(app, "INFO", "local API sidecar stopped");
 }
 }
 if let Ok(mut port_slot) = state.port.lock() {
 *port_slot = None;
 }
 if let Ok(log_dir) = logs_dir_path(app) {
 let _ = fs::remove_file(log_dir.join("sidecar.port"));
 let _ = fs::remove_file(log_dir.join("sidecar.token"));
 }
 }
}

#[cfg(target_os = "linux")]
fn resolve_appimage_gio_module_dir() -> Option<PathBuf> {
 let appdir = env::var_os("APPDIR")?;
 let appdir = PathBuf::from(appdir);

 // Common layouts produced by AppImage/linuxdeploy on Debian and RPM families.
 let preferred = [
 "usr/lib/gio/modules",
 "usr/lib64/gio/modules",
 "usr/lib/x86_64-linux-gnu/gio/modules",
 "usr/lib/aarch64-linux-gnu/gio/modules",
 "usr/lib/arm-linux-gnueabihf/gio/modules",
 "lib/gio/modules",
 "lib64/gio/modules",
 ];

 for relative in preferred {
 let candidate = appdir.join(relative);
 if candidate.is_dir() {
 return Some(candidate);
 }
 }

 // Fallback: probe one level of arch-specific directories, e.g. usr/lib/<triplet>/gio/modules.
 for lib_root in ["usr/lib", "usr/lib64", "lib", "lib64"] {
 let root = appdir.join(lib_root);
 if !root.is_dir() {
 continue;
 }
 let entries = match fs::read_dir(&root) {
 Ok(entries) => entries,
 Err(_) => continue,
 };
 for entry in entries.flatten() {
 let candidate = entry.path().join("gio/modules");
 if candidate.is_dir() {
 return Some(candidate);
 }
 }
 }

 None
}

fn main() {
 // Panic hook — without this, a Rust panic exits the process silently with
 // no log line. We append the panic info to desktop.log via direct path
 // resolution (the AppHandle isn't available yet at panic time on every thread).
 std::panic::set_hook(Box::new(|info| {
 let msg = info.payload().downcast_ref::<&str>().copied()
 .or_else(|| info.payload().downcast_ref::<String>().map(|s| s.as_str()))
 .unwrap_or("(no message)");
 let location = info.location()
 .map(|l| format!("{}:{}", l.file(), l.line()))
 .unwrap_or_else(|| "(unknown location)".to_string());
 eprintln!("[tauri PANIC] {msg} at {location}");
 // Best-effort write to log file at known location.
 if let Some(home) = std::env::var_os("HOME") {
 let log = PathBuf::from(home)
 .join("Library/Logs/com.bradleybond.crystalball/desktop.log");
 if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&log) {
 let ts = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
 let _ = writeln!(f, "[{ts}][v{}+{}][PANIC] {msg} at {location}", env!("CARGO_PKG_VERSION"), BUILD_SHA);
 #[cfg(unix)]
 { use std::os::unix::fs::PermissionsExt; let _ = fs::set_permissions(&log, fs::Permissions::from_mode(0o600)); }
 }
 }
 }));

 // Work around WebKitGTK rendering issues on Linux that can cause blank white
 // screens. DMA-BUF renderer failures are common with NVIDIA drivers and on
 // immutable distros (e.g. Bazzite/Fedora Atomic).  Setting the env var before
 // WebKit initialises forces a software fallback path.  Only set when the user
 // hasn't explicitly configured the variable.
 #[cfg(target_os = "linux")]
 {
 if env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
 // SAFETY: called before any threads are spawned (Tauri hasn't started yet).
 unsafe { env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
 }

 // WebKitGTK promotes iframes, <video>, and canvas to GPU-textured
 // compositing layers.  In VMs (Apple Virtualization.framework,
 // QEMU/KVM, VMware, etc.) the virtio-gpu driver often only supports
 // 2D or limited GL — GBM buffer allocation for compositing layers
 // fails silently, rendering iframe/video content as black while the
 // main page (software-tiled) works fine.
 //
 // Detect VM environments via /proc/cpuinfo "hypervisor" flag or
 // sys_vendor strings and disable accelerated compositing + force
 // software GL so all content renders through the CPU path.
 let in_vm = std::fs::read_to_string("/proc/cpuinfo")
 .map(|c| c.contains("hypervisor"))
 .unwrap_or(false)
 || std::fs::read_to_string("/sys/class/dmi/id/sys_vendor")
 .map(|v| {
 let v = v.trim().to_lowercase();
 v.contains("qemu") || v.contains("vmware") || v.contains("virtualbox")
 || v.contains("apple") || v.contains("parallels") || v.contains("xen")
 || v.contains("microsoft") || v.contains("innotek")
 })
 .unwrap_or(false);

 if in_vm {
 if env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
 unsafe { env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1") };
 }
 if env::var_os("LIBGL_ALWAYS_SOFTWARE").is_none() {
 unsafe { env::set_var("LIBGL_ALWAYS_SOFTWARE", "1") };
 }
 eprintln!("[tauri] VM detected; disabled WebKitGTK accelerated compositing for iframe/video compatibility");
 }

 // NVIDIA proprietary drivers often fail to create a surfaceless EGL
 // display (EGL_BAD_ALLOC) in WebKitGTK's web process, especially on
 // Wayland where explicit sync can also cause flickering/crashes.
 // Detect NVIDIA by checking for /proc/driver/nvidia (created by
 // nvidia.ko) and apply Wayland-specific workarounds.
 let has_nvidia = std::path::Path::new("/proc/driver/nvidia").exists();
 if has_nvidia {
 if env::var_os("__NV_DISABLE_EXPLICIT_SYNC").is_none() {
 unsafe { env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1") };
 }
 // Force X11 backend on NVIDIA + Wayland to avoid surfaceless EGL
 // failures.  Users who prefer native Wayland can override with
 // GDK_BACKEND=wayland.
 if env::var_os("WAYLAND_DISPLAY").is_some() && env::var_os("GDK_BACKEND").is_none() {
 unsafe { env::set_var("GDK_BACKEND", "x11") };
 eprintln!(
 "[tauri] NVIDIA GPU + Wayland detected; forcing GDK_BACKEND=x11 to avoid EGL_BAD_ALLOC. \
 Set GDK_BACKEND=wayland to override."
 );
 }
 }

 // On Wayland-only compositors (e.g. niri, river, sway without XWayland),
 // GTK3 may fail to initialise if it defaults to X11 backend first and no
 // DISPLAY is set.  Explicitly prefer the Wayland backend when a Wayland
 // display is available.  Falls back to X11 if Wayland init fails.
 if env::var_os("WAYLAND_DISPLAY").is_some() && env::var_os("GDK_BACKEND").is_none() {
 unsafe { env::set_var("GDK_BACKEND", "wayland,x11") };
 }

 // Work around GLib version mismatch when running as an AppImage on newer
 // distros.  The AppImage bundles GLib from the CI build system (Ubuntu
 // 24.04, GLib 2.80).  Host GIO modules (e.g. GVFS's libgvfsdbus.so) may
 // link against newer GLib symbols absent in the bundled copy, producing:
 // "undefined symbol: g_task_set_static_name"
 // Point GIO_MODULE_DIR at the AppImage's bundled modules to isolate from
 // host libraries.  Also disable the WebKit bubblewrap sandbox which fails
 // inside AppImage's FUSE mount (causes blank screen on many distros).
 if env::var_os("APPIMAGE").is_some() && env::var_os("GIO_MODULE_DIR").is_none() {
 if let Some(module_dir) = resolve_appimage_gio_module_dir() {
 unsafe { env::set_var("GIO_MODULE_DIR", &module_dir) };
 } else if env::var_os("GIO_USE_VFS").is_none() {
 // Last-resort fallback: prefer local VFS backend if module path
 // discovery fails, which reduces GVFS dependency surface.
 unsafe { env::set_var("GIO_USE_VFS", "local") };
 eprintln!(
 "[tauri] APPIMAGE detected but bundled gio/modules not found; using GIO_USE_VFS=local fallback"
 );
 }
 }

 // WebKit2GTK's bubblewrap sandbox can fail inside an AppImage FUSE
 // mount, causing blank white screens. Disable it when running as
 // AppImage — the AppImage itself already provides isolation.
 //
 // R2-SEC-008: this weakens renderer isolation, so (a) users who know
 // their distro runs bubblewrap fine inside FUSE can opt out with
 // CRYSTALBALL_KEEP_WEBKIT_SANDBOX=1 (which also clears any inherited
 // disable variable so the opt-out actually holds), and (b) whenever
 // the sandbox ends up disabled we say so loudly on stderr (journal)
 // instead of silently.
 if env::var_os("APPIMAGE").is_some() {
 // WebKitGTK 2.39.3+ deprecated WEBKIT_FORCE_SANDBOX and now expects
 // WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 instead.  Setting the
 // old variable on newer WebKitGTK triggers a noisy deprecation
 // warning in the system journal, so only set the new one.
 if env::var_os("CRYSTALBALL_KEEP_WEBKIT_SANDBOX").is_some() {
 // An inherited disable var (e.g. from an old wrapper script) would
 // silently override the opt-out — clear it so KEEP means KEEP.
 if env::var_os("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS").is_some() {
 unsafe { env::remove_var("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS") };
 }
 eprintln!(
 "[tauri] CRYSTALBALL_KEEP_WEBKIT_SANDBOX set; leaving the WebKit bubblewrap sandbox enabled inside the AppImage"
 );
 } else if env::var_os("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS").is_none() {
 unsafe { env::set_var("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS", "1") };
 eprintln!(
 "[tauri] APPIMAGE detected: WebKit bubblewrap sandbox disabled (blank-screen workaround). Set CRYSTALBALL_KEEP_WEBKIT_SANDBOX=1 to keep it enabled."
 );
 } else {
 // Disable var was already present in the environment — the sandbox
 // is off because of it, not us, but the warning invariant still
 // applies: never disable silently.
 eprintln!(
 "[tauri] WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS inherited from environment: WebKit bubblewrap sandbox is disabled. Set CRYSTALBALL_KEEP_WEBKIT_SANDBOX=1 to clear it."
 );
 }
 // Prevent GTK from loading host input-method modules that may
 // link against incompatible library versions.
 if env::var_os("GTK_IM_MODULE").is_none() {
 unsafe { env::set_var("GTK_IM_MODULE", "gtk-im-context-simple") };
 }

 // The linuxdeploy GStreamer hook sets GST_PLUGIN_PATH_1_0 and
 // GST_PLUGIN_SYSTEM_PATH_1_0 to only contain bundled plugins.
 // CI installs the full GStreamer codec suite (base, good, bad,
 // ugly, libav, gl) so bundleMediaFramework=true bundles everything.
 //
 // IMPORTANT: Do NOT append host plugin directories — mixing plugins
 // compiled against a different GStreamer version causes ABI mismatches
 // (undefined symbol errors like gst_util_floor_log2, mpg123_open_handle64)
 // and leaves WebKit without usable codecs.  The AppImage must be fully
 // self-contained for GStreamer.
 //
 // If the linuxdeploy hook didn't set the paths (shouldn't happen),
 // explicitly block host plugin scanning to prevent ABI conflicts.
 if env::var_os("GST_PLUGIN_SYSTEM_PATH_1_0").is_none() {
 // Empty string prevents GStreamer from scanning /usr/lib/gstreamer-1.0
 unsafe { env::set_var("GST_PLUGIN_SYSTEM_PATH_1_0", "") };
 }
 }
 }

 tauri::Builder::default()
 .menu(build_app_menu)
 .on_menu_event(handle_menu_event)
 .manage(LocalApiState::default())
 // Empty SecretsCache — populated asynchronously from `setup()`.
 // Keeps the macOS Keychain off the main thread so the UI window
 // can render immediately on launch.
 .manage(SecretsCache::empty())
 .manage(AlwaysOnGuard(std::sync::Mutex::new(None)))
 .plugin(tauri_plugin_biometry::init())
 .plugin(tauri_plugin_clipboard_manager::init())
 .plugin(corelocation::init())
 .invoke_handler(tauri::generate_handler![
 list_supported_secret_keys,
 get_secret,
 secrets_ready,
 set_always_on,
 set_secret,
 delete_secret,
 reload_secrets_from_keychain,
 get_local_api_token,
 get_local_api_port,
 read_cache_entry,
 write_cache_entry,
 delete_cache_entry,
 save_brief,
 open_logs_folder,
 open_sidecar_log_file,
 log_frontend,
 renderer_heartbeat,
 take_watchdog_recovery,
 copy_diagnostics,
 open_settings_window_command,
 close_settings_window,
 open_url,
 open_system_prefs_location,
 get_native_location,
 open_youtube_login,
 open_youtube_logout,
 fetch_polymarket,
 send_notification,
 send_imessage,
 speak_aloud,
 install_update,
 update_mode_label,
 set_dock_badge,
 set_menubar_status
 ])
 .setup(|app| {
 // Load persistent cache into memory (avoids 14MB file I/O on every IPC call)
 let cache_path = cache_file_path(&app.handle()).unwrap_or_default();
 app.manage(PersistentCache::load(&cache_path));

 // ── Renderer watchdog ──────────────────────────────────────────────────
 // The renderer beats every 3s (log-bridge installRendererHeartbeat). If a
 // FOCUSED window stops beating for >60s the JS main thread is wedged — Defect
 // A's infinite-loop freeze (which ran 84 min, so 60s catches it easily) — so
 // log it and reload the webview. The threshold is deliberately well above
 // transient stalls: a heavy boot / data storm can block the main thread ~25s
 // and recovers on its own (the rAF-gap detector logs those), so a tight
 // threshold would false-reload during startup. Hidden/unfocused windows are
 // exempt (WKWebView throttles the heartbeat timer there).
 {
 let app_handle = app.handle().clone();
 std::thread::spawn(move || {
 std::thread::sleep(Duration::from_secs(60)); // let the renderer finish its heavy boot
 LAST_RENDERER_HEARTBEAT_MS.store(renderer_now_ms(), Ordering::Relaxed);
 let mut focused_since: Option<Instant> = None;
 let mut last_reload = Instant::now() - Duration::from_secs(600);
 let mut tick: u32 = 0;
 append_watchdog_log(&app_handle, "INFO", "renderer watchdog armed — dated log active");
 loop {
 std::thread::sleep(Duration::from_secs(3));
 tick = tick.wrapping_add(1);
 // Heartbeat tick to the dated log (~every 30s) — steady proof-of-life
 // that both the watchdog thread and the renderer's beat are alive,
 // regardless of focus.
 if tick % 10 == 0 {
 let beat_age = renderer_now_ms().saturating_sub(LAST_RENDERER_HEARTBEAT_MS.load(Ordering::Relaxed));
 let focused = app_handle.get_webview_window("main").and_then(|w| w.is_focused().ok()).unwrap_or(false);
 append_watchdog_log(&app_handle, "INFO", &format!("heartbeat: renderer last beat {beat_age}ms ago, focused={focused}"));
 }
 let win = match app_handle.get_webview_window("main") { Some(w) => w, None => continue };
 if !win.is_focused().unwrap_or(false) { focused_since = None; continue; }
 // Just gained focus: re-baseline so a resume isn't flagged before the
 // renderer's throttled heartbeat timer wakes back up.
 if focused_since.is_none() {
 focused_since = Some(Instant::now());
 LAST_RENDERER_HEARTBEAT_MS.store(renderer_now_ms(), Ordering::Relaxed);
 continue;
 }
 if focused_since.map(|t| t.elapsed()).unwrap_or_default() < Duration::from_secs(12) { continue; }
 let age = renderer_now_ms().saturating_sub(LAST_RENDERER_HEARTBEAT_MS.load(Ordering::Relaxed));
 if age > 60_000 {
 if last_reload.elapsed() < Duration::from_secs(120) { continue; } // no reload loop
 // Recovery path: log the stall, kick off forensic capture on its own
 // thread (so a slow sample can't delay recovery), then reload the webview.
 // We NEVER exit the app — a wedged renderer is recoverable, and exiting
 // would lose the session with no crash report.
 let msg = format!("renderer watchdog: no heartbeat for {age}ms while focused — capturing diagnostics + reloading webview (hung main thread)");
 append_desktop_log(&app_handle, "ERROR", &msg);
 append_watchdog_log(&app_handle, "ERROR", &msg);
 // Set the recovery flag BEFORE reload so the freshly-booted renderer can't
 // race ahead and consume a not-yet-set flag (which would strand a stale
 // toast for a later normal boot).
 WATCHDOG_RECOVERY_PENDING.store(true, Ordering::Relaxed);
 spawn_stall_capture(app_handle.clone());
 let _ = win.reload();
 append_watchdog_log(&app_handle, "INFO", "webview reloaded after stall — recovery toast pending; app NOT exited");
 last_reload = Instant::now();
 LAST_RENDERER_HEARTBEAT_MS.store(renderer_now_ms(), Ordering::Relaxed);
 focused_since = Some(Instant::now());
 }
 }
 });
 }

 // Mark the app data dir as excluded from Time Machine / iCloud so
 // persistent-cache.json (plaintext intelligence data) doesn't leave the machine.
 if let Ok(data_dir) = app.handle().path().app_data_dir() {
 exclude_app_data_from_backup(&data_dir);
 }

 // Create the main window programmatically so on_navigation can be attached
 // before the window exists — the callback is builder-only in Tauri 2.
 // macOSPrivateApi: true in tauri.conf.json enables transparent + vibrancy.
 #[allow(unused_mut)]
 let mut main_builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
  .title("Crystal Ball")
  .inner_size(1440.0, 960.0)
  .min_inner_size(1200.0, 720.0)
  .resizable(true)
  .transparent(true)
  .background_color(tauri::webview::Color(0, 0, 0, 0))
  .on_navigation(is_main_window_navigation);
 #[cfg(target_os = "macos")]
 {
  main_builder = main_builder
   .title_bar_style(TitleBarStyle::Overlay)
   .hidden_title(true);
 }
 main_builder.build().map_err(|e| format!("failed to create main window: {e}"))?;

 // Apply native macOS vibrancy (HudWindow material, 12pt rounded corners).
 // Pairs with `transparent: true` + `macOSPrivateApi: true` in tauri.conf.json
 // and the `app-root`/`app-titlebar` CSS in src/styles/window-chrome.css.
 #[cfg(target_os = "macos")]
 if let Some(window) = app.get_webview_window("main") {
 use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
 if let Err(err) = apply_vibrancy(
 &window,
 NSVisualEffectMaterial::HudWindow,
 Some(NSVisualEffectState::FollowsWindowActiveState),
 Some(12.0),
 ) {
 append_desktop_log(
 &app.handle(),
 "WARN",
 &format!("apply_vibrancy failed (continuing without vibrancy): {err}"),
 );
 }
 }

 append_desktop_log(
 &app.handle(),
 "INFO",
 &format!(
 "════════ SESSION START pid={} version={} bundle={} ════════",
 std::process::id(),
 env!("CARGO_PKG_VERSION"),
 env::current_exe()
 .ok()
 .and_then(|p| p.to_str().map(String::from))
 .unwrap_or_else(|| "?".into())
 ),
 );

 // ── Async boot: sidecar FIRST, keychain SECOND ───────────────────
 //
 // Nothing on the Tauri builder's main UI thread may block on the
 // macOS Keychain: `Entry::get_password()` can stall for up to
 // KEYCHAIN_VAULT_TIMEOUT (120s) while a Touch ID / "Always Allow"
 // ACL prompt is pending. Previously the sidecar boot lived in the
 // SAME task as the keychain read and ran AFTER it, so a stalled
 // Touch ID delayed the entire data backend for the full timeout —
 // the freeze this fixes.
 //
 // Now we boot the sidecar first with an empty cache (0 secrets),
 // then read the keychain on a worker thread, then inject the
 // secrets into the already-running sidecar via the same
 // `/api/local-env-update` IPC the renderer uses for live key edits.
 // The window and the data backend are both usable immediately; no
 // restart is required when the keychain finally resolves.
 let setup_handle = app.handle().clone();
 tauri::async_runtime::spawn(async move {
 // 1. Boot the sidecar without waiting on the keychain.
 //    start_local_api generates its own auth token and depends on
 //    no secret; with the cache still empty it ships 0 secrets in
 //    the env. It runs on a blocking thread because it waits (≤15s)
 //    for the sidecar to confirm its listening port.
 let start_handle = setup_handle.clone();
 let sidecar_ok = match tauri::async_runtime::spawn_blocking(move || start_local_api(&start_handle)).await {
 Ok(Ok(())) => true,
 Ok(Err(err)) => {
 append_desktop_log(
 &setup_handle,
 "ERROR",
 &format!("local API sidecar failed to start: {err}"),
 );
 eprintln!("[tauri] local API sidecar failed to start: {err}");
 false
 }
 Err(join_err) => {
 append_desktop_log(
 &setup_handle,
 "ERROR",
 &format!("sidecar start task panicked: {join_err}"),
 );
 false
 }
 };
 // Always read the keychain even if the sidecar failed: the cache feeds the
 // renderer (which polls `secrets_ready`) independently of the sidecar, and
 // leaving `loaded` false would make both windows poll until the client cap.
 // We just skip the IPC injection below — there's no sidecar to inject into,
 // and its port_confirmed/liveness guards would no-op the push anyway.

 // 2. Read the keychain on a worker thread. Bounded by the per-call
 //    timeouts (≤120s for the consolidated vault), but the UI and
 //    sidecar are already live so this no longer blocks startup.
 let load_handle = setup_handle.clone();
 let (secrets, vault_timed_out): (Vec<(String, String)>, bool) = tauri::async_runtime::spawn_blocking(move || {
 let cache = load_handle.state::<SecretsCache>();
 let timed_out = cache.populate_from_keychain(Some(&load_handle), KEYCHAIN_VAULT_TIMEOUT);
 let snapshot: Vec<(String, String)> = cache
 .secrets
 .lock()
 .map(|m| m.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
 .unwrap_or_default();
 (snapshot, timed_out)
 })
 .await
 .unwrap_or_default();
 append_desktop_log(
 &setup_handle,
 "INFO",
 &format!(
 "secrets-cache: loaded {} keys from keychain (async)",
 secrets.len()
 ),
 );

 // 3. Inject the loaded secrets into the live sidecar via IPC — no
 //    restart. Until this completes, key-dependent routes return
 //    503 + `keyMissing`, exactly as on a cold cache. Skipped when the
 //    sidecar never started — the renderer already has the secrets.
 let initial_count = secrets.len();
 if sidecar_ok {
 inject_secrets_into_running_sidecar(&setup_handle, secrets).await;
 }

 // 4. Self-heal: if the boot vault read TIMED OUT (not merely empty), we
 //    are running on the possibly-stale shadow copy. The macOS keychain
 //    frequently answers a few seconds after the 10s boot cutoff, but the
 //    boot path orphans that worker and discards the late answer. Fire ONE
 //    detached retry with a long deadline; on success re-inject the
 //    recovered keys so the session heals with no relaunch or ACL prompt.
 if vault_timed_out {
 let retry_handle = setup_handle.clone();
 tauri::async_runtime::spawn(async move {
 let blocking_handle = retry_handle.clone();
 let recovered: Vec<(String, String)> = tauri::async_runtime::spawn_blocking(move || {
 let cache = blocking_handle.state::<SecretsCache>();
 // Vault-ONLY read — must never reach the per-key migration/delete path.
 if cache.repopulate_vault_only(&blocking_handle, KEYCHAIN_VAULT_RETRY_TIMEOUT) {
 cache
 .secrets
 .lock()
 .map(|m| m.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
 .unwrap_or_default()
 } else {
 Vec::new()
 }
 })
 .await
 .unwrap_or_default();
 if recovered.len() > initial_count {
 append_desktop_log(
 &retry_handle,
 "INFO",
 &format!(
 "secrets-cache: background retry recovered {} keys (boot read had {})",
 recovered.len(),
 initial_count,
 ),
 );
 if sidecar_ok {
 inject_secrets_into_running_sidecar(&retry_handle, recovered).await;
 }
 }
 });
 }
 });

 // Request Location Services authorization so the app appears in
 // System Settings > Privacy & Security > Location Services.
 // The CLLocationManager must be retained for the app's lifetime —
 // if deallocated, macOS revokes the authorization.
 #[cfg(target_os = "macos")]
 {
 use std::ffi::c_void;
 extern "C" {
  fn objc_getClass(name: *const u8) -> *mut c_void;
  fn sel_registerName(name: *const u8) -> *mut c_void;
  fn objc_msgSend(receiver: *mut c_void, sel: *mut c_void, ...) -> *mut c_void;
  fn objc_retain(obj: *mut c_void) -> *mut c_void;
 }
 unsafe {
  let cls = objc_getClass(b"CLLocationManager\0".as_ptr());
  if !cls.is_null() {
   let alloc_sel = sel_registerName(b"alloc\0".as_ptr());
   let init_sel = sel_registerName(b"init\0".as_ptr());
   let req_sel = sel_registerName(b"requestWhenInUseAuthorization\0".as_ptr());
   let mgr = objc_msgSend(objc_msgSend(cls, alloc_sel), init_sel);
   if !mgr.is_null() {
    objc_msgSend(mgr, req_sel);
    // Leak the manager intentionally so it lives for the process lifetime.
    // Without this, deallocation cancels the authorization.
    //
    // `objc_retain` is what keeps the object alive — calling
    // `std::mem::forget(mgr)` on a `*mut c_void` is a no-op because
    // raw pointers implement Copy (the original goes out of scope
    // either way). The retain bumped the refcount so the object
    // already outlives this scope.
    let _ = objc_retain(mgr);
   }
  }
 }
 }

 Ok(())
 })
 .build(tauri::generate_context!())
 .expect("error while running crystalball tauri application")
 .run(|app, event| {
 match &event {
 // macOS: hide window on close instead of quitting (standard behavior)
 #[cfg(target_os = "macos")]
 RunEvent::WindowEvent {
 label,
 event: WindowEvent::CloseRequested { api, .. },
 ..
 } if label == "main" => {
 api.prevent_close();
 if let Some(w) = app.get_webview_window("main") {
 let _ = w.hide();
 }
 }
 // macOS: reshow window when dock icon is clicked
 #[cfg(target_os = "macos")]
 RunEvent::Reopen { .. } => {
 if let Some(w) = app.get_webview_window("main") {
 let _ = w.show();
 let _ = w.set_focus();
 }
 }
 // Only macOS needs explicit re-raising to keep settings above the main window.
 // On Windows, focusing the settings window here can trigger rapid focus churn
 // between windows and present as a UI hang.
 #[cfg(target_os = "macos")]
 RunEvent::WindowEvent {
 label,
 event: WindowEvent::Focused(true),
 ..
 } if label == "main" => {
 if let Some(sw) = app.get_webview_window("settings") {
 let _ = sw.show();
 let _ = sw.set_focus();
 }
 }
 RunEvent::ExitRequested { code, .. } => {
 append_desktop_log(
 app,
 "INFO",
 &format!("RunEvent::ExitRequested code={:?} pid={}", code, std::process::id()),
 );
 // Flush in-memory cache to disk before quitting
 if let Ok(path) = cache_file_path(app) {
 if let Some(cache) = app.try_state::<PersistentCache>() {
 let _ = cache.flush(&path, true);
 }
 }
 stop_local_api(app);
 }
 RunEvent::Exit => {
 append_desktop_log(
 app,
 "INFO",
 &format!("RunEvent::Exit pid={}", std::process::id()),
 );
 if let Ok(path) = cache_file_path(app) {
 if let Some(cache) = app.try_state::<PersistentCache>() {
 let _ = cache.flush(&path, true);
 }
 }
 stop_local_api(app);
 }
 #[cfg(target_os = "macos")]
 RunEvent::WindowEvent {
 label,
 event: WindowEvent::CloseRequested { .. },
 ..
 } => {
 append_desktop_log(
 app,
 "INFO",
 &format!("WindowEvent::CloseRequested label={label}"),
 );
 }
 _ => {}
 }
 });
}

#[cfg(test)]
mod navigation_guard_tests {
 use super::{is_main_window_navigation, is_trusted_window_navigation, Url};

 fn url(s: &str) -> Url {
  Url::parse(s).expect("valid test url")
 }

 // ── main-window guard ────────────────────────────────────────────────────

 #[test]
 fn main_window_allows_tauri_scheme() {
  assert!(is_main_window_navigation(&url("tauri://localhost/index.html")));
 }

 #[test]
 fn main_window_allows_windows_app_origin() {
  // WebView2 serves bundled app content from this host on Windows production
  // builds; same-origin reloads must not be canceled there.
  assert!(is_main_window_navigation(&url("http://tauri.localhost/index.html")));
  assert!(is_main_window_navigation(&url("https://tauri.localhost/settings")));
 }

 #[test]
 fn main_window_rejects_loopback_service() {
  // A compromised renderer must not redirect `main` to a sibling loopback
  // service and inherit trusted-window IPC privileges.
  assert!(!is_main_window_navigation(&url("http://127.0.0.1:46123/api/analyst-state")));
  assert!(!is_main_window_navigation(&url("https://127.0.0.1/anything")));
 }

 #[test]
 fn main_window_rejects_external_origin() {
  assert!(!is_main_window_navigation(&url("https://evil.example.com/")));
  // A look-alike host that merely ends in the trusted suffix must not pass.
  assert!(!is_main_window_navigation(&url("https://tauri.localhost.evil.com/")));
 }

 #[cfg(debug_assertions)]
 #[test]
 fn main_window_allows_localhost_dev_only_in_debug() {
  assert!(is_main_window_navigation(&url("http://localhost:3001/")));
 }

 // ── live-channels (trusted aux) guard ────────────────────────────────────

 #[test]
 fn trusted_window_allows_tauri_scheme() {
  assert!(is_trusted_window_navigation(&url("tauri://localhost/index.html")));
 }

 #[test]
 fn trusted_window_allows_windows_app_origin() {
  // Parity with the main-window guard: bundled content served by WebView2.
  assert!(is_trusted_window_navigation(&url("http://tauri.localhost/live-channels.html")));
  assert!(is_trusted_window_navigation(&url("https://tauri.localhost/live-channels.html")));
 }

 #[test]
 fn trusted_window_rejects_external_origin() {
  assert!(!is_trusted_window_navigation(&url("https://evil.example.com/")));
  // A look-alike host that merely ends in the trusted suffix must not pass.
  assert!(!is_trusted_window_navigation(&url("https://tauri.localhost.evil.com/")));
 }

 // Loopback is allowed ONLY in debug builds (the dev server / sidecar origin
 // the window is loaded from). In release builds it is compiled out, so a
 // compromised renderer cannot navigate to a sibling loopback service and
 // inherit the window's trusted-window IPC privileges.
 #[cfg(debug_assertions)]
 #[test]
 fn trusted_window_allows_loopback_dev_only_in_debug() {
  assert!(is_trusted_window_navigation(&url("http://127.0.0.1:46123/live-channels.html")));
  assert!(is_trusted_window_navigation(&url("http://localhost:3001/live-channels.html")));
 }
}

#[cfg(test)]
mod watchdog_log_tests {
 use super::epoch_to_utc;

 #[test]
 fn epoch_to_utc_known_instants() {
  assert_eq!(epoch_to_utc(0), (1970, 1, 1, 0, 0, 0));
  assert_eq!(epoch_to_utc(86_400), (1970, 1, 2, 0, 0, 0));
  // 2024-01-01T00:00:00Z (post-leap boundary)
  assert_eq!(epoch_to_utc(1_704_067_200), (2024, 1, 1, 0, 0, 0));
  // 2025-01-01T00:00:00Z (2024 was a 366-day leap year)
  assert_eq!(epoch_to_utc(1_735_689_600), (2025, 1, 1, 0, 0, 0));
  // time-of-day extraction: +1h1m1s
  assert_eq!(epoch_to_utc(1_704_070_861), (2024, 1, 1, 1, 1, 1));
 }
}
