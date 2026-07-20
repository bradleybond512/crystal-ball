# Crystal Ball — Security Audit Report
**Date:** 2026-07-17  
**Auditor:** Claude Sonnet 4.6  
**Scope:** Full security audit of Tauri 2 + TypeScript + Vite desktop app + Node.js sidecar (port 46123)  
**Repo:** bradleybond512/crystal-ball

---

## Executive Summary

The audit covered nine threat surfaces: hardcoded secrets, Tauri IPC handler validation, sidecar HTTP API auth/CORS, XSS vectors, CSP configuration, localStorage sensitive data, keychain/credential handling, dependency supply chain, and shell execution with unsanitized input.

**Findings by severity:**
- Critical: 0
- High: 9 (all fixed — PRs #1443, #1444)
- Medium: 3 (all fixed — PRs #1445, #1446)
- Low: 2 (1 fixed — PR #1446; 1 informational)
- Informational: 4

All High findings have been remediated and PRs opened. No critical findings were identified.

---

## HIGH Findings (Fixed)

### H1 — XSS: Unescaped USGS region name in innerHTML
**File:** `src/app/panel-layout.ts` ~line 2912  
**PR:** #1443 (`claude/security-xss-fixes`)

`r.region` from the USGS earthquake GeoJSON API was interpolated directly into an innerHTML template literal without escaping. A malicious or compromised USGS response with `<script>` in the region field would execute arbitrary JavaScript in the Tauri renderer process, which runs at the OS level with full Tauri IPC access.

**Fix:** Wrapped with `escapeHtml(r.region)` (function already imported from `@/utils/sanitize`).

---

### H2 — XSS: javascript: URI in CVE tracker href
**File:** `src/components/CveTrackerPanel.ts`  
**PR:** #1443 (`claude/security-xss-fixes`)

`r.nvdUrl` (sourced from the NVD API) was placed in an `href` attribute using `escapeHtml()`. The `escapeHtml` function encodes HTML entities but does not reject `javascript:` scheme URIs, so a `javascript:alert(1)` value would survive encoding and execute on click.

**Fix:** Changed to `sanitizeUrl(r.nvdUrl)` which explicitly rejects non-http(s) schemes before encoding.

---

### H3 — XSS: javascript: URI in Vulners CVE panel href
**File:** `src/components/VulnersCvePanel.ts`  
**PR:** #1443 (`claude/security-xss-fixes`)

Same issue as H2 — CVE advisory URLs from Vulners API used `escapeHtml()` in href context.

**Fix:** Changed to `sanitizeUrl()`.

---

### H4 — XSS: Unescaped LLM-returned provider name in innerHTML
**File:** `src/components/NotificationDigestPanel.ts` line 156  
**PR:** #1443 (`claude/security-xss-fixes`)

`digest.provider` is a string produced by the analyst LLM reasoning layer and was interpolated raw into a `<span>` innerHTML. A malicious or hallucinated provider string containing HTML/script tags would execute in the renderer.

**Fix:** Wrapped with `this.esc(digest.provider)` (panel's existing escape helper).

---

### H5 — IPC: GPS exfiltration from any webview window
**File:** `src-tauri/src/corelocation.rs`  
**PR:** #1444 (`claude/security-ipc-hardening`)

`get_location()` had no trusted-window guard. Any injected iframe, future third-party webview, or renderer compromise could call this IPC command and receive the user's GPS coordinates.

**Fix:** Added `webview: tauri::Webview` parameter and a `TRUSTED_WINDOWS` check matching the pattern already used in `main.rs`:
```rust
const TRUSTED_WINDOWS: &[&str] = &["main", "settings", "live-channels"];
if !TRUSTED_WINDOWS.contains(&webview.label()) {
    return Err(format!("get_location may only be called from a trusted window"));
}
```

---

### H6 — IPC: open_url private-address blocklist bypass
**File:** `src-tauri/src/main.rs` (`open_url` command)  
**PR:** #1444 (`claude/security-ipc-hardening`)

The blocklist checked 127.0.0.1, 10.x, 192.168.x, and .local — but missed:
- `[::1]` (IPv6 loopback — different string from `::1`)
- `172.16.0.0/12` (RFC 1918 — 172.16.x through 172.31.x)
- `169.254.0.0/16` link-local
- `fe80::/10` IPv6 link-local
- `100.64.0.0/10` CGNAT (used by Tailscale, AWS metadata v2 in some configs)
- `fc00::/7` IPv6 ULA

An attacker triggering an `open_url` call to `http://172.16.0.1/` (an internal router) or `http://100.64.0.1/` (Tailscale) would bypass the blocklist.

**Fix:** Extended blocklist with all missing ranges. Added two pure helper functions (`is_172_16_range`, `is_cgnat_range`) inserted immediately before the `open_url` command.

---

### H7 — IPC: save_brief path traversal via blacklist bypass
**File:** `src-tauri/src/main.rs` (`save_brief` command)  
**PR:** #1444 (`claude/security-ipc-hardening`)

Filename validation used a blacklist: reject if empty, contains `/`, `\`, or null byte. Blacklists are inherently incomplete — e.g., a filename of `....` or using Unicode lookalike path separators could pass.

**Fix:** Changed to a whitelist: only alphanumeric characters plus `-`, `_`, `.`, and space are permitted. Also explicitly reject `.` and `..`.

---

### H8–H9 — IPC: Window management commands callable from untrusted windows
**File:** `src-tauri/src/main.rs`  
**PR:** #1444 (`claude/security-ipc-hardening`)

Four IPC commands lacked `require_trusted_window()` guards:
- `open_settings_window_command` — can eval JavaScript into the main window
- `close_settings_window` — can close the settings window
- `close_live_channels_window` — can close the live-channels window
- `open_youtube_login` — can spawn the YouTube login OAuth window

Any renderer context (injected ad iframe, future third-party panel) could call these. The `open_settings_window_command` handler calls `win.eval(...)` to dispatch a custom event — an attacker triggering this from a compromised renderer gets arbitrary JS execution in the main window.

**Fix:** Added `webview: Webview` parameter and `require_trusted_window(webview.label())?` as the first statement in all four handlers.

---

## MEDIUM Findings (Fixed)

### M1 — Supply chain: GramJS telegram dependency unpinned
**File:** `package.json`  
**PR:** #1445 (`claude/security-supply-chain`)

`"telegram": "^2.26.22"` — the caret range permits automatic installation of any 2.x.y minor or patch release without an explicit upgrade decision. GramJS implements MTProto and has deep access to network connections and message content. A compromised patch release (typosquatting, account hijack, or malicious maintainer) would be pulled in automatically on the next clean install.

**Fix:** Pinned to `"telegram": "2.26.22"` (exact version, no range).

---

### M2 — Sidecar: MCP post() bypasses SSRF guard
**File:** `tools/mcp-server/sidecar-client.mjs`  
**PR:** #1446 (`claude/security-sidecar-hardening`)

`get()` used `buildUrl(route)` which validates the route starts with `/` and that the resolved host stays at `127.0.0.1:<port>`. `post()` constructed the URL via raw template literal: `` `http://127.0.0.1:${port}${route}` ``. If a future MCP tool passes a caller-supplied route string, the validation is bypassed.

**Fix:** Changed `post()` to use `buildUrl(route)` with a null check, matching the pattern already in `get()`.

---

### M3 — Sidecar: Stale comment misrepresents auth scope
**File:** `src-tauri/sidecar/local-api-server.mjs`  
**PR:** #1446 (`claude/security-sidecar-hardening`)

A comment stated that analyst-state and analyst-commands routes were "deliberately unauthenticated loopback-only routes." Both routes are actually gated behind the global `LOCAL_API_TOKEN` bearer token check. The comment creates confusion that could lead a future developer to remove the auth check thinking it is intentional.

**Fix:** Removed the misleading comment; replaced with accurate description.

---

## LOW Findings (Fixed)

### L1 — Sidecar: API key inventory in unauthenticated health response
**File:** `src-tauri/sidecar/local-api-server.mjs`  
**PR:** #1446 (`claude/security-sidecar-hardening`)

`/api/health` returned `keys_missing: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", ...]` — a full array of missing key names — without requiring a bearer token. Any process on the machine (or on the local network if the loopback binding were to change) could enumerate which API integrations are configured.

**Fix:** Changed to `keys_missing_count: missing.length` — the diagnostic count is preserved for status displays, but the key names are not exposed.

---

## LOW Findings (Informational — No PR)

### L2 — localStorage: No sensitive values found
**Files:** All `src/**/*.ts` localStorage reads/writes

All `crystalball-*` and `cb-*` localStorage keys store UI preferences, panel pins, deck configuration, basemap selection, and the classic-view opt-out flag. No API keys, tokens, or personally identifying information are written to localStorage. The web key vault stores secrets in IndexedDB under AES-GCM-256 encryption, not localStorage. No action required.

---

## Informational Findings

### I1 — CSP: unsafe-eval required by Cesium
**File:** `src-tauri/capabilities/default.json`, `index.html`

`script-src` includes `'unsafe-eval'`, required by Cesium Ion for WebGL shader compilation. This is a known, documented, accepted trade-off (noted in CLAUDE.md). Compensating controls are in place: no `'unsafe-inline'` on script-src, trusted-window IPC gating, sidecar bearer auth, devtools disabled in production. No action needed unless Cesium is replaced.

### I2 — Keychain: No direct access from TypeScript layer
All keychain operations go through Tauri IPC to `src-tauri/src/main.rs` which uses the `keyring` crate. The TypeScript layer never holds key material beyond the current call. The CLAUDE.md prohibition on direct keychain manipulation is correctly enforced by the IPC boundary. No finding.

### I3 — Shell execution: No unsanitized shell calls found
Grep of `Command::new`, `std::process`, `shell.execute`, and equivalents shows all subprocess calls use argument arrays (not shell interpolation strings). The sidecar process is spawned by Tauri with a fixed binary path. No shell injection surface found.

### I4 — Hardcoded secrets: None found
Scanned all TypeScript, Rust, and JavaScript source files for API key patterns (hex strings ≥32 chars, base64 ≥40 chars, known key prefixes like `sk-`, `ghp_`, etc.). All key references are either placeholder strings (e.g., `"YOUR_API_KEY"`) or reads from the keychain/vault via the runtime-config abstraction. No live secrets in source.

---

## Pull Requests

| PR | Branch | Severity | Files |
|----|--------|----------|-------|
| [#1443](https://github.com/bradleybond512/crystal-ball/pull/1443) | `claude/security-xss-fixes` | HIGH (×4) | panel-layout.ts, CveTrackerPanel.ts, VulnersCvePanel.ts, NotificationDigestPanel.ts |
| [#1444](https://github.com/bradleybond512/crystal-ball/pull/1444) | `claude/security-ipc-hardening` | HIGH (×5) | src-tauri/src/main.rs, src-tauri/src/corelocation.rs |
| [#1445](https://github.com/bradleybond512/crystal-ball/pull/1445) | `claude/security-supply-chain` | MEDIUM | package.json |
| [#1446](https://github.com/bradleybond512/crystal-ball/pull/1446) | `claude/security-sidecar-hardening` | MEDIUM/LOW | sidecar-client.mjs, local-api-server.mjs, granular.mjs |

---

## Recommended Follow-up (Not Blocking)

1. **Subresource Integrity (SRI)** — CDN scripts loaded in the web build (cdnjs.cloudflare.com) lack `integrity=` attributes. If cdnjs is compromised, injected scripts execute without detection.
2. **Lock file integrity** — Add `npm ci --ignore-scripts` (not `npm install`) to CI to prevent postinstall script execution from unpinned transitive deps.
3. **Widen the trusted-window allowlist review** — Consider whether `live-channels` needs access to GPS (`get_location`). If not, remove it from `TRUSTED_WINDOWS` in corelocation.rs.
4. **Periodic dep audit** — Add `npm audit --audit-level=high` to the CI pipeline to catch future supply-chain advisories automatically.
