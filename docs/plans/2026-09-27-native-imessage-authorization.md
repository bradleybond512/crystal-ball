# R3-SEC-002: native iMessage authorization

Status: approved by Bradley on September 27 after the concrete design request. Implementation starts from main `f779dcba130b822be55f85adfa12774f4760b10d`, following merged updater PR #1744. Tests use simulated effects; no real messages, native dialogs, Keychain or installed-app operations are authorized.

## Context and evidence

Discovery and brief were recorded before design approval. Code inspected in `.worktrees/acc509-protected-review-20260927` at `769762b5525edefc6ad406f439710ffe9578f634`. Rebase the implementation onto canonical main after the updater is delivered; this design does not authorize concurrent edits to that work.

`src-tauri/src/main.rs:1617` currently accepts renderer recipient/body and never checks native enablement. `src/services/imessage-bridge.ts` treats localStorage enabled/recipient as authority. `src/components/UnifiedSettings.ts:372,523,919` immediately saves those values locally and allows Test to use the unsaved text field. Settings is an overlay in main, so a settings-window label gate would not protect it. `src/app/desktop-notifications.ts:59` routes breaking alerts; `src/services/seismic/eew-imessage.ts` only observes its separate EEW toggle plus recipient; the extended bridge has another two-argument send adapter.

The existing native limiter is separate from desktop notifications despite an outdated comment. Preserve its 30-second interval, 512-byte UTF-8 body cap, AppleScript escaping and explicit iMessage service. The current recipient truncation must be replaced by rejection, because truncation changes the destination the user intended to approve.

Read the canonical usability roadmap: this bounded security repair updates existing settings controls and failure feedback only. It does not implement a new UX-NNN feature or modify prediction/calibration logic.

## Goals and non-goals

Goal: with the trusted renderer compromised, native code cannot send while disabled or to a recipient Bradley has not approved in a native dialog. Native state must remain authoritative through cancellation, persistence failure, migration and races with disable. All three renderer producers use body-only send.

Non-goals: stop arbitrary bodies sent to an already approved recipient while enabled; authenticate renderer alert provenance; change alert thresholds, Ghost Mode, EEW tier policy or retry behavior; modify notification delivery generally; access Keychain/credentials; run Messages or native dialogs during automated tests; add dependencies, capabilities or services.

Risk: High Assurance, privileged outbound messaging. The separate concrete design approval was obtained before code changes.

## Proposed architecture and ownership

Add one small native module, `src-tauri/src/imessage.rs`, containing configuration validation, the authorization state machine and narrow injected filesystem/dialog/send effects. Keep thin trusted-window checked commands and registration in `main.rs` (or register module commands following the existing current-location pattern). Use existing serde/std/Tauri facilities; no new crate, plugin or framework.

Native commands:

- `get_imessage_settings()` — read authoritative enabled/recipient/readiness state; never prompts.
- `configure_imessage(recipient, enabled)` — an untrusted proposed change; validates, obtains native consent when enabling or changing recipient, persists and returns actual native state. No `confirmed`, `approved` or migration-bypass flag accepted from the renderer.
- `disable_imessage()` — no arguments and no confirmation; revokes current native send authorization and invalidates pending consent. It must work even when the editor contains an invalid recipient.
- `send_imessage(body)` — recipient-free; derives destination only from native authorization and refuses disabled/unconfigured/error state. Keep the existing trusted-window check and non-macOS refusal.

All commands involving I/O/subprocesses are async, with synchronous work on `spawn_blocking`. This necessarily fixes the touched send's main-thread blocking without extending into the separate R3-BUG-001 vault/watchdog work.

Module state is one application-owned mutex with current configuration/readiness, a monotonically increasing in-process authorization generation, prompt-in-flight reservation and the existing send rate-limit timestamp. Use narrow effect functions/traits, not a generic workflow engine. Tests instantiate isolated state with fakes; no real singleton startup effects.

## Config schema and storage boundary

Fixed file: `app_config_dir()/imessage.json`, resolved natively. No renderer path. Strict small JSON schema:

`{ version: 1, revision: nonnegative integer, enabled: boolean, recipient: string | null, migrationAttempted: boolean }`

Reject unknown fields/types, unsupported versions, oversized bodies (4 KiB), invalid recipients and `enabled: true` without a recipient. A genuinely missing file defaults to disabled/unconfigured with migration available. Corrupt/unreadable/insecure/symlinked config is an error, remains send-blocked, and must not trigger legacy import. Explicit user-confirmed reconfiguration may repair a malformed config; do not silently reset it.

