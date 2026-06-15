# Crystal Ball — Security Fix Plan

**Date:** 2026-06-11  
**Source:** SECURITY_AUDIT_2026-06-11.md  
**Model:** Sonnet (`claude-sonnet-4-6`)  
**Instructions for Sonnet:** Work top-down. Each task is a single PR on a `claude/` branch. Do NOT commit directly to main. Do NOT use `git add -A` or `git add .` — stage specific files by name. Always include `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`. Always use `SKIP_STALE_CHECK=1 git push --force-with-lease origin <branch>` and arm auto-merge with `HOMEBREW_PREFIX=/opt/homebrew /opt/homebrew/bin/gh pr merge <N> --rebase --auto`.

---

## Tier 1 — Today (High severity, minutes each)

### T1-A: Switch all 5 plain-HTTP sidecar URLs to HTTPS

**Audit refs:** H-1, H-2  
**Files:** `src-tauri/sidecar/local-api-server.mjs`

**Exact changes:**

1. **Line 4335** — MediaStack key-validation probe:

   ```
   BEFORE: fetchWithTimeout(`http://api.mediastack.com/v1/news?access_key=...`)
   AFTER:  fetchWithTimeout(`https://api.mediastack.com/v1/news?access_key=...`)
   ```

2. **Line 4466** — AviationStack key-validation probe:

   ```
   BEFORE: fetchWithTimeout(`http://api.aviationstack.com/v1/flights?access_key=...`)
   AFTER:  fetchWithTimeout(`https://api.aviationstack.com/v1/flights?access_key=...`)
   ```

   Note: AviationStack's free tier may reject HTTPS. If it does (non-2xx or connection error), skip live validation and return `{ valid: true, note: 'live validation skipped — HTTPS not available on free tier' }` rather than sending the key over HTTP.

3. **Line 4541** — GeoNames key-validation probe:

   ```
   BEFORE: fetchWithTimeout(`http://api.geonames.org/searchJSON?...&username=...`)
   AFTER:  fetchWithTimeout(`https://secure.geonames.org/searchJSON?...&username=...`)
   ```

   (GeoNames HTTPS endpoint is `secure.geonames.org`)

4. **Line 10167** — MediaStack production news fetch:

   ```
   BEFORE: fetchWithTimeout(`http://api.mediastack.com/v1/news?${params}`, ...)
   AFTER:  fetchWithTimeout(`https://api.mediastack.com/v1/news?${params}`, ...)
   ```

5. **Line 1124** — ip-api.com batch geolocation:

   ```
   BEFORE: fetchWithTimeout('http://ip-api.com/batch?fields=...', { method: 'POST', ... })
   AFTER:  fetchWithTimeout('https://ipquery.io/batch', { method: 'POST', body: JSON.stringify(batch.map(ip => ({ ip }))), ... })
            — OR substitute ipinfo.io/batch if it's already integrated elsewhere in the sidecar.
   ```

   Check what HTTPS IP-geolocation providers are already present in the sidecar. Prefer one already in use. If none, use `https://ip-api.com/batch` (ip-api.com's paid HTTPS endpoint) OR `https://ipquery.io` (free, HTTPS-only). Maintain the same batch-response field shape that callers expect (`query`, `country`, `countryCode`, `lat`, `lon`).

**Test:** After changes, `grep -n "http://" src-tauri/sidecar/local-api-server.mjs | grep -v "127.0.0.1\|localhost\|#"` should return zero matches for non-local URLs.

**PR title:** `fix: switch all sidecar plain-HTTP external URLs to HTTPS (H-1, H-2)`

---

### T1-B: Fix .env.local file permissions + add loader permission check

**Audit refs:** H-3, L-6  
**Files:** `src-tauri/sidecar/env-local-loader.mjs`

**Changes:**

