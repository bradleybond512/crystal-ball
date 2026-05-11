# Crystal Ball Advanced Algorithm Suite

## Purpose

This document expands Crystal Ball beyond a single threat score into a full suite of intelligence algorithms. The goal is to increase complexity, depth, explainability, and usefulness while keeping the system buildable.

This is meant for Claude as an implementation blueprint.

---

# Algorithm Suite Overview

Crystal Ball should eventually contain multiple cooperating algorithms:

1. Source Trust Algorithm
2. Event Deduplication Algorithm
3. Entity Resolution Algorithm
4. Spatial Risk Algorithm
5. Temporal Momentum Algorithm
6. Correlation Graph Algorithm
7. Cascade Risk Algorithm
8. Personal Exposure Algorithm
9. Anomaly Detection Algorithm
10. Forecast Scenario Algorithm
11. Contradiction Detection Algorithm
12. Alert Prioritization Algorithm
13. Confidence Decay Algorithm
14. Narrative Intelligence Algorithm
15. Action Recommendation Algorithm

Each algorithm should output structured, explainable data.

---

# 1. Source Trust Algorithm

## Goal

Determine how much Crystal Ball should trust a source before using it to raise user-facing threat levels.

## Inputs

- Source type
- Official status
- Historical accuracy
- Retraction history
- Freshness
- Geographic specificity
- Corroboration count
- Whether source is primary or derivative
- Whether the source has direct evidence

## Formula

```text
SourceTrust =
  OfficialWeight
+ PrimarySourceWeight
+ HistoricalAccuracy
+ Freshness
+ Specificity
+ Corroboration
- RetractionPenalty
- RumorPenalty
```

## Output

```ts
export interface SourceTrustResult {
  sourceId: string;
  trustScore: number;
  label: 'very_low' | 'low' | 'medium' | 'high' | 'official';
  reasons: string[];
  penalties: string[];
}
```

## Example

```json
{
  "sourceId": "county_health_department",
  "trustScore": 0.94,
  "label": "official",
  "reasons": [
    "Official government source",
    "Primary reporting authority",
    "Geographically specific"
  ],
  "penalties": []
}
```

---

# 2. Event Deduplication Algorithm

## Goal

Prevent Crystal Ball from counting the same event multiple times.

## Example Problem

Three headlines may describe one incident:

```text
Explosion reported near refinery
Fire crews respond to chemical facility
Shelter-in-place issued after plant fire
```

These should become one event cluster.

## Matching Signals

- Time proximity
- Geographic distance
- Shared entities
- Shared event type
- Similar named locations
- Similar casualty or damage figures
- Similar source references

## Output

```ts
export interface DeduplicationResult {
  clusterId: string;
  canonicalEventId: string;
  duplicateEventIds: string[];
  similarityScore: number;
  mergeReasons: string[];
}
```

## Implementation Notes

Start simple:

```text
Same event type
+ within 25 km
+ within 12 hours
+ shared keywords
= probable duplicate
```

Later upgrade with embeddings.

---

# 3. Entity Resolution Algorithm

## Goal

Identify when different names refer to the same thing.

Examples:

```text
SBN
South Bend International Airport
South Bend Airport
KSBN
```

All should map to one entity.

## Entity Types

- Airports
- Ports
- Cities
- Counties
- Hospitals
- Data centers
- Military bases
- Government agencies
- Ships
- Aircraft
- Companies
- Infrastructure assets

## Output

```ts
export interface ResolvedEntity {
  entityId: string;
  canonicalName: string;
  aliases: string[];
  type: string;
  confidence: number;
  location?: {
    lat: number;
    lon: number;
  };
}
```

---

# 4. Spatial Risk Algorithm

## Goal

Estimate risk based on distance, geography, blast/radius effects, wind, travel paths, and infrastructure connectivity.

## Scoring Factors

- Distance from user
- Distance from saved places
- Radius of impact
- Direction of spread
- Terrain barriers
- Wind direction
- Watershed or river connection
- Road/rail/air route connection
- Infrastructure dependency

## Formula

