# Crystal Ball — Advanced System Dynamics Implementation Plan

## Purpose

This document translates the next major leap for Crystal Ball into an implementation-grade plan.

The goal is to evolve Crystal Ball from:
- event aggregation
- feed monitoring
- map visualization
- OSINT display

into:

> a civilization-scale adaptive reasoning engine that models how complex systems behave under stress.

This plan addresses the next layer of capability beyond the existing roadmap:
- civilization physics
- pressure accumulation
- recovery modeling
- behavioral modeling
- global dependency heatmaps
- crisis signatures
- multi-agent AI reasoning
- contradiction detection
- global rhythm modeling
- civilization pulse scoring
- strategic simulation
- world narrative intelligence
- operator awareness
- temporal depth
- planetary atmospherics
- hidden-world visualization

---

# 1. Civilization Physics

## Concept

Crystal Ball should model systems not just as events, but as dynamic entities with stress, capacity, resilience, and failure behavior.

Every major civilization subsystem should expose a dynamic state model.

Examples:
- ports
- power grids
- telecom networks
- internet routing
- fuel systems
- food systems
- hospitals
- airports
- rail networks
- cloud infrastructure
- emergency services

Each subsystem should track:
- pressure
- capacity
- resilience
- fatigue
- fragility
- recovery rate
- dependency exposure
- propagation behavior

---

## Implementation Tasks

### 1.1 Create System State Schema

Create a common model for infrastructure/system health.

Suggested entity fields:

```ts
interface SystemState {
  id: string;
  name: string;
  type: SystemType;
  location?: GeoPoint | GeoRegion;
  pressureScore: number;      // 0-100
  capacityScore: number;      // 0-100
  resilienceScore: number;    // 0-100
  fragilityScore: number;     // 0-100
  fatigueScore: number;       // 0-100
  recoveryScore: number;      // 0-100
  confidence: number;         // 0-1
  lastUpdated: string;
  sources: SourceReference[];
  dependencies: string[];
  downstreamDependents: string[];
}
```

### 1.2 Define System Types

Start with:
- `port`
- `airport`
- `power_grid`
- `internet_region`
- `telecom_network`
- `food_supply_region`
- `fuel_supply_region`
- `shipping_lane`
- `cloud_region`
- `hospital_capacity_region`
- `rail_corridor`
- `water_system`

### 1.3 Add Derived Metrics

For each system type, calculate:
- baseline normal activity
- current deviation
- dependency exposure
- recovery capacity
- stress trend
- failure probability

### 1.4 Initial MVP

Implement three system types first:
1. internet regions
2. ports/shipping corridors
3. severe weather logistics regions

These provide the clearest early value.

---

# 2. Pressure Accumulation Engine

## Concept

Most crises are not sudden. Pressure builds silently.

Crystal Ball should track accumulated stress across systems and identify threshold risk.

Examples:
- drought pressure accumulating before food instability
- congestion pressure accumulating before logistics failure
- cyber probing accumulating before a major outage
- inflation and shortage pressure accumulating before unrest

---

## Implementation Tasks

### 2.1 Create Pressure Model

```ts
interface PressureSignal {
  id: string;
  systemId: string;
  category: PressureCategory;
  currentValue: number;
  baselineValue: number;
  deviation: number;
  accumulationRate: number;
  decayRate: number;
  thresholdWarning: number;
  thresholdCritical: number;
  confidence: number;
  observedAt: string;
}
```

### 2.2 Pressure Categories

- logistics
- cyber
- weather
- economic
- food
- fuel
- social
- military
- disease
- energy
- telecom

### 2.3 Add Temporal Accumulation

Pressure should:
- increase when abnormal signals persist
- decay when conditions normalize
- escalate when multiple categories overlap
- trigger alerts when thresholds are crossed

### 2.4 MVP Output

Create a `pressureTimeline` for regions and systems:
- 24h trend
- 7d trend
- 30d trend
- current pressure
- forecast pressure

---

# 3. Recovery Modeling

## Concept

Crystal Ball must not only model collapse. It must also model recovery.

This prevents doom bias and improves realism.

Track:
- repair velocity
- restoration timelines
- aid arrival
- infrastructure redundancy
- rerouting success
- normalization trend

---

## Implementation Tasks

### 3.1 Create Recovery Model

```ts
interface RecoveryState {
  systemId: string;
  disruptionId: string;
  recoveryPhase: RecoveryPhase;
  estimatedRestorationTime?: string;
  repairVelocityScore: number;
  redundancyScore: number;
  externalAidScore: number;
  normalizationTrend: number;
  confidence: number;
}
```

