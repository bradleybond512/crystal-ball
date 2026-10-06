# R4-BUG-001: Surface paused iMessage alerts instead of stopping silently

Status: approved by Bradley on September 30, 2026 ("Approve as designed"). Branch
`claude/r4-bug-001-imessage-paused`, stacked on
`claude/r4-bug-002-notify-delivery` (#1757), because the one-time notice uses
its `native-notify.ts`. Classification: Standard+ (alerting path). Queue
item Q8.

## Problem (verified at ea6588a68)

R3-SEC-002 made the native side the only authority for the iMessage
destination. That is correct and stays. But the upgrade path fails silently:

- **After upgrade, sending is off.** Native config is `Missing`, so
  `sendImessage` is disabled. The old localStorage settings
  (`crystalball-imessage-settings`: `enabled: true` plus a recipient) are
  only surfaced inside Settings → General (`UnifiedSettings.loadImessage`).
- **The callers skip silently.**
  - Breaking-news relay (`desktop-notifications.ts`) checks
    `enabled && recipient` and skips.
  - TIER_5 EEW (`eew-imessage.ts`) returns
    `{ status: 'disabled', reason: 'feature_off' }`.

  Nothing is recorded. If Bradley never opens Settings, critical and TIER_5
  EEW iMessages stop with no trace.
- **Canceling erases the evidence.** `configure_imessage` persists the
  `migration_attempted` marker **before** the dialog (`imessage.rs`
  `configure`). If the dialog is canceled or times out,
  `migrationAvailable` flips to false. The renderer's `acceptState` then
  rewrites localStorage to `{ threshold }`, so the channel looks "never
  configured".
- Production callers of `sendImessage`: only the two above.
  `imessage-bridge-extended.ts` has no production caller.

## Design (renderer only; the Rust consent flow is unchanged)

1. **Pause state** in `imessage-bridge.ts`, one source of truth.
   - `getImessagePauseState()` returns `{ paused: false }` or
     `{ paused: true, hint, since }`.
   - Paused when native is ready and **not** enabled, and either:
     - the legacy settings still say `enabled: true` with a recipient
       (migration pending); or
     - a stored pause marker exists (migration attempted but not completed).
   - A **redacted marker** is stored next to `threshold`:
     `paused: { hint, since, notifiedAt? }`.
     - `hint` is `…1234` (the last 4 digits) for a phone number, or
       `b…@me.com` for an email address. The full legacy recipient is still
       deleted once migration is attempted, as today.
   - **Explicit decisions clear it:**
     - a successful user `configure_imessage` (either enabled value);
     - a successful `disable_imessage`;
     - native becoming enabled.

     `acceptState` learns whether a state came from an explicit user action
     or a refresh, so a canceled or timed-out dialog (a refresh) **keeps**
     the pause instead of erasing it.
   - The pause never auto-enables anything. The native dialog stays the only
     way to authorize a destination.
2. **A visible notice outside Settings:** `ImessagePausedNotice`, one
   component mounted in two places.
   - At the top of the Home Shell viewport, which is the default opening
     surface. Its overlay (z 10000) covers the notification stack.
   - In the `NotificationStack`, for classic view.

   It reads: "iMessage alerts are paused. Confirm the recipient (…1234) to
   resume." It has three actions:
   - **Review** opens Settings → General at the iMessage section. The status
     line explains the pause, and the recipient is prefilled when migration
     is still pending.
   - **Keep off** calls `disableImessage()`. That is an explicit native "off"
     with no dialog, and it clears the pause.
   - **Not now** hides the notice for this session only.

   It updates on a `cb:imessage-pause-changed` event.

   Repair cycle 1 (Sol's review of `2b58defee`): the event also fires when
   startup hydration makes an unchanged stored marker reportable. A failed
   Keep off stays visible with its reason while its marker is still stored.
3. **One-time native notification** per pause episode.
   - After boot's `refreshImessageSettings()`, if paused and not yet
     notified, it calls `notifyNative(…, priority 'high')`.
   - `notifiedAt` is recorded only on `delivered`. If the result is
     `rate_limited` or `failed`, it retries at next boot, so nothing is
     marked seen that wasn't delivered (R4-BUG-002 contract).
4. **Trace discarded relays.** `recordPausedImessageRelay({ source, urgency,
   headline })` registers a candidate in the Notification Trace Registry
   (domain `system`) and suppresses it with reason
   `imessage_paused_reauthorization_required`.
   - It is called from the breaking-news relay (threshold met, paused) and
     from TIER_5 EEW (feature on, paused). `recordPaused` is injectable for
     tests.
   - It appears in SystemDiagnostic → Notifications. **Critical-urgency
     relays are marked `safetyCritical`, so they count as "unsafe
     suppressions" in system health.** That is deliberate: a critical
     iMessage really was dropped. It clears once the pause is resolved and
     the entries age out of the summary window.

## Tests (fakes only; mutation proof per behavior)

- Legacy enabled plus native `Missing` gives paused, with the hint and
  without the full recipient in the view.
- Canceled consent (the refresh after a `canceled` result, migration no
  longer available) still gives paused. localStorage holds the hint, never
  the full recipient.
- Confirmed configure (enabled true), explicit configure (enabled false) and
  disable each clear the pause. A plain refresh does not.
- TIER_5 EEW while paused records a trace with the exact reason and
  `safetyCritical`. With the feature off, or not paused, nothing is recorded.
- Breaking news: a critical relay while paused records a trace; a relay
  below the threshold does not.
- One-time notice: `delivered` sets `notifiedAt` and the notice does not
  repeat; `rate_limited` means it tries again next boot.
- The notice component: renders only when paused. Keep off calls
  `disableImessage`. Review opens Settings → General. Not now hides it only
  for the session.

## Out of scope

- Changing the native consent flow or the marker timing in `imessage.rs`.
  Persisting before the dialog is what stops repeated migration prompts, so
  it stays.
- R4-BUG-003 (critical alerts bypass mute, and quiet hours) is queue item Q9.

## Approval requirement

Per AGENTS.md High Assurance rules, implementation starts only after
Bradley approves this design.
