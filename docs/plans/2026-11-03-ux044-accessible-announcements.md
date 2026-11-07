# UX-044 — Announce critical UI changes accessibly

## Verified scope

PR #1730 repaired stack geometry. Its eight layout controls passed. On main `cd459dfec`, an isolated Chromium accessibility-tree probe found no live regions when the theater posture became critical or the unacknowledged critical count changed from zero to one. Polling replaced focused View Region and Alert Inbox controls, moving keyboard focus to the document body. The probe used recording fixtures and did not test spoken output.

## Approved behavior

Use one initially empty, visually hidden, polite atomic status per surface, separate from interactive controls. Announce the visible posture’s onset and material changes in theater, severity or strike capability. Use a short label with the current theater. Routine aircraft-count, clock and display-text refreshes stay silent. When posture disappears, clear the status without announcing a safety conclusion.

Seed SummaryStrip’s visible critical, high and medium unacknowledged counts silently on its first render. Announce changes to the displayed counts in one short triage summary and handle transitions to zero accurately. Source freshness, readiness, regime text and other unchanged counts do not produce announcements. Preserve access to those values through normal navigation.

Keep action nodes and their accessible names stable across refreshes, retain focus and use the current target when the operator activates an action. Give the dismiss control a descriptive name. Respect hidden tabs, disabled/collapsed strips, mobile posture suppression, dismissal and Ghost Mode. Resume silently after suppression without replay. Preserve the existing stack layout and notification channels.

## Work and acceptance

The layout owner handles posture and the strip owner handles triage. The accessibility verifier records live-node text mutations, Chromium accessibility semantics and keyboard activation for onset, escalation, repeated values, cleared counts, dismissal, suppression, resume and teardown. Repeat PR #1730 layout checks, run type checks and the repository gate, and inspect isolated reversals of the behavioral guards. Verify screen-reader spoken output in an isolated session if available; record any outstanding manual VoiceOver/NVDA check explicitly. Reverting this UI change requires no data migration.