### 3.2 Recovery Phases

- disrupted
- stabilizing
- repairing
- partially_restored
- normalized
- degraded_new_normal

### 3.3 Recovery Indicators

Examples:
- power restored percentage
- ports reopening
- flight operations resuming
- internet routes stabilizing
- road closures decreasing
- emergency declarations ending
- commodity prices normalizing

### 3.4 UX Requirement

Show recovery visually.

Do not only show red danger states.

Use recovery arcs, cooling pressure fields, and stabilization indicators.

---

# 4. Behavioral Modeling

## Concept

Human systems adapt under stress.

Crystal Ball should model behavioral responses such as:
- panic buying
- evacuation
- migration
- capital flight
- hoarding
- policy shifts
- censorship
- mobilization
- protest growth

---

## Implementation Tasks

### 4.1 Create Behavioral Signal Model

```ts
interface BehavioralSignal {
  id: string;
  regionId: string;
  behaviorType: BehaviorType;
  intensity: number;
  acceleration: number;
  confidence: number;
  supportingSignals: string[];
  observedAt: string;
}
```

### 4.2 Behavior Types

- panic_buying
- evacuation
- migration
- civil_unrest
- capital_flight
- supply_hoarding
- censorship
- mobilization
- policy_shift
- misinformation_spread

### 4.3 Data Sources

Potential inputs:
- local news
- emergency alerts
- traffic congestion
- social chatter
- retail shortage reports
- fuel prices
- flight searches/cancellations if available
- official evacuation orders
- humanitarian movement reports

### 4.4 MVP

Start with:
- evacuation behavior
- civil unrest acceleration
- panic buying / shortage signals

---

# 5. Global Dependency Heatmaps

## Concept

Crystal Ball should expose what civilization depends on.

Visualize:
- chokepoints
- single points of failure
- dependency concentration
- upstream vulnerability
- downstream consequence

---

## Implementation Tasks

### 5.1 Dependency Graph

Create dependency relationships between systems:

```ts
interface DependencyEdge {
  fromSystemId: string;
  toSystemId: string;
  dependencyType: DependencyType;
  strength: number;
  substitutability: number;
  latencyToImpactHours?: number;
  confidence: number;
}
```

### 5.2 Dependency Types

- energy
- fuel
- food
- water
- telecom
- internet
- logistics
- finance
- cloud
- semiconductor
- medical
- transportation

### 5.3 Heatmap Views

Create overlays for:
- dependency density
- chokepoint risk
- single point of failure risk
- downstream impact radius
- redundancy weakness

### 5.4 MVP

Start with:
- ports
- undersea cables
- cloud regions
- major shipping chokepoints
- power/fuel corridors where available

---

# 6. Crisis Signatures

## Concept

The system should learn what pre-crisis conditions look like.

A crisis signature is a recognizable precursor pattern.

Examples:
- pre-blackout pattern
- pre-shortage pattern
- pre-conflict escalation
- pre-bank-run pattern
- pre-grid-failure pattern
- pre-outbreak spread pattern

---

## Implementation Tasks

### 6.1 Crisis Signature Schema

```ts
interface CrisisSignature {
  id: string;
  name: string;
  crisisType: CrisisType;
  precursorSignals: PrecursorSignal[];
  requiredSignalCount: number;
  confidenceThreshold: number;
  historicalExamples: HistoricalExample[];
  likelyTimeHorizonHours: number[];
}
```

### 6.2 Signature Matching

Implement matching logic:
- signal presence
- signal strength
- sequence order
- timing window
- regional context
- contradiction checks

### 6.3 Initial Crisis Signatures

Start with:
1. regional internet instability
2. port disruption cascade
3. severe weather logistics disruption
4. disease-to-food-pressure cascade
5. civil unrest escalation

### 6.4 Output

When a partial match appears:

> “This region matches 4 of 7 known precursors for logistics disruption within 72 hours.”

Include:
- matched signals
- missing signals
- confidence
- contradiction evidence
- forecast window

---

# 7. Multi-Agent AI Reasoning

## Concept

Use specialized AI agents that reason from different domains.

Instead of one generic AI summary, use analyst roles.

---

## Agent Types

Initial agents:
- cyber analyst
- logistics analyst
- climate/weather analyst
- geopolitical analyst
- infrastructure analyst
- epidemiology analyst
- economic stress analyst
- personal impact analyst
- contradiction analyst
- synthesis analyst

---

## Implementation Tasks

### 7.1 Agent Input Contract

