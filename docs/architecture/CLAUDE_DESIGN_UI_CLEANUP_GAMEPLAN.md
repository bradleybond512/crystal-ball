# Crystal Ball — Claude Design UI Cleanup Gameplan

## Purpose

This document gives Claude a detailed, implementation-ready plan for using Claude Design or a design-focused Claude session to clean up and modernize the Crystal Ball UI.

The goal is not simply to make the app prettier.

The goal is to restructure Crystal Ball around a clear operational cognition model so the UI can support:
- planetary situational awareness
- evidence-backed intelligence
- What Changed briefs
- Situation-centric workflows
- confidence and uncertainty explanation
- source health visibility
- personal impact
- replay and diagnostics
- globe/map intelligence layers
- future epistemic reasoning systems

Crystal Ball should feel:
- calm under complexity
- operational
- cinematic but restrained
- trustworthy
- high-density but readable
- futuristic but not gimmicky
- powerful without being chaotic

The redesign should produce:

> structured cognition, not visual noise.

---

# Core Design Thesis

Crystal Ball should not look like:
- a generic dashboard
- a feed wall
- a map with random panels
- a hacker terminal
- a toy threat map
- a cluttered OSINT board

It should feel like:

> a disciplined planetary intelligence command center.

The UI must help the user answer:
- What changed?
- What matters now?
- Why does it matter?
- How confident are we?
- What evidence supports this?
- What contradicts this?
- What is missing?
- What affects me?
- What should I watch next?

---

# Highest-Level UI Problem

The biggest UI risk is not lack of polish.

The biggest risk is:

> information architecture collapse.

The app has many data sources, panels, intelligence services, map overlays, diagnostics, and planned reasoning layers.

If everything is surfaced equally, the user experience becomes:
- overwhelming
- noisy
- redundant
- exhausting
- hard to trust
- hard to navigate
- hard to implement cleanly

Claude Design should solve:

> how to compress vast intelligence into clear operational surfaces.

---

# Primary Design Goal

Restructure the UI around the Crystal Ball intelligence spine:

```text
Observation
→ Evidence
→ Entity
→ Situation
→ Material Change
→ Operational Brief
→ User Understanding
```

This means the UI should not be source-first.

It should be:
- Situation-first
- Brief-first
- Evidence-backed
- Confidence-aware
- progressively disclosed

---

# The Five Surfaces That Matter Most

Do not design around 30 equal panels.

Design around five primary surfaces.

## 1. Command Center

The default daily view.

Answers:

> What do I need to know right now?

Shows:
- current operational brief
- top active Situations
- What Changed
- personal impact
- source health warnings
- next indicators
- recommended actions

## 2. Situation Detail

The canonical drill-down view.

Every meaningful alert, map marker, SMS command, What Changed item, or notification should eventually resolve to a Situation Detail view.

Shows:
- executive summary
- severity
- confidence
- meta-confidence if available
- lifecycle state
- evidence
- contradictions
- missing evidence
- assumptions
- hypotheses
- next indicators
- personal impact
- source health
- timeline
- recovery state

## 3. Globe / Map Lens

The spatial cognition layer.

Shows:
- geographic distribution
- instability flows
- confidence weather
- hidden infrastructure
- domain overlays
- future shadows eventually

The map should support the intelligence model, not compete with it.

## 4. What Changed

The habit-forming intelligence brief.

Answers:

> What materially changed since I last looked?

Shows:
- new situations
- severity changes
- confidence changes
- contradiction changes
- recovery changes
- personal relevance changes
- degraded source changes

## 5. Intelligence Workbench

Advanced/debug view.

Shows:
- evidence graph
- raw observations
- source health
- algorithm drivers
- replay status
- promotion ladder
- calibration
- confidence decomposition

This is for power users and Claude debugging, not the default experience.

---

# Recommended App Modes

Claude Design should organize the app into explicit modes.

## Command Mode

Default.

High-level operational awareness.

Focus:
- brief
- top situations
- personal impact
- what changed

## Globe Mode

Immersive world view.

Focus:
- map overlays
- domain layers
- confidence weather
- hidden systems

## Analyst Mode

Deep reasoning view.

Focus:
- evidence
- contradictions
- hypotheses
- assumptions
- confidence drivers

## Explain Mode

Why-focused view.

Focus:
- why risk moved
- what evidence supports it
- what would invalidate it
- what is missing

## Replay Mode

Historical/test view.

Focus:
- timeline replay
- forecast outcomes
- prior warnings
- replay fixtures

## Collection Mode

Observability view.

Focus:
- blind spots
- source health
- stale data
- coverage gaps
- next-best-source recommendations

---

# Navigation Doctrine

The UI should not expose every feature as a peer.

Recommended high-level navigation:

```text
Command
Globe
Situations
What Changed
Collection
Replay
Workbench
Settings
```

## Navigation Rules

