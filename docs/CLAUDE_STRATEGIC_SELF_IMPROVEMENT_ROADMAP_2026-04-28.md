# Claude Strategic Self-Improvement Roadmap - 2026-04-28

## Purpose

This roadmap sits above:

- `docs/CLAUDE_SYSTEM_DIAGNOSTICS_SELF_LEARNING_GAP_SCAN_2026-04-28.md`
- `docs/CLAUDE_NEXT_LEVEL_SELF_LEARNING_ROADMAP_2026-04-28.md`

The prior docs focus on making Crystal Ball diagnosable, self-learning, self-correcting, and able to test better algorithm versions safely.

This document pushes one layer higher:

```text
self-learning system -> strategically self-improving system
```

The goal is for Crystal Ball to know not only what broke, but what improvement would most increase safety, reliability, relevance, and user trust next.

## Highest-Value Stack

Build these three first:

1. Policy Engine
2. Experiment Manager
3. Quality Debt Tracker

Together, these give Crystal Ball a way to improve aggressively without becoming reckless.

## Layer 1 - Policy Engine

### Goal

Create a local rule/policy layer that decides:

- what the app may change automatically
- what needs explicit user approval
- what must go through PR/review
- what must never be changed automatically

### Why

Self-improvement without policy becomes dangerous. Crystal Ball needs hard boundaries around safety-critical settings, private data, notification behavior, and algorithm promotion.

### Example Policies

```text
Low-risk UI ranking threshold can be locally adjusted after 20 graded samples and replay pass.
Weather critical notification threshold cannot auto-apply; requires human approval and replay pass.
Provider key configuration cannot be changed automatically.
User dismissals may tune relevance but cannot mark a fact false.
Shadow-mode algorithms cannot dispatch notifications.
```

### Files To Inspect First

- `src/services/algorithms/safe-adjustment.ts`
- `src/services/algorithms/algorithm-registry.ts`
- `src/services/ops/capability-readiness.ts`
- `src/services/diagnostics/system-health.ts`
- `src/services/diagnostics/export-bundle.ts`
- `src/services/settings-manager.ts`
- `src/services/runtime-config.ts`

### Proposed Files

- `src/services/governance/policy-engine.ts`
- `src/services/governance/__tests__/policy-engine.test.mts`

### Suggested Types

```ts
type PolicyDecision = 'allow_auto' | 'require_user_approval' | 'require_pr_review' | 'deny';

interface PolicyContext {
  actionKind: string;
  targetId: string;
  domain: string;
  criticality: 'low' | 'medium' | 'high' | 'safety';
  evidenceCount: number;
  replayPassed: boolean;
  backtestPassed: boolean;
  affectsNotifications: boolean;
  affectsPrivateData: boolean;
}

interface PolicyVerdict {
  decision: PolicyDecision;
  reason: string;
  requiredEvidence: string[];
}
```

### Acceptance Criteria

- Safety-critical settings cannot auto-apply.
- Private data changes require explicit user approval.
- Notification behavior changes require at least user approval.
- PR/review is required for behavior that affects safety-critical algorithms.
- Policy output is deterministic and JSON-serializable.

### Validation

```bash
npm run lint:strict
npm run typecheck:all
npx vitest run src/services/governance/__tests__/policy-engine.test.mts
```

## Layer 2 - Experiment Manager

### Goal

Run controlled local experiments for algorithm and UX changes.

Experiment examples:

- algorithm A/B tests
- threshold comparisons
- provider ordering experiments
- notification timing experiments
- notification wording experiments
- source weighting experiments

### Why

Shadow mode and replay can show candidate behavior, but an experiment manager gives structure:

- hypothesis
- control
- candidate
- metric
- sample size
- safety stop condition
- outcome

### Files To Inspect First

- `src/services/algorithms/algorithm-evaluation-ledger.ts`
- `src/services/algorithms/record-evaluation.ts`
- `src/services/algorithms/algorithm-health.ts`
- `src/services/ops/replay-harness.ts`
- `src/services/ops/mission-ledger.ts`
- `src/services/ops/effectiveness.ts`

### Proposed Files

- `src/services/experiments/experiment-manager.ts`
- `src/services/experiments/__tests__/experiment-manager.test.mts`

### Suggested Types

```ts
type ExperimentStatus = 'draft' | 'running' | 'paused' | 'completed' | 'stopped';

interface ExperimentDefinition {
  id: string;
  hypothesis: string;
  domain: string;
  controlVersion: string;
  candidateVersion: string;
  metrics: string[];
  minSamples: number;
  safetyStopConditions: string[];
}

interface ExperimentResult {
  experimentId: string;
  status: ExperimentStatus;
  sampleCount: number;
  controlWins: number;
  candidateWins: number;
  inconclusive: number;
  safetyStops: string[];
  recommendation: 'promote' | 'keep_control' | 'continue' | 'manual_review';
  reason: string;
}
```

