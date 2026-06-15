# Crystal Ball Security Audit — 2026-06-11

Read-only audit covering the Tauri IPC surface, Content Security Policy, sidecar authentication, secrets handling, network security, input validation/injection, dependency vulnerabilities, and data at rest. Branch under audit: `claude/temporal-world-store` (includes the new Temporal World Store event log, which received extra scrutiny).

Methodology: five parallel read-only code-review passes (IPC, CSP+auth, secrets, network, injection), direct dependency scans (`cargo audit`; npm advisory bulk API queried directly from `package-lock.json` because `npm audit` hit a local Node socket bug), and on-disk permission inspection of runtime artifacts. No files outside this report were modified; no keychain operations were performed.

---

## Executive Summary

**No Critical findings. 3 High, 7 Medium, 8 Low, 7 Informational. Both dependency scans are clean (0 advisories across 1,048 npm packages and 608 Rust crates).**

The overall security posture is strong and clearly the product of prior hardening rounds:

- **IPC surface**: All 33 Tauri commands enumerated; secret operations (`get_secret`/`set_secret`/`delete_secret`) are gated by both a trusted-window check and the 73-key `SUPPORTED_SECRET_KEYS` allowlist. Capabilities are narrowly scoped. The updater verifies SHA-256 against a GitHub host allowlist.
- **Sidecar auth**: 256-bit CSPRNG bearer token, timing-safe comparison, global auth gate correctly positioned. The new `/api/events/*` routes (query/count/health/prune) are all behind the gate. `RELAY_ALLOW_ANON` **no longer exists**; its successor `ALLOW_UNAUTHENTICATED_RELAY` is hard-gated to non-production.
- **Injection**: The new SQLite event store is fully parameterized (the Codex-flagged LIKE-wildcard escape is verified fixed with `ESCAPE` + tests). No `eval` or dynamic Function constructors anywhere in `src/`. Every audited panel (including the new `EventStorePanel`) escapes all dynamic values; markdown rendering goes through DOMPurify with a strict allowlist.
- **SSRF**: No generic proxy endpoint. `isSafeUrl()` blocks private ranges and resolves DNS to defeat rebinding.