- Command is default.
- Situations are the primary intelligence object.
- Raw feeds are secondary.
- Diagnostics live behind Workbench/Settings.
- Source health appears contextually where it affects confidence.
- Map overlays are organized by lens, not dumped into one layer list.

---

# Information Hierarchy

Every major surface should follow this hierarchy:

```text
1. Summary
2. Confidence
3. Why it matters
4. Top drivers
5. Personal relevance
6. What changed
7. What to watch next
8. Evidence / raw detail
```

Do not show raw detail before the user understands significance.

---

# Progressive Disclosure Rules

Crystal Ball should reveal detail in layers.

## Level 1 — Topline

One sentence summary.

Example:

> Midwest severe weather is increasing logistics and power disruption risk.

## Level 2 — Operational Meaning

Why it matters.

Example:

> Risk is elevated because storm warnings overlap power outage reports and transport corridors.

## Level 3 — Confidence

Evidence quality.

Example:

> Confidence: medium-high. NWS fresh. Outage feed fresh. Road data stale.

## Level 4 — Evidence

Source-backed facts.

## Level 5 — Raw Data

Only on demand.

---

# Visual Design Direction

The visual language should be:
- dark, calm, high-contrast
- precise
- restrained
- cinematic but not neon
- military/operations inspired but not cosplay
- data-dense but organized
- mature and trustworthy

Avoid:
- constant red everywhere
- fake hacker green
- excessive glow
- too many animations
- tiny unreadable labels
- panel overload
- ambiguous icon-only controls

---

# Visual Semantics

Color must mean something.

## Suggested Semantic Model

- Red: immediate danger / critical alert only
- Orange: elevated operational risk
- Yellow: watch / uncertainty / degraded state
- Blue: information / normal intelligence
- Purple: cyber / invisible systems
- Green: recovery / stabilization
- Gray: stale / unknown / degraded source

## Rule

Do not use visual intensity unless the intelligence model justifies it.

No fake urgency.

---

# Component System Claude Should Design

Claude Design should produce reusable components, not one-off screens.

## Core Intelligence Components

### OperationalBriefCard

Displays:
- summary
- top 3 situations
- what changed
- personal impact
- source health warning

### SituationCard

Displays:
- title
- lifecycle state
- severity
- confidence
- top driver
- affected region
- personal relevance badge

### SituationDetailPanel

Displays the full Situation view.

### ConfidenceBadge

Displays:
- confidence level
- meta-confidence if available
- source degradation indicator

### ConfidenceBreakdown

Displays:
- source reliability
- freshness
- corroboration
- contradictions
- negative evidence
- calibration

### EvidenceTimeline

Displays evidence over time.

### HypothesisStack

Displays competing hypotheses and probability movement.

### SourceHealthStrip

Displays degraded/stale/single-source warnings.

### WhatChangedItem

Displays material change with magnitude, direction, confidence, and why it matters.

### NextIndicatorsList

Displays what to watch next.

### BlindSpotPanel

Displays collection gaps and observability limits.

### DependencyFlow

Displays hidden dependency chains.

### PersonalImpactCard

Displays relevance to saved places, travel, utilities, or watch missions.

### ReplayTimeline

Displays time-based situation evolution.

### ModeSwitcher

Switches Command / Globe / Analyst / Explain / Replay / Collection.

---

# Surface-Level Design Requirements

## Command Center Requirements

The Command Center should include:

### Header
- global/state summary
- current mode
- last refresh
- source health status

### Primary Brief
- one paragraph operational brief
- top material change
- top personal impact

### Top Situations
- 3 to 5 SituationCards
- ranked by operational importance

### What Changed
- compact list
- clearly marked increases/decreases

### Watch Next
- next indicators
- missing evidence
- source limitations

### Actions
- monitor
- prepare
- investigate
- open Situation

---

## Situation Detail Requirements

Situation Detail is the most important drill-down surface.

Sections:

1. Header
2. Executive summary
3. Lifecycle state
4. Severity/confidence
5. Why it matters
6. What changed
7. Evidence timeline
8. Contradictions
9. Missing evidence / blind spots
10. Hypotheses
11. Assumptions
12. Next indicators
13. Personal impact
14. Recovery/stabilization
15. Raw sources / debug expandable

---

## Globe Mode Requirements

The globe should be beautiful but subordinate to intelligence.

Required lens types:
- Risk Lens
- Confidence Lens
- Source Health Lens
- Infrastructure Lens
- Cyber Lens
- Weather Lens
- Logistics Lens
- Recovery Lens

Map interactions:
- click region -> regional brief
- click event -> Situation Detail
- click layer -> explanation of what the layer means
- hover -> small tooltip only
- detail appears in side panel, not floating chaos

---

## What Changed Requirements

What Changed should be filterable by:
- global
- local
- watch missions
- domain
- severity
- confidence movement
- source health
- recovery

Each item should show:
- changed thing
- previous state
- new state
- why it matters
- confidence impact
- link to Situation

---

## Collection Mode Requirements

Collection Mode should answer:

