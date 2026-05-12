# Claude High Impact Event Intelligence Vision - 2026-04-29

Use this as a grand vision roadmap for Crystal Ball's next major enhancement wave.
Focus on military, cyber, and weather: the domains where high-impact events can
matter most to the user.

## North Star

Crystal Ball should become a high-impact event intelligence system, not a collection
of panels.

For every serious military, cyber, weather, or compound event, the app should answer:

1. What is happening?
2. Why does it matter?
3. Does it affect the user, saved places, devices, systems, plans, or watched assets?
4. What should the user do now?
5. What should the system watch next?
6. Was the prediction or alert correct after the event resolved?

The product center is:

```text
Crystal Ball does not tell the user everything.
It tells the user the few things that could matter, why they matter personally,
what is likely next, and what to do.
```

## Existing Foundation To Reuse

Do not rebuild from scratch. Reuse and connect the existing systems:

- `src/services/situation-forecaster.ts`
- `src/services/escalation-forecast.ts`
- `src/services/escalation-predictor.ts`
- `src/services/threat-convergence.ts`
- `src/services/compound-threat-detector.ts`
- `src/services/forecast-fusion.ts`
- `src/services/forecast-accuracy.ts`
- `src/services/evidence-pack.ts`
- `src/services/unified-alerts.ts`
- `src/services/alert-routing.ts`
- `src/services/alert-lifecycle.ts`
- `src/services/alert-debug.ts`
- `src/components/ThreatSynthesisPanel.ts`
- `src/components/AlertCenterPanel.ts`
- `src/components/UnifiedAlertInboxPanel.ts`
- `src/components/PersonalStormMode.ts`
- `docs/INSIGHTS_NOTIFICATIONS_PRESENTATION_PLAN.md`
- `docs/WEATHER_WARNING_REMEDIATION_PLAN.md`
- `docs/superpowers/specs/2026-04-06-cyber-threat-reactor-design.md`
- `docs/superpowers/specs/2026-04-14-military-intel-enhancement-design.md`

The missing piece is a shared high-impact situation layer that ties these together.

## Core Architecture

Create a shared `Situation` model across military, cyber, weather, and compound events.

Each situation should include:

- `id`
- `domain`: `military`, `cyber`, `weather`, `compound`
- `title`
- `summary`
- `severity`: `fyi`, `watch`, `elevated`, `critical`, `emergency`
- `confidence`: 0-1
- `urgency`: 0-1
- `userExposure`: 0-1
- `personalImpact`
- `evidencePack`
- `sourceAgreement`
- `sourceDisagreement`
- `whatChanged`
- `expectedNextSignals`
- `invalidationSignals`
- `recommendedActions`
- `timeline`
- `diagnosticsTrace`
- `predictionOutcome`

The app should render situations in a command-center style view, but the model must
be service-first so notifications, diagnostics, panels, and after-action review all
use the same object.

## High Impact Command Center

Build or evolve a top-level view that shows only the most important active situations.

Default behavior:

- Show top 3 active high-impact situations.
- Prioritize user-exposed events over distant global noise.
- Merge related alerts into one situation.
- Show what changed since last look.
- Show next expected signals.
- Show calm, practical actions.
- Show confidence and source agreement without overwhelming the user.

Example:

```text
Critical Situation: Gulf Coast Storm Impact

Why it matters:
A strengthening storm track now overlaps Gulf energy infrastructure and two major ports.

Personal impact:
Medium. Fuel prices and flight delays are the most likely user-facing effects.

What changed:
- Track shifted 70 miles west
- Port disruption risk rose from Watch to Elevated
- Power outage probability increased near saved place

Watch next:
- NHC advisory at 4 PM
- Port closure notices
- Refinery outage reports

Action:
Avoid booking tight flight connections through Houston tomorrow.
```

## Military Intelligence Vision

Military intelligence should focus on escalation, disruption, and user impact.

### 1. Theater Escalation Watch

Track major theaters as first-class situation sources:

- Iran / Persian Gulf
- Taiwan Strait
- Black Sea
- Baltic
- Korean Peninsula
- Red Sea / Yemen
- East Mediterranean
- South China Sea
- Arctic

For each theater, show:

- current posture
- score delta
- confidence
- likely next move
- user-facing consequences
- source agreement/disagreement

### 2. Multi-Theater Coordination Detector

Detect when military activity rises across multiple theaters in the same time window.

Signals:

- simultaneous aircraft surges
- naval concentration
- airspace closures
- unusual tanker/AWACS activity
- embassy/travel advisory changes
- military news corroboration

Output:

- one compound military situation
- severity based on coordination score and theater importance
- watch window for expected follow-on signals

### 3. Strike Readiness Engine

Fuse:

- military flights
- tankers
- AWACS
- naval vessels
- NOTAMs
- airspace closures
- OSINT/news
- theater baselines

Classify posture:

- normal
- elevated
- deployment
- strike-ready
- active escalation

