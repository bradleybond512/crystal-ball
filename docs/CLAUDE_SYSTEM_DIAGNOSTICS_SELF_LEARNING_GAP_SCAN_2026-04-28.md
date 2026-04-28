# Claude System Diagnostics And Self-Learning Gap Scan - 2026-04-28

## Purpose

This document is a handoff for Claude to continue hardening Crystal Ball into a system that is:

- diagnosable when something breaks
- self-observing while it runs
- self-learning from outcomes and user response
- self-correcting through bounded, reviewable setting proposals
- safe enough that critical alert paths do not silently degrade

This is based on an overall repo scan after the recent algorithm and weather-mission work through PR `#183`.

## Current State

Crystal Ball has many of the right primitives now.

Diagnostics primitives:

- `src/services/diagnostics/diagnostic-events.ts`
- `src/services/diagnostics/system-health.ts`
- `src/services/diagnostics/system-health-types.ts`
- `src/services/diagnostics/feature-health-registry.ts`
- `src/services/diagnostics/panel-health-registry.ts`
- `src/services/diagnostics/provider-redundancy.ts`
- `src/services/diagnostics/sentinel-feed-audit.ts`
- `src/services/diagnostics/notification-trace.ts`
- `src/services/diagnostics/self-test.ts`
- `src/services/diagnostics/export-bundle.ts`
- `src/services/data-freshness.ts`
- `src/services/data-health.ts`
- `src/services/providers/health.ts`

Algorithm self-observation primitives:

- `src/services/algorithms/algorithm-registry.ts`
- `src/services/algorithms/record-evaluation.ts`
- `src/services/algorithms/algorithm-evaluation-ledger.ts`
- `src/services/algorithms/algorithm-health.ts`
- `src/services/algorithms/tracked-algorithms.ts`
- `src/services/algorithms/safe-adjustment.ts`
- `src/services/algorithms/algorithms-state.ts`
- `src/components/AlgorithmDiagnosticPanel.ts`

Closed-loop operations primitives:

- `src/services/ops/mission-ledger.ts`
- `src/services/ops/mission-state.ts`
- `src/services/ops/weather-mission-bridge.ts`
- `src/services/ops/time-to-warn.ts`
- `src/services/ops/effectiveness.ts`
- `src/services/ops/near-miss.ts`
- `src/services/ops/replay-fixtures.ts`
- `src/services/ops/replay-harness.ts`
- `src/services/ops/replay-fixtures-catalog.ts`
- `src/services/ops/capability-readiness.ts`

Recent improvements:

- Algorithm ids are now registry-driven instead of duplicated by diagnostics state.
- `recordAlgorithmEvaluation` can record compact live decisions and rejects oversized details.
- `trackedScoreFact`, `trackedComputeCompoundRisk`, and `trackedEvaluateNegativeEvidence` keep pure algorithms pure while allowing opt-in ledger recording.
- Weather urgency and threat classifier paths now emit algorithm evaluation records.
- Weather alerts can now open mission records through `weather-mission-bridge`.
- PR `#183` correctly avoids opening missions for suppressed weather decisions and avoids fake `user_notified` events for digest-tier alerts.

## Executive Gap Summary

The system can now observe some decisions, but it still cannot consistently close the loop.

Main missing capabilities:

1. Evaluation records are not reliably linked to mission outcomes.
2. Algorithm decisions are recorded, but most are not graded later.
3. Mission ledgers and algorithm ledgers are in-memory only.
4. Diagnostics export does not include algorithm/mission/replay/self-learning state.
5. Replay checks mission timelines, but does not rerun algorithms over historical input snapshots.
6. Safe-adjustment has an engine, but no live tunable registry or backtest-before-apply gate.
7. Weather has mission wiring; most other critical domains do not.
8. Digest delivery does not yet complete mission timelines.
9. Diagnostic events do not cover all important lifecycle transitions.
10. Capability readiness is defined, but not fully hydrated from live runtime state.

## Missing Diagnostics Abilities

### 1. Diagnostics Export Does Not Include The New Closed-Loop State

Current export bundle:

- system health
- notification summary
- notification traces
- diagnostic event ring
- optional self-test report
- app/env metadata

