# Crystal Ball — Intelligence Productization Doctrine

## Purpose

This document is the next refinement beyond the master vision, system dynamics plan, UI vision, and implementation gap analysis.

The previous architecture plans define what Crystal Ball should become.

This document defines how to turn the existing codebase into that product without drowning in disconnected capabilities.

The repo already has many advanced ingredients:
- truth scoring
- evidence graph
- negative evidence
- situation clustering
- baseline deviation
- compound risk
- forecast calibration
- watchlist relevance
- personal impact
- what-changed digest
- action briefs
- replay harness
- provider redundancy
- diagnostics panels
- algorithm health
- mission ledger
- trust budget
- scenario library
- quality debt tracking
- maritime, seismic, cyber, infrastructure, weather, macro, shortage, and synthesis modules

The next leap is not inventing more components.

The next leap is productizing them into a single coherent intelligence experience.

---

# Core Productization Principle

Crystal Ball must stop feeling like:

> many impressive systems placed beside each other.

It must start feeling like:

> one intelligence organism with many senses.

Every capability should feed one cognitive loop:

```text
Sense -> Normalize -> Correlate -> Explain -> Prioritize -> Act -> Learn
```

If a feature does not clearly fit this loop, it should be redesigned or demoted.

---

# The Highest-Value Architectural Shift

## Current likely pattern

```text
source -> loader -> panel / alert / map layer
```

## Desired pattern

```text
source -> observation -> evidence -> entity -> situation -> decision surface
```

Decision surfaces include:
- Command Center
- What Changed
- Situation Detail
- Personal Impact
- Map Lens
- Intelligence Workbench
- Alerts / Notifications
- Replay / Backtest

Raw feeds should never be the main product.

The product is the interpretation layer.

---

# 1. Promote Situations Above Feeds

## Rule

A user should rarely have to reason from raw feeds.

The primary object should be the Situation.

A Situation is a living intelligence object that groups related evidence over time.

Examples:
- "Midwest Severe Weather Logistics Threat"
- "Red Sea Maritime Disruption"
- "Regional Internet Instability in Eastern Europe"
- "H5N1 Food System Pressure"
- "Taiwan Strait Escalation Watch"
- "Major Cloud Dependency Risk"

## Situation Requirements

Each Situation must include:
- title
- status
- severity
- confidence
- domain
- affected entities
- affected systems
- supporting evidence
- contradictions
- missing evidence
- pressure trend
- recovery trend
- personal relevance
- what changed
- why it matters
- next indicators to watch
- recommended actions

## Lifecycle

Every Situation must be in one lifecycle state:
- emerging
- escalating
- active
- stabilizing
- recovering
- resolved
- dormant
- reactivating

## Claude Task

Refactor or wrap existing situation-clustering outputs so they produce durable Situation objects with lifecycle state and evidence links.

---

# 2. Create the Situation Detail Page / Panel

## Why

This is the missing product surface that ties everything together.

When a user clicks any alert, map event, What Changed item, notification, or command-center item, it should open a Situation Detail surface.

## Required Sections

### Header
- situation title
- current lifecycle state
- severity
- confidence
- last updated
- affected regions

### Executive Summary
One concise paragraph:
- what happened
- why it matters
- what changed
- likely next movement

### Evidence Stack
Show:
- supporting evidence
- contradicting evidence
- stale evidence
- missing expected evidence

### Causality Chain
Show:

```text
trigger -> system stress -> downstream impact -> user impact
```

### Pressure & Recovery
Show:
- pressure trend
- recovery trend
- stress drivers
- stabilizing drivers

### What Changed
Show material deltas:
- new evidence
- severity change
- confidence change
- geographic spread
- new contradiction
- recovery movement

### Personal Impact
Show relevance to:
- user location
- saved places
- travel routes
- watchlists
- utilities
- infrastructure dependencies

### Next Indicators
Show:
- signals that would confirm escalation
- signals that would reduce concern
- sources that need refresh

### Actions
Show action briefs:
- monitor
- prepare
- act now
- avoid / reroute / verify

