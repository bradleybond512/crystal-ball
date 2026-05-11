# Crystal Ball — Implementation Gap Analysis & Next Leap Plan

## Purpose

This document compares the current Crystal Ball codebase direction against the strategic architecture plans and identifies the highest-value next design leap.

The existing app already has substantial pieces of the future system:

- many ingestion services
- many panels
- data freshness tracking
- anomaly detection
- correlation services
- situation engine concepts
- country instability models
- unified alerts
- personal impact tests
- intelligence tests
- ops / algorithm / governance tests
- globe overlays
- maritime, seismic, cyber, infrastructure, weather, macro, biosurveillance, sanctions, and synthesis modules

The next step is not simply adding more feeds.

The next step is reorganizing the system into a clear intelligence architecture where every feed contributes to shared world-state reasoning.

---

# Current Strengths

## 1. Broad Data Coverage

The current codebase already appears to ingest many domains:

- news
- markets
- earthquakes
- weather alerts
- internet outages
- AIS / maritime
- cable activity
- protest events
- flight delays
- military flights
- military vessels
- USNI fleet reports
- GDELT tensions
- natural events
- cyber threats
- trade restrictions
- shipping rates
- chokepoints
- critical minerals
- tropical cyclones
- marine hazards
- storm preparedness
- satellite fires
- GPS interference
- displacement
- climate anomalies
- travel warnings
- Telegram intelligence
- population exposure
- infrastructure
- airstrikes
- DoD contracts
- Wikidata bases
- FAA cameras
- RIPE Atlas
- GDACS
- NWS alerts
- humanitarian feeds
- aerospace reentry
- Amtrak alerts
- avalanche hazards
- ECDC disease alerts
- bank failures
- harmful algal blooms
- UN Security Council
- wildfire smoke
- central bank calendar
- dam safety
- power grid alerts
- OSINT cyber feeds
- ACLED
- ADS-B military
- Tor metrics
- World Bank profiles

This is a major advantage.

The problem is not lack of raw feeds.

The problem is converting this coverage into unified reasoning.

---

## 2. Early Intelligence Infrastructure Already Exists

The repo already references important intelligence services such as:

- signal aggregator
- temporal baseline
- geo-convergence
- country instability
- situation engine
- data freshness
- population exposure
- geo activity
- tech activity
- compound threat detection
- weather threat convergence
- weather impact analysis
- correlation matrix
- anomaly detection
- notification dispatcher
- unified alert store
- unified ingestors

This means Crystal Ball is not starting from zero.

The architecture should build on these existing primitives instead of replacing them.

---

## 3. Test Coverage Suggests Many Advanced Concepts Already Exist

Package scripts indicate tests for:

- what-changed digest
- personal impact
- resilience model
- evidence graph
- truth score
- situation clustering
- baseline deviation
- forecast calibration
- negative evidence
- compound risk
- watchlist relevance
- mission ledger
- time-to-warn
- closed-loop batch
- replay harness
- algorithm health
- causal attribution
- trust budget
- playbook engine
- scenario library
- quality debt
- self-improvement scheduler
- maritime chokepoints
- freight stress
- seismic fusion
- space weather
- cyber APT tracking
- macro stress
- infrastructure grid monitor

This suggests the app already contains many proto-forms of the vision.

The highest value now is integration, hierarchy, and productization.

---

# Core Gap

The app has many powerful parts, but likely still behaves like:

> many feeds and panels plus some correlation.

The desired future is:

> a unified world-state reasoning system where every feed updates shared models, and every UI surface is driven by those models.

That means the next leap is architectural consolidation.

---

# The Next Leap: Intelligence Fabric

## Concept

Create an internal intelligence fabric that sits between raw feeds and UI panels.

Raw feeds should not directly define the user experience.

Instead:

1. feeds produce normalized observations
2. observations update entity state
3. entity state updates system state
4. system state updates pressure / recovery / risk
5. risk updates narratives, alerts, maps, and user impact

This creates a clean path from raw telemetry to cognition.

---

# Proposed Architecture

```text
Raw Sources
  -> Normalized Observations
    -> Entity Registry
      -> System State Engine
        -> Pressure / Recovery / Dependency Models
          -> Situation Engine
            -> Narrative / Alerts / Map / Personal Impact
```

---

# 1. Normalize Everything Into Observations

## Problem

Current feed services likely return many different shapes.

This makes correlation harder.

## Solution

Create a universal `Observation` model.

```ts
interface Observation {
  id: string;
  sourceId: string;
  observedAt: string;
  ingestedAt: string;
  domain: ObservationDomain;
  type: ObservationType;
  title: string;
  summary?: string;
  location?: GeoPoint | GeoRegion;
  entities: EntityReference[];
  severity?: number;
  confidence: number;
  reliability: number;
  freshness: number;
  evidence: EvidenceReference[];
  rawRef?: string;
}
```

