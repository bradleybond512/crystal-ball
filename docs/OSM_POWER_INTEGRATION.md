# OSM Power-Infrastructure Integration (OpenGridWorks data)

Integrates the open data behind [OpenGridWorks](https://opengridworks.com/) —
power plants, transmission lines, substations, data centers — directly from
**OpenStreetMap via the Overpass API**, rather than scraping the OpenGridWorks
front-end (which has no public API and blocks bots).

## What's built and tested

| Piece | File | Tested |
| --- | --- | --- |
| Pure adapter: Overpass query builder, response parser (classify + way-center + voltage/capacity), site summary, overlay rows | `src/services/infrastructure/osm-power.ts` | ✅ 10 unit tests (`test:infrastructure`) |
| Sidecar relay: CSP-safe POST proxy to Overpass, 6h cache, 400 guard | `src-tauri/sidecar/local-api-server.mjs` (`/api/osm-power`) | ✅ 400-path test in `local-api-server.test.mjs` |
| Runtime entry: routes via relay on desktop, direct otherwise | `src/services/infrastructure/osm-power-source.ts` | typecheck |

## How to call it

```ts
import { fetchSitePowerContext, fetchSitePowerAssets } from '@/services/infrastructure/osm-power-source';

// For the datacenter readiness layer (nearest substation, nearby generation):
const ctx = await fetchSitePowerContext(site.lat, site.lon, 25); // radiusKm
// ctx.nearestSubstationKm, ctx.nearbyCapacityMw, ctx.counts, ctx.nearestPlant

// For a map layer:
import { powerAssetsToOverlayRows } from '@/services/infrastructure/osm-power';
const rows = powerAssetsToOverlayRows(await fetchSitePowerAssets(site.lat, site.lon, 25));
// rows: { id, kind, lat, lon, label, weight }[]  (weight ∝ plant capacity)
```

## Wired in (this PR)

- ✅ **Datacenter readiness** — `data-loader` resolves grid infrastructure per
  site (6h-cached; Overpass is rate-limited) and threads it through
  `recomputeDatacenterPosture` as an optional `gridInfrastructure: PowerContext`.
  `DataCenterPosture` gained the field additively (existing posture tests
  unchanged); `DataCenterReadinessPanel` renders a `⚡` grid line via
  `describeGridReadiness` (flags a weak grid tie when no substation is in range).
  Verified by the pure datacenter + osm-power suites (50 tests).
- ✅ **Attribution** — the map already credits "© OpenStreetMap" (basemap is
  OSM-derived; see `DeckGLMap` + `public/map-styles/*.json`), which covers the
  ODbL requirement for these layers.
- ✅ **Panel CSS** — `.dc-grid-line` + `.dc-grid--ok` / `.dc-grid--weak` are
  styled next to the `.dc-seismic-line` rules in `src/styles/main.css` (cyan ⚡
  base; green healthy tie; amber weak-tie warning).

## Wired in (globe overlay)

- ✅ **God's Eye globe layer** — `GlobeDataManager` registers a
  `powerInfrastructure` layer that resolves an origin (site-first via
  `resolveSiteConfig(getSavedPlaces())`, camera-center fallback), fetches
  `fetchSitePowerAssets(...)`, and renders one billboard per
  `powerAssetsToOverlayRows(...)` row. Per-kind icons live in
  `config/globe-icons.ts` (`POWER_ICONS`); color + size come from the pure
  `powerOverlayStyle(...)`. The layer is **zoom-gated** (`DEFERRED_LAYER_ALTITUDE`,
  ≤ 2,000 km) and **enable-gated** (skips the rate-limited Overpass call while
  the `Power Grid` HUD toggle is off). Enabling the toggle kicks an immediate
  load (`setLayerVisible` → `loadLayer`) so it isn't dead until the next camera
  move. To protect the rate-limited relay, the loader acts as a per-move handler
  that re-arms every time but only refetches when the **anchor cell changes** —
  a coarse grid-snap (`powerAnchorKey`, ~radius in degrees) means small pans (and
  the fixed-site path) reuse the same cell + the sidecar's 6h Overpass cache key.
  Popups carry the required `© OpenStreetMap contributors` attribution. Toggle
  lives in `config/gods-vision-layers.ts` (`powerInfrastructure`, default off).
  The pure popup label is `powerKindLabel(...)` (unit-tested).

## Remaining last-mile (needs the running app to verify)

1. **Visual pass** — the globe layer is wired and type/lint/unit-clean, but the
   billboard scale ramp and icon legibility at altitude want a quick in-app
   eyeball in a runnable build env (Cesium has no headless render here).

## Optional future sources (the rest of what OpenGridWorks aggregates)

- **HIFLD Open + EIA-860** (US, public domain) — higher-fidelity US plants /
  substations / transmission; `infrastructure/hifld.ts` already has a scaffold.
- **Global Energy Monitor** — plant fuel / capacity / status (check attribution).
- **TeleGeography** — submarine cables (check terms).
- **WRI Aqueduct** — flood risk (CC-BY).
