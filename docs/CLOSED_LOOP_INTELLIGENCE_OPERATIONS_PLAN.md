# Closed-Loop Intelligence Operations Plan

Use this plan to make Crystal Ball measure and improve its mission performance over time.

This sits above diagnostics and algorithm self-improvement. Diagnostics answer "is the machinery working?" Algorithm health answers "are the models behaving?" Closed-loop intelligence operations answers:

```text
Did Crystal Ball help the user see the important thing early, understand it, and react well?
```

## Goal

Crystal Ball should become a closed-loop intelligence system:

1. Detects events.
2. Scores risk and confidence.
3. Warns or briefs the user.
4. Records what it decided and why.
5. Observes outcome and user reaction.
6. Finds misses, near-misses, noisy alerts, and unclear explanations.
7. Generates test fixtures.
8. Recommends or safely applies improvements.

## 1. Mission Effectiveness Score

Track whether Crystal Ball is doing its job.

Score dimensions:

- Warned in time
- Explained clearly
- User acknowledged
- User took action
- Forecast was accurate
- False positives stayed low
- False negatives stayed low
- Data quality was sufficient
- Notification behavior was appropriate

Example:

```text
Weather mission score: 82/100
Missed-alert risk: elevated
Explanation quality: good
Action usefulness: unknown
False-positive pressure: low
```

Use separate scores by mission:

- Weather safety
- Conflict escalation
- Cyber exposure
- Food/commodity shortage
- Energy/fuel stress
- Travel disruption
- Market/portfolio risk
- Local infrastructure

## 2. Time-To-Warn Metrics

For safety and crisis events, measure how much lead time Crystal Ball gave.

Examples:

- Tornado warning: 18 min before location impact
- Severe wind: 42 min before arrival
- Oil stress: 5 days before price spike
- Food stress: 30 days before FEWS NET deterioration
- Cyber KEV campaign: 6 hours before broad news coverage

This is one of the most important app-level metrics.

Track:

- event id
- domain
- first weak signal time
- first app watch time
- first user notification time
- first official confirmation time
- estimated impact time
- user acknowledgement time

Derived metrics:

- lead time
- warning latency
- acknowledgement latency
- escalation latency
- missed warning flag

## 3. Explainability QA

Score whether an alert or brief explained itself well.

Check:

- Did it say why?
- Did it cite sources?
- Did it list uncertainty?
- Did it include what changed?
- Did it include what to watch?
- Did it include action guidance?
- Did it include data gaps?
- Did it avoid unsupported claims?

Every major alert/brief should get an explanation completeness score.

Example output:

```text
Explanation score: 6/8
Missing: data gaps, invalidating indicators
```

## 4. User Outcome Feedback

Ask sparse, lightweight questions after important alerts.

Examples:

```text
Was this useful?
Too early / too late / just right?
Too noisy / too quiet?
Did you take action?
```

Rules:

- Optional
- Local-first
- Sparse
- Never interrupt during urgent alerts
- Ask after acknowledgement or resolution
- Use feedback to tune experience, not facts directly

## 5. Near-Miss Detection

Detect when Crystal Ball almost failed.

Examples:

- Alert fired after event was already underway.
- User opened weather panel before app warned them.
- Severe event occurred nearby but only digest-level notification happened.
- High-risk situation got buried below low-value alerts.
- Official confirmation arrived before Crystal Ball promoted a watch.
- User searched for a topic that the Command Center did not surface.

Near-misses should:

- create diagnostics
- lower mission score
- generate a regression fixture candidate
- recommend algorithm or notification changes

## 6. Alert Triage Accuracy

Track whether the app ranked the right things at the top.

Signals:

- User clicked top card
- User ignored top card
- User searched for lower-ranked event
- User pinned/dismissed
- Critical event later validated
- Distant but serious event was correctly deprioritized
- Personal-exposure event was promoted correctly

This improves Command Center ranking.

## 7. Decision Audit Trail

For every major alert, store a compact trace.

Example:

```text
Inputs -> score -> confidence -> urgency -> notification decision -> user action -> outcome
```

The trace should include:

- source inputs
- scoring components
- data quality
- confidence
- urgency
- personal relevance
- notification decision
- suppression/dedupe reason
- final delivery result
- user action
- outcome

This is the backbone for debugging and self-improvement.

## 8. Model/Algorithm Version A/B Ledger

When algorithms change, compare versions locally.

Example:

```text
weather-urgency-v1 would have sent Watch
weather-urgency-v2 sent Critical
outcome: v2 was correct
```

Use this to compare:

- old score vs new score
- old tier vs new tier
- old notification decision vs new notification decision
- outcome
- user feedback

This lets Crystal Ball improve without guessing.

## 9. Simulation and Replay Harness

Replay historical or saved event sequences through algorithms.

Use cases:

- severe storm miss replay
- market shock replay
- cyber campaign replay
- food shortage replay
- oil/fuel disruption replay
- notification spam replay

The replay harness should support:

- deterministic input fixtures
- expected output assertions
- old/new algorithm comparison
- notification decision replay
- explanation completeness checks

## 10. Confidence Debt

Track places where the app is making claims with weak data.

Examples:

- high risk but only one source
- critical alert but stale provider
- strong forecast but no calibration history
- personal impact unknown because no saved place
- shortage score high but commodity price feed missing

Surface as:

```text
Confidence debt: elevated
Reason: high-risk weather claim has stale radar and no lightning confirmation.
```

## 11. Notification Safety Review

