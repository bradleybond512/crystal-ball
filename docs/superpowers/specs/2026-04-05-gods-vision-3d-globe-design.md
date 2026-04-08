# God's Vision Mode — 3D Globe, Satellite Tracking & Intelligence Platform

**Date:** 2026-04-05
**Status:** Draft
**Scope:** 8 features across 2 parallel tracks + foundation

---

## Overview

Transform Crystal Ball from a 2D panel-based intelligence dashboard into a full 3D geospatial intelligence platform inspired by Palantir Gotham and God's Vision. The centerpiece is a new "God's Vision Mode" — a full-viewport Cesium + Three.js hybrid globe with satellite tracking, 3D terrain, entity link analysis, RF/SIGINT visualization, temporal playback, satellite imagery, and a cinematic HUD overlay.

The existing 2D MapLibre + deck.gl dashboard remains untouched as the default workspace. God's Vision Mode is a dedicated immersive experience activated by a button or keyboard shortcut.

---

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Globe engine | Cesium + Three.js hybrid | Cesium for geospatial accuracy (terrain, imagery, time); Three.js for sci-fi aesthetic (shaders, effects, force graph). Defense-contractor pattern. |
| Integration model | Full-screen God's Vision Mode | Separate immersive mode, not a map replacement. Dashboard for work, globe for command presence. Panels become floating HUD elements. |
| Satellite depth | Full SIGINT/IMINT correlation | Not just dots — pass prediction, imaging windows, GPS health, ADS-B blackout correlation, sat-event linking. |
| Entity types | All 6 (Geo, Actors, Events, Assets, Financial, Cyber) | Maximizes graph richness. All types already have data sources feeding them. |
| Rollout strategy | Parallel streams after foundation | Globe foundation first, then visual track and analytical track proceed independently. |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ GOD'S VISION MODE │
│ (full viewport) │
│ │
│  ┌──────────────────────────────────────────────────┐ │
│  │ Cesium Viewer (base layer) │ │
│  │  • WGS84 globe with dark-styled imagery │ │
│  │  • 3D Tiles terrain + buildings │ │
│  │  • Imagery providers (Sentinel, Mapbox, etc.) │ │
│  │  • Native entity API for geo-pinned markers │ │
│  │  • Clock/timeline for temporal scrubbing │ │
│  ├──────────────────────────────────────────────────┤ │
│  │ Three.js Overlay (same WebGL canvas) │ │
│  │  • Custom shaders: globe glow, atmosphere │ │
│  │  • Satellite orbit lines (instanced geometry) │ │
│  │  • RF coverage cones + signal propagation │ │
│  │  • Threat brackets + target indicators │ │
│  │  • Post-processing: bloom, vignette, scanlines │ │
│  ├──────────────────────────────────────────────────┤ │
│  │ HUD Layer (HTML/CSS overlay) │ │
│  │  • Floating intel panels (draggable) │ │
│  │  • Status readouts (threats, SIGINT, sats) │ │
│  │  • Layer toggles (bottom bar) │ │
│  │  • Search + entity lookup │ │
│  │  • Time slider control │ │
│  └──────────────────────────────────────────────────┘ │
│ │
│  [ESC] or button → return to dashboard mode │
└─────────────────────────────────────────────────────────┘
```

### Render Sync

Cesium drives the render loop. Each frame:

1. Cesium renders globe, terrain, imagery, 3D Tiles
2. Three.js reads Cesium's camera view/projection matrix
3. Three.js applies inverse transform to its scene, rendering satellites, effects, RF cones into the same canvas
4. HTML HUD layer composites on top via CSS `pointer-events: none` (except interactive elements)

This is the proven pattern from cesium-three-loader and defense contractor implementations.

### Entry/Exit Transition

- **Enter:** Dashboard panels animate out (scale 1→0.9 + opacity fade, 600ms). Globe fades in from current map center coordinates. Camera pulls back to orbital altitude (~20,000km).
- **Exit:** ESC key or button. Camera flies to last dashboard zoom level. Globe fades out, panels animate back in. State preserved — re-entering resumes where you left off.

### Performance Budget

- Target: 60fps on discrete GPU, 30fps minimum on integrated (M1/M2)
- Cesium terrain LOD handles adaptive detail
- Three.js satellite layer uses instanced rendering (5,000+ points at <1ms draw)
- Post-processing effects (bloom, scanlines) disabled on low-end devices
- WebGL2 capability detection (reuse existing logic from biometric-gate-3d.ts)

---

## Phase 1: Globe Foundation

### New Dependencies

| Package | Size | Purpose |
|---------|------|---------|
| `cesium` | ~3.5MB (tree-shakeable) | Globe engine, terrain, imagery, 3D Tiles, temporal |
| `satellite.js` | ~50KB | SGP4/SDP4 orbital propagation |
| `3d-force-graph` | ~200KB | Three.js-native force-directed graph |

Existing `three` (v0.183) stays. deck.gl/MapLibre remain for 2D dashboard — untouched.

### New Files

| File | Purpose |
|------|---------|
| `src/components/GodsVisionView.ts` | Top-level orchestrator — manages Cesium, Three.js overlay, HUD, entry/exit transitions |
| `src/components/CesiumGlobe.ts` | Cesium viewer setup, imagery providers, camera controls, entity management |
| `src/components/ThreeOverlay.ts` | Three.js scene synced to Cesium camera — all custom 3D rendering |
| `src/components/GlobeHUD.ts` | HTML overlay layer — floating panels, status readouts, layer controls |
| `src/services/cesium-three-bridge.ts` | Coordinate transforms (ECEF ↔ Three.js), camera sync, render loop coordination |
| `src/config/gods-vision-layers.ts` | Layer registry — data sources mapped to globe rendering |

### Key Details

- **Globe imagery:** Dark-styled base (Mapbox Dark or custom dark Blue Marble) matching existing theme. Toggle to satellite imagery (Sentinel/Mapbox Satellite).
- **Cesium ion:** Free tier provides terrain + imagery (100K monthly tile requests). Token stored in Tauri keychain alongside other API keys.
- **God's Vision button:** Added to existing toolbar/header. Keyboard shortcut: `G` (when not in text input).

---

## Phase 2A: Visual Track

### Satellite Tracking + Orbital Intelligence

**Data Pipeline:**

- **CelesTrak** — bulk TLE fetch every 4 hours via sidecar (free, no auth)
- **satellite.js** — SGP4 propagation client-side, computing real-time positions each animation frame
- **N2YO API** — pass predictions for monitored locations (free tier: 1000 req/hr)
- **Space-Track.org** — conjunction/decay alerts (optional, needs approved account)
- TLEs cached in IndexedDB, ~27,000 catalogued objects

**Rendering (Three.js overlay):**

- Instanced point geometry — 5,000-27,000 satellites as GPU-instanced spheres
- Orbit trails — fading line geometry showing 1 full orbital period
- Color by type: blue=comms, purple=military/intel, green=weather, yellow=navigation, white=debris
- Click satellite → info card (name, NORAD ID, altitude, velocity, operator) + full orbit line + ground track projection
- Constellation filter — toggle Starlink, GPS, GLONASS, Galileo, etc.

**Analytical Features:**

- Pass prediction — "when does this satellite see this location next?" via satellite.js geometry
- Ground footprint — cone projection from satellite to Earth surface (configurable sensor FOV)
- Imaging windows — Sentinel-2/Landsat pass schedules computed for watchlist locations
- Maneuver detection — compare TLE epochs across updates, flag orbital changes
- Conjunction alerts — close approach warnings between tracked objects

**SIGINT/IMINT Correlation:**

- Sat-event correlation — which imaging satellite had line-of-sight to an incident at time of occurrence?
- GPS constellation health → overlay on GPS jamming zones to show degraded coverage
- ADS-B blackout correlation — flag gaps in aircraft tracking where ELINT satellites were overhead
- Comms relay visualization — animated arcs showing ground→sat→ground relay paths
- Feeds from existing SIGINT Monitor, ADS-B Flight Tracking, GPS Jamming panels

**Files:**

- `src/services/satellite-tracker.ts` — manages satellite catalog, propagation loop
- `src/services/tle-fetcher.ts` — CelesTrak/Space-Track data fetching + caching
- `src/services/orbital-analysis.ts` — pass prediction, conjunction, maneuver detection
- `src/components/SatelliteLayer.ts` — Three.js instanced rendering on globe
- `src/components/SatelliteInfoCard.ts` — click-to-inspect satellite detail card

### 3D Terrain + Building Models

**Terrain:**

- Cesium World Terrain — free via Cesium ion (quantized mesh tiles)
- Elevation-aware camera — fly through valleys, over mountains
- Line-of-sight analysis between two terrain points
- Terrain exaggeration slider (1x-5x) for visualization emphasis

**3D Buildings:**

- Google Photorealistic 3D Tiles — via Cesium ion adapter (free tier: 2,500 sessions/month)
- OSM Buildings — free fallback with global coverage
- Auto-switch: photorealistic when zoomed below 1km altitude, OSM at city scale
- Dark tint/style applied to buildings to match app theme

**Files:**

- `src/components/TerrainLayer.ts`
- `src/components/BuildingsLayer.ts`

### Satellite Imagery Layers

**Providers:**

- **Sentinel-2** — 10m resolution, 5-day revisit, free (Copernicus Browser API)
- **Landsat 8/9** — 30m resolution, 16-day revisit, free (USGS Earth Explorer)
- **MODIS** — daily global coverage, 250m-1km, free (NASA Worldview WMTS)
- **Mapbox Satellite** — high-res commercial composite (if API key configured)

**Features:**

- Toggle imagery provider from God's Vision layer controls
- Date picker — view imagery from specific past dates
- False color band composites (NDVI vegetation health, thermal, etc.)
- Before/after comparison for watchlist locations
- Cesium ImageryLayer — native WMS/WMTS support, no custom tile loader needed

**Files:**

- `src/services/imagery-provider.ts`
- `src/components/ImageryLayer.ts`

### HUD / Augmented Reality Overlay

**HUD Elements:**

- Threat brackets — animated targeting reticles on hotspot locations
- Distance readouts — lines between selected entities with kilometer measurements
- Status readouts — top-left/right floating intel cards (threat level, SIGINT status, satellite count)
- Compass rose — 3D-aware bearing indicator
- Altitude/coordinates bar — camera position and look-at coordinates
- Minimap — 2D inset showing current globe view extent on a flat map

**Aesthetic / Post-Processing:**

- Globe atmospheric glow — custom scatter shader (Three.js)
- Scanline overlay — subtle CRT/tactical display effect
- Bloom — UnrealBloomPass on bright elements (satellite points, threat markers)
- Vignette — darkened edges for cinematic framing
- Color palette — blues/cyans for neutral, amber for warnings, red for threats
- All effects toggleable — "Clean" mode strips all cosmetics for pure analysis

**Files:**

- `src/components/GlobeHUD.ts`
- `src/app/hud-elements.ts`
- `src/shaders/atmosphere.glsl`
- `src/shaders/scanline.glsl`

---

## Phase 2B: Analytical Track

### Entity Link Analysis — 3D Force Graph

**Entity Model (6 node types):**

| Type | Color | Examples | Primary Sources |
|------|-------|----------|----------------|
| Geo | Green | Countries, bases, ports, infrastructure, conflict zones | Config data, UCDP |
| Actors | Amber | States, armed groups, agencies, PMCs, NGOs | UCDP, ACLED, news extraction |
| Events | Red | Conflicts, cyber attacks, disasters, sanctions | UCDP, ACLED, GDACS, ThreatFox |
| Assets | Purple | Satellites, vessels, aircraft, weapons systems | TLE, AIS, ADS-B, ORBAT |
| Financial | Blue | Sanctioned entities, arms deals, crypto wallets | OFAC, OpenSanctions, DSCA, Bitcoin Abuse |
| Cyber | Pink | APTs, IOCs, CVEs, malware families, C2 infra | ThreatFox, STIX/TAXII, CISA, Vulners |

**Edge Types (relationships):**

- `operates_in` — Actor → Geo
- `participated_in` — Actor → Event
- `located_at` — Event/Asset → Geo
- `attributed_to` — Cyber/Event → Actor
- `funded_by` — Actor → Financial
- `exploits` — Cyber (malware) → Cyber (CVE)
- `allied_with` / `adversary_of` — Actor ↔ Actor
- `operated_by` — Asset → Actor
- `sanctioned_by` — Financial → Actor (state)

**Storage:**

- IndexedDB with two object stores: `entities` (nodes) and `relationships` (edges)
- Each entity: canonical ID, type, name, metadata object, geo coordinates (nullable)
- Each relationship: source ID, target ID, type, confidence score (0-1), source attribution
- Incremental updates as panel data refreshes — deduplication by canonical ID
- Steady state target: ~50K entities, ~200K relationships

**Entity Extraction:**

- Existing panel data parsed into entities on refresh (structured sources: UCDP, OFAC, ThreatFox, etc.)
- News/unstructured text: Claude summarization extracts named entities + relationships
- Entity resolution: fuzzy match on name + type to merge duplicates (e.g., "Russian Federation" = "Russia")

**Rendering:**

- `3d-force-graph` library — Three.js native force-directed layout
- Opens as resizable overlay panel within God's Vision mode (not full viewport)
- Click node → expand connections (lazy load 1 hop from IndexedDB)
- Double-click node → fly globe camera to entity's geo coordinates
- Right-click → "Investigate" context menu (show related panels, expand graph, add to watchlist)
- Search bar — type entity name, graph centers and highlights matching nodes
- Filters: by entity type, relationship type, time range, confidence threshold
- Pin nodes to lock positions during investigation

**Files:**

- `src/services/entity-graph.ts` — graph query engine (traversal, pathfinding, subgraph extraction)
- `src/services/entity-extractor.ts` — transforms panel data into entities + relationships
- `src/services/entity-store.ts` — IndexedDB CRUD, deduplication, incremental updates
- `src/components/EntityGraphView.ts` — 3d-force-graph wrapper, interaction handling
- `src/components/EntityInfoCard.ts` — detail card for selected entity
- `src/types/entity.ts` — TypeScript interfaces for Entity, Relationship, EntityType

### RF / Signal Intelligence Visualization

**Visualizations (Three.js overlay on globe):**

- GPS jamming domes — semi-transparent hemispheres over known jamming zones
- Radar coverage cones — conical projections from known radar sites with range rings + FOV
- Satellite comms footprints — ground coverage circles for communications satellites
- Signal propagation paths — animated arcs showing relay chains
- EW hotspot halos — glowing regions with electronic warfare activity

**Data Sources:**

- GPSJam.org — GPS interference data
- Existing SIGINT Monitor panel — feeds directly into globe rendering
- Known radar installations — static dataset enriched with OSINT updates
- ADS-B gap analysis — missing coverage regions indicate likely jamming/denial
- Cable Health panel — undersea cable status for comms routing visualization

**Files:**

- `src/components/RFVisualizationLayer.ts`
- `src/services/rf-coverage.ts`
- `src/shaders/signal-dome.glsl`

### Temporal Playback / Time Slider

**Architecture:**

- Cesium Clock — native temporal engine drives all time-aware layers
- Time slider UI anchored to bottom of God's Vision viewport
- Controls: play/pause, speed (1x, 10x, 100x, 1000x), scrub to any recorded point
- All temporal layers respond simultaneously: satellite positions recompute, events appear/disappear, vessel/flight tracks animate

**Event Recording:**

- IndexedDB `timeline_events` store — every geo-located event timestamped on ingest
- Sources: conflict events, disasters, cyber incidents, vessel positions, flight positions, satellite maneuvers
- Snapshots at panel refresh intervals (not continuous — storage-conscious)
- Retention: 90-day rolling window, configurable in settings
- Incident replay — select an event, auto-set time window to 24h surrounding it

**Time Slider UI:**

- Horizontal bar with playhead, event markers (color-coded by type), date labels
- Event density visualization — brighter regions = more activity
- Click event marker to jump to that moment
- Keyboard: spacebar=play/pause, arrow keys=step, shift+arrow=speed change

**Files:**

- `src/components/TimelineSlider.ts`
- `src/services/timeline-recorder.ts`
- `src/services/timeline-playback.ts`

---

## New File Summary

### Phase 1 (Foundation) — 6 files

- `src/components/GodsVisionView.ts`
- `src/components/CesiumGlobe.ts`
- `src/components/ThreeOverlay.ts`
- `src/components/GlobeHUD.ts`
- `src/services/cesium-three-bridge.ts`
- `src/config/gods-vision-layers.ts`

### Phase 2A (Visual Track) — 12 files

- `src/services/satellite-tracker.ts`
- `src/services/tle-fetcher.ts`
- `src/services/orbital-analysis.ts`
- `src/components/SatelliteLayer.ts`
- `src/components/SatelliteInfoCard.ts`
- `src/components/TerrainLayer.ts`
- `src/components/BuildingsLayer.ts`
- `src/services/imagery-provider.ts`
- `src/components/ImageryLayer.ts`
- `src/app/hud-elements.ts`
- `src/shaders/atmosphere.glsl`
- `src/shaders/scanline.glsl`

### Phase 2B (Analytical Track) — 9 files

- `src/services/entity-graph.ts`
- `src/services/entity-extractor.ts`
- `src/services/entity-store.ts`
- `src/components/EntityGraphView.ts`
- `src/components/EntityInfoCard.ts`
- `src/types/entity.ts`
- `src/components/RFVisualizationLayer.ts`
- `src/services/rf-coverage.ts`
- `src/shaders/signal-dome.glsl`

### Shared — 3 files

- `src/components/TimelineSlider.ts`
- `src/services/timeline-recorder.ts`
- `src/services/timeline-playback.ts`

**Total: 30 new files**

---

## API Keys Required

| Service | Key Type | Cost | Purpose |
|---------|----------|------|---------|
| Cesium ion | Token | Free (100K tiles/mo) | Terrain, 3D Tiles, imagery |
| Google 3D Tiles | API key | Free (2,500 sessions/mo) | Photorealistic buildings |
| Copernicus Browser | OAuth | Free | Sentinel-2 imagery |
| N2YO | API key | Free (1000 req/hr) | Satellite pass predictions |
| Space-Track.org | Username/password | Free (approved accounts) | NORAD catalog, conjunctions |
| GPSJam.org | Scrape/API | Free | GPS interference data |

All keys stored in Tauri keychain via existing secrets infrastructure.

---

## What Does NOT Change

- Existing 2D dashboard (MapLibre + deck.gl + all panels) — completely untouched
- Panel system, refresh scheduler, data loaders — no modifications
- Existing services — they continue feeding panels; entity extractor reads their output
- Tauri shell, sidecar, Convex backend — no changes
- Build pipeline — Cesium added as dependency, tree-shaken for non-God's-Eye builds
