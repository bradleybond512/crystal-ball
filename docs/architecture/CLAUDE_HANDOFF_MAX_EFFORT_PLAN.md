# Crystal Ball — Claude Handoff Max-Effort Plan

## Purpose

This is the final pre-handoff document for Claude.

The architecture docs now define a large vision:

- planetary cognition
- world-state modeling
- intelligence fabric
- advanced system dynamics
- productized Situations
- operational Command Center
- evidence-backed reasoning
- personal impact
- future simulation

This handoff document defines how Claude should implement that vision without degrading code quality, increasing UI fragmentation, or creating untestable intelligence theater.

The goal is to make the next implementation wave:

- incremental
- testable
- safe
- coherent
- product-driven
- architecture-aligned

---

# Core Handoff Instruction

Claude should not add more disconnected panels, services, or scores.

Claude should consolidate the existing intelligence foundation into a coherent product loop:

```text
Observe -> Normalize -> Evidence -> Entity -> Situation -> Brief -> Action -> Learn
```

Every future PR should strengthen this loop.

---

# The Current Strategic Risk

Crystal Ball already has many advanced pieces.

The main risk is not missing ambition.

The main risk is fragmentation.

Without strict implementation discipline, the app can become:

- too many panels
- too many one-off scores
- too many independent services
- too many half-connected models
- too much cognitive load
- too much impressive but non-operational UI

The next implementation wave must reduce fragmentation, not increase it.

---

# Definition of Done for Future Intelligence PRs

A future intelligence feature is not complete unless it includes:

1. Shared contract/type definition
2. Deterministic service logic
3. Unit tests with fixtures
4. Evidence/provenance support
5. Confidence and uncertainty handling
6. Source freshness handling
7. Contradiction / negative evidence handling where relevant
8. Score drivers, not opaque numbers
9. Clear UI surface or integration target
10. Acceptance criteria mapped to user value
11. No direct keychain access
12. No secrets in logs or exports
13. No untracked prediction claims
14. No new major panel unless justified by product hierarchy
15. No live fetches in unit tests

---

# Coding Quality Rules

## 1. Pure Services First

Core intelligence logic should be pure deterministic TypeScript whenever possible.

Preferred pattern:

```text
input fixture -> pure service -> typed output -> tested UI adapter
```

Avoid:

- DOM inside intelligence services
- fetch inside scoring functions
- global mutable state inside algorithms
- UI components doing scoring
- services returning untyped blobs

---

## 2. Contracts Before UI

Before building UI, define the data contract.

Required contracts:

- SituationDetail
- OperationalBrief
- MaterialChange
- SourceHealthSummary
- CollectionRequirement
- OpenQuestion
- RecommendedAction
- IntelligenceQualityGate
- PromotionDecision

UI should render these contracts.

UI should not invent them.

---

## 3. Every Score Needs Drivers

No score should appear without a driver breakdown.

Bad:

```text
Risk score: 82
```

Good:

```text
Risk score: 82
Drivers:

- regional outage growth +18
- provider redundancy degraded +9
- stale confirmation source -6
- prior baseline deviation +14
- negative evidence missing official confirmation -5

```

---

## 4. Forecasts Must Be Accountable

Any feature that predicts, projects, simulates, or implies future risk must write to forecast calibration.

Every forecast needs:

- issued time
- horizon
- confidence
- measurable resolution criteria
- outcome state
- eventual accuracy update

No prediction theater.

---

## 5. Source Health Must Be User-Visible

Every major Situation should expose:

- fresh sources
- stale sources
- degraded providers
- single-source claims
- source disagreement
- confidence penalty from data weakness

The user should understand when Crystal Ball’s senses are degraded.

---

## 6. Personal Impact Must Be Local-First

Private user context should remain local-first by default.

Private context includes:

- saved places
- family places
- travel routes
- utilities
- watchlists
- personal risk preferences

Do not send this to analytics.
Do not include it in exports unless the user explicitly requests it.
Redact by default.

