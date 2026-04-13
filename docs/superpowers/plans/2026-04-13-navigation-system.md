# Navigation System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a resilient backup navigation system with street/highway map tiles, continuous GPS tracking, and turn-by-turn routing using multi-tier fallback chains.

**Architecture:** Three independent fallback chains (street tiles, routing engine, GPS source) each follow the existing building-tiles.ts waterfall pattern. A hybrid view system renders roads on the Cesium globe at high altitude and transitions to a dedicated MapLibre 2D panel below ~5km for street-level navigation. Navigation HUD extends GlobeHUD; full navigation panel activates on demand or auto-promotes on missed turns.

**Tech Stack:** Cesium, MapLibre GL (already installed v5.16.0), Nominatim geocoding (already used in GlobeSearch), OSRM/Valhalla/Mapbox/Google routing APIs, Browser Geolocation API, macOS CoreLocation (Tauri plugin), NMEA 0183 parser.

**Security notes:**
- NavigationHUD and NavigationPanel render self-generated content only (no user input in DOM rendering). Use textContent or safe DOM construction methods where possible; sanitize if user-supplied text is ever rendered.
- Sidecar GPS endpoint uses execFileSync (not exec) to prevent shell injection.

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/services/street-tiles.ts` | 3-tier street tile provider fallback chain |
| `src/services/routing-engine.ts` | 4-tier routing engine fallback chain |
| `src/services/gps-tracker.ts` | 3-tier GPS source fallback chain with continuous tracking |
| `src/services/nmea-parser.ts` | NMEA 0183 sentence parser for external GPS receivers |
| `src/components/NavigationHUD.ts` | Compact navigation overlay (next turn, ETA, speed) |
| `src/components/NavigationPanel.ts` | Full 2D MapLibre navigation view with route + directions |

### Modified Files
| File | Changes |
|------|---------|
| `src/types/index.ts:614` | Add `streetTiles` and `navigationRoute` to MapLayers interface |
| `src/services/runtime-config.ts:4-51,53-122` | Add MAPBOX_API_KEY, MAPTILER_API_KEY secret keys + navigation feature IDs |
| `src/services/settings-constants.ts:161` | Add Navigation settings category |
| `src/config/panels.ts:195-268` | Add streetTiles/navigationRoute to all map layer variants |
| `src/components/GlobeHUD.ts` | Add navigation toggle button to layer bar |
| `src/components/GodsVisionView.ts` | Add 'N' keyboard shortcut, altitude transition, NavigationPanel mount |
| `src/components/GlobeDataManager.ts` | Register street tile layer |
| `src-tauri/src/main.rs:38-86` | Add MAPBOX_API_KEY, MAPTILER_API_KEY to SUPPORTED_SECRET_KEYS |

---

## Task 1: Add API Key and Feature Definitions

**Files:**
- Modify: `src-tauri/src/main.rs:38-86`
- Modify: `src/services/runtime-config.ts:4-51,53-122`
- Modify: `src/services/settings-constants.ts:161`
- Modify: `src/types/index.ts:526-614`
- Modify: `src/config/panels.ts:195-268`

- [ ] **Step 1: Add secret keys to Rust backend**

In `src-tauri/src/main.rs`, change the array size from 47 to 49 and add the two new keys:

```rust
const SUPPORTED_SECRET_KEYS: [&str; 49] = [
    // ... existing 47 keys ...
    "GOOGLE_MAPS_API_KEY",
    "MAPBOX_API_KEY",
    "MAPTILER_API_KEY",
];
```

- [ ] **Step 2: Add TypeScript secret key types**

In `src/services/runtime-config.ts`, add to the `RuntimeSecretKey` union (after line 51 `'GOOGLE_MAPS_API_KEY'`):

```typescript
export type RuntimeSecretKey =
  // ... existing keys ...
  | 'GOOGLE_MAPS_API_KEY'
  | 'MAPBOX_API_KEY'
  | 'MAPTILER_API_KEY';
```

- [ ] **Step 3: Add navigation feature IDs**

In `src/services/runtime-config.ts`, add to the `RuntimeFeatureId` union (after line 122 `'cyberReactorNotifyMap'`):

```typescript
  | 'cyberReactorNotifyMap'
  | 'navigationMapbox'
  | 'navigationMaptiler'
  | 'navigationRouting';
```

Then add corresponding feature definitions in the `RUNTIME_FEATURES` array (follow the existing pattern):

```typescript
{
  id: 'navigationMapbox',
  name: 'Mapbox Navigation',
  description: 'Street tiles and routing via Mapbox',
  requiredSecrets: ['MAPBOX_API_KEY'],
  fallback: 'Falls back to MapTiler, then OpenStreetMap raster tiles',
},
{
  id: 'navigationMaptiler',
  name: 'MapTiler Streets',
  description: 'Street map tiles via MapTiler',
  requiredSecrets: ['MAPTILER_API_KEY'],
  fallback: 'Falls back to OpenStreetMap raster tiles',
},
{
  id: 'navigationRouting',
  name: 'Turn-by-Turn Navigation',
  description: 'Route calculation and turn-by-turn directions',
  requiredSecrets: [],
  fallback: 'Uses OSRM (free) when no premium routing keys are configured',
},
```

- [ ] **Step 4: Add Navigation settings category**

In `src/services/settings-constants.ts`, add after the travel-warnings category (after line 160):

```typescript
  {
    id: 'navigation',
    label: 'Navigation & Routing',
    features: ['navigationMapbox', 'navigationMaptiler', 'navigationRouting'],
  },
