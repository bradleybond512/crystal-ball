# 3D Immersive Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 3D buildings (5-tier redundant fallback), detailed glTF aircraft models at real altitude, and real-time satellite tracking with SGP4 propagation to both the 2D DeckGL map and God's Vision Cesium globe.

**Architecture:** Unified 3D Asset Pipeline — shared services (`model-loader`, `satellite-catalog`, `satellite-propagator`, `building-tiles`) consumed by both DeckGL and Cesium renderers. Satellite propagation runs in a Web Worker to keep the main thread free.

**Tech Stack:** Cesium 1.140.0, DeckGL 9.2, satellite.js (SGP4), @deck.gl/mesh-layers (SimpleMeshLayer), MapLibre GL fill-extrusion, glTF/glb 3D models

**Model:** Use Sonnet for all implementation tasks.

---

## Task 1: Install Dependencies & Add GOOGLE_MAPS_API_KEY

**Files:**

- Modify: `package.json` — add `satellite.js`, `@deck.gl/mesh-layers`
- Modify: `src-tauri/src/main.rs:38-85` — add key to SUPPORTED_SECRET_KEYS
- Modify: `src/services/runtime-config.ts` — add feature definition
- Modify: `src/services/settings-constants.ts` — add label + signup URL

- [ ] **Step 1: Install npm packages**

```bash
npm install satellite.js @deck.gl/mesh-layers
```

- [ ] **Step 2: Add GOOGLE_MAPS_API_KEY to main.rs**

In `src-tauri/src/main.rs`, change the array size from `[&str; 46]` to `[&str; 47]` and add `"GOOGLE_MAPS_API_KEY"` after `"CESIUM_ION_TOKEN"`:

```rust
const SUPPORTED_SECRET_KEYS: [&str; 47] = [
 // ... existing 46 keys ...
 "CESIUM_ION_TOKEN",
 "GOOGLE_MAPS_API_KEY",
];
```

- [ ] **Step 3: Add RuntimeSecretKey type**

In `src/services/runtime-config.ts`, find the `RuntimeSecretKey` type union and add:

```typescript
| 'GOOGLE_MAPS_API_KEY'
```

- [ ] **Step 4: Add RuntimeFeatureId type**

In `src/services/runtime-config.ts`, find the `RuntimeFeatureId` type union and add:

```typescript
| 'google3dTiles'
```

- [ ] **Step 5: Add feature definition**

In `src/services/runtime-config.ts`, add after the `owmWeatherTiles` definition:

```typescript
{
  id: 'google3dTiles',
  name: 'Google Photorealistic 3D Tiles',
  description: 'Photorealistic 3D building tiles from Google Maps Platform. Free tier covers ~28,500 session loads/month.',
  requiredSecrets: ['GOOGLE_MAPS_API_KEY'],
  fallback: 'Falls back to Cesium OSM Buildings (with Ion token), then Esri I3S, then flat rendering.',
},
```

- [ ] **Step 6: Add settings constants**

In `src/services/settings-constants.ts`, add to `SIGNUP_URLS`:

```typescript
GOOGLE_MAPS_API_KEY: 'https://console.cloud.google.com/apis/credentials',
```

Add to `HUMAN_LABELS`:

```typescript
GOOGLE_MAPS_API_KEY: 'Google Maps API Key',
```

- [ ] **Step 7: Run type check**

```bash
npm run typecheck:all
```

Expected: PASS (zero errors)

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src-tauri/src/main.rs src/services/runtime-config.ts src/services/settings-constants.ts
git commit -m "feat: add satellite.js, mesh-layers deps and GOOGLE_MAPS_API_KEY secret"
```

---

## Task 2: Add MapLayers Toggles & God's Vision Layer Config

**Files:**

- Modify: `src/types/index.ts` — 3 new MapLayers keys
- Modify: `src/config/panels.ts` — add defaults to all MapLayers objects
- Modify: `src/config/variants/full.ts` — add defaults
- Modify: `src/config/variants/tech.ts` — add defaults
- Modify: `src/config/variants/finance.ts` — add defaults
- Modify: `src/config/variants/happy.ts` — add defaults
- Modify: `src/e2e/map-harness.ts` — add defaults
- Modify: `src/e2e/mobile-map-integration-harness.ts` — add defaults
- Modify: `src/config/gods-vision-layers.ts` — add layer entries

- [ ] **Step 1: Add MapLayers keys**

In `src/types/index.ts`, add after `redFlagWarnings: boolean;` in the `MapLayers` interface:

```typescript
buildings3d: boolean;
satellites: boolean;
aircraft3d: boolean;
```

- [ ] **Step 2: Add defaults to all MapLayers objects**

In every file that defines a `MapLayers` object, add these 3 keys with value `false`:

```typescript
buildings3d: false,
satellites: false,
aircraft3d: false,
```

Files to update (add to each MapLayers object):

- `src/config/panels.ts` — all 8 MapLayers objects (FULL_MAP_LAYERS gets `buildings3d: true, satellites: false, aircraft3d: false`)
- `src/config/variants/full.ts` — 2 objects
- `src/config/variants/tech.ts` — 2 objects
- `src/config/variants/finance.ts` — 2 objects
- `src/config/variants/happy.ts` — 2 objects
- `src/e2e/map-harness.ts` — 2 objects
- `src/e2e/mobile-map-integration-harness.ts` — 1 object

- [ ] **Step 3: Add God's Vision layer entries**

In `src/config/gods-vision-layers.ts`, the `satellites` and `terrain` entries may already exist. Check first. Add or verify these entries exist:

```typescript
buildings: {
  name: '3D Buildings',
  category: 'aesthetic',
  enabled: false,
  description: 'Photorealistic 3D buildings (Google/Cesium OSM/Esri fallback chain)',
},
aircraft3d: {
  name: '3D Aircraft',
  category: 'spatial',
  enabled: false,
  description: 'Detailed glTF aircraft models at real altitude with heading',
},
```

Verify `satellites` entry exists. If not, add:

```typescript
satellites: {
  name: 'Satellites',
  category: 'intelligence',
  enabled: false,
  description: 'Real-time satellite positions with SGP4 orbital propagation',
},
```

- [ ] **Step 4: Run type check**

```bash
npm run typecheck:all
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/config/panels.ts src/config/variants/ src/e2e/ src/config/gods-vision-layers.ts
git commit -m "feat: add 3D buildings, satellites, aircraft3d MapLayers toggles and God's Vision config"
```

---

## Task 3: Building Tiles Service — 5-Tier Fallback Chain

**Files:**

- Create: `src/services/building-tiles.ts`

- [ ] **Step 1: Create building-tiles.ts**

```typescript
/**
 * 3D Building Tiles — 5-tier redundant fallback chain
 *
 * Tier 1: Google Photorealistic 3D Tiles (requires GOOGLE_MAPS_API_KEY)
 * Tier 2: Cesium OSM Buildings, Ion asset 96188 (requires CESIUM_ION_TOKEN)
 * Tier 3: Esri I3S global building scene layer (free, no key)
 * Tier 4: No 3D buildings on globe
 * Tier 5: Flat rendering (current state)
 */

