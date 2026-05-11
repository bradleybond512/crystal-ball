# Crystal Ball — Epistemic Intelligence & Reasoning Engine Plan

## Purpose

This document defines the next major evolution of Crystal Ball beyond:

- event aggregation
- feed correlation
- situation clustering
- operational intelligence
- explainable scoring
- planetary monitoring

The next leap is:

> epistemic intelligence.

Meaning:
Crystal Ball should not merely detect events.

It should continuously reason about:

- what it believes
- why it believes it
- what contradicts those beliefs
- what assumptions support them
- what evidence is missing
- how confidence should evolve over time
- which hypotheses are competing
- what blind spots exist
- what outcomes would invalidate current reasoning
- what historically tends to happen next

This transforms Crystal Ball from:

- an intelligence dashboard

into:

- a disciplined world-state reasoning engine.

---

# Core Thesis

Most intelligence systems stop at:

```text
signal -> alert
```

More advanced systems stop at:

```text
signal -> correlation -> situation
```

Crystal Ball should evolve toward:

```text
observation
  -> evidence
    -> hypotheses
      -> beliefs
        -> situations
          -> forecasts
            -> evaluation
              -> recalibration
```

This is the cognitive spine for elite situational intelligence.

---

# 1. Belief-State Architecture

## Concept

Crystal Ball should maintain evolving belief states.

A belief is:

> a probabilistic interpretation of reality supported by evidence and constrained by uncertainty.

Examples:

- “Regional internet instability appears infrastructure-related.”
- “Port congestion pressure is worsening.”
- “Food-system fragility is increasing in this region.”
- “This military movement appears coercive rather than preparatory.”

Beliefs are not facts.
They are:

- evidence-backed interpretations.

---

## Belief State Contract

```ts
interface BeliefState {
  id: string;
  beliefStatement: string;
  domain: string;
  status: 'forming' | 'stable' | 'strengthening' | 'weakening' | 'contested' | 'invalidated';
  confidence: number;
  metaConfidence: number;
  supportingEvidence: string[];
  contradictingEvidence: string[];
  assumptions: string[];
  unresolvedQuestions: string[];
  relatedSituations: string[];
  relatedEntities: string[];
  historicalAnalogs?: string[];
  expectedSignals: ExpectedSignal[];
  invalidatingSignals: InvalidatingSignal[];
  priorStates: string[];
  createdAt: string;
  updatedAt: string;
}
```

---

## Key Behaviors

Beliefs should:

- gain confidence from corroborating evidence
- lose confidence from contradictions
- decay if evidence becomes stale
- strengthen when expected signals appear
- weaken when expected signals fail to appear
- evolve through lifecycle stages
- persist historically for replay and evaluation

---

## Claude Tasks

### PR 1 — Belief State Contracts

Add:

- `BeliefState`
- `ExpectedSignal`
- `InvalidatingSignal`
- `BeliefRevision`
- `BeliefLifecycleState`

Likely location:

```text
src/services/intelligence/contracts/
```

or:

```text
src/types/intelligence-beliefs.ts
```

### PR 2 — Belief Store

Create deterministic store/service:

```text
belief-engine.ts
```

Responsibilities:

- create beliefs
- update confidence
- track evidence
- revise states
- attach situations
- emit revisions

---

# 2. Assumption Tracking Engine

## Concept

Every major conclusion depends on assumptions.

Crystal Ball should explicitly track them.

Example:

Belief:
> “This is likely a genuine military escalation.”

Assumptions:

- aircraft telemetry is accurate
- movement differs from seasonal baseline
- official messaging remains tense
- supporting logistics appear
- no strong de-escalation indicators appear

If assumptions fail:

- confidence automatically degrades.

---

## Assumption Contract

```ts
interface Assumption {
  id: string;
  statement: string;
  importance: number;
  confidenceDependency: number;
  supportingSignals: string[];
  invalidatingSignals: string[];
  status: 'holding' | 'weakening' | 'failed' | 'uncertain';
  lastEvaluatedAt: string;
}
```

---

## Claude Tasks

### PR 3 — Assumption Tracking

Create:

```text
assumption-engine.ts
```

Responsibilities:

- evaluate assumptions
- detect failed assumptions
- adjust confidence
- emit belief revisions

### PR 4 — Assumption UI

Situation Detail should expose:

- key assumptions
- assumption health
- failed assumptions
- confidence impact

---

# 3. Competitive Hypothesis Engine

## Concept

Multiple explanations should compete.

Avoid single-narrative lock-in.

Example:

Situation:
“Large aircraft surge near Taiwan.”

Hypotheses:

- routine exercise
- coercive signaling
- escalation preparation
- logistical redeployment

Each hypothesis:

- competes for evidence
- gains/loses confidence
- defines expected signals
- defines invalidating signals

---

## Hypothesis Contract

```ts
interface Hypothesis {
  id: string;
  statement: string;
  domain: string;
  probability: number;
  confidence: number;
  expectedSignals: string[];
  invalidatingSignals: string[];
  supportingEvidence: string[];
  contradictingEvidence: string[];
  assumptions: string[];
  relatedBeliefs: string[];
  status: 'leading' | 'competitive' | 'weakening' | 'discarded';
}
```

---

## Claude Tasks

### PR 5 — Hypothesis Engine

Create:

```text
hypothesis-engine.ts
```

Responsibilities:

- manage competing hypotheses
- normalize probability weights
- update ranking
- detect convergence/divergence

### PR 6 — Hypothesis View

Situation Detail should expose:

- competing hypotheses
- probability movement
- invalidating evidence
- unresolved uncertainty

---

# 4. Meta-Confidence Layer

## Concept

Crystal Ball should model:

> confidence in the confidence system.

Examples:

- poor replay coverage
- low source redundancy
- weak calibration history
- limited historical analogs
- degraded providers
- insufficient baseline history
- high contradiction load

---

## Meta-Confidence Contract

```ts
interface MetaConfidence {
  calibrationConfidence: number;
  replayCoverageConfidence: number;
  sourceRedundancyConfidence: number;
  historicalConfidence: number;
  contradictionPenalty: number;
  freshnessPenalty: number;
  blindSpotPenalty: number;
  overallMetaConfidence: number;
}
```

---

## Claude Tasks

### PR 7 — Meta-Confidence Service

Create:

```text
meta-confidence.ts
```

### PR 8 — Confidence Explainability

Every major Situation and Belief should expose:

- confidence
- meta-confidence
- why confidence changed
- why uncertainty increased/decreased

---

# 5. Counterfactual Reasoning Engine

## Concept

Crystal Ball should reason using:

> expected consequences.

Meaning:
If a belief were true, what else should happen?

Example:

If escalation is genuine:

- additional NOTAMs expected
- embassy advisories expected
- ISR activity expected
- tanker aircraft expected
- logistics shifts expected

If these fail to appear:

- confidence weakens.

---

## Counterfactual Contract

```ts
interface CounterfactualExpectation {
  id: string;
  beliefId: string;
  expectedSignal: string;
  expectedWithinHours?: number;
  confidenceImpactIfMissing: number;
  confidenceImpactIfPresent: number;
  status: 'pending' | 'observed' | 'missing' | 'contradicted';
}
```

---

## Claude Tasks

### PR 9 — Counterfactual Engine

Create:

```text
counterfactual-engine.ts
```

Responsibilities:

- generate expected signals
- evaluate outcomes
- adjust beliefs/hypotheses

### PR 10 — Missing Expectations UI

Situation Detail should expose:

- expected but missing indicators
- invalidated expectations
- pending expectations

---

# 6. Cognitive Bias Detection Layer

## Concept

Crystal Ball should detect when reasoning may be distorted.

Bias types:

- recency bias
- confirmation bias
- sensational-source overweighting
- circular reporting
- spike overreaction
- survivorship bias
- narrative anchoring
- overfitting to prior crises

---

## Bias Finding Contract

```ts
interface BiasFinding {
  id: string;
  biasType: string;
  severity: number;
  affectedBeliefs: string[];
  explanation: string;
  mitigationSuggestion: string;
}
```

---

## Claude Tasks

### PR 11 — Bias Detection Engine

Create:

```text
bias-detection.ts
```

### PR 12 — Diagnostic Surfacing

Expose bias findings in:

- Intelligence Workbench
- Algorithm Diagnostics
- Situation Detail (advanced mode)

---

# 7. Surprise Modeling

## Concept

Crystal Ball should track:

> how surprising a signal is.

Surprise matters because:

- rare patterns often matter
- low-severity but highly abnormal events may indicate emergence

---

## Surprise Factors

- geographic rarity
- timing rarity
- domain rarity
- seasonal deviation
- historical deviation
- pattern rarity
- unusual co-occurrence
- baseline divergence

---

## Surprise Contract

```ts
interface SurpriseScore {
  score: number;
  rarityFactors: string[];
  historicalDeviation: number;
  baselineDeviation: number;
  explanation: string;
}
```

---

## Claude Tasks

### PR 13 — Surprise Engine

Create:

```text
surprise-engine.ts
```

Integrate into:

- What Changed ranking
- escalation scoring
- weak signal prioritization

---

# 8. Temporal Strategic Memory

## Concept

The app needs memory compression.

It should remember:

- what mattered
- what repeated
- what forecasts failed
- what patterns preceded escalation
- what recovery looked like

Without preserving infinite noise.

---

## Strategic Memory Layers

```text
raw events
  -> situations
    -> beliefs
      -> strategic memories
        -> learned heuristics
```

---

## Strategic Memory Contract

```ts
interface StrategicMemory {
  id: string;
  summary: string;
  relatedDomains: string[];
  historicalOutcome: string;
  leadingIndicators: string[];
  invalidatingSignals: string[];
  usefulHeuristics: string[];
  knownFailureModes: string[];
  createdFromSituations: string[];
}
```

---

## Claude Tasks

### PR 14 — Strategic Memory Store

Create:

```text
strategic-memory.ts
```

Responsibilities:

- summarize resolved situations
- extract heuristics
- feed replay/simulation
- provide analog suggestions

---

# 9. Causal Confidence Graphs

## Concept

Causal relationships should be probabilistic.

Not binary.

Example:

```text
heat wave
 -> grid strain (85%)
 -> telecom degradation (45%)
 -> transportation disruption (35%)
```

---

## Causal Edge Contract

```ts
interface CausalEdge {
  from: string;
  to: string;
  probability: number;
  confidence: number;
  typicalLagMinutes?: number;
  historicalReliability?: number;
  geographicApplicability?: string[];
}
```

---

## Claude Tasks

### PR 15 — Probabilistic Causal Graphs

Upgrade causal templates into weighted causal graphs.

### PR 16 — Causal Forecasting

Use causal graphs for:

- future shadows
- watch windows
- scenario simulation
- dependency forecasting

---

# 10. Confidence Weather Layer

## Concept

Visualize:

- uncertainty
- disagreement
- blind spots
- degraded observability
- high-confidence regions

Not just risk.

---

## UI Modes

Confidence overlays:

- high disagreement zones
- low observability regions
- stale-source regions
- weak calibration regions
- high-confidence areas

---

## Claude Tasks

### PR 17 — Confidence Weather Overlay

Add globe overlays for:

- confidence
- uncertainty
- source health
- contradiction density
- blind spots

---

# 11. Attention Allocation Engine

## Concept

Crystal Ball should dynamically allocate attention.

Not every situation deserves equal:

- compute
- refresh rate
- notification intensity
- UI prominence
- simulation depth

---

## Inputs

- uncertainty
- escalation potential
- personal relevance
- hidden dependency exposure
- severity
- novelty
- confidence movement
- strategic importance

---

## Attention Contract

```ts
interface AttentionAllocation {
  situationId: string;
  refreshPriority: number;
  computeBudget: number;
  notificationPriority: number;
  simulationPriority: number;
  reasoningDepth: number;
}
```

---

## Claude Tasks

### PR 18 — Attention Allocation Service

Create:

```text
attention-allocation.ts
```

Responsibilities:

- prioritize refreshes
- rank compute effort
- reduce unnecessary noise

---

# 12. Intelligence Economy Layer

## Concept

Measure:

> information value.

Meaning:

- which sources reduce uncertainty most
- which collection actions improve confidence most
- which signals improve lead time most
- which algorithms produce the most useful warnings

---

