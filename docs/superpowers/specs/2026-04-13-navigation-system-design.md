# Crystal Ball Navigation System Design

**Date**: 2026-04-13
**Status**: Approved
**Goal**: Add resilient backup navigation capabilities with street/highway mapping, continuous GPS tracking, and turn-by-turn routing using multi-tier fallback chains.

---

## 1. Street/Road Tile Layers (3-Tier Fallback)

| Tier | Source | Key Required | Max Zoom | Notes |
|------|--------|-------------|----------|-------|
| 1 | Mapbox Vector Tiles | `MAPBOX_API_KEY` | 22 | Best quality, vector streets/highways |
| 2 | MapTiler Streets | `MAPTILER_API_KEY` | 22 | Strong vector alternative |
| 3 | OpenStreetMap Raster | None | 19 | Free, reliable, no key needed |

Street tiles render as an imagery layer on the Cesium globe at high altitude. Below ~5km altitude, a dedicated MapLibre 2D panel takes over for street-level detail.

## 2. Routing Engine (4-Tier Fallback)

| Tier | Engine | Key Required | Traffic-aware | Notes |
|------|--------|-------------|---------------|-------|
| 1 | Mapbox Directions | `MAPBOX_API_KEY` | Yes | Best quality + traffic |
| 2 | Google Directions | `GOOGLE_MAPS_API_KEY` | Yes | Already a supported key |
| 3 | Valhalla (public) | None | No | Multi-profile (drive/bike/walk) |
| 4 | OSRM (public) | None | No | Zero-dependency fallback |

Each tier attempts the route request with a 3-second timeout. On failure, falls to the next tier. Rerouting on missed turns follows the same chain. The active tier is displayed in the UI.

## 3. GPS Position Source (3-Tier Fallback)

| Tier | Source | Accuracy | Heading/Speed | Notes |
|------|--------|----------|---------------|-------|
| 1 | CoreLocation (Tauri plugin) | 5-10m | Yes | Native macOS GPS hardware |
| 2 | Browser Geolocation API | 10-50m | Limited | Already partially implemented in user-location.ts |
| 3 | External GPS (NMEA/serial) | 1-5m | Yes | USB/Bluetooth receivers via sidecar |

Continuous updates at 1Hz. Position, heading, speed, and accuracy are reported to the UI. A source indicator in the HUD shows which tier is active.

## 4. Hybrid View System

### Globe View (altitude > ~5km)
- Street/highway tiles overlaid on existing satellite imagery
- GPS position dot with heading indicator and accuracy circle
- Navigation HUD strip alongside existing GlobeHUD showing: next turn, distance, ETA, speed

### Navigation Mode (altitude < ~5km or manually activated)
- Transitions to dedicated 2D MapLibre panel
- Full route rendered with color-coded turn markers
- Step-by-step directions list in sidebar
- Larger GPS dot with heading cone
- Auto-reroute on deviation (>50m off-route for >10s)

### Auto-Promotion
- HUD auto-escalates to full Navigation panel on missed turn or reroute event
- Manual toggle available via keyboard shortcut (N) or sidebar button

## 5. New Files

| File | Purpose |
|------|---------|
| `src/components/NavigationPanel.ts` | 2D MapLibre navigation view with route display |
| `src/components/NavigationHUD.ts` | Minimal overlay HUD for turn-by-turn directions |
| `src/services/routing-engine.ts` | 4-tier routing fallback chain orchestrator |
| `src/services/street-tiles.ts` | 3-tier street tile provider chain |
| `src/services/gps-tracker.ts` | Continuous GPS with 3-tier source fallback |
| `src/services/nmea-parser.ts` | NMEA 0183 sentence parser for external GPS |
| `src-tauri/src/corelocation.rs` | Rust Tauri plugin for macOS CoreLocation |
| `src-tauri/sidecar/gps-serial.mjs` | Serial port bridge for USB/Bluetooth GPS receivers |

## 6. New API Keys

Added to `runtime-config.ts` and `SUPPORTED_SECRET_KEYS` in `main.rs`:

- `MAPBOX_API_KEY` -- street tiles + primary routing
- `MAPTILER_API_KEY` -- fallback street tiles

Both optional. System operates at reduced quality with zero keys via OSM raster tiles + OSRM/Valhalla public routing.

## 7. Integration Points

- **panels.ts**: New `streets` and `navigation` entries in `FULL_MAP_LAYERS`
- **GlobeHUD.ts**: Navigation HUD strip added to existing overlay
- **GlobeDataManager.ts**: Street tile layer registration
- **GodsVisionView.ts**: Altitude-based view transition logic, "N" keyboard shortcut
- **settings-constants.ts**: New "Navigation" settings category with:
  - Default routing profile (drive/bike/walk)
  - Altitude transition threshold
  - Auto-reroute sensitivity
  - GPS source preference
- **runtime-config.ts**: MAPBOX_API_KEY, MAPTILER_API_KEY definitions
- **src-tauri/src/main.rs**: New keys in SUPPORTED_SECRET_KEYS
- **capabilities/default.json**: CoreLocation permission, serial port access

## 8. Navigation works across all existing app modes

No new app mode is created. Navigation overlays function in Peace, Finance, War, Disaster, and Ghost modes. In Ghost Mode, GPS tracking continues but no analytics are emitted (consistent with existing Ghost Mode behavior).

## 9. Activation Flow

1. User presses "N" or clicks navigation icon in sidebar
2. GPS tracker initializes (walks the 3-tier source chain)
3. Street tiles load on globe (walks the 3-tier tile chain)
4. User can optionally set a destination via search bar (GlobeSearch.ts) or click-to-navigate
5. Route is computed (walks the 4-tier routing chain)
6. HUD displays next turn, distance, ETA
7. As user zooms in below altitude threshold, view transitions to 2D Navigation panel
8. On deviation, auto-reroute triggers with HUD-to-panel promotion
