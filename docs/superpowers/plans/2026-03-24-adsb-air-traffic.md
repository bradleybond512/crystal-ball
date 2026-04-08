# ADS-B Air Traffic Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live ADS-B aircraft tracking to Crystal Ball — a new `adsb` DeckGL globe layer showing all airborne aircraft as altitude-colored dots, and a new `Air Traffic` sidebar panel with global stats and notable flights.

**Architecture:** A new inline sidecar route `/api/adsb` proxies OpenSky Network with a 55s in-process cache. A new `src/services/adsb.ts` service parses state vectors with a 60s client-side cache and circuit breaker. The `AirTrafficPanel` and `DeckGLMap.createAdsbLayer()` both consume this service. The `data-loader.loadAdsb()` method drives the globe layer; the panel refreshes its own data via `fetchData()`.

**Tech Stack:** TypeScript, OpenSky Network REST API, DeckGL `ScatterplotLayer`, existing `createCircuitBreaker` utility, `Panel` base class, Node.js sidecar `getCached`/`setCached` pattern.

---

**Spec:** `docs/superpowers/specs/2026-03-24-adsb-air-traffic-design.md`

---

## Chunk 1: Foundation — Types, Config, Data Freshness

**Files:**

- Modify: `src/types/index.ts:558` — add `adsb` to `MapLayers`
- Modify: `src/config/panels.ts` — add panel entry, 8× MapLayers, LAYER_TO_SOURCE, PANEL_CATEGORY_MAP
- Modify: `src/services/data-freshness.ts:42,111,373` — add `adsb` DataSourceId
- Modify: `src/utils/urlState.ts:48` — add `adsb` to LAYER_KEYS
- Modify: `src/config/commands.ts` — add `layer:adsb` command
- Modify: `src/e2e/map-harness.ts` — add `adsb: false` to base MapLayers objects
- Modify: `src/e2e/mobile-map-integration-harness.ts` — add `adsb: false`

---

- [ ] **Step 1.1 — Add `adsb` to the `MapLayers` type**

In `src/types/index.ts`, add before the closing `}` of the `MapLayers` interface (currently line 559, after `dayNight: boolean;` at line 558):

```ts
  // ADS-B live aircraft tracking layer
  adsb: boolean;
```

---

- [ ] **Step 1.2 — Add `adsb` to all 8 `MapLayers` config objects**

In `src/config/panels.ts`, add `adsb: false,` to each of the 8 MapLayers objects. The anchor is `s2pimu: false,` — `adsb` goes after it (just before `dayNight: false,`):

- `FULL_MAP_LAYERS` (search for first `s2pimu: false`)
- `FULL_MOBILE_MAP_LAYERS`
- `TECH_MAP_LAYERS`
- `TECH_MOBILE_MAP_LAYERS`
- `FINANCE_MAP_LAYERS`
- `FINANCE_MOBILE_MAP_LAYERS`
- `HAPPY_MAP_LAYERS`
- `HAPPY_MOBILE_MAP_LAYERS`

In each object, the insertion looks like:

```ts
  s2pimu: false,
  adsb: false,
  dayNight: false,
```

All 8 must have `adsb: false` — TypeScript will error if any are missing.

---

- [ ] **Step 1.3 — Add `air-traffic` panel and layer wiring to `panels.ts`**

**Note:** Steps 1.3 and 1.4 must be completed before running typecheck — `LAYER_TO_SOURCE` values are typed as `DataSourceId[]`, so adding `'adsb'` there (step 1.3) will fail until `DataSourceId` is extended (step 1.4). Do both before running `npm run typecheck:all`.

In `src/config/panels.ts`:

1. Add to `FULL_PANELS` (after `'fuel-prices'`):

```ts
  'air-traffic': { name: 'Air Traffic', enabled: true, priority: 2 },
```

1. Add to `LAYER_TO_SOURCE` (after existing entries):

```ts
  adsb: ['adsb'],
```

1. Add `'air-traffic'` to `PANEL_CATEGORY_MAP.dataTracking.panelKeys` array (after `'population-exposure'`):

```ts
panelKeys: ['monitors', 'cyber-threats', 'comms-health', 'ucdp-events', 'airstrikes', 'displacement', 'security-advisories', 'oref-sirens', 'space-weather', 'population-exposure', 'air-traffic'],
```

