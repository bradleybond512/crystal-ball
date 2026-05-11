# Crystal Ball Hypercomplex Helper Algorithms

## Purpose

This document defines advanced helper and insight algorithms for Crystal Ball. These are not just threat-scoring modules. They are supporting intelligence systems that make Crystal Ball feel like a real analyst: quieter, deeper, more contextual, more predictive, and more personal.

These algorithms should be implemented incrementally by Claude after the core Loom architecture is in place.

---

# Helper Algorithm Suite

This document adds the following advanced helper systems:

1. Signal Fusion Algorithm
2. Weak Signal Amplification Algorithm
3. Blind Spot Detection Algorithm
4. Intelligence Gap Algorithm
5. Event Freshness and Staleness Algorithm
6. Noise Suppression Algorithm
7. User Intent Relevance Algorithm
8. Watchlist Generator Algorithm
9. Next Indicator Prediction Algorithm
10. Threat Memory Algorithm
11. Pattern Recurrence Algorithm
12. Regional Normalcy Baseline Algorithm
13. Infrastructure Dependency Algorithm
14. Supply Chain Sensitivity Algorithm
15. Route Safety Algorithm
16. Alert Fatigue Governor
17. Confidence Calibration Algorithm
18. Source Conflict Arbitration Algorithm
19. Strategic Importance Algorithm
20. Explainability Ranking Algorithm
21. Local Consequence Algorithm
22. Preparedness Gap Algorithm
23. Multi-Horizon Forecast Algorithm
24. Semantic Drift Algorithm
25. Analyst Mode Summary Algorithm

---

# 1. Signal Fusion Algorithm

## Goal

Combine many weak or partial signals into one stronger intelligence assessment.

## Why It Matters

One weak signal may not matter. Five weak signals that point in the same direction may matter a lot.

## Inputs

- event signals
- source trust scores
- temporal proximity
- spatial proximity
- entity overlap
- affected systems
- narrative similarity
- anomaly scores

## Output

```ts
export interface SignalFusionResult {
  fusedSignalId: string;
  title: string;
  contributingSignals: string[];
  fusedConfidence: number;
  fusedSeverity: number;
  fusionReason: string[];
  uncertainty: string[];
}
```

## Example

```text
Weak signals:
- small local health article
- heavy rainfall
- rodent activity reports
- county emergency language
- nearby respiratory admissions mention

Fused insight:
Elevated localized rodent-borne disease exposure pattern.
```

---

# 2. Weak Signal Amplification Algorithm

## Goal

Detect early patterns before official alerts exist.

## Logic

A weak signal becomes more important when it is:

- unusual for the region
- repeated by independent sources
- connected to known risk conditions
- close to the user
- accelerating over time
- connected to vulnerable infrastructure

## Output

```ts
export interface WeakSignalAmplificationResult {
  signalId: string;
  originalScore: number;
  amplifiedScore: number;
  amplificationReasons: string[];
  recommendedStatus: 'ignore' | 'log' | 'watch' | 'elevate';
}
```

---

# 3. Blind Spot Detection Algorithm

## Goal

Detect when Crystal Ball lacks enough information about a region, event, or threat type.

## Why It Matters

No news is not the same as no risk.

## Blind Spot Types

- no sources covering a region
- stale source coverage
- conflicting reports with no official confirmation
- unavailable API category
- sparse rural reporting
- high-risk region with low telemetry

## Output

```ts
export interface BlindSpotResult {
  regionOrTopic: string;
  blindSpotScore: number;
  reason: string;
  missingSources: string[];
  suggestedDataFeeds: string[];
}
```

## UI Language

```text
Crystal Ball has limited visibility in this region. Absence of alerts should not be treated as confirmation of safety.
```

---

# 4. Intelligence Gap Algorithm

## Goal

Identify what information is missing before Crystal Ball can make a stronger assessment.

## Output

```ts
export interface IntelligenceGap {
  assessmentId: string;
  missingInformation: string[];
  whyItMatters: string[];
  confidenceImpact: number;
  suggestedQueries: string[];
}
```

## Example

```text
Missing:
- official county health confirmation
- hospital status update
- geographic case count

Impact:
Confidence remains medium until these are known.
```

---

# 5. Event Freshness and Staleness Algorithm

## Goal

Prevent old intelligence from looking current.

## Inputs

- event age
- event type
- last update time
- expected update frequency
- threat velocity

## Output

```ts
export interface FreshnessResult {
  eventId: string;
  freshnessScore: number;
  stale: boolean;
  expectedUpdateWindowHours: number;
  lastUpdatedHoursAgo: number;
  displayWarning?: string;
}
```

