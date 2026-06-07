# Data Center Readiness Panel — Design

**Date:** 2026-06-07
**Status:** Approved design, ready for implementation plan
**Author:** Claude (brainstorming session)

## Purpose

A focused, always-prominent surface that answers one question for the people
running a single data center: **given the grid and the sky, what should our
people be getting ready to do right now?**

The panel turns *external* signals (electrical grid load/alerts, nearby power
outages, NWS weather threats) into a small, prioritized set of **preparedness
actions** — people-first (on-site safety, commute & staffing) with facility-ops
readiness (HVAC pre-cool, generator refuel timing) riding alongside.

## Hard constraints (locked during brainstorming)

- **External signals only.** The panel never ingests internal/private facility
  telemetry (no UPS %, genset run state, ATS position, PDU load). This is a
  deliberate privacy boundary. The panel is *employee preparedness*, not
  facility monitoring.
- **One configured site.** A single data-center location, set once.
- **People-first.** On-site personal safety and commute/staffing actions rank
  ahead of facility-ops actions. A storm's threat to staff is shown before its
  threat to cooling load.
- **Prominent at all times.** A pinned mini-strip that never scrolls away, plus
  a full top-of-grid panel.

## Approach (chosen)

A new pure `src/services/datacenter/` service layer that fuses existing external
feeds into one `DataCenterPosture` object, with two thin UI renderers on top.
This matches the codebase convention used by `intelligence/`, `weather/`, and
`shortage/`: pure, no-DOM, fixture-tested engines under thin panels. Rejected
alternatives: logic-in-the-panel (untestable, breaks the pattern) and extending
`personal-impact.ts` (overloads a person/portfolio-oriented module with
facility-ops semantics).

## Architecture & file layout

```
src/services/datacenter/
  datacenter-types.ts        # DataCenterPosture, PowerPosture, WeatherPosture,
                             # ReadinessAction, ThreatWindow, SiteConfig, enums
  power-posture.ts           # external grid+outage signals -> PowerPosture (pure)
  weather-posture.ts         # NWS polygon match + Storm Mode -> WeatherPosture (pure)
  readiness-actions.ts       # posture -> prioritized ReadinessAction[] (pure playbook)
  datacenter-posture.ts      # fuses power+weather -> DataCenterPosture (pure orchestrator)
  datacenter-state.ts        # singleton: holds SiteConfig + latest posture, subscribe()
src/components/
  DataCenterReadinessPanel.ts  # full panel (extends Panel)
  DataCenterPinnedStrip.ts     # always-visible one-line strip (new chrome)
```

The four pure modules have **no DOM, no fetch, no globals** — they take
already-fetched external data plus the configured site and return plain objects.
`datacenter-state.ts` is the single wiring point.

### Reused existing assets

- Power: `src/services/power-grid.ts` (`fetchGridStatus()`, `GridStatus`,
  `GridAlert`, `EiaRegion`), `src/services/infrastructure/grid-monitor.ts`
  (region balances, the five EIA regions), nearby-outage data from the
  infrastructure outage feed.
- Weather: `src/services/weather/nws-polygon-match.ts` (`matchAlertToPlace`),
  `weather-threat-types.ts` (`WeatherHazardKind`, `ThreatLevel`),
  `personal-storm-mode.ts` (`StormModePayload`), `preparedness-actions.ts`
  (per-hazard action copy).
- Location: `src/services/saved-places.ts` (`SavedPlace` store) — add a
  `data_center` tag rather than new persistence.
- Panel scaffold: `src/components/Panel.ts` base class;
  `src/components/CommandCenterPanel.ts` as the top-of-app aggregation model.

## Data model