The user should see the difference between posturing and operational readiness.

### 4. Historical Pattern Matching

Compare current movement signatures against known patterns:

- air campaign buildup
- naval strike posture
- rapid deployment
- blockade setup
- evacuation precursor
- recon surge
- multi-front posturing

Each match should produce:

- pattern name
- match percentage
- evidence
- confidence
- what would confirm or invalidate the pattern

### 5. Civilian Impact Layer

Translate military risk into consequences:

- flight route disruption
- oil and fuel price exposure
- shipping disruption
- embassy alerts
- travel risk
- cyber retaliation risk
- commodity shock risk

This layer is critical. Users do not only need "military event happened"; they need
"here is how this may affect you."

## Cyber Intelligence Vision

Cyber intelligence should become personal and actionable.

### 1. Personal Cyber Exposure Score

Score threats against:

- user's OS
- ASN/country where privacy-safe
- watched companies
- banks and financial providers if configured
- cloud providers
- common consumer services
- critical infrastructure sectors
- user-enabled integrations

Avoid raw threat-feed noise. Most cyber data should stay in the background unless
personal exposure or impact is meaningful.

### 2. Critical Infrastructure Cyber Watch

Create special handling for threats against:

- power grid
- water systems
- finance
- telecom
- hospitals
- airports
- GPS/satellite systems
- government services
- major cloud providers

These should become high-impact situations when corroborated by trusted sources,
outage data, CISA alerts, or user exposure.

### 3. Exploit-To-Impact Pipeline

Track the lifecycle of a cyber risk:

```text
CVE published
-> exploit observed
-> CISA KEV added
-> ransomware usage seen
-> sector targeted
-> user exposure detected
-> action recommended
```

This should produce calm, concrete guidance:

```text
Critical Apple vulnerability is actively exploited.
Patch macOS today. No local compromise evidence detected.
```

### 4. Cyber Storm Mode

Create a focused mode for active cyber risk, similar to Personal Storm Mode.

Show:

- threat title
- affected systems
- user exposure reason
- action deadline
- patch status if available
- phishing/scam risk
- what to watch next
- source confirmation

### 5. Disaster-Linked Phishing Predictor

When major weather, war, or infrastructure events occur, phishing and scams often rise.

Detect:

- disaster donation scams
- fake government relief messages
- fake airline/hotel rebooking messages
- conflict-linked propaganda/phishing
- outage-themed credential theft

Surface as watch-level guidance unless user exposure is high.

## Weather Intelligence Vision

Weather should become personal threat management, not weather display.

### 1. Personal Storm Mode 2.0

Build on `docs/WEATHER_WARNING_REMEDIATION_PLAN.md`.

For a saved place or current location, show:

- main threat
- arrival window
- confidence
- distance to polygon or storm track
- strongest expected hazard
- practical action
- next update time
- why the alert fired
- why it did not fire if suppressed

Storm Mode should override dashboard noise for critical threats.

### 2. Impact-Based Weather Intelligence

Translate weather terms into user consequences.

Examples:

```text
Damaging wind likely near Home in 35-50 minutes.
Power outage risk elevated.
```

```text
Flash flood risk overlaps your route.
Avoid low-water crossings for the next 2 hours.
```

### 3. Nowcast Confirmation Loop

Track expected next signals:

- warning polygon expansion
- radar core strengthening
- lightning density increase
- power outage reports
- airport ground stops
- stream gauge rise
- storm reports

Escalate if confirming signals appear. Decay confidence if expected signals fail to
appear within the watch window.

### 4. Route And Schedule Awareness

Later-stage enhancement:

- detect weather along likely commute corridors
- detect airport disruption near saved/tracked airports
- warn about storm timing around user routines if configured
- connect weather to travel, fuel, logistics, and power impacts

### 5. After-Action Weather Review

For every critical weather situation, produce:

```text
We warned 42 minutes before arrival.
NWS polygon matched Home.
Wind reports confirmed 58 mph nearby.
Missed signal: outage feed lagged by 17 minutes.
Recommendation: increase radar nowcast weight for this region.
```

This ties directly into self-learning and diagnostics.

## Compound Threat Detection

This is the largest product leap.

Crystal Ball should detect when multiple domains combine into a bigger event:

- hurricane + port closure + fuel price spike
- military escalation + cyber attacks on infrastructure
- geomagnetic storm + grid stress + aviation disruption
- heat wave + wildfire smoke + hospital strain
- conflict + shipping chokepoint + commodity shock
- severe weather + airport disruption + user travel exposure

Compound situations should merge related alerts into one clear story. Avoid creating
ten separate high-noise notifications.

Each compound situation should include:

- primary driver
- secondary drivers
- affected places/sectors
- user exposure
- confidence
- timeline
- likely cascade path
- actions
- confirming/invalidation signals

## Situation Memory And Self-Correction

Every high-impact situation should be remembered.

Track:

- when it was first detected
- when it alerted
- what it predicted
- what actually happened
- whether it was late, early, accurate, noisy, or missed
- which sources were useful
- which signals were false positives
- what thresholds should change

Do not auto-apply high-risk tuning without policy-gate approval. Unknown algorithm
metadata must fail closed and require user approval.

## Notification Ladder

Map severity, confidence, urgency, and user exposure to notification behavior:

- FYI: background/inbox only
- Watch: digest or low-pressure banner
- Elevated: banner and command center prominence
- Critical: native notification, persistent in-app status, action brief
- Emergency: persistent critical alert, optional quiet-hours bypass if user enabled

Rules:

- Critical weather should be able to bypass quiet hours only through explicit setting.
- Cyber should avoid panic wording unless user exposure is high.
- Military alerts should focus on consequences and watch windows, not sensationalism.
- Compound threats should prefer one synthesized notification.

## Phased Roadmap

### Phase 1 - Situation Core

Implement the shared `Situation` model and adapters.

Deliverables:

- `src/services/situations/situation-types.ts`
- `src/services/situations/situation-store.ts`
- adapters from military, cyber, weather, and alert systems
- deterministic unit tests
- initial command-center data feed

Success criteria:

- Military, cyber, and weather can all produce normalized situations.
- Existing panels keep working.
- The command center can rank situations by impact.

### Phase 2 - Personal Exposure Graph

Connect events to the user's world.

Inputs:

- saved places
- current location if available
- watched countries
- watched companies
- watched sectors
- device/OS exposure for cyber
- travel/airport/route preferences later

Success criteria:

- Every situation has a user exposure score.
- User-exposed events rank above distant global noise.
- Alerts explain the exposure reason.

### Phase 3 - Watch Windows

Add expected next signals and decay logic.

Deliverables:

- confirmation signal tracking
- invalidation signal tracking
- confidence decay
- watch-window UI
- diagnostics trace

Success criteria:

- Situations can say "what should happen next if this is real."
- Confidence changes are explainable.
- Missed expected signals reduce urgency.

### Phase 4 - Domain Superpowers

Implement domain-specific intelligence:

- military strike readiness and historical pattern matching
- cyber exploit-to-impact lifecycle and Cyber Storm Mode
- weather nowcast confirmation loop and Personal Storm Mode 2.0

Success criteria:

- Each domain can produce high-quality situations independently.
- Each domain includes action guidance and after-action review hooks.

### Phase 5 - Compound Threat Engine

Correlate military, cyber, weather, infrastructure, market, and logistics signals.

Success criteria:

- Related cross-domain alerts merge into one situation.
- The system can explain cascade paths.
- Notification noise drops while high-impact detection improves.

### Phase 6 - After-Action And Self-Learning

Close the loop.

Deliverables:

- prediction outcome tracking
- false positive/false negative classification
- late alert detection
- threshold recommendations
- policy-gated tuning workflow
- after-action briefs

Success criteria:

- Every critical situation can be audited after resolution.
- The system recommends improvements.
- Unsafe auto-tuning is blocked by governance.

## Testing And Diagnostics Requirements

Every phase must include tests and diagnostics.

Required test categories:

- situation ranking tests
- exposure scoring tests
- military pattern tests
- cyber relevance tests
- weather polygon/nowcast tests
- compound merge tests
- notification routing tests
- diagnostics redaction tests
- after-action outcome tests

Required diagnostics:

- why situation was created
- why severity was assigned
- why user exposure was high/low
- why notification was sent/suppressed
- which sources agreed/disagreed
- which expected signals appeared/missed
- which thresholds contributed

## Implementation Principles

- Build service-first, UI second.
- Prefer deterministic scoring before LLM interpretation.
- Use LLMs for summaries and briefs only after evidence is structured.
- Merge related alerts instead of adding more noisy panels.
- Fail closed for safety, governance, diagnostics export, and tuning.
- Keep user-facing copy calm and proportionate.
- Never hide degraded data behind successful-looking UI.
- Every high-impact event must be explainable and diagnosable.

## Claude Prompt

```text
You are working in /Users/bradleybond/Developer/crystalball. Read AGENTS.md first and follow the branch/PR-to-main rules. Then read docs/CLAUDE_HIGH_IMPACT_EVENT_INTELLIGENCE_VISION_2026-04-29.md, docs/INSIGHTS_NOTIFICATIONS_PRESENTATION_PLAN.md, docs/WEATHER_WARNING_REMEDIATION_PLAN.md, docs/superpowers/specs/2026-04-06-cyber-threat-reactor-design.md, and docs/superpowers/specs/2026-04-14-military-intel-enhancement-design.md. Design and implement Phase 1 only: a shared high-impact Situation model/store plus adapters for existing military, cyber, and weather signals, with ranking by severity/confidence/urgency/user exposure and diagnostics explaining why each situation was created. Keep existing panels working, add deterministic tests, run typecheck and relevant test suites, then open a PR targeting main.
```
