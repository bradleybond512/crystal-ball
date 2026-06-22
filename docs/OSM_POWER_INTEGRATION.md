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

## Remaining last-mile (needs the running app to verify)

1. **Globe overlay layer** — feed `powerAssetsToOverlayRows(...)` into the God's
   Eye Cesium layer (`GlobeDataManager` / `GodsVisionView`) as a new point layer,
   styled by `kind` and `weight`. The consumption side is bespoke Cesium code
   (no data-driven overlay registry), so it needs in-app visual verification.
2. **Panel CSS (cosmetic)** — `.dc-grid-line` / `.dc-grid--weak` render unstyled
   today; add styling next to the existing `.dc-seismic-line` rules.

## Optional future sources (the rest of what OpenGridWorks aggregates)

- **HIFLD Open + EIA-860** (US, public domain) — higher-fidelity US plants /
  substations / transmission; `infrastructure/hifld.ts` already has a scaffold.
- **Global Energy Monitor** — plant fuel / capacity / status (check attribution).
- **TeleGeography** — submarine cables (check terms).
- **WRI Aqueduct** — flood risk (CC-BY).
