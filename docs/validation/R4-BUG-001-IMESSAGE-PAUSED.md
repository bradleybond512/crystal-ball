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
  - Changes are announced with `cb:imessage-pause-changed`: a marker change,
    or an unchanged stored marker becoming reportable once native state is
    known (repair cycle 1).
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
    shows its reason, and stays visible while the pause marker it could not
    clear is stored, even though the failure leaves native state unknown
    (repair cycle 1).
- **One-time macOS notification**
  (`src/services/notifications/imessage-pause-alerts.ts`):
  - It is sent after boot hydration on the `high` lane.
  - It is marked seen only on `delivered`. Rate-limited, failed or
    unavailable means it is retried next launch.
  - Concurrent callers share one send.
- **Skipped relays are traced.** Breaking-news relays (threshold met) and
  TIER_5 EEW relays (feature on) skipped while paused are registered in the Notification Trace Registry
  (domain `system`) and suppressed with
  `imessage_paused_reauthorization_required`.
  - Critical relays are `safetyCritical`, so they appear as unsafe
    suppressions in SystemDiagnostic → Notifications and in system health.
  - Registry errors are caught, so diagnostics never break the alert path.
  - Relays below the threshold are not counted.
  - A native `disabled` refusal of a send is not traced in practice. The
    bridge invalidates native state on that refusal, so the real pause
    getter reports not paused and nothing is recorded. The caller hooks for
    that path (D4, E2) are proven only with injected dependencies. This is
    outside the approved pause definition (migration and stored markers)
    and is unchanged.
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

