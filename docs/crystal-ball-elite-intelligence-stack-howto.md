# Crystal Ball Elite Intelligence Stack — Claude Implementation Playbook

## Purpose

This document is a direct implementation guide for Claude.

The goal is NOT to build more complexity for its own sake.

The goal is to maximize:

- utility
- decision quality
- signal-to-noise ratio
- explainability
- user trust
- early warning value
- survivability usefulness
- personalization
- cognitive clarity

Crystal Ball should evolve into:

> A practical, explainable, decision-support intelligence system.

Not a noisy threat dashboard.

---

# Core Product Philosophy

Every algorithm must answer at least one of these:

```text
What matters?
Why does it matter?
How sure are we?
What changed?
What happens next?
What should the user do?
What should the user watch?
What could invalidate this?
```

If an algorithm does not improve:

- decision quality
- time advantage
- clarity
- trust
- actionability

then it should not interrupt the user.

---

# The Elite Intelligence Stack

Implement these systems first.

Priority order matters.

---

# 1. Decision Quality Engine

## Goal

Determine whether an alert improves user decision-making.

## Product Rule

The app should not optimize for:

```text
Most dramatic
Most viral
Most severe globally
```

It should optimize for:

```text
Most useful to the user
```

---

## Inputs

- user relevance
- actionability
- urgency
- confidence
- consequence severity
- time sensitivity
- route/home/work impact
- survivability impact

---

## Output

```ts
export interface DecisionQualityScore {
  eventId: string;

  relevance: number;
  actionability: number;
  urgency: number;
  confidence: number;
  consequence: number;
  timeSensitivity: number;

  decisionValue: number;

  reasons: string[];
}
```

---

## Claude Instructions

Create:

```text
src/lib/elite/decisionQuality.ts
```

Build helper functions:

```ts
scoreRelevance()
scoreActionability()
scoreUrgency()
scoreTimeSensitivity()
scoreConsequence()
```

Combine into:

```ts
computeDecisionValue()
```

---

## UI Requirement

Show:

```text
Why this matters to YOU
```

not just:

```text
Global threat level
```

---

# 2. Actionability Engine

## Goal

Estimate whether the user can realistically do something useful.

---

## Questions

```text
Can the user act?
How difficult is action?
How much time exists?
Does waiting increase cost/risk?
```

---

## Output

```ts
export interface ActionabilityAssessment {
  eventId: string;
  actionabilityScore: number;
  recommendedActionWindow?: string;
  costOfDelay: number;
  easeOfAction: number;
  suggestedActions: string[];
}
```

---

## Product Rule

High severity + zero actionability should usually reduce interruptions.

Example:

```text
Major distant earthquake
→ informational
```

But:

```text
Road closure affecting route home in 30 minutes
→ highly actionable
```

---

# 3. Confidence Honesty Engine

## Goal

Make uncertainty explicit.

This is critical for trust.

---

## Confidence Categories

```text
Known
Likely
Possible
Unclear
Rumored
Contradicted
Stale
```

---

## Output

```ts
export interface ConfidenceHonestyResult {
  eventId: string;
  confidenceLabel: string;
  knownFacts: string[];
  assumptions: string[];
  uncertainties: string[];
  contradictions: string[];
  staleSignals: string[];
}
```

---

## UI Requirement

Every major insight must include:

```text
What we know
What we think
What we do not know
```

---

# 4. Intelligence Triage Engine

## Goal

Prevent alert overload.

---

## Categories

```text
Ignore
Log Only
Watch
Digest
Notify
Interrupt
Emergency
```

---

## Inputs

- decision value
- urgency
- confidence
- user relevance
- escalation probability
- time advantage
- consequence severity
- actionability

---

## Output

```ts
export interface IntelligenceTriageResult {
  eventId: string;
  triageLevel:
    | 'ignore'
    | 'log_only'
    | 'watch'
    | 'digest'
    | 'notify'
    | 'interrupt'
    | 'emergency';

  reasons: string[];
}
```

---

## Product Rule

Elite intelligence systems are quiet until something matters.

---

# 5. Time Advantage Engine

## Goal

Estimate how much value exists in acting early.

---

## Example

```text
Buying fuel now = easy.
Buying fuel after panic starts = difficult.
```

---

## Inputs

- time-to-impact
- route congestion risk
- resource pressure forecast
- weather forecast
- crowd behavior probability
- infrastructure degradation rate

---

## Output

```ts
export interface TimeAdvantageResult {
  eventId: string;
  earlyActionValue: number;
  delayPenalty: number;
  optimalActionWindow?: string;
  reasons: string[];
}
```

---

# 6. Deterioration Detection Engine

## Goal

Detect worsening conditions.

This should become one of the primary triggers for escalation.

---

## Deterioration Signals

- update frequency increasing
- official language escalation
- geographic spread increasing
- more systems affected
- infrastructure degradation
- source count increasing
- higher quality sources joining
- response capability weakening

