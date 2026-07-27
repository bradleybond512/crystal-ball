# HRRR-Smoke (MASSDEN) ingestion — plan

**Status:** ingestion core landed (pure + tested). GRIB2 decode seam is the one
remaining piece; until it's implemented every caller stays on Open-Meteo, so
this ships with **zero regression risk**.

## Why

The smoke forecast field (`src/services/smoke/forecast-field.ts`) is fed today
by Open-Meteo / CAMS AQI. That's a global aerosol model, not a smoke model:
it's coarse over CONUS and lags fast-moving wildfire plumes. NOAA's **HRRR-Smoke**
is a 3 km, hourly, CONUS-native smoke model whose near-surface `MASSDEN` field
(smoke PM2.5 concentration) is exactly what the arrival estimator and the map
overlay want. Swapping the sampler behind `assembleForecastField` upgrades the
model without touching the map, the arrival math, or any panel.

## What landed

`src/services/smoke/hrrr-smoke.ts` — pure + injected, fixture-tested under tsx
(14 tests in `__tests__/hrrr-smoke.test.mts`):

| Export | Role |
| --- | --- |
| `latestHrrrCycle(nowMs, latencyHours=2)` | newest published cycle, floored to the UTC hour |
| `maxForecastHour(cycle)` | 48 h on the 00/06/12/18Z cycles, 18 h otherwise |
| `hrrrSmokeUrls(cycle, fh)` | NOMADS `wrfsfcf<FF>.grib2` + `.idx` URLs |
| `parseIdxByteRange(idxText, {field, level})` | MASSDEN record → `{start, end\|null}` |
| `rangeHeader(range)` | `bytes=a-b` / `bytes=a-` |
| `smokePm25ToUsAqi(ugm3)` | EPA-2024 PM2.5 breakpoints, truncate-to-0.1, cap 500 |
| `fetchHrrrSmokeGrids({cycle, forecastHours, decoder, fetchImpl, …})` | idx → range-GET → decode per hour; skips failures; null when none decode |
| `hrrrGridsToGridPoints(grids, points)` | drop-in for the Open-Meteo `fetchAqGrid` sampler → `(GridPointAq \| null)[]` |

The `.idx` sidecar is the load-bearing trick: a wrfsfc file is ~130 MB, but the
sidecar lists each record's start byte, so we Range-GET only the MASSDEN message
(a few MB) rather than the whole file.

## The decode seam (left unimplemented, on purpose)

```ts
export type GribSmokeDecoder = (bytes: Uint8Array, validMs: number) => HrrrSmokeGrid | null;
```

The GRIB2 binary decode could **not** be verified against live NOMADS — the
build sandbox gets HTTP 403 from `nomads.ncep.noaa.gov`. Rather than ship an
unverified binary parser, the decode is a parameter. Everything up to and
including the byte-range Range-GET is pure and tested; the decoder is the single
seam a follow-up implements and verifies against real data.

### Decoder contract

- Input: the raw bytes of one MASSDEN GRIB2 message (the Range-GET body) + its
  valid time in epoch ms.
- Output: an `HrrrSmokeGrid` — `{ validMs, sample(lat, lon) }` where `sample`
  returns near-surface smoke **PM2.5 in µg/m³** (not AQI — `hrrrGridsToGridPoints`
  converts), or `null` outside the CONUS domain.
- Returns `null` for any message it can't decode (never throws to the caller).

### Recommended implementation

Host the decode in the **Tauri sidecar** (`src-tauri/sidecar/local-api-server.mjs`)
via `wgrib2`, which is the reference GRIB2 tool and already knows the HRRR
Lambert-conformal projection:

1. Add a sidecar route that accepts the cycle + forecast hour, does the idx +
   Range-GET server-side (avoids the browser CORS/redirect constraints and the
   NOMADS 403 the sandbox hits), pipes the message through
   `wgrib2 -match ':MASSDEN:8 m above ground:' -inv /dev/null -csv -` (or netCDF),
   and returns a compact lat/lon/value grid.
2. The renderer-side decoder becomes a thin adapter: call the sidecar route,
   build a bilinear `sample(lat, lon)` over the returned grid.

### Verification checklist (for the decode follow-up)

- [ ] Confirm the MASSDEN record selector against a **live** `.idx`
      (`:MASSDEN:8 m above ground:`) — HRRR occasionally shifts level wording.
- [ ] Decode one real message and spot-check `sample()` against the AirNow /
      station PM2.5 near an active fire (order-of-magnitude sanity).
- [ ] Confirm Range-GET returns HTTP 206 with the expected byte count.
- [ ] Verify `smokePm25ToUsAqi` output against AirNow AQI for the same
      concentration (the breakpoints are the 2024 revision).
- [ ] Round-trip through `assembleForecastField` and confirm a non-null field.

## Non-regressing opt-in wiring (follow-up diff)

`gatherAqField` (or the Open-Meteo sampler call site) tries HRRR first and falls
back on any null — so an unimplemented/failed decoder is invisible to users:

```ts
// in the fetch layer, behind the existing Open-Meteo sampler:
const cycle = latestHrrrCycle(Date.now());
const grids = await fetchHrrrSmokeGrids({
  cycle,
  forecastHours: range(0, maxForecastHour(cycle) + 1),
  decoder: hrrrDecoder,   // ← the seam; absent ⇒ grids is null
  fetchImpl: fetch,
});
const parsed = grids
  ? hrrrGridsToGridPoints(grids, points)
  : await fetchAqGrid(points);   // ← today's Open-Meteo path, unchanged
return assembleForecastField(points, parsed, Date.now());
```

Because `fetchHrrrSmokeGrids` returns `null` whenever nothing decodes, the `?:`
collapses to the current Open-Meteo behavior until the decoder is real. No panel,
map layer, or arrival call site changes.

## Tests

`npm run test:smoke-engine` (pure, tsx). This module adds 14 cases: cycle
selection + UTC rollback, forecast-hour ceiling, URL construction, idx byte-range
parsing (bounded / open-ended / absent), Range header rendering, AQI breakpoint
anchors + 0.1 truncation + 500 cap, `fetchHrrrSmokeGrids` happy-path + skip +
null, and the `hrrrGridsToGridPoints` drop-in shape + fail-closed nulls.