## Example

```text
This aviation disruption has not updated in 45 minutes and may be stale.
This disease cluster has not updated in 18 hours but remains within normal reporting delay.
```

---

# 6. Noise Suppression Algorithm

## Goal

Prevent Crystal Ball from flooding the user with low-value alerts.

## Suppress When

- event has low actionability
- far from user
- low confidence
- duplicate of existing alert
- low severity and low velocity
- already explained by another cluster
- source quality is poor

## Never Suppress When

- user exposure is high
- threat is urgent
- official emergency alert exists
- route/home/work is affected
- cascading risk is high

## Output

```ts
export interface NoiseSuppressionResult {
  eventId: string;
  suppressed: boolean;
  suppressionReason?: string;
  shouldRollIntoDigest: boolean;
  digestCategory?: string;
}
```

---

# 7. User Intent Relevance Algorithm

## Goal

Learn what kinds of intelligence the user actually cares about without making the system narrow or blind.

## Signals

- categories user opens
- dismissed alerts
- saved locations
- pinned topics
- manual searches
- route checks
- repeated interest areas

## Output

```ts
export interface UserIntentRelevanceResult {
  eventId: string;
  inferredUserInterest: number;
  explicitUserInterest: number;
  relevanceBoost: number;
  reasons: string[];
}
```

## Product Rule

User intent should boost relevance, not hide important unrelated threats.

---

# 8. Watchlist Generator Algorithm

## Goal

Automatically create dynamic watchlists based on emerging risk.

## Watchlist Examples

```text
Northern Indiana Biological Signals
Great Lakes Shipping Disruption
SBN Aviation Irregularities
Regional Grid Instability
Nearby Severe Weather Cascades
```

## Output

```ts
export interface DynamicWatchlist {
  id: string;
  title: string;
  reasonCreated: string;
  trackedEntities: string[];
  trackedRegions: string[];
  trackedIndicators: string[];
  expirationPolicy: string;
}
```

---

# 9. Next Indicator Prediction Algorithm

## Goal

Predict what Crystal Ball should watch next if a scenario is developing.

## Example

For a disease cluster:

```text
Next indicators:
- county health update
- hospital capacity language
- school absenteeism
- PPE demand
- local facility closure
```

For a port disruption:

```text
Next indicators:
- AIS congestion
- rail delay notices
- trucking reroutes
- fuel terminal delays
- price movement
```

## Output

```ts
export interface NextIndicatorPrediction {
  assessmentId: string;
  predictedIndicators: Array<{
    indicator: string;
    expectedTimeframeHours: number;
    importance: number;
    dataSourcesToWatch: string[];
  }>;
}
```

---

# 10. Threat Memory Algorithm

## Goal

Allow Crystal Ball to remember past similar events and compare them to the current situation.

## Output

```ts
export interface ThreatMemoryMatch {
  currentAssessmentId: string;
  pastEventId: string;
  similarityScore: number;
  whatIsSimilar: string[];
  whatIsDifferent: string[];
  historicalOutcome: string;
}
```

## Example

```text
This resembles a prior regional winter storm pattern, but current grid outage indicators are weaker.
```

---

# 11. Pattern Recurrence Algorithm

## Goal

Detect repeated patterns over days, weeks, or seasons.

## Examples

- same county has repeated hazmat incidents
- same port has recurring delays
- same disease signal returns after rainfall
- same route repeatedly affected by weather

## Output

```ts
export interface PatternRecurrenceResult {
  patternId: string;
  recurrenceScore: number;
  recurrenceInterval?: string;
  involvedEvents: string[];
  explanation: string;
}
```

---

# 12. Regional Normalcy Baseline Algorithm

## Goal

Know what normal looks like by region.

## Baselines

- normal weather risk
- normal earthquake frequency
- normal crime/news volume
- normal outage frequency
- normal traffic/aviation/maritime movement
- normal disease seasonality
- normal protest/civil event volume

## Output

```ts
export interface RegionalBaseline {
  regionId: string;
  category: string;
  baselineWindowDays: number;
  normalRange: {
    low: number;
    high: number;
  };
  currentValue: number;
  deviationScore: number;
}
```

---

# 13. Infrastructure Dependency Algorithm

## Goal

Understand how one infrastructure system depends on another.

## Dependency Examples

```text
Data centers depend on power, water, telecom, roads, fuel, cooling.
Hospitals depend on power, staffing, roads, oxygen, cyber systems.
Ports depend on power, rail, trucking, customs, weather, labor.
```