Missing from `src/services/diagnostics/export-bundle.ts`:

- recent algorithm evaluation records
- algorithm health report
- pending algorithm adjustment proposals
- mission ledger snapshot
- time-to-warn summary
- effectiveness report
- near-miss reports
- replay fixture summary
- replay harness report
- capability readiness report
- ledger persistence status

Why it matters:

When the user asks "why did this not self-correct?" or "why did Crystal Ball miss this?", the copy/paste diagnostics bundle does not yet include the evidence needed to answer.

Recommended implementation:

- Extend `DiagnosticsExportBundle` with optional closed-loop sections.
- Add caps for each section so the bundle remains paste-friendly.
- Redact mission/event details using the existing `redactDetail` rules.
- Add tests covering truncation and redaction for the new fields.

Primary files:

- `src/services/diagnostics/export-bundle.ts`
- `src/services/diagnostics/__tests__/export-bundle.test.mts`
- `src/services/algorithms/algorithms-state.ts`
- `src/services/ops/mission-state.ts`

### 2. No Durable Ledger Health Diagnostics

The algorithm and mission ledgers have `toJson` / `loadJson`, but the live singleton state is not persisted. A restart loses the evidence needed for learning.

Missing:

- storage adapter for algorithm evaluations
- storage adapter for mission records
- last load/save status
- trim policy visibility
- export of persisted count vs in-memory count
- corruption recovery diagnostics

Why it matters:

Self-learning requires history. In-memory ledgers can prove logic in tests, but not learn across sessions.

Recommended implementation:

- Add `src/services/algorithms/algorithm-ledger-persistence.ts`.
- Add `src/services/ops/mission-ledger-persistence.ts`.
- Use existing `src/services/persistent-cache.ts` where appropriate.
- Persist compact redacted records.
- Trim old records by max count and age.
- Emit diagnostic events on load/save/failure/trim.

Primary files:

- `src/services/persistent-cache.ts`
- `src/services/algorithms/algorithms-state.ts`
- `src/services/algorithms/algorithm-evaluation-ledger.ts`
- `src/services/ops/mission-state.ts`
- `src/services/ops/mission-ledger.ts`
- `src/services/diagnostics/diagnostic-events.ts`

### 3. Capability Readiness Exists But Is Not Hydrated

`src/services/ops/capability-readiness.ts` defines a useful readiness matrix, but the default catalog uses `satisfied: undefined` placeholders. The host needs to hydrate those checkpoints from live diagnostics.

Missing live inputs:

- saved places configured
- mission ledger active
- algorithm ledger active
- notification trace active
- provider registry loaded
- NWS provider health
- panel health registry mounted
- self-test runner availability
- storage availability
- sidecar status

Why it matters:

The app should be able to answer: "Can Crystal Ball learn and warn correctly right now?"

Recommended implementation:

- Add a readiness hydration service.
- Convert system health, panel health, provider health, sidecar health, and storage self-test output into readiness checkpoint values.
- Include readiness in diagnostics export and a diagnostic panel.

Primary files:

- `src/services/ops/capability-readiness.ts`
- `src/services/diagnostics/system-health.ts`
- `src/services/diagnostics/self-test.ts`
- `src/services/diagnostics/export-bundle.ts`

### 4. Diagnostic Event Bus Is Not Used Everywhere It Matters

The diagnostic event bus exists, but many important lifecycle events are not emitted.

Missing events:

- algorithm evaluation recorded
- algorithm outcome graded
- algorithm detail rejected for size
- mission opened
- mission event appended
- mission resolved
- near-miss detected
- replay fixture generated
- replay run completed
- adjustment proposal generated
- adjustment blocked by safety/backtest
- adjustment accepted/rejected by user
- ledger persisted/loaded/trimmed
- digest notification delivered

Why it matters:

Without chronology, debugging becomes archaeology.

Recommended implementation:

- Add lightweight diagnostic emission at the boundary services, not inside pure modules.
- Keep event payloads compact and redacted.
- Add tests proving event emission for key transitions.

Primary files:

- `src/services/diagnostics/diagnostic-events.ts`
- `src/services/algorithms/record-evaluation.ts`
- `src/services/ops/mission-ledger.ts`
- `src/services/ops/weather-mission-bridge.ts`
- `src/services/ops/replay-fixtures.ts`
- `src/services/ops/replay-harness.ts`
- `src/services/algorithms/safe-adjustment.ts`