## Claude Task

Build this as the canonical drill-down UI before adding more panels.

---

# 3. Make Command Center the Main Product Surface

## Principle

The Command Center should answer:

> What do I need to know right now?

It should not be a diagnostics aggregator.

Diagnostics are important, but should be secondary.

## Command Center Should Show

1. World pulse
2. Top material changes
3. Top active situations
4. Personal impact items
5. Next indicators to watch
6. System confidence / degraded sources
7. Recommended actions

## Ranking Formula

Rank items using:
- severity
- confidence
- novelty
- proximity
- user relevance
- escalation potential
- dependency impact
- contradiction weight
- freshness

## Claude Task

Create a `rankOperationalImportance()` utility that all top-level product surfaces use.

Do not let each panel invent its own sorting logic.

---

# 4. Make What Changed the Daily Intelligence Brief

## Principle

What Changed is not a widget.

It is the main habit-forming product loop.

## It Should Answer

- What changed since the last session?
- What changed in the last hour?
- What changed in the last 24 hours?
- What changed materially in my watchlists?
- What changed near me?
- What changed that contradicts previous assumptions?

## Change Categories

- new situation
- severity increase
- severity decrease
- confidence increase
- confidence decrease
- geographic spread
- source contradiction
- recovery progress
- hidden dependency exposed
- personal relevance increase
- forecast resolved
- forecast missed

## Claude Task

Upgrade What Changed so it reads from Situation deltas and Evidence Graph deltas, not raw event counts.

---

# 5. Add an Intelligence Quality Bar

## Problem

Advanced apps fail when they surface weak conclusions too confidently.

## Rule

No major insight should be promoted unless it passes a quality bar.

## Required Checks

Before promoting a finding to Situation Update / Alert / Brief:
- evidence count check
- source independence check
- freshness check
- contradiction check
- negative evidence check
- confidence calibration check
- severity threshold check
- user relevance check
- duplicate situation check

## Promotion Ladder

```text
Raw Observation
  -> Correlated Signal
    -> Material Change
      -> Situation Update
        -> Watchlist Item
          -> Alert
            -> Critical Brief
```

## Claude Task

Create an `insight-promotion.ts` service that implements this ladder.

---

# 6. Separate Intelligence From Presentation

## Rule

No component should calculate major intelligence logic locally.

Components render intelligence objects.
Services compute intelligence objects.

## Bad Pattern

```text
Panel fetches feed -> panel filters -> panel scores -> panel renders
```

## Good Pattern

```text
Service creates Situation / MaterialChange / ImpactFinding -> panel renders
```

## Claude Task

When touching panels, move scoring, filtering, and reasoning into services.

---

# 7. Add an Intelligence Contract Layer

## Purpose

The codebase already has many types. The next step is a product contract layer.

Create canonical outputs for product surfaces.

## Contracts

```ts
interface OperationalBrief {
  id: string;
  title: string;
  generatedAt: string;
  scope: 'global' | 'regional' | 'personal' | 'watchlist';
  summary: string;
  topSituations: SituationSummary[];
  materialChanges: MaterialChange[];
  personalImpacts: PersonalImpactSummary[];
  degradedSources: SourceHealthSummary[];
  nextIndicators: NextIndicator[];
  recommendedActions: RecommendedAction[];
  confidence: number;
}
```

```ts
interface SituationSummary {
  situationId: string;
  title: string;
  lifecycle: SituationLifecycle;
  severity: number;
  confidence: number;
  whyItMatters: string;
  affectedSystems: string[];
  topDrivers: ScoreDriver[];
}
```

## Claude Task

Create stable contracts for:
- OperationalBrief
- SituationSummary
- MaterialChange
- NextIndicator
- RecommendedAction
- SourceHealthSummary

These contracts should power Command Center, What Changed, exports, and future mobile views.

---

# 8. Add Source Health as a First-Class User Signal

## Why

A world intelligence app must know when its senses are degraded.

## Surface This Clearly

