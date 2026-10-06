# Security Scan Round 4 For Codex

Checked: September 28, 2026, by Claude (read-only review, no code changed).
Audited commit: **`macos/main` @ `a255546ee`** ("agentic: record claude review
verdict for 5de6e113"), which is 27 commits after the Round 3 baseline
(`b7a82262a`). All line numbers are pinned to `a255546ee`; locate by symbol
if they drift.

**Revision 2 (same day):** after the first pass, two more scan passes ran:

- **Scan A:** CI, auto-merge, and the main-sync auto-install supply chain.
- **Scan B:** the sidecar's pre-auth surface, plus the boundary between the
  Crystal Ball MCP server and coding agents.

They added R4-SEC-002 through R4-SEC-004 and R4-LOW-002 through R4-LOW-004.
They also corrected R4-SEC-001's design: the renderer legitimately needs a
few map/tile keys.

**Revision 3 (September 29):** two more passes on the same commit:

- **Scan C:** the renderer's message, import and deserialization surface.
- **Scan D:** the correctness of the safety-alert delivery pipeline.

They added R4-BUG-002 (High: critical notifications silently dropped),
R4-SEC-005, R4-BUG-003 and R4-LOW-005, and re-ordered the queue so
R4-BUG-002 is first.

**Revision 4 (September 29, final pre-handoff):** three more passes on the
same commit, each aimed at areas the earlier passes had not touched:

- **Scan E:** the public Vercel/edge API surface and cost-bearing routes.
- **Scan F:** storage, resilience, and durability of data at rest.
- **Scan G:** native robustness, sidecar supervision, and local port trust.

They added R4-BUG-004 (High: a crashed sidecar is never restarted, and
traffic, including location, fails over to the cloud), R4-SEC-006,
R4-SEC-007 and R4-LOW-006 through R4-LOW-008.

**Revision 5 (September 29):** incorporates Bradley's decisions and the
environment facts in Part 1b. Adds:

- R4-BUG-006: the key backup can't see the vault;
- R4-BUG-005: daily quota exhaustion, plus a researched API budget table;
- R4-SEC-008: the trusted domain is for sale;
- R4-SEC-009: the security checks aren't required.

This round does two things:

1. **Independently verifies the Round 3 work that landed**, so "fixed" means
   verified by a second agent, not only by the implementer.
2. **Adds the highest-value issues still open.** Now that the updater and
   iMessage escalation paths are closed, the biggest remaining risks fall
   into three groups:
   - **Safety-alert delivery** (fix first):
     - critical notifications silently dropped by the native limiter (R4-BUG-002);
     - a crashed sidecar that is never restarted, which blacks out IPAWS and
       other feeds for the session (R4-BUG-004).
   - **Secrets** sitting in renderer memory (R4-SEC-001, paired with the
     still-open R3-SEC-004 CSP).
   - **The auto-install supply chain**, which runs npm install scripts from
     freshly bumped dependencies on Bradley's Mac with no human in the loop
     (R4-SEC-002).

Round 3 remains the detailed spec for its open items:
`docs/SECURITY_SCAN_ROUND_3_FOR_CODEX.md`. This doc does not repeat them. It
re-orders them into one queue with the new findings.

**Status legend:** 🔴 Open · 🟡 In Progress · ✅ Fixed · ✅✔ Fixed and cross-verified.

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| R4-BUG-002 | High | Native notification limiter silently drops critical alerts and reports success | 🟡 PR #1757 |
| R4-BUG-004 | High | Crashed sidecar never restarted; requests (incl. location) silently fail over to the cloud | 🟡 PR #1758, #1759 |
| R4-BUG-006 | High | Key backup/restore scripts can't see the consolidated `secrets-vault` item | 🟡 PR #1763 |
| R4-BUG-005 | Medium-High | GreyNoise, AbuseIPDB, OpenSky, NewsAPI, PurpleAir quotas exhausted daily or weekly | 🟡 PR #1761 (step 1), #1770 (step 2) |
| R4-SEC-001 | High | Main window holds sidecar-only secret values in renderer memory | 🟡 PR #1768 |
| R4-SEC-002 | High | Main-sync auto-install runs npm lifecycle scripts from unreviewed, freshly published dependency versions | 🟡 PR #1764 (steps 1-2), #1772 (steps 3-5); step 6 optional |
| R4-SEC-003 | Medium | Main-sync check gate passes vacuously on an empty required-check list; check-runs not paginated | 🟡 PR #1765 |
| R4-SEC-004 | Medium | MCP server feeds raw, attacker-influenced feed text to coding agents that can run commands and write app state | 🟡 PR #1773 |
| R4-BUG-001 | Medium | Upgrade silently pauses previously-enabled iMessage alerts (incl. EEW) | 🟡 PR #1766 |
| R4-SEC-005 | Medium | Resource inventory JSON import is a stored-XSS path into the main window | 🟡 PR #1771 |
| R4-SEC-007 | Medium (latent: no API deployed) | Public LLM endpoint callable without a key via spoofed browser headers; cache trivially bypassed | 🟡 PR #1778 |
| R4-SEC-008 | Medium | App still trusts and links to `crystalball.app`, a domain Bradley doesn't own (for sale) | 🟡 PR #1769 |
| R4-SEC-009 | Medium | Security checks (Semgrep, cargo-deny, …) run but are not required for merge or auto-install | 🟡 PR #1765 (local gate); GitHub settings deferred by Bradley |
| R4-SEC-006 | Low-Medium | Renderer sends the bearer token to an unconfirmed default port | 🟡 PR #1768 |
| R4-BUG-003 | Low-Medium | Master mute silences critical alerts; two quiet-hours implementations disagree | 🟡 PR #1767 |
| R4-LOW-001 | Low | Analytics consent auto-granted for pre-existing installs | 🟡 PR #1780 |
| R4-LOW-002 | Low | Actions expression injection in `auto-merge-agent-branches.yml` | 🟡 PR #1781 |
| R4-LOW-003 | Low | `.github/mcp.json` runs unpinned `npx -y` / `uvx` / container images | 🟡 PR #1781 |
| R4-LOW-004 | Low | Patreon OAuth callback embeds JSON in an inline `<script>` without escaping `<` | 🟡 PR #1779 |
| R4-LOW-005 | Low | Unescaped error text in S2 Underground panel | 🟡 PR #1771 |
| R4-LOW-006 | Low | Ungated quota-bearing feed endpoints accept caller params (NewsAPI drain, Mediastack cache poisoning) | 🟡 PR #1778 |
| R4-LOW-007 | Low | Sidecar console log only rotates at spawn | 🟡 PR #1782 |
| R4-LOW-008 | Low | Calibration evidence capped and renderer-only | 🟡 PR #1777 |

---

## Part 1 — Verification Of Landed Round 3 Work

| ID | Codex status | Claude verification @ `a255546ee` | Notes |
|----|--------------|-----------------------------------|-------|
| R3-SEC-001 updater | ✅ | ✅✔ **Verified** | `stage_update(url, hash)` is gone; the only commands are `stage_latest_update()` (no args) and `apply_staged_update()`. Rust resolves the release from the pinned repo API (`updater_policy.rs:3-8`). The URL must exactly equal the canonical `…/crystal-ball/releases/download/vX.Y.Z/<exact name>` (`:137-157`). Redirects go only to `release-assets.githubusercontent.com/github-production-release-asset/1171076424/…` (`:158-190`, custom reqwest policy at `main.rs:2054-2064`). Manifest size and hash are bound (`:231-258`). Bodies are length-capped while streaming. The signer pin is **mandatory**: Apple team, or the installed app's own certificate-fingerprint designated requirement. Ad-hoc installs (cdhash-only DR) fail `SignerRequirement::local` and fall back to the browser (`:260-333`). Boot/apply re-validate with the same non-optional pin (`validate_staged_bundle`, `main.rs:2369-2380`), so any bundle staged by the old vulnerable path is also rejected. |
| R3-SEC-002 iMessage | ✅ | ✅✔ **Verified** (see R4-BUG-001 for a UX/safety regression) | `send_imessage(body)` has no recipient. The config lives in a Rust-owned private `imessage.json`, with symlink/size/owner checks and file locks. Enabling or changing the recipient requires a native `display dialog` with default = Cancel and a 60 s give-up that counts as Cancel. Recipient and body reach osascript as **argv**, never interpolated (`imessage.rs:437-490`). A 30 s prompt rate limit and a stale-consent generation check are present. |
| R3-BUG-001 slice A | 🟡 | ✅✔ **Slice A verified** | `get_secret`, `set_secret`, `delete_secret`, the cache commands and `save_brief` are now `async` + `spawn_blocking`. The watchdog reads an event-owned focus atomic (`watchdog.rs`) instead of calling `is_focused()` from a background thread. Slice B is still open: `set_secret`/`delete_secret` still sleep-poll `wait_until_secrets_loaded` and hold the `secrets` mutex across the untimed `save_vault` Keychain write. That now blocks a worker thread instead of the UI, but it still serializes every secret read behind a hung Keychain prompt. |

Confirmed **still open**, with unchanged behavior at `a255546ee`:

| ID | Still-present evidence |
|----|------------------------|
| R3-SEC-003 shadow vault | `vault_shadow_key` `main.rs:759`, `write_vault_shadow` `:811`, `read_vault_shadow` `:867`, Keychain-`Err` fallback `:393` |
| R3-SEC-004 CSP | `tauri.conf.json` `script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'`, `img-src … https:`; `index.html` meta CSP same |
| R3-SEC-005 node fallback | `resolve_node_binary` `main.rs:3540`, `PATH` walk `:3581` |
| R3-BUG-002 datacenter posture | `src/app/data-loader.ts:1861-1875` (throwing `fetchUgcZonesForPoint` at `:1865` inside the posture `try`; outer catch skips the tick) |
| R3-SEC-006 / 007 | `local-api-server.mjs` unchanged since Round 3 |
| R3-SEC-008 | `Entitlements.plist:9` `allow-unsigned-executable-memory` |
| R3-SEC-009 | `MapPopup.ts` / `CountryIntelModal.ts` raw numeric interpolation unchanged |

---

## Part 1b — Bradley's Decisions And Verified Environment Facts (September 29)

**Decisions** (these override the options offered in the findings below):

- **R4-BUG-003:** life-safety `critical` notifications **bypass master mute**.
  Mute stays a user control for everything else; keep a persistent "Muted"
  indicator.
- **R4-BUG-004:** desktop **keeps cloud fallback** (on by default). The
  supervisor-restart half of the fix is unchanged. Adjust the privacy half:
  - fall back only on connection failure or 5xx (never on 4xx);
  - coarsen any `lat`/`lon` sent to the cloud to 2 decimal places (about 1 km);
  - never send saved-place names or watchlist terms.

  **Note:** fallback is currently inert. `getRemoteApiBaseUrl()` resolves to
  `''` because `VITE_WS_API_URL` is unset in local and Pages builds, and there
  is no cloud API deployment to fall back to (next list).

**Environment facts** (verified September 29, read-only):

- **No cloud API is deployed.**
  - `crystal-ball-bradleybond512.vercel.app` → `DEPLOYMENT_NOT_FOUND`.
  - The web app is served statically from GitHub Pages
    (`bradleybond512.github.io/crystal-ball`, `pages.yml`), which cannot run `api/`.
  - R4-SEC-007 and R4-LOW-006 are therefore **latent**: fix them before any
    API deployment, not urgently.
- **`crystalball.app` is not Bradley's domain.** It 302-redirects to a
  domain-sale listing (`fortune.domains/name/Crystalball.app`), and
  `api.crystalball.app` does not resolve. See R4-SEC-008.
- **`main` branch protection** (GitHub API):
  - Required checks are `typecheck`, `secret-scan`, `actionlint`,
    `integrity-checks`, `release-doctor`, `cross-agent-review` and `targeted-tests`.
  - `enforce_admins` is on, linear history is on, and force-push is off.
  - **Code-owner review is off and required approvals are 0**, so
    `.github/CODEOWNERS` currently enforces nothing.
  - The **security checks are not required**: `npm-audit`, `cargo-audit`,
    `cargo-deny`, `sidecar-http-guardrail`, Semgrep, ESLint, `static-lint`
    and `smoke`. See R4-SEC-009.
  - No rulesets are defined.
- **Interim vault backup done (September 29):** Bradley ran the R4-BUG-006
  interim command. `~/Library/Mobile Documents/com~apple~CloudDocs/CrystalBall/vault-20260929.age`
  is 1,409 bytes with a valid `age-encryption.org/v1` header, which fits a
  populated vault (an empty read would be about 200 bytes). The Q16b
  prerequisite still needs the fixed script (Q5) and Bradley's go-ahead.
- **GitHub settings (R4-SEC-009 required checks): deferred by Bradley.**
  Codex should not wait on them. Q7 still pins the security checks locally
  in main-sync.
- **`npm run backup-keys` does exist** (`package.json:43`). "Missing script"
  means it ran outside `~/Developer/crystalball`. But see R4-BUG-006: even
  from the right folder, it cannot back up the current vault format.

---

## Copy/Paste Prompt For Codex

```text
Read AGENTS.md, the KEYCHAIN section of CLAUDE.md,
docs/SECURITY_SCAN_ROUND_3_FOR_CODEX.md and
docs/SECURITY_SCAN_ROUND_4_FOR_CODEX.md in full before touching code.

Work the "Unified Queue" in Round 4, one PR per row, in order. R4 items
are specified in Round 4; R3 items keep their Round 3 spec (acceptance
criteria + tests).
First re-verify that each finding still reproduces on current main:
line numbers are pinned to a255546ee, so locate by symbol. If a row
depends on one of Bradley's pending decisions (listed under the queue),
ask for it in the design stop rather than guessing. Every row except Q0 is High Assurance under AGENTS.md:
discovery + written design, then STOP for Bradley's approval before
production edits. Follow .agents/skills/crystal-ball-feature-workflow/SKILL.md.

Per PR: branch codex/sec-r4-<id> from "$REMOTE/main"; mutation proof for
every behavior change with real counts; update the status table of the
doc that owns the finding (R3 or R4) in the same PR; Claude cross-agent
review + SHA-pinned verdict; AGENTS.md completion report.

Hard stops: never run `security`, keyring Entry calls,
`npm run backup-keys`/`restore-keys`, or create/import certificates;
never weaken tests/CSP checks/secret scans to get green; escalate a
finding that survives two review/repair cycles.
```

---

## Part 2 — New Findings

### R4-SEC-001: The Main Window Holds Sidecar-Only Secret Values In Renderer Memory

Severity: **High** (largest remaining payoff for a renderer compromise).
Classification: High Assurance (secrets, IPC). Supersedes round-1 **SEC-001**
("renderer can read every secret key-by-key"), which was never fixed.

Location (`a255546ee`):

- `src/main.ts:276`: boot calls `loadDesktopSecretsWhenReady()`
- `src/services/runtime-config.ts:1332-1376` `loadDesktopSecrets`: iterates
  **every** supported key (`keychainService.listSupportedKeys()`), fetches
  each value via `get_secret`, and stores it in the module-global
  `runtimeConfig.secrets[key] = { value, source: 'vault' }`
- `src/services/keychain.ts:60-78`: a second in-memory cache of every value
- `src-tauri/src/main.rs:1032` `get_secret`: returns any supported key's
  plaintext to any trusted window
- `src/services/runtime-config.ts:1181` `pushSecretToSidecar`: the renderer
  relays values to the sidecar

Evidence: at boot, the `main` window copies all configured secrets (up to 77
keys) into two JS heap structures that live for the whole session. Nothing
in the main window needs most of them:

- Non-plaintext keys are shown only as `MASKED_SENTINEL` (`settings-main.ts:326-328`).
- `verifySecretWithApi` already validates through the sidecar on desktop
  (`runtime-config.ts:1282-1300`).
- Analytics only counts presence (`analytics.ts:406`).
- The sidecar already receives every secret via env from Rust at launch.
- The only readers of real values are Settings plumbing: `RuntimeConfigPanel.ts:220, 307, 315`,
  `settings-main.ts:301, 328`, `settings-manager.ts:26`, and the `KeyDashboard` /
  `SetupWizard` `getValue` callbacks. They need values only for keys in
  `PLAINTEXT_KEYS` (`settings-constants.ts:69`: URLs, usernames, model name)
  and presence for everything else.

Impact: one script execution in `main`, from any of the ~271 `.innerHTML`
sinks, a compromised dependency, or a future bug, can read every API key
straight from memory with no IPC call and no user-visible trace. It can
then exfiltrate them via the still-allowed `img-src https:` (R3-SEC-004).
The updater and iMessage fixes closed the *escalation* paths; this closes
the *theft* path.

Required design (bring a recommendation; Bradley approves):

Scan B established exactly which values the renderer consumes at runtime,
outside Settings. Grep `secrets\.[A-Z_]+\?\.value` under `src/`:

- **Map / tile keys that end up in client-side request URLs anyway:**
  - `CESIUM_ION_TOKEN` (`App.ts:601`, `building-tiles.ts`)
  - `GOOGLE_MAPS_API_KEY` (`building-tiles.ts`, `routing-engine.ts`)
  - `MAPBOX_API_KEY` and `MAPTILER_API_KEY` (`street-tiles.ts`, `NavigationPanel.ts:21-22`, `routing-engine.ts`)
  - `OWM_API_KEY` (`owm-weather-tiles.ts`)
- `CRYSTALBALL_API_KEY` (`services/runtime.ts`), used for crystalball.app API calls.
- `PLAINTEXT_KEYS` config values (`OLLAMA_API_URL`, `OLLAMA_MODEL`, relay URLs, usernames).

The sidecar's own comment confirms the map keys are renderer-only
(`local-api-server.mjs`, `ALLOWED_ENV_KEYS` block). **Every other key**
(Anthropic/Groq/OpenRouter, Shodan, VirusTotal, Censys, OpenCTI, MISP, HIBP,
ACLED tokens, Patreon OAuth secret, S2U credentials, …) is consumed only by
the sidecar.

1. **Sidecar-only secrets become write-only to webviews.**
   - Replace `get_secret` with `get_secret_status()`. It returns, per
     supported key, `{ present: bool, source: 'vault'|'env'|'missing' }` and
     **no values**.
   - Add `get_renderer_config()`. It returns values only for a Rust-side
     `RENDERER_READABLE_KEYS` allowlist: `PLAINTEXT_KEYS` plus the six keys
     listed above.
   - Add a drift test that fails if the Rust allowlist and the TS
     `PLAINTEXT_KEYS` plus map-key list diverge.
   - Document that the map keys are exposed by nature. The mitigation for
     those is provider-side restriction (HTTP referrer / bundle-ID
     restrictions and quota caps in each provider console), which Bradley
     should set.
   - Optional follow-up: route `CRYSTALBALL_API_KEY` calls through the sidecar
     so it can leave the allowlist.
2. **Rust pushes to the sidecar.**
   - `set_secret` / `delete_secret` inject the change into the running
     sidecar themselves. Reuse `inject_secrets_into_running_sidecar`, which
     already refuses an unconfirmed port or a dead child.
   - Delete the renderer's `pushSecretToSidecar` path for desktop. The only
     time the renderer holds a secret value is while the user is typing it
     into Settings, and the field is cleared after the `set_secret` call.
3. **Renderer state becomes presence-only on desktop.** Remove `value` from
   `runtimeConfig.secrets` entries for keys outside `RENDERER_READABLE_KEYS`, and remove
   `keychainService`'s value cache. `getSecretState()` and feature gating
   keep working off presence. Cross-window "keychain updated" broadcasts
   refresh status, not values.
4. **Validation stays sidecar-side.**
   - For a newly typed value: renderer → sidecar validate (as today) → `set_secret`.
   - For a stored value: sidecar validates by key name, reading its own env.
   - Format validation (`validateSecret`) may still run on the typed value.
5. **Web build:** out of scope. Keep the existing env path behind `!isDesktopRuntime()`.

Acceptance criteria:

- No Tauri command returns a value for any key outside `RENDERER_READABLE_KEYS`.
- After boot, a heap search in the `main` window for any stored
  sidecar-only secret finds nothing. Prove it with a manual devtools check
  in the validation doc using a dummy key.
- Saving a key in Settings still takes effect in the sidecar without restart.
- Feature availability badges, KeyDashboard and SetupWizard still reflect
  presence correctly.

Tests:

- A Rust unit test that `get_secret_status` never serializes any value, and
  that `get_renderer_config` serializes only allowlisted keys.
- A drift test between `RENDERER_READABLE_KEYS` (Rust) and `PLAINTEXT_KEYS`
  plus the map-key list (TS).
- A source assertion that desktop `loadDesktopSecrets` no longer stores values.
- Mutation: re-add `value` to status output, and a test must go red.

Sequencing: land this **with or just before** R3-SEC-004 (CSP). Together
they make a renderer compromise both less capable and less able to exfiltrate.

### R4-BUG-001: Upgrading Silently Pauses Previously-Enabled iMessage Alerts (Including EEW)

Severity: **Medium** (safety-comms regression introduced by the R3-SEC-002 fix,
which was otherwise correct). Classification: Standard+ (alerting path).

Location:

- `src/services/imessage-bridge.ts:42-63` (`getLegacyImessageSuggestion`;
  legacy localStorage is cleared once native `migrationAvailable` is false)
- `src/components/UnifiedSettings.ts:665-700` (the only place the legacy
  suggestion is surfaced)
- `src/services/seismic/eew-imessage.ts:59-78`: TIER_5 EEW returns
  `{ status: 'disabled', reason: 'feature_off' }`
- `src/app/desktop-notifications.ts:66`
- `src-tauri/src/imessage.rs:94-103`: persists the `migration_attempted`
  marker **before** the native dialog

Evidence:

- After upgrade, native config is `Missing`, so sending is disabled. That is
  correct fail-closed behavior.
- The only prompt to re-authorize lives inside Settings. If Bradley never
  opens Settings, TIER_5 EEW and critical-alert iMessages silently stop,
  showing only as a `disabled` result the caller discards.
- If he does open it and the 60 s dialog times out or he clicks Cancel, the
  marker is already persisted. `migrationAvailable` flips to false and the
  renderer deletes the legacy recipient from localStorage. The channel then
  looks "never configured", with no trace that it used to be on.

Fix (never auto-enable; the native dialog stays the only authorization):

- At boot, if legacy localStorage shows `enabled: true` with a recipient and
  native config is `Missing`, surface a persistent item outside Settings:
  "iMessage alerts are paused — confirm the recipient to resume". Use the
  Command Center or Home Shell critical band, plus a one-time native
  notification via `send_notification`. The action opens the iMessage section.
- Record every discarded send whose result is `disabled` while legacy intent
  was enabled into the Notification Trace Registry as
  `imessage_paused_reauthorization_required`, so SystemDiagnostic →
  Notifications shows it.
- Preserve a **redacted** marker of prior intent (for example
  `{ legacyEnabled: true, recipientHint: '…1234' }`) after migration is
  attempted, so a canceled or timed-out dialog still leaves a visible "paused"
  state instead of "never configured". Never keep the full legacy recipient
  after migration.

Tests:

- A renderer test that legacy-enabled + native-missing produces the
  surfaced item.
- An EEW path test that a `disabled` result with legacy intent records a
  trace entry.
- A test that a canceled consent still shows "paused", not "never configured".
- Mutation proof for each.

### R4-BUG-002: Native Notification Limiter Silently Drops Critical Alerts And Reports Success

Severity: **High** (life-safety alerts can be lost, and diagnostics say they
were delivered). Classification: High Assurance (alerting path, Tauri
command). Found in Scan D.

Location (`a255546ee`):

- `src-tauri/src/main.rs:127-128`: one **global** `NOTIFICATION_LAST_SENT`
  with a 30 s `NOTIFICATION_RATE_LIMIT`.
- `send_notification` (`main.rs:1594-1611`): if the previous notification
  from **any** caller was under 30 s ago, it returns `Ok(())`
  ("silently drop if fired too recently").
- `src/services/notification-router.ts:47-52`: `RATE_LIMIT_MS.critical = 0`,
  meaning critical is designed never to be throttled.
- `notification-router.ts:285-300`: after the native call resolves, it
  records `delivered: true`.
- `src/services/proximity-alerts.ts:134-143, 178-184, 219-225, 263-269`:
  sets `alerted[inc.id] = Date.now()` **before** calling
  `send_notification`, then never retries.
- Other native callers sharing the same limiter: `app/desktop-notifications.ts:52`
  (breaking news), `CommsHealthPanel`, `EconomicStressPanel`,
  `ResourceInventoryPanel`, `notifications/push-notifier.ts`,
  `app/desktop-updater.ts`.

Evidence and failure scenarios:

1. **Priority inversion.** A low-value notification (breaking-news headline,
   economic-stress nudge, low-stock reminder, updater toast) fires; within
   30 s a Tornado/Flash Flood Warning routes as `critical`. Rust drops it and
   returns `Ok`. The router records `delivered: true`, so SystemDiagnostic →
   Notifications shows a successful critical dispatch that never happened.
2. **Same-tick loss.** One proximity scan finds two new wildfire
   evacuation orders, or a wildfire plus a hazmat release. The loop marks
   both `alerted`, the first `send_notification` succeeds, and the second
   is dropped by the 30 s window, **permanently**, because `alerted[id]`
   is already set.
3. Outbreak days produce bursts of warnings, so this fails exactly when it
   matters most. `speak_aloud` has the same silent-drop pattern with a 5 s
   window (`VOICE_RATE_LIMIT`, `main.rs:134`).

Fix (bring the design):

- **Make the native result honest.** `send_notification` returns a typed
  outcome (`delivered | rate_limited | failed`) instead of `Ok(())` on
  suppression. Every caller and every trace records the real outcome.
- **Priority-aware limiting in Rust.**
  - Accept a `priority` field (`critical | high | normal`).
  - Exempt `critical` from the limiter; allow a bounded burst, for example
    a token bucket of 5 per 60 s. Renderer-controlled priority is
    acceptable here, because the worst abuse is notification spam, which is
    far cheaper than a lost warning.
  - **Queue and coalesce** non-critical items instead of dropping them: one
    follow-up notification such as "3 more alerts" after the window.
- **Deliver before marking.** `proximity-alerts.ts` sets `alerted[id]` only
  after a `delivered` outcome, and batches multiple same-tick incidents into
  one summary notification.
- Apply the same honesty and queueing to `speak_aloud`.

Acceptance criteria:

- Two critical alerts 1 s apart both produce native notifications.
- A critical alert 1 s after a normal notification is delivered.
- No trace records `delivered: true` for a suppressed or queued notification.
- Two same-tick evacuation orders both reach the user, individually or as one
  coalesced notification that names both.

Tests: Rust unit tests for the limiter policy (pure fn over timestamps and
priorities); router test that a `rate_limited` outcome is recorded as
not-delivered; proximity test that `alerted` is not set on a
`rate_limited`/`failed` outcome. Mutation proof for each.

### R4-BUG-004: A Crashed Sidecar Is Never Restarted, And Traffic (Including Location) Silently Fails Over To The Cloud

> **Decided (Part 1b):** keep cloud fallback on by default. Implement the supervisor as written. Replace the opt-in/local-only part of the fix with: fall back only on connection failure or 5xx, coarsen coordinates to 2 decimals, and never send place names or watchlist terms.

Severity: **High** (situational-awareness blackout for the rest of the
session, plus a privacy-posture regression). Classification: High Assurance
(process supervision, network egress). Found in Scan G.

Location (`a255546ee`):

- `src-tauri/src/main.rs:3885-3920`: the sidecar monitor thread. On
  `try_wait() → Ok(Some(status))` it logs "exited unexpectedly", clears the
  child slot and **returns**.
- `start_local_api` has exactly **one** call site: boot, `main.rs:4747`.
  No command, watchdog or monitor restarts it. The `restart_count` /
  flapping bookkeeping (`main.rs:148-165, 3640-3650`) exists but is only
  incremented on boot starts.
- `src/services/runtime.ts:340-403` (fetch patch): on **any** local error
  **or any non-2xx**, requests fall back to `getRemoteApiBaseUrl()`
  (crystalball.app) with `X-CrystalBall-Key`, unless the target is
  local-only.
- `runtime.ts:194-207`: `LOCAL_ONLY_API_TARGETS` contains two UCDP paths,
  plus the `/api/local-*` prefix.
- Location-bearing endpoints that are **not** local-only include
  `/api/weather/local-forecast?lat=…`, `/api/airnow/current`,
  `/api/marine-forecast`, `/api/river-discharge`, `/api/met-norway-temp`,
  `/api/flood-gauges/noaa-coops`, `/api/air-quality-proxy`,
  `/api/adsb-aggregate`, `/api/hifld-infrastructure`.

Failure scenario: the Node sidecar exits mid-session (OOM in a 22k-line
process, an uncaught exception, a native crash).

- Every sidecar-backed feed stays dark until Bradley quits and relaunches.
  That includes IPAWS/FEMA emergency alerts (`ipaws-aggregate.mjs`), GDACS,
  analyst state and SMS.
- Meanwhile, if a Crystal Ball cloud key is configured, the renderer quietly
  sends those requests to the public deployment instead. His saved-place
  and current-location coordinates then land in Vercel request logs, which
  contradicts the privacy-first posture.
- A **500 from a healthy sidecar** also triggers the same cloud failover.

Fix (bring the design):

- **Supervisor.** On unexpected exit, restart with exponential backoff (for
  example 1 s → 2 s → 4 s … capped at 60 s). Use the existing restart
  bookkeeping to stop after N flaps in 5 minutes and surface a persistent
  "Local engine down, Retry" state in the Home Shell status ribbon and
  SystemDiagnostic. Each restart re-generates the token and re-injects
  secrets through the existing confirmed-port path.
- **Privacy-safe failover.**
  - Make cloud fallback **opt-in** (a setting that defaults to off on desktop).
  - Classify every location-bearing or personally scoped endpoint as
    local-only, enforced by a test that fails when a new `/api/*` target
    carrying `lat`/`lon`/`place`/`watchlist` parameters is not in the
    local-only set.
  - Do not fall back on a sidecar **HTTP error** (4xx/5xx), only on
    connection failure.

Acceptance criteria:

- Killing the sidecar process (`kill -9`) during a session restores all
  sidecar feeds within about 10 s, with no app restart.
- With cloud fallback off, no request to the remote base URL is ever made.
- Even with fallback on, no location-bearing request leaves the machine.

Tests: a pure backoff/flap policy unit test; a renderer test that a
location-bearing target never reaches `cloudFallback`; a source/wiring test
that the monitor's unexpected-exit branch calls the restart path. Mutation
proof for each.

### R4-BUG-006: The Sanctioned Key Backup/Restore Scripts Cannot See The Current Vault

Severity: **High** (the only safeguard adopted after the 2026-05-08 key-loss
incident is silently ineffective, and it is the stated prerequisite for
retiring the shadow vault in R3-SEC-003 phase B). Classification: High
Assurance (secrets). Found September 29.

Location:

- `scripts/backup-keys.sh:32-52, 87-105`: reads **per-key** Keychain items
  (`security find-generic-password -s crystal-ball -a <KEY> -w`) for a
  hard-coded list of **29** keys.
- The app stores every secret in **one** consolidated item: service
  `crystal-ball`, account `secrets-vault`, a JSON blob
  (`main.rs:361-382`, `save_vault` `:727-736`).
- After migrating to the vault, the app **deletes** the per-key items
  (`main.rs:445-452`). `SUPPORTED_SECRET_KEYS` now has **77** keys.
- `scripts/restore-keys.sh` writes per-key items, which the app ignores
  once a vault exists (it only migrates per-key items when no vault is present).

Impact: on a migrated install, the backup reports "Found 0 / 29" and exits 2,
or, worse, backs up a stale subset. Restore cannot put secrets back where
the app reads them.

Fix (Codex writes and tests it; **only Bradley runs it**, per the CLAUDE.md
Keychain prohibition):

- `backup-keys.sh` reads the single `secrets-vault` item, validates it as
  JSON, and pipes it **straight into the encryptor** (age preferred).
  Plaintext never touches disk; the current script uses a temp file.
- Keep the legacy per-key read only as a fallback when no vault item exists.
  Report the key **count and names** (never values) contained in the vault.
- `restore-keys.sh --verify` decrypts and lists names. A real restore writes
  the `secrets-vault` item (`-U`), requires the app to be **quit** (it
  refuses if Crystal Ball is running), and prints the key count.
- Tests use a stub `security` binary on `PATH` (the real Keychain is never
  touched). Cover vault present, legacy only, neither, and malformed JSON.
  Mutation proof.

**Interim for Bradley** (a manual step he runs himself, not an agent
instruction): back up the vault item directly, encrypted with a passphrase:

```bash
brew install age   # once
security find-generic-password -s crystal-ball -a secrets-vault -w \
  | age -p -o ~/Library/Mobile\ Documents/com~apple~CloudDocs/CrystalBall/vault-$(date +%Y%m%d).age
```

When macOS asks whether `security` may access the item, choose **Allow**
(not "Always Allow"). age then asks for a passphrase. Store the passphrase
somewhere other than this Mac.

### R4-BUG-005: Several Feeds Exhaust Their Free Quotas Every Day (Or Every Week)

Severity: **Medium-High** (feeds go dark daily and look "degraded" for
reasons the diagnostics never name. It also violates the "never record a
healthy vote for a provider that contributed nothing" principle once 429s
start). Found September 29. Limits were checked against provider docs the
same day, except where marked *unverified*.

**Root cause:** refresh cadence is set per feed by TTL alone
(`feed-latency-config.mjs`, inline `getCached(...)`), with no awareness of
provider quotas. Caches are in-memory, so **every sidecar restart and every
app relaunch refetches everything.** main-sync reinstalls after merges, so
restarts are frequent. TTL math alone therefore undercounts real usage.

| Provider (key) | Free limit (source) | Current app behavior | Worst-case use | Verdict | Target |
|---|---|---|---|---|---|
| **GreyNoise** Community | **50 searches/week** ([docs](https://docs.greynoise.io/docs/using-the-greynoise-community-api)) | `/api/greynoise-scanners` looks up **20 seed IPs** per refresh, 15-min cache (`local-api-server.mjs:17345-17372`) | ~1,920/day | **Exhausted in ~45 min, dead for the week** | Refresh seeds weekly (20/wk); budget 40/wk; reserve 10/wk for on-demand `/v3/community/{ip}` |
| **AbuseIPDB** blacklist | **5/day** (check: 1,000/day) ([pricing](https://www.abuseipdb.com/pricing)) | `blacklist?limit=50`, 30-min cache (`:17409-17418`) | 48/day | **Exhausted by ~2:30 a.m.** | 8 h cache (3/day), persisted; reserve 2 |
| **OpenSky** (OAuth client) | **4,000 credits/day**; global `/states/all` = **4 credits** ([docs](https://openskynetwork.github.io/opensky-api/rest.html)) | Global `/states/all` (no bbox), 55 s cache (`:17452-17458`, `:17630-17636`) | 6,284 credits/day | **Exhausted after ~15 h** | Global at ≥120 s (2,880/day = 72%) or a ≤25 sq° bbox (1 credit); read `X-Rate-Limit-Remaining` |
| **NewsAPI** | **100/day**; dev plan has a 24 h delay and is not allowed in production/internal use ([pricing](https://newsapi.org/pricing)) | `everything?q=…`, 10-min cache per query (`:10535-10556`) | 144/day per query | **Exhausted after ~17 h** | One query at a 20-min TTL (72/day), or drop NewsAPI in favor of NewsData |
| **PurpleAir** | **1,000,000 points once**, then prepaid ($10 ≈ 1M); cost = base + field cost × rows ([pricing](https://community.purpleair.com/t/api-pricing/4523)) | 8 fields × every sensor in the bbox (or **all sensors** with no bbox), 5-min cache (`:15425-15437`) | Grant likely gone in days (hours without a bbox) | **One-time grant burns fast** | 4 fields, a tight bbox per saved place, 60-min TTL, `max_age`; points ledger in diagnostics |
| **OpenWeatherMap** | 60/min, 1,000,000/month; map tiles count ([pricing](https://openweathermap.org/full-price)) | Current conditions 10-min per location + tiles | ~144/day/location + tiles | OK | Budget 25k/day as a guard |
| **VirusTotal** public | 500/day, 4/min, non-commercial ([docs](https://docs.virustotal.com/reference/public-vs-premium-api)) | On-demand + key probe | Low | OK | Client throttle 4/min; budget 400/day |
| **Cesium ion** Community | 15 GB/mo streaming; 1,000 imagery sessions/mo; **1,000 Google Photorealistic 3D root tiles/mo** ([pricing](https://cesium.com/platform/cesium-ion/pricing/)) | God's Eye globe + building tiles | Per session | OK for one user | Avoid re-creating the viewer per panel open; ≤30 sessions/day |
| **GeoNames** | 10,000 credits/day, 1,000/hour ([terms](https://www.geonames.org/export/)) | 1 h cache | Low | OK | Budget 8,000/day |
| **OpenRouter** `:free` models | 20/min; **50/day** (1,000/day with ≥$10 credits) ([docs](https://openrouter.ai/docs/api_reference/limits)) | LLM fallback | Varies | Watch | Budget 40/day unless credits are bought |
| **Groq** | Per model; the account's limits page is authoritative ([docs](https://console.groq.com/docs/rate-limits)) | Fallback after local Ollama (`llama-3.1-8b-instant`, `:6775-6810`) | Low | OK | 80% of the console RPD/TPD |
| **Anthropic** | Paid; tier cap, **custom monthly spend limit** settable in Console ([docs](https://platform.claude.com/docs/en/api/rate-limits)) | `claude-haiku-4-5` calls (`:11411, 11483`) | Varies | Money risk | Bradley sets a Console limit (e.g., $10/mo) + app monthly token budget |
| NewsData.io | *unverified*: ~200 credits/day | 10-min cache per query | 144/day per query | Tight | 15-min TTL (96/day) |
| NASA api.nasa.gov, FIRMS, AirNow, FRED, EIA, OTX, Finnhub, abuse.ch, ACLED, urlscan, Shodan, AISStream | *unverified this pass*; usually generous hourly/minute limits | 15 min to 6 h caches, or on-demand | Low | Likely OK | Governor records actual 429s and adapts |

Fix: a **Quota Governor** in the sidecar (bring the design):

- A per-provider budget table (limit, window day/week/month, credit
  weights such as OpenSky's bbox-area cost, reserve for on-demand/manual use,
  target ≤ 80%).
- Every outbound call to a governed host is **counted before sending**.
- Counts and last-good responses are **persisted** (for example
  `quota-ledger.json` in `LOCAL_API_DATA_DIR`, 0600), so restarts don't reset them.
- At 80% of budget, stretch the TTL. At 100%, serve the last-good response
  marked `stale_quota`, never an empty "all clear", and record a
  `quota_exhausted` diagnostic (not a healthy vote).
- Honor provider headers (`X-Rate-Limit-Remaining`, `Retry-After`,
  `X-RateLimit-Reset`).
- A SystemDiagnostic "API budgets" view shows each provider's use and remaining quota.
- **Ship the one-line TTL/field fixes above first** (GreyNoise, AbuseIPDB,
  OpenSky, NewsAPI, PurpleAir). They stop today's daily blackouts before the
  governor lands.

Tests: governor unit tests (window rollover, credit weights, persistence
across a simulated restart, reserve, stale-serving); a per-feed test that
the configured cadence × weight stays ≤ 80% of the documented limit, so a
future TTL change that breaks a budget fails CI. Mutation proof.

### R4-SEC-002: Main-Sync Auto-Install Runs npm Install Scripts From Unreviewed Dependency Versions

Severity: **High** (most realistic path to full compromise of Bradley's Mac).
Classification: High Assurance (supply chain, install logic). Found in Scan A.

Location (`a255546ee`):

- `scripts/sync-main-to-mac.mjs:21-28` (`NPM_VERIFICATION_COMMANDS`): runs
  plain `npm ci`, so **lifecycle scripts are enabled**, for every new `main`
  commit, from a LaunchAgent, as Bradley's user.
- `.npmrc`: no `ignore-scripts`.
- `.github/dependabot.yml`: weekly npm/cargo/actions bumps with **no `cooldown`**.
- `.github/workflows/auto-merge-agent-branches.yml`: any pushed
  `claude/**`, `codex/**` or `copilot/**` branch gets GitHub auto-merge (for
  example the `claude/dep-bumps-*` branches).
- `.github/CODEOWNERS`: does not cover `package.json`, `package-lock.json`,
  `.npmrc`, `src-tauri/Cargo.lock`, or `tools/mcp-server/package*.json`.

Evidence and chain:

1. A dependency's maintainer account is hijacked and a new version ships
   with a `postinstall` payload. This is the 2025 npm worm and credential-stealer
   pattern, which specifically went after tokens and AI coding-agent CLIs.
2. A dependency bump (Dependabot, or an agent's `dep-bumps` branch) picks up
   the new version within days or hours. CI and `npm audit` are green
   because the malicious version is not yet known-bad.
3. The PR merges. Agent branches auto-merge.
4. main-sync polls `main`, sees green required checks, and runs `npm ci` on
   the Mac. The payload runs with Bradley's full user privileges: `~/.ssh`,
   `gh` / Codex / Claude tokens, the R3-SEC-003 shadow vault, browser
   profiles, and the ability to prompt for Keychain items.

Today only 9 of 1,057 locked packages declare install scripts: `bufferutil`,
`core-js`, `es5-ext`, `esbuild`, `fsevents` (x3), `protobufjs` and
`utf-8-validate`. None is functionally required at install time. Their work
is either optional native acceleration with JS fallbacks, donation or
version banners, or platform-binary checks that optionalDependencies
already cover. So disabling scripts is cheap. A worm's defining move is
**adding** a new install script, which a drift gate catches.

Fix (defense in depth; bring the design):

1. **No lifecycle scripts by default.**
   - Put `ignore-scripts=true` in `.npmrc`, or use `npm ci --ignore-scripts`
     in main-sync **and** CI.
   - Explicitly `npm rebuild <pkg>` only an allowlist that genuinely needs
     it. Verify on a clean clone whether the list is empty; esbuild in
     particular normally works from its platform optional dependency.
   - Apply the same to `tools/mcp-server` and `src-tauri/sidecar` installs.
2. **Install-script drift gate (CI, required check).** Fail any PR where the
   set of lockfile packages with `hasInstallScript: true` changes, or where
   `bin` entries appear on packages that did not have them. A human must
   approve the change.
3. **Release-age cooldown.**
   - Add Dependabot `cooldown` (for example 7 days default, longer for
     semver-major) for npm and cargo.
   - Add a CI check that fails when any **changed** lockfile entry's
     publish time (`npm view <pkg>@<ver> time --json`) is under N days old,
     with a documented override label for urgent security patches.
4. **Registry integrity.** Run `npm audit signatures` in CI to verify
   registry signatures and provenance attestations where published.
5. **Human gate on dependency changes.**
   - Extend CODEOWNERS to `package.json`, `package-lock.json`, `.npmrc`,
     `**/package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`,
     `.github/dependabot.yml`.
   - Make the auto-merge workflow **skip** PRs that touch those paths.
     Bradley can confirm whether "Require review from Code Owners" is on.
6. **Optional, cutting-edge:** run the main-sync build step as a dedicated
   unprivileged macOS user, or in a throwaway VM/container, and copy only
   the signed `.app` out. The build then never runs with access to
   Bradley's home directory.

Acceptance criteria:

- A PR that adds a new `postinstall` anywhere in the tree cannot merge
  without Bradley's approval.
- main-sync never executes a dependency lifecycle script outside the explicit allowlist.
- A version published less than N days ago cannot land without the override label.

Tests: unit tests for the drift detector and the age checker (fixture
lockfiles plus a stubbed registry), and an assertion that
`NPM_VERIFICATION_COMMANDS` contains no script-enabled install. Mutation
proof for each.

### R4-SEC-003: Main-Sync Check Gate Passes Vacuously; Check-Runs Not Paginated

Severity: **Medium** (fail-open gate on the auto-install path). Found in Scan A.

Location: `scripts/sync-main-to-mac.mjs`:

- `evaluateRequiredChecks` (288-307) returns `isGreen: true` when
  `requiredChecks` is empty.
- `verifyRemoteChecks` (355-366) builds that list from
  `branches/main/protection/required_status_checks` and reads
  `commits/<sha>/check-runs` **without `--paginate` / `per_page`**.

Evidence and impact:

- If the branch-protection required-check list is ever emptied (edited,
  renamed, or protection recreated), every `main` commit auto-installs with
  **no** checks. The gate is only as strong as a remote setting it never
  sanity-checks.
- The check-runs API returns 30 per page by default. This repo runs 20+
  workflows, several multi-job. A required check that lands on page 2 reads
  as "missing". That is fail-closed but stalls syncs, and the code already
  has a merged-PR fallback that may be masking it. **Confirm with**
  `gh api repos/bradleybond512/crystal-ball/commits/<recent-main-sha>/check-runs --jq .total_count`.

Fix:

- Pin a **local minimum** required set in the script: at least the
  cross-agent review, typecheck, unit tests, secret scan, security audit and
  SAST. Refuse when the remote list is empty or missing any pinned entry.
- Paginate (`gh api --paginate`, or `per_page=100` plus paging).
- When a check name appears more than once, take the newest run.

Tests: an empty list → refuse; remote list missing a pinned check → refuse;
a 2-page fixture → the required check on page 2 is found. Mutation proof.

### R4-SEC-004: MCP Server Feeds Raw, Attacker-Influenced Feed Text To Coding Agents

Severity: **Medium** (prompt-injection path into agents that can execute
commands). Found in Scan B.

Location:

- `.mcp.json` (repo root): registers `crystalball` →
  `node tools/mcp-server/index.mjs` for every agent session opened in this repo.
- `tools/mcp-server/result.mjs`: `textResult(data)` returns
  `JSON.stringify(data)` of upstream content verbatim.
- `tools/mcp-server/index.mjs`:
  - server `instructions` do not mark tool output as untrusted;
  - read tools include `search_news`, `get_sitrep`, `sitrep_bundle`, `query_raw`, …;
  - write tools include `submit_hypothesis_feedback`, `dismiss_hypothesis`,
    `run_skeptic_now` (→ sidecar `/api/analyst-commands`), and
    `watchlist_manage` / `alert_rules_manage` (→ `~/.crystal-ball`).

Evidence and chain: headlines, GDELT/RSS text, Telegram/OSINT snippets and
similar content are attacker-writable by anyone who can publish news or post
to a monitored channel. Codex and Claude Code sessions in this repo have
shell access, git push, and Bradley's tokens, and they load this MCP server
by default. An embedded instruction in a headline reaches the agent's
context as trusted-looking tool output. Even without shell abuse, the write
tools let an injected agent:

- **dismiss real threat hypotheses**; or
- **submit fabricated outcome feedback**, which poisons the calibration
  loop (the "70% means 70%" principle).

Fix:

- **Frame untrusted content.** Wrap every external free-text field in an
  explicit envelope, for example
  `{ "untrusted_external_text": "...", "source": "...", "fetched_at": "..." }`.
  State in the server `instructions` that tool output is data, never
  instructions. Strip zero-width and bidi control characters.
- **Separate read and write.** Remove `.mcp.json` auto-registration for
  development sessions, or register a **read-only** tool profile there.
  Expose write/feedback tools only in an explicit analyst profile
  (`CRYSTALBALL_MCP_PROFILE=analyst`).
- **Provenance on feedback writes.** Have `/api/analyst-commands` tag
  MCP-originated feedback (`origin: 'mcp'`). Exclude it from calibration
  scoring unless Bradley confirms it in the UI.

Tests: a result-envelope contract test across all tools (no raw external
string at the top level), a profile test (the default profile has no write
tools), and an origin-tagging test on the sidecar. Mutation proof.

### R4-SEC-005: Resource Inventory JSON Import Is A Stored-XSS Path Into The Main Window

Severity: **Medium** (user-assisted: Bradley imports a crafted file, for
example a shared prepper "inventory template"; the payoff is full
main-window script execution, see R4-SEC-001). Found in Scan C.

Location: `src/components/ResourceInventoryPanel.ts`:

- `:433-445`: `JSON.parse(reader.result) as ResourceItem[]`, then
  `putItem(item)` for anything with truthy `id`/`name`. There is **no schema
  or type validation**.
- `:320-323`: `data-id="${item.id}"` is interpolated **unescaped** into
  `innerHTML` on every render.
- `:313-318`: `item.quantity.toFixed(1)`, `this._esc(item.category)` and
  others assume types. A non-number `quantity` or a missing `category`
  throws, so the panel stops rendering (persistent DoS until the IndexedDB
  row is removed).
- `_esc` (`:564-566`) does not escape `'`.

A file containing `{"id":"\"><img src=x onerror=…>","name":"x"}` executes
script in `main` on the next render, and persists in IndexedDB across
restarts.

Fix:

- Validate imports with an allowlisted schema:
  - `id` matching `^[A-Za-z0-9_-]{1,64}$` (or re-generate ids on import);
  - `name`, `unit` and `category` as bounded strings;
  - finite, non-negative `quantity`;
  - `consumptionLog` as a bounded array of `{ ts: finite, amount: finite }`.
- Reject the whole file on any violation and show a count.
- Escape `id` (or render rows via DOM APIs / `dataset`).
- Harden `_esc` to escape `'`, or switch to the shared `escapeHtml`.
- Apply the same validation when loading existing IndexedDB rows, so an
  already-poisoned store self-heals.

Tests: import fixtures (script-bearing id, wrong types, oversize) must be
rejected; a render test must not throw on legacy malformed rows. Mutation
proof.

### R4-SEC-006: Renderer Uses An Unconfirmed Default Port And Sends It The Bearer Token

Severity: **Low-Medium** (needs a foreign listener on 46123 plus a slow or
failed sidecar start; any macOS user, not only the same user, can bind a
loopback port). Found in Scan G. **Design it together with R4-SEC-001.**

Location:

- `main.rs:3928-3949`: if the sidecar's port file isn't written within 15 s,
  Rust sets `port = DEFAULT_LOCAL_API_PORT` (46123) with
  `port_confirmed = false`.
- `get_local_api_port` (`main.rs:1006-1011`) returns that port **without**
  the confirmation bit.
- `runtime.ts:41-43` also defaults to 46123 before resolution.
- The fetch patch (`runtime.ts:340-346`) attaches `Authorization: Bearer
  <LOCAL_API_TOKEN>` to every request against that base.
- `setSecretValue` → `pushSecretToSidecar` (`runtime-config.ts:1156, 1181`)
  POSTs **secret values** there.

Rust's own injector already refuses unconfirmed ports (`main.rs:4207`), and
the boot-time JS push was disabled for exactly this reason
(`runtime-config.ts:1390-1396`). The renderer's steady-state paths never got
the same check.

Fix:

- `get_local_api_port` returns `{ port, confirmed }`, or errors while
  unconfirmed. The fetch patch attaches the token only to a confirmed port.
- R4-SEC-001 removes renderer-side secret pushes entirely.
- **Correct the stale threat-model comment** at `runtime.ts:239-262`. It
  claims the CSP has "script-src 'self' (no unsafe-inline/eval)", which is
  false while R3-SEC-004 is open, and reviewers rely on that comment.

Tests: a renderer test that no bearer token is attached while unconfirmed,
and a Rust test that the command reports `confirmed: false` after the
timeout path. Mutation proof.

### R4-SEC-007: Public LLM Endpoint Is Callable Without A Key And Its Cache Is Trivially Bypassed

> **Latent (Part 1b):** no API deployment exists today. Fix before deploying `api/` anywhere.

Severity: **Medium** (internet-facing cost and quota abuse of Bradley's Groq /
OpenRouter keys; applies if the web deployment has those keys set). Found in
Scan E.

Location:

- `api/_api-key.js` `validateApiKey`: a **GET** passes **without any key**
  when `isTrustedBrowserRequest` sees `Origin: https://crystalball.app` and
  `Sec-Fetch-Site: same-origin|same-site`. Those headers are only
  unforgeable **inside a browser**. Any script or `curl` can send them.
  `middleware.ts` only filters by User-Agent, which can be spoofed.
- `server/crystalball/intelligence/v1/get-country-intel-brief.ts` is the
  one LLM-backed **GET** RPC (`service_server.ts:342-343`).
  - `countryCode` is only presence-checked (`:35`) and is interpolated into
    the prompt.
  - A free-form `context` query parameter (up to 4,000 chars, `:43`) is
    hashed into the cache key (`:48-49`) and appended to the prompt (`:74-75`).
  - So every unique `context` is a cache miss and a fresh LLM call, and it
    works as a free general-purpose LLM proxy via prompt injection.
- `server/_shared/rate-limit.ts`: 300 requests / 60 s per IP, and it
  **fails open** when Upstash is unset or erroring. `api/claude-agent.js:105-109`
  documents the same fail-open.

Fix:

- Require `X-CrystalBall-Key` (or a server-issued, short-lived signed web
  token) for **every cost-bearing route regardless of method**. Keep the
  fetch-metadata relaxation only for free, cached, non-LLM reads.
- Validate `countryCode` against the ISO-3166 allowlist. Cap `context`,
  bucket it into a closed schema of signal categories (not free text), or
  drop it for unauthenticated callers.
- **Fail closed** on rate-limiter errors for cost-bearing routes, and add a
  per-route daily spend cap (a Redis counter).

Tests: an unauthenticated GET with spoofed browser headers is rejected for
cost-bearing RPCs; an invalid `countryCode` returns 400; a limiter error
returns 503 for cost-bearing routes. Mutation proof.

### R4-SEC-008: The App Still Trusts `crystalball.app`, A Domain Bradley Does Not Own (For Sale)

Severity: **Medium** (latent; becomes High the day someone buys the domain).
Found September 29.

Evidence: `https://crystalball.app` 302-redirects to
`fortune.domains/name/Crystalball.app`. The app still trusts and links to it:

- `tauri.conf.json` CSP `connect-src` and `frame-src` allow
  `https://crystalball.app` and `https://*.crystalball.app`. `index.html`'s
  meta CSP does the same for the web build.
- `services/story-share.ts:17` generates share links as
  `https://crystalball.app/api/story?…`. Anyone Bradley shares with would
  land on the buyer's site.
- `settings-constants.ts:11` (the `CRYSTALBALL_API_KEY` signup link),
  `ServiceStatusPanel.ts:165` and `LiveNewsPanel.ts:408, 453-454` use it as
  a default or fallback origin.
- `services/runtime.ts:145-160` `APP_HOSTS` treats `*.crystalball.app` as
  the app's own origin.
- `api/_api-key.js` and `_cors` allowlists trust its origins (these matter
  only if the API is ever deployed).

Fix: remove `crystalball.app` everywhere, or replace it with a domain
Bradley controls (or the GitHub Pages origin for share links). Add a test
that fails if an unowned domain appears in the CSP, the `APP_HOSTS` set or
the CORS allowlists. Keep the list of owned domains in one constant. If
Bradley wants the name, buying it is the alternative.

### R4-SEC-009: Security Checks Run But Are Not Required, So They Gate Neither Merge Nor Auto-Install

Severity: **Medium**. Found September 29 (GitHub API).

Evidence: `main` requires 7 checks (see Part 1b). `security-audit.yml`
(`npm-audit`, `cargo-audit`, `cargo-deny`, `sidecar-http-guardrail`),
`sast.yml` (Semgrep), ESLint, `static-lint` and `smoke` are **not required**.
Agent PRs auto-merge on the required set alone, and main-sync
(R4-SEC-003) installs on the same set. A PR that fails Semgrep or
cargo-deny still ships to Bradley's Mac.

Fix:

- **Bradley** (GitHub → Settings → Branches → `main`, or via `gh api`) adds
  as required: `semgrep`, `cargo-deny`, `sidecar-http-guardrail`, `eslint`,
  `static-lint`, `smoke`.
- Keep `npm-audit` / `cargo-audit` **non-blocking but alerting**, since new
  advisories unrelated to a PR would otherwise block every merge. Better:
  make them required with a reviewed allowlist file, plus a daily scheduled
  run that opens an issue.
- **Codex** mirrors the same set into R4-SEC-003's pinned local minimum in
  `sync-main-to-mac.mjs`.
- Note on CODEOWNERS: turning on "Require review from Code Owners" would
  block every agent PR that Bradley can't approve (agents open PRs and
  commit as Bradley, and GitHub forbids approving your own PR while
  `enforce_admins` is on). The practical control is R4-SEC-002 step 5's
  **path-based auto-merge skip**. A separate GitHub App identity for agents
  would make owner review meaningful later.

### R4-BUG-003: Mute And Quiet-Hours Semantics Can Silence Safety Alerts Or Disagree

> **Decided (Part 1b):** critical alerts bypass master mute.

Severity: **Low-Medium** (design + consistency). Found in Scan D.

- `notification-settings-service.ts:191`: `masterMute` returns
  `allowed: false` **before** the critical check. A mute switched on for a
  meeting and forgotten silences Tornado/EEW notifications indefinitely,
  and nothing outside the Notifications settings panel shows that mute is on.
  Recommendation: life-safety `critical` bypasses master mute (as iOS
  Critical Alerts do), **or** mute takes a duration and auto-expires, with a
  persistent "Notifications muted" indicator in the Home Shell ribbon.
  Bradley decides which.
- There are two quiet-hours implementations with opposite edge semantics:
  - `notification-settings-service.ts:168-184` (`isInQuietHours`) treats
    `start === end` as **24 h quiet** and parses blank/invalid parts as `0`,
    so blank times give `00:00–00:00`, which is also 24 h quiet.
  - `notification-dispatcher.ts:82-101` (`isQuietHoursActive`, separate
    `wm-quiet-hours` key) treats `start === end` as **never** quiet and
    rejects invalid times.

  Unify on one pure function and one storage key. Reject invalid or equal
  times at save time.

Tests: one table-driven quiet-hours test shared by both call sites
(overnight, equal, blank, invalid, DST-transition day), and a mute-bypass or
mute-expiry test per the chosen design.

### R4-LOW-001: Analytics Consent Is Auto-Granted For Pre-Existing Installs

Severity: **Low** (inert on Bradley's local builds today: no `VITE_POSTHOG_KEY`
in `.env.local` or CI workflows).

Location: `src/services/analytics.ts:90-103` `migrateAnalyticsConsent()`. If
`wm-installation-id` exists and no consent key is set, it writes
`wm-analytics-consent = 'true'`.

Why it matters: in a privacy-first app, implied consent is the wrong
default, and it becomes live the moment a PostHog key is added to any build.

Fix: migrate existing installs to "unanswered" and show the consent banner.
Only an explicit click writes `'true'`. Test: existing-install migration
never writes `'true'`, with a mutation proof.

### R4-LOW-002: Actions Expression Injection In The Auto-PR Workflow

Location: `.github/workflows/auto-merge-agent-branches.yml:33` (bash
`BRANCH="${{ github.ref_name }}"`) and `:70-71, 126-127, 184` (JS literals
built from `${{ steps.meta.outputs.* }}` / `${{ github.ref_name }}`).

A branch name containing `$(…)` or `'` executes in the runner. Exploiting it
needs push access (the trigger is `push`), and the job token is limited to
`contents: read` / `pull-requests: write`. Fix: pass values through `env:`
and read `process.env` / `"$BRANCH"`. Add actionlint/zizmor to
`actionlint.yml`. (Scan A found **no** fork-reachable injection: no
`pull_request_target`, `workflow_run` or `issue_comment` triggers, and no
interpolation of PR title/body/head_ref.)

### R4-LOW-003: Unpinned MCP Servers In `.github/mcp.json`

`npx -y @modelcontextprotocol/server-filesystem`, `uvx mcp-server-fetch`,
and `ghcr.io/github/github-mcp-server` with no tag or digest each run
whatever is latest at launch. Pin exact versions (npm `@x.y.z`, `uvx
mcp-server-fetch==x.y.z`, image `@sha256:…`) and let Dependabot bump them
under the R4-SEC-002 cooldown.

### R4-LOW-004: Patreon OAuth Callback Script-Context Escaping

`local-api-server.mjs:7477` interpolates `JSON.stringify(payload)` into an
inline `<script>`. `JSON.stringify` does not escape `<`, so an error string
containing `</script>` breaks out on the `http://127.0.0.1:<port>` origin.
The payload is Patreon-controlled today, so the impact is low. Fix: escape
`<`, `>` and `&` as `\u003c`, `\u003e`, `\u0026`, or deliver the payload in a
`<script type="application/json">` data block. Also consider returning
tokens to Rust instead of `window.opener`, if the flow allows.

### R4-LOW-005: Unescaped Error Text In S2 Underground Panel

`src/components/S2UndergroundPanel.ts:142` interpolates `error.message` into
`innerHTML`. The source is local today (sidecar/fetch errors). Wrap it in
`escapeHtml`. This is the class R3-SEC-009 describes.

### R4-LOW-006: Ungated Quota-Bearing Feed Endpoints Accept Caller Parameters

Found in Scan E. Around 28 legacy `api/*.js` feed routes spend server-held
keys with **no** `validateApiKey` / `requireAppAuth` gate. The
arbitrary-input oracles (HIBP account, VirusTotal, IPinfo, Vulners) *are*
correctly gated by `requireAppAuth`. Most of the rest are fixed, cached
feeds and fine. Two need attention:

- `api/newsapi-headlines.js:18-19` takes an arbitrary `q` with **no cache**.
  NewsAPI's free tier is about 100 requests/day, so anyone can blind the
  app's NewsAPI feed daily.
- `api/mediastack-news.js:25-58` caches one global `_cache` regardless of
  the `categories`/`limit` parameters. The first caller's categories are
  served to everyone for the TTL (cache poisoning, a correctness bug).

Fix: key caches by normalized params (or ignore caller params and serve the
app's fixed query), and gate quota-bearing routes with `requireAppAuth`.

### R4-LOW-007: Sidecar stdout/stderr Log Only Rotates At Spawn

Found in Scan F. Rust opens the sidecar log in append mode and calls
`rotate_log_if_needed` only in `start_local_api` (`main.rs:3700`). Node's
own `sidecar-logger.mjs` rotates *its* file, but console output goes to the
Rust-opened file, which can grow without bound across a multi-week always-on
session. **Confirm** by checking the size of `~/Library/Logs/com.bradleybond.crystalball/`
on Bradley's Mac. Fix: rotate on a timer from Rust by re-opening the handle,
or route all sidecar console output through the rotating logger.

### R4-LOW-008: Calibration Evidence Is Capped And Renderer-Only

Found in Scan F. `services/intelligence/outcome-ledger.ts:12, 82-83`
(`MAX_RECORDS = 2000`, `localStorage` `wm-outcome-ledger`) and
`services/forecast-accuracy.ts:15-18` (`MAX_PREDICTIONS = 100`) hold the
outcome evidence behind the "70% means 70%" calibration principle. It lives
only in WebKit storage, with rolling caps and no export. A WebKit data reset
or bundle-ID change erases it.

If the ACC roadmap's sidecar evaluation store is the intended durable
record, document that and make the renderer ledgers reconstructable from
it. Otherwise, persist outcomes append-only in the sidecar (like the
`events.db` retention model) and add an export.

---

## Unified Queue

Status (October 4, 2026): every row except 16b has an open PR awaiting Codex
cross-agent review and Bradley's merge. Ordered by value ÷ effort. Rows marked *cheap* suit a lower-cost model or
low reasoning effort. The design gates marked **high** are where deeper
reasoning pays off.

| Q | Item | Spec | Why this position | Effort |
|---|------|------|-------------------|--------|
| 0 | ✅ Land this doc + CLAUDE.md pointer (docs-only, Fast) — landed by Claude on `claude/sec-r4-handoff` | R4 | — | done |
| 1 | 🟡 PR #1757 — R4-BUG-002 native notification limiter drops critical alerts + false "delivered" traces | R4 | Life-safety alerts lost during bursts | medium |
| 2 | 🟡 PR #1758 + #1759 — R4-BUG-004 sidecar supervisor restart + fallback per Bradley's decision (5xx/connection only, coarsened coordinates) | R4 + Part 1b | A single crash blacks out IPAWS and other feeds for the session | medium-high |
| 3 | 🟡 PR #1760 — R3-BUG-002 datacenter posture freezes on NWS `/points` failure | R3 | Safety-critical, a few lines | low, *cheap* |
| 4 | 🟡 PR #1761 — R4-BUG-005 step 1: one-line TTL/field fixes (GreyNoise weekly, AbuseIPDB 8 h, OpenSky ≥120 s or bbox, NewsAPI 20 min/one query, PurpleAir fields/bbox/60 min) | R4 | Stops today's daily feed blackouts | low, *cheap* |
| 5 | 🟡 PR #1763 — R4-BUG-006 backup/restore scripts read and write the `secrets-vault` item | R4 | Restores the key-loss safeguard; prerequisite for Q16b | low-medium |
| 6 | 🟡 PR #1764 — R4-SEC-002 steps 1-2 (`ignore-scripts` + install-script drift gate) | R4 | Closes the highest-likelihood full-compromise path | medium |
| 7 | 🟡 PR #1765 — R4-SEC-003 + R4-SEC-009 main-sync gate: pinned minimum checks (including the security checks) + pagination | R4 | Fail-open gate on auto-install | low, *cheap* |
| 8 | 🟡 PR #1766 — R4-BUG-001 surface paused iMessage alerts | R4 | Safety comms, small, renderer-only | low-medium |
| 9 | 🟡 PR #1767 — R4-BUG-003 critical alerts bypass master mute (decided) + unify quiet hours | R4 + Part 1b | Safety UX; decision made | low-medium |
| 10 | 🟡 PR #1768 — R4-SEC-001 + R4-SEC-006 sidecar-only secrets write-only to webviews; confirmed-port-only token use | R4 | Largest remaining renderer-compromise payoff | **high** (design gate) |
| 11 | 🟡 PR #1769 — R3-SEC-004 CSP (`unsafe-eval`, `img-src https:`) + R4-SEC-008 remove `crystalball.app` from CSP and links + fix the stale `runtime.ts` comment | R3/R4 | Pairs with Q10; same files | medium-high |
| 12 | 🟡 PR #1770 — R4-BUG-005 step 2: Quota Governor (persisted budgets, header-aware, diagnostics view) | R4 | Makes quota safety durable across restarts | medium |
| 13 | 🟡 PR #1771 — R4-SEC-005 inventory import validation + R3-SEC-009 numeric coercion + R4-LOW-005 | R3/R4 | Untrusted data into `innerHTML` | low-medium, *cheap* |
| 14 | 🟡 PR #1772 — R4-SEC-002 steps 3-6 (cooldown, `audit signatures`, auto-merge skip for sensitive paths, optional sandboxed build) | R4 | Completes supply-chain hardening | medium |
| 15 | 🟡 PR #1773 — R4-SEC-004 MCP untrusted-content envelope + read-only default profile | R4 | Agent prompt-injection containment | medium |
| 16 | 🟡 PR #1774 + #1775 — R3-BUG-001 slice B, then R3-SEC-003 phase A | R3 | Same secret write path; prerequisites for 16b | medium |
| 16b | 🔴 blocked (needs #1763 merged, Bradley's own backup and his go-ahead) — R3-SEC-003 phase B (retire shadow vault) | R3 | Needs Q5 landed + Bradley's go-ahead + his own backup | **high** |
| 17 | 🟡 PR #1776 — R3-SEC-005 release sidecar uses bundled, hash-verified `node` only | R3 | Secret-bearing process integrity | low-medium |
| 18 | 🟡 PR #1777 — R4-LOW-008 durable calibration evidence (design question first) | R4 | Protects the measurement spine | medium |
| 19 | 🟡 PR #1778 — Latent cloud items: R4-SEC-007 + R4-LOW-006 (before any API deployment) | R4 | No API is deployed today (Part 1b) | low-medium |
| 20 | 🟡 PR #1779, #1780, #1781, #1782 — R3-SEC-006/007/008 + R4-LOW-001/002/003/004/007 | R3/R4 | — | low, *cheap* |

**Actions only Bradley can take** (Codex lists these in completion
reports; it does not attempt them):

- **GitHub → Settings → Branches → `main`:** add the required checks listed
  in R4-SEC-009. About 2 minutes.
- **Spend limits** (the only providers here that can charge money):
  - Anthropic Console → Billing → set a monthly limit (for example $10).
  - If you ever buy OpenRouter credits, set a per-key credit limit.
  - If you ever put a card on Groq or subscribe to OpenWeather One Call,
    set their spend/daily limits.
  - Every other key in use is a free tier that hard-stops rather than bills.
    PurpleAir is prepaid points.
- **Back up the vault:** run the interim command in R4-BUG-006 now, and the
  fixed `npm run backup-keys` (from `~/Developer/crystalball`) after Q5.
- **Domain:** decide whether to buy `crystalball.app` or stop using the name
  in links (R4-SEC-008).
- Nothing to do in Vercel: no project is deployed.

## Merge Plan (October 4, 2026)

Bradley's decisions: merge in severity order, Codex reviews locally, and
Claude does the rebases. The queue is done; 30 PRs are open and nothing has
merged since September 28.

### Why The PRs Merge One At A Time

- `main` requires linear history and up-to-date branches (strict checks).
- The required `cross-agent-review` check accepts only a Codex verdict commit
  pinned to the exact tip it reviewed.
- So every merge leaves the next PR out of date, and its rebase needs a fresh
  verdict. Rebasing a later PR early is wasted work: it goes stale at the
  next merge.
- GitHub auto-merge (rebase method) is already on for the PRs based on
  `main`. A PR that is up to date, approved and green merges itself.
- `npm-audit` is not a required check. #1762 still goes first so every later
  run is clean.

### The Cycle For Each PR

1. **Claude rebases** the next PR onto `origin/main`:
   - A stacked PR replays only its own commits:
     `git rebase --onto origin/main <old parent tip>`. Parent tips are
     recorded before each parent merges, because GitHub deletes merged
     branches and retargets their children to `main`.
   - The conflicts that recur in `package.json` scripts and
     `scripts/targeted-tests-overrides.json` (27 PRs touch both) resolve as
     the union of both sides.
   - Claude re-runs the PR's targeted tests and `agentic-validate`, then
     pushes with `--force-with-lease`.
2. **Codex reviews** that tip.
   - Codex may read the PR early. If `git range-diff` shows the rebase changed
     only context, the re-review can be short.
   - The verdict still has to be recorded on the final tip:
     `node scripts/verify-review-verdict.mjs --record --reviewer codex --evidence-file <file>`.
3. **CI merges it.**
   - Once #1772 is merged, a PR that touches sensitive paths needs Bradley's
     `dependency-change-approved` label. Its auto-merge stays off, so Bradley
     merges it himself.
4. **Bradley smoke-tests** where the table asks. Main-sync installs every
   merge on his Mac, so a native or CSP change is live within minutes.

### Order

"On" is the PR each one is stacked on today; after its parent merges, each
one targets `main`.

| Step | PR | Fixes | Severity | On | Bradley |
|---|---|---|---|---|---|
| 1 | #1762 | npm audit advisories | — | main | — |
| 2 | #1764 | R4-SEC-002 steps 1–2 | High | main | review recommended (install policy) |
| 3 | #1772 | R4-SEC-002 steps 3–5 | High | #1764 | review recommended; turns the dependency-change gate on |
| 4 | #1763 | R4-BUG-006 | High | main | then Q16b, with his go-ahead |
| 5 | #1757 | R4-BUG-002 | High | main | smoke: a test alert arrives |
| 6 | #1766 | R4-BUG-001 | Medium | #1757 | smoke: paused iMessage alerts show a notice |
| 7 | #1758 | R4-BUG-004 (A) | High | main | smoke: app launches, sidecar up |
| 8 | #1759 | R4-BUG-004 (B) | High | #1758 | — |
| 9 | #1768 | R4-SEC-001, R4-SEC-006 | High | #1759 | smoke: saved keys still work |
| 10 | #1761 | R4-BUG-005 step 1 | Medium-High | main | — |
| 11 | #1770 | R4-BUG-005 step 2 | Medium-High | #1761 | smoke: quota status in System Diagnostic |
| 12 | #1765 | R4-SEC-003, R4-SEC-009 | Medium | main | label |
| 13 | #1773 | R4-SEC-004 | Medium | main | — |
| 14 | #1771 | R4-SEC-005, R3-SEC-009, R4-LOW-005 | Medium | main | — |
| 15 | #1769 | R3-SEC-004, R4-SEC-008 (CSP) | Medium | #1768 | smoke: map, panels and links load |
| 16 | #1778 | R4-SEC-007, R4-LOW-006 | Medium | #1769 | — |
| 17 | #1783 | H1 constant-time key checks | Low | #1778 | — |
| 18 | #1774 | R3-BUG-001 slice B | — | #1768 | smoke: app unlocks, keys load |
| 19 | #1775 | R3-SEC-003 phase A | — | #1774 | — |
| 20 | #1776 | R3-SEC-005 | — | #1775 | label (Cargo.toml) |
| 21 | #1782 | R3-SEC-008, R4-LOW-007 | Low | #1776 | smoke: map, System Diagnostic, briefing |
| 22 | #1760 | R3-BUG-002 | — | main | — |
| 23 | #1767 | R4-BUG-003 | Low-Medium | main | — |
| 24 | #1781 | R4-LOW-002, R4-LOW-003 | Low | #1772 | label |
| 25 | #1785 | zizmor medium ratchet | Low | #1781 | label |
| 26 | #1779 | R3-SEC-006/007, R4-LOW-004 | Low | main | — |
| 27 | #1780 | R4-LOW-001 | Low | main | — |
| 28 | #1777 | R4-LOW-008 | Low | main | smoke: calibration panel loads |
| 29 | #1784 | H2 forecast store validation | Low | #1777 | — |
| 30 | #1756 | this handoff | — | main | Claude first marks the merged rows ✅ |

Not part of this plan:

- the nine Dependabot PRs (#1747–#1755);
- Codex's conflicting #1695.

---

## Verified — Do Not Reopen

In addition to Round 3's "Already Verified" list:

- R3-SEC-001 updater and R3-SEC-002 iMessage, as described in Part 1.
- Sidecar `/api/local-env-update` is bearer-gated and restricted to
  `ALLOWED_ENV_KEYS` (`local-api-server.mjs:15854-15899`). It cannot set
  arbitrary process env such as `NODE_OPTIONS` or proxy variables.
- Every remaining sync `#[tauri::command]` (`open_url`, `send_notification`,
  `speak_aloud`, `set_dock_badge`, `set_menubar_status`, `update_mode_label`,
  `renderer_heartbeat`, `log_frontend`, …) either spawns without waiting or
  does trivial in-memory work.
- **Scan B, sidecar pre-auth surface** (everything before the auth gate at
  `local-api-server.mjs:7640`):
  - `/api/service-status`
  - `/api/youtube-embed`: strict 11-char `videoId` regex; enum-validated
    params; parent-origin-hardened `postMessage`
  - `/api/patreon/authorize-url` + callback: single-use CSRF `state`;
    tokens posted only to `tauri://localhost`; see R4-LOW-004 for escaping
  - `/api/sms/*`: R3-SEC-006 covers these
  - `/api/health`: counts only, no key names
  - `/api/spaceweather/*`
- **Scan B, other sidecar checks:**
  - No `child_process` / `shell: true` in `local-api-server.mjs`.
  - Upstream fetch instrumentation records **host only**
    (`local-api-server.mjs:1545-1563`); URL query secrets are redacted
    (`redactSecretsInUrl`, `:5233-5260`).
  - Sensitive routes (`local-env-update`, `local-validate-secret`, …) are
    excluded from traffic recording (`:22004-22008`).
  - TAK TLS verification is disabled only via an explicit
    `S2U_TLS_INSECURE_OPT_IN`.
- **Scan B:** SITREP severity and situation forecasting are deterministic
  templates (`situation-forecaster.ts`). No LLM output decides alert severity.
- **Scan A:** there is no fork-PR-reachable workflow injection (see
  R4-LOW-002). Release artifacts carry build-provenance attestations
  (`build-desktop.yml:396-432`).

- **Scan C, renderer message surface:**
  - every `window` `message` listener checks **both** `e.source` and
    `e.origin`: `LiveNewsPanel.ts:412-416`, `LiveWebcamsPanel.ts:450-454`,
    and `S2UndergroundPanel.ts:146-151` via `isTrustedOAuthMessage`;
  - no `lodash.merge` or deep-merge helpers, so no prototype-pollution path
    from persisted or imported JSON;
  - the only user-file import is ResourceInventory (R4-SEC-005).
- **Scan D, notification ladder policy:** in
  `insights/notification-ladder.ts`, quiet hours and attention deferral
  never suppress `emergency`/`critical` tiers (explicit
  `SAFETY_CRITICAL_TIERS` set, `:113-199`). The renderer-side router exempts
  `critical` from its own limiter. The defect is only the native layer
  underneath (R4-BUG-002).

- **Scan E, public API:**
  - the arbitrary-input "oracle" routes (HIBP account lookup, VirusTotal,
    IPinfo, Vulners) are gated by `requireAppAuth`, which fails **closed**
    when `CRYSTALBALL_APP_KEY` is unset (`api/_auth.js`);
  - `claude-agent` and the POST RPCs (`summarize-article`,
    `classify-event`) require a key;
  - no `VITE_*KEY/TOKEN/SECRET` values are read in client code, so none
    are baked into the public bundle;
  - the rate limiter keys on `x-real-ip` / `cf-connecting-ip`, never on
    spoofable `x-forwarded-for`;
  - Vercel security headers (HSTS preload, nosniff, frame-ancestors) are set;
  - Convex stores only interest-registration emails.
- **Scan F, resilience:**
  - no unguarded `JSON.parse(localStorage…)` at any call site, so corrupt
    persisted state can't brick boot;
  - `safeSetItem` evicts only allowlisted cache prefixes under quota
    pressure and never throws;
  - `events.db` has retention pruning;
  - the Rust desktop log rotates on every append (5 MB × 3).
- **Scan G, native:** production Rust code has no unwrap/expect that can
  panic on input (only `CString::new("")`, a constant, and the CSPRNG
  `expect`). The Rust secret injector refuses unconfirmed ports.

---

## Definition Of Done (Round 4)

- No webview can obtain a sidecar-only secret value by IPC or from its own memory.
- Critical notifications are never silently dropped by the native layer;
  every notification trace records the true native outcome.
- Imported or persisted user data is schema-validated before it reaches `innerHTML`.
- A sidecar crash self-heals without an app restart, and no location-bearing
  request ever leaves the machine by fallback.
- Every cost-bearing public route requires a key, whatever the HTTP method,
  and fails closed when rate limiting is unavailable.
- No governed provider exceeds 80% of its documented free quota in a 24 h soak that includes 5 sidecar restarts; quota exhaustion shows as `stale_quota`, never as an all-clear.
- `npm run backup-keys` backs up every key in the `secrets-vault` item, with no plaintext on disk, verified by `--verify`.
- No domain Bradley doesn't own appears in the CSP, `APP_HOSTS`, CORS lists or generated links.
- main-sync never runs a dependency install script outside an explicit allowlist; a new
  install script, a freshly published version, or an emptied required-check list blocks
  the auto-install instead of passing it.
- Crystal Ball MCP output is framed as untrusted data, and the default agent profile
  cannot write app state or calibration feedback.
- A previously-enabled iMessage alert channel can never go quiet without a
  visible "paused" state outside Settings and a trace entry.
- Datacenter posture recomputes, marked degraded, when NWS `/points` fails.
- Both CSPs drop `'unsafe-eval'`, and `img-src` has no scheme-only `https:`.
- Round 3's open items close per their own Definition of Done.
- Every behavior change has a recorded mutation proof. `npm run typecheck:all`,
  `npm run test:sidecar`, `cargo test --manifest-path src-tauri/Cargo.toml`,
  `npm run secrets:scan` and `bash scripts/agentic-validate.sh --tests "<scripts run>"`
  pass, quoted as real output.