### 5. Self-Test Does Not Probe Closed-Loop Learning

The self-test runner has core checks, but it does not yet verify the self-learning loop.

Missing self-tests:

- algorithm registry can derive health definitions
- evaluation ledger can record and grade a fixture
- algorithm health changes from unknown to healthy/degraded with fixture data
- mission ledger can open/append/resolve a fixture
- time-to-warn can score a fixture
- near-miss detection produces a fixture
- replay harness runs the catalog
- export bundle includes closed-loop state
- persistent cache can save/load ledgers
- safe-adjustment refuses unsafe auto-apply

Recommended implementation:

- Add closed-loop self-test definitions.
- Keep tests pure and fast; use fixtures, not network calls.
- Add these to readiness and export.

Primary files:

- `src/services/diagnostics/self-test.ts`
- `src/services/diagnostics/__tests__/self-test.test.mts`
- `src/services/ops/replay-fixtures-catalog.ts`

## Missing Self-Learning Abilities

### 1. Recorded Decisions Are Not Reliably Graded Later

The app records some algorithm evaluations, but no general resolver maps later mission outcomes back to those evaluations.

Missing:

- evaluation id stored on mission events
- mission resolution updates related evaluation records
- automatic outcome labels from time-to-warn/near-miss results
- inconclusive handling when no outcome appears before expiration

Recommended implementation:

- Add `evaluationRecordId` or `evaluationRecordIds` to mission event detail where a model decision opened/escalated a mission.
- Add an outcome resolver that:
  - reads active/resolved missions
  - computes time-to-warn
  - detects near-misses
  - records `hit`, `miss`, `partial`, or `inconclusive` on linked evaluations
- Ensure it refuses to overwrite already graded records.

Primary files:

- `src/services/algorithms/record-evaluation.ts`
- `src/services/ops/mission-types.ts`
- `src/services/ops/weather-mission-bridge.ts`
- `src/services/ops/time-to-warn.ts`
- `src/services/ops/near-miss.ts`
- new `src/services/ops/outcome-resolver.ts`

### 2. Forecast Calibration Is Not Unified With Algorithm Health

`src/services/intelligence/forecast-calibration.ts` tracks prediction records, Brier score, domain accuracy, and source multipliers. The algorithm evaluation ledger tracks generic algorithm outcomes. They are parallel.

Missing:

- common adapter between forecast predictions and algorithm evaluations
- shared algorithm id/version naming
- algorithm health using Brier/calibration error, not only hit-rate
- source multipliers feeding truth/source confidence in a controlled way

Recommended implementation:

- Add a forecast-to-evaluation adapter.
- Add calibration summaries to algorithm health.
- Use source multipliers as proposals, not direct unreviewed changes.

Primary files:

- `src/services/intelligence/forecast-calibration.ts`
- `src/services/algorithms/algorithm-evaluation-ledger.ts`
- `src/services/algorithms/algorithm-health.ts`
- `src/services/source-trust.ts`
- `src/services/source-reliability.ts`

### 3. User Feedback Loops Are Fragmented

Existing feedback/learning services:

- `src/services/source-feedback.ts`
- `src/services/correlation-feedback.ts`
- `src/services/relevance-learner.ts`
- `src/services/hypothesis-feedback.ts`
- `src/services/hypothesis-accuracy.ts`
- `src/services/severity-recalibration.ts`
- `src/services/snooze-learning.ts`

Missing:

- unified feedback event taxonomy
- clear separation between "user found it irrelevant" and "the fact was false"
- joins from user feedback to mission/evaluation records
- sample-size gates before changing algorithm behavior
- diagnostics showing which feedback changed which setting

Recommended implementation:

- Add a shared feedback-event adapter.
- Store feedback references on missions/evaluations.
- Treat user feedback as relevance/noise evidence, not truth evidence unless paired with real outcome.
- Add diagnostic export for recent feedback-derived adjustments.

Primary files:

- feedback services listed above
- `src/services/algorithms/safe-adjustment.ts`
- `src/services/algorithms/algorithm-health.ts`

