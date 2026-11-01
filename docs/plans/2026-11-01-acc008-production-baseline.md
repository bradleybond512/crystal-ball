# ACC-008 production baseline acquisition

## Objective and acceptance

Refresh the installed production baseline before assigning model work. Publish
aggregate forecaster counts, separated label origins, Brier metrics, exact paired
baseline metrics, champion availability, and a cohort/version manifest. Preserve
the July baseline. Reassess ACC-601 through ACC-605 using measured evidence and
record actual UTC assessment dates. Unknown metadata remains unavailable and
cannot qualify ACC-703.

## Scope and risk

Standard read-only diagnostic acquisition. Bradley authorized implementing the
execution plan and launching the existing installed app to collect aggregates.
The app is version 2.25.147. No installation, release, deployment, provider,
inference, tuning, promotion, monitoring schedule, or production-storage changes
are included. Existing Pages and updater pauses remain in force.

Read-only repository discovery and architect design review preceded this plan.
The existing MCP diagnostic projection omits joint cohort versions and absolute
paired-baseline scores. The October 19-26 weekly report is partial: 663
observations, 198 fresh, 416 stale, and 49 unavailable. It does not qualify the
production evidence window.

## Bounded tasks

1. Codex claims ACC-008 in a draft PR before implementing acquisition tooling.
2. A prediction specialist owns `scripts/acc008-production-baseline.mts` and
   its focused test file. Read a verified installed WebKit SQLite database using
   Python's SQLite URI `mode=ro`, `query_only`, and one short transaction. Select
   only calibration, shadow runs, shadow comparisons, and champion-registry
   keys. Keep raw values in memory/private process pipes; emit aggregates only.
3. Reuse existing pure scoring, horizon grouping, exact-join, resolution-origin,
   and registry readers. Inject no-op persistence. Do not hydrate application
   singletons. Partition by source/version/horizon before exact joins, since
   the existing join key omits algorithm version. Reject ambiguous versions,
   conflicting labels/comparisons, invalid probabilities and malformed times.
4. Separate retained-record metrics from paired metrics. Use the existing
   20-sample scoring floor. Paired skill is one minus production Brier divided
   by baseline Brier on the identical cohort; zero baseline error is explicitly
   unavailable. Manual legacy labels must not be upgraded to direct evidence.
5. Codex records aggregate evidence and the roadmap assessment. The retained
   forecast store is bounded to 500 records and cannot establish the historical
   1,000-record model gate. Missing versions or registry state remain unavailable.
6. Independent review checks the final diff, privacy projection, calculations,
   provenance and task status. Opposite-agent review and required CI govern
   delivery; a draft claim is not acceptance.

## Validation

Focused tests must cover exact pair identity, source/version separation, label
origins, insufficient samples, malformed/missing stores, duplicate/conflicting
input, zero baseline error, privacy projection, deterministic replay, and
read-only SQLite acquisition. Mutation evidence must demonstrate the relevant
guards and assertions actually fail before restoring exact bytes.

Run the focused test command, `npm run typecheck:all`, and applicable existing
intelligence/cognition suites. Run the unchanged agentic validation gate with
the actual focused script names before sign-off. Record real output; do not
reuse historical test results. Live acquisition additionally checks that origin
counts reconcile and both sides of every paired metric share a denominator.

## Evidence and rollback

Record the installed release separately from the evaluation code revision and
the measurement/manifest UTC times. Do not infer an installed algorithm version
from the application version. Allowlisted output excludes claims, target keys,
forecast IDs, entities, coordinates, resolution notes and evidence references.
Unknown source/version values are counted without printing arbitrary strings.

The task does not start a qualifying ACC-703 window or promote any model.
Rollback removes the diagnostic tooling and its documentation through the
normal review path; production storage is never modified.