This is the September 30 record. Its raw artifacts were not kept, so repair
cycle 1 regenerated every row (see
[Repair cycle 1 mutation proof](#repair-cycle-1-mutation-proof)).

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

## Repair cycle 1 (Sol's review of `2b58defee`)

**Findings (two P2).**

1. **A pause hydrated after the notice mounted stayed hidden.** A stored
   marker is reportable only once native state is known. Startup hydration
   made it reportable without changing the marker, and the bridge announced
   only marker changes, so a notice mounted before hydration never updated.
   With an already-notified marker the in-app notice is the only surface
   left, so the pause was silent on that launch.
2. **A failed Keep off hid its own failure.** `disableImessage()` invalidates
   native state before asking native to disable, and a failed request keeps
   it invalid (sending stays blocked). The pause then stopped being
   reportable, the notice hid itself, and the persistence warning never
   showed.

The isolated notice tests injected a pause getter that stayed `paused: true`,
so neither path was exercised.

**Fix** (`imessage-bridge.ts`, `ImessagePausedNotice.ts`):

- `acceptState` announces when the reportable pause state changes, as well
  as when the marker changes.
- New `hasImessagePauseMarker()` reports whether a valid marker is stored,
  whatever the native state. The notice uses it only to keep a failed
  Keep off visible while the marker it could not clear is still stored. It
  never reports a pause or enables anything.
- Once that pause has ended (the marker is gone), the failure is dropped, so
  a later pause shows its own hint.
- Unchanged:
  - successful explicit decisions clear the pause, and failed or canceled
    ones keep it;
  - Not now stays session-wide, and Review navigates independently;
  - one delivered startup notice, the safety-critical trace contract,
    redaction, and native consent as the only authorization.

**Integration.** The one own commit was replayed, with rerere off, from
`ea6588a68` onto main `d77c1939c`, which carries the merged #1757. There
were no conflicts. `package.json` scripts and the targeted-test overrides
are the exact union of both sides.

### Repair cycle 1 regressions (red first)

The new `src/components/__tests__/imessage-paused-notice-bridge.test.mts`
mounts the real notice against the real bridge. Native IPC and storage are
fakes, and the pause marker persists between steps. It checks that:

- a notice mounted before hydration becomes visible when hydration finds
  sending off and a stored, already-notified marker;
- a failed Keep off (`persistence_failed`) stays visible with the bridge's
  persistence warning, keeps the marker and still blocks sending;
- a Keep off that succeeds after a failure clears the marker and hides
  every mounted copy;
- a failure is dropped once its pause has ended, so a later pause shows its
  own hint.

The file runs in `test:imessage`. Before the fix, on the rebased tree, the
six proof suites plus this file gave:

```text
# tests 86
# pass 82
# fail 4
```

All four new tests failed. The two findings failed with `true !== false`:
"the already-mounted notice shows it" and "the failed decision stays
visible". After the fix: `# tests 86`, `# pass 86`, `# fail 0`. Three more
runs gave the same result.

### Repair cycle 1 validation

These ran in a clean QA worktree at `8fbf91271`, with `npm ci
--ignore-scripts` from that commit's lockfile, on Node 22.23.1:

```text
test:imessage               ℹ pass 6 / ℹ fail 0 ; ℹ pass 108 / ℹ fail 0
test:imessage-native        ℹ pass 1 / ℹ fail 0
test:native-notify          ℹ pass 5 / ℹ fail 0 ; ℹ pass 75 / ℹ fail 0
test:settings               ℹ pass 19 / ℹ fail 0
test:home-reassurance       ℹ pass 27 / ℹ fail 0
test:homeshell              ℹ pass 140 / ℹ fail 0 ; ℹ pass 2 / ℹ fail 0
lint:colors                 OK (within baseline)
eslint (every changed file) 0 problems
```

The production wiring is unchanged and still tested:

- the Home Shell and classic-stack mounts;
- the `wm:open-settings` iMessage deep link and the Settings focus;
- the startup refresh followed by the one-time notice.

The agentic gate runs on the final head, and its output is kept with the
PR evidence.

### Repair cycle 1 mutation proof

The September 30 run kept only its runner and a summary log. It had no
applied diffs, no raw test output and no full checksums, so none of it was
reused. All 38 were regenerated from that runner's own find/replace list.
B9, N1 and N2 were re-targeted to their repaired lines. Six new mutations
cover the repair.

Each mutation ran alone in the QA worktree at `8fbf91271` against the six
proof suites and the real-bridge suite (baseline 86/0 before and after).
Every mutation recorded:

- its applied, non-empty diff;
- the raw TAP output;
- the restored SHA-256;
- a clean status before and after.

All 44 failed the tests, and every file was restored.

| ID | Mutation | Red (pass/fail) |
|---|---|---|
| B1 | refresh treated as an explicit decision | 70/16 |
| B2 | explicit decisions do not end the pause | 83/3 |
| B3 | enabled channel does not end the pause | 84/2 |
| B4 | legacy "off" treated as paused | 85/1 |
| B5 | full recipient kept as hint | 76/10 |
| B6 | consuming migration drops the marker | 70/16 |
| B7 | paused before native hydration | 84/2 |
| B8 | notified time overwritten | 85/1 |
| B9 | pause change not announced (re-targeted) | 82/4 |
| B10 | tampered hint accepted | 85/1 |
| B11 | hint shows 7 digits | 76/10 |
| A1 | traced when not paused | 85/1 |
| A2 | critical skip not safety-critical | 85/1 |
| A3 | reason code changed | 85/1 |
| A4 | marked seen when not delivered | 85/1 |
| A5 | notified again | 85/1 |
| A6 | concurrent notices | 85/1 |
| A7 | registry errors reach the alert path | 85/1 |
| A8 | notice on the critical lane | 85/1 |
| E1 | EEW skip (settings off) not traced | 85/1 |
| E2 | EEW skip (native disabled) not traced | 85/1 |
| D1 | breaking-news skip not traced | 85/1 |
| D2 | below-threshold skip traced | 85/1 |
| D3 | no startup notice | 85/1 |
| D4 | refused send not traced | 85/1 |
| N1 | shown when not paused (re-targeted) | 81/5 |
| N2 | hint rendered as markup (re-targeted) | 85/1 |
| N3 | Not now hides one copy only | 85/1 |
| N4 | buttons stay enabled while Keep off is pending | 85/1 |
| N5 | Keep off failure hidden | 82/4 |
| N6 | Review loses the iMessage target | 85/1 |
| N7 | notice appended, not first | 85/1 |
| N8 | unmount keeps listening | 85/1 |
| W1 | Home Shell mount removed | 85/1 |
| W2 | classic stack mount removed | 85/1 |
| W3 | Settings deep link ignored | 85/1 |
| W4 | Settings ignores the focus request | 85/1 |
| W5 | Settings hides the pause explanation | 85/1 |
| R1 | an unchanged marker made reportable by hydration is not announced | 84/2 |
| R2 | a cleared marker is not announced when the pause was already unreportable | 84/2 |
| R3 | a failed Keep off is hidden once the pause is unreportable | 85/1 |
| R4 | the failure is dropped although the marker is retained | 83/3 |
| R5 | a failure outlives the pause it was about | 85/1 |
| R6 | the retained-marker check never sees the stored marker | 83/3 |

## Rollback

Revert the commit. Paused relays then go back to being silent. Stored
`paused` markers are ignored by the old code and are overwritten the next
time migration is consumed.