---

- [ ] **Step 1.4 — Add `adsb` to `DataSourceId` union and metadata**

In `src/services/data-freshness.ts`:

1. Add to `DataSourceId` union (after `'s2_underground'` at line 42):

```ts
  | 'adsb'; // ADS-B live aircraft tracking
```

(Remove the `;` from `'s2_underground'` and add it to `'adsb'`.)

1. Add to `SOURCE_METADATA` (after `s2_underground` entry at line 111):

```ts
  adsb: { name: 'ADS-B Aircraft', requiredForRisk: false, panelId: 'air-traffic' },
```

1. Add to `INTELLIGENCE_GAP_MESSAGES` (after `s2_underground` entry at line 373):

```ts
  adsb: 'Live aircraft positions unavailable—ADS-B tracking offline',
```

---

- [ ] **Step 1.5 — Add `adsb` to urlState LAYER_KEYS**

In `src/utils/urlState.ts`, add `'adsb',` to the `LAYER_KEYS` array after `'gpsJamming'` (line 48):

```ts
  'gpsJamming',
  'adsb',
  'dayNight',
```

---

- [ ] **Step 1.6 — Add `layer:adsb` command**

In `src/config/commands.ts`, add after the existing `layer:ais` entry:

```ts
  { id: 'layer:adsb', keywords: ['adsb', 'aircraft', 'planes', 'air traffic', 'live flights'], label: 'Toggle ADS-B aircraft', icon: '✈️', category: 'layers' },
```

---

- [ ] **Step 1.7 — Add `adsb: false` to e2e test harnesses**

In `src/e2e/map-harness.ts`, add `adsb: false,` to each `MapLayers` literal object in the file (TypeScript will flag the missing key once the type is updated — search for `gpsJamming: false` or `dayNight: false` to find all occurrences).

In `src/e2e/mobile-map-integration-harness.ts`, do the same.

---

- [ ] **Step 1.8 — Verify TypeScript compiles cleanly**

```bash
npm run typecheck:all
```

Expected: zero errors. Fix any type errors before proceeding.

---

- [ ] **Step 1.9 — Commit**

```bash
git add src/types/index.ts src/config/panels.ts src/services/data-freshness.ts \
  src/utils/urlState.ts src/config/commands.ts \
  src/e2e/map-harness.ts src/e2e/mobile-map-integration-harness.ts
git commit -m "feat(adsb): add MapLayers type, config, and data freshness scaffolding

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Chunk 2: Sidecar Route `/api/adsb`

**Files:**

- Modify: `src-tauri/sidecar/local-api-server.mjs` — add inline `/api/adsb` route

---

- [ ] **Step 2.1 — Add the `/api/adsb` inline route to the sidecar**

In `src-tauri/sidecar/local-api-server.mjs`, add the following block **after** the existing `/api/fuel-prices` block (around line 2630):

```js
  // ── ADS-B live aircraft tracking (OpenSky Network, no key required) ──────
  if (requestUrl.pathname === '/api/adsb') {
 const CACHE_TTL = 55 * 1000; // 55s — OpenSky anon rate limit is 10s/req
 const cached = getCached('adsb', CACHE_TTL);
 if (cached) return json(cached);

 const clientId = process.env.OPENSKY_CLIENT_ID?.trim() || '';
 const clientSecret = process.env.OPENSKY_CLIENT_SECRET?.trim() || '';
 const headers = { 'User-Agent': CHROME_UA };
 if (clientId && clientSecret) {
 const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
 headers['Authorization'] = `Basic ${creds}`;
 }

 try {
 const res = await fetchWithTimeout(
 'https://opensky-network.org/api/states/all',
 { headers },
 12_000
 );
 if (res.status === 429) {
 return new Response(JSON.stringify({ states: null, time: Math.floor(Date.now() / 1000), rateLimited: true }), {
 status: 429, headers: { 'Content-Type': 'application/json' },
 });
 }
 if (!res.ok) throw new Error(`OpenSky HTTP ${res.status}`);
 const data = await res.json();
 setCached('adsb', data);
 return json(data);
 } catch (error) {
 return json({ states: null, time: Math.floor(Date.now() / 1000), error: error?.message ?? 'unknown' });
 }
  }