## Output

```ts
export interface InfrastructureDependencyResult {
  assetId: string;
  dependencies: Array<{
    system: string;
    dependencyStrength: number;
    currentRisk: number;
    explanation: string;
  }>;
  overallDependencyRisk: number;
}
```

---

# 14. Supply Chain Sensitivity Algorithm

## Goal

Estimate which disruptions may affect availability of goods, fuel, medicine, or logistics.

## Inputs

- port disruption
- rail disruption
- fuel terminal status
- weather over routes
- labor strikes
- cyber events
- commodity price movement
- manufacturing region disruptions

## Output

```ts
export interface SupplyChainSensitivityResult {
  assessmentId: string;
  affectedCategories: string[];
  sensitivityScore: number;
  expectedDelayWindow: string;
  confidence: number;
  explanation: string[];
}
```

---

# 15. Route Safety Algorithm

## Goal

Score routes based on live and forecasted risks.

## Inputs

- weather
- road closures
- wildfire/smoke
- civil unrest
- flooding
- crime/public safety
- fuel availability
- power outages
- bridge/port/rail chokepoints

## Output

```ts
export interface RouteSafetyResult {
  routeId: string;
  safetyScore: number;
  riskSegments: Array<{
    segmentId: string;
    riskType: string;
    severity: number;
    reason: string;
  }>;
  recommendedAdjustment?: string;
}
```

---

# 16. Alert Fatigue Governor

## Goal

Control how often Crystal Ball interrupts the user.

## Inputs

- number of recent alerts
- user dismissals
- repeated categories
- urgency
- confidence
- actionability
- time since last interruption

## Output

```ts
export interface AlertFatigueDecision {
  eventId: string;
  interruptUser: boolean;
  deliveryMode: 'silent' | 'digest' | 'standard' | 'urgent';
  reason: string;
}
```

## Rule

Urgent personal threats bypass fatigue control.

---

# 17. Confidence Calibration Algorithm

## Goal

Make confidence scores more honest over time.

## Inputs

- predicted outcome
- actual outcome
- source trust
- false positives
- missed events
- stale events

## Output

```ts
export interface ConfidenceCalibrationResult {
  modelOrModule: string;
  previousCalibration: number;
  newCalibration: number;
  reason: string;
}
```

---

# 18. Source Conflict Arbitration Algorithm

## Goal

When sources disagree, decide how to present the conflict.

## Logic

Prefer:

- official over unofficial
- primary over secondary
- recent over stale
- specific over vague
- corroborated over isolated

## Output

```ts
export interface SourceConflictArbitrationResult {
  claimGroupId: string;
  leadingClaim: string;
  competingClaims: string[];
  arbitrationConfidence: number;
  displayLanguage: string;
}
```

---

# 19. Strategic Importance Algorithm

## Goal

Some places matter more because disruption there has outsized effects.

## High-importance entities

- major ports
- major airports
- energy hubs
- internet exchanges
- data centers
- military bases
- hospitals
- rail chokepoints
- bridges
- food distribution hubs
- water systems

## Output

```ts
export interface StrategicImportanceResult {
  entityId: string;
  strategicImportanceScore: number;
  importanceReasons: string[];
  affectedSystems: string[];
}
```

---

# 20. Explainability Ranking Algorithm

## Goal

Rank the best reasons to show the user.

## Why

Crystal Ball may know 50 reasons an event matters. The user needs the top 3 to 6.

## Output

```ts
export interface ExplainabilityRankingResult {
  assessmentId: string;
  rankedReasons: Array<{
    reason: string;
    importance: number;
    category: 'proximity' | 'severity' | 'confidence' | 'correlation' | 'user_exposure' | 'cascade' | 'anomaly';
  }>;
}
```

---

# 21. Local Consequence Algorithm

## Goal

Translate global/regional events into local consequences.

## Example

```text
Global: hurricane hits Gulf Coast
Local consequence: fuel prices may rise in Midwest if refinery disruption occurs.
```

## Output

```ts
export interface LocalConsequenceResult {
  assessmentId: string;
  userRegion: string;
  possibleLocalConsequences: string[];
  likelihood: number;
  confidence: number;
}
```

---

# 22. Preparedness Gap Algorithm

## Goal

Estimate what the user may need before a threat becomes urgent.

## Inputs

- threat type
- time horizon
- local impact
- user context
- recommended supplies/actions

## Output