Persist through a unique `create_new` temporary file in the same app config directory, created mode 0600 before any content, then flush/sync and atomic rename; reject symlink/nonregular targets and unexpected permissions. Never follow a renderer-specified path. Propagate failures and clean up only the temporary file owned by this write. Every send reloads the current native config under the shared authorization lock described below; neither a renderer cache nor an indefinitely cached per-process enabled flag is authority. Increment the persisted revision for each committed native state change; reject overflow rather than wrapping.

0600 limits other-user access; it does not protect against a malicious process with Bradley's own filesystem permissions. Do not claim this repair provides cryptographically protected same-user authorization. Native consent is the boundary against a compromised renderer without arbitrary filesystem access.

## Recipient validation and exact consent

Accept a conservative, explicit ASCII subset with a maximum of 64 bytes, preserving the existing destination bound but rejecting instead of truncating:

- E.164 form: `+` then a nonzero digit and 1–14 further digits; no spaces, punctuation, extensions or contact names.
- Email: one `@`, nonempty local part using ASCII letters/digits and `._%+-`, no leading/trailing/consecutive dots; domain with at least two DNS labels, letters/digits/interior hyphens only, no empty labels or leading/trailing hyphens. Preserve the exact validated spelling; do not lowercase or otherwise rewrite the local part.

Reject controls, leading/trailing whitespace, Unicode, quotes, backslashes, multiple recipients and overlong input. This intentionally does not accept every valid RFC email address; UI states “International phone (+country code) or email, up to 64 characters.” Validation tests define this subset. No network address verification is introduced.

Use `/usr/bin/osascript` with fixed script structure and recipient as a separately supplied argv value for a native `display dialog` (never execute a shell). The dialog displays the entire exact validated address, states whether alerts will be enabled or remain disabled, and explains that alerts/Test use the signed-in Messages account. Buttons are Cancel and Allow; default is Cancel, with a bounded 60-second timeout. Do not include untrusted arbitrary dialog text supplied by the renderer. Only an explicit successful Allow authorizes the immutable captured proposal.

At most one authorization dialog is in flight. Concurrent proposals return Busy. A bounded native prompt cooldown (30 seconds after an attempt) prevents immediate repeated prompts from compromised script; disable always bypasses that cooldown. No dialog appears merely on application startup, a background alert, settings hydration or every keystroke.

## Consent, persistence and concurrency

Beginning a proposal validates the immutable recipient/enabled pair, reserves the single prompt and captures the current authorization generation and persisted revision under the authorization lock. Release the authorization lock while the native dialog is open. Existing authorized sends may continue to the old approved destination unless the user disables them; the pending proposal itself grants nothing.

After Allow, reacquire the authorization lock, reload config and require the captured generation and persisted revision still match. A disable, another committed change or invalidated proposal makes this completion stale; do not persist or authorize it. Atomic persistence must succeed before publishing enabled/new-recipient state. Cancellation, timeout, spawn failure, non-Allow output or write/rename failure cannot authorize the proposed recipient. Release prompt reservation on every exit. A canceled change leaves the last committed native settings in effect, except first migration remains disabled as described below.

Disable acquires the same authorization mutex, increments generation immediately, and marks sending disabled in memory before writing disabled state. This invalidates any open dialog. If persistence fails, keep an in-process send-blocked state and report the failure; do not restore the old enabled state or claim the disable is durable. The UI must say settings could not be saved; an old enabled file may still exist for the next application launch. A successful explicit retry/reconfiguration can clear that error. This limitation is surfaced, not hidden.

Send validates body, then under the authorization lock reloads and checks native readiness, enabled flag and approved recipient and reserves the existing 30-second rate limit. It spawns the fixed Messages AppleScript using that captured destination while still holding the lock, then releases the lock before waiting on the child. Therefore once disable returns successfully, no new send process can start under old authorization. An already started message can complete afterward; it cannot be recalled. Do not hold the lock over a TCC prompt/child wait.

Multiple running app instances must obey the same rule. Pair the in-process mutex with a fixed 0600 app-config-directory advisory lock file for the short reload/commit/send-spawn critical section. Reuse the repository's small BSD flock approach as a local file-lock adapter, without editing updater behavior or adding a crate. A separate nonblocking prompt lock is held across the dialog to enforce single-flight consent across instances while leaving disable available; close/process exit releases it. Use a consistent lock order and bounded acquisition/fail-closed Busy behavior. The persisted revision detects stale consent committed by another instance; the in-process generation additionally detects local failed-disable attempts. Test these through injected independent service instances sharing a fake store/lock. The existing send-rate limit remains per-process as today; this repair does not claim a new cross-process messaging quota.