---

## Output

```ts
export interface DeteriorationAssessment {
  assessmentId: string;
  deteriorationScore: number;
  trendDirection: 'improving' | 'stable' | 'degrading' | 'rapidly_degrading';
  evidence: string[];
}
```

---

# 7. User Life Impact Engine

## Goal

Translate threats into practical life impact.

---

## Categories

- commute
- work
- internet
- power
- fuel
- food
- family
- travel
- health
- safety
- money

---

## Output

```ts
export interface LifeImpactAssessment {
  eventId: string;

  commuteImpact: number;
  workImpact: number;
  homeImpact: number;
  travelImpact: number;
  familyImpact: number;
  supplyImpact: number;
  healthImpact: number;

  explanations: string[];
}
```

---

## Product Rule

This engine matters more than global severity.

---

# 8. Evidence Ledger Engine

## Goal

Show evidence transparently.

---

## Output

```ts
export interface EvidenceLedger {
  assessmentId: string;

  evidenceFor: string[];
  evidenceAgainst: string[];
  unknowns: string[];

  sourceQualitySummary: string[];
}
```

---

## UI Requirement

Every major alert should contain:

```text
Evidence For
Evidence Against
Unknowns
```

---

# 9. Watch-Next Engine

## Goal

Tell the user what indicators matter next.

---

## Example

```text
Watch next:
- county emergency update
- power outage expansion
- route closures
- fuel station outages
```

---

## Output

```ts
export interface WatchNextIndicators {
  assessmentId: string;
  indicators: Array<{
    indicator: string;
    importance: number;
    expectedTimeframe?: string;
  }>;
}
```

---

# 10. Outcome Tracking Engine

## Goal

Allow Crystal Ball to learn from outcomes.

---

## Questions

```text
Was the prediction correct?
Was it early enough?
Was it useful?
Did escalation occur?
Was confidence accurate?
Did users respond?
```

---

## Output

```ts
export interface OutcomeTrackingResult {
  predictionId: string;
  predictionAccuracy: number;
  timingAccuracy: number;
  usefulnessScore: number;
  confidenceCalibration: number;
  lessonsLearned: string[];
}
```

---

# Shared Utility Functions

Claude should create:

```text
src/lib/elite/utils.ts
```

Include:

```ts
clamp01()
normalizeScore()
weightedAverage()
timeDecay()
distanceDecay()
confidenceLabel()
triageLabel()
trendLabel()
```

---

# Shared Types

Claude should create:

```text
src/lib/elite/types.ts
```

Store:

- assessment types
- result interfaces
- enums
- labels
- scoring helpers

---

# Shared Assessment Pipeline

Claude should create:

```text
src/lib/elite/buildEliteAssessment.ts
```

Pipeline:

```text
Normalize events
→ calculate confidence
→ calculate decision quality
→ calculate actionability
→ calculate time advantage
→ calculate deterioration
→ calculate life impact
→ build evidence ledger
→ determine watch-next indicators
→ triage alert
→ output explainable assessment
```

---

# Elite UI Requirements

## Every Important Alert Must Show

```text
What happened
Why it matters
How sure we are
What changed
What could happen next
What to watch
What you can do
What could invalidate this
```

---

# UI Layout Example

```text
CRYSTAL BALL ALERT

Threat:
Regional Infrastructure Degradation

Decision Value:
High

Confidence:
Likely

Why It Matters:
Power instability and road disruption may affect commute routes.

What Changed:
Official outage reports expanded.

Watch Next:
- route closures
- fuel outages
- utility updates

Suggested Action:
Charge devices and avoid unnecessary travel.

Evidence For:
- utility outage maps
- multiple local reports
- weather escalation

Evidence Against:
- no emergency declaration yet

Unknowns:
- duration of outage spread
```

---

# Build Order

## Phase 1

Implement:

1. confidence honesty
2. intelligence triage
3. evidence ledger
4. deterioration detection

These immediately improve trust and clarity.

---

## Phase 2

Implement:

5. decision quality
6. actionability
7. time advantage
8. watch-next indicators

These improve usefulness.

---

## Phase 3

Implement:

9. life impact
10. outcome tracking
11. learning adjustments

These improve personalization and intelligence quality.

---

# Most Important Product Rule

Crystal Ball should reduce uncertainty.

Not increase anxiety.

The system should feel:

- calm
- analytical
- explainable
- trustworthy
- actionable
- intelligent

Never:

- sensational
- doom-focused
- noisy
- overconfident
- panic-inducing

---

# Final Product Direction

Crystal Ball should evolve into:

> A calm, explainable, survivability-oriented intelligence system that helps users understand what matters before it becomes obvious.

Not just:

- a threat map
- a dashboard
- a notification feed

But:

> a practical intelligence companion for understanding the changing state of the world.