### Acceptance Criteria

- Experiments can run in shadow mode without user-facing side effects.
- Experiments stop when safety stop conditions trigger.
- Results include sample size and recommendation.
- No experiment can override the Policy Engine.

### Validation

```bash
npm run lint:strict
npm run typecheck:all
npx vitest run src/services/experiments/__tests__/experiment-manager.test.mts
```

## Layer 3 - Causal Attribution Engine

### Goal

Answer:

```text
What actually caused this outcome?
```

Example:

```text
Missed warning was not primarily a weather algorithm failure. The root cause chain was: no saved place -> no polygon match -> no mission opened -> no notification.
```

### Why

Without attribution, self-correction may tune the wrong thing.

### Files To Inspect First

- `src/services/ops/mission-ledger.ts`
- `src/services/ops/time-to-warn.ts`
- `src/services/ops/near-miss.ts`
- `src/services/diagnostics/system-health.ts`
- `src/services/diagnostics/notification-trace.ts`
- `src/services/algorithms/algorithm-evaluation-ledger.ts`
- `src/services/diagnostics/diagnostic-events.ts`

### Proposed Files

- `src/services/ops/causal-attribution.ts`
- `src/services/ops/__tests__/causal-attribution.test.mts`

### Causal Categories

- missing configuration
- provider/source failure
- stale data
- algorithm threshold
- notification suppression
- dedupe/repeat suppression
- user permission
- sidecar failure
- insufficient evidence
- true negative / no fault

### Acceptance Criteria

- Given a mission, notification trace, algorithm evaluations, and diagnostic events, produce likely root causes.
- Include confidence per cause.
- Include "do not tune algorithm" when evidence points to configuration or provider failure.
- Output concrete remediation.

### Validation

```bash
npm run lint:strict
npm run typecheck:all
npx vitest run src/services/ops/__tests__/causal-attribution.test.mts
```

## Layer 4 - Trust Budget

### Goal

Track whether Crystal Ball is earning or spending user trust.

Trust should drop when the app is:

- overconfident
- noisy
- stale
- blind
- late
- wrong
- unclear

Trust should improve when the app:

- warns early
- explains clearly
- resolves accurately
- avoids false alarms
- acknowledges uncertainty
- gives useful action guidance

### Files To Inspect First

- `src/services/ops/effectiveness.ts`
- `src/services/ops/time-to-warn.ts`
- `src/services/ops/near-miss.ts`
- `src/services/ops/explanation-qa.ts`
- `src/services/diagnostics/system-health.ts`
- `src/services/relevance-learner.ts`

### Proposed Files

- `src/services/ops/trust-budget.ts`
- `src/services/ops/__tests__/trust-budget.test.mts`

### Acceptance Criteria

- Compute trust budget per mission domain.
- Explain what increased or decreased trust.
- Do not use trust budget as truth scoring.
- Feed trust debt into quality debt and safety case.

### Validation

```bash
npm run lint:strict
npm run typecheck:all
npx vitest run src/services/ops/__tests__/trust-budget.test.mts
```

## Layer 5 - Scenario Library

### Goal

Create a curated library of crisis and edge-case scenarios that become permanent regression tests.

Starter scenarios:

- tornado at night
- flash flood near saved place
- cyber zero-day exploitation
- port closure
- refinery fire
- regional blackout
- conflict escalation
- market shock
- food shortage escalation
- provider outage during active hazard

### Files To Inspect First

- `src/services/ops/replay-fixtures-catalog.ts`
- `src/services/ops/replay-fixtures.ts`
- `src/services/ops/replay-harness.ts`
- `src/services/weather/__tests__/weather-warning-router.test.mts`
- `src/services/shortage/__tests__/`

### Proposed Files

- `src/services/scenarios/scenario-library.ts`
- `src/services/scenarios/__tests__/scenario-library.test.mts`

### Acceptance Criteria

- Scenarios are deterministic and JSON-serializable.
- Scenarios do not contain private user data.
- Every scenario maps to at least one mission/replay expectation.
- CI can run the scenario catalog.

### Validation

```bash
npm run lint:strict
npm run typecheck:all
npx vitest run src/services/scenarios/__tests__/scenario-library.test.mts src/services/ops/__tests__/replay-harness.test.mts
```

