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

## Remaining last-mile wiring (needs the running app to verify)

1. **Globe overlay layer** — feed `powerAssetsToOverlayRows(...)` into the God's
   Eye Cesium layer (`GlobeDataManager` / `GodsVisionView`) as a new point layer,
   styled by `kind` and `weight`. Mirror an existing pure-emitter overlay
   (e.g. `seismic/globe-overlay-emitter`) for the consumption side.
2. **Datacenter readiness** — call `fetchSitePowerContext(site)` in the datacenter
   loader and surface `nearestSubstationKm` / `nearbyCapacityMw` in
   `ShortageRadarPanel`'s datacenter view or a dedicated card. Treat it as an
   *additional* signal — do not change `computeDatacenterPosture`'s existing
   contract; add an annotation alongside it.
3. **Refresh cadence** — Overpass is rate-limited; the relay caches 6h. Poll on
   site change, not on a timer.

## Licensing — required attribution

OpenStreetMap data is **ODbL**. Any surface that renders these layers MUST credit
**"© OpenStreetMap contributors."** Add it to the map attribution line next to
the existing basemap credits.

## Optional future sources (the rest of what OpenGridWorks aggregates)

- **HIFLD Open + EIA-860** (US, public domain) — higher-fidelity US plants /
  substations / transmission; `infrastructure/hifld.ts` already has a scaffold.
- **Global Energy Monitor** — plant fuel / capacity / status (check attribution).
- **TeleGeography** — submarine cables (check terms).
- **WRI Aqueduct** — flood risk (CC-BY).
