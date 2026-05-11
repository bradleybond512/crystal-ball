# Crystal Ball — Elite Algorithm & Data Source Tuning Plan

## Purpose

This document defines how to tune Crystal Ball’s algorithms, data sources, scoring systems, calibration loops, and source governance so the app becomes an elite intelligence product rather than a large feed aggregator.

The existing algorithm intelligence plan already covers:

- evidence graph
- truth scoring
- negative evidence
- baseline deviation
- compound risk
- forecast calibration
- situation clustering
- watchlist relevance
- causal templates
- provider redundancy
- anomaly explanations
- confidence decomposition
- alert fatigue learning
- next-best-source recommendations

This document goes further.

It focuses on:

- making algorithms self-auditing
- making sources competitively scored
- measuring warning quality
- tuning thresholds safely
- detecting blind spots
- building replay/simulation datasets
- preventing overconfidence
- making every score operationally useful
- creating an elite feedback loop between source performance, forecast outcomes, user behavior, and intelligence quality

---

# Core Thesis

Crystal Ball becomes elite when it stops treating algorithms and data sources as static.

Instead, every source, score, threshold, forecast, and alert should participate in a learning loop:

```text
observe -> score -> explain -> warn -> outcome -> evaluate -> recalibrate
```

The app should continuously ask:

- Which sources were early?
- Which sources were stale?
- Which sources exaggerated?
- Which algorithms overreacted?
- Which weak signals mattered?
- Which alerts were ignored?
- Which predictions came true?
- Which missing signals should have reduced confidence?
- Which domains need better coverage?

This is how Crystal Ball becomes sharper over time.

---

# 1. Source Performance Ledger

## Concept

Every data source should have a performance profile.

Do not treat all sources equally.

Each source should be scored by:

- freshness
- uptime
- latency
- geographic coverage
- domain coverage
- precision
- false positive tendency
- confirmation value
- historical lead time
- contradiction rate
- uniqueness
- cost / rate-limit burden

## Source Score Contract

```ts
interface SourcePerformanceProfile {
  sourceId: string;
  domain: string;
  reliabilityScore: number;
  freshnessScore: number;
  latencyScore: number;
  coverageScore: number;
  precisionScore: number;
  uniquenessScore: number;
  contradictionRate: number;
  confirmationValue: number;
  historicalLeadTimeMinutes?: number;
  falsePositiveRate?: number;
  falseNegativeKnownRate?: number;
  rateLimitPressure?: number;
  costTier: 'free' | 'free_tier' | 'paid' | 'unknown';
  lastEvaluatedAt: string;
}
```

## Claude Tasks

1. Create a source performance ledger service.
2. Seed it with existing `dataFreshness` and provider redundancy information.
3. Add hooks for forecast resolution to adjust source scores.
4. Expose source performance in the Intelligence Workbench.

---

# 2. Source Role Classification

## Concept

Not every source serves the same purpose.

Classify each source by operational role.

## Source Roles

- primary detector
- official confirmer
- independent corroborator
- early weak-signal sensor
- geospatial validator
- contradiction detector
- recovery validator
- context provider
- personal-impact source
- fallback provider

## Why This Matters

A weak-signal source should not be penalized simply because it is noisy.
An official source should not be expected to be early.
A satellite/geospatial source may be excellent for contradiction detection but slow to update.

## Claude Tasks

Add source role metadata:

```ts
interface SourceRoleProfile {
  sourceId: string;
  roles: SourceRole[];
  bestUseCases: string[];
  weakUseCases: string[];
  expectedLatency: 'real_time' | 'near_real_time' | 'delayed' | 'official_delay';
  confidenceBehavior: 'early_noisy' | 'slow_authoritative' | 'contextual' | 'confirmatory';
}
```

Use source role when calculating confidence.

---

# 3. Domain-Specific Source Portfolios

## Concept

Each intelligence domain should have a deliberate source portfolio.

A mature domain has:

- early indicator sources
- official sources
- independent corroboration
- geospatial validation if relevant
- contradiction sources
- recovery sources

## Example: Maritime Domain

Recommended source roles:

- AIS provider: movement sensor
- port status source: official/logistics confirmer
- shipping rate source: economic impact
- chokepoint monitor: strategic relevance
- news/human reports: contextual evidence
- satellite/fire/weather overlays: external hazard context

## Example: Cyber Domain

Recommended source roles:

- CISA KEV: official confirmation
- exploit chatter: weak signal
- honeypot / GreyNoise / OTX: activity evidence
- Cloudflare / RIPE / BGP: infrastructure impact
- ransomware mention tracking: behavioral pressure
- provider outage reports: user impact

## Example: Weather + Infrastructure

Recommended source roles:

- NWS/GDACS: official hazard
- radar/satellite: real-time observation
- power outage feeds: infrastructure impact
- road/transport alerts: mobility impact
- FAA cameras / webcams: ground truth
- river gauges / soil saturation: precursor signals

## Claude Tasks

Create `docs/contracts/source-portfolios.md` or service metadata describing ideal source portfolios per domain.

Use this to identify coverage gaps.

---

# 4. Data Gap and Blind Spot Engine

## Concept

Elite intelligence systems know when they are blind.

Crystal Ball should explicitly detect blind spots.

## Blind Spot Types

- stale source
- missing provider
- single-source claim
- low geographic coverage
- source disagreement
- missing expected follow-on signal
- unsupported severity claim
- no recovery source
- no official confirmation
- no independent corroboration
- insufficient baseline history

## Blind Spot Contract

```ts
interface DataBlindSpot {
  id: string;
  domain: string;
  region?: string;
  situationId?: string;
  blindSpotType: BlindSpotType;
  severity: number;
  confidencePenalty: number;
  explanation: string;
  recommendedSourceRole: SourceRole;
  candidateSources?: string[];
}
```

## Claude Tasks

1. Add blind spot detection to Situation Detail.
2. Add blind spot summary to Command Center source health.
3. Add blind spot output to Collection Requirements.

---

# 5. Threshold Tuning Framework

## Problem

Hard-coded thresholds eventually become wrong.

## Solution

Create a threshold registry with:

- domain
- signal type
- current threshold
- rationale
- historical performance
- suggested adjustment
- safe bounds
- last updated

## Threshold Contract

```ts
interface TunableThreshold {
  id: string;
  domain: string;
  signalType: string;
  currentValue: number;
  minAllowed: number;
  maxAllowed: number;
  rationale: string;
  falsePositivePressure: number;
  falseNegativePressure: number;
  suggestedValue?: number;
  adjustmentStatus: 'stable' | 'candidate' | 'manual_review' | 'rejected' | 'applied';
}
```

## Tuning Rules

- Never auto-adjust safety-critical thresholds without review.
- Allow safe adjustment proposals.
- Track before/after performance.
- Tie threshold suggestions to replay fixtures and forecast outcomes.

## Claude Tasks

1. Create threshold registry.
2. Connect algorithm health and forecast calibration to threshold suggestions.
3. Expose suggestions in Algorithm Diagnostic Panel.

---

# 6. Algorithm Performance Ledger

## Concept

Every algorithm should have its own performance profile.

Examples:

- truth scoring
- situation clustering
- negative evidence
- compound risk
- watchlist relevance
- What Changed ranking
- notification ladder
- personal impact
- shortage forecast
- maritime chokepoint stress
- seismic impact assessor
- cyber APT tracker

## Algorithm Profile Contract

```ts
interface AlgorithmPerformanceProfile {
  algorithmId: string;
  version: string;
  domain: string;
  precision?: number;
  recall?: number;
  falsePositiveRate?: number;
  falseNegativeRate?: number;
  calibrationScore?: number;
  averageLeadTimeMinutes?: number;
  averageLatencyMs?: number;
  userDismissalRate?: number;
  userEngagementRate?: number;
  replayPassRate?: number;
  lastEvaluatedAt: string;
}
```

## Claude Tasks

1. Extend existing algorithm health to include domain performance metrics.
2. Add replay fixture performance tracking.
3. Connect forecast calibration outcomes to algorithm version.

---

# 7. Warning Lead-Time Optimization

## Concept

Crystal Ball should optimize for useful early warning.

Not maximum alerts.
Not maximum sensitivity.

Useful warning means:

- early enough to matter
- accurate enough to trust
- actionable enough to help

## Lead-Time Metrics

For every resolved situation:

- first raw signal time
- first weak signal time
- first material change time
- first user-visible warning time
- mainstream confirmation time if known
- actual impact time
- resolution time

## Output