```

**Notes:**

- `getCached`/`setCached` and `fetchWithTimeout`/`CHROME_UA`/`json` are all available in the inline sidecar scope — no imports needed.
- `Buffer` is available in Node.js without import.
- The `json()` helper returns a `Response` with `Content-Type: application/json`.

---

- [ ] **Step 2.2 — Smoke test the sidecar route manually**

Start the dev server and hit the route:

```bash
curl -s http://127.0.0.1:46123/api/adsb | head -c 500
```

Expected: JSON with `{ "time": <unix>, "states": [[...], ...] }` or `{ "states": null, "rateLimited": true }` if OpenSky is temporarily unavailable.

---

- [ ] **Step 2.3 — Commit**

```bash
git add src-tauri/sidecar/local-api-server.mjs
git commit -m "feat(adsb): add /api/adsb sidecar proxy route with 55s cache

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Chunk 3: `src/services/adsb.ts`

**Files:**

- Create: `src/services/adsb.ts`

---

- [ ] **Step 3.1 — Create `src/services/adsb.ts`**

```ts
import { createCircuitBreaker } from '@/utils';
import { dataFreshness } from './data-freshness';
import { getApiBaseUrl } from './runtime';

export interface AdsbFlight {
  icao24: string;
  callsign: string | null;
  originCountry: string;
  lon: number;
  lat: number;
  altitude: number | null; // barometric, meters
  onGround: boolean;
  velocity: number | null; // m/s
  heading: number | null; // true track, degrees
  verticalRate: number | null; // m/s, positive = climbing
  squawk: string | null;
}

export interface AdsbSnapshot {
  flights: AdsbFlight[]; // airborne only (onGround === false)
  fetchedAt: number;
  totalCount: number; // all states including on-ground, before filtering
  rateLimited: boolean;
}

export interface AdsbStats {
  topCountries: { country: string; count: number }[];
  notableFlights: AdsbFlight[];
}

// OpenSky state vector index constants (avoids magic numbers)
const IDX = {
  ICAO24: 0, CALLSIGN: 1, ORIGIN_COUNTRY: 2, TIME_POS: 3, LAST_CONTACT: 4,
  LON: 5, LAT: 6, BARO_ALT: 7, ON_GROUND: 8, VELOCITY: 9,
  TRUE_TRACK: 10, VERT_RATE: 11, SENSORS: 12, GEO_ALT: 13,
  SQUAWK: 14, SPI: 15, POS_SOURCE: 16,
} as const;

const EMERGENCY_SQUAWKS = new Set(['7500', '7600', '7700']);
const NOTABLE_CALLSIGN_PREFIXES = ['AF1', 'SAM', 'EXEC', 'VIP', 'RCH', 'REACH'];
const NOTABLE_ALT_METERS = 12_192; // ~40,000 ft

const breaker = createCircuitBreaker<AdsbSnapshot>({
  name: 'ADS-B',
  maxFailures: 3,
  cooldownMs: 5 * 60 * 1000,
});

let _cache: { snapshot: AdsbSnapshot; ts: number } | null = null;
const CLIENT_CACHE_TTL = 60 * 1000;

function parseStates(states: unknown[][]): AdsbFlight[] {
  const flights: AdsbFlight[] = [];
  for (const s of states) {
 const lon = s[IDX.LON] as number | null;
 const lat = s[IDX.LAT] as number | null;
 if (lon == null || lat == null) continue;
 if (s[IDX.ON_GROUND] === true) continue;

 flights.push({
 icao24: String(s[IDX.ICAO24] ?? ''),
 callsign: s[IDX.CALLSIGN] ? String(s[IDX.CALLSIGN]).trim() || null : null,
 originCountry: String(s[IDX.ORIGIN_COUNTRY] ?? 'Unknown'),
 lon,
 lat,
 altitude: (s[IDX.BARO_ALT] as number | null) ?? null,
 onGround: false,
 velocity: (s[IDX.VELOCITY] as number | null) ?? null,
 heading: (s[IDX.TRUE_TRACK] as number | null) ?? null,
 verticalRate: (s[IDX.VERT_RATE] as number | null) ?? null,
 squawk: s[IDX.SQUAWK] ? String(s[IDX.SQUAWK]) : null,
 });
  }
  return flights;
}

export async function fetchAdsbSnapshot(): Promise<AdsbSnapshot> {
  const now = Date.now();
  if (_cache && now - _cache.ts < CLIENT_CACHE_TTL) return _cache.snapshot;

  return breaker.execute(async () => {
 const res = await fetch(`${getApiBaseUrl()}/api/adsb`);
 if (res.status === 429) {
 const snapshot: AdsbSnapshot = { flights: [], fetchedAt: Date.now(), totalCount: 0, rateLimited: true };
 return snapshot;
 }
 if (!res.ok) throw new Error(`HTTP ${res.status}`);

 const data = await res.json() as { states: unknown[][] | null; time: number; rateLimited?: boolean };
 const states = data.states ?? [];
 const flights = parseStates(states);
 const snapshot: AdsbSnapshot = {
 flights,
 fetchedAt: now,
 totalCount: states.length,
 rateLimited: data.rateLimited ?? false,
 };

 _cache = { snapshot, ts: now };
 dataFreshness.recordUpdate('adsb', snapshot.flights.length);
 return snapshot;
  }, _cache?.snapshot ?? { flights: [], fetchedAt: 0, totalCount: 0, rateLimited: false });
}

export function getAdsbStats(snapshot: AdsbSnapshot): AdsbStats {
  const countryCounts = new Map<string, number>();
  const notableFlights: AdsbFlight[] = [];

  for (const f of snapshot.flights) {
 countryCounts.set(f.originCountry, (countryCounts.get(f.originCountry) ?? 0) + 1);

 const isEmergency = f.squawk !== null && EMERGENCY_SQUAWKS.has(f.squawk);
 const isHighAlt = f.altitude !== null && f.altitude > NOTABLE_ALT_METERS;
 const callsignUpper = (f.callsign ?? '').toUpperCase();
 const isNotableCallsign = NOTABLE_CALLSIGN_PREFIXES.some(p => callsignUpper.startsWith(p));

 if ((isEmergency || isHighAlt || isNotableCallsign) && notableFlights.length < 8) {
 notableFlights.push(f);
 }
  }

  const topCountries = Array.from(countryCounts.entries())
 .sort((a, b) => b[1] - a[1])
 .slice(0, 5)
 .map(([country, count]) => ({ country, count }));

  return { topCountries, notableFlights };
}
```

