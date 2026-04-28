# Claude Backtest And Self-Improvement Handoff - 2026-04-28

## Executive Summary

Crystal Ball already has most of the primitives needed for algorithm backtesting and safe self-improvement:

- prediction/evaluation ledgers
- forecast calibration
- mission ledgers
- time-to-warn scoring
- near-miss detection
- replay fixtures
- replay harness
- algorithm health scoring
- bounded safe-adjustment proposals

The missing part is wiring. Live algorithm decisions are not consistently recorded, real alert/notification outcomes are not consistently converted into mission records, and safe adjustments do not yet have enough real tunable settings to recommend meaningful upgrades.

The right next build is a closed-loop algorithm QA system:

```text
live algorithm decision
  -> evaluation ledger record
  -> real-world/user outcome
  -> algorithm health report
  -> replay fixture if late/noisy/wrong
  -> bounded setting proposal
  -> human approval
  -> re-run replay/backtest before accepting
```

Do not build automatic unreviewed self-upgrades first. Build measured recommendations with replay evidence and rollback paths.

## Current Capability Inventory

### Algorithm Evaluation Ledger

File:

- `src/services/algorithms/algorithm-evaluation-ledger.ts`

What it does:

- records algorithm decisions
- stores algorithm id, domain, version, duration, score/label, detail
- records later outcomes as `hit`, `miss`, `partial`, or `inconclusive`
- summarizes calibration by algorithm/domain

Gap:

- live call sites are not consistently writing into it.

### Algorithm Health Aggregator

File:

- `src/services/algorithms/algorithm-health.ts`

What it does:

- converts graded evaluation records into health statuses:
  - `healthy`
  - `degraded`
  - `failing`
  - `unsafe`
  - `unknown`
- applies stricter floors to safety-critical algorithms
- reports recommendations

Gap:

- mostly shows `unknown` until real evaluations are recorded and later graded.

### Safe Adjustment Engine

File:

- `src/services/algorithms/safe-adjustment.ts`

What it does:

- proposes bounded parameter changes
- refuses unsafe auto-tuning for unsafe algorithms
- uses smaller steps for safety-critical algorithms
- includes rollback information

Gap:

- `AlgorithmDiagnosticPanel` currently passes an empty tunings list.
- live tunable parameters are not registered.
- proposals are not yet connected to replay/backtest proof.

### Forecast Calibration

File:

- `src/services/intelligence/forecast-calibration.ts`

What it does:

- records predictions
- resolves true/false outcomes
- computes Brier score
- computes per-domain accuracy
- computes per-source multipliers

Gap:

- not fully unified with the algorithm evaluation ledger.
- not consistently fed by live forecasters.

### Mission Ledger

File:

- `src/services/ops/mission-ledger.ts`

What it does:

- records mission/event timelines
- tracks detection, warning, impact, acknowledgement, action, and resolution

Gap:

- real alert and notification flows are not fully opening and updating missions.

### Time-To-Warn

File:

- `src/services/ops/time-to-warn.ts`

What it does:

- computes warning lead time by mission domain
- detects no-warning, too-late, after-event, pending, and on-target cases

Gap:

- needs live mission records to become meaningful.

### Near-Miss Detector

File:

- `src/services/ops/near-miss.ts`

What it does:

- detects:
  - late warnings
  - silent signals
  - external discovery
  - unconfirmed watches
  - low follow-through

Gap:

- near-misses need to feed replay fixture generation and algorithm evaluations.

### Replay Fixtures And Harness

Files:

- `src/services/ops/replay-fixtures.ts`
- `src/services/ops/replay-harness.ts`
- `src/services/ops/replay-fixtures-catalog.ts`

What they do:

- turn missions/near-misses into replay fixtures
- check expectations like warning-before-impact, no-silent-signal, requires-confirmation, user-action-observed

Gap:

- replay currently validates mission-event expectations, not full algorithm re-execution over historical input snapshots.
- generated fixtures are not yet wired as a first-class CI/backtest gate.

### Algorithm Diagnostic Panel

File:

- `src/components/AlgorithmDiagnosticPanel.ts`

What it does:

- reads algorithm health
- shows recommendations and safe-adjustment proposal output

Gap:

- it needs real ledger data and real tunings.

## Target End State

Crystal Ball should support this operator flow:

1. An algorithm emits a decision, score, ranking, forecast, or notification decision.
2. The decision is recorded in the algorithm evaluation ledger.
3. If the decision creates or affects a real-world alert, a mission record is opened or updated.
4. When an outcome is known, the evaluation and mission are graded.
5. Algorithm health updates automatically from graded records.
6. Near-misses generate replay fixtures.
7. Replay/backtest reports prove whether a proposed adjustment would improve or regress behavior.
8. Safe adjustment proposes a bounded settings change only after enough evidence exists.
9. A human reviews and applies the adjustment.
10. The app keeps rollback information and compares algorithm versions after the change.

## First PR Recommendation

Build **PR 1: Live Evaluation Ledger Wiring**.

Do not start with automatic setting upgrades. First, make the app collect the evidence needed to know whether upgrades are justified.

### PR 1 Goal

Create a reliable path for live algorithm outputs to be recorded as evaluation records, then prove the Algorithm Diagnostic Panel can consume real samples.

### PR 1 Files

Likely touch:

- `src/services/algorithms/algorithm-evaluation-ledger.ts`
- `src/services/algorithms/algorithms-state.ts`
- `src/services/algorithms/algorithm-registry.ts`
- `src/services/algorithms/algorithm-health.ts`
- `src/components/AlgorithmDiagnosticPanel.ts`
- `src/services/intelligence/truth-score.ts` or its call sites
- `src/services/intelligence/compound-risk.ts` or its call sites
- `src/services/intelligence/negative-evidence.ts` or its call sites
- `src/services/weather/weather-urgency.ts` or its call sites
- `src/services/threat-classifier.ts` or its call sites
- `src/services/algorithms/__tests__/algorithm-evaluation-ledger.test.mts`
- `src/services/algorithms/__tests__/algorithm-health.test.mts`
- new tests for any helper added

### PR 1 Tasks

1. Add a small `recordAlgorithmDecision` helper.
2. Keep pure scorers pure. Prefer recording at orchestrator/call-site boundaries.
3. Require every record to include:
   - algorithm id
   - algorithm version
   - domain
   - decision time
   - duration
   - score or label
   - compact detail fields
   - input hash, not raw input
4. Normalize algorithm ids so registry, ledger, and health reports join correctly.
5. Add a deterministic test proving a recorded decision appears in health after it is graded.
6. Add a test proving large/raw inputs are not stored.
7. Ensure Algorithm Diagnostic Panel can show non-unknown status when fixture evaluations are loaded.

### PR 1 Acceptance Criteria

- A live or fixture algorithm decision can be recorded.
- The decision can later be graded.
- `summarizeCalibration` includes the graded decision.
- `aggregateAlgorithmHealth` produces a healthy/degraded/failing status from it.
- The diagnostic panel consumes the same ids and does not rely on a duplicate hand-built catalog.

### PR 1 Verification

Run:

```bash
npm run lint:strict
npm run typecheck:all
npx vitest run src/services/algorithms/__tests__/algorithm-evaluation-ledger.test.mts src/services/algorithms/__tests__/algorithm-health.test.mts src/services/algorithms/__tests__/algorithm-registry.test.mts
```

If the repo wraps tests differently, use the package script but keep the same targeted files.

## Second PR Recommendation

Build **PR 2: Mission Ledger Live Wiring**.

### PR 2 Goal

Turn real important alerts/notifications into mission records so Crystal Ball can measure whether it warned early enough.

### PR 2 Files

Likely touch:

- `src/services/ops/mission-ledger.ts`
- `src/services/ops/time-to-warn.ts`
- `src/services/ops/effectiveness.ts`
- `src/services/notification-router.ts`
- `src/services/notification-dispatcher.ts`
- `src/services/situation-engine.ts`
- `src/services/unified-alerts.ts`
- `src/services/weather/weather-warning-router.ts`
- `src/services/diagnostics/export-bundle.ts`
- `src/services/ops/__tests__/mission-ledger.test.mts`
- `src/services/ops/__tests__/time-to-warn.test.mts`
- `src/services/ops/__tests__/closed-loop-batch.test.mts`

### PR 2 Tasks

1. Add a mission-state singleton or persistence adapter.
2. Open missions for high-value cases:
   - severe weather affecting saved places
   - local infrastructure critical alerts
   - cyber exposure affecting watched assets
   - compound risk at severe/critical
3. Record timeline events:
   - `weak_signal`
   - `app_watch`
   - `user_notified`
   - `official_confirmed`
   - `estimated_impact`
   - `actual_impact`
   - `user_acknowledged`
   - `user_action_taken`
   - `forecast_resolved`
   - `near_miss`
4. Include originating algorithm id when a model opened or escalated the mission.
5. Add mission data to diagnostics export.

### PR 2 Acceptance Criteria

