# Claude News, Weather, And Map Events Gameplan

Use this plan to make Crystal Ball much stronger on severe weather, breaking news,
local incidents, and map-visible event awareness.

The current gap is simple: Crystal Ball still misses too much bad weather and too
much important news. The product should move toward a Citizen-style situational
awareness map, while staying broader and more intelligence-oriented than Citizen:
weather, disasters, infrastructure disruption, civil unrest, cyber events,
conflict spillover, supply-chain hits, and major public safety events.

Related existing plan: `docs/WEATHER_WARNING_REMEDIATION_PLAN.md`.

## North Star

Crystal Ball should become a live situational-awareness map that answers:

- What is happening near me?
- What is happening near places I care about?
- Is it official, corroborated, or still emerging?
- How severe is it?
- What area is affected?
- What should I watch or do next?

Big weather and news events should be map-native objects, not just feed rows or
dashboard cards.

## Product Goals

- Make severe weather and breaking news prominent on first open.
- Mark big news events directly on the map.
- Add Citizen-style local awareness for public safety and infrastructure events.
- Rank events by severity, confidence, proximity, and recency.
- Keep critical alerts urgent without making normal usage noisy.
- Preserve source provenance and explain why an event was promoted.
- Deduplicate repeated stories into one evolving event timeline.

## 1. Build A Normalized Event Layer

Create a shared event model used by weather, news, disasters, local incidents,
infrastructure, cyber, and conflict signals.

Recommended fields:

- `id`
- `type`: `weather`, `breaking_news`, `disaster`, `civil_unrest`,
  `infrastructure`, `cyber`, `conflict`, `public_safety`
- `severity`: `info`, `watch`, `elevated`, `severe`, `critical`
- `confidence`: `unconfirmed`, `single_source`, `corroborated`, `official`
- `title`
- `summary`
- `locationLabel`
- `lat`
- `lon`
- `radiusMeters`
- `polygon`
- `startedAt`
- `updatedAt`
- `expiresAt`
- `sources`
- `relatedEventIds`
- `recommendedAction`
- `promotionReason`

Implementation direction:

- Start with a pure deterministic service for normalization and scoring.
- Keep rendering separate from event scoring.
- Every promoted event should explain source count, source trust, proximity, and
  severity reason.
- Expire or fade stale events automatically.

## 2. Expand Severe Weather Coverage

Weather needs to become a primary safety workflow, not a passive alert list.

Priority sources:

- NOAA/NWS active alerts
- NWS CAP alerts
- National Hurricane Center advisories
- Storm Prediction Center outlooks and watches
- Weather Prediction Center excessive rainfall outlooks
- USGS earthquake feeds
- NASA FIRMS wildfire hotspots
- AirNow or EPA air quality feeds
- River and flood gauge feeds where practical
- GDACS, Meteoalarm, or similar global disaster/weather alerts

Weather event types:

- Tornado warning or watch
- Severe thunderstorm warning or watch
- Flash flood warning or watch
- Hurricane or tropical storm
- Wildfire
- Winter storm
- Extreme heat or cold
- Air quality emergency
- Earthquake
- Tsunami
- Volcano
- River flood

Map treatment:

- Render official warning polygons when available.
- Render hurricane tracks, cones, and forecast points.
- Render outlook areas as risk overlays.
- Render earthquakes, fires, and reports as points.
- Use critical styling only for active life-safety threats.

Important follow-up to the existing weather remediation plan:

- Finish the deferred UI work for Personal Storm Mode.
- Ensure warning polygons are visible on the map.
- Promote severe weather near saved places into the top app surface.
- Add diagnostics for missed weather events.

## 3. Expand Breaking News Coverage

Current news coverage likely fails because ingestion is sparse, local coverage is
thin, and stories are not converted into geospatial events.

Source categories to add:

- National and global wires and outlets.
- Local news RSS by metro and region.
- Official emergency management feeds.
- Police, fire, EMS, and public incident feeds where legally available.
- State DOT and transit disruption feeds.
- Aviation, rail, port, and maritime disruption feeds.
- Cyber incident and outage feeds.
- GDELT-style global news indexing if practical.
- Social/web signals only as weak signals unless corroborated elsewhere.

Claude should prioritize local feeds because they unlock the Citizen-like feel.
National feeds will miss neighborhood-level fires, shootings, hazmat events,
evacuations, school lockdowns, shelter orders, road closures, and outages.

## 4. Convert News Into Map Events

For every incoming article or feed item:

- Classify event type.
- Extract place names.
- Geocode to coordinates.
- Estimate affected radius.
- Detect severity language.
- Attach source provenance.
- Dedupe against existing events.
- Update an existing event timeline when a new article is about the same thing.

Examples:

- "Large chemical fire in Deer Park" becomes an infrastructure or public safety
  event near Deer Park, Texas.
- "Evacuations ordered near wildfire" becomes a wildfire event with evacuation
  severity.
- "Airport ground stop" becomes a transportation or infrastructure event.
- "Massive outage across Houston" becomes an infrastructure event with
  metro-level radius.

