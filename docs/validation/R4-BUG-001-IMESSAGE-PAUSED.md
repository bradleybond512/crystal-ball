# R4-BUG-001 validation — paused iMessage relays are visible, never silent

Validated September 30, 2026 on branch `claude/r4-bug-001-imessage-paused`.
It is stacked on #1757 (`claude/r4-bug-002-notify-delivery`, `ea6588a68`)
for `native-notify.ts`. Approved design:
[plan](../plans/2026-09-30-r4-bug-001-imessage-paused.md).

## Behavior

- **Pause state** (`src/services/imessage-bridge.ts`):
  - `getImessagePauseState()` reports paused only when native state is
    known (`ready`), sending is off, and a pause marker exists.
  - The marker is written the first time a refresh sees legacy settings
    with `enabled: true` and a recipient. That happens while migration is
    pending, or once it has been consumed.
  - The marker stores only a redacted hint: `…1234`, or `b…@domain` for an
    email address. The full legacy recipient is still deleted once
    migration is consumed, as before.
  - Stored markers must match the exact redacted shapes. Anything else is
    treated as tampering and ignored.
  - Refreshes never end a pause, including the refresh after a canceled or
    timed-out dialog. These do end it:
    - a natively confirmed configure (on or off);
    - a disable;
    - a refresh that finds sending enabled.

    The bridge now tells refreshes apart from these explicit user actions.
  - Changes are announced with `cb:imessage-pause-changed`.
- **Visible notice** (`src/components/ImessagePausedNotice.ts`):
  - It reads "iMessage alerts are paused. Confirm the recipient (…1234) to
    resume." The text is set with `textContent` only.
  - It is mounted first in the Home Shell viewport, the default opening
    surface, which covers the notification stack. It is also mounted in the
    `NotificationStack` for classic view.
  - **Review** opens Settings → General and focuses the iMessage recipient
    once loaded. Settings explains the pause with the hint and prefills
    nothing from it.
  - **Keep off** is an explicit native disable, with no dialog.
  - **Not now** hides every copy for this session.
  - All buttons are disabled while Keep off is pending. A failed Keep off
    shows its reason.
- **One-time macOS notification**
  (`src/services/notifications/imessage-pause-alerts.ts`):
  - It is sent after boot hydration on the `high` lane.
  - It is marked seen only on `delivered`. Rate-limited, failed or
    unavailable means it is retried next launch.
  - Concurrent callers share one send.
- **Skipped relays are traced.** Breaking-news relays (threshold met) and
  TIER_5 EEW relays (feature on) skipped while paused, including a native
  `disabled` refusal, are registered in the Notification Trace Registry
  (domain `system`) and suppressed with
  `imessage_paused_reauthorization_required`.
  - Critical relays are `safetyCritical`, so they appear as unsafe
    suppressions in SystemDiagnostic → Notifications and in system health.
  - Registry errors are caught, so diagnostics never break the alert path.
  - Relays below the threshold are not counted.
- **Nothing enables sending.** The native consent dialog remains the only
  authorization. `imessage.rs` is unchanged.
- Two existing bridge tests change expectations on purpose. Consuming
  migration now leaves `{ threshold, paused: { hint } }` instead of
  `{ threshold }`, and they assert that the full recipient is absent.

## Actual validation

All tests use fakes only: no real Keychain, Messages or native IPC.