import {
  Cesium3DTileset,
  I3SDataProvider,
  type Viewer,
} from 'cesium';
import { getRuntimeConfigSnapshot } from '@/services/runtime-config';

export type BuildingTier = 1 | 2 | 3 | 4 | 5;

export interface BuildingTileState {
  currentTier: BuildingTier;
  providerName: string;
  tileset: Cesium3DTileset | null;
}

const TIER_NAMES: Record<BuildingTier, string> = {
  1: 'Google Photorealistic 3D Tiles',
  2: 'Cesium OSM Buildings',
  3: 'Esri I3S Buildings',
  4: 'No 3D Buildings',
  5: 'Flat Rendering',
};

export class BuildingTileManager {
  private viewer: Viewer;
  private tileset: Cesium3DTileset | null = null;
  private i3sProvider: I3SDataProvider | null = null;
  private _currentTier: BuildingTier = 5;

  constructor(viewer: Viewer) {
 this.viewer = viewer;
  }

  get currentTier(): BuildingTier {
 return this._currentTier;
  }

  get providerName(): string {
 return TIER_NAMES[this._currentTier];
  }

  async initialize(): Promise<void> {
 // Tier 1: Google Photorealistic 3D Tiles
 const googleKey = getRuntimeConfigSnapshot().secrets.GOOGLE_MAPS_API_KEY?.value;
 if (googleKey) {
 try {
 this.tileset = await Cesium3DTileset.fromUrl(
 `https://tile.googleapis.com/v1/3dtiles/root.json?key=${googleKey}`
 );
 this.viewer.scene.primitives.add(this.tileset);
 this._currentTier = 1;
 return;
 } catch (error) {
 console.warn('[BuildingTiles] Google 3D Tiles failed, trying Cesium OSM:', error);
 }
 }

 // Tier 2: Cesium OSM Buildings (Ion asset 96188)
 const ionToken = getRuntimeConfigSnapshot().secrets.CESIUM_ION_TOKEN?.value;
 if (ionToken) {
 try {
 this.tileset = await Cesium3DTileset.fromIonAssetId(96188);
 this.viewer.scene.primitives.add(this.tileset);
 this._currentTier = 2;
 return;
 } catch (error) {
 console.warn('[BuildingTiles] Cesium OSM Buildings failed, trying Esri I3S:', error);
 }
 }

 // Tier 3: Esri I3S global building scene layer
 try {
 this.i3sProvider = await I3SDataProvider.fromUrl(
 'https://tiles.arcgis.com/tiles/z2tnIkrLQ2BRzr6P/arcgis/rest/services/SanFrancisco_3DObjects_1702963/SceneServer/layers/0'
 );
 this.viewer.scene.primitives.add(this.i3sProvider);
 this._currentTier = 3;
 return;
 } catch (error) {
 console.warn('[BuildingTiles] Esri I3S failed, no 3D buildings available:', error);
 }

 // Tier 4/5: No 3D buildings
 this._currentTier = 4;
  }

  destroy(): void {
 if (this.tileset) {
 this.viewer.scene.primitives.remove(this.tileset);
 this.tileset = null;
 }
 if (this.i3sProvider) {
 this.viewer.scene.primitives.remove(this.i3sProvider);
 this.i3sProvider = null;
 }
 this._currentTier = 5;
  }
}
```

- [ ] **Step 2: Run type check**

```bash
npm run typecheck:all
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/services/building-tiles.ts
git commit -m "feat: add BuildingTileManager with 5-tier redundant fallback chain"
```

---

## Task 4: 3D Building Extrusions on 2D Map (MapLibre)

**Files:**

- Modify: `src/components/DeckGLMap.ts` — add fill-extrusion layer management

- [ ] **Step 1: Add building extrusion sync method**

In `src/components/DeckGLMap.ts`, add a new method near the existing `syncWeatherRasterLayers()` method:

```typescript
private syncBuildingExtrusions(): void {
  if (!this.maplibreMap) return;
  const map = this.maplibreMap;
  const enabled = this.state.layers.buildings3d;
  const layerId = 'wm-3d-buildings';
  const zoom = map.getZoom();

  if (!enabled || zoom < 14) {
 if (map.getLayer(layerId)) {
 map.setLayoutProperty(layerId, 'visibility', 'none');
 }
 return;
  }

  if (!map.getLayer(layerId)) {
 // Insert below labels
 const firstSymbolId = map.getStyle()?.layers?.find(l => l.type === 'symbol')?.id;
 map.addLayer(
 {
 id: layerId,
 type: 'fill-extrusion',
 source: 'carto',
 'source-layer': 'building',
 minzoom: 14,
 paint: {
 'fill-extrusion-color': this.activeBaseMap === 'light' ? '#c8c8c8' : '#1a2744',
 'fill-extrusion-height': ['get', 'render_height'],
 'fill-extrusion-base': ['get', 'render_min_height'],
 'fill-extrusion-opacity': [
 'interpolate', ['linear'], ['zoom'],
 14, 0,
 15, 0.7,
 ],
 },
 },
 firstSymbolId,
 );
  } else {
 map.setLayoutProperty(layerId, 'visibility', 'visible');
  }
}
```

- [ ] **Step 2: Call from updateLayers**

In the `updateLayers()` method, add after the `this.syncWeatherRasterLayers();` call:

```typescript
this.syncBuildingExtrusions();
```

- [ ] **Step 3: Handle basemap style changes**

The existing `switchBasemap()` method calls `setStyle()` which removes all layers. The `style.load` handler already calls `this.render()` which triggers `updateLayers()` → `syncBuildingExtrusions()`, so buildings will be re-added automatically. No change needed.

- [ ] **Step 4: Run type check**

```bash
npm run typecheck:all
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/DeckGLMap.ts
git commit -m "feat: add 3D building extrusions on 2D map via MapLibre fill-extrusion"
```

---

## Task 5: Integrate BuildingTileManager into God's Vision Globe

**Files:**

- Modify: `src/components/GlobeDataManager.ts` — add building tile loading
- Modify: `src/components/CesiumGlobe.ts` — expose viewer for building manager

- [ ] **Step 1: Add building tiles to GlobeDataManager**

In `src/components/GlobeDataManager.ts`, add import at top:

```typescript
import { BuildingTileManager } from '@/services/building-tiles';
```

Add field to class:

```typescript
private buildingManager: BuildingTileManager | null = null;
```

In `initialize()`, after the weather layer registrations and before the `for (const name of this.layers.keys())` loop, add:

```typescript
// 3D Building tiles (managed separately — uses Cesium primitives, not data sources)
this.buildingManager = new BuildingTileManager(this.viewer);
void this.buildingManager.initialize();
```

In `destroy()`, add before `this.layers.clear()`:

```typescript
this.buildingManager?.destroy();
this.buildingManager = null;
```

Add public method:

```typescript
getBuildingTier(): string {
  return this.buildingManager?.providerName ?? 'Not loaded';
}
```

- [ ] **Step 2: Run type check**

```bash
npm run typecheck:all
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/GlobeDataManager.ts
git commit -m "feat: integrate BuildingTileManager into God's Vision globe"
```

---

## Task 6: Model Loader Service

**Files:**

- Create: `src/services/model-loader.ts`

- [ ] **Step 1: Create model-loader.ts**

```typescript
/**
 * 3D Aircraft Model Loader — glTF/glb cache with type-to-model mapping
 *
 * Lazy-loads aircraft models from public/models/aircraft/ on first use.
 * Deduplicates in-flight fetch requests. Caches ArrayBuffer in memory.
 */

