# Algorithm Diagnostics and Self-Improvement Plan

Use this plan to verify whether Crystal Ball's algorithms are working and to let them improve the user experience safely over time.

Short answer: Crystal Ball already has pieces of algorithm diagnostics and learning, but they are fragmented. The next step is to unify them into an algorithm QA layer that can answer:

```text
Which algorithms are helping?
Which are noisy?
Which are stale, overconfident, or underconfident?
Which should be adjusted?
Was the adjustment safe?
```

## Existing Algorithm Diagnostics

Current useful pieces:

- `src/services/intelligence/forecast-calibration.ts`
  - Pure deterministic forecast records, Brier score, per-domain accuracy, per-source multipliers, algorithm version tracking.
- `src/services/forecast-accuracy.ts`
  - Logs EMA/situation predictions and resolves hit/miss after 24h.
- `src/services/severity-recalibration.ts`
  - Adjusts per-source severity multipliers from hit/miss behavior.
- `src/services/hypothesis-accuracy.ts`
  - Grades analyst hypotheses after a window and produces accuracy multipliers.
- `src/services/source-feedback.ts`
  - Learns when sources are treated as noise through fast ack/snooze behavior.
- `src/services/correlation-feedback.ts`
  - Learns whether causal/correlation pairs are useful or noisy.
- `src/services/relevance-learner.ts`
  - Learns user topic/source/severity preference from engagement.
- `src/services/alert-fatigue.ts`
  - Detects bulk-dismiss patterns and suggests reducing noise.
- `src/services/intelligence/baseline-deviation.ts`
  - Tracks expected baseline behavior so anomaly claims can be measured against normal.
- `src/services/weather/weather-warning-diagnostics.ts`
  - Diagnoses severe-weather misses and suppressions.
- `src/services/reasoning-metrics.ts`
  - Tracks latency/counters for reasoning operations.
- `src/services/reasoning-debug.ts`
  - Debug ring buffer for reasoning behavior.

## Main Gaps

### 1. No Unified Algorithm Health Report

Each loop knows something, but there is no single report for algorithm health.

Needed:

- Algorithm id
- Version
- Domain
- Inputs used
- Predictions emitted
- Pending evaluations
- Resolved hits/misses
- Brier score
- Calibration error
- False-positive proxy
- False-negative proxy
- User feedback score
- Latency
- Data quality dependency status
- Current multiplier
- Recommended action

Example:

```text
Algorithm: weather-urgency-v1
Status: under-warning risk
Evidence: 2 severe weather alerts matched saved places but notification route suppressed one.
Recommendation: raise weather critical bypass priority and require diagnostic trace on every suppression.
```

### 2. No Shared Prediction Ledger

Forecasts and hypotheses are recorded in separate systems.

Needed:

- One prediction ledger for all algorithms.
- Every forecast, risk score crossing, notification decision, and situation projection should be recordable.
- Outcomes should be resolved automatically where possible.

Track:

- What was predicted
- Probability/confidence
- Horizon
- Evidence used
- Algorithm version
- Data quality at prediction time
- Outcome
- Resolution method

### 3. No Algorithm Change Control

Algorithms can produce multipliers, but there is no safe promotion system.

Needed:

- Proposed adjustment
- Reason
- Expected impact
- Confidence
- Guardrail checks
- Max adjustment per day
- Rollback path
- User-visible explanation

Algorithm self-improvement should be bounded, local, explainable, and reversible.

### 4. No False-Negative Tracking

The app tracks some misses, but false negatives are the key issue for a Crystal Ball app.

Needed examples:

- Severe weather happened but no warning fired.
- Major event entered news but Big Event Detector did not promote it.
- Commodity shortage risk spiked after no earlier watch.
- User searched/opened a topic that was not surfaced.

False negatives should generate diagnostics and model adjustments.

### 5. No Drift Detection

Algorithms can become stale when conditions change.

Needed:

- Calibration drift
- Source behavior drift
- Domain volume drift
- User preference drift
- Seasonal/weather baseline drift
- Provider reliability drift

When drift is detected, lower confidence or request recalibration.