Every new notification rule should be tested against:

- false-positive risk
- false-negative risk
- fatigue risk
- quiet-hours behavior
- safety-critical bypass logic
- repeat suppression
- personal relevance
- explanation completeness

This prevents fixes from creating spam.

## 12. Auto-Generated Test Fixtures From Real Events

When a miss or near-miss happens, save a sanitized fixture.

Example:

- severe wind event near home
- inputs at time of miss
- expected behavior
- actual behavior
- outcome

Claude can then convert this fixture into a regression test.

Rules:

- Redact exact private coordinates unless user opts in.
- Redact secrets and keys.
- Preserve enough geometry/timing to reproduce behavior.
- Store locally.
- Include expected behavior.

## 13. User Trust Ledger

Track what improves or damages trust.

Trust improves when:

- alert was timely
- explanation was clear
- action was useful
- forecast resolved correctly
- confidence and uncertainty were honest

Trust drops when:

- missed event
- spam
- stale data hidden
- contradiction not shown
- unexplained score jump
- action guidance was absent

This should feed mission effectiveness and UX tuning.

## 14. Capability Readiness Scores

Each capability gets a runtime score.

Example:

```text
Weather warning readiness: 72%
Missing:
- no current location
- notification permission unknown
- radar nowcasting not wired
```

Suggested capabilities:

- Weather warnings
- Storm Mode
- Big Event Detector
- Command Center
- Shortage forecasting
- ADS-B redundancy
- Notification ladder
- Forecast calibration
- Algorithm self-improvement

## 15. Autopilot Guardrails

Before any self-adjustment applies, require:

- minimum samples
- rollback record
- no safety-critical downgrade
- confidence explanation
- bounded adjustment size
- user-visible audit entry
- stale-data check
- fatigue check

Recommended policy:

- safety-critical domains: recommend first, auto-apply only after strong evidence
- personalization/noise domains: auto-apply small local changes
- source reliability: auto-adjust within bounds
- model weights: require minimum resolved predictions

## Proposed Architecture

### Mission Ledger

Suggested file:

- `src/services/ops/mission-ledger.ts`

Tracks mission events across detection, warning, action, and outcome.

### Mission Effectiveness

Suggested file:

- `src/services/ops/mission-effectiveness.ts`

Computes scores by mission/domain.

### Time-To-Warn Metrics

Suggested file:

- `src/services/ops/time-to-warn.ts`

Computes lead time and warning latency.

### Explanation QA

Suggested file:

- `src/services/ops/explanation-qa.ts`

Scores explanation completeness.

### Near-Miss Detector

Suggested file:

- `src/services/ops/near-miss-detector.ts`

Finds late, buried, suppressed, or user-discovered events.

### Replay Fixture Generator

Suggested file:

- `src/services/ops/replay-fixtures.ts`

Creates sanitized fixtures from misses and near-misses.

### Capability Readiness

Suggested file:

- `src/services/ops/capability-readiness.ts`

Scores runtime readiness by feature.

## Implementation Plan

### PR 1: Mission Ledger and Types

Add core data structures only.

Suggested files:

- `src/services/ops/mission-types.ts`
- `src/services/ops/mission-ledger.ts`
- `src/services/ops/__tests__/mission-ledger.test.mts`

### PR 2: Time-To-Warn Metrics

Add lead-time calculations and tests.

Suggested files:

- `src/services/ops/time-to-warn.ts`
- `src/services/ops/__tests__/time-to-warn.test.mts`

### PR 3: Explanation QA

Score completeness of alerts, briefs, and situation cards.

Suggested files:

- `src/services/ops/explanation-qa.ts`
- `src/services/ops/__tests__/explanation-qa.test.mts`

### PR 4: Near-Miss Detector

Detect late warnings, buried important events, and user-discovered misses.

Suggested files:

- `src/services/ops/near-miss-detector.ts`
- `src/services/ops/__tests__/near-miss-detector.test.mts`

### PR 5: Capability Readiness

Score whether key features are operational at runtime.

Suggested files:

- `src/services/ops/capability-readiness.ts`
- `src/services/ops/__tests__/capability-readiness.test.mts`

### PR 6: Replay Fixtures

Generate sanitized local fixtures for regression tests.

Suggested files:

- `src/services/ops/replay-fixtures.ts`
- `src/services/ops/__tests__/replay-fixtures.test.mts`

### PR 7: Closed-Loop Ops Panel

Add a UI surface after the services are stable.

Suggested files:

- `src/components/ClosedLoopOpsPanel.ts`
- `src/styles/macos-native.css`

## Best First Build

Start with:

1. Mission Ledger
2. Time-To-Warn Metrics
3. Explanation QA
4. Near-Miss Detector

These directly improve the app's ability to learn from missed warnings and unclear alerts.

## Guardrails

- Keep everything local-first.
- Redact private places and coordinates in generated fixtures unless the user opts in.
- Never auto-silence safety-critical alerts based only on engagement.
- Use explicit algorithm versions in comparisons.
- Store decision traces compactly.
- Keep ring buffers bounded.
- Make every mission score explainable.
- Treat false negatives as more serious than false positives for safety domains.
- Do not build UI until the scoring primitives are tested.

## Claude Instruction

Claude should read this plan before closed-loop operations work.

Recommended prompt:

```text
Read docs/CLOSED_LOOP_INTELLIGENCE_OPERATIONS_PLAN.md. Implement PR 1 only: mission types and mission ledger with deterministic tests. Do not build UI yet.
```
