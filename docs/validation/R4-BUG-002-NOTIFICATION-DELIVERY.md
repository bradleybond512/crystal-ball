# R4-BUG-002 validation — honest, priority-aware native notifications

Validated September 29, 2026 on branch `claude/r4-bug-002-notify-delivery`
(implementation commit `9877b5d99`, base `a255546ee`). Approved design:
[plan](../plans/2026-09-29-r4-bug-002-notification-delivery.md).

## Behavior and architecture

- **Native** (`src-tauri/src/notify_policy.rs`, `main.rs`):
  - Independent lanes: critical is a token bucket (burst 6, refill 1 per
    10 s); high has 5 s spacing; normal has 30 s spacing among normals only.
  - `send_notification(…, priority?)` returns
    `delivered | rate_limited | unsupported`.
  - `speak_aloud` returns `rate_limited` instead of a silent success.
  - An unknown priority never escalates.
- **Renderer:**
  - `src/services/native-notify.ts` is the only `send_notification` call
    site (source-gated). Any unexpected native result is `failed`, never
    `delivered`.
  - Only `delivered` is recorded as seen:
    - the router traces rate-limited, failed and unavailable as not
      delivered and does not start its severity window;
    - an undelivered router alert stays pending: the threat reactor
      releases it from its 24 h dedupe, and the router retries only the
      native send on the next ingest (repair cycle 1, below);
    - `push-notifier` does not ledger or mark fired;
    - proximity sets `alerted` only after delivery, and coalesces more than
      three same-scan notices into one summary.
- **Lanes:** the critical lane is reserved for life-safety (evacuation
  orders, critical hazmat, critical router/push alerts). Breaking news is
  capped at high. Updater, comms health, economic stress and low stock are
  normal.
- **Lint repairs** required by pre-commit on touched files (no behavior
  change): CommsHealthPanel label/severity helpers, proximity
  distance/AQI/notice helpers.
- **Observation, not changed here:** `firePushForEvent` / `event-bridge.ts`
  currently have **no production caller**. Its contract is made honest for
  when it is wired.

## Actual validation

`cargo test --manifest-path src-tauri/Cargo.toml` (shared target, synthetic
frontend dir for the build script, `build:sidecar-xmpp` resource generated):

```text
Running unittests src/main.rs            test result: ok. 83 passed; 0 failed
Running tests/current_location_contract.rs test result: ok. 9 passed; 0 failed
Running tests/imessage_contract.rs       test result: ok. 44 passed; 0 failed
Running tests/notify_policy_contract.rs  test result: ok. 7 passed; 0 failed
Running tests/watchdog_contract.rs       test result: ok. 9 passed; 0 failed
```

`bash scripts/agentic-validate.sh --tests "test:native-notify test:imessage test:desktop-updater test:native-responsiveness"`:

```text
test:native-notify         ℹ pass 5 / ℹ fail 0 ; ℹ pass 52 / ℹ fail 0
test:imessage              ℹ pass 6 / ℹ fail 0 ; ℹ pass 63 / ℹ fail 0
test:desktop-updater       ℹ pass 13 / ℹ fail 0 ; ℹ pass 22 / ℹ fail 0
test:native-responsiveness ℹ pass 13 / ℹ fail 0
lint:strict, lint:conflicts, lint:json, lint:yaml, lint:shell, lint:md, lint:colors, typecheck:all — passed
Secret scan passed for 4926 file(s).
[docs:check] Documentation appears fresh.
Agentic validation gate passed.
```

ESLint (`--quiet`) on all nine touched renderer files: 0 errors.

## Mutation proof