Examples:
- "AIS coverage degraded in this region"
- "Only one source confirms this"
- "Weather source stale by 46 minutes"
- "Cyber signal has high contradiction load"

## Claude Task

Integrate provider redundancy and data freshness into every high-level insight.

Every Situation should expose:
- source health
- confidence penalty
- degraded domains
- missing critical sources

---

# 9. Build the Intelligence Workbench Before More Magic

## Purpose

The Workbench is how Claude and future contributors debug the reasoning engine.

## It Should Show

For any Situation:
- raw observations
- normalized observations
- evidence graph
- truth score
- negative evidence
- contradictions
- baseline deviation
- compound risk
- forecast calibration state
- promotion ladder state
- final user-facing summary

## Claude Task

Build the Workbench as a developer-only or advanced-mode panel.

This will prevent invisible reasoning bugs.

---

# 10. Add Forecast Accountability Everywhere

## Principle

Predictions must be accountable.

Every forecast should have:
- forecast text
- issued time
- forecast horizon
- measurable resolution criteria
- confidence
- outcome status
- Brier / accuracy update

## Forecast States

- pending
- confirmed
- partially_confirmed
- failed
- expired
- unresolved

## Claude Task

Any future-shadow, cascade, or risk forecast must write to the forecast calibration system.

No untracked prediction claims.

---

# 11. Add Model Humility Language

## Why

The app should feel serious, not sensational.

## Required Language Patterns

Use:
- "may indicate"
- "early signal"
- "confidence limited by"
- "contradictory evidence"
- "not yet confirmed"
- "watch for"
- "would increase confidence if"

Avoid:
- "will happen"
- "confirmed" unless verified
- "guaranteed"
- "inevitable"
- hype language

## Claude Task

Create copy guidelines and maybe a formatter for intelligence language.

---

# 12. Add Watchlists as Living Missions

## Current Risk

Watchlists can become passive filters.

## Better Model

A watchlist should be a living mission file.

Each watchlist contains:
- scope
- entities
- baseline state
- key indicators
- active situations
- material changes
- next indicators
- personal relevance
- open questions
- forecast history

Examples:
- H5N1 food pressure
- Red Sea shipping
- Taiwan escalation
- Midwest severe weather
- cloud/internet instability

## Claude Task

Design `WatchMission` as a higher-level wrapper over watchlist relevance.

---

# 13. Create Open Questions for Every Situation

## Why

Real intelligence work is driven by questions.

## Examples

For a port disruption:
- Are vessels rerouting or waiting?
- Are fuel shipments affected?
- Are nearby ports absorbing traffic?
- Is the delay temporary or worsening?

For a cyber outage:
- Is this regional or provider-specific?
- Are BGP routes unstable?
- Are banks, hospitals, or telecoms affected?
- Is there evidence of attack vs failure?

## Claude Task

Add `openQuestions: IntelligenceQuestion[]` to Situation.

Use them to drive:
- source refresh priorities
- Ask-the-Data suggestions
- next indicators
- analyst narratives

---

# 14. Add Collection Requirements

## Concept

When confidence is low, Crystal Ball should know what data it needs next.

## Example

"Confidence is limited because AIS coverage is missing. Refresh maritime provider or inspect satellite/port data."

## Contract

```ts
interface CollectionRequirement {
  id: string;
  situationId: string;
  question: string;
  neededSourceType: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  wouldChangeConfidence: number;
}
```

## Claude Task

Generate collection requirements for unresolved situations and contradictions.

---

# 15. Add Analyst Memory, Not Just Event Memory

## Principle

Crystal Ball should remember what it thought before.

For every Situation, store:
- previous assessments
- confidence changes
- missed predictions
- resolved contradictions
- user feedback
- action taken
- what improved the model

## Value

This makes the app learn over time.

## Claude Task

Use mission ledger / forecast calibration / feedback systems as persistent analyst memory.

---

# 16. Add Local-First Privacy Boundaries

## Why

Personal impact can become sensitive.

## Rule

User-specific context should remain local-first unless explicitly exported.

