# R4-BUG-003 validation — critical alerts bypass mute; one quiet-hours rule

Original author validation reported September 30, 2026 on branch `claude/r4-bug-003-mute-quiet-hours`
(base `a255546ee`). Approved design:
[plan](../plans/2026-09-30-r4-bug-003-mute-quiet-hours.md).

## Behavior

- **Master mute lets critical through.**
  - `evaluateNotificationPreference` returns `master-mute` only for
    non-critical alerts.
  - The alert-trace explanation and the Notification Settings label ("Mute
    notifications (critical alerts still come through)") say so.
  - A per-domain "off" and Ghost Mode still silence critical alerts. Both
    are explicit and scoped.
- **One rule** (`src/services/notifications/quiet-hours.ts`):
  - Times must be strict `HH:MM`.
  - The start is inclusive and the end exclusive. A start later than the
    end wraps past midnight.
  - **A malformed, blank or equal window is never quiet.** That fails toward
    delivery; equal and blank used to mean 24 h of quiet.
  - Times are local wall-clock, so DST days follow the clock.
  - The dispatcher preference check, the alert-trace explanation and the
    weather ladder (`ladderQuietHours`) all use this rule.
- **One store:** the Notification Settings window (`wm-notification-settings-v1`)
  plus each domain's toggle.
  - `updateGlobalSettings` refuses `invalid` or `equal` windows, keeps the
    old value and does not announce a change.
  - The panel saves the start and end as a pair and shows "Not saved: …"
    while a draft is refused, so moving one end past the other never stores
    a bad window.
- **The Notification Preferences panel** shows the window read-only ("Quiet
  hours 22:00–07:00 · on for N domains") with "Edit in Notification
  Settings". Its own quiet-hours inputs and its "QH override" column are
  removed.
  - That column could not map cleanly: its domains `sanctions` and
    `intelligence` have no counterpart in the canonical store.
  - Weather's toggle in Notification Settings is the per-domain switch.
- **Migration** (once; marked with `wm-quiet-hours-unified-v1`):
  - An enabled Preferences window moves into weather only (`HH:00`), unless
    weather was overridden there, the shared window already serves another
    domain, or the hours are unusable. Equal hours used to mean 24 h quiet;
    they are dropped, toward delivery.
  - No domain gains silence.
- **Dead stores:** the readers of `wm-quiet-hours` (dispatcher) and
  `crystalball-quiet-hours-v1` (alert reactions) are removed. Nothing in the
  app wrote either key, so a stale value from an old build now silences
  nothing.
- **Existing tests whose expectations change on purpose:**
  - "critical alerts still respect master-mute" in 3 suites;
  - "00:00–00:00 means all-day quiet";
  - the `legacy-quiet-hours` dispatcher gate;
  - the weather wiring test, now on the canonical store.

## Historical author validation

The following results and mutation table are preserved historical author
claims. Their September 30 raw artifacts were not supplied or independently
audited in the October 9 work. All reported tests use fakes and in-memory storage.

| Suite | Result (Bradley's Mac) |
|---|---|
| `test:quiet-hours` (new: shared table, panels, migration, plus the 5 updated suites) | 117/117 |
| Proof run (`test:quiet-hours` files + `all-producers` integration) | 163/163 |
| `test:notifications` | 227/227 after the integration-test update |
| `test:insights` | 132/132 |
| `adaptive-cadence` (alerting-prefs consumer) | 5/5 |

- `tsc --noEmit` is clean. ESLint is clean on every changed source file.
  `lint:colors` is within its baseline.
- The original text reported an undefined ESLint-rule directive in
  `notification-panels.test.mts`. Original branch tip `efa5694a1` removes that
  directive; the October 9 changed-file ESLint run passes, including `.mts` files.
- Agentic gate: see the PR description.

## Historical mutation table

Each mutation was applied alone against the 8 proof suites (baseline 163/0
before and after). The table records the SHA-256 prefix of the file before
mutating. Every file was restored and its hash re-verified.

| # | Mutation | File (sha before) | Pass/fail | Red test(s) |
|---|---|---|---|---|
| Q1 | equal window is 24 h quiet | `quiet-hours.ts` (`07980f3a6d50`) | 161/2 | the dispatcher preference check and the ladder follow the same table; the pure rule matches the table |
| Q2 | lenient time parsing | `quiet-hours.ts` (`07980f3a6d50`) | 158/5 | invalid and equal windows are refused at save time and the old window is kept; the alert-trace explanation follows the same table; the dispatcher preference check and the ladder follow the same table; the pure rule matches the table; time parsing is strict |
| Q3 | end inclusive | `quiet-hours.ts` (`07980f3a6d50`) | 160/3 | the alert-trace explanation follows the same table; the dispatcher preference check and the ladder follow the same table; the pure rule matches the table |
| Q4 | overnight window not wrapped | `quiet-hours.ts` (`07980f3a6d50`) | 155/8 | badge delivery still respects domain-quiet-hours before the cooldown; evaluateNotificationPreference suppresses non-critical inside the quiet window; non-safety weather alert is SUPPRESSED inside the window when weather quiet hours are on; quiet-hours fails wh |
| Q5 | validation allows equal | `quiet-hours.ts` (`07980f3a6d50`) | 158/5 | evaluateNotificationPreference suppresses non-critical inside the quiet window; invalid and equal windows are refused at save time and the old window is kept; migration never adds silence; the quiet window saves as a pair; a refused draft stays with its reason |
| Q6 | UTC instead of wall clock | `quiet-hours.ts` (`07980f3a6d50`) | 161/2 | DST days follow the wall clock; the dispatcher preference check and the ladder follow the same table |
| Q7 | hour 24 accepted | `quiet-hours.ts` (`07980f3a6d50`) | 162/1 | time parsing is strict |
| S1 | mute blocks critical | `notification-settings-service.ts` (`0a4ea781ad49`) | 158/5 | critical alerts come through a forgotten master mute; others do not (R4-BUG-003); master mute lets critical through; the trace says so; settings: shouldNotify respects masterMute except for critical (R4-BUG-003); settings:shouldNotify — master mute suppresses |
| S2 | equal window saved | `notification-settings-service.ts` (`0a4ea781ad49`) | 160/3 | evaluateNotificationPreference suppresses non-critical inside the quiet window; invalid and equal windows are refused at save time and the old window is kept; the quiet window saves as a pair; a refused draft stays with its reason |
| S3 | save-time validation skipped | `notification-settings-service.ts` (`0a4ea781ad49`) | 160/3 | evaluateNotificationPreference suppresses non-critical inside the quiet window; invalid and equal windows are refused at save time and the old window is kept; the quiet window saves as a pair; a refused draft stays with its reason |
| S4 | domain toggle ignored | `notification-settings-service.ts` (`0a4ea781ad49`) | 142/21 | a badge during banner cooldown does not reset its exact two-minute expiry; a silent action neither delivers nor reserves a banner slot; a stale legacy wm-quiet-hours value no longer silences anything (R4-BUG-003); an advisory badge does not suppress a followin |
| S5 | critical no longer bypasses quiet hours | `notification-settings-service.ts` (`0a4ea781ad49`) | 160/3 | critical alerts bypass quiet hours and an active source cooldown; evaluateNotificationPreference lets critical through inside the quiet window; settings:shouldNotify — quiet hours never suppresses critical |
| S6 | ladder bypass always on | `notification-settings-service.ts` (`0a4ea781ad49`) | 161/2 | non-safety weather alert is SUPPRESSED inside the window when weather quiet hours are on; the dispatcher preference check and the ladder follow the same table |
| S7 | migration ignores the weather override | `notification-settings-service.ts` (`0a4ea781ad49`) | 162/1 | migration never adds silence |
| S8 | migration overwrites a window in use | `notification-settings-service.ts` (`0a4ea781ad49`) | 162/1 | migration never adds silence |
| S9 | migration runs every start | `notification-settings-service.ts` (`0a4ea781ad49`) | 162/1 | migration carries the Preferences window into weather only, once |
| S10 | migration quiets another domain | `notification-settings-service.ts` (`0a4ea781ad49`) | 162/1 | migration carries the Preferences window into weather only, once |
| S11 | migration keeps equal hours | `notification-settings-service.ts` (`0a4ea781ad49`) | 162/1 | migration never adds silence |
| T1 | trace hides the invalid-window rule | `alert-trace.ts` (`63a5acb3d5a4`) | 162/1 | the alert-trace explanation follows the same table |
| T2 | trace says mute blocks critical | `alert-trace.ts` (`63a5acb3d5a4`) | 162/1 | master mute lets critical through; the trace says so |
| D1 | legacy key read again | `notification-dispatcher.ts` (`c0a2f2408105`) | 161/2 | a stale legacy wm-quiet-hours value no longer silences anything (R4-BUG-003); the unwritten legacy quiet-hours stores have no readers left |
| A1 | legacy reaction override read again | `alerting-prefs.ts` (`e72d93d8f222`) | 162/1 | the unwritten legacy quiet-hours stores have no readers left |
| L1 | weather ladder reads another domain | `data-loader.ts` (`366796545ddc`) | 162/1 | the unwritten legacy quiet-hours stores have no readers left |
| P1 | mute label hides the bypass | `NotificationSettingsPanel.ts` (`15d563a5e29a`) | 162/1 | the mute control says critical alerts still come through |
| P2 | window saved one field at a time | `NotificationSettingsPanel.ts` (`15d563a5e29a`) | 162/1 | the quiet window saves as a pair; a refused draft stays with its reason |
| P3 | refusal not shown | `NotificationSettingsPanel.ts` (`15d563a5e29a`) | 162/1 | the quiet window saves as a pair; a refused draft stays with its reason |
| P4 | refusal messages swapped | `NotificationSettingsPanel.ts` (`15d563a5e29a`) | 161/2 | refusal messages; the quiet window saves as a pair; a refused draft stays with its reason |
| P5 | Preferences link opens the wrong panel | `NotificationPreferencesPanel.ts` (`f5690959ebc9`) | 162/1 | the Preferences panel shows the one window read-only and links to it |
| P6 | Preferences summary goes stale | `NotificationPreferencesPanel.ts` (`f5690959ebc9`) | 162/1 | the Preferences panel shows the one window read-only and links to it |

The original author reported all 29 mutations red on the first run and every
file restored to its original hash. This is not fresh execution evidence.

## October 9 isolated integration and regression evidence

Original head `efa5694a1e1b0f8abb74b3231106096380e0535f` was unchanged.
Its two commits were replayed in an independent clone onto canonical main
`6a5ea9eed4970fe0b050e5e0587fb830af3a7383`. The only textual conflict was
`scripts/targeted-tests-overrides.json`: an additive union preserves every main
mapping, including `test:ux059` for data-loader. Main's package scripts,
dependencies, lockfile and successful native-delivery fixture remain intact.
The original worktree and refs were not edited.

The preliminary P2 parser finding was **disproved by actual execution**.
The existing JavaScript regex has no multiline flag and already rejects a
terminal LF, CR, CRLF, U+2028 or U+2029 at either endpoint. ECMAScript's
[`$` assertion](https://tc39.es/ecma262/multipage/text-processing.html#sec-compileassertion)
admits a line terminator only with the multiline flag. No production parser
change was made, and no redundant length guard is credited as a repair.

Codex added malformed-input regression coverage for both endpoints, strict
parsing, atomic save refusal (settings identity/content, stored bytes, write
count and event count), allowed noncritical preference decisions, inactive
ladder inputs and truthful passing traces. The unchanged parser passed these
tests before any production change. The executor log named
`test-first-red-approved` therefore records **GREEN 120/0**, not RED.

Fresh results for the integrated code follow. The full gate and mutation proofs
ran at code-proof commit `ef343d22d8d30cb288a76d05ef7e552650b03608`.
Initial individual targeted checks, including adaptive-cadence, ran before
that commit with the same production code and the added test working tree:

```text
npm run test:quiet-hours: # pass 120; # fail 0
npm run test:notifications: # pass 227; # fail 0
npm run test:insights: # pass 132; # fail 0
npm run test:native-notify: # pass 5; # fail 0; # pass 75; # fail 0
adaptive-cadence (node --import tsx --test): # pass 5; # fail 0
proof suite (quiet-hours files plus all-producers): # pass 166; # fail 0
Secret scan passed for 4993 file(s).
Agentic validation gate passed.
```

The gate command was `bash scripts/agentic-validate.sh --tests
"test:quiet-hours test:notifications test:insights test:native-notify"`.
It ran lockfile, strict lint, both TypeScript configs, secrets, the cross-agent
diagnostic, docs, roadmap and build. All changed TypeScript and `.mts` files
also passed the ESLint runner. Nonfatal build warnings remain in the raw log.
Normal pre-commit conflict, staged-secret and typecheck hooks passed. An initial
default-sandbox tsx IPC error occurred before tests; an approved escalation
ran the same test script successfully. There was no approval-review denial.

### Fresh mutation equivalents

Thirty unique mutations were executed against the clean code-proof commit:
fresh equivalents of Q1–Q7, S1–S11, T1–T2, D1/A1/L1 and P1–P6, plus M1.
Each retained an actual applied diff, raw TAP assertion RED, full checksums and
a clean exact restoration. The proof suite was **166 pass / 0 fail** before
and after. These reproduce behavior obligations, not historical run identity.

M1 adds the `m` flag to the existing parser deliberately. It produces
**159 pass / 7 fail**, including parser, atomic-save, delivery/ladder and trace
regressions, then restores to **166 pass / 0 fail**. This proves test sensitivity;
it is not removal of a newly authored production fix. A1 and L1 are source
wiring assertions; D1 includes both runtime and source assertions.

The first 30 applications produced real assertion RED and restoration, but the
diff recorder stripped trailing context from some saved patches. Those records
remain preserved and superseded. All 30 variants were rerun with raw Git diff
bytes. The accepted attempt-2 audit reconstructs every mutated file from the
immutable Git source and verifies diff, raw log and restoration SHA-256 values.
The complete run therefore contains 60 applications and 30 accepted audited
variants.

The private local raw bundle is under
`approved-batch/pr1767/oct9-repair/` in the task workspace: execution records,
`mutation-proofs/manifest.json`, per-application diffs/logs/restores,
`mutation-audit.json`, `mutation-summary.md` and `finding-correction.json`.
This bundle is not published by this local step.

No real notification, native delivery, credential, provider request or user-data
operation was performed. No Anthropic payload was sent. Independent review and
any repository approval verdict/publication remain separate requirements.

## Not changed here

The Notification Preferences panel's global "Notifications enabled" toggle
is read only by that panel's own helpers, so it silences nothing. It is
tracked as a follow-up decision in the plan.

## Rollback

Revert the commit:

- Master mute silences critical again.
- The five quiet-hours readers return.
- `wm-quiet-hours-unified-v1` is ignored.
- A migrated weather window stays in the canonical store, where the old
  dispatcher also honors it.