The September 29 run below kept no raw diffs, logs or restore digests.
Repair cycle 1 regenerated all six proofs from a clean QA worktree (see
[Repair cycle 1 mutation proof](#repair-cycle-1-mutation-proof)). The
table is kept as the historical record.

Run by a script from a clean tree. For each mutation: record the SHA-256,
apply exactly one change, confirm a one-line diff, run the targeted suite,
restore with `git checkout`, re-verify the SHA-256 and a clean `git status`.
All six restored their checksum and left a clean tree.

| Mutation (reverts one fix) | File | Green | Red | First failing assertion |
|---|---|---|---|---|
| Unexpected native result treated as delivered | `native-notify.ts` | 5/0 | 4/1 | never treats an unexpected result or a thrown invoke as delivery |
| Router records rate-limited as delivered | `notification-router.ts` | 13/0 | 12/1 | a natively rate-limited alert is traced as not delivered and stays retryable |
| Push ledgers undelivered notifications | `push-notifier.ts` | 5/0 | 4/1 | a push the native layer did not deliver is not fired and never enters the dedupe ledger |
| Proximity marks undelivered notices | `proximity-alerts.ts` | 4/0 | 2/2 | only delivered notices are returned for marking as alerted |
| High lane shares the normal lane | `notify_policy.rs` | 7/0 | 5/2 | `normal_keeps_the_thirty_second_spacing_among_normals_only` FAILED |
| Native rate limit reported as delivered | `main.rs` | 5/0 | 4/1 | native send_notification reports outcomes through the priority lane policy |

## CI follow-up

The first CI run failed six `test:notifications` cases in
`tests/notifications/notification-ladder.test.mts` and
`tests/notifications/all-producers.integration.test.mts`. Their `captureSend`
fakes returned `undefined`, which the push notifier now correctly treats as an
undelivered native send. The fakes now return `'delivered'`, matching the new
`NativeNotifyOutcome` contract; no assertion was weakened. A full local
`node scripts/targeted-tests.mjs --ci` run then passed every selected script
(`test:notifications` 227/0) except `test:little-snitch`, whose three
`install-little-snitch-exporter` failures are a pre-existing macOS-host
uid/gid expectation in files this change does not touch.

## Repair cycle 1 (Sol's review of `ea6588a68`)

**Finding (P2).** An alert the native layer did not deliver could never be
retried, through either dedupe layer:

- The router stored the inbox row before the native send. It then treated
  any same-ID row from the last 24 h as a duplicate, whatever the native
  result was.
- The threat reactor set its source+indicator 24 h dedupe before emitting,
  and the router subscription discarded the delivery promise. The same
  threat therefore never reached the router again.

The earlier test sent two different IDs (`rl-1`, `rl-2`) through an inbox
fake that never returned what was stored. It proved only that the severity
window did not start.

**Fix** (`notification-router.ts`, `threat-reactor.ts`):

- The router knows whether a native send it attempted was delivered. An
  undelivered alert (`rate_limited`, `failed`, `unavailable` or a thrown
  send) stays pending in memory and is pruned after 24 h. `deliver()`
  resolves `false` for it.
- When the same alert arrives again, the router retries only the native
  send, under the current Ghost Mode, settings and severity window. The
  inbox row, toast and map marker are not repeated. The alert stays pending
  until a send is delivered.
- On a new alert, a policy skip (native off, Ghost Mode, the router's own
  severity window) settles it, exactly as before.
- The reactor accepts a handler promise. `false` releases that alert's
  dedupe entry, but only if the entry still belongs to that emission, so a
  late report cannot release a newer one. A throw, a rejection or any other
  result keeps the 24 h dedupe. The router subscription now returns
  `deliver()`'s promise.
- Unchanged: lanes, priorities, the severity gate, Ghost Mode, settings,
  push and proximity bookkeeping, quiet hours, mute and iMessage.
- Limitation: pending retries live in memory. After an app restart the
  stored inbox row dedupes the alert as before, so an alert left undelivered
  before a restart is not retried.

**Integration.** Only the three own commits were replayed, with rerere
off, from `a255546ee` onto main `1ff91232e`. `package.json` merged cleanly.
`scripts/targeted-tests-overrides.json` was resolved as the union of both
sides.

### Repair cycle 1 regressions (red first)

The new `src/services/__tests__/threat-reactor-retry.test.mts` drives the
real reactor `ingest()` and the real router subscription. Its inbox fake
returns from `getAll` what `put` stored. It checks that:

- after a `rate_limited`, `failed`, `unavailable` or thrown send, the same
  threat ingested again reaches the native layer once more, and a third
  ingest is deduped; the inbox row, toast and marker happen once;
- a delivered threat stays deduped;
- a retry honors Ghost Mode and resumes after it;
- an alert first seen in Ghost Mode is never sent natively later;
- on its own, the router retries the same alert ID once after a
  non-delivery.

Three tests were added to `threat-reactor.test.mts`:

- a `false` report releases the threat;
- a stale report cannot release a newer emission;
- a rejecting handler keeps the dedupe.

Both files now run in `test:native-notify`.

Before the fix, on the integrated tree:

```text
tsx --test threat-reactor-retry, threat-reactor and notification-router tests
# tests 33
# pass 25
# fail 8
```

The 8 failures were:

- the four retry cases ("the same threat is retried natively on the next
  ingest", `1 !== 2`);
- the Ghost Mode retry;
- the router-only retry;
- the reactor release;
- the rejecting handler, which was an unhandled rejection before the fix.

After the fix: `# tests 33`, `# pass 33`, `# fail 0`. Three more runs gave
the same result.

### Repair cycle 1 validation

These ran in a clean QA worktree at `dbf4382d3`. Dependencies came from
`npm ci --ignore-scripts` of that commit's `package-lock.json`, on Node
22.23.1:

```text
test:native-notify          ℹ pass 5 / ℹ fail 0 ; ℹ pass 72 / ℹ fail 0
test:notifications          ℹ pass 227 / ℹ fail 0
test:imessage               ℹ pass 6 / ℹ fail 0 ; ℹ pass 63 / ℹ fail 0
test:imessage-native        ℹ pass 1 / ℹ fail 0
test:desktop-updater        ℹ pass 13 / ℹ fail 0 ; ℹ pass 22 / ℹ fail 0
test:native-responsiveness  ℹ pass 13 / ℹ fail 0
```

`cargo test --manifest-path src-tauri/Cargo.toml` used a synthetic
`dist/index.html` and a generated `build:sidecar-xmpp` bundle. Both are
gitignored.

```text
Running unittests src/main.rs              test result: ok. 83 passed; 0 failed
Running tests/current_location_contract.rs test result: ok. 9 passed; 0 failed
Running tests/imessage_contract.rs         test result: ok. 44 passed; 0 failed
Running tests/notify_policy_contract.rs    test result: ok. 7 passed; 0 failed
Running tests/watchdog_contract.rs          test result: ok. 9 passed; 0 failed
```

`--test notify_policy_contract` on its own gave `7 passed; 0 failed`. The
agentic gate runs on the final head, and its output is kept with the PR
evidence.

### Repair cycle 1 mutation proof

The mutations ran in the same clean QA worktree at `dbf4382d3`, one at a
time, with the full `test:native-notify` file set in a single TAP run.
Cargo was used for `notify_policy.rs`. Every mutation recorded:

- its applied, non-empty diff;
- the raw test log;
- the restored SHA-256;
- a clean status before and after.

All 16 failed the tests, and every file was restored.

| ID | Mutation | File | Green | Red | First failing assertion |
|---|---|---|---|---|---|
| O1 | unexpected native result treated as delivered | `native-notify.ts` | 77/0 | 76/1 | never treats an unexpected result or a thrown invoke as delivery |
| O2 | router traces rate-limited as delivered | `notification-router.ts` | 77/0 | 75/2 | a natively rate-limited alert is traced as not delivered and stays retryable |
| O3 | push ledgers a rate-limited send | `push-notifier.ts` | 77/0 | 76/1 | a push the native layer did not deliver is not fired and never enters the dedupe ledger |
| O4 | proximity marks undelivered notices | `proximity-alerts.ts` | 77/0 | 75/2 | only delivered notices are returned for marking as alerted |
| O5 | high lane shares the normal lane | `notify_policy.rs` | 7/0 | 5/2 | `normal_keeps_the_thirty_second_spacing_among_normals_only` |
| O6 | rate limit reported as delivered at the `send_notification` call site | `main.rs` | 77/0 | 76/1 | native send_notification reports outcomes through the priority lane policy |
| N1 | a pending alert takes the inbox duplicate path | `notification-router.ts` | 77/0 | 71/6 | a rate_limited native send is retried when the same threat is ingested again |
| N2 | an undelivered send settles instead of staying pending | `notification-router.ts` | 77/0 | 71/6 | a rate_limited native send is retried when the same threat is ingested again |
| N3 | a Ghost Mode skip settles a pending retry | `notification-router.ts` | 77/0 | 76/1 | a retry honors ghost mode and stays retryable until a send is delivered |
| N4 | a retry repeats the toast | `notification-router.ts` | 77/0 | 71/6 | a rate_limited native send is retried …; inbox, toast and map stay one-time |
| N5 | a delivered retry stays pending | `notification-router.ts` | 77/0 | 76/1 | router: the same alert id is sent natively again after a non-delivery |
| N6 | the subscription discards the delivery promise | `notification-router.ts` | 77/0 | 72/5 | a rate_limited native send is retried when the same threat is ingested again |
| N7 | the reactor ignores the handler result | `threat-reactor.ts` | 77/0 | 70/7 | a rate_limited native send is retried when the same threat is ingested again |
| N8 | a stale report releases a newer emission | `threat-reactor.ts` | 77/0 | 76/1 | a late non-delivery report cannot release a newer emission of the same threat |
| N9 | a rejecting handler releases the dedupe | `threat-reactor.ts` | 77/0 | 76/1 | a subscriber that rejects keeps the 24 h dedupe |
| N10 | a Ghost Mode skip on a new alert becomes pending | `notification-router.ts` | 77/0 | 76/1 | an alert first seen in Ghost Mode is not sent natively later |

## Not performed

No installed app, native notification, Keychain or real osascript
invocation, in the original run or in repair cycle 1. The installed-app
OS-banner smoke remains a recommended human check. Behavior is proven through pure policy tests, injected renderer
dependencies and source gates.

## Rollback

No persisted data changes. Reverting restores the single global 30 s window
and the silent-drop behavior. Prefer a reviewed forward fix.