1. Add permission check at the top of the load function in `env-local-loader.mjs` (around line 58–75). After `fs.statSync(filePath)`, add:

   ```javascript
   const mode = stat.mode & 0o077; // world/group bits
   if (mode !== 0) {
     console.warn(
       `[env-local-loader] WARNING: ${filePath} is readable by other users (mode ${(stat.mode & 0o777).toString(8)}). ` +
       `Run \`chmod 600 ${filePath}\` to fix. Refusing to load plaintext credentials from an insecure file.`
     );
     return {};
   }
   ```

   This means `loadEnvFile()` refuses to parse the file if group or world bits are set, preventing silent regression after the initial chmod.

2. Also add a one-line console notice whenever the fallback path is actually used:

   ```javascript
   console.info('[env-local-loader] INFO: Loading API keys from plaintext .env.local fallback (keychain unavailable).');
   ```

3. In the PR description, include a reminder: "Run `chmod 600 .env.local` on the deployed file before next launch."

**Note:** Do NOT commit `.env.local` itself — it must stay in `.gitignore`.

**PR title:** `fix: refuse to load .env.local when world-readable; add mode 0600 enforcement (H-3, L-6)`

---

## Tier 2 — This Week

### T2-A: Add CI grep blocking non-localhost http:// in sidecar

**Audit ref:** H-1, H-2 (root-cause guardrail)  
**Files:** `.github/workflows/` (or whichever CI file runs checks — look for an existing lint/check workflow)

Add a step to the CI workflow that fails if any `http://` URL pointing to a non-local host appears in `src-tauri/sidecar/`:

```yaml
- name: No plain-HTTP external URLs in sidecar
  run: |
    if grep -rn "http://" src-tauri/sidecar/ \
        | grep -v "127\.0\.0\.1\|localhost\|#\|test\|spec\|\.test\." \
        | grep -qv "^Binary"; then
      echo "ERROR: Plain HTTP external URL found in sidecar. Use HTTPS." >&2
      grep -rn "http://" src-tauri/sidecar/ | grep -v "127\.0\.0\.1\|localhost\|#"
      exit 1
    fi
    echo "OK: No plain-HTTP external URLs in sidecar."
```

**PR title:** `ci: add sidecar plain-HTTP URL guardrail check (H-1/H-2 root cause)`

---

### T2-B: Set events.db and log files to mode 0600 at creation

**Audit ref:** L-7  
**Files:** `src-tauri/sidecar/event-store.mjs`, `src-tauri/sidecar/local-api-server.mjs`

The event store DB (`events.db`, `events.db-wal`) and log files (`local-api.log`, `sidecar.log`, `sidecar.health.json`) are created with default umask (0644). Fix:

1. In `event-store.mjs`, after the `new DatabaseSync(dbPath)` call opens/creates the database file, add:

   ```javascript
   import { chmodSync, existsSync } from 'node:fs';
   // After DatabaseSync opens/creates the file:
   try { chmodSync(dbPath, 0o600); } catch {}
   // Also chmod the WAL file if it exists:
   const walPath = dbPath + '-wal';
   try { if (existsSync(walPath)) chmodSync(walPath, 0o600); } catch {}
   ```

2. In `local-api-server.mjs`, find where log files are opened (`local-api.log`, `sidecar.log`, `sidecar.health.json` — likely `fs.createWriteStream` or `fs.openSync`). After opening each, add `fs.chmodSync(path, 0o600)`.

3. Verify: in the test suite or manually, confirm the created files are 0600.

**PR title:** `fix: create events.db and log files with mode 0600 (L-7)`

---

### T2-C: Add trusted-window gate to list_supported_secret_keys

**Audit ref:** L-1  
**Files:** `src-tauri/src/main.rs` (around line 716)

Find the `list_supported_secret_keys` command. It currently lacks the `require_trusted_window()` call. Add it to match the pattern of every other secret operation:

```rust
#[tauri::command]
async fn list_supported_secret_keys(webview: tauri::WebviewWindow) -> Result<Vec<String>, String> {
    require_trusted_window(webview.label())?;  // ADD THIS LINE
    Ok(SUPPORTED_SECRET_KEYS.iter().map(|k| k.to_string()).collect())
}
```

