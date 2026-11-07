# UX-050 Ghost Mode and critical notifications

Approved on November 2, 2026 against `cd459dfec`. The roadmap controller selected UX-050 at priority S after reconciling 28 open main-target PRs. Draft PR #1846 claims the approved work.

## Observed behavior

With Ghost saved before startup, an isolated run of the production modules suppressed a synthetic critical site-weather notification while the UI mode was null and the polling multiplier was 1. The fixture sent zero web notifications. The dispatcher reads the preference from storage independently. The mode manager keeps an in-memory value and its initialization function has no production caller. The focused dispatcher, cyber router and desktop iMessage suites passed 38 tests on this base.

## Decision for the operator

Under the approved policy, Ghost mutes standard alert notifications through the shared dispatcher, including critical warnings for the operator’s own site. Eligible batched analyst nudges also stay muted. A standing notice in both Home and classic views makes that choice visible and offers a keyboard-accessible “Exit Ghost Mode” action. Suggested text:

> Ghost Mode is on. Standard alert notifications and analyst nudges are muted, including critical site warnings. Other channels can still alert.

Existing direct smoke and AirNow callouts, inventory notifications and operational prompts use other paths. Existing channel preferences and private-mode guards continue to apply. The scope of the displayed count is the shared dispatcher and analyst nudges. In-app inboxes, alert history and map/panel information retain their existing behavior. Expanding silence to other channels requires a separate policy decision.

## Implementation and acceptance

1. Hydrate the mode from the existing storage key before the first dependent service or view runs. Use the same synchronous source of truth in the dispatcher and UI. Restore valid Ghost and God’s Vision values, and synchronize changes between windows. If preference reads fail, show that the mode is unknown and hold covered external notification attempts until the operator chooses. Distinguish this from a confirmed Ghost suppression. An unsaved manual choice still applies in the current window, with visible feedback.
2. Count each non-silent delivery attempt stopped by Ghost once, at its actual decision point. Count one eligible analyst nudge per batch after existing deduplication. A weather-ladder trace can say “dispatched” before the dispatcher suppresses it. Exclude that provisional event, channel fan-out, ungated alerts and ordinary data refreshes. Recheck mode at asynchronous permission and delivery boundaries so a request awaiting permission cannot deliver after Ghost intervenes. Leaving Ghost must not replay suppressed alerts.
3. Store only two bounded in-memory counts for this window and Ghost session: total muted attempts and how many were critical. No alert IDs, text, sites, timestamps or telemetry. Start a new count on entry or restoration after restart. Keep counts through shell swaps. Announce activation once and avoid interrupting screen readers on every increment.
4. Reproduce restored mode with synthetic critical site weather, a batched analyst nudge, ordinary and silent requests, repeated attempts, a mode change while permission is pending, saved and unsaved choices and cross-window events. Exercise both actual shell mounts, keyboard exit, focus, narrow layout and teardown. Verify direct channel exceptions with test doubles. Tests must fail on any real notification, message or network delivery.

## Ownership and verification

The state owner covers the mode manager and bootstrap order. The notification owner covers the dispatcher, hypothesis notifier and aggregate counters. The UI owner covers the notice, Home and classic mounts. Use the existing paused-notice mount pattern; only the active view should announce the mode. The test owner verifies these paths through browser and isolated native fixtures, records clean-tree mutation proofs and runs the targeted suites and agentic gate. Independent review and a SHA-pinned verdict are required. Rollback removes the new notice, counters and mode wiring together. The existing preference key requires no migration.
