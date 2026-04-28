# Claude Next-Level Self-Learning Roadmap - 2026-04-28

## Purpose

This document describes what to build after the baseline diagnostics, self-learning, and self-correction gaps are closed.

The next level is to move Crystal Ball from:

```text
self-diagnosing app
```

to:

```text
local intelligence operations system
```

That means Crystal Ball should not only know what failed. It should predict likely failures, test better algorithm versions in shadow mode, generate counterfactuals, and recommend safe repairs with evidence.

## Build Order

### 1. Failure Prediction

Goal:

Predict capability degradation before the user depends on the capability.

Example:

```text
Weather warning capability is likely to become unsafe in the next hour because NWS latency is rising, sidecar retries are up, and notification permission is missing.
```

Inputs:

- provider health trend
- source freshness trend
- sidecar reachability
- notification permission and dispatch trace
- panel health
- mission ledger activity
- algorithm evaluation latency/error trend
- user configuration gaps, such as missing saved places

Files to inspect first:

- `src/services/diagnostics/system-health.ts`
- `src/services/diagnostics/provider-redundancy.ts`
- `src/services/diagnostics/sentinel-feed-audit.ts`
- `src/services/diagnostics/notification-trace.ts`
- `src/services/ops/capability-readiness.ts`
- `src/services/algorithms/algorithm-health.ts`

Implementation idea:

- Add `src/services/diagnostics/failure-prediction.ts`.
- Compute per-capability risk of failure over the next time window.
- Start with simple deterministic rules, not ML:
  - provider latency rising + recent failures = elevated risk
  - critical source stale + active hazard context = unsafe risk
  - notification permission denied + severe weather risk = unsafe
  - sidecar unreachable + desktop-only source = failing
- Emit recommendations and diagnostic events.

Validation:

```bash
npm run lint:strict
npm run typecheck:all
npx vitest run src/services/diagnostics/__tests__/system-health.test.mts src/services/diagnostics/__tests__/provider-redundancy.test.mts
```

Add tests for healthy, degraded, failing, and unsafe prediction cases.

### 2. Counterfactual Replay

Goal:

For every missed or late warning, ask:

```text
What setting or algorithm behavior would have changed the outcome?
```

Current replay checks mission timelines. Counterfactual replay should evaluate "what if" settings against historical fixtures.

Examples:

- What if weather urgency threshold had been lower?
- What if polygon buffer had been wider?
- What if digest-tier alert had been banner-tier?
- What if source confidence penalty had been stronger?
- What if a noisy source had been ignored?

Files to inspect first:

- `src/services/ops/replay-harness.ts`
- `src/services/ops/replay-fixtures.ts`
- `src/services/ops/replay-fixtures-catalog.ts`
- `src/services/algorithms/safe-adjustment.ts`
- `src/services/weather/weather-warning-router.ts`
- `src/services/weather/weather-urgency.ts`

Implementation idea:

- Add `src/services/ops/counterfactual-replay.ts`.
- Add a `CounterfactualScenario` shape:
  - fixture id
  - baseline settings
  - candidate settings
  - expected improvement
  - safety gates
  - verdict
- Start with weather urgency because weather has the clearest mission bridge.
- Do not use counterfactuals to auto-apply settings. Use them to produce evidence for a human-reviewed proposal.

Validation:

```bash
npm run lint:strict
npm run typecheck:all
npx vitest run src/services/ops/__tests__/replay-harness.test.mts src/services/ops/__tests__/replay-fixtures-catalog.test.mts
```

Add tests proving a candidate can be eligible, blocked, or inconclusive.

### 3. Shadow-Mode Algorithms

Goal:

Run new algorithm versions silently beside current versions, compare decisions, and promote only after evidence accumulates.

Example:

```text
weather-urgency-v1 sent digest
weather-urgency-v2 would have sent banner
outcome: v2 was right
```

Files to inspect first:

- `src/services/algorithms/algorithm-registry.ts`
- `src/services/algorithms/record-evaluation.ts`
- `src/services/algorithms/algorithm-evaluation-ledger.ts`
- `src/services/algorithms/algorithm-health.ts`
- `src/services/weather/weather-urgency.ts`
- `src/services/weather/weather-warning-router.ts`

Implementation idea:

- Add `src/services/algorithms/shadow-mode.ts`.
- Add a `ShadowDecisionRecord` or reuse evaluation records with `version` and `label`.
- Run candidate algorithm versions without dispatch side effects.
- Record:
  - production decision
  - shadow decision
  - divergence reason
  - outcome once known
- Add health summary by algorithm version.

Safety rules:

- shadow algorithms must never dispatch notifications directly
- no user-visible actions from shadow runs
- no promotion without minimum sample size
- safety-critical promotion requires replay pass and no worse no-warning/after-event outcomes

Validation:

```bash
npm run lint:strict
npm run typecheck:all
npx vitest run src/services/algorithms/__tests__/algorithm-evaluation-ledger.test.mts src/services/algorithms/__tests__/algorithm-health.test.mts
```

### 4. Domain-Specific Mission Scorecards

