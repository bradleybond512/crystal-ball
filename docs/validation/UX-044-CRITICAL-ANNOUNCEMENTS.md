# UX-044 — Critical change announcements

The posture banner and Summary Strip each use a persistent polite, atomic status node. Posture announces an onset or a change to the selected theater, severity or strike capability. Triage silently seeds its initial critical/high/medium counts and announces one summary when the displayed tuple changes. Polling identical values leaves the live nodes alone. Collapse, dismissal, mobile posture suppression, hidden tabs and Ghost Mode silence the affected surface; returning does not replay suppressed updates.

Polling preserves button identity and current action targets. Clearing a posture produces no all-clear announcement. The strip keeps visible text in its controls’ accessible names and provides a surviving target when a focused control disappears. Focus outside the strip stays outside.

## Before and after

PR #1730 fixed the stack layout. On the original tree, Chromium and native WKWebView both lacked the new live regions; refreshing either surface could drop focus to the document body. The browser layout suite passed its eight existing controls before this work. Adding the clipped, accessible status assertion produced `RESULT 8 pass / 1 fail`.

The implementation changes PanelLayoutManager’s posture component, SummaryStrip and a shared Ghost/visibility helper. The clipped status nodes reuse the existing earthquake-warning live-region styling. The tests exercise real rendering, keyboard activation and layout with recording stores/transports. No provider, preference schema or OS notification channel changed.

## Local evidence

Implementation `3a584617d` and verification snapshot `8bb2f10fb` have the same Git tree. [Acceptance assertions](UX044-ACCEPTANCE.json) cover 46/46 Chromium and 37/37 native WKWebView controls. Chromium exposed both status nodes as live, polite and atomic in its accessibility tree. The native fixture verified DOM updates and focus independently. System VoiceOver was off; actual spoken output and final macOS accessibility notifications have not been verified.

Chromium initially moved focus to the document body when a focused regime chip disappeared or a peer collapsed the strip. The repaired strip moves focus to Freshness or the chevron, respectively. A non-key WKWebView retained DOM focus even though CSS `:focus` did not match. Checking DOM identity fixed both native cases. The outside-focus control passed.

The [mutation certificate](UX044-MUTATIONS.json) records each applied reversal, observed failure and restored checksum. Its 63 isolated reversals produced 64 named test failures. The three suites passed 34/34 before and after restoration. Independent Sol review found zero blocking code findings on the repaired implementation. The separate Sonnet conclusion is recorded in the verdict commit.

| Command | Captured output |
| --- | --- |
| `npm run test:ux044` | `# pass 25`, `# fail 0` |
| `npm run test:summary-strip-layout` | `RESULT 9 pass / 0 fail` |
| `bash scripts/agentic-validate.sh --tests 'test:ux044 test:summary-strip-layout'` | `Agentic validation gate passed.` |

The gate ran both TypeScript configurations and the production build. A disposable reconciliation with draft #1853 required combining only additive test mappings. The merged-source rehearsal passed 25 UX-044 tests, 113 UX-018 tests and all nine layout checks without merging either draft.

## Manual verification and rollback

In a disposable session with a screen reader, focus View Region and use the test fixture to change the selected theater. Confirm one short update and that Enter opens the current theater. Focus Alert Inbox, change the critical count, then refresh without changing the count. Listen for one update and verify focus stays on the same button. Repeat after a hidden-tab or Ghost transition, dismissal and peer collapse. Check that unchanged or suppressed values do not replay and that focus outside the strip stays put.

Revert the implementation commits together to restore earlier rendering and announcement behavior. No data migration is needed.
