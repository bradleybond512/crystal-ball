# Weather Warning Remediation Plan

Use this plan to fix Crystal Ball's poor severe weather warning and preparation behavior.

Problem statement: during severe winds and storms, Crystal Ball did not warn or prepare the user well enough. The weather system needs to shift from "show weather alerts" to personal weather threat management.

## Primary Goal

When severe weather threatens a saved place or the user's current location, Crystal Ball should:

- Detect the threat early
- Explain the primary hazard
- Estimate timing and distance
- Escalate notifications appropriately
- Give practical preparation actions
- Persist critical warnings until acknowledged
- Explain why a warning was or was not sent

## 1. Personal Storm Mode

When severe weather is near a saved place, Crystal Ball should enter a focused storm mode.

Example:

```text
Severe Weather Near Home

Main threat: damaging wind
Arrival window: 35-55 minutes
Confidence: high
Action: move loose outdoor items, charge phone, avoid driving
Next update: radar scan in 5 min
```

Storm Mode should override normal dashboard noise.

Required behavior:

- Activate for tornado warnings, severe thunderstorm warnings, flash flood warnings, destructive severe thunderstorm warnings, and nearby high-confidence storm tracks.
- Show primary hazard first.
- Show arrival window if movement data is available.
- Show closest saved place/current location.
- Keep a persistent in-app status until the threat expires or is acknowledged.

## 2. NWS Polygon and Distance Engine

Do not rely only on county-level alert display. Use actual NWS warning polygons.

For each saved place and current location, compute:

- Whether the point is inside the warning polygon
- Distance to polygon edge if outside
- Alert severity
- Hazard type
- Time remaining until expiration
- Whether the alert is expanding or newly issued

Example:

```text
Bradley's home is 7 miles outside Severe Thunderstorm Warning polygon.
Storm moving east at 42 mph. Watch closely for expansion.
```

Implementation notes:

- Prefer polygon geometry from NWS alerts when available.
- Fall back to county/zone matching only when polygon geometry is unavailable.
- Store the matched place and match reason for notification/debug output.
- Treat Tornado Warning, Flash Flood Warning, and Severe Thunderstorm Warning as high-urgency if inside polygon.

## 3. Radar-Based Nowcasting

Crystal Ball should detect dangerous cells before or alongside official alerts.

Useful inputs:

- Radar intensity
- Storm cell movement
- Hail/wind signatures where available
- Lightning density
- Rotation proxy where available
- Rainfall rate
- Storm track toward saved places

Feature output:

```text
Cell track intersects home area in 42 minutes.
Primary risk: wind + lightning.
```

Start simple:

- Use existing radar/weather layers if already available.
- Detect heavy precipitation/lightning clusters near saved places.
- Estimate movement from recent observations if possible.
- Escalate only when a cell is approaching a saved place or overlaps a warning/watch.

## 4. SPC Outlook Escalation

Crystal Ball should warn earlier from SPC outlooks and watches.

Inputs:

- Day 1 convective outlook
- Mesoscale discussions
- Severe thunderstorm watches
- Tornado watches
- Categorical risk changes
- Probability contours for wind, hail, and tornado

Example:

```text
SPC upgraded your area from Marginal to Enhanced.
Damaging wind probability increased.
Prepare before storms arrive.
```

Notification behavior:

- Outlook upgrades should usually be digest/watch-level.
- Watches near saved places should become elevated alerts.
- Warnings inside polygons should become critical/emergency alerts.

## 5. Weather Watch Windows

For active severe weather, define expected next signals.

Example:

```text
If this storm is worsening, expect within 30 minutes:
- NWS warning expansion
- higher lightning density
- stronger radar core
- power outage reports
- airport ground stops
```

Behavior:

- Escalate if confirming signals appear.
- Decay confidence if expected signals do not appear.
- Show the watch window in Storm Mode.

## 6. Preparedness Action Cards

Alerts should include actions, not just information.

Wind actions:

- Secure outdoor items
- Avoid trees and windows
- Charge devices
- Check flashlight
- Park away from trees

Tornado actions:

- Move to lowest interior room
- Put shoes on
- Use a helmet if available
- Bring phone and charger
- Avoid windows

Flash flood actions:

- Avoid low-water crossings
- Move vehicle uphill
- Monitor creek and river gauges

Power outage actions:

- Charge devices
- Check backup battery
- Avoid opening fridge
- Report outage through utility link if available

Action cards should be selected by hazard type and urgency.

## 7. Persistent Critical Weather Alerts

A single macOS banner is too weak for immediate threats.

Add:

- macOS banner + sound
- In-app persistent critical strip
- Menu bar status
- Repeat only on meaningful changes
- Snooze 15 min
- "I'm safe" or acknowledge action
- Escalation if the user does not acknowledge tornado or flash flood warnings

Guardrails:

- Do not repeat unchanged warnings constantly.
- Repeat only if severity increases, polygon expands, a saved place enters polygon, or expiration/arrival time changes meaningfully.
- Respect quiet hours for lower tiers, but critical weather should have an explicit bypass setting.

## 8. What Changed Weather Brief

During storms, Crystal Ball should explain changes.

Risk increase example:

```text
Weather risk increased:
- warning polygon expanded east
- wind threat raised to 70 mph
- lightning density doubled
- power outages reported 12 miles west
```

Risk decrease example:

```text
Risk decreased:
- storm core passed north
- warning expired
- no new cells upstream
```

This should feed the general What Changed Digest from `docs/INSIGHTS_NOTIFICATIONS_PRESENTATION_PLAN.md`.

## 9. Power Outage Risk

Severe wind warnings become more useful when tied to outage likelihood.

Inputs:

- Wind gust forecast
- Tree/vegetation season
- Soil saturation
- Lightning density
- Local outage feeds where available
- Storm history
- Grid alerts

Output:

```text
Outage risk: Elevated
Reason: saturated soil + 55 mph gusts + outages upstream
```

Start simple:

- Compute a deterministic outage risk score using wind gust, rain/soil saturation proxy, lightning, and known upstream outage/power-grid signals.
- Include explanation drivers.

## 10. Route and Travel Weather

If the user might drive, Crystal Ball should warn about route-level weather.

Inputs:

- Roads under warnings
- Airport delays/ground stops
- Hail/wind along route
- Flash flood crossings
- Safer departure windows

Example:

```text
Avoid driving west for the next 75 minutes.
Storm line crossing route with 60 mph wind threat.
```

This can be a later PR after saved-place weather works.

## 11. Household Readiness Checklist

During severe weather season or active watches, show a lightweight readiness checklist.

Example:

```text
Storm readiness: 62%
Missing:
- battery pack not checked
- no saved shelter location
- no power outage contact
```

Keep it local and user-controlled.

## 12. Weather Miss Postmortem

This is important because the app failed the user.

Every missed or late weather alert should be diagnosable.

Questions to answer:

- Did NWS alert arrive?
- Did the sidecar fetch it?
- Did the alert normalize?
- Did saved-place matching work?
- Did notification routing suppress it?
- Did quiet hours block it?
- Was location missing?
- Was polygon matching too broad or too narrow?
- Was the alert treated as low relevance?

Add a "Why didn't I get warned?" debug packet.

Suggested debug output:

```text
Weather warning diagnostic:
- NWS alert: received
- polygon match: inside Home polygon
- normalized severity: critical
- notification route: suppressed
- reason: quiet hours active and weather bypass disabled
```

## First Implementation Batch

Prioritize direct remediation over broad weather expansion.

Status (2026-07-06): PRs 1-5 shipped.

- PR 1 — shipped: `src/services/weather/nws-polygon-match.ts` + `weather-threat-types.ts` + tests
- PR 2 — shipped: `src/services/weather/weather-urgency.ts` + tests
- PR 3 — shipped: `src/services/weather/personal-storm-mode.ts` + `preparedness-actions.ts` + tests
- PR 4 — shipped: `src/services/weather/weather-warning-diagnostics.ts` + tests
- PR 5 — shipped: `src/components/PersonalStormMode.ts` (persistent strip + card) with pure
  show/hide + display helpers in `src/components/personal-storm-mode-view.ts`
  (tested under `src/components/__tests__/`, registered in `npm run test:weather`).
  Fed live from `data-loader.loadNWSAlerts()` → `routeWeatherAlert()` per saved place →
  highest-priority payload-bearing decision dispatched as the `cb:storm-decision` event →
  component mounted at boot in `panel-layout.createPanels()`. Acknowledge/snooze persist to
  localStorage (`crystalball-storm-mode-ui-v1`); an acked threat stays dismissed until it
  materially changes (escalation, outside → inside polygon, or edge ≥ 5 km closer — the
  same meaningful-change rules as `weather-urgency.ts`), and the strip self-clears at alert
  expiry. Styling: base in `src/styles/alerts.css`, desktop-native retreat in
  `src/styles/macos-native.css` under `body.is-desktop-macos`.

### PR 1: Saved-Place NWS Polygon Matching

Add deterministic polygon/location matching for NWS alerts.

Suggested files:

- `src/services/weather/nws-polygon-match.ts`
- `src/services/weather/weather-threat-types.ts`
- `src/services/weather/__tests__/nws-polygon-match.test.mts`

### PR 2: Weather Urgency Notification Ladder

Map weather threats to notification behavior.

Suggested files:

- `src/services/weather/weather-urgency.ts`
- `src/services/notification-router.ts`
- `src/services/notification-dispatcher.ts`
- `src/services/weather/__tests__/weather-urgency.test.mts`

### PR 3: Personal Storm Mode Data Model

Create a service that produces the Storm Mode payload.

Suggested files:

- `src/services/weather/personal-storm-mode.ts`
- `src/services/weather/preparedness-actions.ts`
- `src/services/weather/__tests__/personal-storm-mode.test.mts`

### PR 4: Weather Miss Diagnostics

Add debug traces for severe-weather notification decisions.

Suggested files:

- `src/services/weather/weather-warning-diagnostics.ts`
- `src/services/weather/__tests__/weather-warning-diagnostics.test.mts`

### PR 5: Minimal Storm Mode UI

Only after the data model and notification logic exist, add a compact macOS-native presentation.

Suggested files:

- `src/components/PersonalStormMode.ts`
- `src/styles/macos-native.css`
- `src/styles/alerts.css`

Shipped 2026-07-06 — see the Status list above for the wiring + acknowledgment/expiry
behavior. Additional file beyond the suggested set:
`src/components/personal-storm-mode-view.ts` (pure, testable view/decision helpers).

## Guardrails

- Weather warnings near saved/current locations are safety-critical.
- Prefer false-positive watch-level alerts over silent misses for tornado, flash flood, and destructive wind threats.
- Do not spam unchanged warnings.
- Every weather notification should say why the user got it.
- Every suppression should be diagnosable.
- Critical weather should support bypassing quiet hours, controlled by user settings.
- Keep PR 1 focused on deterministic matching and tests.

## Claude Instruction

Claude should read this plan before implementation.

Recommended prompt:

```text
Read docs/WEATHER_WARNING_REMEDIATION_PLAN.md. Implement PR 1 only: saved-place NWS polygon matching, threat types, and deterministic tests. Focus on fixing missed severe-weather warnings. Do not build broad UI yet.
```