## Layer 6 - Model Governance Layer

### Goal

Track algorithm versions, promotion criteria, rollback history, and why each model is trusted.

### Files To Inspect First

- `src/services/algorithms/algorithm-registry.ts`
- `src/services/algorithms/algorithm-health.ts`
- `src/services/algorithms/record-evaluation.ts`
- `src/services/algorithms/safe-adjustment.ts`

### Proposed Files

- `src/services/governance/model-governance.ts`
- `src/services/governance/__tests__/model-governance.test.mts`

### Governance Record Should Include

- algorithm id
- version
- status
- promotedAt
- promotedBy
- evidence summary
- replay result
- shadow-mode result
- rollback version
- known limitations
- safety notes

### Acceptance Criteria

- Every promoted algorithm version has an evidence record.
- Rollback target is explicit.
- Safety-critical promotions require policy approval and replay evidence.

### Validation

```bash
npm run lint:strict
npm run typecheck:all
npx vitest run src/services/governance/__tests__/model-governance.test.mts
```

## Layer 7 - Personal Resilience Model

### Goal

Learn what matters to the user without weakening truth scoring.

Inputs:

- saved places
- family locations
- travel routes
- portfolio/watchlist
- infrastructure dependencies
- notification preferences
- acknowledgement/snooze behavior

Rules:

- personalize relevance, not truth
- keep data local
- expose why something is personally relevant
- allow reset/delete

### Files To Inspect First

- `src/services/personal/personal-impact.ts`
- `src/services/situation-personalizer.ts`
- `src/services/relevance-learner.ts`
- `src/services/saved-places.ts`
- `src/services/watchlist.ts`
- `src/services/alerting-prefs.ts`

### Proposed Files

- `src/services/personal/resilience-model.ts`
- `src/services/personal/__tests__/resilience-model.test.mts`

### Acceptance Criteria

- Separates factual confidence from personal relevance.
- Provides explanation lines.
- Supports local reset/delete.
- Never sends personal model externally.

### Validation

```bash
npm run lint:strict
npm run typecheck:all
npx vitest run src/services/personal/__tests__/resilience-model.test.mts
```

## Layer 8 - Operational Playbook Engine

### Goal

When a risk is real, generate useful next actions.

Every major risk should answer:

- what to do now
- what to monitor
- who/what is affected
- what would invalidate the concern
- when to escalate

### Files To Inspect First

- `src/services/course-of-action.ts`
- `src/services/action-cards.ts`
- `src/services/watchlist-playbooks.ts`
- `src/services/insights/reaction-playbooks.ts`
- `src/services/weather/preparedness-actions.ts`

### Proposed Files

- `src/services/ops/playbook-engine.ts`
- `src/services/ops/__tests__/playbook-engine.test.mts`

### Acceptance Criteria

- Playbooks are domain-specific.
- Actions are ranked by urgency and confidence.
- Each playbook includes invalidating indicators.
- Playbooks avoid unsupported claims.

### Validation

```bash
npm run lint:strict
npm run typecheck:all
npx vitest run src/services/ops/__tests__/playbook-engine.test.mts
```

## Layer 9 - Quality Debt Tracker

### Goal

Track "intelligence quality debt" the same way engineering teams track tech debt.

Debt categories:

- missing sources
- ungraded predictions
- stale baselines
- untested domains
- noisy algorithms
- weak replay coverage
- missing mission bridges
- unresolved near-misses
- unknown algorithm health
- insufficient provider redundancy

### Files To Inspect First

- `src/services/diagnostics/system-health.ts`
- `src/services/algorithms/algorithm-health.ts`
- `src/services/ops/mission-ledger.ts`
- `src/services/ops/near-miss.ts`
- `src/services/ops/replay-fixtures-catalog.ts`
- `src/services/diagnostics/provider-redundancy.ts`

### Proposed Files

- `src/services/quality/quality-debt.ts`
- `src/services/quality/__tests__/quality-debt.test.mts`

### Acceptance Criteria

- Produce debt items with severity, owner area, impact, and recommended fix.
- Sort by safety/reliability impact.
- Include quality debt in agent handoff bundles.
- Do not mark a debt resolved without evidence.

### Validation

```bash
npm run lint:strict
npm run typecheck:all
npx vitest run src/services/quality/__tests__/quality-debt.test.mts
```

## Layer 10 - Self-Improvement Scheduler

### Goal

Periodically identify the top improvements most likely to improve safety and reliability.

Example output:

```text
Top improvements this week:
1. Add cyber exposure mission bridge.
2. Persist algorithm evaluation ledger.
3. Add replay fixture for digest-delivered weather alerts.
```

