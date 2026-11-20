# UX-057 — verify persistence before changing timers

Fresh complete roadmap selection chooses UX-057 [B], with blocking[] using the
already-reviewed UX-076 metadata reconciliation. Canonical main is `ffb3f3ccb4`.
No competing claim is established yet. User requests fast continuation with low
token use; merging, auto-merge, releases, deployment and installation stay paused.

## Objective and current evidence

Verify the six timer writers reported in L2 before removing writes. Inspection
finds current Phishstats and TV ticks do not persist; empty digest ticks return
before persistence. Improvement scheduling, consolidation and self-tuning appear
gated on due work. These are source findings, not executed behavioral evidence.
Do not manufacture a runtime fix for an obsolete report.

## Acceptance and constraints

Characterize actual callbacks with synthetic data, deterministic timers and
write-counting storage. Verify unchanged ticks, legitimate setting/history
changes, reload, storage failures and teardown where applicable. Preserve
notification, acquisition, prediction, learning and persistence policy. State
actual failure behavior honestly; TV storage operations currently can throw.
No live app, user profile, provider calls, dependencies or native execution.

Architect must choose a useful bounded slice and classify it. Three
non-cognition paths can be Standard test-only work; any cognition/self-tuning
validation needs an explicit High Assurance design decision and approval before
implementation. Full acceptance must remain open for untested paths or known
contract gaps. No cleanup, schema change or arbitrary timer rewiring.

## Required evidence

Use real modules/callbacks with injected fixture boundaries, not only source-text
assertions. Test engineer owns tests; parent owns script/mapping and evidence.
Mutation proofs must cause real failures when redundant writes are introduced
or valid persistence is lost. Final focused checks, named validation gate,
independent Sol/Sonnet review and explicit publication approval are required.