- A warning decision opens or updates a mission.
- A notification records `user_notified`.
- A resolved event can produce time-to-warn metrics.
- A missed/late mission can be detected as a near-miss.

### PR 2 Verification

Run:

```bash
npm run lint:strict
npm run typecheck:all
npx vitest run src/services/ops/__tests__/mission-ledger.test.mts src/services/ops/__tests__/time-to-warn.test.mts src/services/ops/__tests__/closed-loop-batch.test.mts
```

## Third PR Recommendation

Build **PR 3: Replay Fixtures From Real Misses**.

### PR 3 Goal

Make missed or late warnings automatically become regression fixtures.

### PR 3 Files

Likely touch:

- `src/services/ops/near-miss.ts`
- `src/services/ops/replay-fixtures.ts`
- `src/services/ops/replay-harness.ts`
- `src/services/ops/replay-fixtures-catalog.ts`
- `src/services/ops/__tests__/replay-harness.test.mts`
- `src/services/ops/__tests__/replay-fixtures-catalog.test.mts`
- `src/services/ops/__tests__/closed-loop-batch.test.mts`

### PR 3 Tasks

1. Add a batch function that:
   - reads missions
   - detects near-misses
   - generates replay fixtures
   - runs replay
   - emits a report
2. Add stable fixture catalog cases for known failure patterns:
   - late severe weather warning
   - silent weak signal
   - unconfirmed watch
   - low follow-through warning
3. Keep generated local/user fixtures out of git unless sanitized and intentionally promoted.
4. Add CI-friendly tests for the fixture catalog.

### PR 3 Acceptance Criteria

- A near-miss becomes a replay fixture.
- The replay harness fails for the bad behavior.
- The harness passes when expected mission events are present.
- Fixture output is deterministic and JSON-serializable.

### PR 3 Verification

Run:

```bash
npm run lint:strict
npm run typecheck:all
npx vitest run src/services/ops/__tests__/closed-loop-batch.test.mts src/services/ops/__tests__/replay-harness.test.mts src/services/ops/__tests__/replay-fixtures-catalog.test.mts
```

## Fourth PR Recommendation

Build **PR 4: Safe Tunable Settings Proposals**.

### PR 4 Goal

Allow algorithms to propose bounded settings upgrades after backtest/health evidence shows a problem.

### PR 4 Files

Likely touch:

- `src/services/algorithms/safe-adjustment.ts`
- `src/services/algorithms/algorithms-state.ts`
- `src/components/AlgorithmDiagnosticPanel.ts`
- algorithm modules with real thresholds:
  - weather urgency thresholds
  - correlation windows/radii
  - relevance thresholds
  - confidence penalties
  - notification thresholds
- `src/services/algorithms/__tests__/safe-adjustment.test.mts`

### PR 4 Tasks

1. Add a tunable registry with:
   - algorithm id
   - parameter id
   - current value
   - min/max
   - step
   - direction to fix misses
   - rollback value
2. Start with low-risk tunables:
   - relevance threshold
   - stale-data confidence penalty
   - digest ranking weight
3. Add safety-critical tunables only after enough graded samples exist:
   - weather urgency threshold
   - polygon buffer
   - critical notification bypass threshold
4. Require replay/backtest report attachment before showing an `apply` recommendation for higher-risk settings.
5. Keep changes human-approved. Do not auto-apply.

### PR 4 Acceptance Criteria

- Diagnostic panel shows real proposed setting changes when health is degraded/failing.
- Safety-critical proposals use conservative half-steps.
- Proposals cannot exceed declared bounds.
- Every proposal includes rollback instructions.
- No setting is automatically changed without explicit approval.

### PR 4 Verification

Run:

```bash
npm run lint:strict
npm run typecheck:all
npx vitest run src/services/algorithms/__tests__/safe-adjustment.test.mts src/services/algorithms/__tests__/algorithm-health.test.mts
```

## Fifth PR Recommendation

Build **PR 5: Backtest Before Apply**

### PR 5 Goal

Before a setting proposal can be accepted, run replay/backtest against available fixtures and compare current vs proposed behavior.

### Design

Add a comparison layer:

```text
current settings + fixtures -> baseline replay report
proposed settings + fixtures -> candidate replay report
candidate must improve target metric and not regress safety gates
```

### Files

Likely touch:

- `src/services/ops/replay-harness.ts`
- `src/services/ops/replay-fixtures.ts`
- `src/services/algorithms/safe-adjustment.ts`
- new `src/services/algorithms/backtest-adjustment.ts`
- tests under `src/services/algorithms/__tests__/`