import type { MilitaryAircraftType } from '@/types';

export interface AircraftModel {
  url: string;
  buffer: ArrayBuffer;
}

const MODEL_BASE = '/models/aircraft';

/** Maps MilitaryAircraftType to glb filename */
const MILITARY_MODEL_MAP: Record<MilitaryAircraftType, string> = {
  fighter: 'f16.glb',
  bomber: 'b52.glb',
  transport: 'c17.glb',
  tanker: 'kc135.glb',
  awacs: 'e3.glb',
  reconnaissance: 'e3.glb',
  helicopter: 'blackhawk.glb',
  drone: 'mq9.glb',
  patrol: 'c130.glb',
  special_ops: 'c130.glb',
  vip: 'generic-jet.glb',
  unknown: 'generic-arrow.glb',
};

/** Maps common ICAO type designators to glb filename */
const ICAO_MODEL_MAP: Record<string, string> = {
  B738: 'b737.glb',
  B739: 'b737.glb',
  B737: 'b737.glb',
  A320: 'a320.glb',
  A321: 'a320.glb',
  A319: 'a320.glb',
  B77W: 'generic-widebody.glb',
  B772: 'generic-widebody.glb',
  B788: 'generic-widebody.glb',
  A332: 'generic-widebody.glb',
  A333: 'generic-widebody.glb',
  A388: 'generic-widebody.glb',
  C17:  'c17.glb',
  C130: 'c130.glb',
  C5M:  'c17.glb',
  F16:  'f16.glb',
  F15:  'f16.glb',
  F35:  'f35.glb',
  B52H: 'b52.glb',
  H60:  'blackhawk.glb',
  AH64: 'apache.glb',
  V22:  'generic-arrow.glb',
};

const FALLBACK_MODEL = 'generic-arrow.glb';

class ModelLoaderSingleton {
  private cache = new Map<string, Promise<ArrayBuffer>>();

  /** Get the glb URL for a military aircraft type */
  getUrlForMilitary(type: MilitaryAircraftType): string {
 const file = MILITARY_MODEL_MAP[type] ?? FALLBACK_MODEL;
 return `${MODEL_BASE}/${file}`;
  }

  /** Get the glb URL for an ICAO type designator */
  getUrlForIcao(typeCode: string): string {
 const file = ICAO_MODEL_MAP[typeCode.toUpperCase()] ?? FALLBACK_MODEL;
 return `${MODEL_BASE}/${file}`;
  }

  /** Get the fallback model URL */
  getFallbackUrl(): string {
 return `${MODEL_BASE}/${FALLBACK_MODEL}`;
  }

  /** Fetch and cache a glb model by URL */
  async loadModel(url: string): Promise<ArrayBuffer> {
 const existing = this.cache.get(url);
 if (existing) return existing;

 const promise = fetch(url)
 .then(res => {
 if (!res.ok) throw new Error(`Model fetch failed: ${url} (${String(res.status)})`);
 return res.arrayBuffer();
 })
 .catch(error => {
 this.cache.delete(url);
 throw error;
 });

 this.cache.set(url, promise);
 return promise;
  }

  /** Preload a set of commonly used models */
  preload(urls: string[]): void {
 for (const url of urls) {
 void this.loadModel(url);
 }
  }
}

export const modelLoader = new ModelLoaderSingleton();
```

- [ ] **Step 2: Create placeholder model directory**

```bash
mkdir -p public/models/aircraft
```

Create a simple placeholder file so the directory is tracked:

```bash
echo '# Aircraft 3D Models\n\nPlace .glb files here. See docs/superpowers/specs/2026-04-06-3d-immersive-upgrade-design.md for model inventory.' > public/models/aircraft/README.md
```

- [ ] **Step 3: Run type check**

```bash
npm run typecheck:all
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/services/model-loader.ts public/models/aircraft/README.md
git commit -m "feat: add ModelLoader service with type-to-glTF mapping and lazy caching"
```

---

## Task 7: Satellite Catalog Service

**Files:**

- Create: `src/services/satellite-catalog.ts`

- [ ] **Step 1: Create satellite-catalog.ts**

```typescript
/**
 * Satellite Catalog — TLE data from CelesTrak + intelligence annotations
 *
 * Fetches active satellite TLEs from CelesTrak GP API (free, no key).
 * Annotates notable objects (ISS, spy sats, GPS, Starlink, military).
 * Refresh interval: 4 hours. Circuit breaker with persistent cache.
 */

import { createCircuitBreaker } from '@/utils';

export interface SatelliteTLE {
  noradId: number;
  name: string;
  line1: string;
  line2: string;
  classification: SatelliteClassification;
  annotation: SatelliteAnnotation | null;
}

export type SatelliteClassification =
  | 'notable' // ISS, spy sats, early warning — always rendered + labeled
  | 'military'  // Kosmos, Yaogan, NROL — rendered with intel styling
  | 'constellation' // GPS, Starlink, Iridium — rendered dimly, clustered
  | 'normal'; // Everything else — small gray dot

