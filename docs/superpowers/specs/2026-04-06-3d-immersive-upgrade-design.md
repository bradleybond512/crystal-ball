# 3D Immersive Upgrade — Design Spec

**Date:** 2026-04-06
**Scope:** 3D buildings, 3D aircraft models, real-time satellite tracking
**Approach:** Unified 3D Asset Pipeline (Approach A) — shared services consumed by both DeckGL (2D map) and Cesium (God's Vision globe)

---

## 1. 3D Building Tiles — Redundant Fallback Chain

### God's Vision Globe (Cesium)

A `BuildingTileManager` class manages a 5-tier fallback chain. On initialization it tries each provider in order, skipping any that lack a configured API key or fail to load:

| Tier | Provider | Key Required | Quality |
|------|----------|-------------|---------|
| 1 | Google Photorealistic 3D Tiles | `GOOGLE_MAPS_API_KEY` | Photorealistic textured |
| 2 | Cesium OSM Buildings (Ion asset 96188) | `CESIUM_ION_TOKEN` | Geometric, worldwide |
| 3 | Esri I3S global building scene layer | None (free public layer) | Varies by city |
| 4 | No 3D buildings on globe | — | — |
| 5 | Flat rendering (current state) | — | 2D only |

If the active provider errors mid-session (quota exceeded, network failure), it auto-drops to the next tier and logs a warning. A `currentTier` property exposes which provider is active for the HUD status display.

Google Photorealistic 3D Tiles pricing: $200/month free credit (~28,500 session loads). For a personal desktop app, this covers typical usage indefinitely.

### 2D Map (MapLibre)

Add a `fill-extrusion` layer to the existing vector tile basemap. Buildings extrude based on `height` and `min_height` properties from OpenMapTiles data (already in the CARTO vector source). No API key needed.

- Activates at zoom 14+
- Fades in from 0 to full height over zooms 14-15
- Dark theme: buildings use muted blue-gray tones matching the existing palette
- Light/satellite themes: neutral gray tones

### New API Key: GOOGLE_MAPS_API_KEY

Added to:

- `SUPPORTED_SECRET_KEYS` in `src-tauri/src/main.rs`
- Feature definition in `src/services/runtime-config.ts` with `requiredSecrets: ['GOOGLE_MAPS_API_KEY']`
- Human-readable label in `src/services/settings-constants.ts`
- `docs/API_KEYS.md` documentation
- `~/Documents/Crystal Ball API Keys.md` local copy

Gated identically to `OWM_API_KEY` — fallback message explains free alternatives when no key is set.

---

## 2. 3D Aircraft Models

### Model Asset Pipeline

**Service:** `src/services/model-loader.ts`

A singleton `ModelLoader` that fetches, caches, and serves glTF models:

- Models stored in `public/models/aircraft/` as `.glb` files
- `Map<string, Promise<ArrayBuffer>>` deduplicates in-flight requests
- Models cached in memory after first load
- Lazy loading: glTF files only fetched when an aircraft of that type first appears

### Model Inventory (~15 models)

| Category | Models | Source |
|----------|--------|--------|
| Fighter | F-16, F-35, Su-27 | NASA 3D Resources / Sketchfab CC0 |
| Bomber | B-52, Tu-95 | Sketchfab CC0 |
| Transport | C-17, C-130 | NASA 3D Resources |
| Tanker | KC-135 | Sketchfab CC0 |
| Helicopter | Black Hawk, Apache | Sketchfab CC0 |
| UAV | MQ-9 Reaper | Sketchfab CC0 |
| AWACS/Recon | E-3 Sentry | Sketchfab CC0 |
| Commercial | 737, A320, Generic wide-body | Sketchfab CC0 |
| Fallback | Generic arrow/cone | Generated at build time |

All models are CC0 or public domain (NASA). The fallback generic shape is used when no specific model matches the aircraft type.

### Type-to-Model Mapping

A lookup table in `model-loader.ts` maps:

- `MilitaryAircraftType` enum values → military model files
- Common ADS-B ICAO type codes (e.g., `B738`, `A320`, `C17`) → model files
- Unknown types → generic fallback

### God's Vision Globe (Cesium)

Each flight entity uses `ModelGraphics` instead of the current `Billboard`:

- Position at real altitude: `Cartesian3.fromDegrees(lon, lat, altitudeMeters)`
- Orientation from flight data: `HeadingPitchRoll(heading, pitch, roll)`
- Scale normalized: visible at globe zoom but not absurdly large
- `scaleByDistance` via `NearFarScalar` keeps them legible from orbit to city level
- Model color tinted by operator country (existing color scheme preserved)

### 2D Map (DeckGL)

New dependency: `@deck.gl/mesh-layers`

Uses `SimpleMeshLayer` with the same glTF models:

- Position includes altitude as z-coordinate
- `getOrientation` maps heading/pitch/roll
- `sizeScale` adjusts visibility per zoom level

**Zoom-gated rendering for performance:**

- Zoom < 5: existing 2D ScatterplotLayer icons (fast for global view)
- Zoom 5-10: 3D models at reduced scale
- Zoom 10+: 3D models at full scale

Max 200 simultaneous mesh instances on the 2D map.

---

## 3. Satellite Tracking & Orbital Visualization

### Data Source

**Service:** `src/services/satellite-catalog.ts`

Fetches TLE (Two-Line Element) data from CelesTrak's public GP API:

- Endpoint: `https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json`
- ~5,000 active satellite objects
- Refresh interval: every 4 hours (TLEs remain valid for days)
- Circuit breaker with persistent cache — satellites render offline from last-known TLEs

### Intelligence Annotations

A hardcoded catalog in `satellite-catalog.ts` tags notable objects by NORAD ID or name pattern:

| Category | Pattern/Examples | Visual Treatment |
|----------|-----------------|-----------------|
| ISS / Tiangong | ZARYA (25544), CSS (48274) | Gold icon, always labeled, larger dot |
| Spy satellites | NROL-*, KH-11/Keyhole | Red pulsing dot, "CLASSIFIED" label |
| GPS constellation | NAVSTAR PRN 01-32 | Blue cluster, labeled by PRN |
| Starlink | STARLINK-* | Dim gray dots, clustered at low zoom |
| Russian military | Kosmos-*, Liana SIGINT | Orange, labeled by function |
| Chinese military | Yaogan-*, Shijian-* | Orange, labeled by function |
| Early warning | SBIRS-*, DSP-* | Red, "MISSILE WARNING" tag |
| Weather | GOES-*, JPSS-*, Meteosat-* | Cyan, labeled by agency |
| Untagged | Everything else | Small gray dot, no label |

The intelligence overlay is a static lookup table — no additional API needed.

### SGP4 Propagation (Web Worker)

**Service:** `src/services/satellite-propagator.ts` (main-thread API)
**Worker:** `src/services/satellite-propagator.worker.ts`

New dependency: `satellite.js` (MIT license, ~15KB minified)

Architecture:

1. Main thread sends TLE data to Worker via `postMessage`
2. Worker propagates all ~5,000 satellite positions using SGP4 every 1 second
3. Worker posts back `{id, lat, lon, altKm, velocityKmS}[]` arrays
4. Main thread distributes positions to DeckGL and Cesium renderers

Orbit path computation: when user clicks/selects a satellite, Worker computes next 90 minutes of predicted positions (polyline coordinates) and sends back as a separate message.

Performance: SGP4 on 5,000 objects takes ~10-15ms per tick — well within the Worker's budget and completely off the main thread.

### God's Vision Globe (Cesium)

- `PointPrimitiveCollection` (not entities — much faster for thousands of objects) at real orbital altitude
- Notable satellites: billboard icons + labels with `DistanceDisplayCondition`
- Selected satellite: orbit path as a `PolylineCollection` primitive tracing the next 90-minute orbit
- Visual altitude hierarchy: LEO (~400km) as dense band, MEO (~20,000km) as scattered, GEO (~36,000km) as visible ring
- Starlink constellation renders as a dim swarm — individually pickable but visually subtle

### 2D Map (DeckGL)

- `ScatterplotLayer`: satellite sub-satellite points (ground position projection)
- `TextLayer`: labels for notable satellites
- `PathLayer`: ground track of selected satellite (great-circle line)
- `PolygonLayer`: visibility footprint cone for selected satellite
- At zoom < 3: only notable satellites (~200) render to avoid clutter

---

## 4. Integration, Config & Performance

### New MapLayers Toggles

Added to `MapLayers` interface in `src/types/index.ts` and all variant configs:

```typescript
buildings3d: boolean; // Building extrusions on 2D map
satellites: boolean; // Satellite ground positions on 2D map
aircraft3d: boolean; // 3D mesh aircraft on 2D map (vs 2D icons)
```

### New God's Vision Layer Config

Added to `src/config/gods-vision-layers.ts`:

- `buildings` — 3D building tiles on globe (category: aesthetic)
- `satellites` — orbital objects (category: intelligence)
- `aircraft3d` — glTF aircraft models replacing billboard icons (category: spatial)

### Performance Guardrails

| Feature | Guardrail |
|---------|-----------|
| Satellites (2D map) | At zoom < 3, only notable satellites (~200) render. Full catalog at zoom 3+. |
| Satellites (Worker) | Posts positions at 1Hz. Orbit paths computed on-demand only. |
| Aircraft 3D (2D map) | Below zoom 5, falls back to existing ScatterplotLayer icons. Max 200 mesh instances. |
| Buildings (2D map) | Extrusions only at zoom 14+. Fade-in over zoom 14-15. |
| Buildings (Cesium) | Cesium 3D Tiles stream LOD automatically. No manual management needed. |
| Model loading | Lazy — glTF fetched on first appearance of aircraft type. Cached in memory. |
| Building fallback | Auto-drops tier on error. No retry storm — stays on fallback until next session. |

### New Dependencies

| Package | Purpose | Size |
|---------|---------|------|
| `satellite.js` | SGP4 orbital propagation | ~15KB min |
| `@deck.gl/mesh-layers` | SimpleMeshLayer for 3D aircraft on 2D map | Part of deck.gl suite |

### File Structure

**New files:**

```
src/services/model-loader.ts — glTF cache + type→model mapping
src/services/satellite-catalog.ts — TLE fetch + intelligence annotations
src/services/satellite-propagator.ts — main-thread API wrapping the Worker
src/services/satellite-propagator.worker.ts — Web Worker with satellite.js SGP4
src/services/building-tiles.ts — 5-tier fallback chain manager
public/models/aircraft/*.glb — ~15 glTF model files
```

**Modified files:**

```
src/types/index.ts — 3 new MapLayers boolean keys
src/config/panels.ts — new layer defaults in all MapLayers objects
src/config/variants/*.ts — new layer defaults (all variants)
src/config/gods-vision-layers.ts — 3 new layer entries
src/e2e/map-harness.ts — 3 new MapLayers keys
src/e2e/mobile-map-integration-harness.ts — 3 new MapLayers keys
src/components/DeckGLMap.ts — SimpleMeshLayer, fill-extrusion, satellite layers
src/components/GlobeDataManager.ts — 3D Tileset, ModelGraphics, satellite primitives
src/components/CesiumGlobe.ts — BuildingTileManager integration
src/components/MapContainer.ts — proxy setters for satellite/model data
src/app/data-loader.ts — satellite catalog loader + Worker lifecycle
src-tauri/src/main.rs — GOOGLE_MAPS_API_KEY in SUPPORTED_SECRET_KEYS
src/services/runtime-config.ts — Google Maps 3D Tiles feature definition
src/services/settings-constants.ts — GOOGLE_MAPS_API_KEY label + signup URL
docs/API_KEYS.md — Google Maps API key documentation
docs/README.md — panel/feature count update
docs/DESKTOP_CONFIGURATION.md — 3D feature degradation notes
~/Documents/Crystal Ball API Keys.md — local copy update
```