### Tasks

1. Add a pure function that compares baseline and candidate replay reports.
2. Define gates:
   - no new safety-critical failures
   - no worse time-to-warn for safety domains
   - fewer or equal silent signals
   - fewer misses or better weighted hit rate
3. Attach comparison result to adjustment proposals.
4. Show `blocked_by_backtest` or similar when a candidate fails.

### Acceptance Criteria

- A proposed setting can be rejected by replay evidence.
- A proposed setting can be marked eligible when it improves target metrics without safety regressions.
- The comparison result is deterministic and JSON-serializable.

### Verification

Run:

```bash
npm run lint:strict
npm run typecheck:all
npx vitest run src/services/algorithms/__tests__/safe-adjustment.test.mts src/services/ops/__tests__/replay-harness.test.mts
```

Add targeted tests for the new comparison layer.

## Safety Rules

- Do not auto-apply changes to safety-critical algorithms.
- Do not use user engagement alone as truth.
- Do not let a single miss trigger a setting change without sample-size gates.
- Do not store raw sensitive inputs in algorithm ledgers.
- Do not promote local/private replay fixtures to git without sanitization.
- Do not allow backtest improvement on one metric to regress no-warning or after-event safety cases.
- Do not merge registry ids that break historical evaluation records without migration handling.

## Suggested Data Model Additions

### Evaluation Detail

Use compact details like:

```ts
{
  sourceCount: 2,
  domain: 'weather',
  severity: 'high',
  threshold: 0.7,
  outputLabel: 'notify',
  inputHash: 'sha256:...'
}
```

Avoid:

- raw provider responses
- full alert bodies
- user private notes
- precise private location unless already stored in a user-approved mission record

### Backtest Comparison

Suggested shape:

```ts
interface BacktestComparison {
  proposalId: string;
  generatedAt: number;
  baseline: {
    fixtureCount: number;
    pass: number;
    fail: number;
    safetyFailures: number;
  };
  candidate: {
    fixtureCount: number;
    pass: number;
    fail: number;
    safetyFailures: number;
  };
  verdict: 'eligible' | 'blocked' | 'inconclusive';
  reason: string;
}
```

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

Also run targeted tests for every touched service.

Avoid relying on broad `npm run lint` until its current repo/worktree scope issue is fixed. Use `lint:strict` and targeted lint/test commands for the changed files.

## Claude Prompt

```text
You are working in /Users/bradleybond/Developer/crystalball.

Goal: build Crystal Ball's backtest-and-safe-self-improvement loop.

Read first:
- AGENTS.md
- docs/CLAUDE_BACKTEST_SELF_IMPROVEMENT_HANDOFF_2026-04-28.md
- docs/ALGORITHM_DIAGNOSTICS_SELF_IMPROVEMENT_PLAN.md
- docs/CLOSED_LOOP_INTELLIGENCE_OPERATIONS_PLAN.md
- docs/CLAUDE_ALGORITHM_SYSTEM_ENHANCEMENTS_2026-04-28.md

Do not commit to main. Do not push to upstream/origin. Stage specific files by name only.

Start with PR 1, not automatic setting upgrades:
1. Normalize algorithm ids between algorithm-registry, algorithms-state, evaluation-ledger, and algorithm-health.
2. Add a small recording helper for live algorithm decisions. Keep pure algorithm modules pure; record at call-site/orchestrator boundaries.
3. Wire at least truth-score, compound-risk, negative-evidence, weather-urgency, and threat-classifier or their nearest live call sites into the evaluation ledger.
4. Add tests proving a recorded decision can be graded and then appears in algorithm health.
5. Add tests proving raw large/sensitive inputs are not stored.
6. Confirm AlgorithmDiagnosticPanel can consume real fixture evaluations without duplicate catalog drift.

After PR 1, proceed in this order:
- wire real alert/notification flows into Mission Ledger
- generate replay fixtures from near-misses
- add safe tunable settings proposals
- add backtest-before-apply comparison gates

Safety requirements:
- no unreviewed auto-apply for safety-critical algorithms
- sample-size gates before adjustment proposals
- rollback info for every proposal
- replay/backtest evidence before applying high-risk settings
- no raw sensitive input storage in ledgers

Before claiming done, run:
npm run lint:strict
npm run typecheck:all
npm run secrets:scan
npm run test:api
npm run test:sidecar
npm run build

Also run targeted tests for the services you touched and report exact files changed, tests run, remaining risks, and which PR stage you completed.
```