---

- [ ] **Step 3.2 — Verify TypeScript compiles**

```bash
npm run typecheck:all
```

Expected: zero errors.

---

- [ ] **Step 3.3 — Commit**

```bash
git add src/services/adsb.ts
git commit -m "feat(adsb): add adsb service with OpenSky parsing, cache, and circuit breaker

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Chunk 4: `AirTrafficPanel` + Panel-Wiring Test

**Files:**

- Create: `src/components/AirTrafficPanel.ts`
- Modify: `tests/panel-wiring.test.mjs` — add air-traffic assertions

---

- [ ] **Step 4.1 — Write the failing panel-wiring test first (TDD)**

Add to `tests/panel-wiring.test.mjs`:

```js
test('air-traffic panel is registered, instantiated, and refreshed', () => {
  const panelsConfig = readRepoFile('src/config/panels.ts');
  const panelLayout = readRepoFile('src/app/panel-layout.ts');
  const dataLoader = readRepoFile('src/app/data-loader.ts');
  const appSource = readRepoFile('src/App.ts');

  assert.match(panelsConfig, /'air-traffic': \{/);
  assert.match(panelLayout, /new AirTrafficPanel\(\)/);
  assert.match(panelLayout, /this\.ctx\.panels\['air-traffic'\]/);
  assert.match(dataLoader, /fetchAdsbSnapshot/);
  assert.match(dataLoader, /loadAdsb\(\)/);
  assert.match(dataLoader, /panels\['air-traffic'\]/);
  assert.match(appSource, /this\.dataLoader\.loadAdsb\(\)/);
});
```

---

- [ ] **Step 4.2 — Run the test to confirm it fails**

```bash
node --test tests/panel-wiring.test.mjs
```

Expected: the new test fails (`AssertionError: Expected values to match`). The existing tests should still pass.

---

- [ ] **Step 4.3 — Create `src/components/AirTrafficPanel.ts`**

```ts
import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { fetchAdsbSnapshot, getAdsbStats } from '@/services/adsb';
import type { AdsbSnapshot } from '@/services/adsb';

function metersToFeet(m: number): number {
  return Math.round(m * 3.281);
}

function msToKnots(ms: number): number {
  return Math.round(ms * 1.944);
}

function squawkLabel(squawk: string): string {
  if (squawk === '7700') return 'EMERGENCY';
  if (squawk === '7600') return 'RADIO FAIL';
  if (squawk === '7500') return 'HIJACK';
  return squawk;
}

export class AirTrafficPanel extends Panel {
  private snapshot: AdsbSnapshot | null = null;
  private loading = true;
  private error: string | null = null;

  constructor() {
 super({
 id: 'air-traffic',
 title: 'Air Traffic',
 showCount: true,
 infoTooltip: 'Live aircraft positions worldwide from OpenSky Network. Updates every 60 seconds. No API key required; add OpenSky credentials in Settings for higher rate limits.',
 });
 void this.fetchData();
  }

  public async fetchData(): Promise<void> {
 this.loading = true;
 this.error = null;
 this.showLoading('Loading air traffic…');

 try {
 this.snapshot = await fetchAdsbSnapshot();
 this.error = null;
 } catch (err) {
 if (this.isAbortError(err)) return;
 this.error = err instanceof Error ? err.message : 'Failed to fetch';
 }

 this.loading = false;
 this.renderPanel();
  }

  public update(snapshot: AdsbSnapshot): void {
 this.snapshot = snapshot;
 this.loading = false;
 this.error = null;
 this.renderPanel();
  }

  private renderPanel(): void {
 if (this.loading) {
 this.showLoading('Loading air traffic…');
 return;
 }

 if (this.error || !this.snapshot) {
 this.showError(this.error ?? 'No data');
 return;
 }

 const { flights, totalCount, rateLimited, fetchedAt } = this.snapshot;
 const airborne = flights.length;
 const stats = getAdsbStats(this.snapshot);

 this.setCount(airborne);

 const ageSeconds = Math.round((Date.now() - fetchedAt) / 1000);
 const ageLabel = ageSeconds < 60 ? `${ageSeconds}s ago` : `${Math.round(ageSeconds / 60)}m ago`;

 const rateLimitedBanner = rateLimited
 ? `<div style="padding:6px 12px;background:rgba(255,180,0,0.1);border-left:3px solid #ffb400;margin-bottom:8px;font-size:11px;color:#ffb400;">OpenSky rate limited — data may be incomplete. Add credentials in Settings for higher limits.</div>`
 : '';

 const lowDataBanner = !rateLimited && totalCount < 1000
 ? `<div style="padding:6px 12px;background:rgba(255,180,0,0.1);border-left:3px solid #ffb400;margin-bottom:8px;font-size:11px;color:#ffb400;">Limited data: only ${totalCount.toLocaleString()} states returned. OpenSky may be rate limiting anonymous requests.</div>`
 : '';

 const countryRows = stats.topCountries.map(({ country, count }) => {
 const pct = airborne > 0 ? Math.round((count / airborne) * 100) : 0;
 return `
 <div style="display:flex;align-items:center;gap:8px;padding:4px 0;">
 <span style="flex:1;font-size:12px;color:var(--text-primary);">${escapeHtml(country)}</span>
 <div style="width:80px;height:4px;background:var(--bg-tertiary);border-radius:2px;overflow:hidden;">
 <div style="width:${pct}%;height:100%;background:var(--accent-primary);border-radius:2px;"></div>
 </div>
 <span style="width:36px;text-align:right;font-size:12px;color:var(--text-secondary);">${count.toLocaleString()}</span>
 </div>`;
 }).join('');

 const notableRows = stats.notableFlights.map(f => {
 const altFt = f.altitude != null ? `${metersToFeet(f.altitude).toLocaleString()} ft` : '—';
 const spdKt = f.velocity != null ? `${msToKnots(f.velocity)} kt` : '—';
 const badge = f.squawk && ['7700', '7600', '7500'].includes(f.squawk)
 ? `<span style="background:#ff3333;color:#fff;font-size:9px;padding:1px 4px;border-radius:3px;margin-left:4px;">${squawkLabel(f.squawk)}</span>`
 : '';
 return `
 <div style="display:flex;align-items:baseline;gap:6px;padding:3px 0;border-bottom:1px solid var(--border-subtle);">
 <span style="font-size:12px;font-weight:600;color:var(--text-primary);min-width:80px;">${escapeHtml(f.callsign ?? f.icao24)}${badge}</span>
 <span style="font-size:11px;color:var(--text-secondary);flex:1;">${escapeHtml(f.originCountry)}</span>
 <span style="font-size:11px;color:var(--text-muted);">${altFt}</span>
 <span style="font-size:11px;color:var(--text-muted);">${spdKt}</span>
 </div>`;
 }).join('');

 this.setContent(`
 ${rateLimitedBanner}${lowDataBanner}
 <div style="padding:12px;">
 <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px;">
 <span style="font-size:22px;font-weight:700;color:var(--text-primary);">${airborne.toLocaleString()}</span>
 <span style="font-size:11px;color:var(--text-muted);">airborne · updated ${escapeHtml(ageLabel)}</span>
 </div>

 ${stats.topCountries.length > 0 ? `
 <div style="margin-bottom:12px;">
 <div style="font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Top Countries</div>
 ${countryRows}
 </div>` : ''}

 ${stats.notableFlights.length > 0 ? `
 <div>
 <div style="font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Notable Flights</div>
 ${notableRows}
 </div>` : ''}
 </div>
 `);
  }
}
```

---

- [ ] **Step 4.4 — Verify TypeScript compiles**

```bash
npm run typecheck:all
```

Expected: zero errors.

---

- [ ] **Step 4.5 — Commit the panel**

```bash
git add src/components/AirTrafficPanel.ts tests/panel-wiring.test.mjs
git commit -m "feat(adsb): add AirTrafficPanel with stats, country breakdown, notable flights

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Chunk 5: DeckGLMap Layer + Locales

**Files:**

- Modify: `src/components/DeckGLMap.ts` — private field, `setAdsbFlights`, `createAdsbLayer`, tooltip, layer menu entry
- Modify: `src/locales/en.json` — add 2 i18n keys
- Modify: all 18 other locale files — add same keys (English fallback text)
- Modify: `src/e2e/map-harness.ts` — add `adsb` VisualScenario

---

- [ ] **Step 5.1 — Add private `adsbFlights` field to `DeckGLMap`**

In `src/components/DeckGLMap.ts`, add after the `aisDisruptions` field (line 339):

```ts
  private adsbFlights: import('@/services/adsb').AdsbFlight[] = [];
```

---

- [ ] **Step 5.2 — Add `setAdsbFlights` public method**

In `src/components/DeckGLMap.ts`, add after `setAisData` (after line 4274):

```ts
  public setAdsbFlights(flights: import('@/services/adsb').AdsbFlight[]): void {
 this.adsbFlights = flights;
 this.render();
  }
```

---

- [ ] **Step 5.3 — Add the ADS-B layer to `buildLayers()`**

In `src/components/DeckGLMap.ts`, add after the GPS jamming block (after line 1213):

```ts
 // ADS-B live aircraft layer
 if (mapLayers.adsb && this.adsbFlights.length > 0) {
 layers.push(this.createAdsbLayer());
 }
```

---

- [ ] **Step 5.4 — Add `createAdsbLayer()` private method**

In `src/components/DeckGLMap.ts`, add after `createAisDisruptionsLayer()` (after line ~1950):

```ts
  private createAdsbLayer(): ScatterplotLayer {
 return new ScatterplotLayer({
 id: 'adsb-layer',
 data: this.adsbFlights,
 getPosition: (d) => [d.lon, d.lat],
 getRadius: 25_000,
 radiusMinPixels: 2,
 radiusMaxPixels: 6,
 getFillColor: (d) => {
 // Emergency squawk: red
 if (d.squawk === '7700' || d.squawk === '7600' || d.squawk === '7500') {
 return [255, 50, 50, 255];
 }
 const alt = d.altitude ?? 0;
 if (alt < 3000) return [100, 200, 100, 180]; // green: low/approach
 if (alt < 10000) return [255, 200, 50, 180]; // amber: climb/descent
 return [200, 220, 255, 200]; // blue-white: cruise
 },
 pickable: true,
 updateTriggers: {
 getFillColor: [this.adsbFlights],
 },
 });
  }
```

---

- [ ] **Step 5.5 — Add tooltip case for `adsb-layer`**

In `src/components/DeckGLMap.ts`, in the `getTooltipForLayer` switch/method, add after the `ais-disruptions-layer` case (after line ~3099):

```ts
 case 'adsb-layer': {
 const altFt = obj.altitude != null ? `${Math.round(obj.altitude * 3.281).toLocaleString()} ft` : '—';
 const spdKt = obj.velocity != null ? `${Math.round(obj.velocity * 1.944)} kt` : '—';
 const callsign = obj.callsign || obj.icao24;
 return { html: `<div class="deckgl-tooltip"><strong>&#9992; ${text(callsign)}</strong><br/>${text(obj.originCountry)}<br/>${altFt} · ${spdKt}</div>` };
 }