**PR title:** `fix: add trusted-window gate to list_supported_secret_keys IPC command (L-1)`

---

### T2-D: Unify Vercel preview-origin regex with sidecar enumerated allowlist

**Audit ref:** M-5  
**Files:** `api/_api-key.js`, `api/youtube/embed.js`

The Vercel serverless routes accept any `crystalball-[a-z0-9-]+\.vercel\.app` origin — anyone can deploy a Vercel project named `crystalball-anything` and match. Fix by anchoring the pattern to the owning account:

```javascript
// BEFORE:
const PREVIEW_ORIGIN_RE = /^https:\/\/crystalball-[a-z0-9-]+\.vercel\.app$/;

// AFTER — anchor to the deploy account slug:
const PREVIEW_ORIGIN_RE = /^https:\/\/crystalball-[a-z0-9-]+-bradleybond512\.vercel\.app$/;
```

Apply the same pattern fix to both files. Also add a test case in any existing serverless route test that verifies a lookalike (`crystalball-evil.vercel.app`) is rejected.

**PR title:** `fix: anchor Vercel preview-origin regex to account scope to prevent lookalike CORS (M-5)`

---

## Tier 3 — Next Pass

### T3-A: LLM cloud-egress disclosure and local-only toggle

**Audit ref:** M-4  
**Files:** `src/services/hypothesis-skeptic.ts`, `src/services/auto-brief.ts`, relevant settings UI component

When the Skeptic or Auto-Brief feature is first enabled, show a one-time disclosure notice. The notice should explain that hypothesis summaries and evidence snippets may be sent to the user's configured cloud LLM provider when no local model is available.

1. Add a `llm_egress_disclosed` boolean key to the app's settings store (or use the existing settings mechanism).
2. When Skeptic or Auto-Brief is enabled and `llm_egress_disclosed` is false, show a modal/banner: *"When no local model is available, hypothesis summaries and evidence may be sent to your configured cloud LLM provider (Anthropic, Groq, or OpenRouter). Enable 'Local model only' to disable this fallback."*
3. Add a `localModelOnly` setting that, when true, skips the cloud fallback in `llm-adapter.ts` (return an error/empty result instead of calling the cloud API).
4. Gate the cloud fallback path in `llm-adapter.ts` with `if (settings.localModelOnly) return { error: 'local-only mode' }`.

**PR title:** `feat: add LLM cloud-egress disclosure modal and local-model-only toggle (M-4)`

---

### T3-B: Web CSP frame-src — replace wildcard localhost port with explicit list

**Audit ref:** M-2  
**File:** `index.html` (line 7)

Replace:

```
frame-src http://127.0.0.1:*
```

With:

```
frame-src http://127.0.0.1:3000 http://127.0.0.1:1420 http://127.0.0.1:5173 http://127.0.0.1:46123
```

This matches the exact port list used in the desktop `tauri.conf.json` CSP and the sidecar CORS allowlist.

**PR title:** `fix: pin web CSP frame-src to explicit dev-port list instead of wildcard (M-2)`

---

### T3-C: Add Twilio request-signature validation to SMS webhook

**Audit ref:** L-5  
**Files:** `src-tauri/sidecar/local-api-server.mjs` (around line 5058–5075)

The `/api/sms/command` route validates the sender's phone number from the allowlist but caller-ID is spoofable. Add Twilio's HMAC-SHA1 request signature validation:

```javascript
import { createHmac } from 'node:crypto';

function validateTwilioSignature(authToken, url, params, signature) {
  // Twilio signature algorithm: HMAC-SHA1 of (url + sorted params)
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys.reduce((acc, k) => acc + k + params[k], '');
  const expected = createHmac('sha1', authToken)
    .update(url + paramString)
    .digest('base64');
  // Timing-safe compare
  const sigBuf = Buffer.from(signature || '', 'base64');
  const expBuf = Buffer.from(expected, 'base64');
  if (sigBuf.length !== expBuf.length) return false;
  return timingSafeEqual(sigBuf, expBuf);
}
```