Goal:

Each mission domain should have a scorecard that answers whether Crystal Ball is doing its job.

Domains:

- weather safety
- cyber exposure
- conflict escalation
- food/commodity shortage
- energy/fuel stress
- travel disruption
- market/portfolio risk
- local infrastructure

Scorecard dimensions:

- time-to-warn
- false positives
- false negatives
- data quality
- user acknowledgement
- user action/follow-through
- confidence debt
- open near-misses
- provider redundancy
- algorithm health

Files to inspect first:

- `src/services/ops/effectiveness.ts`
- `src/services/ops/time-to-warn.ts`
- `src/services/ops/near-miss.ts`
- `src/services/ops/mission-ledger.ts`
- `src/services/diagnostics/system-health.ts`
- `src/services/algorithms/algorithm-health.ts`

Implementation idea:

- Add `src/services/ops/mission-scorecard.ts`.
- Compute one scorecard per `MissionDomain`.
- Feed scorecards into diagnostics export and a panel later.

Validation:

```bash
npm run lint:strict
npm run typecheck:all
npx vitest run src/services/ops/__tests__/time-to-warn.test.mts src/services/ops/__tests__/closed-loop-batch.test.mts
```

### 5. Active Learning Queue

Goal:

When Crystal Ball lacks evidence, it should identify the most valuable next data point.

Examples:

```text
Need confirmation source for this cyber exposure.
Need official outage confirmation.
Need user feedback: was this alert useful?
Need saved place to personalize weather warnings.
Need provider key to close aviation blind spot.
```

Files to inspect first:

- `src/services/intelligence/confidence-explanation.ts`
- `src/services/intelligence/negative-evidence.ts`
- `src/services/ops/capability-readiness.ts`
- `src/services/diagnostics/system-health.ts`
- `src/services/relevance-learner.ts`
- `src/services/source-feedback.ts`

Implementation idea:

- Add `src/services/learning/active-learning-queue.ts`.
- Queue items should include:
  - id
  - reason
  - expected value
  - domain
  - action type
  - expiresAt
  - privacy/sensitivity level
- Start with deterministic ranking:
  - safety-critical gaps first
  - gaps blocking multiple capabilities next
  - stale/unknown evidence next
  - optional user-feedback prompts last

Safety rules:

- never interrupt during urgent alerts
- user feedback can tune relevance/noise, not factual truth by itself
- privacy-sensitive asks must be explicit

Validation:

```bash
npm run lint:strict
npm run typecheck:all
```

Add targeted tests for ranking, expiry, and privacy classification.

### 6. Safety Case Dashboard

Goal:

Show why Crystal Ball is currently safe or unsafe to trust for critical warnings.

Core question:

```text
Can I trust Crystal Ball for critical warnings right now?
```

Dashboard should show:

- critical capability readiness
- notification path status
- provider redundancy
- saved-place coverage
- algorithm health
- recent unsafe suppressions
- open blind spots
- current confidence debt
- last self-test result
- recommended operator actions

Files to inspect first:

- `src/services/diagnostics/system-health.ts`
- `src/services/ops/capability-readiness.ts`
- `src/services/diagnostics/self-test.ts`
- `src/services/diagnostics/export-bundle.ts`
- `src/components/AlgorithmDiagnosticPanel.ts`
- `src/components/SystemDiagnosticPanel.ts` if present

Implementation idea:

- Add a pure `safety-case.ts` service first.
- UI can come later.
- The service should output:
  - `safe_to_trust`
  - `degraded_but_usable`
  - `unsafe_do_not_rely`
  - reasons
  - required actions

Validation:

```bash
npm run lint:strict
npm run typecheck:all
npx vitest run src/services/diagnostics/__tests__/system-health.test.mts src/services/diagnostics/__tests__/self-test.test.mts
```

### 7. Autonomous Repair Recommendations

Goal:

Recommend concrete repairs, not vague warnings.

Examples:

- re-enable provider
- request notification permission
- add saved place
- refresh sidecar
- lower relevance threshold
- widen polygon buffer
- disable noisy source
- queue provider key setup
- rebuild stale cache

Files to inspect first:

- `src/services/diagnostics/system-health.ts`
- `src/services/ops/capability-readiness.ts`
- `src/services/algorithms/safe-adjustment.ts`
- `src/services/source-feedback.ts`
- `src/services/correlation-feedback.ts`

Implementation idea:

- Add `src/services/diagnostics/repair-recommendations.ts`.
- Normalize all recommendations into one shape:
  - id
  - severity
  - confidence
  - action type
  - target
  - reason
  - expected impact
  - risk
  - rollback
- Separate user actions from code/config actions.

Safety rules:

- recommendations are allowed
- automatic repair should be limited to low-risk local actions
- safety-critical algorithm changes require human approval and replay evidence

Validation:

```bash
npm run lint:strict
npm run typecheck:all
```

Add targeted tests for recommendation sorting and deduplication.

### 8. Multi-Agent Review Loop

Goal:

Have Crystal Ball generate evidence bundles that agents can inspect and turn into targeted PRs.

Flow:

```text
diagnostic bundle -> agent review -> proposed repair plan -> PR -> replay/backtest -> merge
```

Files to inspect first:

- `src/services/diagnostics/export-bundle.ts`
- `src/services/diagnostics/diagnostic-events.ts`
- `docs/CLAUDE_SYSTEM_DIAGNOSTICS_SELF_LEARNING_GAP_SCAN_2026-04-28.md`
- `docs/CLAUDE_BACKTEST_SELF_IMPROVEMENT_HANDOFF_2026-04-28.md`

Implementation idea:

- Add an "agent handoff bundle" export mode.
- Include:
  - system health
  - recent diagnostic events
  - algorithm health
  - recent evaluations
  - missions and near-misses
  - replay report summary
  - pending repair recommendations
  - reproduction hints
- Keep it redacted and capped.

Validation:

```bash
npm run lint:strict
npm run typecheck:all
npx vitest run src/services/diagnostics/__tests__/export-bundle.test.mts
```

## Highest-Value Moonshot

The most valuable advanced build is:

```text
shadow-mode algorithms + counterfactual replay
```

Why:

- Shadow mode lets Crystal Ball test better versions without risking user-facing behavior.
- Counterfactual replay lets it prove whether a settings change would have prevented a miss.
- Together, they turn "we should tune this" into evidence-backed proposals.

Recommended first moonshot slice:

1. Add weather urgency v2 in shadow mode.
2. Record production vs shadow decisions.
3. Link decisions to weather missions.
4. Resolve outcomes with time-to-warn.
5. Generate a promotion report:
   - sample size
   - divergences
   - v1 wins
   - v2 wins
   - safety regressions
   - recommendation

Do not auto-promote. Produce a recommendation only.

## Suggested PR Sequence

### PR 1 - Failure Prediction

Add deterministic capability failure prediction based on current health trends.

### PR 2 - Counterfactual Replay

Add scenario comparison for missed/late warnings.

### PR 3 - Shadow-Mode Algorithms

Run candidate algorithm versions silently and compare outcomes.

### PR 4 - Mission Scorecards

Add per-domain scorecards with time-to-warn, false positives, false negatives, and confidence debt.

### PR 5 - Active Learning Queue

Rank the next best evidence, user feedback, or configuration ask.

### PR 6 - Safety Case

Add a pure safety-case service answering whether critical warnings are trustworthy right now.

### PR 7 - Repair Recommendations

Normalize system, algorithm, provider, and user-action repairs into one ranked queue.

### PR 8 - Agent Handoff Bundle

Generate a redacted, capped bundle designed for Claude/Codex repair sessions.

## Full Verification

Before claiming any PR complete:

```bash
npm run lint:strict
npm run typecheck:all
npm run secrets:scan
npm run test:api
npm run test:sidecar
npm run build
```

Also run targeted tests for every touched module.

## Claude Prompt

```text
You are working in /Users/bradleybond/Developer/crystalball.

Goal: push Crystal Ball beyond baseline self-diagnostics into a local intelligence operations system using docs/CLAUDE_NEXT_LEVEL_SELF_LEARNING_ROADMAP_2026-04-28.md.

Read first:
- AGENTS.md
- docs/CLAUDE_NEXT_LEVEL_SELF_LEARNING_ROADMAP_2026-04-28.md
- docs/CLAUDE_SYSTEM_DIAGNOSTICS_SELF_LEARNING_GAP_SCAN_2026-04-28.md
- docs/CLAUDE_BACKTEST_SELF_IMPROVEMENT_HANDOFF_2026-04-28.md
- docs/CLOSED_LOOP_INTELLIGENCE_OPERATIONS_PLAN.md

Do not commit to main. Do not push to upstream/origin. Stage files by explicit path only.

Start with PR 1: Failure Prediction.
Implement a pure deterministic service that predicts capability degradation before it becomes a user-facing miss.

Suggested first files:
- src/services/diagnostics/failure-prediction.ts
- src/services/diagnostics/__tests__/failure-prediction.test.mts

The first implementation should:
1. Take system health, provider health, source freshness, notification trace summary, algorithm health, and capability readiness as inputs.
2. Return per-capability predicted failure risk.
3. Classify risk as low/elevated/high/unsafe.
4. Explain each prediction with compact reasons.
5. Recommend concrete next actions.
6. Emit no side effects from the pure function.

After PR 1, continue with:
- counterfactual replay
- shadow-mode algorithms
- mission scorecards
- active learning queue
- safety case service
- repair recommendation queue
- agent handoff bundle

Safety rules:
- no automatic safety-critical setting changes
- no user-facing action from shadow algorithms
- no private raw payloads in replay fixtures or handoff bundles
- user feedback tunes relevance/noise, not factual truth by itself
- promotion of any algorithm version requires sample-size and replay gates

Before claiming done, run:
npm run lint:strict
npm run typecheck:all
npm run secrets:scan
npm run test:api
npm run test:sidecar
npm run build

Also run targeted tests for every touched module and report exact files changed, tests run, remaining risks, and which PR stage you completed.
```