Wait/timeout work occurs off the main thread. A bounded native wait (30 seconds, kill/reap the script process on timeout) returns an uncertain/failure result without retry; Messages may already have accepted the message. Keep the existing rate-limit reservation behavior on a send attempt, including failures, to avoid retry spam. Disabled/invalid requests do not consume a send attempt. Preserve the body length cap and existing removal of AppleScript-sensitive characters; use fixed argv/script structure for destination. No changes to ordinary `send_notification`.

## One-time legacy migration

LocalStorage enabled/recipient become an untrusted migration suggestion only; threshold remains a local preference. Native missing-config state exposes `migrationAvailable`, but grants no sends.

When Settings opens, populate an editable suggestion from legacy localStorage only if native says the configuration genuinely does not exist. Display “Review previous iMessage settings” and require explicit Save and confirm. Do not silently auto-enable or raise a dialog during background startup.

On the first valid configuration/migration attempt, persist a disabled config with `migrationAttempted: true` before opening the consent dialog. If this write fails, do not prompt. Approval then commits the exact candidate through the ordinary confirmation path. Cancel, timeout or a crash after the marker leaves native disabled and prevents repeated automatic legacy suggestions/prompts. Subsequent explicit configuration still works and requires consent as appropriate. Presence/corruption of existing native config never falls back to localStorage, and legacy enabled/recipient cannot become authoritative after IPC failure.

After native state confirms migration consumed (including cancellation), remove legacy enabled/recipient from the renderer record while preserving threshold. Do not claim migration completed solely because localStorage was cleared. No secrets or Keychain items are moved or deleted.

## Renderer and settings flow

`imessage-bridge.ts` splits local threshold storage from asynchronously hydrated native configuration. A cached native view may support synchronous producer hints, but defaults to disabled/not-ready until native hydration succeeds. All sends call body-only IPC, which rechecks authority. Typed outcomes retain `{ ok, reason }` compatibility and add finite failure codes where needed to distinguish disabled, unavailable, busy, canceled, stale consent and persistence failure. No local fallback to enabled on IPC error.

Settings renders current native state after hydration. Enable/recipient editing forms a draft; explicit **Save and confirm** submits it. Recipient change/blur and toggling on do not immediately prompt or persist. Toggling off immediately calls `disable_imessage`, even while a confirmation is pending. While pending, disable stays available but repeated Save/Test are disabled. Cancel/error restores or displays the actual native state rather than a checked optimistic toggle. Late responses must be tied to the current component/request generation, so closing/reopening Settings or disabling cannot be overwritten by an older response.

Test sends only to the saved, natively confirmed recipient and only when native enabled/ready. It never consumes the draft text field. Disable Test while there are unsaved recipient/enable changes, and identify the saved destination next to it so the user cannot mistake a draft address for the test target. Status feedback uses textContent, a polite live region and native-error-safe copy. Retain existing keyboard focus/overlay behavior; no new settings surface or broad layout redesign.

`src/app/desktop-notifications.ts` keeps Ghost Mode, breaking-alert settings and local threshold gates, then sends body only. Initialize native settings through the desktop bridge/module lifecycle; failure leaves routing disabled. Do not require opening Settings before previously saved native configuration becomes usable.

`seismic/eew-imessage.ts` keeps its EEW master toggle, TIER_5 restriction, body cap and no-retry outcomes, and additionally respects authoritative general native enablement/readiness. Dependencies/tests change to body-only send. Native-disabled maps to its disabled outcome; operational failures remain failed. `notifications/imessage-bridge-extended.ts` changes its adapter to body-only; its existing recipient field can remain a local eligibility hint if needed by pure routing compatibility, but is never sent through IPC and never overrides native authority. Avoid unrelated threat-list policy changes.

## Tests, evidence and bounded ownership

Native specialist owns `src-tauri/src/imessage.rs`, thin `main.rs` wiring/old send removal, and `src-tauri/tests/imessage_contract.rs` using the existing standalone current-location contract pattern. UI specialist owns `imessage-bridge.ts`, `UnifiedSettings.ts`, `src/app/desktop-notifications.ts`, both seismic/extended callers and their focused tests. A test specialist/parent owns cross-file command-source guards and mutation evidence; coordinate shared test edits. No other native/security files are in scope.

Use only fake dialog/spawn/wait/clock/storage outcomes and temporary synthetic config directories. Tests must never start the app, run osascript, access Messages, read real app config, call Keychain or send a message.

Required behavior coverage:

- Missing, disabled, corrupt, unreadable, symlinked and invalid config refuse sends with zero spawn effects; valid configured send uses only the native destination.
- Exact phone/email boundaries, no truncation, injection/control/contact-name/multiple-recipient rejection; the displayed address equals the saved and sent address.
- Native confirmation is required for enable or recipient change; same unchanged enabled configuration does not create unnecessary prompts; explicit disable requires none.
- Cancel, timeout, spawn failure, unexpected dialog output, stale generation and persistence failure cannot authorize. Pending prompt plus successful disable cannot later re-enable.
- Controlled fake barriers prove send-start-before-disable ordering and zero starts after disable succeeds, including two native service instances sharing config/locks. The second instance rereads disabled state and cannot send from a stale cache. Child wait does not hold the authorization lock; existing in-flight completion is reported honestly. Concurrent process consent is Busy, and persisted revision invalidates a dialog after another instance changes config.
- 0600 from file creation, atomic replacement, no leaked temporary files, strict schema and capped read; disable-write failure blocks the current process and surfaces nondurability.
- First migration marker precedes consent; cancel/crash/failed confirmation does not repeat import; corrupt native config never migrates; threshold survives cleanup.
- Bridge hydration failure stays disabled, sends omit recipient, and old localStorage values cannot authorize. UI Save vs blur, Test with draft/disabled state, cancellation, late response and immediate disable behavior.
- Breaking thresholds/Ghost Mode unchanged; EEW disabled/general-native-disabled outcomes, body-only send and no retry; extended policy remains unchanged except destination authority.
- Source guard verifies no native send signature/call accepts recipient, all new commands retain trusted-window guards, and no renderer approval flag exists.

Run targeted `cargo test --test imessage_contract`, focused bridge/settings/EEW/extended tests, then the relevant existing `test:seismic` and `test:notifications` scripts. Add a narrowly scoped `test:imessage` script for the new tests, and run `npm run typecheck:all`, `npm run secrets:scan`, and `bash scripts/agentic-validate.sh --tests "test:imessage test:seismic test:notifications"`. Full cargo/sidecar and other required project/CI gates follow the round's completion requirements after confirming tests have no real credential effects. Quote actual results; no tests have been run by this design task.

Mutation proofs must start clean, record checksums, inspect applied diffs, capture exact red counts/assertions, restore checksums/status. At minimum remove the enabled guard, native destination ownership, confirmation requirement, generation check, persist-before-enable ordering, disable/send serialization, migration marker and renderer hydration/Test guard individually; each relevant test must fail. Retain real before/after numbers, not assertions of coverage.

No provider live probe, prediction replay or scientific benchmark applies. Validate that added code does not violate the bundle budget, and use deterministic fake waits to prove no main-thread blocking/mutex-held child wait rather than a fragile wall-clock test.

## Alternatives, migration and rollback

Settings-window-only authorization is rejected: the current overlay lives in main. Renderer confirm/localStorage flags are rejected because the renderer is the attacker. Immediate per-keystroke native prompting is rejected for usability and prompt fatigue. Keychain storage, new dialog plugins and a general permission framework are unnecessary for the bounded fix.

Persisted local threshold stays compatible. Old recipient/enabled values become suggestions once, never a fallback. Native config version 1 requires no other migration and does not touch secrets. Conservative address validation may require Bradley to replace an old contact name with an explicit phone/email; show that directly rather than silently truncating or changing the recipient.

Rollback must keep native sending disabled/body-only authorization intact: disable the feature or forward-fix the new code. Do not restore arbitrary renderer-recipient IPC as a convenience rollback. No installed-app test or actual test message is included; any later native confirmation/manual send verification is a separate Bradley action.

## Approved scope

Approve the bounded R3-SEC-002 repair: native 0600 enabled/recipient configuration, body-only send, explicit Save with exact-recipient native confirmation, immediate disable that invalidates pending consent, one-time opt-in legacy migration, and fake-effect regression/mutation tests. Preserve local alert thresholds and the existing native 30-second send limit. No real messages, Keychain operations or installation.

Separate approval is required by `AGENTS.md:121`: “High-assurance work must stop for human approval after discovery and design, before production implementation.” The Round 3 handoff explicitly repeats this per-production-item gate. Updater/performance approvals do not authorize this distinct outbound-messaging change.

## Frozen iMessage IPC contract

Native command success: get_imessage_settings(), configure_imessage({recipient:string,enabled:boolean}), disable_imessage() -> {enabled:boolean,recipient:string|null,ready:boolean,migrationAvailable:boolean}. send_imessage({body:string}) -> null/void.

Native Result rejection: {code: unavailable | invalid_recipient | invalid_body | disabled | busy | canceled | stale_consent | persistence_failed | rate_limited | send_failed | send_uncertain}. No arbitrary exception text shown. Missing native config returns ready true, enabled false, recipient null, migrationAvailable true. Failed reads authorize nothing. Refresh after canceled configuration observes whether migration was consumed. No renderer path, confirmation or migration-bypass argument.