export interface SatelliteAnnotation {
  category: string;
  label: string;
  color: [number, number, number];  // RGB
  priority: number; // Lower = more important, rendered on top
}

const CELESTRAK_URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json';

interface CelesTrakGP {
  OBJECT_NAME: string;
  NORAD_CAT_ID: number;
  TLE_LINE1: string;
  TLE_LINE2: string;
}

const breaker = createCircuitBreaker<SatelliteTLE[]>({
  name: 'SatelliteCatalog',
  cacheTtlMs: 4 * 60 * 60 * 1000,
  persistCache: true,
});

export async function fetchSatelliteCatalog(): Promise<SatelliteTLE[]> {
  return breaker.execute(async () => {
 const res = await fetch(CELESTRAK_URL, {
 signal: AbortSignal.timeout(30_000),
 });
 if (!res.ok) throw new Error(`CelesTrak HTTP ${String(res.status)}`);

 const data = await res.json() as CelesTrakGP[];

 return data.map(sat => ({
 noradId: sat.NORAD_CAT_ID,
 name: sat.OBJECT_NAME,
 line1: sat.TLE_LINE1,
 line2: sat.TLE_LINE2,
 classification: classifySatellite(sat.OBJECT_NAME, sat.NORAD_CAT_ID),
 annotation: annotateSatellite(sat.OBJECT_NAME, sat.NORAD_CAT_ID),
 }));
  }, []);
}

/** Get only notable + military satellites for low-zoom rendering */
export function filterNotable(catalog: SatelliteTLE[]): SatelliteTLE[] {
  return catalog.filter(s => s.classification === 'notable' || s.classification === 'military');
}

// ── Intelligence Annotation Tables ──────────────────────────────

const NOTABLE_IDS: Record<number, SatelliteAnnotation> = {
  25544: { category: 'ISS', label: 'ISS (ZARYA)', color: [255, 215, 0], priority: 1 },
  48274: { category: 'CSS', label: 'Tiangong', color: [255, 215, 0], priority: 2 },
};

interface PatternRule {
  pattern: RegExp;
  classification: SatelliteClassification;
  annotation: Omit<SatelliteAnnotation, 'label'>;
}

const NAME_PATTERNS: PatternRule[] = [
  { pattern: /^NROL-/i, classification: 'notable', annotation: { category: 'SIGINT/IMINT', color: [239, 68, 68], priority: 3 } },
  { pattern: /^USA \d+/i, classification: 'military', annotation: { category: 'US Military', color: [239, 68, 68], priority: 5 } },
  { pattern: /^SBIRS/i, classification: 'notable', annotation: { category: 'Missile Warning', color: [239, 68, 68], priority: 2 } },
  { pattern: /^DSP/i, classification: 'notable', annotation: { category: 'Missile Warning', color: [239, 68, 68], priority: 2 } },
  { pattern: /^NAVSTAR/i, classification: 'constellation', annotation: { category: 'GPS', color: [96, 165, 250], priority: 10 } },
  { pattern: /^STARLINK/i, classification: 'constellation', annotation: { category: 'Starlink', color: [120, 120, 120], priority: 50 } },
  { pattern: /^IRIDIUM/i, classification: 'constellation', annotation: { category: 'Iridium', color: [120, 120, 120], priority: 50 } },
  { pattern: /^COSMOS|^KOSMOS/i, classification: 'military', annotation: { category: 'Russian Military', color: [249, 115, 22], priority: 8 } },
  { pattern: /^LIANA/i, classification: 'military', annotation: { category: 'Russian SIGINT', color: [249, 115, 22], priority: 6 } },
  { pattern: /^YAOGAN/i, classification: 'military', annotation: { category: 'Chinese Military', color: [249, 115, 22], priority: 8 } },
  { pattern: /^SHIJIAN/i, classification: 'military', annotation: { category: 'Chinese Military', color: [249, 115, 22], priority: 8 } },
  { pattern: /^GOES-/i, classification: 'normal', annotation: { category: 'Weather (US)', color: [34, 211, 238], priority: 20 } },
  { pattern: /^JPSS/i, classification: 'normal', annotation: { category: 'Weather (US)', color: [34, 211, 238], priority: 20 } },
  { pattern: /^METEOSAT/i, classification: 'normal', annotation: { category: 'Weather (EU)', color: [34, 211, 238], priority: 20 } },
];

function classifySatellite(name: string, noradId: number): SatelliteClassification {
  if (NOTABLE_IDS[noradId]) return 'notable';
  for (const rule of NAME_PATTERNS) {
 if (rule.pattern.test(name)) return rule.classification;
  }
  return 'normal';
}

function annotateSatellite(name: string, noradId: number): SatelliteAnnotation | null {
  const byId = NOTABLE_IDS[noradId];
  if (byId) return byId;
  for (const rule of NAME_PATTERNS) {
 if (rule.pattern.test(name)) {
 return { ...rule.annotation, label: name };
 }
  }
  return null;
}
```

- [ ] **Step 2: Run type check**

```bash
npm run typecheck:all
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/services/satellite-catalog.ts
git commit -m "feat: add satellite catalog with CelesTrak TLE fetch and intelligence annotations"
```

---

## Task 8: SGP4 Propagation Web Worker

**Files:**

- Create: `src/workers/satellite-propagator.worker.ts`
- Create: `src/services/satellite-propagator.ts`

- [ ] **Step 1: Create the Web Worker**

Create `src/workers/satellite-propagator.worker.ts`:

```typescript
/**
 * Satellite SGP4 Propagation Web Worker
 *
 * Receives TLE data, propagates all satellite positions at 1Hz,
 * and posts position arrays back to the main thread.
 */

import {
  twoline2satrec,
  propagate,
  gstime,
  eciToGeodetic,
  type EciVec3,
} from 'satellite.js';

interface TLEInput {
  noradId: number;
  name: string;
  line1: string;
  line2: string;
}

interface SatellitePosition {
  noradId: number;
  lat: number;
  lon: number;
  altKm: number;
  velocityKmS: number;
}

interface OrbitPathRequest {
  noradId: number;
  line1: string;
  line2: string;
  durationMinutes: number;
}

type WorkerMessage =
  | { type: 'loadTLEs'; tles: TLEInput[] }
  | { type: 'requestOrbitPath'; request: OrbitPathRequest }
  | { type: 'stop' };