```ts
export interface PreparednessGapResult {
  assessmentId: string;
  preparednessLevel: 'none_needed' | 'monitor' | 'basic_prepare' | 'prepare_now' | 'official_guidance';
  suggestedPreparations: string[];
  avoidPanicBuying: boolean;
  confidence: number;
}
```

---

# 23. Multi-Horizon Forecast Algorithm

## Goal

Score threats over multiple time horizons.

## Horizons

```text
Now: 0 - 6 hours
Near: 6 - 24 hours
Short: 1 - 3 days
Medium: 3 - 14 days
Long: 2 - 8 weeks
```

## Output

```ts
export interface MultiHorizonForecast {
  assessmentId: string;
  horizons: Array<{
    horizon: 'now' | 'near' | 'short' | 'medium' | 'long';
    riskScore: number;
    confidence: number;
    explanation: string;
  }>;
}
```

---

# 24. Semantic Drift Algorithm

## Goal

Detect when language around a topic changes meaningfully.

## Example

```text
"monitoring situation"
→ "investigating cluster"
→ "confirmed outbreak"
```

## Output

```ts
export interface SemanticDriftResult {
  topicId: string;
  oldTerms: string[];
  newTerms: string[];
  driftScore: number;
  escalationDetected: boolean;
  explanation: string;
}
```

---

# 25. Analyst Mode Summary Algorithm

## Goal

Create a concise intelligence brief from multiple algorithm outputs.

## Output

```ts
export interface AnalystBrief {
  title: string;
  bottomLine: string;
  confidence: number;
  keyJudgments: string[];
  evidence: string[];
  uncertainties: string[];
  watchItems: string[];
  recommendedActions: string[];
}
```

## Example Format

```text
Bottom Line:
Regional infrastructure risk is elevated but not urgent.

Key Judgments:
1. Multiple weak signals point to transportation stress.
2. Current user exposure is moderate.
3. Confidence is limited by conflicting source reports.

Watch Items:
- official outage updates
- traffic reroutes
- port delay language
```

---

# Recommended File Structure

Claude should implement these as modular helpers:

```text
src/lib/intelligence/helpers/signalFusion.ts
src/lib/intelligence/helpers/weakSignalAmplification.ts
src/lib/intelligence/helpers/blindSpotDetection.ts
src/lib/intelligence/helpers/intelligenceGap.ts
src/lib/intelligence/helpers/freshness.ts
src/lib/intelligence/helpers/noiseSuppression.ts
src/lib/intelligence/helpers/userIntentRelevance.ts
src/lib/intelligence/helpers/watchlistGenerator.ts
src/lib/intelligence/helpers/nextIndicatorPrediction.ts
src/lib/intelligence/helpers/threatMemory.ts
src/lib/intelligence/helpers/patternRecurrence.ts
src/lib/intelligence/helpers/regionalBaseline.ts
src/lib/intelligence/helpers/infrastructureDependency.ts
src/lib/intelligence/helpers/supplyChainSensitivity.ts
src/lib/intelligence/helpers/routeSafety.ts
src/lib/intelligence/helpers/alertFatigueGovernor.ts
src/lib/intelligence/helpers/confidenceCalibration.ts
src/lib/intelligence/helpers/sourceConflictArbitration.ts
src/lib/intelligence/helpers/strategicImportance.ts
src/lib/intelligence/helpers/explainabilityRanking.ts
src/lib/intelligence/helpers/localConsequence.ts
src/lib/intelligence/helpers/preparednessGap.ts
src/lib/intelligence/helpers/multiHorizonForecast.ts
src/lib/intelligence/helpers/semanticDrift.ts
src/lib/intelligence/helpers/analystBrief.ts
```

---

# Build Priority

Implement in this order:

1. Freshness / staleness
2. Noise suppression
3. Explainability ranking
4. Signal fusion
5. Weak signal amplification
6. Blind spot detection
7. Intelligence gap detection
8. Multi-horizon forecast
9. Alert fatigue governor
10. Analyst brief generator
11. Threat memory
12. Pattern recurrence
13. Infrastructure dependency
14. Supply chain sensitivity
15. Route safety

---

# Design Rule

Every helper algorithm should return:

```text
score
label
reasons
uncertainties
recommended display language
```

Crystal Ball must remain explainable.

---

# Final Product Direction

These helper algorithms are what make Crystal Ball feel intelligent instead of mechanical.

The main threat score tells the user something matters.

The helper algorithms explain:

- why it matters
- what is missing
- what changed
- whether it is stale
- whether it is noise
- what might happen next
- how it affects the user locally
- what to watch now

Together, these systems make Crystal Ball feel like a personal intelligence analyst, not just a data dashboard.
