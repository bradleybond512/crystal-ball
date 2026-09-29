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

## Not performed

No installed app, native notification, Keychain or real osascript
invocation. Behavior is proven through pure policy tests, injected renderer
dependencies and source gates.

## Rollback

No persisted data changes. Reverting restores the single global 30 s window
and the silent-drop behavior. Prefer a reviewed forward fix.
