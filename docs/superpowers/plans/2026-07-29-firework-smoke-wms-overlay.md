# ECCC FireWork Smoke-Forecast WMS Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a keyless, 72-hour predictive wildfire-smoke raster overlay (ECCC FireWork surface PM2.5) to the 2D map and God's Eye globe, with the existing map smoke scrubber driving the WMS TIME dimension.

**Architecture:** A new pure-ish service (`src/services/firework-smoke.ts`) mirrors `rainviewer-radar.ts`: it fetches a layer-filtered WMS GetCapabilities (~20 KB), parses the ISO-8601 time dimension into hourly epoch-ms frames, and builds a MapLibre raster-tile GetMap template using the `{bbox-epsg-3857}` token. `DeckGLMap.syncWeatherRasterLayers()` renders it exactly like the GOES/RainViewer rasters (rebuild-on-URL-change), and the existing `smoke-forecast-scrubber` (from the #1517 smoke stack) is generalized to drive the WMS TIME so scrubbing animates the raster. The globe gets a static (server-default-time) `WebMapServiceImageryProvider` layer. Fail-open: if the capabilities fetch fails, the tile URL omits TIME and GeoMet serves its default (nearest current hour); the failure is recorded in data-freshness.

**Tech Stack:** TypeScript + MapLibre GL raster sources + Cesium `WebMapServiceImageryProvider` + `tsx --test` (node:test) unit tests. No new dependencies, no API key, no sidecar work.

---

## Verified live facts (probed 2026-07-29 — do not re-derive)

- Endpoint: `https://geo.weather.gc.ca/geomet` (MSC GeoMet WMS 1.3.0). CORS: `Access-Control-Allow-Origin: *`.
- Layer name: **`RAQDPS.Sfc_PM2.5-WildfireSmokePlume`** — "Total concentrations associated with forest fire and vegetation plumes: surface PM2.5 [kg/m³]". (The catalog doc's `RAQDPS-FW.SFC_PM2.5` name does NOT exist; the FireWork product ships under the `RAQDPS.*-WildfireSmokePlume` names.)
- Time dimension (from GetCapabilities): `<Dimension name="time" ...>2026-07-29T00:00:00Z/2026-08-01T00:00:00Z/PT1H</Dimension>` — 72 h hourly, refreshed by 2 model runs/day (00Z/12Z). Default = nearest current hour when TIME is omitted.
- Coverage: North America (lon −176.8…−18.8, lat 16.1…80.2), 10 km resolution.
- Layer-filtered capabilities (`...&request=GetCapabilities&LAYER=RAQDPS.Sfc_PM2.5-WildfireSmokePlume`) is only ~19 KB.
- **Gotcha: GeoMet returns HTTP 500 to HEAD requests.** GET works. Never probe with `curl -I`.
- Working GetMap (verified returns a PNG):
  `https://geo.weather.gc.ca/geomet?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&BBOX=-10000000,3000000,-8000000,5000000&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&LAYERS=RAQDPS.Sfc_PM2.5-WildfireSmokePlume&STYLES=&FORMAT=image/png&TRANSPARENT=TRUE`

## Design decisions (already made — don't relitigate)

1. **No new panel.** The map already has a smoke time scrubber (`smoke-forecast-scrubber` in `DeckGLMap.ts`, built for the Open-Meteo forecast field). We generalize its hours source instead of cloning `WeatherRadarPanel`.
2. **New `MapLayers` key `smokeForecast`** (separate from `airSmoke`): the continental WMS raster and the local AQI-dot field are independently toggleable. Chip appears in the **full variant only**, next to Air & Smoke.
3. **Naming convention:** product-facing key/`data-loader` task = `smokeForecast`; source-facing internals = `firework*` (service file, DeckGLMap fields, freshness id `firework-smoke`). This avoids collision with the six existing `smokeForecast*` fields in DeckGLMap that belong to the Open-Meteo field.
4. Defaults **off** in every variant (opt-in overlay, like the OWM rasters).
5. Globe layer shows server-default time only (no scrubbing on the globe) — ambient view, minimal scope.

## Known line anchors (as of origin/main 25ade9a1 — re-grep if drifted)

| Anchor | Location |
|---|---|
| `rainviewer-radar` import | `src/components/DeckGLMap.ts:133` |
| `private radarState` field | `src/components/DeckGLMap.ts:639` |
| `syncSmokeScrubber(mapLayers.airSmoke)` call | `src/components/DeckGLMap.ts:1528` |
| `syncSmokeScrubber` / `updateSmokeScrubberLabel` | `src/components/DeckGLMap.ts:2527-2582` |
| full-variant chip list (`airSmoke` entry) | `src/components/DeckGLMap.ts:4628` |
| `syncWeatherRasterLayers` | `src/components/DeckGLMap.ts:6644-6692` |
| `syncRasterTileLayer` helper | `src/components/DeckGLMap.ts:6694` |
| `setRadarState` public setter | `src/components/DeckGLMap.ts:6785` |
| `MapLayers` weather keys | `src/types/index.ts:607-616` |
| MapLayers default literals | `src/config/panels.ts:426,512,636,719,839,922,1021,1104` + `src/config/variants/{full,tech,finance,happy}.ts` (2 each) |
| `weatherRadar` task registration | `src/app/data-loader.ts:752` |
| `loadWeatherRadar` method | `src/app/data-loader.ts:4136` |
| `DataSourceId` union / `SOURCE_METADATA` | `src/services/data-freshness.ts:9,70,186,248` |
| physical_safety mode layers | `src/services/survival/map-modes.ts:30-36` |
| gods-vision weather entries | `src/config/gods-vision-layers.ts:255-266` |
| globe `registerLayer` weather block | `src/components/GlobeDataManager.ts:689-691` |
| globe LOD record | `src/components/GlobeDataManager.ts:610-612` |
| globe cesium imports | `src/components/GlobeDataManager.ts:21` |
| Tauri CSP | `src-tauri/tauri.conf.json:16` |
| Web CSP meta | `index.html:7` |

---

### Task 0: Worktree + branch setup

The canonical dir is shared by many sessions (git HEAD/index are global) — do all work in a dedicated worktree.

- [ ] **Step 1: Create the worktree**

```bash
cd ~/Developer/crystalball
git fetch origin
git worktree add .worktrees/firework-smoke -b claude/firework-smoke-wms origin/main
```

(If `git fetch` prints `reference already exists` errors for dependabot refs, ignore them — known stale-tracking-ref noise; the branch still comes from a fresh `origin/main`.)

- [ ] **Step 2: Clone node_modules into the worktree (APFS clone — never symlink)**

```bash
cp -Rc ~/Developer/crystalball/node_modules ~/Developer/crystalball/.worktrees/firework-smoke/node_modules
```

- [ ] **Step 3: Copy this plan into the worktree and commit it**

```bash
cd ~/Developer/crystalball/.worktrees/firework-smoke
cp ~/Developer/crystalball/docs/superpowers/plans/2026-07-29-firework-smoke-wms-overlay.md docs/superpowers/plans/
git add docs/superpowers/plans/2026-07-29-firework-smoke-wms-overlay.md
git commit -m "plan: FireWork smoke-forecast WMS overlay"
```

All later steps run from `~/Developer/crystalball/.worktrees/firework-smoke` — Bash cwd resets between turns, so re-`cd` each time.

### Task 1: `firework-smoke` service (TDD)

**Files:**
- Create: `src/services/firework-smoke.ts`
- Test: `src/services/__tests__/firework-smoke.test.mts`

- [ ] **Step 1: Write the failing tests**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractTimeDimension,
  parseTimeDimension,
  smokeForecastHoursFromNow,
  getSmokeForecastTileUrl,
  FIREWORK_LAYER,
} from '../firework-smoke.ts';

const HOUR = 3_600_000;

// Trimmed from the real layer-filtered GetCapabilities (2026-07-29).
const CAPS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities version="1.3.0">
  <Layer queryable="1" opaque="0" cascaded="0">
    <Name>RAQDPS.Sfc_PM2.5-WildfireSmokePlume</Name>
    <Title>Total concentrations associated with forest fire and vegetation plumes: surface PM2.5 [kg/m³]</Title>
    <Dimension name="time" units="ISO8601" default="2026-07-29T05:00:00Z" nearestValue="0">2026-07-29T00:00:00Z/2026-08-01T00:00:00Z/PT1H</Dimension>
    <Dimension name="reference_time" units="ISO8601" default="2026-07-29T00:00:00Z" multipleValues="1" nearestValue="0">2026-07-27T00:00:00Z/2026-07-29T00:00:00Z/PT12H</Dimension>
  </Layer>
</WMS_Capabilities>`;

test('extractTimeDimension pulls the time interval, not reference_time', () => {
  assert.equal(
    extractTimeDimension(CAPS_FIXTURE),
    '2026-07-29T00:00:00Z/2026-08-01T00:00:00Z/PT1H',
  );
});

test('extractTimeDimension returns null when absent', () => {
  assert.equal(extractTimeDimension('<WMS_Capabilities></WMS_Capabilities>'), null);
});

test('parseTimeDimension expands a 72 h hourly interval into 73 frames', () => {
  const frames = parseTimeDimension('2026-07-29T00:00:00Z/2026-08-01T00:00:00Z/PT1H');
  assert.equal(frames.length, 73);
  assert.equal(frames[0], Date.parse('2026-07-29T00:00:00Z'));
  assert.equal(frames[72], Date.parse('2026-08-01T00:00:00Z'));
  assert.equal(frames[1]! - frames[0]!, HOUR);
});

test('parseTimeDimension accepts a bare timestamp', () => {
  assert.deepEqual(
    parseTimeDimension('2026-07-29T05:00:00Z'),
    [Date.parse('2026-07-29T05:00:00Z')],
  );
});

test('parseTimeDimension rejects malformed input without looping', () => {
  assert.deepEqual(parseTimeDimension('garbage'), []);
  assert.deepEqual(parseTimeDimension('2026-07-29T00:00:00Z/2026-08-01T00:00:00Z/PT0H'), []);
  assert.deepEqual(parseTimeDimension('2026-08-01T00:00:00Z/2026-07-29T00:00:00Z/PT1H'), []);
  assert.deepEqual(parseTimeDimension('a/b/c/d'), []);
});

test('smokeForecastHoursFromNow drops frames before the current hour', () => {
  const start = Date.parse('2026-07-29T00:00:00Z');
  const frames = parseTimeDimension('2026-07-29T00:00:00Z/2026-08-01T00:00:00Z/PT1H');
  const now = start + 5 * HOUR + 20 * 60 * 1000; // 05:20Z
  const hours = smokeForecastHoursFromNow({ frames, fetchedAt: now }, now);
  assert.equal(hours[0], start + 5 * HOUR); // hour containing "now"
  assert.equal(hours.length, 68);
});

test('getSmokeForecastTileUrl without state omits TIME but stays renderable', () => {
  const url = getSmokeForecastTileUrl(null);
  assert.match(url, /\{bbox-epsg-3857\}/);
  assert.match(url, new RegExp(`LAYERS=${FIREWORK_LAYER.replace(/[.]/g, '\\.')}`));
  assert.doesNotMatch(url, /TIME=/);
});

test('getSmokeForecastTileUrl pins TIME to the nearest frame and clamps out-of-range targets', () => {
  const frames = parseTimeDimension('2026-07-29T00:00:00Z/2026-08-01T00:00:00Z/PT1H');
  const state = { frames, fetchedAt: 0 };
  const nearMs = Date.parse('2026-07-29T05:00:00Z') + 10 * 60 * 1000;
  assert.match(getSmokeForecastTileUrl(state, nearMs), /TIME=2026-07-29T05:00:00Z/);
  const wayLate = Date.parse('2026-08-05T00:00:00Z');
  assert.match(getSmokeForecastTileUrl(state, wayLate), /TIME=2026-08-01T00:00:00Z/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd ~/Developer/crystalball/.worktrees/firework-smoke
npx tsx --test src/services/__tests__/firework-smoke.test.mts
```

Expected: FAIL — cannot find module `../firework-smoke.ts`.

- [ ] **Step 3: Write the service**

```ts
/**
 * ECCC FireWork (RAQDPS-FW) — predictive wildfire-smoke surface PM2.5
 *
 * Source: MSC GeoMet WMS (https://geo.weather.gc.ca/geomet). Keyless, CORS *.
 * `RAQDPS.Sfc_PM2.5-WildfireSmokePlume` is the FireWork product: hourly
 * surface PM2.5 attributable to wildfire plumes, out to 72 h, North America
 * at 10 km, two model runs/day (00Z/12Z).
 *
 * GetMap is consumed as a MapLibre raster source via the {bbox-epsg-3857}
 * template (same pattern as the RainViewer/GIBS rasters in
 * syncWeatherRasterLayers). Available TIME steps come from a layer-filtered
 * GetCapabilities (~20 KB) whose <Dimension name="time"> is an ISO-8601
 * start/end/period interval.
 *
 * GeoMet answers HEAD requests with HTTP 500 — probe with GET only.
 */

import { dataFreshness } from '@/services/data-freshness';

export interface SmokeForecastState {
  /** Available hourly frames as epoch ms, ascending. */
  frames: number[];
  fetchedAt: number;
}

export const FIREWORK_WMS_BASE = 'https://geo.weather.gc.ca/geomet';
export const FIREWORK_LAYER = 'RAQDPS.Sfc_PM2.5-WildfireSmokePlume';

const CAPS_URL = `${FIREWORK_WMS_BASE}?lang=en&service=WMS&version=1.3.0&request=GetCapabilities&LAYER=${FIREWORK_LAYER}`;
const CACHE_TTL_MS = 30 * 60 * 1000;
const HOUR_MS = 3_600_000;

let cache: SmokeForecastState | null = null;

/** Raw time-dimension content from a GetCapabilities document, e.g.
 *  "2026-07-29T00:00:00Z/2026-08-01T00:00:00Z/PT1H". Matches name="time"
 *  exactly — name="reference_time" cannot false-match the pattern. */
export function extractTimeDimension(xml: string): string | null {
  const m = xml.match(/<Dimension[^>]*name="time"[^>]*>([^<]+)<\/Dimension>/);
  return m?.[1]?.trim() ?? null;
}

/** Expand an ISO-8601 start/end/PTnH interval (or a bare timestamp) into
 *  epoch-ms frames. Malformed or non-hourly input yields []. Capped at 768
 *  frames (32 days hourly) so a bad range can't allocate unbounded. */
export function parseTimeDimension(dimension: string): number[] {
  const parts = dimension.split('/');
  if (parts.length === 1) {
    const t = Date.parse(parts[0]!);
    return Number.isFinite(t) ? [t] : [];
  }
  if (parts.length !== 3) return [];
  const start = Date.parse(parts[0]!);
  const end = Date.parse(parts[1]!);
  const period = parts[2]!.match(/^PT(\d+)H$/);
  const stepMs = period ? Number(period[1]) * HOUR_MS : 0;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || stepMs <= 0) return [];
  const frames: number[] = [];
  for (let t = start; t <= end && frames.length < 768; t += stepMs) frames.push(t);
  return frames;
}

export async function fetchSmokeForecastFrames(): Promise<SmokeForecastState> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache;
  try {
    const res = await fetch(CAPS_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`GeoMet HTTP ${String(res.status)}`);
    const dimension = extractTimeDimension(await res.text());
    const frames = dimension ? parseTimeDimension(dimension) : [];
    if (frames.length === 0) throw new Error('GeoMet capabilities missing time dimension');
    cache = { frames, fetchedAt: Date.now() };
    dataFreshness.recordUpdate('firework-smoke', frames.length);
    return cache;
  } catch (error) {
    dataFreshness.recordError('firework-smoke', String(error));
    throw error;
  }
}

/** Frames from the hour containing `nowMs` onward — the scrubber's hour 0
 *  must be "now", not the model-run start (which is up to 12 h in the past). */
export function smokeForecastHoursFromNow(state: SmokeForecastState, nowMs = Date.now()): number[] {
  const floorHour = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  return state.frames.filter((t) => t >= floorHour);
}

function isoHour(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * MapLibre raster-tile GetMap template. With a target time, TIME pins to the
 * nearest available frame; with no state/target, TIME is omitted and GeoMet
 * serves its default (nearest current hour) — the layer stays functional
 * when the capabilities fetch fails (fail-open display, freshness records
 * the error separately).
 */
export function getSmokeForecastTileUrl(state: SmokeForecastState | null, targetMs?: number): string {
  const base = `${FIREWORK_WMS_BASE}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap`
    + '&BBOX={bbox-epsg-3857}&CRS=EPSG:3857&WIDTH=256&HEIGHT=256'
    + `&LAYERS=${FIREWORK_LAYER}&STYLES=&FORMAT=image/png&TRANSPARENT=TRUE`;
  if (!state || state.frames.length === 0 || targetMs === undefined) return base;
  let nearest = state.frames[0]!;
  for (const t of state.frames) {
    if (Math.abs(t - targetMs) < Math.abs(nearest - targetMs)) nearest = t;
  }
  return `${base}&TIME=${isoHour(nearest)}`;
}
```

Note: `dataFreshness` is safe to import under `tsx --test` (existing tests import it directly). The `'firework-smoke'` id doesn't exist yet — Task 4 adds it; until then this file won't typecheck, which is fine because tests run via tsx (no typecheck) and `typecheck:all` runs after Task 4. If you prefer green typecheck per-commit, do Task 4's `data-freshness.ts` edit in this task's commit instead.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx tsx --test src/services/__tests__/firework-smoke.test.mts
```

Expected: 9 tests pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/services/firework-smoke.ts src/services/__tests__/firework-smoke.test.mts
git commit -m "feat(smoke): FireWork WMS forecast service — GeoMet time-dimension frames + tile template"
```

### Task 2: `smokeForecast` MapLayers key + defaults + survival mode

**Files:**
- Modify: `src/types/index.ts:608-616` (MapLayers weather block)
- Modify: `src/config/panels.ts` (8 literals), `src/config/variants/full.ts`, `tech.ts`, `finance.ts`, `happy.ts` (2 literals each) — typecheck-enumerated
- Modify: `src/services/survival/map-modes.ts:30-36`

- [ ] **Step 1: Add the key to the interface**

In `src/types/index.ts`, after `weatherSatellite: boolean;`:

```ts
  weatherRadar: boolean;
  weatherSatellite: boolean;
  // ECCC FireWork 72 h wildfire-smoke PM2.5 forecast raster (GeoMet WMS)
  smokeForecast: boolean;
  lightning: boolean;
```

- [ ] **Step 2: Let the typechecker enumerate every literal**

```bash
npm run typecheck:all 2>&1 | grep -c 'smokeForecast'
```

Expected: ~16 errors, all "Property 'smokeForecast' is missing" — in `src/config/panels.ts` (FULL/FULL_MOBILE/TECH/TECH_MOBILE/FINANCE/FINANCE_MOBILE/HAPPY/HAPPY_MOBILE at lines ~426/512/636/719/839/922/1021/1104) and `src/config/variants/{full,tech,finance,happy}.ts` (2 each). Fix EVERY listed literal by adding, next to its `weatherSatellite: false,` line:

```ts
  smokeForecast: false,
```

(Default off everywhere — opt-in overlay, decision #4.)

- [ ] **Step 3: Add to the physical-safety survival mode**

In `src/services/survival/map-modes.ts`, the `physical_safety` layers array — after `'airSmoke',`:

```ts
      'airSmoke', 'smokeForecast', 'natural', 'climate', 'forecastOverlay'],
```

- [ ] **Step 4: Verify typecheck is clean**

```bash
npm run typecheck:all
```

Expected: zero errors (the service file still references the not-yet-added `'firework-smoke'` freshness id — if this step errors ONLY on that, pull Task 4 Step 1 forward into this commit).

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/config/panels.ts src/config/variants/full.ts src/config/variants/tech.ts src/config/variants/finance.ts src/config/variants/happy.ts src/services/survival/map-modes.ts
git commit -m "feat(smoke): smokeForecast map-layer key (off by default in all variants)"
```

### Task 3: DeckGLMap wiring — raster layer, chip, scrubber generalization

**Files:**
- Modify: `src/components/DeckGLMap.ts` (six spots, anchors in the table above)

- [ ] **Step 1: Import the service** (next to the rainviewer import at ~line 133)

```ts
import { getSmokeForecastTileUrl, smokeForecastHoursFromNow, type SmokeForecastState } from '@/services/firework-smoke';
```

- [ ] **Step 2: Add state fields** (next to `private radarState` at ~line 639)

```ts
  private fireworkState: SmokeForecastState | null = null;
  private fireworkAppliedUrl: string | null = null;
```

- [ ] **Step 3: Add the public setter** (next to `setRadarState` at ~line 6785)

```ts
  public setFireworkForecast(state: SmokeForecastState): void {
    this.fireworkState = state;
    this.updateLayers();
  }
```

- [ ] **Step 4: Generalize the scrubber's hours source**

Add this private helper near `syncSmokeScrubber` (~line 2527):

```ts
  /** Hours driving the map's smoke scrubber: the per-place Open-Meteo field
   *  when loaded, else the FireWork frame times (from the current hour on)
   *  when the WMS overlay is enabled — the scrubber works with either. */
  private smokeScrubberHours(): number[] | null {
    const field = this.smokeForecastField;
    if (field && field.hoursMs.length > 0) return field.hoursMs;
    if (this.state.layers.smokeForecast && this.fireworkState) {
      const hours = smokeForecastHoursFromNow(this.fireworkState);
      if (hours.length > 0) return hours;
    }
    return null;
  }
```

Then rework the two consumers to read hours instead of the field directly.
`syncSmokeScrubber` — replace its first lines:

```ts
  private syncSmokeScrubber(show: boolean): void {
    const hours = this.smokeScrubberHours();
    if (!show || !hours) {
```

(teardown body unchanged) and replace the `field.hoursMs` slider-sync block at the end:

```ts
    if (this.smokeScrubberInput) {
      this.smokeScrubberInput.max = String(hours.length - 1);
      this.smokeScrubberInput.value = String(Math.min(this.smokeForecastHourIdx, hours.length - 1));
    }
    this.updateSmokeScrubberLabel();
```

`updateSmokeScrubberLabel` — full replacement (same "Now" honesty rule, hours-agnostic):

```ts
  private updateSmokeScrubberLabel(): void {
    const hours = this.smokeScrubberHours();
    if (!hours || !this.smokeScrubberLabel) return;
    const idx = Math.min(this.smokeForecastHourIdx, hours.length - 1);
    // "Now" only while hour 0 actually covers the present — a stale frame
    // must not claim to be current.
    const hourIsNow = idx === 0 && Math.abs(hours[0]! - Date.now()) < 90 * 60 * 1000;
    this.smokeScrubberLabel.textContent = hourIsNow
      ? 'Now'
      : `+${idx}h · ${new Date(hours[idx]!).toLocaleString([], { weekday: 'short', hour: 'numeric' })}`;
  }
```

- [ ] **Step 5: Show the scrubber for either layer** (~line 1528)

```ts
    this.syncSmokeScrubber(mapLayers.airSmoke || mapLayers.smokeForecast);
```

- [ ] **Step 6: Render the raster in `syncWeatherRasterLayers`**

After the OWM block (~line 6691), before the method's closing brace — mirrors the satellite rebuild-on-URL-change pattern because the TIME param changes on every scrub/refresh:

```ts
    // ECCC FireWork smoke forecast (GeoMet WMS) — TIME follows the scrubber.
    const fwHours = this.smokeScrubberHours();
    const fwIdx = fwHours ? Math.min(this.smokeForecastHourIdx, fwHours.length - 1) : 0;
    const fwUrl = getSmokeForecastTileUrl(this.fireworkState, fwHours ? fwHours[fwIdx] : undefined);
    if (ml.smokeForecast
        && this.fireworkAppliedUrl !== null
        && this.fireworkAppliedUrl !== fwUrl) {
      if (map.getLayer('wm-firework-layer')) map.removeLayer('wm-firework-layer');
      if (map.getSource('wm-firework-src')) map.removeSource('wm-firework-src');
    }
    this.syncRasterTileLayer(map, 'wm-firework', ml.smokeForecast, () => [fwUrl], 0.55);
    if (ml.smokeForecast) this.fireworkAppliedUrl = fwUrl;
```

(The scrubber's `input` handler already calls `this.updateLayers()`, which calls `syncWeatherRasterLayers()` — scrubbing animates the raster with no extra wiring.)

- [ ] **Step 7: Add the layer chip** (full-variant list only, after the `airSmoke` entry at ~line 4628)

```ts
    { key: 'airSmoke', label: 'Air & Smoke', icon: '💨' },
    { key: 'smokeForecast', label: 'Smoke Forecast (72h)', icon: '&#127787;' },
```

- [ ] **Step 8: Typecheck**

```bash
npm run typecheck:all
```

Expected: zero errors (or only the `'firework-smoke'` freshness-id error if Task 4 wasn't pulled forward).

- [ ] **Step 9: Commit**

```bash
git add src/components/DeckGLMap.ts
git commit -m "feat(smoke): FireWork WMS raster on the 2D map — scrubber drives the TIME dimension"
```

### Task 4: data-loader task + freshness id

**Files:**
- Modify: `src/services/data-freshness.ts:70,248` (union + metadata)
- Modify: `src/app/data-loader.ts:285,752,4136` (import, task, loader)

- [ ] **Step 1: Register the freshness source**

In the `DataSourceId` union (next to `| "rainviewer-radar"` at ~line 70):

```ts
    | "firework-smoke"
```

In `SOURCE_METADATA` (next to the `"rainviewer-radar"` entry at ~line 248):

```ts
  "firework-smoke": { name: "FireWork Smoke Forecast", requiredForRisk: false },
```

- [ ] **Step 2: Add the loader to data-loader.ts**

Import (next to the rainviewer import at ~line 285):

```ts
import { fetchSmokeForecastFrames } from '@/services/firework-smoke';
```

Method (next to `loadWeatherRadar` at ~line 4136):

```ts
  async loadSmokeForecast(): Promise<void> {
    try {
      const state = await fetchSmokeForecastFrames();
      this.ctx.map?.setFireworkForecast(state);
    } catch (error) {
      // Fail-open: the map layer renders GeoMet's default TIME without
      // frames; the service already recorded the freshness error.
      console.warn('[smoke-forecast] frames fetch failed', error);
    }
  }
```

Task registration (next to the `weatherRadar` task at ~line 752):

```ts
    if (SITE_VARIANT === 'full') tasks.push({ name: 'smokeForecast', task: () => runGuarded('smokeForecast', () => this.loadSmokeForecast()) });
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck:all
```

Expected: zero errors, including the service's `'firework-smoke'` reference.

- [ ] **Step 4: Commit**

```bash
git add src/services/data-freshness.ts src/app/data-loader.ts
git commit -m "feat(smoke): FireWork frames loader task + firework-smoke freshness source"
```

### Task 5: God's Eye globe layer

**Files:**
- Modify: `src/config/gods-vision-layers.ts:266` (after `weatherSatellite` entry)
- Modify: `src/components/GlobeDataManager.ts:21,610,691,2508`

- [ ] **Step 1: Register the layer config**

In `gods-vision-layers.ts`, after the `weatherSatellite` entry:

```ts
  smokeForecast: {
    name: 'Smoke Forecast',
    category: 'intelligence',
    enabled: false,
    description: 'ECCC FireWork 72 h wildfire-smoke PM2.5 forecast (WMS)',
  },
```

- [ ] **Step 2: Add the Cesium WMS loader**

In `GlobeDataManager.ts` — add `WebMapServiceImageryProvider` to the existing `cesium` import block (line ~21, alongside `UrlTemplateImageryProvider`).

In the LOD record (~line 610), after `weatherSatellite: 15_000_000,`:

```ts
  smokeForecast: 15_000_000,
```

In the weather `registerLayer` block (~line 691), after the `weatherSatellite` registration:

```ts
    this.registerLayer('smokeForecast', () => this.loadSmokeForecastWms());
```

Next to `loadWeatherSatellite` (~line 2508):

```ts
  private loadSmokeForecastWms(): void {
    try {
      // Server-default TIME (nearest current hour) — the globe is the
      // ambient view; scrubbing lives on the 2D map.
      const provider = new WebMapServiceImageryProvider({
        url: 'https://geo.weather.gc.ca/geomet',
        layers: 'RAQDPS.Sfc_PM2.5-WildfireSmokePlume',
        parameters: { format: 'image/png', transparent: true },
      });
      const imgLayer = this.viewer.imageryLayers.addImageryProvider(provider);
      imgLayer.alpha = 0.55;
      this.weatherImageryLayers.push(imgLayer);
    } catch { /* smoke forecast unavailable — other weather layers unaffected */ }
  }
```

(`weatherImageryLayers` is already torn down wholesale at ~line 3157 — no extra cleanup needed.)

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck:all
git add src/config/gods-vision-layers.ts src/components/GlobeDataManager.ts
git commit -m "feat(smoke): FireWork WMS layer on the God's Eye globe"
```

### Task 6: CSP allowlist

MapLibre and Cesium fetch raster tiles via `fetch`/XHR — the host must be in **connect-src** (img-src's blanket `https:` does not cover it). Both CSP copies must change.

**Files:**
- Modify: `src-tauri/tauri.conf.json:16`
- Modify: `index.html:7`

- [ ] **Step 1: Add the host to both CSPs**

In BOTH files' connect-src, insert `https://geo.weather.gc.ca ` immediately before `https://gibs.earthdata.nasa.gov` (the list is roughly alphabetical):

```text
... https://gamma-api.polymarket.com https://geo.weather.gc.ca https://gibs.earthdata.nasa.gov ...
```

- [ ] **Step 2: Verify both copies changed**

```bash
grep -c 'geo\.weather\.gc\.ca' src-tauri/tauri.conf.json index.html
```

Expected: `1` for each file.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/tauri.conf.json index.html
git commit -m "security(csp): allow geo.weather.gc.ca (FireWork WMS tiles) in connect-src"
```

### Task 7: Full verification

- [ ] **Step 1: Typecheck both configs**

```bash
npm run typecheck:all
```

Expected: zero errors.

- [ ] **Step 2: New unit tests + the neighboring service suites**

```bash
npx tsx --test src/services/__tests__/firework-smoke.test.mts src/services/__tests__/satellite-weather.test.mts
```

Expected: all pass. (Full `npm run test:renderer` is ~11 650 tests and CPU-slow — leave it to CI unless suspicious.)

- [ ] **Step 3: Docs freshness + secret scan**

```bash
npm run docs:check
npm run secrets:scan
```

Expected: both clean (no panel-count changes were made).

- [ ] **Step 4 (recommended): Live eyeball via dev server**

Start the `dev` server (vite, web-only) through the Browser-pane preview tooling, then on the map: open the Layers control → enable **Smoke Forecast (72h)** → confirm the PM2.5 raster renders over North America and the `💨 Forecast` scrubber appears (bottom-center); drag the scrubber → network tab shows GetMap requests with stepping `TIME=` values. Also enable **Air & Smoke** together and confirm the scrubber still drives both. Check the console for CSP violations (there must be none).

### Task 8: PR + Codex cross-agent review

- [ ] **Step 1: Rebase and push**

```bash
cd ~/Developer/crystalball/.worktrees/firework-smoke
git fetch origin && git rebase origin/main
npm run typecheck:all
git push origin claude/firework-smoke-wms
```

(`panels.ts` is a conflict magnet — if the rebase conflicts there, re-apply the one-line `smokeForecast: false,` additions per literal.)

- [ ] **Step 2: Run a REAL Codex review (never self-attest)**

```bash
git diff origin/main...HEAD > "$TMPDIR/firework-pr.diff"
codex exec --sandbox read-only "Review this Crystal Ball PR diff (FireWork WMS smoke-forecast overlay). Look for: MapLibre/Cesium API misuse, scrubber regression for the existing Open-Meteo airSmoke field, CSP completeness (connect-src in BOTH tauri.conf.json and index.html), fail-open correctness when the capabilities fetch fails, and unbounded-loop/allocation risks in the ISO-interval parser. Report P0/P1/P2 findings." < "$TMPDIR/firework-pr.diff"
```

Fix any P0/P1 findings, commit, re-push. (If `codex` is broken this session, re-verify with `codex --version` first; the read-only sandbox avoids the false-conflict failure mode.)

- [ ] **Step 3: Open the PR with the cross-agent marker in the body at creation**

The marker must be contiguous — `cross-agent review: Codex` with no formatting between the colon and the name — and must reflect the review that actually ran (include its verdict summary honestly).

```bash
gh pr create --title "FireWork WMS smoke-forecast overlay (72 h predictive smoke raster)" --body "$(cat <<'EOF'
Adds the ECCC FireWork (RAQDPS-FW) surface-PM2.5 wildfire-smoke forecast as a keyless WMS raster overlay: MapLibre raster source with the {bbox-epsg-3857} GetMap template on the 2D map, WebMapServiceImageryProvider on the God's Eye globe, and the existing smoke scrubber generalized to drive the WMS TIME dimension (72 h hourly, 2 runs/day).

- New service src/services/firework-smoke.ts (capabilities time-dimension parse + tile template, fail-open to server-default TIME) + 9 unit tests
- New MapLayers key smokeForecast (off by default, full-variant chip)
- firework-smoke data-freshness source; loader task in data-loader
- CSP: geo.weather.gc.ca added to connect-src in tauri.conf.json + index.html

Plan: docs/superpowers/plans/2026-07-29-firework-smoke-wms-overlay.md

cross-agent review: Codex — <one-line honest summary of the Codex verdict and what was fixed>
EOF
)"
```

- [ ] **Step 4: Arm auto-merge yourself (the bot cascade is stalled)**

```bash
gh pr merge --auto --squash
```

- [ ] **Step 5: After merge, verify the squash actually contains the branch tip**

```bash
git fetch origin && git log origin/main --oneline -3
git diff origin/main claude/firework-smoke-wms --stat
```

Expected: empty diff (no straggler commits). If not empty, ship the stragglers in a follow-up PR.

---

## Self-review notes

- **Spec coverage:** predictive raster on 2D map (Task 3), globe (Task 5), time-slider animation via WMS TIME (Task 3 Steps 4-6), keyless/zero-processing (service), fail-open + freshness honesty (Tasks 1/4), CSP (Task 6).
- **Out of scope (deliberate):** panel for the overlay (reuses map scrubber), scrubbing on the globe, AQHI observation layers, FireWork raw Datamart fields, the catalog's items 2-6.
- **Type consistency check:** `SmokeForecastState { frames: number[]; fetchedAt: number }` is used identically in Tasks 1/3/4; `setFireworkForecast` (Task 3 Step 3) is what Task 4's loader calls; `smokeForecastHoursFromNow(state, nowMs?)` signature matches both call sites.
