# Smoke & Air Program — Design

**Date:** 2026-07-16
**Status:** Approved (user), pending implementation
**Origin:** "We've got bad wildfires — why is this app not calling that out? … I'd like to really have a good understanding of the conditions and what I can do. Where I can go. Everything."

## Problem

Wildfire smoke (e.g. Canadian smoke over the Midwest, 8 active NWS Air Quality
Alerts for Indiana on 2026-07-16) is a recurring, health-relevant condition the
app under-served. Recent fixes restored the raw inputs — NIFC perimeters
(PR #1428, 0→156 fires), `wildfire_smoke` hazard classification + preparedness
actions (PR #1429) — but there is no surface that answers, in one place:

1. **How bad is it right now, at my places?**
2. **How bad will it get / when does it improve?** (e.g. Friday flagged red)
3. **What should I do?** (per activity, per person sensitivity)
4. **Where can I go?** (driveable cleaner air)

## Decisions (user-confirmed)

- Build **all three** surfaces: dedicated Air & Smoke surface + Command Center
  headline + map overlay.
- "Where I can go" includes **all four** guidance modes: cleaner-air compass,
  hour-by-hour safe windows, per-activity guidance, indoor clean-room checklist.
- **Full alert ladder**: native notifications on threshold crossings/alerts,
  persistent strip while active, Command Center headline.
- **Approach A**: pure engine first (`src/services/smoke/`), surfaces as thin
  consumers; 4 phased PRs, each independently shippable.

## Data strategy — keyless-first

**Backbone (keyless, works today):** Open-Meteo Air Quality API
(`air-quality-api.open-meteo.com`, already in CSP `connect-src` via
`https://*.open-meteo.com`). Hourly `us_aqi` + `pm2_5`, current conditions +
5-day forecast, any coordinate. This powers current AQI, the 48h curve, safe
windows, day summaries, and every compass sample point.

**Corroboration (keyed, blends in when the user reloads keychain keys):**
AirNow (`/api/wildfire/aqi`, official EPA observations) and PurpleAir
(`/api/airquality/purpleair`, hyper-local sensors). When present they refine
"current" values and are labeled as corroborating sources; when absent the UI
says so honestly ("satellite/model estimate only — AirNow key not loaded").

**Context feeds (existing):** NWS `wildfire_smoke` alerts (classifyHazard,
PR #1429), NOAA HMS smoke plume KML (`wildfire-smoke.ts`), NIFC perimeters
(`fire-intel-service.fetchActivePerimeters`, PR #1428), InciWeb incidents.

**Freshness:** every feed records into `dataFreshness` under its OWN
DataSourceId (fail-closed pattern — see feedback_feed_fidelity_failclosed).
Stale data is surfaced with age labels, never silently dropped.

## Architecture

### PR 1 — Engine: `src/services/smoke/` (pure, fixture-tested)

No DOM, no fetch, no globals in the pure modules; fetchers separate. Test
script `npm run test:smoke` (tsx --test, static fixtures only).

- **`smoke-types.ts`** — shared contracts:
  - `AqiSample { time: string; usAqi: number | null; pm25: number | null }`
  - `AqiCategory = 'good' | 'moderate' | 'usg' | 'unhealthy' | 'very_unhealthy' | 'hazardous' | 'unknown'`
  - `SafeWindow { startIso, endIso, peakAqi, label }`
  - `DaySummary { dateIso, maxAqi, category, headline }`
  - `CompassSample { bearingDeg, direction: 'N'|'NE'|…, radiusMi, lat, lon, avgAqi6h, deltaPctVsHome, placeName: string | null }`
  - `ActivityAdvice { activity, verdict: 'ok'|'caution'|'avoid', reason }`
  - `ChecklistItem { id, label, rationale, done }` + `CleanRoomScore { score0to100, tier }`
  - `SmokeSnapshot { placeId, placeName, current, hourly48, safeWindows, days, compass, activities, checklist, sources, generatedAt }`
- **`aqi-category.ts`** — EPA US-AQI breakpoints → category, color token key,
  display label. Single source of truth for thresholds (101 = USG boundary
  used by headline/alerts).
- **`safe-windows.ts`** — scan the next 48 hourly samples; contiguous runs
  with `usAqi < 100` (configurable) become `SafeWindow`s; also emits the
  worst window ("avoid 2–8 PM, peaks 165") and per-day `DaySummary`
  ("Friday: unhealthy all day, max 172").
- **`clean-air-compass.ts`** — pure math half: given home coord, generate
  8 directions × {30, 60, 100} mi sample coords (great-circle offset);
  given fetched samples, rank directions by 6h-avg AQI improvement vs home,
  produce "cleaner/worse" statements with % delta. Reverse-geocoded names
  attach in the fetcher layer (Nominatim, already CSP-allowed) and are
  optional — compass renders with bare distances if naming fails.
- **`activity-guidance.ts`** — static table: activities (running/exercise,
  kids outdoors, windows open, commuting, outdoor work, pets out) ×
  AqiCategory × `sensitiveGroup: boolean` → `ActivityAdvice`. EPA guidance
  wording, no invented medicine.
- **`clean-room-checklist.ts`** — extends the PR #1429 smoke actions into a
  scored checklist (recirculate HVAC, HEPA/box-fan filter, seal a room, N95s
  on hand, purifier running). Done-state persisted at `cb-smoke-checklist`
  (localStorage, tiny, allow-listed prefix); score = weighted done-sum.
- **`smoke-fetch.ts`** (fetcher, not pure) — Open-Meteo AQ calls for a coord
  list (home + compass ring batched via Open-Meteo's multi-location support,
  falling back to sequential); optional AirNow/PurpleAir current blend;
  records freshness per source id (`smoke-openmeteo`, `smoke-airnow`,
  `smoke-purpleair`).
- **`smoke-state.ts`** — singleton: `refreshSmokeConditions()` builds
  `SmokeSnapshot[]` for saved places (primary first), caches, `subscribe()`.
  Refresh cadence via `scheduleRefresh`: current 10 min, forecast+compass
  30 min.

### PR 2 — Air & Smoke surface

- **`src/components/AirSmokePanel.ts`** (panel id `air-smoke`, registered in
  panels.ts + panel-metadata.ts under Hazards & Weather; instantiated in
  panel-layout.ts — panel wiring audit rule).
- Sections top-to-bottom: hero (place picker over saved places; AQI number,
  category chip, trend arrow, "improving after 8 PM"), 48h AQI curve with
  safe/avoid window bands, cleaner-air compass (ranked directions, named
  towns, % deltas), activity table (sensitive-group toggle, persisted),
  clean-room checklist with score ring, active `wildfire_smoke` alerts list,
  context row (nearest plume/fire distance from existing feeds, "Open map"),
  sources footer (per-source freshness + the honest no-key label).
- All rendering safe-DOM (no innerHTML with dynamic content — hook enforced).

### PR 3 — Callout + alert ladder

- **Headline provider**: pure `smoke-headline.ts` — worst saved-place
  snapshot → `null` (below thresholds) or headline
  ("Hazardous smoke near La Porte — AQI 156, improving after 8 PM").
  Triggers when `usAqi >= 101` at any saved place OR an active
  `wildfire_smoke` alert matches a saved place.
- **Command Center**: renders the headline in "top things that matter" with
  criticality mapped from AqiCategory (USG=elevated, Unhealthy+=high).
- **Home Shell**: headline joins the critical briefing band via the existing
  structured-entry path (shell stays a read-only consumer).
- **Notifications**: route threshold CROSSINGS (edge-triggered, not
  every refresh) + new smoke alerts through the existing notification
  ladder — dedupe + quiet hours respected; smoke is NOT
  safety-critical-override (it does not bypass quiet hours). Storm-Mode
  strip: NWS-alert-driven strips already work via PR #1429's hazard kind;
  add AQI-threshold activation only if the strip API accepts non-NWS
  payloads cleanly — otherwise headline + notification suffice (decide in
  plan, not by force-fitting).

### PR 4 — Map overlay

- One "Smoke & Air" toggle in the map layer set combining: AQI-colored dots
  at home + compass sample points (category colors from `aqi-category.ts`),
  HMS plume polygons (existing KML parse), NIFC perimeters (already on the
  map after PR #1428 — this toggle groups them). Tooltip per dot: AQI, name,
  6h trend. No new data fetch — reuses the PR 1 snapshot + existing layers.

## Error handling

- Open-Meteo unreachable → last snapshot shown with stale badge
  (age > 60 min ⇒ amber, > 3 h ⇒ red); never blank, never silent.
- Compass sample failures → that direction reports "no data" and is ranked
  last; if > half fail, compass section says "cleaner-air scan unavailable".
- Reverse-geocode failure → distances without names.
- AirNow/PurpleAir absent → footer honesty line; no fake precision.
- Saved places empty → panel prompts to add a place; headline/alerts inert.

## Testing

- Fixture suites (no live fetch): breakpoint edges in `aqi-category`;
  window detection incl. all-bad and all-good days in `safe-windows`;
  compass math (bearing/offset correctness ±0.5%, ranking, delta signs);
  guidance table exhaustiveness (every activity × category × sensitivity);
  checklist scoring; headline trigger edges (100 vs 101, alert-match).
- `npm run test:smoke` added to package.json; runs in CI with the rest.
- Live verification per PR: curl the Open-Meteo endpoints for La Porte,
  then built-app screenshot of each surface (per repo verification habit).

## Non-goals (this program)

- No evacuation routing / navigation (compass says where air is better, not
  how to drive there).
- No medical dosing/health claims beyond EPA category guidance.
- No new API keys required for core function; keyed sources only enrich.
- No FIRMS work (separate key-gated concern; unblocks by key reload).

## Phasing recap

| PR | Ships | User value when it lands |
|----|-------|--------------------------|
| 1 | smoke/ engine + fetcher + state + tests | (foundation; verified via tests + curl) |
| 2 | AirSmokePanel | The full "understand + act + where to go" surface |
| 3 | headline + notifications | The app *calls it out* unprompted |
| 4 | map toggle | Visual "where" — plume, fires, AQI field |
