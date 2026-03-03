use std::path::PathBuf;
use std::process::Command;

use serde::Deserialize;
use serde_json::Value;
use tauri::Manager;

/// Locate the osint-engine binary. In debug builds, looks relative to the
/// Tauri manifest directory. In release builds, looks in the resource dir.
fn osint_engine_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    // Debug: look next to the sidecar script
    if cfg!(debug_assertions) {
        let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("sidecar")
            .join(osint_binary_name());
        if dev_path.is_file() {
            return Some(dev_path);
        }
    }

    // Release: look in the Tauri resource dir
    if let Ok(resource_dir) = app.path().resource_dir() {
        let release_path = resource_dir.join("sidecar").join(osint_binary_name());
        if release_path.is_file() {
            return Some(release_path);
        }
    }

    None
}

fn osint_binary_name() -> &'static str {
    if cfg!(windows) {
        "osint-engine.exe"
    } else {
        "osint-engine"
    }
}

/// Invoke the osint-engine binary with the given arguments and return the
/// parsed JSON output.
fn invoke_osint_engine(
    app: &tauri::AppHandle,
    args: &[&str],
) -> Result<Value, String> {
    let binary = osint_engine_path(app)
        .ok_or_else(|| "osint-engine binary not found. Run `make build` in src-tauri/go/".to_string())?;

    // Pass VirusTotal key if set in the secrets cache
    let vt_key = {
        let cache = app.state::<crate::SecretsCache>();
        cache
            .secrets
            .lock()
            .map(|secrets| secrets.get("VIRUSTOTAL_API_KEY").cloned())
            .ok()
            .flatten()
            .unwrap_or_default()
    };

    let mut cmd = Command::new(&binary);
    cmd.args(args);
    if !vt_key.is_empty() {
        cmd.env("VIRUSTOTAL_API_KEY", &vt_key);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to launch osint-engine: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Try to extract error message from JSON
        if let Ok(err_json) = serde_json::from_slice::<OsintError>(&output.stderr) {
            return Err(err_json.error);
        }
        return Err(format!("osint-engine exited with error: {stderr}"));
    }

    serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse osint-engine output: {e}"))
}

#[derive(Deserialize)]
struct OsintError {
    error: String,
}

/// Look up domain intelligence (WHOIS, DNS, SSL, Wayback, optional VirusTotal).
#[tauri::command]
pub async fn lookup_domain(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    domain: String,
) -> Result<Value, String> {
    crate::require_trusted_window(webview.label())?;
    // Validate domain length to prevent log injection / resource abuse
    if domain.is_empty() || domain.len() > 253 {
        return Err("Domain must be between 1 and 253 characters".to_string());
    }
    invoke_osint_engine(&app, &["lookup-domain", &domain])
}

/// Search for a username across social media platforms.
#[tauri::command]
pub async fn search_username(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    username: String,
) -> Result<Value, String> {
    crate::require_trusted_window(webview.label())?;
    if username.is_empty() || username.len() > 64 {
        return Err("Username must be between 1 and 64 characters".to_string());
    }
    invoke_osint_engine(&app, &["search-username", &username])
}

/// Clear all cached OSINT results.
#[tauri::command]
pub async fn clear_osint_cache(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> Result<(), String> {
    crate::require_trusted_window(webview.label())?;
    invoke_osint_engine(&app, &["clear-cache"])?;
    Ok(())
}