## Implementation Guidance

Claude should add adapters that convert existing source outputs into observations.

Do not rewrite every service immediately.

Start with adapters for:

- earthquakes
- NWS / GDACS
- internet outages
- cyber threats
- AIS / maritime
- flight / military movement
- protests / conflict events

---

# 2. Build an Entity Registry

## Problem

The app appears to track many event types, but long-term reasoning requires persistent entities.

## Solution

Create a shared entity registry.

Entities include:

- country
- region
- city
- port
- airport
- ship
- aircraft
- cloud region
- telecom provider
- cable
- power grid region
- military unit
- disease outbreak
- storm
- company
- commodity
- chokepoint

```ts
interface WorldEntity {
  id: string;
  type: EntityType;
  name: string;
  aliases: string[];
  location?: GeoPoint | GeoRegion;
  identifiers: Record<string, string>;
  confidence: number;
  firstSeen: string;
  lastSeen: string;
  sources: string[];
}
```

## Value

This allows Crystal Ball to remember that multiple feeds are talking about the same real-world thing.

---

# 3. Create a Shared System State Layer

## Problem

Panels may each maintain their own state.

The platform needs shared state for civilization systems.

## Solution

Implement `SystemState` as the canonical dynamic health model.

```ts
interface SystemState {
  id: string;
  entityId: string;
  systemType: SystemType;
  pressure: number;
  capacity: number;
  resilience: number;
  fragility: number;
  recovery: number;
  trend: TrendDirection;
  confidence: number;
  drivers: StateDriver[];
  updatedAt: string;
}
```

## First System Types

Start with domains already well represented in the repo:

- seismic impact regions
- weather-affected logistics regions
- maritime chokepoints
- internet regions
- country instability regions
- infrastructure / grid regions

---

# 4. Turn Existing Services Into Model Updaters

## Problem

Many services currently feed panels and alerts.

## Solution

Each service should also emit model updates.

Example:

```text
fetchInternetOutages()
  -> panel data
  -> unified alerts
  -> observations
  -> internet_region SystemState update
  -> pressure signal update
  -> What Changed candidate
```

## Implementation Rule

Every important loader should eventually produce:

- observations
- entity references
- system state deltas
- evidence references

---

# 5. Upgrade “What Changed?” Into the Main Cognitive Product

## Current Opportunity

The repo already has tests for a what-changed digest.

This should become the central product surface.

## Desired Behavior

The app should answer:

> What materially changed since the last time I looked?

It should rank changes by:

- novelty
- severity
- confidence
- user relevance
- dependency impact
- escalation potential
- contradiction presence

```ts
interface MaterialChange {
  id: string;
  title: string;
  summary: string;
  changeType: ChangeType;
  previousState?: string;
  currentState?: string;
  magnitude: number;
  confidence: number;
  affectedSystems: string[];
  evidence: EvidenceReference[];
  whyItMatters: string;
  nextIndicators: string[];
}
```

## UX Priority

This should be more important than raw alert feeds.

---

# 6. Create an Evidence Graph

## Current Opportunity

The package scripts already reference evidence graph and truth score tests.

These concepts should become core architecture.

## Goal

Every conclusion should be backed by evidence nodes.

```ts
interface EvidenceNode {
  id: string;
  sourceId: string;
  claim: string;
  observedAt: string;
  reliability: number;
  freshness: number;
  confidence: number;
  supports: string[];
  contradicts: string[];
}
```

## Value

This enables:

- explainability
- contradiction detection
- source reliability scoring
- confidence calibration
- analyst trust

---

# 7. Make Contradiction Detection First-Class

## Why This Adds Real Value

Most apps only show confidence.

Crystal Ball should show where reality is unclear.

Examples:

- official reports conflict with sensor data
- local news conflicts with satellite observations
- outage provider data conflicts with BGP data
- social media chatter conflicts with emergency alerts

## Implementation

Create `ContradictionFinding` outputs from evidence graph comparison.

These should appear in:

- event detail views
- What Changed
- analyst narratives
- confidence scoring

---

# 8. Add Negative Evidence

## Concept

Negative evidence means expected confirming signals are missing.

Example:
A supposed major attack is reported, but:

- no outage spike
- no official alert
- no emergency chatter
- no transportation disruption

That does not disprove it, but lowers confidence.

## Why It Matters

This makes Crystal Ball feel more intelligent and less hype-driven.

## Implementation

Extend evidence scoring with:

- expected signals
- missing signals
- stale signals
- silence signals

---

# 9. Create “Situation Objects” as the Main Unit of Intelligence

## Problem

Events are too small.