let tles: TLEInput[] = [];
let intervalId: ReturnType<typeof setInterval> | null = null;

function propagateAll(): void {
  const now = new Date();
  const gmst = gstime(now);
  const positions: SatellitePosition[] = [];

  for (const tle of tles) {
 try {
 const satrec = twoline2satrec(tle.line1, tle.line2);
 const result = propagate(satrec, now);
 if (!result.position || typeof result.position === 'boolean') continue;

 const posEci = result.position as EciVec3<number>;
 const velEci = result.velocity as EciVec3<number> | false;
 const geo = eciToGeodetic(posEci, gmst);

 let velocity = 0;
 if (velEci && typeof velEci !== 'boolean') {
 velocity = Math.sqrt(velEci.x ** 2 + velEci.y ** 2 + velEci.z ** 2);
 }

 const latDeg = geo.latitude * (180 / Math.PI);
 const lonDeg = geo.longitude * (180 / Math.PI);
 const altKm = geo.height;

 positions.push({
 noradId: tle.noradId,
 lat: latDeg,
 lon: lonDeg,
 altKm,
 velocityKmS: velocity,
 });
 } catch {
 // Skip satellites with bad TLEs
 }
  }

  self.postMessage({ type: 'positions', positions });
}

function computeOrbitPath(req: OrbitPathRequest): void {
  const satrec = twoline2satrec(req.line1, req.line2);
  const points: [number, number, number][] = [];
  const now = Date.now();
  const stepMs = 60_000; // 1-minute steps
  const steps = req.durationMinutes;

  for (let i = 0; i <= steps; i++) {
 const time = new Date(now + i * stepMs);
 const gmst = gstime(time);
 const result = propagate(satrec, time);
 if (!result.position || typeof result.position === 'boolean') continue;

 const geo = eciToGeodetic(result.position as EciVec3<number>, gmst);
 points.push([
 geo.longitude * (180 / Math.PI),
 geo.latitude * (180 / Math.PI),
 geo.height,
 ]);
  }

  self.postMessage({ type: 'orbitPath', noradId: req.noradId, points });
}

self.addEventListener('message', (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;

  if (msg.type === 'loadTLEs') {
 tles = msg.tles;
 // Start 1Hz propagation
 if (intervalId != null) clearInterval(intervalId);
 propagateAll(); // Immediate first tick
 intervalId = setInterval(propagateAll, 1000);
  }

  if (msg.type === 'requestOrbitPath') {
 computeOrbitPath(msg.request);
  }

  if (msg.type === 'stop') {
 if (intervalId != null) clearInterval(intervalId);
 intervalId = null;
 tles = [];
  }
});
```

- [ ] **Step 2: Create the main-thread API**

Create `src/services/satellite-propagator.ts`:

```typescript
/**
 * Satellite Propagator — main-thread API wrapping the SGP4 Web Worker
 *
 * Sends TLE data to the worker, receives position updates at 1Hz,
 * and dispatches them to registered listeners.
 */

import type { SatelliteTLE } from '@/services/satellite-catalog';

export interface SatellitePosition {
  noradId: number;
  lat: number;
  lon: number;
  altKm: number;
  velocityKmS: number;
}

export interface OrbitPath {
  noradId: number;
  points: [number, number, number][]; // [lon, lat, altKm]
}

type PositionListener = (positions: SatellitePosition[]) => void;
type OrbitPathListener = (path: OrbitPath) => void;

class SatellitePropagator {
  private worker: Worker | null = null;
  private positionListeners: PositionListener[] = [];
  private orbitPathListeners: OrbitPathListener[] = [];
  private latestPositions: SatellitePosition[] = [];

  start(catalog: SatelliteTLE[]): void {
 this.stop();

 this.worker = new Worker(
 new URL('@/workers/satellite-propagator.worker.ts', import.meta.url),
 { type: 'module' },
 );

 this.worker.addEventListener('message', (e: MessageEvent) => {
 const msg = e.data as { type: string; positions?: SatellitePosition[]; noradId?: number; points?: [number, number, number][] };

 if (msg.type === 'positions' && msg.positions) {
 this.latestPositions = msg.positions;
 for (const listener of this.positionListeners) {
 listener(msg.positions);
 }
 }

 if (msg.type === 'orbitPath' && msg.noradId != null && msg.points) {
 const path: OrbitPath = { noradId: msg.noradId, points: msg.points };
 for (const listener of this.orbitPathListeners) {
 listener(path);
 }
 }
 });

 this.worker.postMessage({
 type: 'loadTLEs',
 tles: catalog.map(s => ({
 noradId: s.noradId,
 name: s.name,
 line1: s.line1,
 line2: s.line2,
 })),
 });
  }

  stop(): void {
 if (this.worker) {
 this.worker.postMessage({ type: 'stop' });
 this.worker.terminate();
 this.worker = null;
 }
 this.latestPositions = [];
  }

  requestOrbitPath(satellite: SatelliteTLE, durationMinutes = 90): void {
 this.worker?.postMessage({
 type: 'requestOrbitPath',
 request: {
 noradId: satellite.noradId,
 line1: satellite.line1,
 line2: satellite.line2,
 durationMinutes,
 },
 });
  }

  onPositions(listener: PositionListener): () => void {
 this.positionListeners.push(listener);
 return () => {
 this.positionListeners = this.positionListeners.filter(l => l !== listener);
 };
  }

  onOrbitPath(listener: OrbitPathListener): () => void {
 this.orbitPathListeners.push(listener);
 return () => {
 this.orbitPathListeners = this.orbitPathListeners.filter(l => l !== listener);
 };
  }

  getLatestPositions(): SatellitePosition[] {
 return this.latestPositions;
  }
}