```

- [ ] **Step 5: Add MapLayers entries**

In `src/types/index.ts`, add before the closing `}` of the MapLayers interface (before line 614):

```typescript
  // Navigation layers
  streetTiles: boolean;
  navigationRoute: boolean;
}
```

In `src/config/panels.ts`, add to FULL_MAP_LAYERS (after `aircraft3d: false` at line 267):

```typescript
  aircraft3d: false,
  // Navigation layers
  streetTiles: false,
  navigationRoute: false,
};
```

Add the same two entries (both `false`) to FULL_MOBILE_MAP_LAYERS and every other variant map (TECH_MAP_LAYERS, FINANCE_MAP_LAYERS, HAPPY_MAP_LAYERS).

- [ ] **Step 6: Add human-readable labels**

In `src/services/settings-constants.ts`, find the `HUMAN_LABELS` object and add:

```typescript
  MAPBOX_API_KEY: 'Mapbox',
  MAPTILER_API_KEY: 'MapTiler',
```

Also find `SIGNUP_URLS` and add:

```typescript
  MAPBOX_API_KEY: 'https://account.mapbox.com/auth/signup/',
  MAPTILER_API_KEY: 'https://cloud.maptiler.com/auth/widget?next=https://cloud.maptiler.com/maps/',
```

- [ ] **Step 7: Run typecheck**

```bash
npm run typecheck:all
```

Expected: Zero errors.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/main.rs src/services/runtime-config.ts src/services/settings-constants.ts src/types/index.ts src/config/panels.ts
git commit -m "feat(nav): add API key definitions and map layer entries for navigation system

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Street Tile Provider (3-Tier Fallback)

**Files:**
- Create: `src/services/street-tiles.ts`

- [ ] **Step 1: Create the street tile provider**

Create `src/services/street-tiles.ts` following the building-tiles.ts fallback pattern:

```typescript
/**
 * Street Tile Provider -- 3-tier redundant fallback chain
 *
 * Tier 1: Mapbox Vector Tiles (requires MAPBOX_API_KEY)
 * Tier 2: MapTiler Streets (requires MAPTILER_API_KEY)
 * Tier 3: OpenStreetMap Raster (free, no key)
 */

import {
  UrlTemplateImageryProvider,
  type Viewer,
  type ImageryLayer,
} from 'cesium';
import { getRuntimeConfigSnapshot } from '@/services/runtime-config';

export type StreetTileTier = 1 | 2 | 3;

const TIER_NAMES: Record<StreetTileTier, string> = {
  1: 'Mapbox Streets',
  2: 'MapTiler Streets',
  3: 'OpenStreetMap',
};

export class StreetTileManager {
  private viewer: Viewer;
  private layer: ImageryLayer | null = null;
  private _currentTier: StreetTileTier = 3;
  private _visible = false;

  constructor(viewer: Viewer) {
    this.viewer = viewer;
  }

  get currentTier(): StreetTileTier {
    return this._currentTier;
  }

  get providerName(): string {
    return TIER_NAMES[this._currentTier];
  }

  get visible(): boolean {
    return this._visible;
  }

  async initialize(): Promise<boolean> {
    // Tier 1: Mapbox raster tiles
    const mapboxKey = getRuntimeConfigSnapshot().secrets.MAPBOX_API_KEY?.value;
    if (mapboxKey) {
      try {
        const provider = new UrlTemplateImageryProvider({
          url: `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}?access_token=${mapboxKey}`,
          maximumLevel: 20,
          credit: 'Mapbox',
        });
        this.layer = this.viewer.imageryLayers.addImageryProvider(provider);
        this.layer.alpha = 0.7;
        this.layer.show = false;
        this._currentTier = 1;
        return true;
      } catch (error) {
        console.warn('[StreetTiles] Mapbox failed, trying MapTiler:', error);
      }
    }

    // Tier 2: MapTiler Streets
    const maptilerKey = getRuntimeConfigSnapshot().secrets.MAPTILER_API_KEY?.value;
    if (maptilerKey) {
      try {
        const provider = new UrlTemplateImageryProvider({
          url: `https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key=${maptilerKey}`,
          maximumLevel: 20,
          credit: 'MapTiler',
        });
        this.layer = this.viewer.imageryLayers.addImageryProvider(provider);
        this.layer.alpha = 0.7;
        this.layer.show = false;
        this._currentTier = 2;
        return true;
      } catch (error) {
        console.warn('[StreetTiles] MapTiler failed, trying OSM:', error);
      }
    }

    // Tier 3: OpenStreetMap (always available, no key)
    try {
      const provider = new UrlTemplateImageryProvider({
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        maximumLevel: 19,
        credit: 'OpenStreetMap contributors',
      });
      this.layer = this.viewer.imageryLayers.addImageryProvider(provider);
      this.layer.alpha = 0.7;
      this.layer.show = false;
      this._currentTier = 3;
      return true;
    } catch (error) {
      console.warn('[StreetTiles] OSM failed:', error);
      return false;
    }
  }