### 4. No Drift Detector For Algorithm Behavior

The system can compute health from graded records, but it does not explicitly detect drift.

Missing drift checks:

- hit-rate trend degradation
- latency trend degradation
- provider source drift
- domain volume drift
- false-positive pressure rising
- false-negative / near-miss pressure rising
- user follow-through decline
- data-quality dependency decline

Recommended implementation:

- Add `src/services/algorithms/algorithm-drift.ts`.
- Compare recent window vs baseline window.
- Emit status and recommendation.
- Feed drift into algorithm health and diagnostics export.

Primary files:

- `src/services/algorithms/algorithm-evaluation-ledger.ts`
- `src/services/algorithms/algorithm-health.ts`
- `src/services/ops/effectiveness.ts`
- `src/services/diagnostics/export-bundle.ts`

## Missing Self-Correction Abilities

### 1. Safe Adjustment Has No Live Tunable Registry

`safe-adjustment.ts` can propose bounded changes, but `AlgorithmDiagnosticPanel` still passes `tunings: []`.

Missing:

- tunable registry
- current setting source
- min/max/step per parameter
- safety class per parameter
- sample-size gates per parameter
- last applied/rejected proposal history

Recommended implementation:

- Add `src/services/algorithms/tunable-registry.ts`.
- Start with low-risk tunables only:
  - relevance threshold
  - digest ranking weight
  - stale data penalty
  - source confidence multiplier bounds
- Add safety-critical tunables later:
  - weather urgency threshold
  - polygon buffer
  - critical notification bypass threshold
- Show proposals in Algorithm Diagnostic Panel with rollback values.

Primary files:

- `src/services/algorithms/safe-adjustment.ts`
- `src/services/algorithms/algorithms-state.ts`
- `src/components/AlgorithmDiagnosticPanel.ts`
- new `src/services/algorithms/tunable-registry.ts`

### 2. No Backtest-Before-Apply Gate

The app should never apply or recommend high-risk tuning without proving it against replay fixtures.

Missing:

- baseline replay report
- candidate replay report
- comparison verdict
- safety regression gates
- block reasons

Recommended implementation:

- Add `src/services/algorithms/backtest-adjustment.ts`.
- Compare current settings vs proposed settings over replay fixtures.
- Gate proposals:
  - no new safety-critical failures
  - no worse weather time-to-warn
  - no increase in no-warning/after-event cases
  - no increase in unsafe suppressions
  - improved or equal weighted hit rate
- Add `blocked_by_backtest` or equivalent verdict.

Primary files:

- `src/services/ops/replay-harness.ts`
- `src/services/ops/replay-fixtures.ts`
- `src/services/algorithms/safe-adjustment.ts`
- new `src/services/algorithms/backtest-adjustment.ts`

### 3. Replay Does Not Rerun Real Algorithms

Current replay checks mission-event expectations. That is useful, but it does not rerun the algorithm with historical inputs and proposed settings.

Missing:

- input snapshot schema
- fixture input payloads for algorithms
- algorithm runner registry
- old-settings vs new-settings comparison
- output diffing

Recommended implementation:

- Extend replay fixtures with optional `algorithmInputs`.
- Add algorithm replay runners for selected algorithms.
- Start with weather urgency because it has clear mission outcomes.
- Keep all replay runners pure and deterministic.

Primary files:

- `src/services/ops/replay-fixtures.ts`
- `src/services/ops/replay-harness.ts`
- `src/services/weather/weather-warning-router.ts`
- `src/services/weather/weather-urgency.ts`

### 4. Critical Domains Other Than Weather Do Not Open Missions

Weather now has a mission bridge. Other domains still need equivalent bridges.

Priority mission bridges:

- cyber exposure
- compound risk
- local infrastructure
- travel disruption
- market/portfolio risk
- food/commodity shortage
- conflict escalation

Recommended pattern:

- one bridge per domain
- record `app_watch` when the app starts tracking
- record `user_notified` only when actually delivered
- record `official_confirmed` when an authoritative source confirms
- record `actual_impact` when outcome is known
- link origin algorithm id and evaluation record id

Primary files:

- `src/services/ops/weather-mission-bridge.ts` as template
- `src/services/cyber/*`
- `src/services/compound-risk*`
- `src/services/infrastructure/*`
- `src/services/shortage/*`
- `src/services/market/*`

### 5. Digest Delivery Does Not Complete Mission Timelines

PR `#183` correctly avoids writing `user_notified` for digest-tier weather alerts at routing time. However, when digest delivery actually happens, the mission should receive `user_notified`.

Missing:

- digest delivery hook
- mission lookup by alert/place
- `user_notified` event at actual digest render/send time
- user acknowledgement/follow-through tracking for digest items

Primary files:

- `src/services/insights/notification-ladder.ts`
- `src/services/notification-digest.ts`
- `src/services/ops/weather-mission-bridge.ts`
- `src/services/ops/mission-state.ts`

## Recommended PR Sequence

### PR 1 - Closed-Loop Diagnostics Export

Goal:

Make one export bundle answer "what happened and why?"

Tasks:

- Extend diagnostics export with algorithm health, recent evaluations, missions, time-to-warn, near-misses, replay summary, readiness, and pending proposals.
- Add caps and redaction.
- Add tests for redaction/truncation.

Validation:

```bash
npm run lint:strict
npm run typecheck:all
npx vitest run src/services/diagnostics/__tests__/export-bundle.test.mts
```

### PR 2 - Durable Ledgers

Goal:

Make learning survive app restarts.

Tasks:

- Persist algorithm evaluation ledger.
- Persist mission ledger.
- Add load/save/trim diagnostics.
- Add corruption recovery tests.

Validation:

```bash
npm run lint:strict
npm run typecheck:all
npx vitest run src/services/algorithms/__tests__/algorithm-evaluation-ledger.test.mts src/services/ops/__tests__/mission-ledger.test.mts
```

### PR 3 - Outcome Resolver

Goal:

Make recorded decisions grade themselves from mission outcomes.

Tasks:

- Link mission events to evaluation record ids.
- Add resolver that grades evaluations from time-to-warn and near-miss results.
- Add tests for hit/miss/partial/inconclusive and no-overwrite.

Validation:

```bash
npm run lint:strict
npm run typecheck:all
npx vitest run src/services/ops/__tests__/time-to-warn.test.mts src/services/ops/__tests__/closed-loop-batch.test.mts src/services/algorithms/__tests__/algorithm-evaluation-ledger.test.mts
```

### PR 4 - Diagnostic Event Coverage

Goal:

Make the timeline explain every important self-learning transition.

Tasks:

- Emit diagnostic events for algorithm, mission, replay, adjustment, persistence, and digest-delivery transitions.
- Add tests for event emission.

Validation:

```bash
npm run lint:strict
npm run typecheck:all
npx vitest run src/services/diagnostics/__tests__/diagnostic-events.test.mts
```

### PR 5 - Capability Readiness Hydration

Goal:

Make readiness checkpoints use real runtime state.

Tasks:

- Add hydration service.
- Feed readiness into export bundle and UI.
- Add closed-loop learning readiness checks.

Validation:

```bash
npm run lint:strict
npm run typecheck:all
npx vitest run src/services/ops/__tests__/closed-loop-batch.test.mts src/services/diagnostics/__tests__/system-health.test.mts
```

### PR 6 - Tunable Registry

Goal:

Make safe-adjustment proposals real, bounded, and reviewable.

Tasks:

- Add tunable registry.
- Wire low-risk tunables into AlgorithmDiagnosticPanel.
- Add proposal history shape.
- Do not auto-apply.

Validation:

```bash
npm run lint:strict
npm run typecheck:all
npx vitest run src/services/algorithms/__tests__/safe-adjustment.test.mts src/services/algorithms/__tests__/algorithm-health.test.mts
```

### PR 7 - Backtest Before Apply

Goal:

Block unsafe settings changes before they reach users.

Tasks:

- Add backtest comparison layer.
- Compare baseline vs candidate replay results.
- Add safety gates.
- Attach backtest verdict to adjustment proposal.

Validation:

```bash
npm run lint:strict
npm run typecheck:all
npx vitest run src/services/ops/__tests__/replay-harness.test.mts src/services/algorithms/__tests__/safe-adjustment.test.mts
```