```

---

- [ ] **Step 5.6 — Add `adsb-layer` to the layer-key→type map**

In `src/components/DeckGLMap.ts`, in the object that maps layer IDs to type strings (around line 3348), add:

```ts
 'adsb-layer': 'adsb',
```

---

- [ ] **Step 5.7 — Add `adsb` to the layer toggle menu**

In `src/components/DeckGLMap.ts`, in the layer toggle array (around line 3469), add after the `flights` entry:

```ts
 { key: 'adsb', label: t('components.deckgl.layers.adsbAircraft'), icon: '&#9992;' },
```

---

- [ ] **Step 5.8 — Add `adsb` to the layer help section**

In `src/components/DeckGLMap.ts`, in the `helpSection('transport', [...])` block (around line 3677), add after the `flightDelays` entry:

```ts
 helpItem(label('adsbAircraft'), 'transportAdsb'),
```

---

- [ ] **Step 5.9 — Add i18n keys to `en.json`**

In `src/locales/en.json`, find the section with `"shipTraffic"` and `"flightDelays"` (around line 856) and add:

```json
"adsbAircraft": "ADS-B Aircraft",
```

Find the section with `"transportShipping"` and `"transportDelays"` (around line 963) and add:

```json
"transportAdsb": "Live aircraft positions from OpenSky Network. Updates every 60 seconds. No API key required.",
```

---

- [ ] **Step 5.10 — Add the same keys to all 18 other locale files**

For each of the 18 locale files (`ja.json`, `de.json`, `it.json`, `fr.json`, `el.json`, `ko.json`, `cs.json`, `es.json`, `ar.json`, `zh.json`, `tr.json`, `nl.json`, `ru.json`, `pl.json`, `pt.json`, `vi.json`, `th.json`, `sv.json`):

Find `"shipTraffic"` and add `"adsbAircraft": "ADS-B Aircraft",` after `"flightDelays"`.
Find `"transportShipping"` and add `"transportAdsb": "Live aircraft positions from OpenSky Network. Updates every 60 seconds.",` after `"transportDelays"`.

(English text as fallback for all locales — translators can update later.)

---

- [ ] **Step 5.11 — Add `adsb` VisualScenario to map harness**

In `src/e2e/map-harness.ts`, add a new `VisualScenario` entry to the scenarios array:

```ts
  {
 id: 'adsb-z3',
 variant: 'both',
 enabledLayers: ['adsb'],
 camera: seededCameras.global,
 expectedDeckLayers: ['adsb-layer'],
 expectedSelectors: [],
  },
