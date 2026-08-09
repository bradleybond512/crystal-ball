# HRRR-Smoke (MASSDEN) ingestion — plan

**Status:** ingestion core landed (pure + tested), the GRIB2 decode seam is
implemented — a `wgrib2`-in-sidecar decoder (`src-tauri/sidecar/hrrr-smoke.mjs`
+ the `/api/smoke/hrrr-grid` route) feeds `fetchHrrrAqGrid` → `DeckGLMap` — **and
a self-contained `wgrib2` is now vendored into the macOS bundle at package time**
(`scripts/vendor-wgrib2.sh`), so HRRR is on by default for every user with no
install step. It remains **fail-closed**: if vendoring is ever skipped (non-macOS,
missing toolchain) or a decode fails, the route reports `available:false` and every
caller stays on Open-Meteo — so this ships with **zero regression risk**. See
**"Decode implemented"** and **"Activation"** below.

> **Both formerly-unverified numbers are now confirmed against a real decode** of a
> live NOMADS HRRR MASSDEN message (2026-07-29 12z, La Porte IN + two other CONUS
> points): `MASSDEN_TO_UGM3 = 1e9` (SI kg/m³ → µg/m³; `6e-11 kg/m³` → `0.06 µg/m³`,
> physically sensible clean-air) and `WGRIB2_VAL_RE` (matches the `-lon` `val=`
> token in `6e-11` / `1.23e-08` / `0` forms). Both remain guarded so any future
> output-format drift fails closed (nulls) rather than showing a bogus field.

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

The TS `GribSmokeDecoder` seam and `fetchHrrrSmokeGrids` remain in
`hrrr-smoke.ts` as the pure/contract reference; the live path (below) does the
same idx → Range-GET → decode server-side in the sidecar, where `wgrib2` and
unrestricted NOMADS reach actually exist.

## Decode implemented (wgrib2 in sidecar)

The decode now lives in the **Tauri sidecar**, where the browser's two blockers
(CORS + the NOMADS 403 that the build sandbox also hits) don't apply and a real
GRIB2 tool is available.

**As built:**

- **`src-tauri/sidecar/hrrr-smoke.mjs`** — a standalone module (added to
  `tauri.conf.json` bundle.resources; guarded by `check-sidecar-bundle.mjs`). It
  hand-ports the pure helpers from `hrrr-smoke.ts` (pinned by the parity test)
  and adds the sidecar-only half:
  - `resolveWgrib2Path()` — `WGRIB2_PATH` env → `WGRIB2_BUNDLED_PATH` → the
    **vendored binary derived from `LOCAL_API_RESOURCE_DIR`**
    (`…/sidecar/wgrib2/wgrib2`, the production default) → Homebrew/system
    locations → `$PATH` scan (pure fs, no subprocess); cached; **null ⇒ the whole
    path stays inert and the caller falls back.**
  - `decodeMassdenAtPoints()` — writes the Range-GET'd message to a temp file and
    runs `wgrib2 <file> -lon <lon> <lat> …` via `promisify(execFile)` (**args
    array, no shell**; lon/lat are range-checked before they reach it). Cleans up
    the temp dir in `finally`.
  - `parseWgrib2Vals()` — pulls each `val=<x>` (in `-lon` argument order) and
    scales SI kg/m³ → µg/m³; a value-count mismatch, the `~9.999e20` missing
    sentinel, negatives, and physically-impossible (>100000 µg/m³) results all
    fail closed to null.
  - `fetchHrrrGrid()` — the orchestrator: per forecast hour, GET the `.idx`,
    parse the MASSDEN byte range, Range-GET only that message (**must be 206**),
    decode at every point; bounded concurrency (6), a single-entry 20-min TTL
    cache keyed by cycle+horizon+rounded-point fingerprint. Returns the exact
    `(GridPointAq | null)[]` renderer contract — a drop-in for `fetchAqGrid`.