### PR 8 - Additional Mission Bridges

Goal:

Expand closed-loop learning beyond weather.

Tasks:

- Add mission bridges for cyber exposure and compound risk first.
- Then add infrastructure, shortage, market, travel, and conflict bridges.
- Reuse weather bridge conventions.

Validation:

```bash
npm run lint:strict
npm run typecheck:all
npm run test:api
npm run test:sidecar
```

Add targeted tests for each new bridge.

## Specific Bugs Or Risks To Watch

### In-Memory Learning Illusion

If ledgers are not persisted, the UI may look like it is learning during one session but forget everything after restart.

### Ungraded Evaluation Pileup

If evaluations are recorded but never graded, algorithm health stays unknown and safe adjustment never has evidence.

### User Feedback As Truth

User snooze/dismiss behavior should tune relevance/noise, not factual truth. A dismissed alert can still be true.

### Digest Timestamp Pollution

Do not write `user_notified` until the digest is actually delivered. PR `#183` fixed the routing-time version of this; preserve that invariant.

### Unsafe Backtest Overfitting

Do not accept a candidate setting that improves one replay fixture while regressing critical no-warning or after-event scenarios.

### Private Data In Fixtures

Do not commit generated local replay fixtures containing private saved places, exact coordinates, user notes, or contact details.

## Full Verification Before Claiming Done

Run:

```bash
npm run lint:strict
npm run typecheck:all
npm run secrets:scan
npm run test:api
npm run test:sidecar
npm run build
```

Also run targeted tests for any touched service.

## Claude Prompt

```text
You are working in /Users/bradleybond/Developer/crystalball.

Goal: harden Crystal Ball's diagnostics, self-learning, and self-correction loop based on docs/CLAUDE_SYSTEM_DIAGNOSTICS_SELF_LEARNING_GAP_SCAN_2026-04-28.md.

Read first:
- AGENTS.md
- docs/CLAUDE_SYSTEM_DIAGNOSTICS_SELF_LEARNING_GAP_SCAN_2026-04-28.md
- docs/DIAGNOSTICS_OBSERVABILITY_ENHANCEMENT_PLAN.md
- docs/CLAUDE_BACKTEST_SELF_IMPROVEMENT_HANDOFF_2026-04-28.md
- docs/CLOSED_LOOP_INTELLIGENCE_OPERATIONS_PLAN.md

Do not commit to main. Do not push to upstream/origin. Stage files by explicit path only.

Start with PR 1: Closed-Loop Diagnostics Export.
Implement this first because it makes every later failure debuggable:
1. Extend src/services/diagnostics/export-bundle.ts with optional closed-loop sections:
   - algorithmHealth
   - recentAlgorithmEvaluations
   - missionSnapshot
   - timeToWarnSummary
   - effectivenessReport
   - nearMissReports
   - replayReportSummary
   - capabilityReadiness
   - pendingAdjustmentProposals
2. Add caps and truncation notes for each section.
3. Redact sensitive details using the existing redaction helpers.
4. Add tests in src/services/diagnostics/__tests__/export-bundle.test.mts for:
   - JSON round trip
   - redaction of mission/evaluation detail
   - truncation metadata
   - backward compatibility when closed-loop sections are omitted

After PR 1, continue in this order:
- durable algorithm and mission ledgers
- outcome resolver linking mission results back to evaluation records
- diagnostic event coverage for algorithm/mission/replay/adjustment transitions
- capability readiness hydration from live runtime state
- tunable registry for safe-adjustment proposals
- backtest-before-apply safety gates
- mission bridges beyond weather

Safety rules:
- no unreviewed auto-apply for safety-critical settings
- no raw sensitive payloads in ledgers, exports, or fixtures
- user dismiss/snooze tunes relevance, not factual truth
- do not record digest user_notified until digest delivery actually happens
- do not overwrite already graded algorithm evaluations
- never allow a setting candidate that regresses no-warning or after-event critical cases

Before claiming done, run:
npm run lint:strict
npm run typecheck:all
npm run secrets:scan
npm run test:api
npm run test:sidecar
npm run build

Also run targeted tests for every touched module and report exact files changed, tests run, remaining risks, and which PR stage you completed.
```