export const satellitePropagator = new SatellitePropagator();
```

- [ ] **Step 3: Run type check**

```bash
npm run typecheck:all
```

Expected: PASS (satellite.js types should be included via the npm package)

- [ ] **Step 4: Commit**

```bash
git add src/workers/satellite-propagator.worker.ts src/services/satellite-propagator.ts
git commit -m "feat: add SGP4 satellite propagation Web Worker with 1Hz position updates"
```

---

## Task 9: Satellite Layers on DeckGL 2D Map

**Files:**

- Modify: `src/components/DeckGLMap.ts` — add satellite ScatterplotLayer, TextLayer, PathLayer
- Modify: `src/components/MapContainer.ts` — add proxy setter

- [ ] **Step 1: Add satellite state and imports to DeckGLMap**

In `src/components/DeckGLMap.ts`, add import:

```typescript
import type { SatellitePosition, OrbitPath } from '@/services/satellite-propagator';
import type { SatelliteTLE } from '@/services/satellite-catalog';
import { filterNotable } from '@/services/satellite-catalog';
```

Add class fields:

```typescript
private satellitePositions: SatellitePosition[] = [];
private satelliteCatalog: SatelliteTLE[] = [];
private selectedOrbitPath: OrbitPath | null = null;
```

- [ ] **Step 2: Add satellite layers in buildLayers()**

Add after the red flag warnings block in `buildLayers()`:

```typescript
// Satellite ground positions
if (mapLayers.satellites && this.satellitePositions.length > 0) {
  layers.push(this.createSatelliteLayer());
  layers.push(this.createSatelliteLabelLayer());
  if (this.selectedOrbitPath) {
 layers.push(this.createSatelliteOrbitLayer());
  }
}
```

- [ ] **Step 3: Add satellite layer creation methods**

Add near the other layer creation methods:

```typescript
private createSatelliteLayer(): ScatterplotLayer {
  const zoom = this.maplibreMap?.getZoom() ?? 0;
  const notable = this.satelliteCatalog.length > 0
 ? new Set(filterNotable(this.satelliteCatalog).map(s => s.noradId))
 : new Set<number>();

  // At low zoom, only show notable satellites
  const data = zoom < 3
 ? this.satellitePositions.filter(s => notable.has(s.noradId))
 : this.satellitePositions;

  return new ScatterplotLayer({
 id: 'satellite-positions',
 data,
 getPosition: (d: SatellitePosition) => [d.lon, d.lat],
 getRadius: (d: SatellitePosition) => notable.has(d.noradId) ? 20_000 : 8_000,
 getFillColor: (d: SatellitePosition) => {
 const cat = this.satelliteCatalog.find(s => s.noradId === d.noradId);
 if (cat?.annotation) return [...cat.annotation.color, 200] as [number, number, number, number];
 return [150, 150, 150, 100];
 },
 radiusUnits: 'meters' as const,
 radiusMinPixels: 1,
 radiusMaxPixels: 6,
 pickable: true,
  });
}

private createSatelliteLabelLayer(): TextLayer {
  const notable = this.satelliteCatalog.filter(s => s.annotation && s.classification !== 'constellation');
  const notableIds = new Set(notable.map(s => s.noradId));
  const labeled = this.satellitePositions.filter(s => notableIds.has(s.noradId));

  return new TextLayer({
 id: 'satellite-labels',
 data: labeled,
 getPosition: (d: SatellitePosition) => [d.lon, d.lat],
 getText: (d: SatellitePosition) => {
 const cat = this.satelliteCatalog.find(s => s.noradId === d.noradId);
 return cat?.annotation?.label ?? '';
 },
 getSize: 10,
 getColor: [255, 255, 255, 180],
 getTextAnchor: 'start' as const,
 getAlignmentBaseline: 'center' as const,
 getPixelOffset: [8, 0],
 fontFamily: 'monospace',
 billboard: true,
  });
}

private createSatelliteOrbitLayer(): PathLayer {
  if (!this.selectedOrbitPath) return new PathLayer({ id: 'satellite-orbit', data: [] });
  return new PathLayer({
 id: 'satellite-orbit',
 data: [{ path: this.selectedOrbitPath.points.map(p => [p[0], p[1]]) }],
 getPath: (d: { path: [number, number][] }) => d.path,
 getColor: [255, 215, 0, 150],
 getWidth: 2,
 widthUnits: 'pixels' as const,
  });
}
```

- [ ] **Step 4: Add setter methods**

```typescript
public setSatellitePositions(positions: SatellitePosition[], catalog: SatelliteTLE[]): void {
  this.satellitePositions = positions;
  this.satelliteCatalog = catalog;
  this.rafUpdateLayers();
}

public setSelectedOrbitPath(path: OrbitPath | null): void {
  this.selectedOrbitPath = path;
  this.rafUpdateLayers();
}
```

- [ ] **Step 5: Add MapContainer proxy**

In `src/components/MapContainer.ts`, add:

```typescript
public setSatellitePositions(positions: import('@/services/satellite-propagator').SatellitePosition[], catalog: import('@/services/satellite-catalog').SatelliteTLE[]): void {
  if (this.useDeckGL) {
 this.deckGLMap?.setSatellitePositions(positions, catalog);
  }
}

public setSelectedOrbitPath(path: import('@/services/satellite-propagator').OrbitPath | null): void {
  if (this.useDeckGL) {
 this.deckGLMap?.setSelectedOrbitPath(path);
  }
}
```

- [ ] **Step 6: Run type check**

```bash
npm run typecheck:all
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/components/DeckGLMap.ts src/components/MapContainer.ts
git commit -m "feat: add satellite position, label, and orbit path layers to 2D map"
```

---

## Task 10: Satellite Layers on God's Vision Globe

**Files:**

- Modify: `src/components/GlobeDataManager.ts` — add satellite primitives

- [ ] **Step 1: Add satellite imports and fields**

In `src/components/GlobeDataManager.ts`, add to Cesium imports:

```typescript
PointPrimitiveCollection,
PolylineCollection,
```

Add import:

```typescript
import { fetchSatelliteCatalog, filterNotable, type SatelliteTLE } from '@/services/satellite-catalog';
import { satellitePropagator, type SatellitePosition } from '@/services/satellite-propagator';
```

Add class fields:

```typescript
private satellitePoints: InstanceType<typeof PointPrimitiveCollection> | null = null;
private orbitLines: InstanceType<typeof PolylineCollection> | null = null;
private satelliteCatalog: SatelliteTLE[] = [];
private unsubPositions: (() => void) | null = null;
```

- [ ] **Step 2: Add satellite layer registration in initialize()**

In `initialize()`, add after the weather layers:

```typescript
// Satellites (managed via PointPrimitiveCollection for performance, not data sources)
void this.initSatellites();
```

- [ ] **Step 3: Add satellite initialization method**

```typescript
private async initSatellites(): Promise<void> {
  try {
 this.satelliteCatalog = await fetchSatelliteCatalog();
 if (this.satelliteCatalog.length === 0) return;

 this.satellitePoints = new PointPrimitiveCollection();
 this.viewer.scene.primitives.add(this.satellitePoints);

 this.orbitLines = new PolylineCollection();
 this.viewer.scene.primitives.add(this.orbitLines);

 satellitePropagator.start(this.satelliteCatalog);

 this.unsubPositions = satellitePropagator.onPositions((positions) => {
 this.updateSatellitePositions(positions);
 });
  } catch (error) {
 console.warn('[GlobeDataManager] Satellite init failed:', error);
  }
}