- **`/api/smoke/hrrr-grid`** (POST, in `local-api-server.mjs`, after the global
  auth gate) — validates `points` (≤200, finite in-range lat/lon → 400 on bad),
  clamps `horizonHours` to [1,48], calls `fetchHrrrGrid`, returns
  `{ grid, available, source:'hrrr-smoke' }`. `available:false` whenever nothing
  decoded (no wgrib2 / NOMADS down / outside CONUS).
- **`src/services/smoke/smoke-fetch.ts` → `fetchHrrrAqGrid(points)`** — POSTs to
  the route (own 60 s timeout so the sidecar decode outlives the patched-fetch
  15 s default), defensively normalizes each column, records freshness under
  `smoke_field_hrrr` **only when real data returns** (HRRR is an optional upgrade
  layer, so its routine absence must not read as a feed outage), and always
  fails closed to nulls.
- **`src/components/DeckGLMap.ts`** — the sampler call site now tries HRRR first
  and falls back to Open-Meteo on all-null:
  ```ts
  const hrrr = await fetchHrrrAqGrid(points);
  const parsed = hrrr.some((p) => p !== null) ? hrrr : await fetchAqGrid(points);
  const field = assembleForecastField(points, parsed, Date.now());
  ```

### Activation

**On by default.** `scripts/vendor-wgrib2.sh` runs during `desktop-package.mjs`
(macOS only, non-fatal) and builds a self-contained `wgrib2` v3.1.3 from NOAA
source into `src-tauri/sidecar/wgrib2/wgrib2`. That directory is a
`tauri.conf.json` bundle resource, so the bundler's recursive
`codesign --deep --options runtime` pass signs it with the rest of the app — no
separate signing code. At runtime `resolveWgrib2Path` derives the bundled path
from `LOCAL_API_RESOURCE_DIR` (`…/sidecar/wgrib2/wgrib2`), ahead of the legacy
`WGRIB2_PATH` / `WGRIB2_BUNDLED_PATH` / Homebrew-candidate fallbacks.

The build is **C-only and self-contained by design** — `otool -L` on the result
must show only `/usr/lib` + `/System/Library` deps (the script hard-fails
otherwise), because the hardened runtime's library validation would kill a binary
linking Homebrew dylibs. It disables the Fortran interpolation (`USE_IPOLATES=0`),
OpenMP, PROJ, NetCDF/HDF5, shared-lib, and **every external GRIB2 codec**
(`USE_PNG/JASPER/OPENJPEG/AEC=0`): MASSDEN is packed with Data Representation
Template 5.3 (complex packing + spatial differencing), decoded by wgrib2's own
integer unpacker, so no codec — and no vintage bundled zlib/libpng that no longer
builds under a C23-default clang — is needed.

If vendoring is skipped (non-macOS host, missing `cc`/`make`, download/build
failure) the slot keeps only its `README`/`.gitkeep`, the app still bundles, the
route reports `available:false`, and the map stays on the Open-Meteo field —
**no error surface, no regression.**

### The two formerly-Mac-only unknowns (now confirmed)

Documented at the top of `hrrr-smoke.mjs`. Both were validated against a real
decode (vendored wgrib2 v3.1.3 on a live NOMADS MASSDEN message) and remain
guarded to fail closed, so any future output drift yields nulls (fallback to
Open-Meteo), never a bogus field:

- **`MASSDEN_TO_UGM3 = 1e9`** ✓ — HRRR stores MASSDEN in SI kg/m³; ×1e9 → µg/m³.
  Confirmed: `6e-11 kg/m³` at La Porte IN → `0.06 µg/m³` (sensible clean-air);
  `1.23e-08` → `12.3 µg/m³` (moderate smoke). If a known reading ever comes back
  all-zero or pegged at AQI 500, revisit this scale.
- **`WGRIB2_VAL_RE`** ✓ — the exact `wgrib2 -lon` inventory shape (`…:val=<x>`).
  Confirmed against `val=6e-11`, `val=1.23e-08`, and `val=0`. If a future wgrib2
  prints a different token, `parseWgrib2Vals` sees zero matches → all-null →
  fallback (safe, but HRRR would go inert until the regex matches).

### Verification checklist