Each agent receives:
- normalized events
- system state
- pressure signals
- dependency graph subset
- relevant historical memory
- user context if applicable

### 7.2 Agent Output Contract

```ts
interface AnalystFinding {
  agentType: AgentType;
  finding: string;
  severity: Severity;
  confidence: number;
  evidence: EvidenceReference[];
  contradictions: EvidenceReference[];
  recommendedFollowups: string[];
  affectedSystems: string[];
}
```

### 7.3 Synthesis Layer

A synthesis agent merges findings into:
- operational summary
- key risks
- disagreements
- recommended monitoring
- likely next developments

### 7.4 Trust Rule

AI findings must never be presented without:
- evidence
- confidence
- uncertainty
- source references

---

# 8. Contradiction Detection

## Concept

Crystal Ball should actively identify conflicting evidence.

This is essential for trust.

Examples:
- official reports say port is open, satellite/ship data suggests congestion
- government says internet is normal, BGP data shows route instability
- local reports say calm, emergency data shows rising calls

---

## Implementation Tasks

### 8.1 Contradiction Model

```ts
interface Contradiction {
  id: string;
  claimA: EvidenceReference;
  claimB: EvidenceReference;
  contradictionType: ContradictionType;
  severity: number;
  confidence: number;
  resolutionStatus: ResolutionStatus;
}
```

### 8.2 Contradiction Types

- source_conflict
- sensor_conflict
- timeline_conflict
- location_conflict
- severity_conflict
- official_vs_observed
- stale_data_conflict

### 8.3 UX Requirement

Surface contradictions clearly:

> “Evidence conflict detected.”

Never bury contradictory evidence.

---

# 9. Global Rhythm Engine

## Concept

Civilization has rhythms.

Crystal Ball should learn normal patterns and detect when they break.

Examples:
- shipping rhythms
- internet traffic rhythms
- migration rhythms
- fuel demand rhythms
- market rhythms
- power demand rhythms
- weather seasonality
- unrest seasonality

---

## Implementation Tasks

### 9.1 Baseline Models

For each monitored system, store:
- hourly baseline
- daily baseline
- weekly baseline
- seasonal baseline
- holiday/event exceptions

### 9.2 Rhythm Break Detection

Flag:
- sudden silence
- abnormal spikes
- atypical timing
- persistence beyond normal window
- synchronized deviations across domains

### 9.3 MVP

Start with:
- aviation volume anomalies
- shipping lane anomalies
- internet outage anomalies
- earthquake swarm anomaly detection
- wildfire / thermal anomaly rhythms

---

# 10. Civilization Pulse

## Concept

Create a continuously updated macro score showing whether the world is becoming more stable or unstable.

This becomes the emotional heartbeat of Crystal Ball.

---

## Pulse Components

- Global Stability Index
- Cyber Tension Index
- Logistics Stress Index
- Food Security Pressure
- Energy Fragility
- Infrastructure Fatigue
- Conflict Escalation
- Disease Spread Pressure
- Environmental Risk
- Economic Anxiety
- Recovery Momentum

---

## Implementation Tasks

### 10.1 Pulse Score Schema

```ts
interface CivilizationPulse {
  timestamp: string;
  globalStability: number;
  cyberTension: number;
  logisticsStress: number;
  foodPressure: number;
  energyFragility: number;
  infrastructureFatigue: number;
  conflictEscalation: number;
  diseasePressure: number;
  environmentalRisk: number;
  economicAnxiety: number;
  recoveryMomentum: number;
  confidence: number;
}
```

### 10.2 UI

Show:
- current pulse
- 24h delta
- 7d delta
- top drivers
- stabilizing factors
- destabilizing factors

---

# 11. Strategic Simulation Mode

## Concept

Users should be able to run hypothetical scenarios.

Examples:
- major port shutdown
- undersea cable cut
- regional blackout
- fuel embargo
- cyber attack
- hurricane strike
- disease outbreak expansion

---

## Implementation Tasks

### 11.1 Scenario Model

```ts
interface ScenarioInput {
  scenarioType: ScenarioType;
  targetSystems: string[];
  severity: number;
  startTime: string;
  durationHours?: number;
  assumptions: string[];
}
```

### 11.2 Scenario Output

```ts
interface ScenarioOutput {
  impactTimeline: ScenarioImpactStep[];
  affectedSystems: string[];
  likelyCascades: string[];
  confidence: number;
  assumptions: string[];
  uncertainty: string[];
}
```

### 11.3 MVP

Start with prebuilt scenarios:
- port shutdown
- cloud region outage
- internet backbone instability
- severe weather logistics disruption

