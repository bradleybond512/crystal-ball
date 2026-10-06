# R4-BUG-002: honest, priority-aware native notification delivery

Status: approved by Bradley on September 29, 2026 ("Approve as designed").
No production code has changed. Branch `claude/r4-bug-002-notify-delivery`
from `a255546ee`.

## Problem (verified at a255546ee)

- `send_notification` (`src-tauri/src/main.rs:1594-1611`) has one global
  30 s window shared by **all** callers. Inside the window it returns
  `Ok(())` without delivering.
- Eight renderer callers invoke it:
  - `push-notifier.ts:459` (CAP/NWS, seismic, hurricane, wildfire, AQ);
  - `notification-router.ts:140`;
  - `proximity-alerts.ts:139/180/221/265`;
  - `desktop-notifications.ts:52`;
  - `desktop-updater.ts:214/241`;
  - `CommsHealthPanel`, `EconomicStressPanel`, `ResourceInventoryPanel`.
- What callers do after a silent drop:
  - `push-notifier` then appends the dedupe **ledger** and records
    `fired`, so a dropped CAP warning is also deduped against a retry;
  - `notification-router` records `delivered: true`;
  - `proximity-alerts` has already set `alerted[id]`.
- Net effect: any notification in the prior 30 s silently eats a tornado
  warning or evacuation order, and every trace says it was delivered.

## Design

### Native (Rust)

1. New pure module `src-tauri/src/notify_policy.rs`, in the style of
   `watchdog.rs`: `admit(now, priority, &mut LaneState) -> Admission`.
   It has **independent lanes**, so a lower lane can never consume a
   higher lane's budget:
   - `critical`: token bucket, capacity 6, refill 1 per 10 s (six
     back-to-back, then about 6/min). Never blocked by other lanes.
   - `high`: minimum 5 s spacing within the lane.
   - `normal` (the default when omitted): the existing 30 s spacing, now
     only among normal notifications.
2. `send_notification(title, body, sound, priority?)` returns
   `NotificationOutcome = "delivered" | "rate_limited"`. Spawn failures stay
   `Err`. "delivered" means handed to macOS; the osascript spawn stays
   non-blocking. An unknown `priority` string is treated as `normal`, never
   as `critical`. A renderer that lies about priority can only produce
   notification spam, which the critical bucket bounds.
3. `speak_aloud` gets the same honesty: it returns `"spoken" | "rate_limited"`
   instead of a silent `Ok(())`. Its 5 s window is unchanged.

### Renderer

4. New single entry point `src/services/native-notify.ts`:
   `notifyNative({ title, body, sound, priority }) → 'delivered' | 'rate_limited' | 'failed' | 'unavailable'`.
   All eight callers use it. A source test fails if `'send_notification'` is
   invoked anywhere else.
5. Priority mapping. The `critical` lane is reserved for **life-safety**:
   - `push-notifier`: CAP/seismic/hurricane/wildfire payloads with
     `threatLevel` critical/extreme → `critical`; high → `high`; else `normal`.
   - `proximity-alerts`: evacuation orders and critical hazmat → `critical`;
     other wildfire/hazmat → `high`; spills and air quality → `normal`.
   - `notification-router`: severity critical → `critical`; high → `high`; else `normal`.
   - Breaking news: max `high`. Updater, comms health, economic stress and
     low stock: `normal`.
6. Record only what happened:
   - `push-notifier` appends the ledger and records `fired` **only on
     `delivered`**. Otherwise it records `suppressed: native-rate-limited`
     or `native-failed`, with no ledger entry, so the next cycle can retry.
   - `notification-router` records `delivered: true` only on `delivered`.
     Repair cycle 1 (Sol's review of `ea6588a68`): an undelivered router
     alert stays pending, the threat reactor releases it from its 24 h
     dedupe, and the next ingest retries only the native send. Inbox,
     toast and map marker stay one-time.
   - `proximity-alerts` sets `alerted[id]` only on `delivered`. When a scan
     yields more than 3 newly qualifying incidents, it sends one summary
     notification that names them ("4 new incidents near you: …") and marks
     all of them on delivery.

### Non-goals

No queue/scheduler for rate-limited `normal` items: they report honestly
and their producers retry on their next cycle. No change to quiet hours or
mute (R4-BUG-003 lands separately). No change to the iMessage path.

## Tests (written first, fake-only; mutation proof per behavior)

- Rust `notify_policy` unit tests:
  - critical delivered 1 s after a normal;
  - two criticals 1 s apart;
  - burst cap of 6 then refill;
  - high not blocked by normal;
  - normal 30 s spacing preserved;
  - unknown priority maps to normal.
- Rust contract: `send_notification` serializes `NotificationOutcome`.
- TS tests:
  - `push-notifier` makes no ledger append on `rate_limited`/`failed`;
  - router trace is not-delivered on `rate_limited`;
  - proximity leaves `alerted` unset on non-delivery;
  - proximity summary with more than 3 incidents;
  - priority-mapping table;
  - source gate: single `send_notification` call site.
- Validation: `cargo test`, the targeted TS suites, `npm run typecheck:all`,
  `npm run secrets:scan`, and `bash scripts/agentic-validate.sh --tests "<scripts>"`,
  all quoted as real output.

## Rollback

No persisted data changes. Reverting restores the old global window. Prefer
a reviewed forward fix.

## Approval requirement

This changes a privileged Tauri command and the safety-alert path, so it
needs Bradley's approval of: the lane parameters (critical 6-burst with
1/10 s refill, high 5 s, normal 30 s), the life-safety-only `critical`
mapping, and the no-queue non-goal.