```text
SpatialRisk =
  ImpactRadiusOverlap
+ DistanceDecay
+ DirectionalSpread
+ RouteIntersection
+ InfrastructureDependency
```

## Output

```ts
export interface SpatialRiskResult {
  eventId: string;
  spatialRisk: number;
  affectedSavedPlaces: string[];
  affectedRoutes: string[];
  distanceKm?: number;
  directionality?: string;
  reasons: string[];
}
```

---

# 5. Temporal Momentum Algorithm

## Goal

Detect whether a threat is accelerating, fading, or stable.

## Inputs

- Event count over time
- Severity trend
- Source count trend
- Geographic spread trend
- Repetition of keywords
- Escalation in official language

## Momentum States

```text
Dormant
Emerging
Accelerating
Peaking
Stabilizing
Decaying
Resolved
```

## Output

```ts
export interface TemporalMomentumResult {
  eventOrClusterId: string;
  momentumScore: number;
  state: 'dormant' | 'emerging' | 'accelerating' | 'peaking' | 'stabilizing' | 'decaying' | 'resolved';
  trendExplanation: string;
  timeWindowHours: number;
}
```

## Example

```text
A disease signal mentioned once is low momentum.
A disease signal mentioned by 5 sources across 3 counties in 24 hours is accelerating.
```

---

# 6. Correlation Graph Algorithm

## Goal

Connect related events into a living intelligence graph.

## Graph Nodes

- Events
- Entities
- Places
- Sources
- Systems
- Users
- Routes
- Assets

## Graph Edges

```text
near
same_entity
same_system
precedes
follows
amplifies
contradicts
confirms
causes
possibly_related
user_exposed_to
```

## Edge Weight Formula

```text
EdgeWeight =
  SpatialSimilarity
+ TemporalSimilarity
+ EntityOverlap
+ SystemOverlap
+ NarrativeSimilarity
+ SourceAgreement
```

## Output

```ts
export interface GraphRelationship {
  fromId: string;
  toId: string;
  relationship: string;
  weight: number;
  confidence: number;
  explanation: string;
}
```

---

# 7. Cascade Risk Algorithm

## Goal

Estimate second- and third-order consequences.

## Example Cascades

```text
Storm
→ power outage
→ water treatment disruption
→ boil-water notice
→ hospital pressure
```

```text
Port earthquake
→ inspection shutdown
→ ship backlog
→ delayed fuel/goods
→ regional supply pressure
```

```text
Cyberattack
→ hospital network outage
→ ambulance diversion
→ public safety delay
```

## Output

```ts
export interface CascadePath {
  rootEventId: string;
  steps: Array<{
    system: string;
    effect: string;
    probability: number;
    severity: number;
    estimatedDelayHours?: number;
  }>;
  cascadeScore: number;
  explanation: string;
}
```

## Initial Cascade Templates

Create templates for:

- earthquake
- hurricane
- winter storm
- wildfire
- disease cluster
- cyberattack
- port disruption
- airport disruption
- power outage
- water contamination
- civil unrest
- fuel disruption

---

# 8. Personal Exposure Algorithm

## Goal

Make global intelligence personally useful.

## Inputs

- User home region
- Work region
- saved locations
- saved routes
- travel plans
- family locations
- medical concerns
- vehicle constraints
- preferred alert radius
- selected threat categories

## Output

```ts
export interface PersonalExposureResult {
  userExposureScore: number;
  exposureLabel: 'none' | 'low' | 'moderate' | 'high' | 'urgent';
  whyUserShouldCare: string[];
  nearbySavedPlaces: string[];
  routeIntersections: string[];
  timeToImpactHours?: number;
}
```

## Key Product Rule

A low global severity event can still be high priority if it affects the user personally.

---

# 9. Anomaly Detection Algorithm

## Goal

Detect abnormal behavior before it becomes obvious.

## Anomaly Types

- frequency anomaly
- severity anomaly
- location anomaly
- movement anomaly
- language anomaly
- source anomaly
- seasonal anomaly
- infrastructure anomaly

## Example