Crises are not single events.

## Solution

Group related observations into `Situation` objects.

```ts
interface Situation {
  id: string;
  title: string;
  domain: SituationDomain;
  status: SituationStatus;
  severity: number;
  confidence: number;
  startedAt: string;
  updatedAt: string;
  observations: string[];
  entities: string[];
  systems: string[];
  evidence: string[];
  contradictions: string[];
  likelyCascades: CascadePath[];
  nextIndicators: string[];
}
```

## Examples

- “Red Sea Maritime Disruption”
- “Midwest Severe Weather Logistics Risk”
- “Regional Internet Instability in Eastern Europe”
- “H5N1 Food System Pressure”

## Product Rule

Users should primarily interact with situations, not individual feed items.

---

# 10. Add Situation Lifecycle

Situations should have lifecycle states:

- emerging
- escalating
- active
- stabilizing
- recovering
- resolved
- dormant
- reactivating

This adds temporal intelligence.

---

# 11. Build a Domain-to-System Translation Layer

## Problem

Different domains use different language.

Weather talks about storms.
Cyber talks about IOCs.
Maritime talks about vessels.
Economics talks about prices.

## Solution

Translate all domain events into system impacts.

Examples:

```text
Hurricane warning -> logistics pressure + power fragility + evacuation behavior
BGP anomaly -> internet pressure + telecom fragility + cloud dependency risk
Port congestion -> logistics pressure + commodity delay + inflation pressure
Disease outbreak -> health pressure + food pressure + travel risk
```

This is the bridge from feed monitoring to world modeling.

---

# 12. Add Driver-Based Scores, Not Magic Numbers

Scores should never be unexplained.

Every score must have drivers.

```ts
interface ScoreDriver {
  id: string;
  label: string;
  contribution: number;
  direction: 'up' | 'down';
  evidence: EvidenceReference[];
}
```

Example:

Cyber Tension +14 because:

- CISA KEV growth +4
- regional outage expansion +5
- BGP instability +3
- ransomware chatter +2

This makes the system trustworthy.

---

# 13. Convert Panels Into Lenses

## Current Problem

Many panels can become clutter.

## Better Model

Panels should become intelligence lenses over shared state.

Examples:

- Cyber Lens
- Logistics Lens
- Weather Lens
- Seismic Lens
- Infrastructure Lens
- Personal Impact Lens
- Recovery Lens
- Contradiction Lens

Lenses should read from shared intelligence objects, not duplicate logic.

---

# 14. Add an Intelligence Workbench

## Purpose

For power users and Claude implementation, create a debug/analyst view that shows the reasoning chain.

Workbench sections:

- observations
- entities
- evidence graph
- system states
- situations
- pressure signals
- contradictions
- narratives
- generated alerts

This helps validate the intelligence engine.

---

# 15. Add Data Product Contracts

## Why

The app has many services. Without contracts, complexity grows.

## Required Contracts

Create TypeScript contracts for:

- Observation
- EvidenceNode
- WorldEntity
- SystemState
- Situation
- MaterialChange
- PressureSignal
- RecoveryState
- ContradictionFinding
- NarrativeBrief
- PersonalImpactFinding
- PulseScore

Place in a dedicated area such as:

```text
src/services/intelligence/contracts/
```

or:

```text
src/types/intelligence.ts
```

---

# 16. Add Source Reliability & Freshness Weighting Everywhere

The codebase already has data freshness concepts.

Upgrade this into scoring.

Every derived insight should account for:

- source reliability
- source freshness
- source agreement
- source independence
- historical accuracy
- contradiction load

This prevents stale or weak feeds from dominating conclusions.

---

# 17. Create “Time to Warn” as a Core Metric

The repo already has ops tests around time-to-warn.

Make this a top-level quality metric.

For each situation, track:

- first weak signal
- first material change
- first alert
- mainstream confirmation if known
- user notification time

Goal:
> improve warning lead time without increasing false alarms.

---

# 18. Add Forecast Calibration Loop

The package scripts reference forecast calibration tests.

This should become an operational loop.

For predictions:

- store forecast
- define resolution criteria
- evaluate outcome
- score accuracy
- adjust future confidence

This prevents “AI prediction theater.”

---

# 19. Add Mission Ledger / Decision Ledger

The repo appears to include mission ledger tests.

Use this as a permanent memory for:

- generated insights
- notifications
- decisions
- user acknowledgments
- forecast outcomes
- missed signals
- false positives

This creates a learning system.

---

# 20. Add Quality Gates for Intelligence

Before surfacing a major conclusion, require:

- minimum evidence count
- source independence check
- freshness check
- contradiction scan
- negative evidence check
- confidence calibration
- driver explanation

This turns Crystal Ball into a more serious intelligence product.

