# Crystal Ball Algorithm Intelligence Enhancement Plan

Use this as the implementation plan for turning Crystal Ball's large data surface into stronger intelligence. The goal is not just more feeds. The goal is better evidence, confidence, contradiction handling, prediction, user relevance, and learning.

## Primary Goal

Crystal Ball should move from showing many data feeds together to explaining what the data means.

The app should be able to answer:

- Why does Crystal Ball believe this?
- Which sources agree?
- Which sources disagree?
- What evidence is missing?
- What usually happens next?
- How confident are we?
- Why does this matter to this user?
- Did past forecasts like this come true?

## Highest-Value Enhancements

### 1. Evidence Graph Engine

Build a graph where alerts, events, sources, providers, locations, entities, forecasts, and user watchlist items are connected.

Node types:

- Event
- Source
- Location
- Country
- Entity
- Asset
- Provider
- Forecast
- User watchlist item

Edge types:

- corroborates
- contradicts
- caused_by
- same_location
- same_entity
- same_time_window
- escalates_to
- impacts
- invalidates

Use the graph to produce:

- Evidence score
- Confidence score
- Explanation path
- Weakest evidence link
- Missing confirmation source
- Source agreement and disagreement list

This should sit above the existing provider fusion, alert correlation, and situation forecasting services.

### 2. Multi-Source Truth Scoring

Current source fusion is useful but provider-focused. Add fact-level truth scoring.

For each normalized fact, track:

- Event type
- Location
- Time
- Severity
- Entity
- Claim text
- Source list
- Raw source URLs

Score each fact using:

- Source reliability
- Freshness
- Independent source count
- Source diversity
- Geographic precision
- Historical source accuracy
- Contradiction count
- Official-source boost
- Open-source corroboration boost

Suggested formula:

```ts
truthScore =
  reliability * 0.25 +
  freshness * 0.15 +
  corroboration * 0.25 +
  sourceDiversity * 0.15 +
  precision * 0.10 +
  historicalAccuracy * 0.10 -
  contradictionPenalty;
```

Suggested labels:

- confirmed
- likely
- plausible
- weak
- disputed

### 3. Negative Evidence Engine

Crystal Ball should notice when expected follow-on signals do not appear.

Examples:

- Big earthquake but no tsunami bulletin
- Cyber KEV spike but no exploitation chatter
- Cyclone warning but no power outage reports
- Military aircraft surge but no NOTAM or TFR activity
- Market fear spike but no credit spread move

Use negative evidence to reduce confidence and reduce false alarms.

Existing starting point:

- `src/services/alert-correlator.ts`

Expand that logic into a reusable service.

Output:

- Expected signal
- Time window
- Missing source
- Confidence reduction
- Watch expiration time

### 4. Baseline Deviation Scoring

Every domain needs "normal for here, now" baselines.

Examples:

- Aircraft count above local or theater baseline
- AIS gaps above normal port or route baseline
- Rainfall above local monthly percentile
- Cyber chatter above normal keyword baseline
- Protest count above country seasonal baseline
- Market volatility above instrument baseline
- Earthquake frequency above regional norm

Use rolling baselines:

- 7-day
- 30-day
- 90-day
- Seasonal/year-over-year where possible

Output:

- Z-score
- Percentile
- Abnormality label
- Current value vs expected value

This should gradually replace hard-coded thresholds.

### 5. Compound Risk Index

Create a cross-domain compound risk model.

Risk should rise when independent domains overlap in location, time, entity, or affected infrastructure.

Examples:

- Hurricane + port congestion + fuel price spike
- Heat wave + grid alerts + hospital capacity pressure
- Conflict + airspace restrictions + commodity movement
- Cyber KEV + local IDS hit + sector-specific exposure
- Wildfire + poor air quality + evacuation notices
- Earthquake + nuclear facility proximity + tsunami risk

Inputs:

- Normalized alerts
- Weather alerts
- Infrastructure signals
- Aviation data
- Maritime data
- Market data
- Local/user profile

Output:

- Compound risk score from 0 to 100
- Domains involved
- Top drivers
- Likely impacts
- Recommended next watch items

Existing starting points:

- `src/services/weather-threat-convergence.ts`
- `src/services/alert-correlator.ts`
- `src/services/signal-aggregator.ts`

### 6. Forecast Calibration Loop

Crystal Ball already tracks some forecast accuracy. Expand this into a full calibration system.

For every prediction, capture:

- Initial score
- Forecast horizon
- Expected confirming indicators
- Expected invalidating indicators
- Actual outcome
- Resolution method
- Algorithm version

Track performance by:

- Domain
- Source
- Region
- Alert type
- Algorithm version
- Forecast horizon

Use calibration to tune:

- Source trust
- Pairwise correlation rules
- Escalation forecast weights
- Situation scenario probabilities
- Alert routing thresholds

Output:

- Brier score
- Calibration curve
- Hit/miss rate
- Overconfidence warning
- Source-specific multiplier

Existing starting points:

- `src/services/forecast-accuracy.ts`
- `src/services/source-reliability.ts`
- `src/services/severity-recalibration.ts`

### 7. Event Lifecycle Model

Alerts should become living situations instead of point-in-time items.

Suggested states:

- detected
- corroborating
- confirmed
- escalating
- peaking
- stabilizing
- resolved
- contradicted
- stale

Transitions should use:

- New evidence
- Lack of expected evidence
- Source updates
- Severity changes
- Proximity to user or watchlist
- Predicted follow-on signals

This will make the UI feel more intelligent because alerts will evolve.

### 8. Situation Clustering

Cluster related alerts into situations instead of showing isolated events.

Cluster by:

- Location radius
- Time window
- Entity
- Domain
- Causal rules
- Semantic similarity
- Shared sources
- User watchlist target

Each situation should have:

- Canonical title
- Timeline
- Evidence graph
- Confidence
- Severity
- Trend
- Likely next developments
- Affected assets
- Source list
- Contradictions

This should become the main intelligence object.

### 9. Watchlist Relevance Engine

Make every score user-specific.

Score each event or situation against:

- Saved places
- Portfolio
- Travel routes
- Family, home, and work locations
- Watched countries
- Watched companies
- Watched sectors
- Personal risk preferences
- Notification fatigue history

Output:

- Personal relevance score from 0 to 100
- Why it matters to the user
- Recommended action
- Notification urgency

Existing starting point:

- `src/services/situation-personalizer.ts`

### 10. Cross-Domain Causal Templates v2

Existing `src/services/situation-forecaster.ts` has useful causal templates. Expand them into richer probabilistic chains.

Example chain:

```text
military_buildup -> airspace_restriction -> market_reaction -> supply_chain_disruption
```

Each edge should include:

- Base probability
- Expected lag
- Required confirming signals
- Invalidating signals
- Source types
- Geography constraints
- Confidence modifiers

Add templates for:

- Weather -> grid -> telecom -> transportation
- Cyber -> banking outage -> market fear
- Disease -> travel advisory -> airline disruption
- Conflict -> shipping reroute -> energy price movement
- Drought -> crop forecast -> food price pressure
- Space weather -> grid/comms/aviation risk
- Volcano -> aviation ash -> airport disruption
- Port strike -> shipping delay -> retail/economic impact

### 11. Provider Redundancy Router

Use multiple APIs for the same domain intelligently.

For each query, choose:

- Primary provider
- Fallback provider
- Cross-check provider
- Cheap provider
- Official provider

Router inputs:

- Provider health
- Rate limits
- Freshness
- Coverage
- Historical accuracy
- Cost/free tier
- Current domain importance

Output:

- Selected provider
- Fallback order
- Confidence penalty when only one source works
- Stale fallback notice

Existing starting point:

- `src/services/providers/`

### 12. Anomaly Explanation Engine

When Crystal Ball sees an anomaly, explain why it is unusual.

Examples:

- AIS gaps here are 4.2x normal for this route.
- This aircraft concentration is above the 95th percentile for this theater.
- This weather alert overlaps with 3 critical infrastructure assets.
- Cyber chatter is elevated but official confirmation is absent.
- Market movement is unusual because related commodities did not move.

This depends on baseline storage and comparison windows.

### 13. Confidence Decomposition

Every score should be explainable.

Instead of only:

```text
Risk: 82
```

Show:

```text
Risk: 82
Source reliability: 22/25
Freshness: 13/15
Corroboration: 21/25
Severity: 14/15
Personal relevance: 7/10
Contradictions: -2
```

This makes Crystal Ball more trustworthy and easier to debug.

### 14. Alert Fatigue Learning

The app should learn what the user ignores.

Signals:

- Acknowledged quickly
- Dismissed
- Ignored
- Bookmarked
- Opened details
- Clicked source
- Muted domain
- Searched related info

Use this to adjust:

- Notification threshold
- Urgency label
- Sort order
- "Only notify if compound risk" behavior

Keep it local-first.

### 15. Next Best Source Recommendation

When confidence is low, Crystal Ball should know which source would confirm or refute the situation.

Example:

```text
Confidence: medium
Missing confirmation:
- official aviation NOTAM
- local power outage feed
- second ADS-B source
- market confirmation
```

This is useful for the UI, Claude implementation work, and future automated collection.

## Implementation Priority

### PR 1: Algorithm Foundation

Create shared types and services:

- `NormalizedFact`
- `EvidenceNode`
- `EvidenceEdge`
- `TruthScore`
- `AlgorithmExplanation`
- `ConfidenceBreakdown`

Add:

- Fact-level scoring
- Confidence decomposition
- Reusable scoring helpers
- Deterministic unit tests with fixtures

Do not make broad UI changes in this PR.

Suggested files:

- `src/services/intelligence/evidence-graph.ts`
- `src/services/intelligence/truth-score.ts`
- `src/services/intelligence/confidence-explanation.ts`
- `src/services/intelligence/__tests__/truth-score.test.mts`
- `src/services/intelligence/__tests__/evidence-graph.test.mts`

### PR 2: Event/Situation Clustering

Build situation clustering from unified alerts.

Add:

- Space/time/source/type clustering
- Canonical situation title
- Timeline
- Trend
- Confidence
- Top drivers

Suggested file:

- `src/services/intelligence/situation-clustering.ts`

### PR 3: Negative Evidence and Expected Signals

Generalize negative evidence beyond alert correlation.

Add:

- Expected follow-on signals
- Waiting windows
- Missing-signal penalties
- Confidence decay
- Missing confirmation output

Suggested file:

- `src/services/intelligence/negative-evidence.ts`

### PR 4: Baseline Deviation Engine

Add rolling baselines for:

- Aircraft
- Vessels
- Alerts per region
- Cyber indicators
- Market volatility
- Weather hazards
- Power and infrastructure signals

Output z-score and percentile.

Suggested file:

- `src/services/intelligence/baseline-deviation.ts`

### PR 5: Compound Risk Index

Fuse clustered situations with cross-domain overlap.

Add:

- Compound score
- Affected domains
- Impact categories
- Likely cascade paths
- Recommended watch items

Suggested file:

- `src/services/intelligence/compound-risk.ts`

### PR 6: Forecast Calibration

Expand forecast accuracy into a calibration service.

Add:

- Prediction records
- Automatic resolution
- Brier score
- Per-domain accuracy
- Per-source multipliers
- Algorithm version tracking

Suggested file:

- `src/services/intelligence/forecast-calibration.ts`

### PR 7: Watchlist Relevance

Use user context to rank intelligence.

Add:

- Relevance score
- Personal impact label
- Local notification threshold
- User feedback loop

Suggested file:

- `src/services/intelligence/watchlist-relevance.ts`

## Guardrails

- Prefer deterministic algorithms first.
- Avoid opaque ML until the rule-based system is instrumented.
- Every score must include an explanation.
- Every forecast must be logged and later evaluated.
- Every source-derived claim needs provenance.
- No single-source critical alert unless it is explicitly labeled single-source.
- Stale data should reduce confidence, not silently disappear.
- Contradictions should be surfaced, not averaged away.
- Algorithms must be testable with static fixtures.
- Keep the first PR small enough to review.

## Best First Build

Start with:

1. `src/services/intelligence/evidence-graph.ts`
2. `src/services/intelligence/truth-score.ts`
3. `src/services/intelligence/confidence-explanation.ts`
4. Unit tests using mocked alerts from weather, cyber, aviation, maritime, and markets.

Then wire the output into one small diagnostic surface before changing the whole app.

## Next-Horizon Crystal Ball Capabilities

These are follow-on enhancements that make the app feel more anticipatory, explanatory, and personally useful after the algorithm foundation exists.

### 1. Early Signal Radar

Detect weak signals before they become full alerts.

Examples:

- Small rise in military flights near a theater
- Shipping reroutes before news reports
- Prediction market drift before headlines
- Cyber chatter before CISA confirmation
- Rainfall and soil saturation before flood warnings
- Unusual airport delays before official disruption notices

Output:

- Weak signal score
- Likely domain
- Confidence
- Watch reason

### 2. Scenario Tree Generator

For every major situation, generate branching futures.

Example:

```text
Current situation: Taiwan Strait aircraft surge
Scenario A: routine exercise, 55%
Scenario B: coercive blockade rehearsal, 30%
Scenario C: direct escalation, 15%
```

Each branch should include:

- Probability
- Confirming indicators
- Invalidating indicators
- Expected next data sources
- Time horizon

### 3. What Changed Intelligence Digest

Explain deltas, not just current state.

Examples:

- Risk rose because aircraft count doubled, NOTAM activity appeared, and prediction markets moved.
- Risk fell because no follow-on alerts arrived within the expected window.
- Confidence improved because two independent sources corroborated the same event.

This should become a compact digest for overnight changes, major risk moves, and saved watchlist items.

### 4. Prediction Memory

Crystal Ball should remember its own past calls.

Track:

- Prediction made
- Confidence at prediction time
- Evidence used
- Outcome
- What was wrong
- What was right
- Which algorithm or source overreacted

