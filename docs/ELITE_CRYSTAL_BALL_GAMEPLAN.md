# Elite Crystal Ball Gameplan

Use this as the strategic implementation north star for Crystal Ball.

Crystal Ball should not be a dashboard. It should become a personal intelligence operating system: a single-person AI-powered intelligence desk that senses the world, understands what matters, forecasts what may happen, warns the user, explains why, recommends action, learns from outcomes, and improves.

## North Star

Crystal Ball should give one person the situational awareness of an analyst team.

It should answer:

```text
Here is what is changing.
Here is why it matters to you.
Here is what may happen next.
Here is what you should watch.
Here is what you should do.
Here is how confident I am.
Here is what I got wrong last time.
```

The core loop:

```text
sense -> understand -> forecast -> personalize -> warn -> explain -> act -> observe outcome -> learn
```

The moat:

```text
data -> evidence -> forecast -> personal impact -> action -> outcome -> learning
```

Most competitors stop at:

```text
data -> dashboard
```

## Big Bets

### 1. Personal Intelligence OS

Crystal Ball should understand the user's world:

- home
- family locations
- travel routes
- portfolio
- watched countries
- watched companies
- devices/services
- local utilities
- risk tolerance
- alert preferences

Every event should translate into:

```text
Does this matter to Bradley?
How?
How soon?
What should he do?
```

### 2. World Model and Evidence Graph

Every alert, source, place, entity, forecast, and outcome should become part of a graph.

The graph should know:

- this event corroborates that event
- this source contradicts that source
- this storm threatens this saved place
- this port disruption affects this commodity
- this commodity affects this sector
- this sector affects this portfolio
- this warning was late last time

This becomes the app's brain.

### 3. Time-To-Warn Engine

Crystal Ball should optimize for lead time.

Examples:

- severe wind: 45 minutes before arrival
- fuel stress: 5 days before price spike
- food shortage: 30 days before humanitarian downgrade
- cyber campaign: 8 hours before mainstream reporting
- conflict escalation: 48 hours before airspace closure

Most apps report the present. Crystal Ball should compete on how early it sees what matters.

### 4. Closed-Loop Learning

Every prediction should be graded.

Every warning should be audited.

Every miss should become a fixture.

Every noisy alert should teach the system.

```text
prediction -> outcome -> calibration -> adjustment -> regression test
```

### 5. Mission Control UI

The default experience should be a Command Center, not a panel grid.

Example:

```text
Current Risk: Elevated

Top 3 Things That Matter:
1. Severe storms near Home
2. Diesel stress rising
3. Taiwan Strait activity normalizing

Since Last Look:
- storm risk rose to Critical
- diesel confidence improved
- one conflict signal decayed

Watch Next:
- NWS update in 6 min
- EIA inventory release tomorrow
- new NOTAM activity near Taiwan
```

This should be the "single employee using AI built something impossible" surface.

### 6. The Why Layer

Every score needs explanation.

Example:

```text
Risk: 82

Why:
- 3 independent sources agree
- warning polygon overlaps Home
- wind tag increased to 70 mph
- outages detected upstream
- radar core moving toward saved place

Uncertainty:
- no lightning feed
- radar source 8 min stale
```

Trust comes from explainability.

### 7. Watch Windows

For every situation:

```text
If this is real, expect these next:
- source confirmation
- official alert
- price move
- outage reports
- airspace restriction
- satellite fire expansion
```

If expected signals appear, escalate.

If expected signals do not appear, decay.

This makes the app feel like it is watching the future form.

### 8. Simulation and Replay

Build a replay engine.

Ask:

```text
Would Crystal Ball have warned me?
How early?
Would it have explained correctly?
Would the notification have fired?
```

Replay cases:

- severe storm miss
- market shock
- cyber exploit
- hurricane landfall
- oil disruption
- food shortage

### 9. Native macOS Intelligence Desk

The UI must feel premium and native:

- black graphite
- translucent sidebar
- command center
- inspector drawer
- native toolbar
- critical alert strip
- menu bar status
- Quick Look-style event preview
- keyboard-first navigation
- fast motion under 200ms

It should feel like a Mac app, not a web dashboard.

### 10. Autonomous Analyst Agents

Eventually Crystal Ball should run internal analyst agents:

- Weather analyst
- Conflict analyst
- Cyber analyst
- Markets analyst
- Supply chain analyst
- Skeptic analyst
- Personal impact analyst

Each analyst produces:

- finding
- confidence
- evidence
- what changed
- what to watch
- recommended action

These can start as deterministic pipelines with optional LLM summaries later.

## Elite Roadmap

### Phase 1: Trust and Warning Reliability

Goal: never miss what matters.

Build:

- Weather warning end-to-end diagnostics
- Personal Storm Mode UI
- Notification ladder
- Feature readiness
- System health aggregator
- Self-test runner

Success metric:

```text
User can ask: "Why didn't I get warned?" and Crystal Ball answers precisely.
```

Related docs:

- `docs/WEATHER_WARNING_REMEDIATION_PLAN.md`
- `docs/DIAGNOSTICS_OBSERVABILITY_ENHANCEMENT_PLAN.md`
- `docs/MISSED_FEATURES_FOR_CLAUDE.md`

### Phase 2: Intelligence Core

Goal: turn feeds into understanding.

Build:

- Evidence graph
- Situation clustering
- Truth scoring
- Confidence decomposition
- Negative evidence
- Watch windows
- Compound risk

Success metric:

```text
Every major event has why, confidence, uncertainty, and next indicators.
```

Related docs:

- `docs/ALGORITHM_INTELLIGENCE_ENHANCEMENT_PLAN.md`
- `docs/ALGORITHM_DIAGNOSTICS_SELF_IMPROVEMENT_PLAN.md`

### Phase 3: Prediction Layer

Goal: forecast consequential events.

Build:

- Time-to-warn metrics
- Shortage forecasting
- Energy stress forecasting
- Conflict escalation forecasting
- Cyber campaign forecasting
- Weather nowcasting
- Forecast calibration

Success metric:

```text
Crystal Ball tracks how early it saw each event.
```

Related docs:

- `docs/SHORTAGE_AND_COMMODITY_FORECAST_PLAN.md`
- `docs/CLOSED_LOOP_INTELLIGENCE_OPERATIONS_PLAN.md`

### Phase 4: Personal Impact Layer

Goal: make the world relevant to Bradley.

Build:

- Personal exposure graph
- Should-I-Care filter
- Action briefs
- Watchlist relevance
- Saved-place intelligence
- Portfolio/commodity exposure

Success metric:

```text
Crystal Ball ranks events by consequence to the user, not global noise.
```

Related docs:

- `docs/INSIGHTS_NOTIFICATIONS_PRESENTATION_PLAN.md`
- `docs/CLOSED_LOOP_INTELLIGENCE_OPERATIONS_PLAN.md`

### Phase 5: Closed-Loop Self-Improvement

Goal: compound quality over time.

Build:

- Mission ledger
- Near-miss detector
- User trust ledger
- Replay fixtures
- Algorithm health
- Safe adjustment engine
- A/B algorithm ledger

Success metric:

```text
Every miss becomes a regression test. Every noisy alert becomes a tuning signal.
```

Related docs:

- `docs/ALGORITHM_DIAGNOSTICS_SELF_IMPROVEMENT_PLAN.md`
- `docs/CLOSED_LOOP_INTELLIGENCE_OPERATIONS_PLAN.md`

### Phase 6: Showcase Experience

Goal: make it feel impossible for one person to have built.

Build:

- Command Center
- macOS-native design refresh
- Event story cards
- Inspector drawer
- Timeline replay
- Shareable intelligence brief
- Menu bar status
- Ask-the-Data mode

Success metric:

```text
A user opens the app and immediately understands the world, their exposure, and what to do.
```

Related docs:

- `docs/MACOS_NATIVE_DESIGN_REFRESH_PLAN.md`
- `docs/INSIGHTS_NOTIFICATIONS_PRESENTATION_PLAN.md`

## Implementation Priority For Claude

Build in this order unless Bradley gives a more urgent operational fix:

1. Finish diagnostics and feature readiness.
2. Wire weather warning end-to-end into Storm Mode UI.
3. Build Command Center.
4. Build Evidence Graph / Situation Inspector.
5. Add Time-To-Warn and Mission Ledger.
6. Add Watch Windows everywhere.
7. Add Replay Fixtures from misses.
8. Add Algorithm Health and safe self-adjustment.
9. Polish macOS-native design.
10. Add Ask-the-Data mode.

## Immediate Next Milestone

The single most important next milestone:

```text
Crystal Ball opens to a Command Center that knows what matters, why it matters, what changed, what to watch, and what Bradley should do.
```

This is the moment it stops feeling like an app and starts feeling like a personal intelligence system.

## Recommended Next Claude Prompt

```text
Read docs/ELITE_CRYSTAL_BALL_GAMEPLAN.md first, then read docs/DIAGNOSTICS_OBSERVABILITY_ENHANCEMENT_PLAN.md#current-follow-up-prompt and docs/MISSED_FEATURES_FOR_CLAUDE.md.

Goal: advance Crystal Ball toward the elite personal intelligence operating system described in the gameplan.

Implement the next smallest high-leverage batch:
1. Panel Health Registry
2. Feature Health Registry
3. System Health Aggregator skeleton

Why: before building more UI or prediction features, Crystal Ball needs one internal truth source for whether panels, services, providers, notifications, and key features are actually working.

Keep the implementation deterministic and unit-tested. Do not build broad UI yet. Every degraded feature must include user impact and recommended next action. Run typecheck and the relevant tests before marking ready.
```