```ts
type Level = 'normal' | 'watch' | 'advisory' | 'warning' | 'critical'; // reuses weather ThreatLevel ladder

interface DataCenterPosture {
  site: SiteConfig;
  overall: Level;             // blended verdict the pinned strip shows
  headline: string;           // one line: "Severe storm 40min out · grid normal"
  power: PowerPosture;
  weather: WeatherPosture;
  actions: ReadinessAction[]; // already sorted (see Readiness playbook)
  updatedAt: number;
  staleInputs: string[];      // feeds that were stale/missing — confidence honesty
}

interface PowerPosture {
  level: Level;
  gridUtilizationPct: number | null;   // fetchGridStatus() for the site's EIA region
  gridAlerts: GridAlert[];             // emergency/warning/watch near the region
  nearbyOutageCount: number | null;    // outage customers/count within radius of site
  drivers: string[];                   // ["PJM at 94% capacity", "3.2k out within 25km"]
}

interface WeatherPosture {
  level: Level;
  activeHazards: WeatherHazardKind[];  // from nws-polygon-match against the site point
  stormMode: StormModePayload | null;  // arrival window + primary hazard, if inside a polygon
  arrivalWindowMins: number | null;    // minutes to impact, drives action urgency
  drivers: string[];
}

interface SiteConfig {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusKm: number;
  eiaRegion: EiaRegion;       // derived from lat/lon, manual override allowed
}
```

### Power level logic (deterministic, named-constant thresholds)

- `critical` — a grid **emergency** alert for the region, or a major nearby outage.
- `warning` — high utilization (≈ > 92%) or a grid **warning** alert.
- `advisory` / `watch` — elevated load or a grid **watch** alert.
- `normal` — otherwise.

Thresholds live as named constants so they are tunable without touching logic.

### Weather level logic

`matchAlertToPlace` (point-in-polygon + UGC zone fallback) runs the configured
site against active NWS alerts; the resulting `ThreatLevel` maps straight onto
`Level`. `arrivalWindowMins` comes from the Storm Mode payload when the site is
inside a polygon.

### Blend rule for `overall`

Take the higher of `power.level` and `weather.level`. Then bump **one rung** if
*both* are simultaneously elevated (≥ `advisory`) — a grid under stress *during*
a storm is worse than either alone. This single cross-domain amplifier mirrors
`src/services/intelligence/compound-risk.ts`.

### Stale-input honesty

`staleInputs` lists any feed that was stale or missing at compute time. Stale
data reduces confidence and is shown, never silently dropped: if the grid feed
is down, the strip says so rather than implying "all clear." (Plan invariant
honored across all existing intelligence layers.)

## Readiness playbook (posture -> actions)

`readiness-actions.ts` is a pure function returning a pre-sorted
`ReadinessAction[]`.

```ts
type ActionAudience = 'onsite_safety' | 'commute_staffing' | 'facility_ops' | 'escalation';
type ActionUrgency  = 'now' | 'soon' | 'be_ready' | 'monitor'; // maps to arrival window / level

interface ReadinessAction {
  id: string;
  audience: ActionAudience;
  urgency: ActionUrgency;
  title: string;            // imperative: "Move outdoor/rooftop crews inside"
  detail: string;           // one line of why + the threshold that triggered it
  trigger: string;          // provenance: "Tornado Warning polygon, ETA 18 min"
  expiresAt: number | null; // stale actions auto-drop
}
```

### Generation rules (each action gated by a posture condition)

- **On-site personal safety** (from `weather-posture`):
  - Tornado / severe-wind warning over the site → "Move staff to interior
    shelter, away from windows" (`now`).
  - Lightning / severe nearby → "Stop all rooftop and outdoor work"
    (`now` / `soon`).
  - Copy reuses the per-hazard library in `preparedness-actions.ts`.
- **Commute & staffing** (weather arrival window + hazard kind):
  - Ice / snow / flood hazard intersecting shift-change hours → "Hold the
    incoming shift / delay non-essential travel" or "Release non-essential staff
    before the window." Arrival window drives `now` vs `be_ready`.
- **Facility ops readiness** (power + weather blend):
  - Active NWS heat alert (Heat Advisory / Excessive Heat Warning) over the
    site → "Pre-cool / verify HVAC headroom ahead of peak cooling load"
    (`be_ready`). Alert-based, consistent with our external-only inputs.
  - Grid stress **or** multi-day severe event → "Confirm generator fuel;
    schedule refuel before the event window" (`soon`).
  - Grid emergency alert → "Verify clean transfer to backup is ready" (`soon`).