Use that memory to tune future scores.

### 5. Contrarian/Skeptic Pass

For each high-risk situation, run a deterministic skeptic check.

Ask:

- What evidence would prove this is noise?
- Are sources circularly reporting the same origin?
- Is this normal seasonal activity?
- Is one noisy source dominating?
- Are expected follow-on signals missing?

Output:

- Confidence adjustment
- Possible false-positive explanation
- Missing evidence list

### 6. Personal Impact Forecast

Move from "bad thing happened" to "how this could affect Bradley."

Examples:

- Travel route risk
- Portfolio exposure
- Local weather/grid risk
- Family or saved-place proximity
- Supply chain or fuel impact
- Cyber exposure for owned devices and services

Output:

- Personal relevance score
- Likely impact
- Recommended monitoring action

### 7. Leading Indicator Library

Create domain-specific leading indicators.

Military indicators:

- Tanker aircraft
- ISR aircraft
- NOTAM and TFR changes
- Embassy advisories
- Naval concentration
- GPS and AIS disruption

Weather indicators:

- Soil moisture
- River gauge rise
- Convective outlook upgrades
- Pressure drops
- Ensemble model agreement
- Power grid stress

Cyber indicators:

- Exploit chatter
- EPSS jumps
- Honeypot hits
- GitHub proof-of-concept releases
- Domain registrations
- CISA KEV additions

Markets indicators:

- VIX
- Credit spreads
- Oil, gold, and Treasury divergence
- Currency pressure
- Prediction markets
- ETF flows

### 8. Surprise Index

Score how unexpected an event is.

Formula inputs:

- Baseline rarity
- Speed of change
- Geographic abnormality
- Cross-domain mismatch
- Source novelty

Useful labels:

- Normal event, high severity
- Low severity, highly unusual location
- Moderate event, unusually fast escalation

### 9. Data Gap Awareness

Crystal Ball should know when it is blind.

Examples:

- No ADS-B redundancy in this region.
- Weather confidence is low outside U.S. official coverage.
- AIS source unavailable, maritime confidence degraded.
- Conflict data stale by 14 hours.

Uncertainty should be visible instead of hidden.

### 10. Watch Windows

For each situation, define a watch window.

Example:

```text
If this is real escalation, expect one of these within 6 hours:
- new NOTAM
- embassy advisory
- additional tanker aircraft
- market movement in oil
- official military statement
```

If nothing happens, confidence should decay.

### 11. Narrative Timeline Builder

Automatically convert related events into a compact timeline.

Example:

```text
08:15 - aircraft surge detected
08:42 - weather/airspace hazard overlaps route
09:10 - second source confirms aircraft cluster
10:00 - oil futures move 1.8%
10:30 - risk upgraded from plausible to likely
```

This turns dashboards into intelligence briefings.

### 12. Ask The Data Mode

Let the user ask natural questions over local normalized data.

Examples:

- Why is Iran risk rising?
- What changed overnight?
- What sources disagree?
- What should I watch next?
- Which alerts actually matter to me?

This should use structured local summaries first, then LLM assistance where useful.

### 13. Confidence Weather Map

Show confidence as a first-class map layer, not only risk.

Map layers:

- High risk, high confidence
- High risk, low confidence
- Low risk, low confidence
- Blind spots
- Stale data regions
- Source disagreement zones

### 14. Cascade Simulator

Let situations project second-order impacts.

Examples:

- Hurricane -> port closure -> shipping delays -> fuel price pressure
- Cyberattack -> bank outage -> market fear -> liquidity stress
- Conflict -> airspace closure -> airline reroutes -> oil spike
- Drought -> crop stress -> food prices -> unrest risk

Each cascade should include:

- Probability
- Time horizon
- Required confirming signals
- Likely affected sectors and regions

### 15. Intelligence Quality Score

Every panel, source, and situation should get a quality score.

Factors:

- Freshness
- Redundancy
- Accuracy history
- Contradiction count
- Source diversity
- Precision
- Coverage completeness

Use this to decide what to trust and what to ignore.

### Recommended Next Additions

After PR 1, prioritize:

1. Watch Windows
2. Scenario Trees
3. What Changed Digest
4. Prediction Memory
5. Data Gap Awareness

Together, these make Crystal Ball feel like it is watching the future form instead of only reporting the present.

## Claude Instruction

Claude should read this plan first, then implement PR 1 only unless Bradley explicitly asks for a larger batch.

The recommended first prompt is:

```text
Read docs/ALGORITHM_INTELLIGENCE_ENHANCEMENT_PLAN.md. Implement PR 1 only: the algorithm foundation for evidence graph, truth scoring, and confidence explanations. Keep the first PR deterministic, testable, and lightly wired. Do not do broad UI changes yet.
```