The High findings are concentrated in two areas: **five plain-HTTP calls** in the sidecar (two production data fetches, three API-key validation probes that send the user's credential in a cleartext query string), and the **world-readable plaintext `.env.local`** holding 29 API keys. All three are quick fixes.

| Severity | Count | Theme |
|---|---|---|
| Critical | 0 | — |
| High | 3 | Plain-HTTP credential/data exposure; plaintext key file permissions |
| Medium | 7 | Token-on-disk, CSP breadth, LLM egress disclosure, origin-regex drift |
| Low | 8 | Defense-in-depth gaps (gates, validation tightening, file modes) |
| Informational | 7 | Doc drift, documented limitations, verified-correct behaviors |

---

## Critical Findings

None identified.

---

## High Findings

### H-1: API-key validation probes send credentials over plain HTTP

- **Files**: [local-api-server.mjs:4335](../src-tauri/sidecar/local-api-server.mjs) (MediaStack), [local-api-server.mjs:4466](../src-tauri/sidecar/local-api-server.mjs) (AviationStack), [local-api-server.mjs:4541](../src-tauri/sidecar/local-api-server.mjs) (GeoNames)
- **Severity**: High
- **What it is**: When the user tests an API key in Settings, `validateSecretAgainstProvider()` sends the key as a cleartext query-string parameter over `http://`:

  ```javascript
  // line 4335
  fetchWithTimeout(`http://api.mediastack.com/v1/news?access_key=${encodeURIComponent(value)}&limit=1`, ...)
  // line 4466
  fetchWithTimeout(`http://api.aviationstack.com/v1/flights?access_key=${encodeURIComponent(value)}&limit=1`, ...)
  // line 4541
  fetchWithTimeout(`http://api.geonames.org/searchJSON?q=london&maxRows=1&username=${encodeURIComponent(value)}`, ...)
  ```

- **Why it matters**: Any on-path attacker (shared Wi-Fi, compromised router) captures the freshly entered credential in cleartext. Key validation is exactly the moment a user is handling a new credential, often on whatever network they happen to be on.
- **Remediation**: Switch all three URLs to `https://` (all three providers serve HTTPS on these endpoints; aviationstack's free tier historically gated HTTPS — verify and, if still gated, skip live validation rather than leak the key). Add a CI/pre-commit grep that fails on `http://` to non-localhost hosts in `src-tauri/sidecar/`.

### H-2: Production data fetches over plain HTTP (ip-api.com batch geolocation, MediaStack news)

- **Files**: [local-api-server.mjs:1124](../src-tauri/sidecar/local-api-server.mjs) (ip-api.com), [local-api-server.mjs:10167](../src-tauri/sidecar/local-api-server.mjs) (MediaStack)
- **Severity**: High
- **What it is**: Two production code paths fetch over `http://`:

  ```javascript
  // line 1124 — batch IP geolocation used by intelligence workflows
  fetchWithTimeout('http://ip-api.com/batch?fields=query,country,countryCode,lat,lon', { method: 'POST', ... body: JSON.stringify(batch) }, 8000);
  // line 10167 — news fetch; params include the MediaStack API key
  fetchWithTimeout(`http://api.mediastack.com/v1/news?${params}`, ...)
  ```

- **Why it matters**: (1) The set of IPs the app is investigating is itself intelligence — a network observer learns what infrastructure the user is analyzing, and an active attacker can inject false geolocation results that corrupt downstream analysis. (2) The news response feeds analyst briefs; an attacker can tamper with article content in flight. The MediaStack key also travels in cleartext on every news fetch (recurring exposure, unlike H-1's one-shot).
- **Remediation**: MediaStack supports HTTPS — switch line 10167 (and 4335). ip-api.com's free tier is HTTP-only; either move to its paid HTTPS endpoint or substitute an HTTPS-only provider already integrated (ipinfo.io / ipquery.io appear elsewhere in the sidecar). Same CI guard as H-1.

### H-3: Plaintext `.env.local` fallback key file is world-readable (0644)

- **Files**: `.env.local` (mode `-rw-r--r--`, verified on disk), loader: [env-local-loader.mjs](../src-tauri/sidecar/env-local-loader.mjs), wired at [local-api-server.mjs:118-126](../src-tauri/sidecar/local-api-server.mjs)
- **Severity**: High
- **What it is**: The post-keychain-incident fallback file contains ~29 plaintext API keys (Anthropic, Groq, VirusTotal, …) and is readable by every account and process on the machine. The loader performs no permission check before parsing it.
- **Why it matters**: This bypasses everything the keychain architecture protects against. Any local process running as any user — including unsandboxed apps, backup agents, and sync tools — can read live credentials. Time-Machine/cloud backups will carry the plaintext copies forward indefinitely.
- **Remediation**:
  1. `chmod 600 .env.local` (one command, do it now).
  2. Add a permission check to `loadEnvFile()` in `env-local-loader.mjs` — refuse to load (with a logged warning) when `(stat.mode & 0o077) !== 0`.
  3. Log a one-line notice whenever the fallback path is actually used, so silent reliance on the plaintext file is visible.

---

## Medium Findings

### M-1: Sidecar bearer token persisted to disk

- **Files**: [main.rs:2459](../src-tauri/src/main.rs) (write), [main.rs:2723](../src-tauri/src/main.rs) (cleanup); on disk at `~/Library/Logs/com.bradleybond.crystalball/sidecar.token`
- **Severity**: Medium (known — tracked as SEC-006 in `docs/SECURITY_SCAN_FINDINGS_FOR_CLAUDE.md`)
- **What it is**: The 256-bit local-API token is written to `sidecar.token` (verified mode `0600`) so the MCP server and local tooling can authenticate. It is rotated per launch and deleted on clean shutdown.
- **Why it matters**: A file token is exposed to backup capture, crash-leftover staleness, and any same-UID malware. Mode 0600 and per-session rotation substantially mitigate, but the at-rest copy is the weakest link in an otherwise in-memory auth chain.
- **Remediation**: Prefer an in-memory handoff (e.g., MCP server receives the token via env/stdin at spawn). If the file must stay, verify diagnostics exports redact it, and add a startup self-test that asserts mode 0600 and deletes stale tokens from prior crashed sessions.

### M-2: Web CSP `frame-src` allows any localhost port (`http://127.0.0.1:*`)

- **File**: [index.html:7](../index.html)
- **Severity**: Medium
- **What it is**: The web/dev meta CSP allows framing from any 127.0.0.1 port, whereas the desktop CSP ([tauri.conf.json:36](../src-tauri/tauri.conf.json)) pins exactly `http://127.0.0.1:46123`.
- **Why it matters**: Any service that happens to listen on a local port (including malware-planted ones) can be framed by the web build, giving it a UI-redressing / content-injection foothold inside the app shell.
- **Remediation**: Replace the wildcard with the explicit dev-port list already used elsewhere (3000, 1420, 5173, 46123), matching the sidecar CORS allowlist.

### M-3: `connect-src https:` allows exfiltration to any HTTPS host

- **Files**: [tauri.conf.json:36](../src-tauri/tauri.conf.json), [index.html:7](../index.html)
- **Severity**: Medium (accepted-by-design; documented in `docs/CSP_AUDIT.md`)
- **What it is**: Both CSPs allow `connect-src ... https: ws: wss:` (web adds `blob: data:`). Combined with `script-src 'unsafe-eval'` (required by Cesium), a single XSS or eval-gadget compromise can exfiltrate anything reachable in the renderer to an attacker-controlled HTTPS host.
- **Why it matters**: The app intentionally talks to ~85 external domains, so a domain allowlist is high-maintenance — but `https:` blanket scope means CSP provides no egress containment at all. The compensating controls (no secrets in renderer except via gated IPC, sidecar token, DOM-sink discipline) carry the entire load.
- **Remediation**: Long-term, route renderer fetches through the sidecar (which already proxies most feeds) and shrink `connect-src` to `'self'` + the sidecar + the handful of direct-from-renderer hosts (map tiles, telemetry). Track alongside the `unsafe-eval` removal blocker (Cesium strict-CSP build).

### M-4: LLM egress of watchlist terms, entities, and evidence lacks explicit user disclosure

- **Files**: [hypothesis-skeptic.ts:96-107](../src/services/hypothesis-skeptic.ts), [auto-brief.ts:42-55](../src/services/auto-brief.ts), [llm-adapter.ts:70-79](../src/services/llm-adapter.ts)
- **Severity**: Medium (privacy/disclosure, not a vulnerability)
- **What it is**: When the opt-in Skeptic or Auto-Brief features run with a cloud fallback, hypothesis summaries — watchlist terms, entity names (people, orgs, crypto addresses), regions, and up-to-8 evidence snippets — are sent to api.anthropic.com / api.groq.com / openrouter.ai. The local-first preference (Ollama/LM Studio) and the daily cloud budget reduce frequency but not content.
- **Why it matters**: A user tracking sensitive entities may not realize their curated watchlist and evidence graph leave the machine when the local model is unavailable. This is a trust/consent gap rather than an exploit.
- **Remediation**: At the moment Skeptic/Auto-Brief is enabled, show a one-time notice: "Hypothesis summaries and evidence may be sent to your configured cloud LLM provider when no local model is available." Offer a "local-only" toggle that hard-disables the cloud fallback.

### M-5: Vercel preview-origin regex drift between serverless routes and sidecar

- **Files**: `api/_api-key.js`, `api/youtube/embed.js` (pattern `/^https:\/\/crystalball-[a-z0-9-]+\.vercel\.app$/`) vs. sidecar enumerated allowlist at [local-api-server.mjs:1820-1849](../src-tauri/sidecar/local-api-server.mjs); tracked as SEC-004
- **Severity**: Medium
- **What it is**: The sidecar enumerates exact production hosts (fail-closed), but the Vercel serverless routes accept any `crystalball-*.vercel.app` origin. Anyone can deploy a Vercel project named `crystalball-anything` and match that regex.
- **Why it matters**: A lookalike deployment gains CORS access to whatever those serverless routes expose (API-key brokering, embed endpoints).
- **Remediation**: Anchor the patterns to the owning account/team scope (e.g., `crystalball-<branch>-bradleybond512.vercel.app`) or replace the regex with the same enumerated-host module the sidecar uses, imported from one shared file so the two cannot drift. Add tests for rejected lookalikes.

### M-6: `ALLOW_UNAUTHENTICATED_RELAY` bypass flag exists (non-production only)

- **File**: [ais-relay.cjs:65,85-91](../scripts/ais-relay.cjs)
- **Severity**: Medium (mitigated by the `!IS_PRODUCTION_RELAY` gate)
- **What it is**: The relay refuses to start in production without `RELAY_SHARED_SECRET`, but a `ALLOW_UNAUTHENTICATED_RELAY=true` env flag disables all auth in non-production. (Note: the older `RELAY_ALLOW_ANON` flag from prior audits **no longer exists anywhere in the repo** — this is its successor.)
- **Why it matters**: Auth-bypass flags are deployment footguns: a staging relay left reachable with the flag set serves anyone. The loud startup warning helps but doesn't prevent it.
- **Remediation**: Either remove the flag (devs can run a local relay with a throwaway secret) or make it refuse to bind to non-loopback interfaces while set, and surface it in `/health` so monitoring flags it.

### M-7: Documented prior-scan findings remain open (SEC-001…SEC-010)

- **File**: `docs/SECURITY_SCAN_FINDINGS_FOR_CLAUDE.md`
- **Severity**: Medium (tracking)
- **What it is**: None of the ten findings from the April 2026 scan are marked complete. This audit independently re-confirmed several (SEC-004 → M-5 here, SEC-005 → relates to H-1/H-2, SEC-006 → M-1) and found the codebase already better than documented in one case (the sebuf wildcard-CORS fallback from round 2 is now fail-closed at `api/[domain]/v1/[rpc].ts:167-185` — verified fixed). One caution: SEC-001 references a broad `get_all_secrets` IPC — **no such command exists** in the current 33-command surface; the real (lesser) exposure is that a trusted-window renderer can iterate `get_secret` across all 73 keys.
- **Remediation**: Sweep the findings doc: mark fixed items fixed (sebuf CORS), correct stale ones (SEC-001), and schedule the rest. Stale security docs cause both duplicate work and false confidence.

---

## Low / Informational

### Low

**L-1: `list_supported_secret_keys` lacks the trusted-window gate** — [main.rs:716](../src-tauri/src/main.rs). Every other secret op calls `require_trusted_window()`; this one doesn't, so any window (including the external-origin `youtube-login` webview) can enumerate the 73 key names. Names are metadata, not secrets, but the gate should be uniform. *Fix*: add `require_trusted_window(webview.label())?`.

**L-2: Trusted renderer can iterate all 73 secrets via `get_secret`** — [main.rs:723](../src-tauri/src/main.rs). There is no bulk-export command, but nothing rate-limits or scopes per-key reads, so renderer compromise (e.g., via the `unsafe-eval` CSP exception) means full key exfiltration. *Fix*: consider per-feature key scoping or moving outbound API calls (and the keys) entirely into the sidecar so the renderer never sees raw values; at minimum, log/trace unusual bulk read patterns.

**L-3: Cache keys accepted without character validation** — [main.rs:837-860](../src-tauri/src/main.rs). `write_cache_entry` bounds key length (256) and value (5 MB, valid JSON) but allows any UTF-8 in the key, including control characters. Harmless today (in-memory HashMap), risky if keys ever feed paths/URLs/SQL. *Fix*: restrict to `[A-Za-z0-9_.:-]`.

**L-4: Polymarket path check uses `starts_with` instead of exact segments** — [main.rs:1564-1601](../src-tauri/src/main.rs). `events-anything/nested` passes the `["events","markets","tags"]` allowlist. Host is hardcoded so impact is confined to unexpected gamma-api endpoints. *Fix*: split on `/`, exact-match the first segment, charset-validate the rest.

**L-5: SMS command webhook is unauthenticated by design** — [local-api-server.mjs:5058-5075](../src-tauri/sidecar/local-api-server.mjs). `/api/sms/command` relies solely on the phone-number allowlist in `sms-config.json` (Twilio can't carry the bearer token). Caller-ID is spoofable metadata. *Fix*: add Twilio request-signature validation (`X-Twilio-Signature` HMAC) in addition to the allowlist.

**L-6: `env-local-loader` performs no permission check before loading plaintext keys** — [env-local-loader.mjs:58-75](../src-tauri/sidecar/env-local-loader.mjs). Companion to H-3: even after the chmod, nothing prevents regression. *Fix*: per H-3 remediation #2.

**L-7: Event store DB and logs are world-readable** — `~/Library/Logs/com.bradleybond.crystalball/`: `events.db`, `events.db-wal`, `desktop.log*`, `local-api.log`, `sidecar.log`, `sidecar.health.json` are all mode `0644` (verified). The event store now persists the user's observation/situation history — watchlist hits, saved-place-adjacent alerts — readable by any local account. (`sidecar.token` is correctly `0600`.) *Fix*: create the DB and log files with `0600` (set `umask` in the sidecar or chmod after open); the log directory itself is also `drwxr-xr-x`.

**L-8: Distinct error strings let callers distinguish unsupported vs. absent secret keys** — [main.rs:723-783](../src-tauri/src/main.rs). Minor information-shaping concern, fully gated behind the trusted-window check; included for completeness. *Fix (optional)*: collapse to one generic error.

### Informational

**I-1: `unsafe-eval` + `wasm-unsafe-eval` remain in `script-src`** — [tauri.conf.json:36](../src-tauri/tauri.conf.json). Verified still required: Cesium is a live dependency (God's Eye globe) and needs eval for shader compilation. Documented in `docs/CSP_AUDIT.md` with removal criteria. No `unsafe-inline` on script-src (web build uses a single pinned hash) — good.

**I-2: Cesium version drift between package.json (`^1.142.0`) and CSP_AUDIT.md / installed (1.140.0)**. The CSP exception's justification references a version that no longer matches the manifest. Reconcile and re-test whether 1.142 still needs eval.

**I-3: Desktop CSP lacks `frame-ancestors`** — [tauri.conf.json:36](../src-tauri/tauri.conf.json). Negligible in a webview context; add `frame-ancestors 'none'` for completeness.

**I-4: openssl backup engine briefly exposes the passphrase in `ps` during HMAC** — [backup-keys.sh:158-169](../scripts/backup-keys.sh). Encryption itself uses `-pass stdin`; only the HMAC step passes `-hmac "$PW1"` via argv, over already-encrypted data. Documented in-script as a known openssl limitation; age/gpg engines avoid it entirely. Backup outputs verified `0600`, temp files in `mktemp -t` dirs with EXIT traps, integrity verified before any restore write.

**I-5: Web analytics script origins in web CSP** — [index.html:7](../index.html) allows PostHog/Cloudflare Insights/vercel.live script sources (web build only; desktop CSP excludes them). Analytics payloads were verified to carry only `has_<key>` presence flags and platform metadata — never key values. PostHog is suppressed in Ghost Mode.

**I-6: 54 MB git branch bundle stored in iCloud** — `~/Library/Mobile Documents/.../CrystalBall/cb-branch-backup-20260531-122327.bundle` sits alongside the encrypted key backups. It contains repo history (no secrets found in-tree, and the secret-scan guardrail enforces that), but be aware full source now lives in iCloud sync scope.

**I-7: Verified-correct behaviors worth keeping** (regression watchlist):

- Sidecar token: CSPRNG 32-byte, timing-safe compare ([local-api-server.mjs:170-177](../src-tauri/sidecar/local-api-server.mjs)), global auth gate at line 5108 with only seven deliberate pre-auth routes (health, YouTube embed, Patreon OAuth pair, SMS command/status; `/api/sms/config` IS gated).
- New `/api/events/query|count|health|prune` all behind auth; `prune` validates `months` as finite non-negative; `limit` clamped 1–5000.
- Event store SQL fully parameterized incl. dynamic `IN (...)` placeholder construction and `ESCAPE '\\'` LIKE handling with regression tests ([event-store.mjs:34-36,86-89,138-159,177](../src-tauri/sidecar/event-store.mjs)); append-only enforced via plain `INSERT` (duplicate id fails closed).
- CORS fail-closed: unknown origins get `tauri://localhost`, prod hosts enumerated, no `CORS_ALLOW_ALL` override; sebuf RPC fallback now returns 403 (round-2 finding fixed).
- SSRF: `isSafeUrl()` (local-api-server.mjs:1197-1261) blocks loopback/private/link-local, resolves DNS A/AAAA and re-validates (anti-rebinding), checks every redirect hop; remaining proxies are host-pinned.
- XSS: zero `eval` calls and zero dynamic Function constructors in `src/`; `escapeHtml` correct; `safeHtml`/`sanitizeHtml` are allowlist-based (DOMPurify for markdown); EventStorePanel, CommandCenterPanel, ShortageRadarPanel, NotificationDigestPanel, NewsPanel, OfflineMapPanel, IntelligenceBriefingPanel all verified to escape every dynamic interpolation.
- Updater: GitHub host allowlist + mandatory SHA-256; devtools excluded from default cargo features; `open_url` is HTTPS-only with anti-loopback; AppleScript args sanitized + rate-limited in notification/iMessage/speech commands; Sentry `sendDefaultPii: false`; cb-control token `0600` with timing-safe validation.

---

## Dependency Vulnerabilities

**npm — 0 advisories.** `npm audit` itself failed locally (`EBADF` socket error in npm 11.16.0 / Node 26.3.0 against the bulk advisory endpoint — an npm tooling bug, not a network block; the endpoint answered curl with 200). As a workaround the full installed tree (1,048 packages from `package-lock.json`) was submitted directly to `https://registry.npmjs.org/-/npm/v1/security/advisories/bulk` and matched against installed versions with semver: **zero advisories affect any installed version.** Recommend re-running `npm audit` after the next npm upgrade to restore the standard tooling path.

**cargo audit — 0 vulnerabilities.** RustSec advisory DB (1,125 advisories) scanned against `src-tauri/Cargo.lock` (608 crates): clean, exit 0.

No high or critical CVEs in either ecosystem at audit time.

---

## Remediation Priority

1. **Today (minutes each)**: `chmod 600 .env.local` (H-3); switch the five `http://` URLs to `https://` where supported (H-1, H-2 — MediaStack/AviationStack/GeoNames; pick an HTTPS replacement for ip-api.com).
2. **This week**: permission check in `env-local-loader` (L-6); CI grep banning non-localhost `http://` in the sidecar; chmod 600 on `events.db`/logs at creation (L-7); unify the Vercel preview-origin pattern with the sidecar allowlist (M-5); trusted-window gate on `list_supported_secret_keys` (L-1).
3. **Next pass**: LLM-egress disclosure + local-only toggle (M-4); in-memory token handoff for MCP (M-1); web CSP frame-src port pinning (M-2); Twilio signature validation on the SMS webhook (L-5); sweep `SECURITY_SCAN_FINDINGS_FOR_CLAUDE.md` statuses (M-7).
4. **Strategic**: shrink `connect-src` by routing renderer fetches through the sidecar (M-3); revisit `unsafe-eval` whenever Cesium ships a strict-CSP build (I-1/I-2).

---

## Appendix A — Tauri IPC Command Inventory (33 commands)

| Command | Location | Trust gate | Input validation |
|---|---|---|---|
| `get_local_api_token` | main.rs:588 | ✓ trusted | state read |
| `set_always_on` / `get_always_on` | main.rs:674/687 | — | bool |
| `get_desktop_runtime_info` | main.rs:692 | ✓ | state read |
| `get_local_api_port` | main.rs:707 | ✓ | state read |
| `list_supported_secret_keys` | main.rs:716 | **✗ (L-1)** | hardcoded list |
| `get_secret` / `set_secret` / `delete_secret` | main.rs:723/740/768 | ✓ + allowlist | 73-key SUPPORTED_SECRET_KEYS |
| `read_cache_entry` / `delete_cache_entry` | main.rs:814/820 | ✓ | key string (L-3) |
| `write_cache_entry` | main.rs:837 | ✓ | len ≤256 / ≤5 MB JSON (L-3) |
| `open_url` | main.rs:964 | ✓ | HTTPS-only, anti-loopback |
| `open_system_prefs_location` | main.rs:996 | — | hardcoded |
| `get_native_location` | main.rs:1005 | ✓ | CoreLocation |
| `open_logs_folder` / `open_sidecar_log_file` | main.rs:1090/1095 | ✓ | app-resolved paths |
| settings/live-channels window open/close | main.rs:1100-1126 | ✓ | URL parse |
| `send_notification` | main.rs:1151 | ✓ | truncate + AppleScript sanitize + rate limit |
| `send_imessage` | main.rs:1212 | ✓ | truncate + sanitize + rate limit |
| `speak_aloud` | main.rs:1276 | ✓ | truncate + sanitize + rate clamp |
| `install_update` | main.rs:1419 | ✓ | GitHub host allowlist + SHA-256 |
| `fetch_polymarket` | main.rs:1564 | ✓ | path allowlist (L-4) |
| `open_youtube_login` / `open_youtube_logout` | main.rs:1690/1695 | ✓ | isolated window, own capability |
| `set_dock_badge` / `set_menubar_status` / `update_mode_label` | main.rs:1711/1765/1838 | — | typed/pattern-matched |
| `log_frontend` | main.rs:2636 | — | truncate + sanitize |
| `copy_diagnostics` | main.rs:2657 | ✓ | internal reads |

Capabilities: `default.json` → `core:default`, `core:window:allow-start-dragging`, `biometry:default`, `clipboard-manager:allow-read-text` (main/settings/live-channels). `youtube-login.json` → `core:window:default` only. Narrowly scoped; clipboard read remains the broadest grant (see SEC-010 in the prior scan).

## Appendix B — Sidecar Pre-Auth Routes (everything else requires the bearer token)

| Route | Why pre-auth | Compensating control |
|---|---|---|
| `GET /api/service-status` | health probe | metadata only |
| `GET /api/youtube-embed` | iframe src can't carry headers | videoId format validation |
| `GET /api/patreon/authorize-url` | OAuth pre-auth | server-side URL build, single-use state |
| `GET /oauth/patreon/callback` | browser redirect | state-token validation |
| `POST /api/sms/command` | Twilio webhook | phone allowlist (L-5: add signature check) |
| `GET /api/sms/status` | gateway status | metadata only |

`/api/sms/config` is token-gated. Global gate at local-api-server.mjs:5108; binding is 127.0.0.1:46123.

## Appendix C — External Network Surface (summary)

~85 external HTTPS hosts across weather/climate (20), OSINT/threat-intel (33), transportation (16), finance (14), environmental (14), maps (8), LLM (3: anthropic, groq, openrouter), crypto (4), other (7). Key egress paths:

| Data | Destination | Basis |
|---|---|---|
| Saved-place lat/lon | NWS, Open-Meteo family, air-quality APIs | core feature, expected |
| Watchlist/entities/evidence | Anthropic/Groq/OpenRouter | opt-in features; disclosure gap (M-4) |
| Tickers/portfolio | FRED, Finnhub, Stooq | core feature, expected |
| User-queried IOCs (IPs, domains, hashes, emails) | VirusTotal, AbuseIPDB, HIBP, Censys, etc. | user-initiated lookups, inherent to OSINT |
| API-key presence flags only | PostHog | metadata; suppressed in Ghost Mode |

Plain-HTTP exceptions: the five endpoints in H-1/H-2 — everything else is HTTPS.