  setVisible(visible: boolean): void {
    if (this.layer) {
      this.layer.show = visible;
      this._visible = visible;
    }
  }

  setAlpha(alpha: number): void {
    if (this.layer) {
      this.layer.alpha = Math.max(0, Math.min(1, alpha));
    }
  }

  destroy(): void {
    if (this.layer) {
      this.viewer.imageryLayers.remove(this.layer);
      this.layer = null;
    }
  }
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck:all
```

Expected: Zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/street-tiles.ts
git commit -m "feat(nav): add 3-tier street tile provider fallback chain

Mapbox -> MapTiler -> OpenStreetMap raster tiles.
Follows building-tiles.ts waterfall pattern.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: GPS Tracker (3-Tier Fallback)

**Files:**
- Create: `src/services/gps-tracker.ts`
- Create: `src/services/nmea-parser.ts`

- [ ] **Step 1: Create NMEA parser**

Create `src/services/nmea-parser.ts`:

```typescript
/**
 * NMEA 0183 sentence parser for external GPS receivers.
 * Parses GGA (fix) and RMC (recommended minimum) sentences.
 */

export interface NmeaPosition {
  latitude: number;
  longitude: number;
  altitude: number | null;
  speed: number | null;       // m/s
  heading: number | null;     // degrees true
  accuracy: number | null;    // HDOP-derived meters
  timestamp: number;          // Unix ms
  satellites: number;
  fixQuality: number;         // 0=invalid, 1=GPS, 2=DGPS
}

function parseLatLon(raw: string, dir: string): number {
  if (!raw || !dir) return NaN;
  const dotIdx = raw.indexOf('.');
  const degLen = dotIdx - 2;
  const deg = parseFloat(raw.substring(0, degLen));
  const min = parseFloat(raw.substring(degLen));
  let value = deg + min / 60;
  if (dir === 'S' || dir === 'W') value = -value;
  return value;
}

function knotsToMs(knots: string): number | null {
  const v = parseFloat(knots);
  return isNaN(v) ? null : v * 0.514444;
}

export function parseGGA(fields: string[]): Partial<NmeaPosition> | null {
  if (fields.length < 15) return null;
  const fixQuality = parseInt(fields[6], 10);
  if (fixQuality === 0) return null;
  return {
    latitude: parseLatLon(fields[2], fields[3]),
    longitude: parseLatLon(fields[4], fields[5]),
    fixQuality,
    satellites: parseInt(fields[7], 10) || 0,
    accuracy: parseFloat(fields[8]) * 5 || null,
    altitude: parseFloat(fields[9]) || null,
    timestamp: Date.now(),
  };
}

export function parseRMC(fields: string[]): Partial<NmeaPosition> | null {
  if (fields.length < 12 || fields[2] !== 'A') return null;
  return {
    latitude: parseLatLon(fields[3], fields[4]),
    longitude: parseLatLon(fields[5], fields[6]),
    speed: knotsToMs(fields[7]),
    heading: parseFloat(fields[8]) || null,
    timestamp: Date.now(),
  };
}

export function parseNmea(sentence: string): Partial<NmeaPosition> | null {
  const trimmed = sentence.trim();
  if (!trimmed.startsWith('$')) return null;

  const body = trimmed.split('*')[0];
  const fields = body.split(',');
  const type = fields[0].slice(3);

  switch (type) {
    case 'GGA': return parseGGA(fields);
    case 'RMC': return parseRMC(fields);
    default: return null;
  }
}
```

- [ ] **Step 2: Create GPS tracker**

Create `src/services/gps-tracker.ts`:

```typescript
/**
 * GPS Tracker -- 3-tier redundant fallback chain
 *
 * Tier 1: CoreLocation via Tauri plugin (macOS native GPS)
 * Tier 2: Browser Geolocation API (WKWebView)
 * Tier 3: External GPS receiver via sidecar (NMEA over serial)
 */

import { tryInvokeTauri } from '@/services/tauri-bridge';
import { getApiBaseUrl } from '@/services/runtime';
import { parseNmea } from '@/services/nmea-parser';

export type GpsTier = 1 | 2 | 3;

export interface GpsPosition {
  latitude: number;
  longitude: number;
  altitude: number | null;
  speed: number | null;
  heading: number | null;
  accuracy: number;
  timestamp: number;
  source: 'corelocation' | 'browser' | 'external';
}

export type GpsListener = (position: GpsPosition) => void;

const TIER_NAMES: Record<GpsTier, string> = {
  1: 'CoreLocation',
  2: 'Browser GPS',
  3: 'External GPS',
};

export class GpsTracker {
  private _currentTier: GpsTier | null = null;
  private _lastPosition: GpsPosition | null = null;
  private _active = false;
  private watchId: number | null = null;
  private pollId: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<GpsListener>();

  get currentTier(): GpsTier | null {
    return this._currentTier;
  }

  get tierName(): string {
    return this._currentTier ? TIER_NAMES[this._currentTier] : 'None';
  }

  get lastPosition(): GpsPosition | null {
    return this._lastPosition;
  }

  get active(): boolean {
    return this._active;
  }