```

---

- [ ] **Step 5.12 — Verify TypeScript compiles**

```bash
npm run typecheck:all
```

Expected: zero errors.

---

- [ ] **Step 5.13 — Commit**

```bash
git add src/components/DeckGLMap.ts src/locales/en.json \
  src/locales/ja.json src/locales/de.json src/locales/it.json \
  src/locales/fr.json src/locales/el.json src/locales/ko.json \
  src/locales/cs.json src/locales/es.json src/locales/ar.json \
  src/locales/zh.json src/locales/tr.json src/locales/nl.json \
  src/locales/ru.json src/locales/pl.json src/locales/pt.json \
  src/locales/vi.json src/locales/th.json src/locales/sv.json \
  src/e2e/map-harness.ts
git commit -m "feat(adsb): add DeckGL ScatterplotLayer, tooltips, layer menu, and i18n keys

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Chunk 6: App Wiring + Tests

**Files:**

- Modify: `src/app/panel-layout.ts` — import + instantiate `AirTrafficPanel`
- Modify: `src/app/data-loader.ts` — import `fetchAdsbSnapshot`, add `loadAdsb()`, add `case 'adsb'`
- Modify: `src/App.ts` — add `scheduleRefresh` for adsb

Note: no change needed to `app-context.ts` — the existing `ctx.panels` map handles panel access. The data-loader accesses the panel via `(this.ctx.panels['air-traffic'] as AirTrafficPanel | undefined)?.update(snapshot)`, matching the same pattern used by `InsightsPanel` and `CIIPanel` elsewhere in the codebase.