- **Escalation** (only when `overall` ≥ `warning`):
  - One action: "Notify facilities manager / on-call now." Deliberately minimal —
    a single human-escalation trigger, not a notification system.

### Sort order

1. `urgency` (now → soon → be_ready → monitor)
2. `audience` (onsite_safety → commute_staffing → facility_ops → escalation)
3. tie-break by severity of the driving signal.

So when seconds matter, the human-safety action is the first thing on screen.

### All-clear state

When `overall === 'normal'`, the list collapses to a single line ("No power or
weather action needed — monitoring") so the panel stays quiet until it shouldn't.

## UI surfaces

### A. Pinned mini-strip (`DataCenterPinnedStrip.ts`)

- Thin horizontal strip docked **above** the panel grid, outside the scroll
  region — visible at all times.
- One line: `[●] DATA CENTER · {overall} · {headline} · {N} actions now`.
- Color/dot driven by `overall`; subtle pulse only at `warning`+ so the calm
  state isn't noisy. Respects Ghost Mode and `prefers-reduced-motion`.
- Click = scroll-to + expand the full panel. At `normal`, shrinks to a slim
  green "All clear" bar.
- If no site is configured, shows a "Set your data center location" CTA instead
  of a verdict (discoverable; never a fake all-clear).

### B. Full panel (`DataCenterReadinessPanel.ts`)

Extends `Panel`. Registered in `config/panels.ts` with top priority,
instantiated first in `panel-layout.ts` (the Command Center model). Layout:

1. **Status header** — two compact gauges: Power verdict + top driver; Weather
   verdict + arrival window. Glanceable in under a second.
2. **Action list** — the sorted `ReadinessAction[]`, grouped by urgency, safety
   first; each row shows title, the one-line why, and `trigger` provenance.
3. **Footer** — `staleInputs` honesty line + last-updated heartbeat (built into
   `Panel`).

Both surfaces are pure renderers — zero decision logic.

## Wiring

- `src/app/data-loader.ts` already fetches grid + weather on the refresh
  schedule. After each, it calls `recomputeDatacenterPosture(siteConfig,
  gridData, weatherAlerts, outageData)`, which updates the singleton. No new
  fetch loop — piggyback on existing schedules.
- `src/app/panel-layout.ts`: instantiate the strip in the chrome above the grid
  during boot; instantiate the panel as the top grid entry. Both call
  `subscribeDatacenterPosture()` and re-render on change.

## Site configuration

- Reuse the `SavedPlace` store. Add a `data_center` value to `SavedPlaceTag`.
  The configured site is the `SavedPlace` carrying that tag; if more than one
  exists, the highest-priority one wins (deterministic).
- `SiteConfig` is a thin projection over that `SavedPlace`. The only field
  beyond a normal saved place is `eiaRegion`, derived automatically from lat/lon
  via a small static US-region lookup (the five EIA regions in
  `grid-monitor.ts`), with a manual override in the editor for edge cases.
- `SavedPlaceModal` gains the `data_center` tag option; selecting it turns on
  the panel.

## Testing

Matches the pure-service convention (`npm run test:weather`, etc.). New
`npm run test:datacenter` script wired into the suite.

- **`datacenter-posture` fixtures** — input bags → expected `overall`,
  `headline`, `staleInputs`. Cover: all-clear, grid-only stress, weather-only
  warning, the **both-elevated amplifier bump**, and stale-feed honesty.
- **`power-posture` / `weather-posture`** — threshold boundary tests (92%
  utilization tips `warning`; polygon hit vs. UGC-zone fallback).
- **`readiness-actions`** — assert the right actions per scenario, that **safety
  sorts above staffing above ops**, that `now` beats `be_ready`, and that
  actions expire/drop when their window passes.
- No live fetch in any unit test — all static fixtures (plan invariant).
- `docs:check` panel-count bump for the new panel.

## Out of scope (YAGNI)

- Internal facility telemetry of any kind (privacy boundary).
- Multi-site fleet view (one configured site only).
- A full comms/notification system (one escalation trigger only).
- UI fine-tuning — visual polish deferred to a later pass.
```