At the route handler, get `X-Twilio-Signature` header and `TWILIO_AUTH_TOKEN` from config, validate before processing. If validation fails, return 403. If `TWILIO_AUTH_TOKEN` is not configured, log a warning and fall through to phone-number-only validation (maintain backward compat).

**PR title:** `feat: add Twilio request-signature HMAC validation to SMS webhook (L-5)`

---

### T3-D: Sweep and update SECURITY_SCAN_FINDINGS_FOR_CLAUDE.md

**Audit ref:** M-7  
**File:** `docs/SECURITY_SCAN_FINDINGS_FOR_CLAUDE.md`

Update the findings doc based on what the 2026-06-11 audit confirmed:

- Mark **SEC-004** (sebuf wildcard-CORS) as ✅ FIXED — the fallback at `api/[domain]/v1/[rpc].ts:167-185` now returns 403.
- Correct **SEC-001** — there is no `get_all_secrets` command in the current codebase (33 commands enumerated). The actual exposure is that a trusted-window renderer can call `get_secret` per key across all 73 keys. Update accordingly.
- Mark **SEC-005** as addressed by T1-A in this plan (HTTP→HTTPS).
- Mark **SEC-006** as tracked (M-1 — sidecar token on disk; mitigation: 0600, per-session rotation; ideal fix is in-memory handoff).
- For remaining open items, add target-sprint or backlog labels so the doc reflects actual status.

**PR title:** `docs: update SECURITY_SCAN_FINDINGS_FOR_CLAUDE.md with 2026-06-11 audit outcomes (M-7)`

---

## Tier 4 — Strategic (Backlog)

These require larger design work. Create GitHub issues for tracking, do not implement in the current sprint.

### T4-A: In-memory token handoff for MCP server (M-1)

Instead of writing `sidecar.token` to disk, pass the token to the MCP server process via env var or stdin at spawn time. Remove the file-based path once the MCP server is updated to accept the env var. This eliminates the at-rest copy entirely.

### T4-B: Shrink connect-src by routing renderer fetches through sidecar (M-3)

Long-term: route most renderer `fetch()` calls through the sidecar so the renderer only needs `connect-src 'self' http://127.0.0.1:46123` plus the handful of direct-renderer hosts (Cesium tiles, PostHog). Prerequisite for removing `https:` blanket scope.

### T4-C: Remove unsafe-eval when Cesium ships strict-CSP support (I-1/I-2)

Track Cesium's strict-CSP build progress. When available, test `wasm-unsafe-eval`-only and remove the `unsafe-eval` exception. Also reconcile the version in `CSP_AUDIT.md` with the actual installed Cesium version.

---

## Execution Order for Sonnet

Run these in sequence (each is a separate PR):

1. T1-A — HTTP→HTTPS (5 URLs) ← **start here, highest risk**
2. T1-B — .env.local permission check
3. T2-B — events.db / logs chmod 600
4. T2-C — list_supported_secret_keys gate
5. T2-A — CI grep guardrail
6. T2-D — Vercel origin regex
7. T3-A — LLM egress disclosure
8. T3-B — CSP frame-src fix
9. T3-C — Twilio signature validation
10. T3-D — Doc sweep

Do not batch T1-A and T1-B into one PR — keep each fix independently reviewable.

---

## Branch / commit conventions (reminder)

- Branch: `claude/sec-<short-slug>` (e.g., `claude/sec-https-urls`, `claude/sec-env-loader`)
- Push: `SKIP_STALE_CHECK=1 git push --force-with-lease origin <branch>`
- Auto-merge: `HOMEBREW_PREFIX=/opt/homebrew /opt/homebrew/bin/gh pr merge <N> --rebase --auto`
- Never commit to `main` directly
- Always include `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` in commit message
- Use `--no-verify` on commits