- [x] Build a self-contained `wgrib2` via `scripts/vendor-wgrib2.sh` and confirm
      `resolveWgrib2Path()` derives it from `LOCAL_API_RESOURCE_DIR`. Done — the
      script installs `src-tauri/sidecar/wgrib2/wgrib2` (`otool -L` = only
      `/usr/lib/libSystem`) and the derived-path test passes.
- [x] Decode one real message and confirm `parseWgrib2Vals` output shape matches
      `WGRIB2_VAL_RE`, and validate `MASSDEN_TO_UGM3`. Done against a live NOMADS
      MASSDEN message (2026-07-29 12z): `val=6e-11` → 0.06 µg/m³ (La Porte IN),
      plus Sierra NV + Houston points; regex matches `6e-11`/`1.23e-08`/`0`.
- [ ] Confirm the MASSDEN record selector against a **live** `.idx`
      (`:MASSDEN:8 m above ground:`) — HRRR occasionally shifts level wording.
      (Decode above used the NOMADS filter CGI, not the sidecar's `.idx`
      byte-range path — confirm on first live sidecar run.)
- [ ] Confirm the Range-GET returns HTTP 206 (a 200 means the proxy ignored the
      range — the route already treats that as a failed hour).
- [ ] Hit `POST /api/smoke/hrrr-grid` with a CONUS point and confirm
      `available:true` + a plausible `usAqi` column.
- [ ] In-app: confirm the map field switches from Open-Meteo to HRRR near a fire
      and `smoke_field_hrrr` freshness records.

## Tests

`npm run test:smoke-engine` (all green). Coverage across the three layers:

- **Pure/contract (tsx, `hrrr-smoke.test.mts`)** — the original 16 cases on the
  TS module (cycle selection + UTC rollback, forecast-hour ceiling, URLs, idx
  byte-range parsing, Range header, AQI breakpoints + truncation + 500 cap,
  `fetchHrrrSmokeGrids`, `hrrrGridsToGridPoints`).
- **Sidecar decode (node --test, `src-tauri/sidecar/__tests__/hrrr-smoke.test.mjs`)**
  — `resolveWgrib2Path` precedence + `$PATH` scan + caching, `parseWgrib2Vals`
  scaling + count-mismatch/sentinel/out-of-range fail-closed, `decodeMassdenAtPoints`
  with injected fs+execFile (arg order, temp cleanup, throw → nulls), and
  `fetchHrrrGrid` idx→206→decode happy path, no-wgrib2/no-points, idx-fail +
  non-206 skips, and cache reuse.
- **Parity (tsx, `hrrr-smoke-parity.test.mts`)** — the sidecar `.mjs` pure
  helpers are asserted to agree with the canonical TS module across a day of
  cycles, all forecast hours, idx variants, and a dense AQI sweep. Change one,
  change both.
- **Renderer client (tsx, `smoke-fetch.test.mts`)** — `fetchHrrrAqGrid` empty-
  points short-circuit, valid-column normalization with per-hour null
  preservation, every malformed-column shape → null, non-ok/missing-grid → nulls,
  and transport-error → nulls.

## Cross-agent review follow-ups (deferred to the decoder-seam work)

The isolated Codex review raised two hardening ideas that are out of scope for
the dormant-until-decoded ingestion core, recorded here for whoever lands the
decoder:

- **Per-cycle completeness signal.** `fetchHrrrSmokeGrids` skips any failed
  forecast hour. This is safe today because `assembleForecastField` aligns cells
  by absolute valid-time with an exact-match lookup — a missing hour is a null
  column, never interpolated — plus the all-past fail-closed guard. If a future
  consumer ever interpolates across hours, add an explicit completeness/expected
  vs. decoded count so a gappy cycle reduces confidence rather than reading as a
  full forecast.
- **Issuance/cycle time on `HrrrSmokeGrid`.** Grids carry `validMs` but not the
  model cycle. The only entry point derives the cycle from `latestHrrrCycle(now)`,
  so a stale run with future valid-times can't arise in practice — but when the
  decoder is wired for real, thread the cycle epoch through so downstream can
  detect and de-weight an old run.