| Suite | Result (Bradley's Mac) |
|---|---|
| `test:imessage` | 6/6 (node) + 104/104 (tsx) |
| Proof suites | 82/82 (bridge, desktop relay, EEW, pause alerts, notice, Settings) |
| `test:native-notify` | 5/5 + 55/55 |
| `test:settings` | 19/19 |
| Home Shell | 28/28 (reassurance + startup readiness) |

- `tsc --noEmit` is clean. ESLint on every changed file is clean, and
  `lint:colors` is within its baseline (no new color literals).
- Agentic gate: see the PR description.

## Mutation proof

Each mutation was applied alone against the 6 proof suites (baseline 82/0
before and after). The table records the SHA-256 prefix of the file before
mutating. Every file was restored and its hash re-verified.

| # | Mutation | File (sha before) | Pass/fail | Red test(s) |
|---|---|---|---|---|
| B1 | refresh treated as an explicit decision | `imessage-bridge.ts` (`d4956f60ed35`) | 70/12 | a canceled or timed-out consent stays paused instead of looking never configured; a pause that began after migration was consumed still records the hint; a stored pause is not reported until native state is known; a well-formed stored hint is accepted; an expl |
| B2 | explicit decisions do not end the pause | `imessage-bridge.ts` (`d4956f60ed35`) | 80/2 | an explicit confirmed configure (off) ends the pause; an explicit disable ends the pause |
| B3 | enabled channel does not end the pause | `imessage-bridge.ts` (`d4956f60ed35`) | 80/2 | a refresh that finds native sending enabled ends the pause; pause changes are announced and tampered markers are ignored |
| B4 | legacy "off" treated as paused | `imessage-bridge.ts` (`d4956f60ed35`) | 81/1 | legacy settings that were off are not paused |
| B5 | full recipient kept as hint | `imessage-bridge.ts` (`d4956f60ed35`) | 72/10 | a canceled or timed-out consent stays paused instead of looking never configured; a pause that began after migration was consumed still records the hint; an explicit confirmed configure (off) ends the pause; an explicit confirmed configure (on) ends the pause; |
| B6 | consuming migration drops the marker | `imessage-bridge.ts` (`d4956f60ed35`) | 70/12 | a canceled or timed-out consent stays paused instead of looking never configured; a pause that began after migration was consumed still records the hint; a stored pause is not reported until native state is known; a well-formed stored hint is accepted; an expl |
| B7 | paused before native hydration | `imessage-bridge.ts` (`d4956f60ed35`) | 81/1 | a stored pause is not reported until native state is known |
| B8 | notified time overwritten | `imessage-bridge.ts` (`d4956f60ed35`) | 81/1 | the pause notice is marked seen once and survives refreshes |
| B9 | pause change not announced | `imessage-bridge.ts` (`d4956f60ed35`) | 81/1 | pause changes are announced and tampered markers are ignored |
| B10 | tampered hint accepted | `imessage-bridge.ts` (`d4956f60ed35`) | 81/1 | pause changes are announced and tampered markers are ignored |
| B11 | hint shows 7 digits | `imessage-bridge.ts` (`d4956f60ed35`) | 72/10 | a canceled or timed-out consent stays paused instead of looking never configured; a pause that began after migration was consumed still records the hint; an explicit confirmed configure (off) ends the pause; an explicit confirmed configure (on) ends the pause; |
| A1 | traced when not paused | `imessage-pause-alerts.ts` (`2b9d84f3e034`) | 81/1 | nothing is recorded when iMessage is not paused |
| A2 | critical skip not safety-critical | `imessage-pause-alerts.ts` (`2b9d84f3e034`) | 81/1 | a critical relay skipped while paused is an unsafe suppression |
| A3 | reason code changed | `imessage-pause-alerts.ts` (`2b9d84f3e034`) | 81/1 | the reason is the documented, stable code |
| A4 | marked seen when not delivered | `imessage-pause-alerts.ts` (`2b9d84f3e034`) | 81/1 | the pause notice is marked seen only when macOS delivered it |
| A5 | notified again | `imessage-pause-alerts.ts` (`2b9d84f3e034`) | 81/1 | no notice when not paused or already notified |
| A6 | concurrent notices | `imessage-pause-alerts.ts` (`2b9d84f3e034`) | 81/1 | concurrent callers share one notice |
| A7 | registry errors reach the alert path | `imessage-pause-alerts.ts` (`2b9d84f3e034`) | 81/1 | a failing registry never breaks the alert path |
| A8 | notice on the critical lane | `imessage-pause-alerts.ts` (`2b9d84f3e034`) | 81/1 | the notice names the redacted hint, the way to resume, and a non-critical lane |
| E1 | EEW skip (settings off) not traced | `eew-imessage.ts` (`e8672f227c30`) | 81/1 | TIER_5 with the feature on but iMessage off records the skipped relay |
| E2 | EEW skip (native disabled) not traced | `eew-imessage.ts` (`e8672f227c30`) | 81/1 | TIER_5 refused by the native side as disabled records the skipped relay |
| D1 | breaking-news skip not traced | `desktop-notifications.ts` (`4725c838e9ab`) | 81/1 | a relay skipped because iMessage is off is traced, not silent |
| D2 | below-threshold skip traced | `desktop-notifications.ts` (`4725c838e9ab`) | 81/1 | a relay skipped because iMessage is off is traced, not silent |
| D3 | no startup notice | `desktop-notifications.ts` (`4725c838e9ab`) | 81/1 | startup tells the user once about a paused channel, after hydration |
| D4 | refused send not traced | `desktop-notifications.ts` (`4725c838e9ab`) | 81/1 | a send refused as disabled is traced; other failures are not |
| N1 | shown when not paused | `ImessagePausedNotice.ts` (`f732805a6977`) | 80/2 | Keep off records an explicit off and disables the buttons while pending; hidden when iMessage is not paused |
| N2 | hint rendered as markup | `ImessagePausedNotice.ts` (`f732805a6977`) | 81/1 | the hint is rendered as text, never markup |
| N3 | Not now hides one copy only | `ImessagePausedNotice.ts` (`f732805a6977`) | 81/1 | Not now hides every copy for this session only |
| N4 | buttons stay enabled while Keep off is pending | `ImessagePausedNotice.ts` (`f732805a6977`) | 81/1 | Keep off records an explicit off and disables the buttons while pending |
| N5 | Keep off failure hidden | `ImessagePausedNotice.ts` (`f732805a6977`) | 81/1 | a failed Keep off shows the reason and keeps the notice |
| N6 | Review loses the iMessage target | `ImessagePausedNotice.ts` (`f732805a6977`) | 81/1 | the default Review opens Settings → General → iMessage |
| N7 | notice appended, not first | `ImessagePausedNotice.ts` (`f732805a6977`) | 81/1 | shown first in its host with the redacted hint and three actions |
| N8 | unmount keeps listening | `ImessagePausedNotice.ts` (`f732805a6977`) | 81/1 | unmount removes the notice and stops listening |
| W1 | Home Shell mount removed | `HomeShellOverlay.ts` (`6aeb0423b3a7`) | 81/1 | wired into the Home Shell, the classic stack and the Settings deep link |
| W2 | classic stack mount removed | `main.ts` (`c013781e4413`) | 81/1 | wired into the Home Shell, the classic stack and the Settings deep link |
| W3 | Settings deep link ignored | `panel-layout.ts` (`14cc7750dde4`) | 81/1 | wired into the Home Shell, the classic stack and the Settings deep link |
| W4 | Settings ignores the focus request | `UnifiedSettings.ts` (`f8e366f7a36d`) | 81/1 | the paused notice deep link focuses the iMessage recipient once loaded |
| W5 | Settings hides the pause explanation | `UnifiedSettings.ts` (`f8e366f7a36d`) | 81/1 | a pause with no legacy recipient explains itself with the redacted hint |

All 38 mutations went red, and every file was restored to its original hash.

A first run left 2 survivors, and both were fixed before this table:

- **Readiness gate.** The test only covered "no marker yet". A test now
  shows that a stored pause stays unreported before hydration and when
  native state is unknown.
- **Keep-off busy guard.** It was redundant with the disabled buttons, so
  it was removed. The disabled buttons are what the test pins (N4).

## Rollback

Revert the commit. Paused relays then go back to being silent. Stored
`paused` markers are ignored by the old code and are overwritten the next
time migration is consumed.