```text
Normal: 1 minor quake/week
Current: 7 minor quakes/8 hours
Result: seismic anomaly
```

## Output

```ts
export interface AnomalyResult {
  id: string;
  anomalyType: string;
  baseline: string;
  current: string;
  anomalyScore: number;
  confidence: number;
  explanation: string;
}
```

## Build Strategy

Phase 1:

- rolling averages
- z-score style outlier detection
- simple baseline windows

Phase 2:

- seasonal baselines
- regional baselines
- category-specific baselines

Phase 3:

- ML-assisted anomaly detection

---

# 10. Forecast Scenario Algorithm

## Goal

Convert event data into plausible future paths.

## Required Scenarios

Every high-value event should generate:

```text
Best case
Most likely case
Worst plausible case
Watch indicators
User action
Unknowns
```

## Output

```ts
export interface ScenarioSet {
  eventOrClusterId: string;
  timeHorizonHours: number;
  bestCase: string;
  mostLikely: string;
  worstPlausible: string;
  watchIndicators: string[];
  recommendedActions: string[];
  unknowns: string[];
  confidence: number;
}
```

---

# 11. Contradiction Detection Algorithm

## Goal

Detect when sources disagree.

## Examples

```text
Source A: airport closed
Source B: airport operating normally
```

```text
Source A: 10 injured
Source B: no injuries reported
```

## Output

```ts
export interface ContradictionResult {
  eventId: string;
  contradictionScore: number;
  conflictingClaims: Array<{
    claim: string;
    sourceId: string;
    trustScore: number;
  }>;
  recommendedDisplay: string;
}
```

## UI Rule

If contradiction is high, do not present certainty.

Use:

```text
Reports conflict. Confidence is limited.
```

---

# 12. Alert Prioritization Algorithm

## Goal

Prevent alert fatigue.

## Priority Factors

- user exposure
- severity
- confidence
- velocity
- proximity
- novelty
- cascade potential
- actionability
- recency

## Output

```ts
export interface AlertPriorityResult {
  alertId: string;
  priorityScore: number;
  priorityLabel: 'silent' | 'log_only' | 'watch' | 'notify' | 'urgent';
  deliveryMode: 'none' | 'feed' | 'push' | 'critical';
  reasons: string[];
}
```

## Product Rule

Only interrupt the user when:

```text
High relevance
+ enough confidence
+ meaningful actionability
```

---

# 13. Confidence Decay Algorithm

## Goal

Old alerts should lose confidence unless updated.

## Formula

```text
DecayedConfidence = OriginalConfidence × e^(-lambda × ageHours)
```

## Output

```ts
export interface ConfidenceDecayResult {
  eventId: string;
  originalConfidence: number;
  decayedConfidence: number;
  ageHours: number;
  stale: boolean;
}
```

## Product Rule

Crystal Ball should label stale intelligence clearly.

Example:

```text
This event has not been updated in 18 hours. Confidence has decayed.
```

---

# 14. Narrative Intelligence Algorithm

## Goal

Detect how the language around a threat is changing.

## Examples

```text
monitoring → investigating → confirmed → emergency declaration
```

```text
isolated case → cluster → outbreak
```

```text
minor delay → ground stop → airport closure
```

## Output

```ts
export interface NarrativeShiftResult {
  topicId: string;
  previousLanguage: string[];
  currentLanguage: string[];
  escalationScore: number;
  explanation: string;
}
```

---

# 15. Action Recommendation Algorithm

## Goal

Turn intelligence into useful user guidance.

## Inputs

- threat type
- severity
- user exposure
- confidence
- actionability
- time horizon

## Output

```ts
export interface ActionRecommendation {
  eventOrClusterId: string;
  actionLevel: 'none' | 'monitor' | 'prepare' | 'avoid' | 'evacuate' | 'seek_official_guidance';
  actions: string[];
  avoidSaying: string[];
  confidence: number;
}
```

## Safety Rule

Do not overstate certainty.
For medical, legal, or emergency situations, recommend official guidance.

---

# Combined Intelligence Object

All algorithms should eventually combine into one structured output.