private updateSatellitePositions(positions: SatellitePosition[]): void {
  if (!this.satellitePoints) return;
  this.satellitePoints.removeAll();

  const notableIds = new Set(filterNotable(this.satelliteCatalog).map(s => s.noradId));

  for (const pos of positions) {
 const isNotable = notableIds.has(pos.noradId);
 const cat = this.satelliteCatalog.find(s => s.noradId === pos.noradId);
 const rgb = cat?.annotation?.color ?? [150, 150, 150];

 this.satellitePoints.add({
 position: Cartesian3.fromDegrees(pos.lon, pos.lat, pos.altKm * 1000),
 pixelSize: isNotable ? 4 : 1.5,
 color: Color.fromBytes(rgb[0], rgb[1], rgb[2], isNotable ? 255 : 80),
 });
  }
}
```

- [ ] **Step 4: Clean up in destroy()**

Add to `destroy()`:

```typescript
this.unsubPositions?.();
this.unsubPositions = null;
satellitePropagator.stop();
if (this.satellitePoints) {
  this.viewer.scene.primitives.remove(this.satellitePoints);
  this.satellitePoints = null;
}
if (this.orbitLines) {
  this.viewer.scene.primitives.remove(this.orbitLines);
  this.orbitLines = null;
}
```

- [ ] **Step 5: Run type check**

```bash
npm run typecheck:all
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/GlobeDataManager.ts
git commit -m "feat: add real-time satellite visualization on God's Vision globe with SGP4 propagation"
```

---

## Task 11: Wire Satellite Data Loader

**Files:**

- Modify: `src/app/data-loader.ts` — add satellite catalog loading and worker lifecycle

- [ ] **Step 1: Add imports**

In `src/app/data-loader.ts`, add:

```typescript
import { fetchSatelliteCatalog } from '@/services/satellite-catalog';
import { satellitePropagator } from '@/services/satellite-propagator';
```

- [ ] **Step 2: Add task scheduling**

After the existing weather task entries (around line 607), add:

```typescript
if (SITE_VARIANT === 'full') tasks.push({ name: 'satellites', task: runGuarded('satellites', () => this.loadSatellites()) });
```

- [ ] **Step 3: Add loader method**

Add near the other weather loader methods:

```typescript
async loadSatellites(): Promise<void> {
  try {
 const catalog = await fetchSatelliteCatalog();
 if (catalog.length === 0) return;

 satellitePropagator.start(catalog);
 satellitePropagator.onPositions((positions) => {
 this.ctx.map?.setSatellitePositions(positions, catalog);
 });
  } catch (error) {
 console.warn('[satellites] fetch failed', error);
  }
}
```

- [ ] **Step 4: Run type check**

```bash
npm run typecheck:all
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/data-loader.ts
git commit -m "feat: wire satellite catalog fetch and propagator to data loader"
```

---

## Task 12: 3D Aircraft on DeckGL (SimpleMeshLayer)

**Files:**

- Modify: `src/components/DeckGLMap.ts` — add SimpleMeshLayer for aircraft

- [ ] **Step 1: Add SimpleMeshLayer import**

In `src/components/DeckGLMap.ts`, add:

```typescript
import { SimpleMeshLayer } from '@deck.gl/mesh-layers';
import { modelLoader } from '@/services/model-loader';
```

- [ ] **Step 2: Modify existing military flights rendering in buildLayers()**

Find the existing military flights layer block. Add a zoom-gated branch that uses 3D models when `aircraft3d` is enabled:

```typescript
// Military flights layer — 3D models when aircraft3d enabled and zoom > 5
if (mapLayers.military && filteredMilitaryFlights.length > 0) {
  if (mapLayers.aircraft3d && (this.maplibreMap?.getZoom() ?? 0) >= 5) {
 layers.push(this.createMilitary3DFlightsLayer(filteredMilitaryFlights));
  } else {
 layers.push(this.createMilitaryFlightsLayer(filteredMilitaryFlights));
  }
}
```

- [ ] **Step 3: Add 3D military flights layer method**

```typescript
private createMilitary3DFlightsLayer(flights: MilitaryFlight[]): SimpleMeshLayer<MilitaryFlight> {
  const data = flights.slice(0, 200); // Max 200 mesh instances
  const fallbackUrl = modelLoader.getFallbackUrl();

  return new SimpleMeshLayer<MilitaryFlight>({
 id: 'military-flights-3d',
 data,
 mesh: fallbackUrl,
 getPosition: (d) => [d.lon, d.lat, d.altitude * 0.3048], // feet to meters
 getOrientation: (d) => [0, -d.heading, 0], // pitch, yaw, roll
 getColor: (d) => {
 if (d.operator === 'usaf' || d.operator === 'usn' || d.operator === 'usa' || d.operator === 'usmc') return [52, 211, 153, 255];
 if (d.operatorCountry === 'Russia') return [248, 113, 113, 255];
 if (d.operatorCountry === 'China') return [251, 191, 36, 255];
 return [129, 140, 248, 255];
 },
 sizeScale: 500,
 pickable: true,
  });
}
```

Note: `SimpleMeshLayer` accepts a URL string for the `mesh` prop and loads it internally. The `modelLoader` provides the URL mapping but SimpleMeshLayer handles the actual fetch. For type-specific models, we use the fallback URL initially — specific model assignment per aircraft type requires loading the mesh as a luma.gl `Geometry` object, which is a follow-up enhancement. The fallback arrow shape gives immediate 3D directionality.

- [ ] **Step 4: Similarly for ADS-B flights in buildLayers()**

Find the ADS-B layer block and add the 3D branch:

```typescript
// ADS-B live aircraft layer — 3D when aircraft3d enabled and zoom > 5
if (mapLayers.adsb && this.adsbFlights.length > 0) {
  if (mapLayers.aircraft3d && (this.maplibreMap?.getZoom() ?? 0) >= 5) {
 layers.push(this.createAdsb3DLayer());
  } else {
 layers.push(this.createAdsbLayer());
  }
}
```

- [ ] **Step 5: Add 3D ADS-B layer method**

```typescript
private createAdsb3DLayer(): SimpleMeshLayer {
  const data = this.adsbFlights.slice(0, 200);
  const fallbackUrl = modelLoader.getFallbackUrl();

  return new SimpleMeshLayer({
 id: 'adsb-flights-3d',
 data,
 mesh: fallbackUrl,
 getPosition: (d: typeof this.adsbFlights[0]) => [d.lon, d.lat, (d.altitude ?? 0) * 0.3048],
 getOrientation: (d: typeof this.adsbFlights[0]) => [0, -(d.heading ?? 0), 0],
 getColor: [200, 200, 200, 200],
 sizeScale: 300,
 pickable: true,
  });
}
```

- [ ] **Step 6: Run type check and lint**

```bash
npm run typecheck:all
npx eslint src/components/DeckGLMap.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/components/DeckGLMap.ts
git commit -m "feat: add 3D aircraft rendering with SimpleMeshLayer on 2D map"
```

---

## Task 13: 3D Aircraft on God's Vision Globe (ModelGraphics)

**Files:**

- Modify: `src/components/GlobeDataManager.ts` — replace billboard with ModelGraphics for flights

- [ ] **Step 1: Add Cesium Model imports**

In `src/components/GlobeDataManager.ts`, add to Cesium imports:

```typescript
HeadingPitchRoll,
Transforms,
```

Add import:

```typescript
import { modelLoader } from '@/services/model-loader';
```

- [ ] **Step 2: Modify loadMilitaryFlights()**

Find the existing `loadMilitaryFlights()` method. Replace the billboard entity creation with ModelGraphics for each flight entity. The key change is using `model` instead of `billboard`:

```typescript
// In the entity creation loop, replace billboard with:
const modelUrl = modelLoader.getUrlForMilitary(flight.aircraftType);