### 6. No User-Visible Algorithm Confidence

The user should know when an algorithm is reliable or currently uncertain.

Examples:

```text
Weather urgency model: high confidence
Reason: NWS polygon match + recent successful warning route + fresh data.
```

```text
Shortage model: low confidence
Reason: price data fresh, but crop condition provider unavailable.
```

## Proposed Architecture

### Algorithm Registry

Create a registry of algorithms and what they depend on.

Suggested file:

- `src/services/algorithms/algorithm-registry.ts`

Suggested type:

```ts
interface AlgorithmDefinition {
  id: string;
  label: string;
  version: string;
  domain: string;
  ownerFeature: string;
  dependencies: {
    sources: string[];
    providers: string[];
    services: string[];
  };
  outputs: Array<'risk_score' | 'forecast' | 'notification_decision' | 'ranking' | 'situation' | 'brief'>;
  criticality: 'low' | 'medium' | 'high' | 'safety';
}
```

Initial algorithms to register:

- `weather-urgency`
- `nws-polygon-match`
- `personal-storm-mode`
- `big-event-detector`
- `confidence-urgency-matrix`
- `what-changed-digest`
- `truth-score`
- `situation-clustering`
- `negative-evidence`
- `compound-risk`
- `forecast-calibration`
- `watchlist-relevance`
- `shortage-wheat`
- `shortage-diesel`
- `relevance-learner`
- `source-feedback`
- `correlation-feedback`
- `hypothesis-accuracy`

### Algorithm Evaluation Ledger

Unify forecasts, notifications, and model outputs into one ledger.

Suggested file:

- `src/services/algorithms/algorithm-ledger.ts`

Suggested record:

```ts
interface AlgorithmEvaluationRecord {
  id: string;
  algorithmId: string;
  algorithmVersion: string;
  createdAt: number;
  horizonMs?: number;
  inputHash: string;
  outputKind: 'forecast' | 'risk_score' | 'notification' | 'ranking';
  confidence: number;
  claim: string;
  evidenceIds: string[];
  dataQuality: 'high' | 'medium' | 'low';
  status: 'pending' | 'hit' | 'miss' | 'expired' | 'manual_review';
  resolvedAt?: number;
  resolutionReason?: string;
}
```

### Algorithm Health Aggregator

Create a rollup from:

- forecast calibration
- hypothesis accuracy
- source feedback
- correlation feedback
- relevance learner stats
- alert fatigue
- data diagnostics
- reasoning metrics

Suggested file:

- `src/services/algorithms/algorithm-health.ts`

Output:

```ts
interface AlgorithmHealth {
  algorithmId: string;
  status: 'healthy' | 'watch' | 'degraded' | 'unsafe' | 'unknown';
  brier?: number;
  calibrationError?: number;
  hitRate?: number;
  falsePositiveRisk?: number;
  falseNegativeRisk?: number;
  userNoiseScore?: number;
  latencyP95?: number;
  dataQualityPenalty?: number;
  recommendedAdjustment?: AlgorithmAdjustment;
  explanation: string[];
}
```

### Safe Adjustment Engine

Allow algorithms to improve themselves only through bounded local adjustments.

Suggested file:

- `src/services/algorithms/algorithm-adjustments.ts`

Allowed adjustments:

- Source multiplier changes
- Relevance boost/dampen
- Correlation pair multiplier
- Notification threshold nudge
- Watch-window duration nudge
- Confidence penalty for stale dependencies
- Ranking weight adjustment

Forbidden without user/PR review:

- Disabling safety-critical alerts
- Lowering tornado/flash flood/destructive wind urgency below critical when inside polygon
- Increasing notification spam without fatigue guard
- Removing sources from critical paths
- Changing hard safety thresholds by more than a small daily cap

Guardrails:

- Max adjustment per algorithm per day
- Minimum sample size
- Rollback stored locally
- Explanation required
- Never silence safety-critical weather purely from engagement feedback
- Ghost Mode does not learn new user behavior

### Algorithm Diagnostics UI

Add a tab to System Diagnostics or a dedicated panel.

Show:

- Algorithm status
- Accuracy/calibration
- Pending predictions
- Recent misses
- Recent self-adjustments
- False-negative warnings
- Data quality dependencies
- Reset/rollback buttons

## Self-Improvement Flow

1. Algorithm emits a forecast/ranking/notification decision.
2. Ledger records input hash, output, confidence, evidence, and algorithm version.
3. Outcome resolver grades it later.
4. Health aggregator updates accuracy/noise/drift metrics.
5. Safe adjustment engine proposes bounded adjustment.
6. Guardrails approve/reject.
7. Adjustment is applied locally with an explanation.
8. Future outputs include "adjusted because..." in diagnostics.

## Examples

### Weather Miss

```text
Event: Severe Thunderstorm Warning overlapped Home.
Expected: critical notification.
Actual: suppressed by quiet hours.
Outcome: miss.
Adjustment: weather critical bypass recommendation elevated.
Guardrail: requires user setting, does not auto-bypass without permission.
```

### Noisy Correlation Pair

```text
Event: fire -> air-quality correlations repeatedly fast-acked.
Outcome: noisy.
Adjustment: pair multiplier 1.0 -> 0.85.
Guardrail: min 3 samples, max -0.15/day.
```

### Useful Shortage Signal

```text
Event: diesel stress risk rose to Elevated.
Outcome: price/inventory confirmation arrived within watch window.
Adjustment: diesel model transport + inventory weights +0.05.
Guardrail: min 5 resolved predictions before model weight adjustment.
```

## Implementation Plan

### PR 1: Algorithm Registry and Health Types

Create the registry and shared health types.

Suggested files:

- `src/services/algorithms/algorithm-registry.ts`
- `src/services/algorithms/algorithm-health-types.ts`
- `src/services/algorithms/__tests__/algorithm-registry.test.mts`

### PR 2: Algorithm Evaluation Ledger

Create a deterministic ledger that can record and resolve algorithm outputs.

Suggested files:

- `src/services/algorithms/algorithm-ledger.ts`
- `src/services/algorithms/__tests__/algorithm-ledger.test.mts`

### PR 3: Algorithm Health Aggregator

Join calibration, feedback, fatigue, diagnostics, and metrics.

Suggested files:

- `src/services/algorithms/algorithm-health.ts`
- `src/services/algorithms/__tests__/algorithm-health.test.mts`

### PR 4: Safe Adjustment Engine

Implement bounded local adjustments with rollback.

Suggested files:

- `src/services/algorithms/algorithm-adjustments.ts`
- `src/services/algorithms/__tests__/algorithm-adjustments.test.mts`

### PR 5: Wire Critical Algorithms

Start with:

- weather urgency
- notification routing
- Big Event Detector
- shortage wheat/diesel
- truth score
- compound risk

### PR 6: Algorithm Diagnostics UI

Add a diagnostics panel/tab showing algorithm health and adjustments.

Suggested files:

- `src/components/AlgorithmDiagnosticsPanel.ts`
- `src/styles/macos-native.css`

## Best First Build

Start with:

1. Algorithm registry
2. Algorithm health types
3. Evaluation ledger
4. Health aggregator

Do not let algorithms change themselves until the ledger and health report are reliable.

## Guardrails

- Self-improvement must be local-first.
- Every adjustment must be explainable.
- Every adjustment must be reversible.
- Safety-critical weather alerts cannot be silenced by engagement learning.
- Require minimum sample sizes before changing weights.
- Cap adjustment magnitude per day.
- Separate user preference learning from factual accuracy learning.
- Track algorithm versions so old and new behavior can be compared.
- Use diagnostics to lower confidence when data is stale or missing.
- Prefer "recommend adjustment" before "auto-apply adjustment" for critical features.

## Claude Instruction

Claude should read this plan before algorithm self-improvement work.

Recommended prompt:

```text
Read docs/ALGORITHM_DIAGNOSTICS_SELF_IMPROVEMENT_PLAN.md. Implement PR 1 only: algorithm registry and shared algorithm health types with deterministic tests. Do not wire self-adjustments yet.
```