```ts
export interface CrystalBallIntelligenceAssessment {
  id: string;
  title: string;
  summary: string;

  threatScore: number;
  confidence: number;
  userExposureScore: number;
  anomalyScore: number;
  cascadeScore: number;
  momentumScore: number;

  priority: 'silent' | 'log_only' | 'watch' | 'notify' | 'urgent';

  sourceTrust: SourceTrustResult[];
  correlations: GraphRelationship[];
  cascades: CascadePath[];
  scenarios: ScenarioSet;
  contradictions: ContradictionResult[];
  recommendedActions: ActionRecommendation[];

  explainability: {
    whyThisMatters: string[];
    whatChanged: string[];
    whatIsUncertain: string[];
    whatToWatch: string[];
  };
}
```

---

# Implementation Roadmap For Claude

## Step 1: Types

Create shared TypeScript interfaces for all algorithm outputs.

Suggested file:

```text
src/lib/intelligence/types.ts
```

## Step 2: Scoring Utilities

Create reusable helpers:

```text
clamp01()
normalizeScore()
weightedAverage()
distanceDecay()
timeDecay()
labelScore()
```

Suggested file:

```text
src/lib/intelligence/scoring.ts
```

## Step 3: Implement Algorithms One By One

Suggested files:

```text
src/lib/intelligence/sourceTrust.ts
src/lib/intelligence/deduplication.ts
src/lib/intelligence/entityResolution.ts
src/lib/intelligence/spatialRisk.ts
src/lib/intelligence/temporalMomentum.ts
src/lib/intelligence/correlationGraph.ts
src/lib/intelligence/cascadeRisk.ts
src/lib/intelligence/personalExposure.ts
src/lib/intelligence/anomalyDetection.ts
src/lib/intelligence/scenarioEngine.ts
src/lib/intelligence/contradictionDetection.ts
src/lib/intelligence/alertPriority.ts
src/lib/intelligence/confidenceDecay.ts
src/lib/intelligence/narrativeIntelligence.ts
src/lib/intelligence/actionRecommendation.ts
```

## Step 4: Assessment Composer

Create a high-level function:

```ts
export function buildIntelligenceAssessment(events: ThreatEvent[], userContext: UserContext): CrystalBallIntelligenceAssessment[] {
  // normalize
  // dedupe
  // resolve entities
  // score trust
  // correlate
  // detect anomalies
  // calculate exposure
  // generate scenarios
  // prioritize alerts
}
```

Suggested file:

```text
src/lib/intelligence/buildAssessment.ts
```

## Step 5: UI Integration

Add UI panels for:

- score breakdown
- why this matters
- correlated events
- confidence and uncertainty
- scenario forecast
- watch indicators
- recommended actions
- related graph

---

# Definition of Done

The first enhanced algorithm suite is complete when Crystal Ball can produce an assessment like this:

```json
{
  "title": "Elevated infrastructure disruption pattern",
  "threatScore": 72,
  "confidence": 0.68,
  "userExposureScore": 0.81,
  "anomalyScore": 0.77,
  "cascadeScore": 0.64,
  "priority": "notify",
  "whyThisMatters": [
    "Multiple events affect the same transportation corridor",
    "The cluster is near a saved user region",
    "Event frequency is above the regional baseline",
    "Port and road disruption could create downstream supply pressure"
  ],
  "whatIsUncertain": [
    "Official confirmation is incomplete",
    "Some source claims conflict about severity"
  ],
  "whatToWatch": [
    "Official transportation alerts",
    "Power outage expansion",
    "Port delay notices",
    "Fuel or grocery supply reports"
  ],
  "recommendedActions": [
    "Monitor official regional alerts",
    "Avoid affected travel routes if possible",
    "Do not assume supply disruption unless confirmed"
  ]
}
```

---

# Final Product Direction

Crystal Ball should feel less like a dashboard and more like an intelligence analyst.

It should not merely say what happened.

It should explain:

- what changed
- what connects
- what may happen next
- why it matters to the user
- how confident it is
- what the user should watch

That is the difference between an alert app and a world-monitoring intelligence system.