layer.source.entities.add({
  position: Cartesian3.fromDegrees(flight.lon, flight.lat, flight.altitude * 0.3048),
  orientation: Transforms.headingPitchRollQuaternion(
 Cartesian3.fromDegrees(flight.lon, flight.lat, flight.altitude * 0.3048),
 new HeadingPitchRoll(
 CesiumMath.toRadians(flight.heading),
 0,
 0,
 ),
  ) as unknown as import('cesium').Property,
  model: {
 uri: modelUrl,
 minimumPixelSize: 24,
 maximumScale: 5000,
 color: flightColor, // existing color variable
 colorBlendMode: 2, // ColorBlendMode.MIX
 colorBlendAmount: 0.5,
  },
  label: existingLabelConfig, // keep existing label
  description: existingDescription, // keep existing description
});
```

Note: The exact integration depends on the current entity creation code in `loadMilitaryFlights()`. Preserve existing label and description properties — only replace `billboard` with `model` and add `orientation`. If the current code does not have altitude positioning, add it.

- [ ] **Step 3: Run type check**

```bash
npm run typecheck:all
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/GlobeDataManager.ts
git commit -m "feat: replace flight billboard icons with 3D glTF models on God's Vision globe"
```

---

## Task 14: Create Placeholder Aircraft Models

**Files:**

- Create: `public/models/aircraft/generic-arrow.glb`

- [ ] **Step 1: Generate a minimal arrow glTF model**

Create a simple script to generate a minimal arrow-shaped glb (a cone/arrow pointing forward along the Y axis). This can be done with Three.js at build time, or we can use a pre-built minimal arrow.

For now, source a CC0 low-poly arrow/aircraft model from Sketchfab or create a minimal one:

```bash
# Download a CC0 arrow model placeholder
# This URL is a placeholder — source actual CC0 models from:
# - https://nasa3d.arc.nasa.gov/models (public domain)
# - https://sketchfab.com/search?type=models&licenses=cc0&q=aircraft
# Place downloaded .glb files in public/models/aircraft/
```

At minimum, create `generic-arrow.glb` so the app doesn't 404 when trying to load models. The implementing engineer should source and add the full model set from the spec (F-16, B-52, C-17, etc.).

- [ ] **Step 2: Update README with model sources**

Update `public/models/aircraft/README.md` to list actual model files and their sources/licenses.

- [ ] **Step 3: Commit**

```bash
git add public/models/aircraft/
git commit -m "feat: add placeholder aircraft 3D models"
```

---

## Task 15: Update Documentation

**Files:**

- Modify: `docs/API_KEYS.md` — add GOOGLE_MAPS_API_KEY
- Modify: `docs/README.md` — update feature counts
- Modify: `docs/DESKTOP_CONFIGURATION.md` — add 3D degradation notes
- Copy: `~/Documents/Crystal Ball API Keys.md`

- [ ] **Step 1: Update API_KEYS.md**

Add a new entry for GOOGLE_MAPS_API_KEY with description of the free tier, signup URL, and what it enables (photorealistic 3D buildings). Also note it falls back to Cesium OSM Buildings and Esri I3S without a key.

- [ ] **Step 2: Update README.md**

Update feature counts and add a Technical Highlight about 3D visualization (buildings, aircraft models, satellite tracking).

- [ ] **Step 3: Update DESKTOP_CONFIGURATION.md**

Add a section on 3D feature degradation: what works without keys, what each key unlocks, performance guardrails.

- [ ] **Step 4: Copy to local docs**

```bash
cp docs/API_KEYS.md ~/Documents/"Crystal Ball API Keys.md"
```

- [ ] **Step 5: Commit**

```bash
git add docs/API_KEYS.md docs/README.md docs/DESKTOP_CONFIGURATION.md
git commit -m "docs: add Google Maps API key, 3D buildings, satellite tracking, and aircraft model documentation"
```

---

## Task 16: Type Check, Lint, Build, Install

- [ ] **Step 1: Full type check**

```bash
npm run typecheck:all
```

Expected: PASS

- [ ] **Step 2: Lint all modified files**

```bash
npx eslint src/services/building-tiles.ts src/services/model-loader.ts src/services/satellite-catalog.ts src/services/satellite-propagator.ts src/workers/satellite-propagator.worker.ts src/components/DeckGLMap.ts src/components/GlobeDataManager.ts src/components/MapContainer.ts src/app/data-loader.ts
```

Fix any lint errors.

- [ ] **Step 3: Build**

```bash
npm run desktop:build:full
```

Expected: Successful build at `src-tauri/target/release/bundle/macos/Crystal Ball.app`

- [ ] **Step 4: Install and launch**

```bash
pkill -x crystalball 2>/dev/null; sleep 0.5
node scripts/install-built-app.mjs --relaunch
```

- [ ] **Step 5: Push and create PR**

```bash
git push macos claude/3d-immersive-upgrade
gh pr create --title "feat: 3D immersive upgrade — buildings, aircraft, satellites" --body "..."
gh pr merge --auto --squash
```
