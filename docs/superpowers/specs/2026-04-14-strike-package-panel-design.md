# Strike Package Panel — Design Spec

**Date:** 2026-04-14
**Status:** Approved

## Overview

A unified panel tracking active strike packages — both naval carrier strike groups and detected air strike formations — with multi-layer route prediction and AI intent assessment. Combines USNI fleet data, ADS-B military flights, and AIS vessel tracking into a single operational picture.

## Architecture

### New Files

| File | Purpose |
|------|---------|
| `src/services/strike-packages.ts` | Detection engine, route prediction, data aggregation |
| `src/components/StrikePackagePanel.ts` | Panel UI with expandable cards |

### Wiring (existing files)

| File | Change |
|------|--------|
| `src/config/panels.ts` | Add `'strike-package'` to `FULL_PANELS` + `strikePackages` to `FULL_MAP_LAYERS` |
| `src/app/panel-layout.ts` | Instantiate `StrikePackagePanel`, wire map click handler |
| `src/app/data-loader.ts` | Add strike package refresh task |
| `src/components/DeckGLMap.ts` | Add `setStrikePackages()`, create icon/path/polygon layers |
| `src/components/GlobeDataManager.ts` | Add strike package entities to Cesium globe |

### Data Sources (all existing, no new APIs)

- **Military flights** (`src/services/military-flights.ts`) — ADS-B positions, aircraft type enrichment
- **Military vessels** (`src/services/military-vessels.ts`) — AIS streaming positions
- **USNI fleet tracker** (`src/services/usni-fleet.ts`) — Strike group composition, deployment status
- **AI classify** (`src/services/threat-classifier.ts`) — Intent assessment via LLM

## Strike Package Detection

### Naval Packages

Merge USNI strike group data with live AIS vessel positions:

1. USNI provides composition (carrier + air wing + destroyer squadron) and deployment status
2. AIS provides real-time lat/lon for each vessel
3. Match by MMSI or vessel name
4. A naval package exists when USNI reports a group as deployed or underway
5. In-port groups are tracked but ranked lowest in importance

### Air Packages

Proximity + composition rules run on every military flights refresh (60s):

1. **Cluster**: Group military aircraft within 50km and 5 minutes of each other
2. **Score composition**: Bomber presence = high, tanker + fighters = medium, fighters-only = low
3. **Filter**: Require at least 2 aircraft with composition score above threshold
4. **Stabilize**: Deduplicate against previous cycle to maintain stable package IDs across refreshes

Composition scoring rules:

| Pattern | Score | Classification |
|---------|-------|----------------|
| Bomber + tanker + escort | High | Strike package |
| AWACS + fighters | Medium | Combat air patrol |
| Tanker + fighters | Medium | Extended patrol |
| Fighters only (3+) | Low | Formation flight |
| Recon + escort | Medium | ISR package |

### AI Enrichment

Triggered when:
- A new package is first detected
- A package significantly changes course (>30 degrees heading change)
- Every 30 minutes for active packages (background refresh)

Classify request includes:
- Package composition (aircraft/vessel types and counts)
- Current heading, speed, altitude
- Proximity to known hotspots, bases, conflict zones
- Recent allied-military news context

Protected by circuit breaker (existing classify endpoint). Falls back to rules-only assessment when AI is unavailable. AI response is cached per package until next trigger.

## Route Prediction

Three layers, each adding refinement:

### Layer 1: Extrapolation (always available)

- Extend current heading/speed as projected path
- Dead reckoning with great-circle correction
- Generate 12 waypoints over next 24 hours at current speed
- Confidence decreases linearly with distance

### Layer 2: Historical Pattern Matching

Compare current position + heading against known waypoints:

**Waypoint database** (hardcoded initially):
- Major naval bases (Norfolk, San Diego, Pearl Harbor, Yokosuka, etc.)
- Strategic chokepoints (Hormuz, Suez, Malacca, GIUK gap, etc.)
- Known exercise areas (RIMPAC, Baltops, etc.)
- Active conflict zones (from existing conflict service data)

**Scoring each candidate destination:**
- Bearing alignment: Is the package heading toward it? (cosine similarity of heading vs bearing to destination)
- Distance feasibility: Can it reach at current speed within reasonable timeframe?
- Historical precedent: Have similar packages (same carrier, same aircraft type) gone there before?
- Normalize scores to probabilities summing to 100%

### Layer 3: Intent Inference (AI, when available)

Cross-references:
- Active conflict zones from ACLED/UCDP data
- Recent allied-military news feeds
- Ongoing exercises (from allied-military intel)
- Geopolitical context (from news/intel providers)

Produces:
- 1-2 sentence natural language assessment
- Escalation flag (normal / elevated / high) that factors into importance scoring

## Map Integration

### Default View (collapsed)

Each package rendered as:
- **Icon**: Ship or aircraft icon at current position (DeckGL `IconLayer`)
- **Trail**: Solid line showing past positions (`PathLayer`, from existing trail buffers)
- **Predicted path**: Thin dashed line extending along predicted heading, fading with distance (`PathLayer` with dash array + opacity gradient)

### Expanded View (on package click)

Additional overlays:
- **Confidence cone**: Expanding wedge from current position (`PolygonLayer`, semi-transparent fill)
- **Destination markers**: Circle markers at predicted destinations with probability labels (`TextLayer` + `ScatterplotLayer`)
- Only one package expanded at a time on the map