  addListener(fn: GpsListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(pos: GpsPosition): void {
    this._lastPosition = pos;
    for (const fn of this.listeners) {
      try { fn(pos); } catch { /* listener error */ }
    }
  }

  async start(): Promise<boolean> {
    if (this._active) return true;

    if (await this.tryCoreLocation()) {
      this._currentTier = 1;
      this._active = true;
      return true;
    }

    if (this.tryBrowserGeolocation()) {
      this._currentTier = 2;
      this._active = true;
      return true;
    }

    if (await this.tryExternalGps()) {
      this._currentTier = 3;
      this._active = true;
      return true;
    }

    return false;
  }

  stop(): void {
    this._active = false;
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    if (this.pollId !== null) {
      clearInterval(this.pollId);
      this.pollId = null;
    }
    this._currentTier = null;
  }

  private async tryCoreLocation(): Promise<boolean> {
    try {
      const result = await tryInvokeTauri<{
        latitude: number;
        longitude: number;
        altitude: number | null;
        speed: number | null;
        course: number | null;
        horizontalAccuracy: number;
      }>('plugin:corelocation|get_location');

      if (!result) return false;

      this.emit({
        latitude: result.latitude,
        longitude: result.longitude,
        altitude: result.altitude,
        speed: result.speed,
        heading: result.course,
        accuracy: result.horizontalAccuracy,
        timestamp: Date.now(),
        source: 'corelocation',
      });

      this.pollId = setInterval(async () => {
        try {
          const pos = await tryInvokeTauri<{
            latitude: number;
            longitude: number;
            altitude: number | null;
            speed: number | null;
            course: number | null;
            horizontalAccuracy: number;
          }>('plugin:corelocation|get_location');
          if (pos) {
            this.emit({
              latitude: pos.latitude,
              longitude: pos.longitude,
              altitude: pos.altitude,
              speed: pos.speed,
              heading: pos.course,
              accuracy: pos.horizontalAccuracy,
              timestamp: Date.now(),
              source: 'corelocation',
            });
          }
        } catch { /* CoreLocation poll failed */ }
      }, 1000);

      return true;
    } catch {
      return false;
    }
  }

  private tryBrowserGeolocation(): boolean {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return false;

    try {
      this.watchId = navigator.geolocation.watchPosition(
        (pos) => {
          this.emit({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            altitude: pos.coords.altitude,
            speed: pos.coords.speed,
            heading: pos.coords.heading,
            accuracy: pos.coords.accuracy,
            timestamp: pos.timestamp,
            source: 'browser',
          });
        },
        () => { /* watch error -- tier stays active */ },
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
      );
      return true;
    } catch {
      return false;
    }
  }

  private async tryExternalGps(): Promise<boolean> {
    try {
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/gps/nmea`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return false;

      const text = await res.text();
      const parsed = parseNmea(text);
      if (!parsed?.latitude || !parsed?.longitude) return false;

      this.emit({
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        altitude: parsed.altitude ?? null,
        speed: parsed.speed ?? null,
        heading: parsed.heading ?? null,
        accuracy: parsed.accuracy ?? 10,
        timestamp: parsed.timestamp ?? Date.now(),
        source: 'external',
      });

      this.pollId = setInterval(async () => {
        try {
          const r = await fetch(`${base}/gps/nmea`, { signal: AbortSignal.timeout(3000) });
          if (!r.ok) return;
          const t = await r.text();
          const p = parseNmea(t);
          if (p?.latitude && p?.longitude) {
            this.emit({
              latitude: p.latitude,
              longitude: p.longitude,
              altitude: p.altitude ?? null,
              speed: p.speed ?? null,
              heading: p.heading ?? null,
              accuracy: p.accuracy ?? 10,
              timestamp: p.timestamp ?? Date.now(),
              source: 'external',
            });
          }
        } catch { /* external GPS poll failed */ }
      }, 1000);

      return true;
    } catch {
      return false;
    }
  }

  destroy(): void {
    this.stop();
    this.listeners.clear();
  }
}
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck:all
```

Expected: Zero errors. Verify `tryInvokeTauri` import path matches `src/services/tauri-bridge.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/services/gps-tracker.ts src/services/nmea-parser.ts
git commit -m "feat(nav): add 3-tier GPS tracker with NMEA parser

CoreLocation -> Browser Geolocation -> External GPS (NMEA/serial).
Continuous 1Hz updates with heading, speed, and accuracy.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Routing Engine (4-Tier Fallback)

**Files:**
- Create: `src/services/routing-engine.ts`

- [ ] **Step 1: Create the routing engine**

Create `src/services/routing-engine.ts`:

```typescript
/**
 * Routing Engine -- 4-tier redundant fallback chain
 *
 * Tier 1: Mapbox Directions API (requires MAPBOX_API_KEY, traffic-aware)
 * Tier 2: Google Directions API (requires GOOGLE_MAPS_API_KEY, traffic-aware)
 * Tier 3: Valhalla public instance (free, multi-profile)
 * Tier 4: OSRM public instance (free, driving only)
 */

import { getRuntimeConfigSnapshot } from '@/services/runtime-config';

export type RoutingTier = 1 | 2 | 3 | 4;
export type RoutingProfile = 'driving' | 'cycling' | 'walking';

export interface RouteCoord {
  lat: number;
  lon: number;
}

export interface RouteStep {
  instruction: string;
  distance: number;      // meters
  duration: number;       // seconds
  maneuver: string;       // 'turn-left', 'turn-right', 'straight', 'arrive', etc.
  name: string;           // street name
  coordinates: RouteCoord[];
}

export interface RouteResult {
  steps: RouteStep[];
  geometry: RouteCoord[];   // full polyline
  distance: number;         // total meters
  duration: number;         // total seconds
  tier: RoutingTier;
  provider: string;
}

const TIER_NAMES: Record<RoutingTier, string> = {
  1: 'Mapbox Directions',
  2: 'Google Directions',
  3: 'Valhalla',
  4: 'OSRM',
};

const TIMEOUT_MS = 3000;

function decodePolyline(encoded: string, precision = 5): RouteCoord[] {
  const coords: RouteCoord[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const factor = Math.pow(10, precision);

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lon += result & 1 ? ~(result >> 1) : result >> 1;

    coords.push({ lat: lat / factor, lon: lon / factor });
  }
  return coords;
}

async function tryMapbox(
  from: RouteCoord,
  to: RouteCoord,
  profile: RoutingProfile,
): Promise<RouteResult | null> {
  const key = getRuntimeConfigSnapshot().secrets.MAPBOX_API_KEY?.value;
  if (!key) return null;

  const mapboxProfile = profile === 'driving' ? 'driving-traffic' : profile;
  const url = `https://api.mapbox.com/directions/v5/mapbox/${mapboxProfile}/${from.lon},${from.lat};${to.lon},${to.lat}?access_token=${key}&geometries=geojson&steps=true&overview=full`;

  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) return null;

  const data = await res.json();
  const route = data.routes?.[0];
  if (!route) return null;

  return {
    steps: route.legs[0].steps.map((s: Record<string, unknown>) => ({
      instruction: (s.maneuver as Record<string, string>).instruction,
      distance: s.distance as number,
      duration: s.duration as number,
      maneuver: (s.maneuver as Record<string, string>).type,
      name: (s.name as string) || '',
      coordinates: (s.geometry as { coordinates: number[][] }).coordinates.map(
        (c: number[]) => ({ lat: c[1], lon: c[0] }),
      ),
    })),
    geometry: route.geometry.coordinates.map((c: number[]) => ({ lat: c[1], lon: c[0] })),
    distance: route.distance,
    duration: route.duration,
    tier: 1,
    provider: TIER_NAMES[1],
  };
}

async function tryGoogle(
  from: RouteCoord,
  to: RouteCoord,
  _profile: RoutingProfile,
): Promise<RouteResult | null> {
  const key = getRuntimeConfigSnapshot().secrets.GOOGLE_MAPS_API_KEY?.value;
  if (!key) return null;

  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${from.lat},${from.lon}&destination=${to.lat},${to.lon}&key=${key}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) return null;

  const data = await res.json();
  const route = data.routes?.[0];
  if (!route) return null;

  const leg = route.legs[0];
  return {
    steps: leg.steps.map((s: Record<string, unknown>) => ({
      instruction: (s.html_instructions as string).replace(/<[^>]*>/g, ''),
      distance: (s.distance as { value: number }).value,
      duration: (s.duration as { value: number }).value,
      maneuver: (s.maneuver as string) || 'straight',
      name: '',
      coordinates: decodePolyline((s.polyline as { points: string }).points),
    })),
    geometry: decodePolyline(route.overview_polyline.points),
    distance: leg.distance.value,
    duration: leg.duration.value,
    tier: 2,
    provider: TIER_NAMES[2],
  };
}

async function tryValhalla(
  from: RouteCoord,
  to: RouteCoord,
  profile: RoutingProfile,
): Promise<RouteResult | null> {
  const valhallaProfile = profile === 'driving' ? 'auto' : profile === 'cycling' ? 'bicycle' : 'pedestrian';

  const body = JSON.stringify({
    locations: [
      { lat: from.lat, lon: from.lon },
      { lat: to.lat, lon: to.lon },
    ],
    costing: valhallaProfile,
    directions_options: { units: 'kilometers' },
  });

  const url = 'https://valhalla1.openstreetmap.de/route';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;

  const data = await res.json();
  const leg = data.trip?.legs?.[0];
  if (!leg) return null;

  const geometry = decodePolyline(leg.shape, 6);

  return {
    steps: leg.maneuvers.map((m: Record<string, unknown>) => ({
      instruction: m.instruction as string,
      distance: ((m.length as number) || 0) * 1000,
      duration: (m.time as number) || 0,
      maneuver: (m.type as number).toString(),
      name: (m.street_names as string[])?.[0] || '',
      coordinates: geometry.slice(
        m.begin_shape_index as number,
        (m.end_shape_index as number) + 1,
      ),
    })),
    geometry,
    distance: (data.trip.summary.length || 0) * 1000,
    duration: data.trip.summary.time || 0,
    tier: 3,
    provider: TIER_NAMES[3],
  };
}

async function tryOsrm(
  from: RouteCoord,
  to: RouteCoord,
  _profile: RoutingProfile,
): Promise<RouteResult | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson&steps=true`;

  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) return null;

  const data = await res.json();
  const route = data.routes?.[0];
  if (!route) return null;

  const leg = route.legs[0];
  return {
    steps: leg.steps.map((s: Record<string, unknown>) => ({
      instruction: (s.maneuver as Record<string, string>).type,
      distance: s.distance as number,
      duration: s.duration as number,
      maneuver: (s.maneuver as Record<string, string>).type,
      name: (s.name as string) || '',
      coordinates: (s.geometry as { coordinates: number[][] }).coordinates.map(
        (c: number[]) => ({ lat: c[1], lon: c[0] }),
      ),
    })),
    geometry: route.geometry.coordinates.map((c: number[]) => ({ lat: c[1], lon: c[0] })),
    distance: route.distance,
    duration: route.duration,
    tier: 4,
    provider: TIER_NAMES[4],
  };
}

export async function computeRoute(
  from: RouteCoord,
  to: RouteCoord,
  profile: RoutingProfile = 'driving',
): Promise<RouteResult | null> {
  const tiers = [tryMapbox, tryGoogle, tryValhalla, tryOsrm];

  for (const tryTier of tiers) {
    try {
      const result = await tryTier(from, to, profile);
      if (result) return result;
    } catch (error) {
      console.warn('[RoutingEngine] Tier failed:', error);
    }
  }

  console.error('[RoutingEngine] All 4 tiers failed');
  return null;
}

export { TIER_NAMES as ROUTING_TIER_NAMES };
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck:all
```

Expected: Zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/routing-engine.ts
git commit -m "feat(nav): add 4-tier routing engine fallback chain

Mapbox -> Google -> Valhalla -> OSRM. Each tier has 3s timeout.
Supports driving, cycling, and walking profiles.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Navigation HUD Overlay

**Files:**
- Create: `src/components/NavigationHUD.ts`
- Modify: `src/components/GlobeHUD.ts`

- [ ] **Step 1: Create NavigationHUD**

Create `src/components/NavigationHUD.ts`. Use safe DOM construction (createElement + textContent) instead of innerHTML for all rendering. Build the HUD strip with:
- Turn arrow (32px, centered)
- Instruction text + street name
- Distance to turn + ETA
- Speed + GPS source indicator

Layout: absolute positioned, bottom 80px, centered horizontally, dark glass panel matching GlobeHUD aesthetic.

Key types:

```typescript
import type { RouteStep } from '@/services/routing-engine';
import type { GpsPosition } from '@/services/gps-tracker';

export interface NavigationHUDState {
  active: boolean;
  currentStep: RouteStep | null;
  nextStep: RouteStep | null;
  distanceToTurn: number;
  eta: string;
  totalRemaining: number;
  speed: number | null;
  gpsSource: string;
  routingProvider: string;
}
```

Methods: `mount()`, `update(state)`, `updateFromGps(pos)`, `show()`, `hide()`, `destroy()`.

Use `document.createElement` and `textContent` for all text rendering. Build the DOM tree programmatically rather than using innerHTML with template strings.

- [ ] **Step 2: Add navigation toggle button to GlobeHUD**

In `src/components/GlobeHUD.ts`, add a callback field alongside existing ones:

```typescript
private onNavigationToggle: (() => void) | null = null;
```

Add a setter method alongside existing setters:

```typescript
setOnNavigationToggle(fn: () => void): void {
  this.onNavigationToggle = fn;
}
```

In the `buildDOM()` method, after the existing layer buttons are built, add a navigation button using createElement (not innerHTML):

```typescript
const navBtn = document.createElement('button');
navBtn.textContent = 'NAV';
navBtn.title = 'Toggle Navigation (N)';
navBtn.style.cssText = `
  background: rgba(20,25,40,0.8); border: 1px solid rgba(100,140,255,0.3);
  color: #8ca8ff; border-radius: 6px; padding: 4px 10px; cursor: pointer;
  font-size: 11px; font-family: 'SF Mono', monospace; font-weight: 600;
`;
navBtn.addEventListener('click', () => this.onNavigationToggle?.());
layerBar.appendChild(navBtn);
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck:all
```

Expected: Zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/NavigationHUD.ts src/components/GlobeHUD.ts
git commit -m "feat(nav): add NavigationHUD overlay and NAV button to GlobeHUD

Compact HUD shows next turn, distance, ETA, speed, GPS source.
NAV button in globe layer bar toggles navigation mode.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Navigation Panel (2D MapLibre View)

**Files:**
- Create: `src/components/NavigationPanel.ts`

- [ ] **Step 1: Create NavigationPanel**

Create `src/components/NavigationPanel.ts` using MapLibre GL for the 2D street map view. Use safe DOM construction (createElement + textContent) for the directions sidebar instead of innerHTML.

Key structure:

```typescript
import maplibregl from 'maplibre-gl';
import type { RouteResult, RouteCoord } from '@/services/routing-engine';
import type { GpsPosition } from '@/services/gps-tracker';
import { getRuntimeConfigSnapshot } from '@/services/runtime-config';
```

Layout: Full-screen overlay (z-index 999). Left 70% = MapLibre map. Right 30% = directions sidebar.

`getMapStyle()` function with 3-tier fallback:
1. Mapbox dark-v11 style URL (if MAPBOX_API_KEY)
2. MapTiler streets-v2-dark style URL (if MAPTILER_API_KEY)
3. OSM raster StyleSpecification object (no key needed)

Methods:
- `mount()` -- build DOM structure
- `show(center?)` -- display panel, init map if needed
- `hide()` -- hide panel
- `updateGpsPosition(pos)` -- move GPS marker, rotate by heading
- `displayRoute(route)` -- add GeoJSON route line + render directions list
- `destroy()` -- cleanup map, markers, DOM

Route rendering: GeoJSON LineString source + line layer (#4a9eff, width 5). Fit bounds with 60px padding.

Directions list: Build each step as a div using createElement. Set instruction text via textContent. Show step number, instruction, street name, and distance.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck:all
```

Expected: Zero errors. MapLibre GL types come from `maplibre-gl` (already installed v5.16.0).

- [ ] **Step 3: Commit**

```bash
git add src/components/NavigationPanel.ts
git commit -m "feat(nav): add full 2D MapLibre navigation panel

Street map with route overlay, GPS marker, and turn-by-turn
directions sidebar. Uses Mapbox/MapTiler/OSM style fallback.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Wire Navigation into GodsVisionView

**Files:**
- Modify: `src/components/GodsVisionView.ts`
- Modify: `src/components/GlobeDataManager.ts`

- [ ] **Step 1: Add imports and fields to GodsVisionView**

In `src/components/GodsVisionView.ts`, add imports at the top:

```typescript
import { StreetTileManager } from '@/services/street-tiles';
import { GpsTracker, type GpsPosition } from '@/services/gps-tracker';
import { computeRoute, type RouteResult, type RouteCoord } from '@/services/routing-engine';
import { NavigationHUD } from '@/components/NavigationHUD';
import { NavigationPanel } from '@/components/NavigationPanel';
```

Add fields to the class:

```typescript
private streetTiles: StreetTileManager | null = null;
private gpsTracker: GpsTracker | null = null;
private navHud: NavigationHUD | null = null;
private navPanel: NavigationPanel | null = null;
private navigationActive = false;
private currentRoute: RouteResult | null = null;
private gpsCleanup: (() => void) | null = null;
```

- [ ] **Step 2: Initialize navigation components in activate()**

In the `activate()` method, after existing component initialization, add:

```typescript
this.streetTiles = new StreetTileManager(this.viewer);
await this.streetTiles.initialize();

this.gpsTracker = new GpsTracker();

this.navHud = new NavigationHUD(this.container);
this.navHud.mount();

this.navPanel = new NavigationPanel(this.container);
this.navPanel.mount();
this.navPanel.setOnClose(() => this.deactivateNavigation());
```

- [ ] **Step 3: Add toggleNavigation method**

```typescript
async toggleNavigation(): Promise<void> {
  if (this.navigationActive) {
    this.deactivateNavigation();
  } else {
    await this.activateNavigation();
  }
}

private async activateNavigation(): Promise<void> {
  this.navigationActive = true;
  this.streetTiles?.setVisible(true);

  if (this.gpsTracker) {
    await this.gpsTracker.start();
    this.gpsCleanup = this.gpsTracker.addListener((pos: GpsPosition) => {
      this.navHud?.updateFromGps(pos);
      this.navPanel?.updateGpsPosition(pos);

      const cameraHeight = this.viewer.camera.positionCartographic.height;
      if (cameraHeight < 5000 && !this.navPanel?.visible) {
        this.navPanel?.show({ lat: pos.latitude, lon: pos.longitude });
      } else if (cameraHeight >= 5000 && this.navPanel?.visible) {
        this.navPanel?.hide();
      }
    });
  }

  this.navHud?.show();
  console.info(`[Navigation] Active -- GPS: ${this.gpsTracker?.tierName}, Streets: ${this.streetTiles?.providerName}`);
}

private deactivateNavigation(): void {
  this.navigationActive = false;
  this.streetTiles?.setVisible(false);
  this.gpsCleanup?.();
  this.gpsCleanup = null;
  this.gpsTracker?.stop();
  this.navHud?.hide();
  this.navPanel?.hide();
  this.currentRoute = null;
}

async navigateTo(destination: RouteCoord): Promise<void> {
  const pos = this.gpsTracker?.lastPosition;
  if (!pos) {
    console.warn('[Navigation] No GPS position available');
    return;
  }

  const from: RouteCoord = { lat: pos.latitude, lon: pos.longitude };
  const route = await computeRoute(from, destination);
  if (!route) {
    console.warn('[Navigation] All routing tiers failed');
    return;
  }

  this.currentRoute = route;
  this.navHud?.update({
    active: true,
    currentStep: route.steps[0],
    nextStep: route.steps[1] || null,
    distanceToTurn: route.steps[0].distance,
    totalRemaining: route.distance,
    routingProvider: route.provider,
    eta: new Date(Date.now() + route.duration * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  });
  this.navPanel?.displayRoute(route);
  console.info(`[Navigation] Route: ${(route.distance / 1000).toFixed(1)}km via ${route.provider}`);
}
```

- [ ] **Step 4: Add 'N' keyboard shortcut**

In `attachKeyboardHandlers()`, add after the existing key handlers:

```typescript
if (ke.key === 'n' || ke.key === 'N') {
  void this.toggleNavigation();
  return;
}
```

- [ ] **Step 5: Wire HUD navigation button**

Where `GlobeHUD` is initialized and callbacks are wired, add:

```typescript
this.hud.setOnNavigationToggle(() => void this.toggleNavigation());
```

- [ ] **Step 6: Clean up in deactivate/destroy**

In the `deactivate()` or `destroy()` method, add cleanup:

```typescript
this.deactivateNavigation();
this.streetTiles?.destroy();
this.streetTiles = null;
this.gpsTracker?.destroy();
this.gpsTracker = null;
this.navHud?.destroy();
this.navHud = null;
this.navPanel?.destroy();
this.navPanel = null;
```

- [ ] **Step 7: Register street tile layer in GlobeDataManager**

In `src/components/GlobeDataManager.ts`, in `initialize()`, add:

```typescript
this.registerLayer('streetTiles', () => {
  // Street tiles managed by StreetTileManager, not data source
});
```

- [ ] **Step 8: Run typecheck**

```bash
npm run typecheck:all
```

Expected: Zero errors.

- [ ] **Step 9: Commit**

```bash
git add src/components/GodsVisionView.ts src/components/GlobeDataManager.ts
git commit -m "feat(nav): wire navigation system into God's Vision

N key + NAV button toggle navigation mode. GPS tracking with
altitude-based auto-transition between 3D globe and 2D panel.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 8: CoreLocation Tauri Plugin (Rust)

**Files:**
- Create: `src-tauri/src/corelocation.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Create CoreLocation plugin module**

Create `src-tauri/src/corelocation.rs` with a `get_location` Tauri command. Uses `std::process::Command` to invoke a swift subprocess that accesses CoreLocation (avoids Objective-C bridging in Rust build). The swift code:

1. Creates a CLLocationManager with best accuracy
2. Starts updating location
3. Waits up to 5 seconds on a semaphore
4. Prints lat,lon,altitude,speed,course,accuracy as CSV to stdout

The Rust side parses the CSV output into a `LocationResult` struct:

```rust
#[derive(Debug, Serialize)]
pub struct LocationResult {
    pub latitude: f64,
    pub longitude: f64,
    pub altitude: Option<f64>,
    pub speed: Option<f64>,
    pub course: Option<f64>,
    pub horizontal_accuracy: f64,
}
```

Gate with `#[cfg(target_os = "macos")]` -- return error string on non-macOS.

- [ ] **Step 2: Register the command in main.rs**

In `src-tauri/src/main.rs`, add `mod corelocation;` near the top and add `corelocation::get_location` to the `generate_handler![]` list.

- [ ] **Step 3: Build to verify Rust compiles**

```bash
cd src-tauri && cargo check
```

Expected: Compiles without errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/corelocation.rs src-tauri/src/main.rs
git commit -m "feat(nav): add CoreLocation Tauri plugin for native GPS

Swift subprocess approach for macOS location services.
Returns lat/lon/altitude/speed/course/accuracy.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 9: External GPS Sidecar Endpoint

**Files:**
- Modify: `src-tauri/sidecar/local-api-server.mjs`

- [ ] **Step 1: Add GPS NMEA endpoint to sidecar**

In `src-tauri/sidecar/local-api-server.mjs`, add a new route `/gps/nmea`. Uses `execFileSync` (NOT `exec`) to read from the serial port -- prevents shell injection per project security conventions.

```javascript
app.get('/gps/nmea', async (req, res) => {
  try {
    const { execFileSync } = await import('node:child_process');
    const configPath = path.join(os.homedir(), '.crystalball-gps.json');
    let port = '/dev/tty.usbserial-0001';

    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      port = config.port || port;
    } catch {
      // Use defaults
    }

    const line = execFileSync('head', ['-n', '5', port], {
      encoding: 'utf8',
      timeout: 3000,
    }).trim();

    if (!line || !line.startsWith('$')) {
      res.status(404).json({ error: 'No GPS device detected' });
      return;
    }

    res.type('text/plain').send(line);
  } catch (error) {
    res.status(404).json({ error: 'GPS not available', details: error.message });
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add src-tauri/sidecar/local-api-server.mjs
git commit -m "feat(nav): add GPS NMEA endpoint to sidecar

Reads from serial GPS receiver using execFileSync (safe, no shell).
Configurable port via ~/.crystalball-gps.json.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 10: Final Integration and Typecheck

**Files:**
- All modified files

- [ ] **Step 1: Run full typecheck**

```bash
npm run typecheck:all
```

Expected: Zero errors across both tsconfig.json and tsconfig.api.json.

- [ ] **Step 2: Run lint**

```bash
npx eslint src/services/street-tiles.ts src/services/routing-engine.ts src/services/gps-tracker.ts src/services/nmea-parser.ts src/components/NavigationHUD.ts src/components/NavigationPanel.ts --fix
```

Fix any lint errors.

- [ ] **Step 3: Run secret scan**

```bash
npm run secrets:scan
```

Expected: No secrets detected.

- [ ] **Step 4: Verify Rust build**

```bash
cd src-tauri && cargo check
```

Expected: Compiles cleanly.

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -u
git commit -m "fix(nav): lint and typecheck fixes

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

- [ ] **Step 6: Push branch**

```bash
git push origin claude/navigation-system
```