Do not let weak geocoding create high-confidence map pins. If location extraction
is uncertain, mark the event as low-confidence or region-level.

## 5. Add Map Prominence

Big news events should be visible on maps.

Recommended layers:

- Critical Now
- Breaking News
- Weather Threats
- Local Incidents
- Infrastructure
- Global Risk

Marker rules:

- Severity controls color and intensity.
- Event type controls icon.
- Confidence controls border or opacity.
- Stale events fade instead of disappearing abruptly.
- Clusters summarize count and maximum severity.
- Critical events can pulse, but only while active and urgent.

Event detail drawer:

- Title and severity.
- Location and affected area.
- Confidence label.
- Timeline of updates.
- Source list.
- Why Crystal Ball thinks this matters.
- Recommended action.
- Related nearby events.

## 6. Add Citizen-Style Local Mode

Create a "Near Me" or "Local Watch" mode.

Expected behavior:

- Use current location or saved places.
- Allow radius filters: 5, 10, 25, 50, and 100 miles.
- Show local incident feed and map markers.
- Let users filter by weather, public safety, infrastructure, and traffic.
- Alert on critical events near saved places.
- Respect Ghost Mode, dismissals, cooldowns, and quiet preferences.

This mode should feel like: "What would I want to know if I lived here?"

## 7. Fuse Severity And Confidence

More feeds alone will create noise. Add scoring that combines:

- Source trust.
- Number of independent sources.
- Official confirmation.
- Proximity to current location and saved places.
- Population affected.
- Active warnings, watches, evacuation orders, or shelter orders.
- Event category.
- Recency.
- Infrastructure disruption.
- User relevance.

Suggested escalation ladder:

- Local article only: `single_source` and usually `elevated`.
- Local article plus official public safety source: `corroborated` and often
  `severe`.
- NWS warning, evacuation order, shelter order, or official emergency alert:
  `official` and often `critical`.

Every elevated score should have an explanation. Avoid sensational wording.

## 8. Make News And Weather Prominent In The UI

Add or refine these surfaces:

- Top "Active Threats" strip.
- Map layer toggles for weather, news, local incidents, and infrastructure.
- "Near Me" panel.
- Saved-place alert stack.
- Critical event banner.
- Event timeline drawer.
- "What changed since last open" digest.

The first screen should surface the most important active situation instead of
forcing the user to hunt through panels.

## 9. Implementation Phases

### Phase 1: Event Foundation

- Define normalized event model.
- Build event normalization service.
- Build event scoring service.
- Add event store/cache.
- Add event expiration and stale handling.
- Add source provenance.

### Phase 2: Map Event Layer

- Add unified event markers to the map.
- Add severity and confidence styling.
- Add clusters.
- Add event detail drawer.
- Add layer toggles.
- Add saved-place proximity filtering.

### Phase 3: Severe Weather

- Strengthen NWS active alert and CAP ingestion.
- Add NHC, SPC, WPC, USGS, FIRMS, and air quality sources.
- Render weather polygons and tracks.
- Promote severe weather near saved places.
- Finish Personal Storm Mode UI.
- Add missed-weather diagnostics.

### Phase 4: Breaking News

- Expand national, global, local, and official source registry.
- Add article classification.
- Add location extraction and geocoding.
- Add article-to-event conversion.
- Add dedupe and event timeline updates.
- Add confidence labels.

### Phase 5: Citizen-Style Local Awareness

- Add local incident source packs by region.
- Add Near Me mode.
- Add local public safety and infrastructure categories.
- Add radius filters.
- Add local alert preferences.

### Phase 6: Fusion, Trust, And Polish

- Merge duplicate events across weather, news, and official feeds.
- Add confidence explanations.
- Add cooldown tuning.
- Add "what changed" digest.
- Add notification ladder integration.
- Add replay fixtures for missed weather and missed local news events.

## Suggested Repo Areas To Audit First

- `api/rss-proxy.js`
- `scripts/validate-rss-feeds.mjs`
- `scripts/ais-relay.cjs`
- `src/components/MapContainer.ts`
- `src/services/breaking-news-alerts.ts`
- `src/services/correlation.ts`
- `src/services/analysis-core.ts`
- `src/services/mode-manager.ts`
- `src/app/panel-layout.ts`
- `src/services/weather/`
- `src/services/insights/`
- `src/services/intelligence/`

## Initial Claude Prompt

Use this prompt to start implementation:

```text
Read docs/CLAUDE_NEWS_WEATHER_MAP_EVENTS_GAMEPLAN_2026-05-03.md and
docs/WEATHER_WARNING_REMEDIATION_PLAN.md. Audit the current feed ingestion,
weather services, breaking news alerting, map layer wiring, and notification
surfaces. Then implement Phase 1 and Phase 2 in the smallest safe PR sequence:
normalized event model, event scoring, event store/cache, unified map markers,
severity/confidence styling, event detail drawer, and tests. Preserve source
provenance, saved-place relevance, dedupe behavior, Ghost Mode, and cooldowns.
Run typecheck and targeted tests before opening a PR.
```