---

# Architecture Guardrails

## Guardrail 1 — Situation-Centric Product

The primary product unit is the Situation, not the feed item.

Every major alert, map marker, Command Center card, What Changed entry, and notification should eventually resolve to a Situation.

---

## Guardrail 2 — Command Center First

The Command Center should become the main product surface.

It should answer:

> What do I need to know right now?

It should show:

- top active Situations
- material changes
- personal impacts
- world pulse
- degraded sources
- recommended actions
- next indicators to watch

---

## Guardrail 3 — Workbench for Debugging, Not Main UX

The Intelligence Workbench should expose reasoning internals for debugging and validation.

It should not become the default user experience.

Default users need clarity.
Power users and Claude need inspectability.

---

## Guardrail 4 — No More Raw Panel Sprawl

Do not add a new panel just because a feed exists.

Ask first:

- does this feed improve an existing Situation?
- does it create evidence?
- does it affect source health?
- does it improve personal impact?
- does it add a hidden dependency?
- does it improve What Changed?

If not, do not add it yet.

---

## Guardrail 5 — Existing Intelligence Services Should Be Reused

Before creating a new service, check whether the functionality belongs in or near:

- `src/services/intelligence/`
- `src/services/insights/`
- `src/services/personal/`
- `src/services/ops/`
- `src/services/diagnostics/`
- `src/services/algorithms/`
- domain-specific services such as maritime, seismic, cyber, weather, infrastructure, shortage, macro

Avoid duplicate parallel systems.

---

# Recommended Final Pre-Handoff Improvements

## 1. Add Architecture Index

Create an architecture index file that tells Claude which document to read for each purpose.

Suggested file:

```text
docs/architecture/INDEX.md
```

Purpose:

- prevent architecture docs from becoming scattered
- make Claude’s entry point obvious
- define implementation order

---

## 2. Add Implementation Milestone Checklist

Create a concise milestone checklist that Claude can execute.

Suggested phases:

1. Product contracts
2. Situation Detail MVP
3. OperationalBrief generator
4. Promotion ladder
5. Source health integration
6. Evidence / contradiction UI
7. Watch Missions
8. Collection requirements
9. Command Center upgrade
10. Forecast accountability enforcement

---

## 3. Add PR Acceptance Template

Create a checklist Claude uses in every PR description.

Checklist:

- contracts added/updated
- tests added
- confidence handling added
- evidence references included
- source freshness considered
- no private context exported
- no untracked predictions
- no panel sprawl
- typecheck passes
- targeted tests pass

---

## 4. Add Test Matrix

Define which tests Claude should run depending on touched area.

Examples:

- intelligence contracts -> `npm run test:intelligence`
- insights / What Changed -> `npm run test:insights`
- personal impact -> `npm run test:personal`
- ops / replay -> `npm run test:ops`
- diagnostics -> `npm run test:diagnostics`
- globe / overlays -> `npm run test:globe`
- weather -> `npm run test:weather`
- all major work -> `npm run typecheck:all`

---

## 5. Add Product Invariants

The app should maintain these invariants:

- Every score explains itself
- Every claim has provenance
- Stale data reduces confidence
- Contradictions are surfaced, not hidden
- Personal impact remains local-first
- Predictions are tracked
- User-facing alerts pass a promotion ladder
- Raw data does not dominate the main UX
- Situations are the primary intelligence object
- Command Center is the primary operational surface

---

# Implementation Sequence for Claude

## Phase 0 — Documentation Setup

Add:

- `docs/architecture/INDEX.md`
- `docs/architecture/IMPLEMENTATION_MILESTONES.md`
- PR checklist section in architecture docs or `.github/pull_request_template.md` if appropriate

## Phase 1 — Product Contracts

Create or consolidate product-level contracts:

- `OperationalBrief`
- `SituationDetail`
- `SituationSummary`
- `MaterialChange`
- `NextIndicator`
- `RecommendedAction`
- `CollectionRequirement`
- `PromotionDecision`
- `SourceHealthSummary`