---

- [ ] **Step 6.1 — Instantiate `AirTrafficPanel` in `panel-layout.ts`**

In `src/app/panel-layout.ts`:

1. Add import (after the `FuelPricesPanel` import, around line 57):

```ts
import { AirTrafficPanel } from '@/components/AirTrafficPanel';
```

1. Add instantiation (after `this.ctx.panels['fuel-prices'] = new FuelPricesPanel();`, around line 828):

```ts
 this.ctx.panels['air-traffic'] = new AirTrafficPanel();
```

---

- [ ] **Step 6.2 — Add `loadAdsb()` to `data-loader.ts`**

In `src/app/data-loader.ts`:

1. Add import (at the top with other service imports):

```ts
import { fetchAdsbSnapshot } from '@/services/adsb';
import type { AirTrafficPanel } from '@/components/AirTrafficPanel';
```

1. Add `case 'adsb'` to `loadDataForLayer()` switch (after the `case 'flights'` block, around line 432):

```ts
 case 'adsb': {
 await this.loadAdsb();
 break;
 }
```

1. Add `loadAdsb()` method (after `loadFlightDelays()`):

```ts
  async loadAdsb(): Promise<void> {
 try {
 const snapshot = await fetchAdsbSnapshot();
 this.ctx.map?.setAdsbFlights(snapshot.flights);
 this.ctx.map?.setLayerReady('adsb', snapshot.flights.length > 0);
 (this.ctx.panels['air-traffic'] as AirTrafficPanel | undefined)?.update(snapshot);
 } catch (error) {
 this.ctx.map?.setLayerReady('adsb', false);
 dataFreshness.recordError('adsb', error instanceof Error ? error.message : 'Unknown error');
 }
  }
```