### Files To Inspect First

- `src/services/quality/quality-debt.ts`
- `src/services/diagnostics/export-bundle.ts`
- `src/services/diagnostics/system-health.ts`
- `src/services/algorithms/algorithm-health.ts`
- `src/services/ops/effectiveness.ts`

### Proposed Files

- `src/services/quality/self-improvement-scheduler.ts`
- `src/services/quality/__tests__/self-improvement-scheduler.test.mts`

### Acceptance Criteria

- Ranks improvement candidates by safety, reliability, effort, and evidence.
- Emits a Claude/Codex handoff outline for the top candidate.
- Does not create branches or PRs automatically.
- Includes why lower-ranked items were deferred.

### Validation

```bash
npm run lint:strict
npm run typecheck:all
npx vitest run src/services/quality/__tests__/self-improvement-scheduler.test.mts
```

## Recommended PR Sequence

### PR 1 - Policy Engine

Establish boundaries before adding stronger autonomous improvement.

### PR 2 - Quality Debt Tracker

Make the system's improvement needs explicit and rankable.

### PR 3 - Experiment Manager

Give shadow/counterfactual work a formal structure.

### PR 4 - Causal Attribution

Prevent the system from tuning the wrong thing.

### PR 5 - Trust Budget

Measure user trust and confidence debt per mission domain.

### PR 6 - Scenario Library

Turn crisis scenarios into permanent regression assets.

### PR 7 - Model Governance

Track algorithm promotion, rollback, and evidence.

### PR 8 - Personal Resilience Model

Personalize relevance without compromising truth.

### PR 9 - Operational Playbook Engine

Convert real risk into next actions and invalidation criteria.

### PR 10 - Self-Improvement Scheduler

Recommend the highest-value next improvement and generate agent handoff content.

## Safety Rules

- Policy Engine must gate every automatic or recommended setting change.
- Safety-critical changes require human approval and replay/backtest evidence.
- Shadow-mode algorithms must not dispatch user-facing actions.
- User feedback tunes relevance/noise, not factual truth by itself.
- Private personal model data must stay local.
- Quality debt should not be marked resolved without evidence.
- Experiment results must include sample size and safety-stop status.

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

Also run targeted tests for each touched module.

## Claude Prompt

```text
You are working in /Users/bradleybond/Developer/crystalball.

Goal: build the strategic self-improvement layer described in docs/CLAUDE_STRATEGIC_SELF_IMPROVEMENT_ROADMAP_2026-04-28.md.

Read first:
- AGENTS.md
- docs/CLAUDE_STRATEGIC_SELF_IMPROVEMENT_ROADMAP_2026-04-28.md
- docs/CLAUDE_NEXT_LEVEL_SELF_LEARNING_ROADMAP_2026-04-28.md
- docs/CLAUDE_SYSTEM_DIAGNOSTICS_SELF_LEARNING_GAP_SCAN_2026-04-28.md
- docs/CLAUDE_BACKTEST_SELF_IMPROVEMENT_HANDOFF_2026-04-28.md

Do not commit to main. Do not push to upstream/origin. Stage files by explicit path only.

Start with PR 1: Policy Engine.
Implement a pure deterministic governance service before adding stronger autonomous improvement features.

Suggested files:
- src/services/governance/policy-engine.ts
- src/services/governance/__tests__/policy-engine.test.mts

The first implementation should:
1. Define action kinds for setting changes, algorithm promotion, provider changes, notification behavior changes, personal-data changes, and replay/scenario promotion.
2. Return allow_auto, require_user_approval, require_pr_review, or deny.
3. Deny or require review for safety-critical automatic changes.
4. Require explicit approval for private data changes.
5. Require replay/backtest evidence for safety-critical algorithm promotion.
6. Produce deterministic JSON-serializable verdicts with reasons and required evidence.

After PR 1, continue with:
- quality debt tracker
- experiment manager
- causal attribution
- trust budget
- scenario library
- model governance
- personal resilience model
- operational playbook engine
- self-improvement scheduler

Safety rules:
- no automatic safety-critical setting changes
- no user-facing action from shadow algorithms
- no private raw payloads in ledgers, fixtures, exports, or handoff bundles
- user feedback tunes relevance/noise, not factual truth by itself
- quality debt cannot be marked resolved without evidence

Before claiming done, run:
npm run lint:strict
npm run typecheck:all
npm run secrets:scan
npm run test:api
npm run test:sidecar
npm run build

Also run targeted tests for every touched module and report exact files changed, tests run, remaining risks, and which PR stage you completed.
```