```ts
interface WarningLeadTimeRecord {
  situationId: string;
  domain: string;
  firstSignalAt: string;
  firstMaterialChangeAt?: string;
  firstUserWarningAt?: string;
  confirmedAt?: string;
  impactAt?: string;
  leadTimeMinutes?: number;
  wasUseful: boolean;
  wasTooEarly: boolean;
  wasTooLate: boolean;
  wasFalseAlarm: boolean;
}
```

## Claude Tasks

1. Add lead-time records to Mission Ledger or ops layer.
2. Show aggregate lead-time improvement in diagnostics.
3. Use lead-time to evaluate weak-signal algorithms.

---

# 8. False Positive / False Negative Taxonomy

## Concept

Do not just log wrong forecasts.
Classify why they were wrong.

## False Positive Causes

- noisy source
- circular reporting
- seasonal normal activity
- missing negative evidence
- threshold too low
- source stale
- user relevance overestimated
- duplicate situation counted twice
- weak signal over-promoted

## False Negative Causes

- missing source coverage
- threshold too high
- weak signal ignored
- source delayed
- poor entity linking
- poor geographic matching
- situation split across clusters
- user relevance underestimated
- source health not considered

## Claude Tasks

Add error taxonomy to forecast calibration / replay harness outputs.

---

# 9. Replay Scenario Library v2

## Concept

Replay is the best way to improve without waiting for real crises.

Build a scenario library that covers:

- known missed warnings
- synthetic edge cases
- source outage cases
- contradictory evidence cases
- slow-burn pressure cases
- recovery cases
- personal relevance cases

## Scenario Types

### Fast Escalation

Example:

- tornado warning
- earthquake / tsunami
- cyber outage

### Slow Burn

Example:

- drought -> crop pressure -> food price
- port congestion -> shipping delay
- disease outbreak -> travel advisory

### Contradiction

Example:

- official calm, sensors abnormal
- social panic, official data normal

### Recovery

Example:

- power restoration
- port reopening
- flood waters receding

### Blind Spot

Example:

- AIS provider down
- cyber source stale
- weather source missing polygon

## Claude Tasks

1. Add replay scenario categories.
2. Add at least one fixture per category.
3. Require algorithms to pass relevant replay fixtures before promotion.

---

# 10. Synthetic Adversarial Fixtures

## Concept

Create fake-but-realistic data designed to fool the system.

Examples:

- duplicate reports from same source chain appearing independent
- old event reposted as new
- sensational headline with no confirming signals
- routine military exercise mistaken for escalation
- harmless cyber chatter around a severe CVE
- market move unrelated to geopolitical event

## Purpose

Prevent Crystal Ball from becoming overconfident.

## Claude Tasks

Create adversarial fixtures for:

- truth scoring
- source independence
- negative evidence
- situation clustering
- promotion ladder
- What Changed ranking

---

# 11. Source Independence Detection

## Problem

Multiple reports may come from the same underlying source.

Counting them as independent is dangerous.

## Solution

Estimate source independence.

Signals:

- same URL origin
- same quoted agency
- same timestamp window
- identical headline language
- same wire service
- same social post embedded
- same official release

## Output

```ts
interface SourceIndependenceResult {
  sourceIds: string[];
  independentGroupCount: number;
  suspectedCircularReporting: boolean;
  groups: SourceIndependenceGroup[];
  confidencePenalty: number;
}
```

## Claude Tasks

Add source independence grouping to truth scoring and evidence graph.

---

# 12. Data Freshness Decay Curves

## Concept

Freshness should decay differently by domain.

A 30-minute-old weather warning may still be useful.
A 30-minute-old ADS-B snapshot may be stale.
A 12-hour official humanitarian report may still be valuable.

## Domain Decay Profiles

Examples:

```ts
interface FreshnessDecayProfile {
  domain: string;
  halfLifeMinutes: number;
  staleAfterMinutes: number;
  criticalAfterMinutes: number;
  rationale: string;
}
```

## Claude Tasks

1. Create domain-specific freshness decay profiles.
2. Apply them to confidence scoring.
3. Show freshness penalties in score drivers.

---

# 13. Confidence Calibration by Domain

## Concept

A confidence score of 80 should mean roughly the same reliability across domains.

If cyber confidence 80 is correct 55% of the time and weather confidence 80 is correct 90% of the time, the scale is broken.

## Claude Tasks

1. Track calibration per domain.
2. Adjust displayed confidence through calibration multipliers.
3. Show overconfidence warnings in diagnostics.

---

# 14. Leading Indicator Scorecards

## Concept

Each domain should have a leading indicator scorecard.