Personal context includes:
- home location
- saved places
- travel routes
- utilities
- watchlists
- family places
- personal risk preferences

## Claude Task

Document and enforce boundaries:
- local-only by default
- no analytics for personal impact content
- redacted exports unless user opts in
- clear separation between global intelligence and private user context

---

# 17. Add Failure Mode Design

## Principle

A serious intelligence product must degrade gracefully.

## Failure Modes

- source outage
- stale data
- provider disagreement
- map layer failure
- AI unavailable
- local LLM unavailable
- cloud model budget exhausted
- replay fixture regression
- notification suppressed
- key missing

## User-Facing Behavior

The app should say:
- what degraded
- what is still working
- how confidence changed
- what sources are missing
- whether an alert was suppressed

## Claude Task

Create failure-mode UX requirements for Command Center and Situation Detail.

---

# 18. Add a Product Hierarchy Map

## Purpose

Prevent UI sprawl.

## Recommended Hierarchy

```text
Command Center
  -> What Changed
  -> Active Situations
    -> Situation Detail
      -> Evidence / Causality / Impact / Actions
  -> Map Lenses
  -> Workbench / Diagnostics
```

## Panels That Should Become Secondary

Raw source panels should be secondary to:
- Situation Detail
- What Changed
- Command Center
- Personal Impact

They remain useful, but should not dominate the experience.

---

# 19. Add Acceptance Criteria for “Borderline Magical”

A feature is not magical because it looks futuristic.

It is magical if it does at least one of these:
- connects things the user would not connect
- warns earlier than expected
- explains uncertainty honestly
- reveals hidden dependencies
- personalizes global risk
- remembers what changed
- learns from being wrong
- tells the user what to watch next

## Claude Task

Use these as acceptance criteria for new intelligence features.

---

# 20. Implementation Priority: Best Next 8 PRs

## PR 1 — Intelligence Product Contracts

Create product-level contracts:
- OperationalBrief
- SituationSummary
- SituationDetail
- MaterialChange
- NextIndicator
- RecommendedAction
- CollectionRequirement
- SourceHealthSummary

## PR 2 — Situation Detail Surface

Build the canonical drill-down panel.

Do not wait for every backend model to be perfect.
Use existing intelligence services and progressively enhance.

## PR 3 — Operational Importance Ranking

Create shared ranking function for:
- Command Center
- What Changed
- alerts
- personal impact
- watchlists

## PR 4 — Insight Promotion Ladder

Implement promotion levels from raw observation to critical brief.

## PR 5 — Evidence / Contradiction / Negative Evidence UI

Expose existing intelligence primitives clearly in Situation Detail.

## PR 6 — Watch Missions

Upgrade watchlists into mission-style active monitoring objects.

## PR 7 — Collection Requirements

Generate open questions and missing-source requirements per situation.

## PR 8 — Command Center Productization

Make Command Center consume OperationalBrief and become the primary product surface.

---

# 21. What Not To Do Next

Avoid these traps:

## Do Not Add More Panels First

More panels will increase fragmentation.

## Do Not Add More Scores Without Drivers

Every score must explain itself.

## Do Not Add Predictions Without Calibration

Every forecast must be tracked.

## Do Not Let AI Summaries Float Without Evidence

Every AI output must cite evidence objects.

## Do Not Make Personal Impact Cloud-Dependent

Keep private context local-first.

## Do Not Hide Source Degradation

Source health must be visible.

---

# 22. The Real Next Leap

Crystal Ball already has many advanced subsystems.

The next leap is orchestration.

The app must converge around:
- Situation objects
- Operational Briefs
- Evidence-backed explanations
- Personal relevance
- Forecast accountability
- Collection requirements
- Command Center as the primary surface

That turns the platform from:

> a powerful collection of intelligence tools

into:

> a coherent intelligence product.

---

# Final Instruction to Claude

When implementing future work, ask this before every PR:

> Does this make Crystal Ball better at turning chaotic global telemetry into coherent, evidence-backed, personally relevant situational awareness?

If yes, build it.

If no, redesign it.