## Intelligence Value Contract

```ts
interface InformationValue {
  signalId: string;
  uncertaintyReduction: number;
  leadTimeContribution: number;
  contradictionResolutionValue: number;
  personalRelevanceGain: number;
  strategicValue: number;
}
```

---

## Claude Tasks

### PR 19 — Information Value Scoring

Create:

```text
information-value.ts
```

Use for:

- collection requirements
- source acquisition
- attention allocation
- notification tuning

---

# 13. Multi-Timescale Cognition

## Concept

Crystal Ball should reason across timescales.

### Immediate

- minutes
- safety-critical alerts

### Tactical

- hours
- local disruptions

### Operational

- days
- logistics and infrastructure shifts

### Strategic

- weeks/months
- geopolitical and economic stress

### Civilizational

- long-term fragility trends

---

## Claude Tasks

### PR 20 — Timescale Layering

Add timescale metadata to:

- situations
- forecasts
- beliefs
- pressures
- recommendations

---

# 14. Human-Machine Collaboration Layer

## Concept

Separate:

- deterministic findings
- AI-generated hypotheses
- analyst-confirmed conclusions
- unresolved machine speculation

This preserves:

- trust
- provenance
- explainability

---

## Intelligence Provenance Contract

```ts
interface IntelligenceProvenance {
  generatedBy: 'deterministic_engine' | 'llm' | 'human_review' | 'hybrid';
  reviewStatus: 'unreviewed' | 'reviewed' | 'contested';
  evidenceConfidence: number;
}
```

---

## Claude Tasks

### PR 21 — Provenance Layer

Attach provenance metadata to:

- narratives
- forecasts
- hypotheses
- recommendations

---

# 15. Self-Evaluation Doctrine

## Concept

Crystal Ball should evaluate itself continuously.

Questions:

- Did we warn early enough?
- Were we too noisy?
- Which assumptions failed?
- Which hypotheses won?
- Which sources misled us?
- Which indicators mattered most?
- Which alerts users acted on?
- Which forecasts failed repeatedly?

---

## Claude Tasks

### PR 22 — Self-Evaluation Dashboard

Add operational metrics for:

- calibration
- lead time
- replay accuracy
- forecast outcomes
- blind spots
- contradiction resolution
- attention allocation quality

---

# Recommended Architecture Additions

## New Folders

```text
src/services/intelligence/epistemic/
```

Suggested contents:

```text
belief-engine.ts
assumption-engine.ts
hypothesis-engine.ts
meta-confidence.ts
counterfactual-engine.ts
bias-detection.ts
surprise-engine.ts
strategic-memory.ts
attention-allocation.ts
information-value.ts
```

---

# Recommended Docs Additions

Create:

```text
docs/contracts/
```

Add:

- belief-state.md
- hypothesis.md
- assumption.md
- causal-edge.md
- meta-confidence.md
- strategic-memory.md
- intelligence-provenance.md

---

# Recommended Replay Fixtures

Add replay suites for:

- false escalation
- hidden buildup
- contradictory evidence
- recovery/stabilization
- misleading viral reporting
- infrastructure cascades
- weak-signal emergence
- assumption failure
- geopolitical feints

---

# Best Next 10 PRs

## PR 1 — Belief State Contracts

## PR 2 — Belief Engine

## PR 3 — Assumption Engine

## PR 4 — Competitive Hypothesis Engine

## PR 5 — Meta-Confidence Layer

## PR 6 — Counterfactual Reasoning

## PR 7 — Surprise Modeling

## PR 8 — Strategic Memory Store

## PR 9 — Confidence Weather Overlay

## PR 10 — Attention Allocation Engine

---

# Ultimate Strategic Shift

Crystal Ball is no longer just evolving into:

- a world monitor
- a threat map
- an alerting system
- an operational dashboard

It is evolving into:

> a calibrated epistemic engine for disciplined planetary situational reasoning.

The defining capability becomes:

Not:

- “what happened?”

But:

- “what do we currently believe?”
- “why do we believe it?”
- “what could invalidate it?”
- “what are we blind to?”
- “which hypotheses are competing?”
- “what usually happens next?”
- “how confident should we actually be?”

That is the frontier.