---

# 12. World Narrative Intelligence

## Concept

Humans understand stories better than raw telemetry.

Crystal Ball should generate concise operational narratives.

Examples:
- “Supply chain pressure is intensifying across Southeast Asia.”
- “Cyber instability is spreading through telecom infrastructure.”
- “Food system fragility is rising due to drought and livestock disease.”

---

## Implementation Tasks

### 12.1 Narrative Types

- daily world brief
- regional escalation brief
- anomaly narrative
- personal impact narrative
- recovery narrative
- contradiction narrative
- future risk narrative

### 12.2 Narrative Rules

Every narrative must include:
- what changed
- why it matters
- evidence
- uncertainty
- next indicators to watch

---

# 13. Operator Awareness AI

## Concept

The system should understand what the user needs to know.

Avoid dumping everything.

Prioritize:
- material changes
- new risks
- local relevance
- user-selected domains
- unresolved contradictions
- high-confidence cascade risks

---

## Implementation Tasks

### 13.1 User Context Model

Store user preferences locally:
- regions of interest
- risk domains
- travel areas
- infrastructure dependencies
- alert tolerance
- preferred detail level

### 13.2 Attention Ranking

Rank items by:
- severity
- novelty
- confidence
- user relevance
- escalation potential
- proximity
- dependency impact

---

# 14. Temporal Depth

## Concept

Crystal Ball should reason across past, present, and future.

---

## Implementation Tasks

### 14.1 Temporal Layers

- historical baseline
- recent trend
- current state
- near-term forecast
- long-term trajectory

### 14.2 UI

Provide:
- time scrubber
- trend trails
- future projection cones
- historical analog comparisons
- replay mode

---

# 15. Planetary Atmospherics

## Concept

The interface should subtly communicate global stress through visual atmosphere.

This is not decoration.
It is emotional situational awareness.

---

## Implementation Tasks

Visual variables:
- motion density
- glow intensity
- map tension
- pulse rate
- atmospheric haze
- instability ripple frequency

Map these variables to:
- global pulse
- local system stress
- conflict intensity
- cyber instability
- weather severity

---

# 16. Hidden World Visualization

## Concept

Crystal Ball should reveal the hidden machinery of civilization.

Show:
- undersea cables
- cloud regions
- internet exchanges
- DNS infrastructure
- shipping chokepoints
- telecom concentration
- power dependencies
- fuel corridors
- semiconductor logistics

---

## Implementation Tasks

### 16.1 Hidden Infrastructure Dataset Registry

Create registry for:
- dataset name
- source
- refresh cadence
- confidence
- licensing
- entity type
- visualization layer

### 16.2 First Hidden Layers

Start with:
- undersea cables
- internet outages
- cloud regions
- major ports
- major shipping chokepoints
- airports

---

# Recommended Implementation Order

## Milestone 1 — Data Foundation

Create:
- system state schema
- pressure signal schema
- dependency edge schema
- contradiction schema
- baseline rhythm tables

## Milestone 2 — First Dynamic Scores

Implement:
- pressure accumulation
- system stress scores
- recovery state tracking
- civilization pulse v1

## Milestone 3 — First Advanced UX

Implement:
- What Changed panel
- pulse dashboard
- pressure overlays
- hidden world layers
- causality view MVP

## Milestone 4 — Intelligence Layer

Implement:
- crisis signatures
- multi-agent analyst outputs
- contradiction detection
- narrative intelligence

## Milestone 5 — Simulation + Future Modeling

Implement:
- future shadows
- strategic simulation mode
- replayable timeline
- scenario impact chains

---

# Claude Implementation Guidance

Claude should implement this incrementally.

Do not attempt to build everything at once.

Recommended first PRs:

1. Add schemas and types for system state, pressure signals, dependency edges, contradictions, and pulse scores.
2. Add a lightweight pressure accumulation service.
3. Add a Civilization Pulse v1 derived from existing feeds.
4. Add a What Changed panel that ranks material changes.
5. Add a hidden-world layer registry.
6. Add crisis signature matching for one or two domains.
7. Add UI hooks for pressure overlays and pulse atmospherics.
8. Add narrative intelligence summaries with evidence and uncertainty.

---

# Product North Star

Crystal Ball should become:

> a continuously learning planetary cognition engine capable of modeling civilization-scale dynamics, detecting instability emergence, forecasting cascading disruption, and helping humans understand the trajectory of the world in real time.

This is the direction that makes the project meaningfully different from dashboards, maps, OSINT feeds, and alert aggregators.