### Map Layer Config

```typescript
// In FULL_MAP_LAYERS
strikePackages: true,
```

### DeckGL Methods

```typescript
public setStrikePackages(packages: StrikePackage[]): void
private createStrikePackageIconLayer(packages: StrikePackage[]): IconLayer
private createStrikePackageRouteLayer(packages: StrikePackage[]): PathLayer
private createStrikePackageConeLayer(selected: StrikePackage): PolygonLayer
```

### God's Eye (Cesium) Integration

- Strike package entities added to a dedicated `CustomDataSource`
- Icons with `HeightReference.CLAMP_TO_GROUND` for naval, altitude-aware for air
- Predicted routes as `PolylineCollection`
- Confidence cones as semi-transparent `PolygonGraphics`

## Panel UI

### Layout: Expandable Cards

Flat list of cards, auto-sorted by importance score (descending). Cards expand on click to reveal full detail.

### Importance Score

Weighted combination, recalculated on each data update:

```
importance = statusWeight
           + conflictProximityScore  (0-30)
           + compositionThreat       (0-25)
           + courseChangeRecency     (0-20)
           + aiEscalationFlag       (0-25)
```

| Status | Weight |
|--------|--------|
| ACTIVE | 100 |
| FORMING | 75 |
| DEPLOYING | 50 |
| TRANSIT | 30 |
| IN_PORT | 5 |

List re-sorts on every update. Smooth DOM reorder (no jarring jumps).

### Collapsed Card

```
[icon] CSG-3 Nimitz                    [DEPLOYING]
CVN-68 + 4 escorts + CVW-11 . SE at 18kts . Hormuz 72%
```

Shows: domain icon, package name, status pill, one-line summary with composition count + heading + top destination prediction.

### Expanded Card

Sections revealed on expand:

1. **Composition** — Type pills with counts (`B-52H x2`, `KC-135 x1`, `F-15E x2`)
2. **Route Prediction** — Heading, speed, destination probabilities list
3. **AI Assessment** — Bordered quote block with intent analysis (or "AI unavailable" fallback)
4. **Actions** — Map focus button (centers map + expands route on map)

Blue left border on expanded card. Expanding one card collapses any other. Click coordinates or focus button to fly the map to the package.

### Status Pills

| Status | Color |
|--------|-------|
| ACTIVE | Red (#dc2626) |
| FORMING | Amber (#ca8a04) |
| DEPLOYING | Purple (#7c3aed) |
| TRANSIT | Blue (#3b82f6) |
| IN_PORT | Green (#059669) |
| UNKNOWN | Gray (#64748b) |

## Data Refresh Cadence

| Source | Cadence | Trigger |
|--------|---------|---------|
| Air formation detection | 60s | Piggyback on military flights refresh |
| Naval position updates | On AIS change | WebSocket stream |
| USNI enrichment | 60min | Circuit breaker, background refresh |
| Route prediction recalc | 5min | Timer, or on >30 degree course change |
| AI intent assessment | On detection / course change / 30min | Circuit breaker, graceful fallback |
| Importance re-sort | On any data update | Inline recalc |

## Types

```typescript
type StrikePackageDomain = 'naval' | 'air';

type StrikePackageStatus =
  | 'active'
  | 'forming'
  | 'deploying'
  | 'transit'
  | 'in_port'
  | 'unknown';

interface StrikePackage {
  id: string;
  domain: StrikePackageDomain;
  name: string;
  status: StrikePackageStatus;
  importance: number;
  lat: number;
  lon: number;
  heading: number;
  speed: number;
  composition: PackageUnit[];
  prediction: RoutePrediction;
  aiAssessment?: string;
  aiEscalation?: 'normal' | 'elevated' | 'high';
  detectedAt: Date;
  lastUpdated: Date;
  trail: [number, number][];
}

interface PackageUnit {
  type: string;       // e.g. 'B-52H', 'CVN-68', 'DDG-51'
  count: number;
  role: string;       // 'bomber', 'tanker', 'escort', 'carrier', 'destroyer', etc.
}

interface RoutePrediction {
  extrapolatedPath: [number, number][];
  destinations: PredictedDestination[];
  confidenceCone?: ConfidenceCone;
  method: 'extrapolation' | 'pattern' | 'ai' | 'combined';
  updatedAt: Date;
}

interface PredictedDestination {
  name: string;
  lat: number;
  lon: number;
  probability: number;
  reasoning: string;
}

interface ConfidenceCone {
  bearingMin: number;
  bearingMax: number;
  rangeKm: number;
}
```

## Error Handling

- All data fetching protected by existing circuit breakers (flights, vessels, USNI, classify)
- Panel shows stale data with "last updated X ago" when sources are down
- AI assessment shows "Assessment unavailable" when classify breaker is open
- Route prediction degrades gracefully: combined -> pattern -> extrapolation only
- Formation detection continues with whatever flight data is available

## Out of Scope

- Custom waypoint database editor (hardcoded waypoints for v1)
- Historical strike package replay
- Multi-national force composition (v1 focuses on US/NATO)
- Submarine tracking (no reliable OSINT source)
- Weapon loadout estimation