1. Add to the initial load tasks block (find the section that has `if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.flights)`, add after it):

```ts
 if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.adsb) tasks.push({ name: 'adsb', task: runGuarded('adsb', () => this.loadAdsb()) });
```

---

- [ ] **Step 6.3 — Add `scheduleRefresh` to `App.ts`**

In `src/App.ts`, in `setupRefreshIntervals()`, add after the `telegram-intel` scheduleRefresh block:

```ts
 // ADS-B aircraft tracking (60s — OpenSky rate-limit aware)
 if (SITE_VARIANT !== 'happy') {
 this.refreshScheduler.scheduleRefresh(
 'adsb',
 () => this.dataLoader.loadAdsb(),
 60_000,
 () => this.state.mapLayers.adsb || !!this.state.panels['air-traffic']
 );
 }
```

---

- [ ] **Step 6.4 — Run the panel-wiring test**

```bash
node --test tests/panel-wiring.test.mjs
```

Expected: **all tests pass**, including the new `air-traffic` test.

---

- [ ] **Step 6.5 — Run full typecheck**

```bash
npm run typecheck:all
```

Expected: zero errors.

---

- [ ] **Step 6.6 — Commit**

```bash
git add src/app/app-context.ts src/app/panel-layout.ts \
  src/app/data-loader.ts src/App.ts
git commit -m "feat(adsb): wire AirTrafficPanel and loadAdsb into app context, layout, and scheduler

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Final Verification

- [ ] **Step 7.1 — Run all tests**

```bash
node --test tests/panel-wiring.test.mjs
```

Expected: all tests pass.

- [ ] **Step 7.2 — Full typecheck**

```bash
npm run typecheck:all
```

Expected: zero errors.

- [ ] **Step 7.3 — Manual smoke test**

Start dev server, open the app, toggle the ADS-B layer on in the map layer menu — dots should appear on the globe. Open the Air Traffic panel in the sidebar — count badge and stats should render.

If OpenSky is rate-limiting, the panel shows the amber warning banner. The globe layer may be empty until the next refresh cycle.