---

# 21. Add “Insight Promotion Ladder”

Not every signal should become an alert.

Use levels:

1. Raw Observation
2. Correlated Signal
3. Material Change
4. Situation Update
5. Watchlist Item
6. Alert
7. Critical Operational Brief

This reduces noise.

---

# 22. Add Watchlists as a Core Primitive

Watchlists should not just be saved searches.

They should be active monitoring models.

Examples:

- Red Sea shipping
- H5N1 food system risk
- Midwest severe weather
- Taiwan escalation
- cloud/internet instability
- local infrastructure risk

Each watchlist tracks:

- relevant entities
- pressure trend
- key indicators
- contradictions
- next indicators
- personal impact

---

# 23. Add “Next Indicators to Watch” Everywhere

Every situation and brief should include:

- what would confirm escalation
- what would reduce concern
- what signals are missing
- what sources need refresh

This makes the AI operationally useful.

---

# 24. Add Recovery & Stabilization as Positive Intelligence

Current threat products often over-index on danger.

Crystal Ball should track:

- restoration
- aid arrival
- normalization
- rerouting success
- infrastructure repair
- market stabilization
- disease containment

This makes the platform more accurate and less doom-centric.

---

# 25. Add Local User Relevance Scoring

Personal impact should not be a separate feature bolted on later.

Every situation should have a relevance score to the user.

Inputs:

- user location
- saved locations
- travel routes
- user-selected domains
- infrastructure dependencies
- notification preferences

Output:

- local relevance
- personal impact summary
- recommended monitoring

---

# 26. Add “Hidden Dependencies” Detail View

When user opens a situation, show hidden dependencies.

Example:
A port disruption should show:

- shipping lanes
- commodities affected
- fuel exposure
- nearby rail corridors
- downstream regions
- alternate routes

This is where Crystal Ball feels magical.

---

# 27. Add Scenario Backtesting Before Simulation

Before building full simulations, implement backtesting.

Replay historical situations through the new model:

- hurricane logistics disruption
- major cyber outage
- earthquake + tsunami alert
- port congestion event
- civil unrest escalation

Evaluate:

- did weak signals appear?
- did pressure scores rise?
- did What Changed catch it?
- did forecast calibration work?

---

# 28. Create an Implementation Migration Plan

## Step 1 — Contracts

Add shared contracts for intelligence primitives.

## Step 2 — Observation Adapters

Wrap existing services into normalized observations.

## Step 3 — Entity Registry

Start entity linking for countries, regions, airports, ports, internet regions, and major infrastructure.

## Step 4 — Situation Store

Create situation clustering and lifecycle management.

## Step 5 — What Changed v2

Use situations and system states instead of raw events.

## Step 6 — Evidence Graph

Attach evidence and contradictions to every major insight.

## Step 7 — Score Drivers

Replace opaque scores with driver-based score explanations.

## Step 8 — UI Lenses

Convert panels into lenses over situations and system states.

## Step 9 — Personal Relevance

Add user relevance scoring to every situation.

## Step 10 — Forecast Calibration

Track outcomes and improve confidence over time.

---

# 29. What Claude Should Build First

## PR 1: Intelligence Contracts

Add shared types:

- Observation
- EvidenceNode
- WorldEntity
- SystemState
- Situation
- MaterialChange
- ScoreDriver
- ContradictionFinding

## PR 2: Observation Adapter MVP

Convert 3-5 existing services into normalized observations:

- earthquakes
- internet outages
- NWS/GDACS
- cyber threats
- maritime chokepoints

## PR 3: Situation Store MVP

Cluster observations into situations by:

- geography
- domain
- entities
- time window
- semantic similarity

## PR 4: What Changed v2

Generate material changes from situation deltas, not raw feed changes.

## PR 5: Evidence Graph MVP

Attach supporting and contradicting evidence to situation summaries.

## PR 6: Intelligence Workbench

Add a developer/analyst panel for inspecting the intelligence pipeline.

## PR 7: Driver-Based Scores

Add visible score drivers for pulse, pressure, risk, and confidence.

---

# 30. The True Design Upgrade

The current app appears to be rich in data and modules.

The next major design upgrade is not more richness.

It is coherence.

Crystal Ball should become an intelligence fabric where:

- feeds become observations
- observations become evidence
- evidence updates entities
- entities update systems
- systems become situations
- situations produce material changes
- material changes drive narratives, alerts, and maps

That is how Crystal Ball moves from impressive to genuinely powerful.

---

# Final North Star

Crystal Ball should not be the app with the most feeds.

It should be the app that best turns chaotic global telemetry into:

- coherent situations
- explainable risk
- personal relevance
- early warning
- strategic foresight
- operational clarity

That is the next leap.