## Example: Military Escalation

Indicators:

- tanker aircraft activity
- ISR aircraft activity
- NOTAM / TFR changes
- GPS interference
- naval concentration
- embassy warnings
- market movement
- official statements

## Example: Food System Stress

Indicators:

- crop anomaly
- drought index
- export restrictions
- shipping chokepoints
- fertilizer / energy cost
- livestock disease
- price divergence
- social unrest in vulnerable regions

## Claude Tasks

Create scorecard configs:

```ts
interface LeadingIndicatorScorecard {
  domain: string;
  scenarioType: string;
  indicators: LeadingIndicator[];
  escalationThresholds: ThresholdBand[];
  confirmingSignals: string[];
  invalidatingSignals: string[];
}
```

Use these to drive Watch Missions and Collection Requirements.

---

# 15. Cross-Domain Lag Model

## Concept

Different domains respond at different speeds.

Example:

- weather signal appears before power outage
- port disruption appears before price move
- cyber exploit chatter appears before official alert
- disease signal appears before travel advisory

## Output

For cascade edges, model expected lag.

```ts
interface CascadeLagProfile {
  fromDomain: string;
  toDomain: string;
  typicalLagMinutes: number;
  minLagMinutes: number;
  maxLagMinutes: number;
  confidence: number;
}
```

## Value

This makes watch windows much smarter.

---

# 16. Data Source Acquisition Roadmap

## Purpose

Add sources based on blind spots, not vibes.

## Rule

New sources should be justified by one of these:

- fills a blind spot
- improves source independence
- improves lead time
- improves recovery validation
- improves personal impact
- improves contradiction detection
- improves geographic coverage
- improves domain-specific confidence

## Source Evaluation Score

```ts
sourceValue =
  blindSpotReduction * 0.25 +
  independenceGain * 0.20 +
  leadTimeGain * 0.20 +
  reliability * 0.15 +
  coverageGain * 0.10 +
  costEfficiency * 0.10;
```

## Claude Tasks

Create a lightweight source candidate scoring sheet/doc.

---

# 17. Recommended High-Value Source Categories

These are not random feeds. These categories fill strategic intelligence gaps.

## Infrastructure Impact

- power outage aggregation
- grid operator alerts
- pipeline incidents
- dam safety
- rail disruption
- road closures
- port status
- airport operational status

## Ground Truth / Validation

- webcams where legal and public
- FAA weather cams
- official local alerts
- river gauges
- air quality sensors
- satellite fire / smoke / flood data

## Cyber Impact

- BGP / routing instability
- DNS outage signals
- cloud provider status pages
- exploit chatter
- CISA KEV
- EPSS
- honeypot activity
- provider outage reports

## Food / Commodity Stress

- crop conditions
- drought monitors
- export restrictions
- fertilizer prices
- shipping chokepoints
- livestock disease
- commodity spreads

## Human Behavior

- evacuation orders
- traffic anomalies
- fuel shortage reports
- emergency declarations
- school closures
- hospital strain if public
- travel advisories

## Recovery Signals

- power restoration
- road reopening
- port reopening
- aid delivered
- emergency declaration lifted
- service restoration

---

# 18. Elite Alert Routing

## Concept

Notifications should be routed by value, not severity alone.

Routing should consider:

- safety-critical nature
- confidence
- personal relevance
- novelty
- lead time
- user fatigue
- source health
- watch mission match
- required action

## Alert Rungs

- silent record
- dashboard only
- What Changed
- Command Center highlight
- standard notification
- urgent notification
- safety-critical override

## Claude Tasks

Tune notification ladder using:

- promotion ladder
- watchlist relevance
- user feedback
- forecast outcomes
- alert fatigue metrics

---

# 19. World-Class “What Changed” Ranking

## Ranking Inputs

- novelty
- magnitude
- acceleration
- user relevance
- confidence delta
- severity delta
- new contradiction
- blind spot resolved
- recovery progress
- forecast outcome change
- source degradation

## Example Output

> Risk did not rise because one feed changed. Risk rose because three independent indicators moved in the same direction and two expected invalidating signals failed to appear.

## Claude Tasks

Upgrade What Changed ranking to use deltas from:

- situations
- evidence graph
- source health
- forecast calibration
- personal relevance

---

# 20. Algorithm Governance Board

## Concept

Crystal Ball should govern algorithms like production systems.

Each algorithm should have:

- owner area
- version
- purpose
- inputs
- outputs
- assumptions
- known failure modes
- tests
- replay coverage
- tuning knobs
- safe bounds

## Claude Tasks

Add algorithm registry metadata:

```ts
interface AlgorithmRegistryEntry {
  id: string;
  version: string;
  purpose: string;
  domains: string[];
  inputs: string[];
  outputs: string[];
  assumptions: string[];
  knownFailureModes: string[];
  tuningKnobs: string[];
  requiredTests: string[];
}
```

---

# 21. Human Feedback Without Overfitting

## Concept

User feedback should tune relevance, not truth.

If user dismisses an alert, it may mean:

- irrelevant to them
- too frequent
- bad timing
- poor explanation

It does not necessarily mean the event was false.

## Rule

Separate:

- truth calibration
- relevance calibration
- notification calibration
- UX preference learning

## Claude Tasks

Ensure user feedback is routed to the correct calibration bucket.

---

# 22. Elite Quality Metrics

Track:

- time to detect
- time to warn
- time to explain
- forecast Brier score
- source lead-time rank
- source contradiction rate
- alert dismissal rate
- watch mission usefulness
- situation merge/split quality
- confidence calibration error
- stale data exposure
- blind spot count by domain
- replay pass rate
- false escalation rate
- missed escalation rate

These metrics should be visible in Algorithm Diagnostic / Intelligence Workbench.

---

# Recommended Implementation Order

## Phase 1 — Measurement Before Tuning

Build:

- source performance ledger
- algorithm performance ledger
- warning lead-time records
- false positive / false negative taxonomy

Do not tune aggressively until measurement exists.

## Phase 2 — Confidence Quality

Build:

- source independence detection
- freshness decay profiles
- blind spot engine
- domain confidence calibration

## Phase 3 — Better Early Warning

Build:

- leading indicator scorecards
- cross-domain lag model
- watch windows
- collection requirements

## Phase 4 — Better Source Strategy

Build:

- source role profiles
- domain source portfolios
- source candidate scoring
- source acquisition roadmap

## Phase 5 — Tuning & Governance

Build:

- threshold registry
- algorithm registry
- safe adjustment proposals
- replay scenario library v2
- synthetic adversarial fixtures

---

# Best First 10 PRs for Claude

## PR 1 — Source Performance Ledger

Track source freshness, reliability, latency, contradiction rate, uniqueness, and confirmation value.

## PR 2 — Domain Freshness Decay Profiles

Apply domain-specific stale-data confidence penalties.

## PR 3 — Source Independence Detection

Prevent circular reporting from inflating confidence.

## PR 4 — Blind Spot Engine

Expose what Crystal Ball cannot currently see.

## PR 5 — Warning Lead-Time Records

Track first signal, first warning, confirmation, impact, and usefulness.

## PR 6 — Algorithm Performance Ledger

Track algorithm quality by version, domain, replay pass rate, and calibration.

## PR 7 — Threshold Registry

Move thresholds into governed tunable configs with safe bounds.

## PR 8 — Leading Indicator Scorecards

Create domain-specific early-warning scorecards.

## PR 9 — Replay Scenario Library v2

Expand replay fixtures to fast escalation, slow burn, contradiction, recovery, and blind spot categories.

## PR 10 — Synthetic Adversarial Fixtures

Add fixtures designed to fool truth scoring, clustering, and promotion logic.

---

# Elite Standard

Crystal Ball is elite when it can say:

- “This source is usually early but noisy.”
- “This official source is slow but highly authoritative.”
- “Confidence is low because all reports trace back to one origin.”
- “Risk rose because expected invalidating signals failed to appear.”
- “This alert was suppressed because it matched a known false-positive pattern.”
- “This forecast was overconfident; future similar forecasts will be reduced.”
- “We are blind in this region because AIS and outage feeds are degraded.”
- “This weak signal usually precedes confirmed disruption by 4-8 hours.”
- “This situation affects your saved location because of this dependency chain.”

That is the difference between a dashboard and an intelligence system.

---

# Final Instruction to Claude

Do not start by tuning thresholds manually.

Start by building measurement and accountability.

The correct order is:

```text
measure -> calibrate -> tune -> validate -> ship
```

If Crystal Ball measures source quality, algorithm quality, warning lead time, blind spots, forecast outcomes, and replay performance, it can become sharper every week.

That is how the app becomes elite beyond normal threat maps, OSINT feeds, dashboards, and news monitors.