> Where is Crystal Ball blind?

Show:
- stale sources
- degraded providers
- low observability regions
- single-source claims
- missing follow-on signals
- candidate sources to add
- confidence penalties

This is one of the most elite surfaces.

---

# Claude Design Workflow

## Step 1 — Inventory Existing UI

Claude should inspect:
- panels
- map overlays
- command center
- diagnostics
- settings
- alert surfaces
- globe components
- data-heavy components

Output:
- component inventory
- redundant surfaces
- unclear responsibilities
- clutter hotspots
- inconsistent patterns

## Step 2 — Map Existing UI to Target Surfaces

Every existing panel should be categorized as:

```text
Command Center
Situation Detail
Globe Lens
What Changed
Collection Mode
Replay Mode
Workbench
Secondary / Deprecated
```

Output:
- migration map
- keep/merge/deprecate recommendations

## Step 3 — Define Information Architecture

Claude should propose:
- navigation hierarchy
- mode hierarchy
- panel ownership
- drill-down paths
- surface boundaries

## Step 4 — Define Component System

Claude should produce:
- reusable components
- props/contracts
- state ownership
- visual states
- empty/loading/error/degraded states

## Step 5 — Produce Implementation Plan

Claude should break implementation into small PRs.

---

# Recommended UI PR Sequence

## PR 1 — UI Inventory and Surface Map

Create a markdown inventory:

```text
docs/ui/UI_INVENTORY_AND_SURFACE_MAP.md
```

Do not change code yet.

## PR 2 — Design Tokens and Visual Semantics

Add or standardize:
- spacing
- typography
- color semantics
- status colors
- confidence colors
- source health colors
- recovery colors

## PR 3 — Core Intelligence Components

Build:
- SituationCard
- ConfidenceBadge
- SourceHealthStrip
- WhatChangedItem
- NextIndicatorsList

No major layout changes yet.

## PR 4 — Command Center Redesign MVP

Refactor Command Center around:
- OperationalBrief
- Top Situations
- What Changed
- Personal Impact
- Source Health

## PR 5 — Situation Detail MVP

Build canonical Situation Detail panel.

This should become the main drill-down view.

## PR 6 — Mode System

Add Command / Globe / Analyst / Explain / Replay / Collection mode structure.

## PR 7 — Collection Mode MVP

Add source health / blind spot / collection gap view.

## PR 8 — Globe Lens Cleanup

Organize map overlays into clean lens groups.

## PR 9 — Workbench Consolidation

Move raw diagnostics and algorithm internals into Workbench.

## PR 10 — Interaction Polish

Add:
- transitions
- keyboard shortcuts
- empty states
- loading states
- reduced-motion handling
- responsive behavior

---

# Claude Design Prompt

Use this exact prompt for Claude Design:

```text
You are redesigning Crystal Ball, a Tauri + TypeScript + DeckGL planetary intelligence app.

Do not make it merely prettier.

Restructure the UI around operational cognition.

Core doctrine:
Observation -> Evidence -> Entity -> Situation -> Material Change -> Operational Brief -> User Understanding.

Primary surfaces:
1. Command Center
2. Situation Detail
3. Globe / Map Lens
4. What Changed
5. Intelligence Workbench
6. Collection Mode
7. Replay Mode

Design goals:
- reduce panel sprawl
- make Situations primary
- make Command Center the default daily surface
- progressively disclose evidence
- show confidence and uncertainty clearly
- surface source health and blind spots
- make the globe support intelligence, not dominate it
- keep visual style calm, cinematic, operational, and trustworthy

Deliver:
- information architecture
- navigation model
- mode system
- component inventory
- reusable component design
- surface consolidation map
- implementation PR sequence
- design tokens / visual semantics

Avoid:
- flashy hacker UI
- endless panels
- excessive red
- unlabeled icons
- fake urgency
- raw-feed-first design
- AI summaries without evidence
```

---

# Acceptance Criteria

The UI redesign succeeds if:

- user can understand top risks within 10 seconds
- user can answer “what changed?” within 1 click
- every major alert opens a Situation Detail
- confidence and uncertainty are visible
- source degradation is visible
- raw feeds are secondary
- Command Center feels primary
- map/globe and panels are synchronized
- diagnostics are consolidated into Workbench
- personal impact is visible but privacy-preserving
- visual language is consistent
- no new panel sprawl is introduced

---

# What Not To Do

Do not:
- redesign everything in one PR
- hide source health
- make globe visuals arbitrary
- turn diagnostics into default UX
- use red for everything
- create new panels for every feed
- rely on LLM summaries without evidence
- make tiny unreadable intelligence cards
- bury What Changed
- bury Situation Detail

---

# Final North Star

The UI should make Crystal Ball feel like:

> a calm, elite intelligence command center that can absorb planetary complexity and present the user with what matters, why it matters, how confident the system is, and what to watch next.

The goal is not spectacle.

The goal is:

> operational clarity at planetary scale.