Likely location:

```text
src/services/intelligence/product-contracts.ts
```

or, if existing patterns prefer:

```text
src/types/intelligence-product.ts
```

Claude should inspect current conventions first.

## Phase 2 — Situation Detail MVP

Build a canonical Situation Detail surface using existing services.

It does not need every future field on day one.

MVP sections:

- title / lifecycle / severity / confidence
- executive summary
- evidence
- contradictions / missing evidence
- what changed
- personal impact
- next indicators
- recommended actions

## Phase 3 — OperationalBrief Generator

Create pure service:

```text
buildOperationalBrief(input) -> OperationalBrief
```

Inputs:

- situations
- material changes
- source health
- personal impact
- current pulse
- degraded providers

Output powers:

- Command Center
- exports
- future mobile summary
- Claude debug packets

## Phase 4 — Promotion Ladder

Create pure service:

```text
evaluatePromotion(input) -> PromotionDecision
```

Promotion levels:

- raw_observation
- correlated_signal
- material_change
- situation_update
- watchlist_item
- alert
- critical_brief

This prevents alert noise.

## Phase 5 — Source Health Integration

Integrate:

- data freshness
- provider redundancy
- source reliability
- stale source penalties

Into:

- Situation Detail
- OperationalBrief
- What Changed
- Command Center

## Phase 6 — Watch Missions

Upgrade watchlists into mission-style active monitoring objects.

Each Watch Mission includes:

- scope
- entities
- key indicators
- active situations
- open questions
- forecast history
- personal relevance

## Phase 7 — Collection Requirements

Generate explicit missing-data needs for Situations.

Example:

> Confidence is limited because maritime coverage is degraded. Need AIS confirmation, port status, or satellite-derived congestion proxy.

## Phase 8 — Command Center Productization

Make Command Center consume OperationalBrief.

Command Center should stop being primarily diagnostic and become the top-level user-facing intelligence surface.

Diagnostics move into secondary surfaces.

---

# Code Review Checklist for Claude

Before opening each PR, Claude should answer:

1. What user problem does this solve?
2. Which architecture doc does this implement?
3. What contracts changed?
4. What tests prove it works?
5. What evidence/provenance is preserved?
6. What happens when data is stale?
7. What happens when sources disagree?
8. Does this create or reduce UI fragmentation?
9. Does this preserve local-first personal privacy?
10. Does this introduce any forecast claim? If yes, is it tracked?
11. Does this touch secrets, keychain, or sensitive settings? If yes, why?
12. Which commands were run?

---

# Quality Metrics to Improve Over Time

Crystal Ball should eventually track its own intelligence quality.

Metrics:

- warning lead time
- false positive rate
- forecast calibration score
- alert suppression correctness
- source freshness coverage
- contradiction resolution rate
- user action usefulness
- personal relevance accuracy
- notification fatigue score
- situation dedupe quality
- source independence score
- replay fixture pass rate

These should influence future algorithm tuning.

---

# Final Product Standard

A feature is ready when it makes Crystal Ball better at one or more of these:

- finding meaningful weak signals
- connecting events into Situations
- explaining uncertainty
- surfacing hidden dependencies
- warning earlier
- reducing noise
- improving personal relevance
- making the Command Center more useful
- improving forecast accountability
- making the system easier to debug
- preserving user trust

If a feature only adds more data without improving cognition, it should be deferred.

---

# Final Handoff Message to Claude

Claude: implement this vision incrementally.

Do not chase spectacle first.

Build the intelligence spine first:

```text
contracts -> situations -> operational brief -> promotion ladder -> source health -> situation detail -> command center
```

Once that spine is stable, the cinematic UI, planetary atmospherics, future shadows, and civilization-scale simulation will have a trustworthy foundation.

The goal is not to make Crystal Ball look magical.

The goal is to make it think clearly enough that the experience feels magical.
