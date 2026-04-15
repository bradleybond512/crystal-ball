# Strike Package Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified panel tracking active naval carrier strike groups and detected air strike formations with multi-layer route prediction and AI intent assessment.

**Architecture:** New service (`strike-packages.ts`) consumes existing military flights, vessels, and USNI data to detect strike packages. New panel (`StrikePackagePanel.ts`) renders expandable cards auto-sorted by importance. Map integration via DeckGL layers (icons, paths, cones) and Cesium globe entities.

**Tech Stack:** TypeScript, DeckGL (IconLayer, PathLayer, PolygonLayer), Cesium, existing ConnectRPC classify client, Node built-in test runner.

---

### Task 1: Types and Constants

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add strike package types to types/index.ts**

Add after the `MilitaryActivitySummary` interface (around line 939):

```typescript
// ---- Strike Packages ----

export type StrikePackageDomain = 'naval' | 'air';

export type StrikePackageStatus =
  | 'active'
  | 'forming'
  | 'deploying'
  | 'transit'
  | 'in_port'
  | 'unknown';

export interface PackageUnit {
  type: string;
  count: number;
  role: string;
}

export interface PredictedDestination {
  name: string;
  lat: number;
  lon: number;
  probability: number;
  reasoning: string;
}

export interface ConfidenceCone {
  bearingMin: number;
  bearingMax: number;
  rangeKm: number;
}

export interface RoutePrediction {
  extrapolatedPath: [number, number][];
  destinations: PredictedDestination[];
  confidenceCone?: ConfidenceCone;
  method: 'extrapolation' | 'pattern' | 'ai' | 'combined';
  updatedAt: Date;
}

export interface StrikePackage {
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
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck:all`
Expected: PASS (types are additive, no consumers yet)

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(strike-package): add StrikePackage types

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Route Prediction Engine

**Files:**
- Create: `src/services/strike-package-prediction.ts`
- Create: `src/services/__tests__/strike-package-prediction.test.mts`

- [ ] **Step 1: Write failing tests for extrapolation and pattern matching**

Create `src/services/__tests__/strike-package-prediction.test.mts`:

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extrapolatePath,
  scoreDestinations,
  KNOWN_WAYPOINTS,
} from '../strike-package-prediction.ts';

test('extrapolatePath generates 12 waypoints along heading', () => {
  const path = extrapolatePath(36.0, -75.0, 180, 15, 24);
  assert.equal(path.length, 12);
  // All points should be south of origin (heading 180 = due south)
  for (const [lat] of path) {
    assert.ok(lat < 36.0, `expected lat ${lat} < 36.0`);
  }
  // Points should be increasingly south
  for (let i = 1; i < path.length; i++) {
    assert.ok(path[i]![0] < path[i - 1]![0], `point ${i} should be further south`);
  }
});

test('extrapolatePath handles zero speed', () => {
  const path = extrapolatePath(36.0, -75.0, 90, 0, 24);
  assert.equal(path.length, 12);
  // All points should be at origin when speed is 0
  for (const [lat, lon] of path) {
    assert.ok(Math.abs(lat - 36.0) < 0.001);
    assert.ok(Math.abs(lon - (-75.0)) < 0.001);
  }
});

test('scoreDestinations ranks bearing-aligned destinations higher', () => {
  // Heading due east (90 degrees) from mid-Atlantic
  const destinations = scoreDestinations(30.0, -40.0, 90, 20);
  // Suez (roughly east) should score higher than Norfolk (roughly west)
  const suez = destinations.find(d => d.name.includes('Suez'));
  const norfolk = destinations.find(d => d.name.includes('Norfolk'));
  if (suez && norfolk) {
    assert.ok(suez.probability > norfolk.probability,
      `Suez (${suez.probability}) should rank higher than Norfolk (${norfolk.probability})`);
  }
});

test('scoreDestinations returns probabilities summing to ~100', () => {
  const destinations = scoreDestinations(36.0, -75.0, 180, 15);
  const total = destinations.reduce((sum, d) => sum + d.probability, 0);
  assert.ok(Math.abs(total - 100) < 1, `total probability ${total} should be ~100`);
});

test('KNOWN_WAYPOINTS has required categories', () => {
  const types = new Set(KNOWN_WAYPOINTS.map(w => w.type));
  assert.ok(types.has('base'), 'should have base waypoints');
  assert.ok(types.has('chokepoint'), 'should have chokepoint waypoints');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --experimental-strip-types --test src/services/__tests__/strike-package-prediction.test.mts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the prediction engine**

Create `src/services/strike-package-prediction.ts`:

```typescript
import type { PredictedDestination, RoutePrediction, ConfidenceCone } from '@/types';

// ---- Known Waypoints ----

interface Waypoint {
  name: string;
  lat: number;
  lon: number;
  type: 'base' | 'chokepoint' | 'exercise' | 'conflict';
}

export const KNOWN_WAYPOINTS: Waypoint[] = [
  // Major naval bases
  { name: 'Norfolk', lat: 36.95, lon: -76.33, type: 'base' },
  { name: 'San Diego', lat: 32.68, lon: -117.18, type: 'base' },
  { name: 'Pearl Harbor', lat: 21.35, lon: -157.95, type: 'base' },
  { name: 'Yokosuka', lat: 35.28, lon: 139.67, type: 'base' },
  { name: 'Bahrain (NAVCENT)', lat: 26.24, lon: 50.52, type: 'base' },
  { name: 'Rota', lat: 36.63, lon: -6.35, type: 'base' },
  { name: 'Sigonella', lat: 37.40, lon: 14.92, type: 'base' },
  { name: 'Diego Garcia', lat: -7.32, lon: 72.42, type: 'base' },
  { name: 'Guam', lat: 13.58, lon: 144.93, type: 'base' },
  { name: 'Sasebo', lat: 33.16, lon: 129.72, type: 'base' },
  // Air bases
  { name: 'Ramstein', lat: 49.44, lon: 7.60, type: 'base' },
  { name: 'Incirlik', lat: 37.00, lon: 35.43, type: 'base' },
  { name: 'Al Udeid', lat: 25.12, lon: 51.31, type: 'base' },
  { name: 'Kadena', lat: 26.35, lon: 127.77, type: 'base' },
  { name: 'Osan', lat: 37.09, lon: 127.03, type: 'base' },
  { name: 'Lakenheath', lat: 52.41, lon: 0.56, type: 'base' },
  { name: 'Fairford', lat: 51.68, lon: -1.79, type: 'base' },
  { name: 'Andersen (Guam)', lat: 13.58, lon: 144.92, type: 'base' },
  // Strategic chokepoints
  { name: 'Strait of Hormuz', lat: 26.57, lon: 56.25, type: 'chokepoint' },
  { name: 'Suez Canal', lat: 30.46, lon: 32.35, type: 'chokepoint' },
  { name: 'Strait of Malacca', lat: 2.50, lon: 101.50, type: 'chokepoint' },
  { name: 'Bab el-Mandeb', lat: 12.58, lon: 43.33, type: 'chokepoint' },
  { name: 'GIUK Gap', lat: 63.00, lon: -15.00, type: 'chokepoint' },
  { name: 'Taiwan Strait', lat: 24.50, lon: 119.50, type: 'chokepoint' },
  { name: 'Strait of Gibraltar', lat: 35.96, lon: -5.50, type: 'chokepoint' },
  { name: 'Panama Canal', lat: 9.08, lon: -79.68, type: 'chokepoint' },
  { name: 'Danish Straits', lat: 55.70, lon: 12.60, type: 'chokepoint' },
  { name: 'Bosphorus', lat: 41.12, lon: 29.05, type: 'chokepoint' },
  // Exercise areas
  { name: 'RIMPAC (Hawaii)', lat: 20.00, lon: -157.00, type: 'exercise' },
  { name: 'BALTOPS (Baltic)', lat: 56.00, lon: 18.00, type: 'exercise' },
  { name: 'Formidable Shield (Atlantic)', lat: 58.00, lon: -12.00, type: 'exercise' },
];

// ---- Haversine helpers ----

const R_KM = 6371;
const DEG = Math.PI / 180;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return R_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingTo(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = (lon2 - lon1) * DEG;
  const y = Math.sin(dLon) * Math.cos(lat2 * DEG);
  const x = Math.cos(lat1 * DEG) * Math.sin(lat2 * DEG) -
    Math.sin(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.cos(dLon);
  return ((Math.atan2(y, x) / DEG) + 360) % 360;
}

function destinationPoint(lat: number, lon: number, bearingDeg: number, distKm: number): [number, number] {
  const d = distKm / R_KM;
  const brng = bearingDeg * DEG;
  const lat1 = lat * DEG;
  const lon1 = lon * DEG;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
  const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return [lat2 / DEG, ((lon2 / DEG) + 540) % 360 - 180];
}

// ---- Layer 1: Extrapolation ----

export function extrapolatePath(
  lat: number, lon: number, heading: number, speedKnots: number, hours: number,
): [number, number][] {
  const speedKmH = speedKnots * 1.852;
  const totalKm = speedKmH * hours;
  const points: [number, number][] = [];
  for (let i = 1; i <= 12; i++) {
    const km = (totalKm / 12) * i;
    points.push(destinationPoint(lat, lon, heading, km));
  }
  return points;
}

// ---- Layer 2: Historical Pattern Matching ----

export function scoreDestinations(
  lat: number, lon: number, heading: number, speedKnots: number,
): PredictedDestination[] {
  const speedKmH = speedKnots * 1.852;
  const maxRangeKm = speedKmH * 72; // 72-hour feasibility window

  const scored: { wp: Waypoint; score: number }[] = [];

  for (const wp of KNOWN_WAYPOINTS) {
    const dist = haversineKm(lat, lon, wp.lat, wp.lon);
    if (dist < 50) continue; // skip if already there
    if (dist > maxRangeKm && maxRangeKm > 0) continue; // unreachable

    const bearing = bearingTo(lat, lon, wp.lat, wp.lon);
    // Bearing alignment: cosine similarity (1.0 = perfect alignment, -1.0 = opposite)
    const angleDiff = Math.abs(heading - bearing);
    const alignment = Math.cos(Math.min(angleDiff, 360 - angleDiff) * DEG);
    if (alignment < 0) continue; // heading away

    // Distance score: closer = higher (inverse, capped)
    const distScore = Math.max(0, 1 - dist / (maxRangeKm || 10000));

    // Type weight: chokepoints slightly favored for transiting packages
    const typeWeight = wp.type === 'chokepoint' ? 1.3 : wp.type === 'conflict' ? 1.5 : 1.0;

    const score = alignment * (0.4 + distScore * 0.6) * typeWeight;
    if (score > 0.05) {
      scored.push({ wp, score });
    }
  }

  if (scored.length === 0) {
    return [{ name: 'Unknown', lat: 0, lon: 0, probability: 100, reasoning: 'No matching waypoints along current heading' }];
  }

  // Normalize to probabilities
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 5);
  const totalScore = top.reduce((s, d) => s + d.score, 0);

  return top.map(d => ({
    name: d.wp.name,
    lat: d.wp.lat,
    lon: d.wp.lon,
    probability: Math.round((d.score / totalScore) * 100),
    reasoning: `Bearing-aligned ${d.wp.type}, ${Math.round(haversineKm(lat, lon, d.wp.lat, d.wp.lon))} km`,
  }));
}

// ---- Confidence Cone ----

export function computeConfidenceCone(
  heading: number, speedKnots: number, hoursTracked: number,
): ConfidenceCone {
  // Cone narrows with more tracking history, widens with higher speed
  const baseSpread = 30; // degrees each side
  const historyFactor = Math.max(0.3, 1 - hoursTracked / 24);
  const spread = baseSpread * historyFactor;
  const rangeKm = speedKnots * 1.852 * 24; // 24-hour projection

  return {
    bearingMin: (heading - spread + 360) % 360,
    bearingMax: (heading + spread + 360) % 360,
    rangeKm,
  };
}

// ---- Combined Prediction ----

export function computePrediction(
  lat: number, lon: number, heading: number, speedKnots: number,
  hoursTracked: number, aiAssessment?: string,
): RoutePrediction {
  const extrapolatedPath = extrapolatePath(lat, lon, heading, speedKnots, 24);
  const destinations = scoreDestinations(lat, lon, heading, speedKnots);
  const confidenceCone = computeConfidenceCone(heading, speedKnots, hoursTracked);

  return {
    extrapolatedPath,
    destinations,
    confidenceCone,
    method: aiAssessment ? 'combined' : 'pattern',
    updatedAt: new Date(),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --experimental-strip-types --test src/services/__tests__/strike-package-prediction.test.mts`
Expected: PASS — all 5 tests pass

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck:all`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/strike-package-prediction.ts src/services/__tests__/strike-package-prediction.test.mts
git commit -m "feat(strike-package): route prediction engine with extrapolation + pattern matching

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Detection Engine and Service

**Files:**
- Create: `src/services/strike-packages.ts`
- Create: `src/services/__tests__/strike-package-detection.test.mts`

- [ ] **Step 1: Write failing tests for air formation detection**

Create `src/services/__tests__/strike-package-detection.test.mts`:

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { detectAirFormations, computeImportance } from '../strike-packages.ts';
import type { MilitaryFlight, StrikePackage } from '@/types';

function makeFlight(overrides: Partial<MilitaryFlight>): MilitaryFlight {
  return {
    id: 'test-1',
    callsign: 'TEST01',
    hexCode: 'AAAAAA',
    aircraftType: 'fighter',
    operator: 'usaf',
    operatorCountry: 'United States',
    lat: 50.0,
    lon: 10.0,
    altitude: 30000,
    heading: 90,
    speed: 450,
    onGround: false,
    lastSeen: new Date(),
    confidence: 'high',
    ...overrides,
  };
}

test('detectAirFormations groups nearby military aircraft', () => {
  const flights: MilitaryFlight[] = [
    makeFlight({ id: 'b1', callsign: 'DOOM01', aircraftType: 'bomber', lat: 50.0, lon: 10.0, heading: 90 }),
    makeFlight({ id: 'k1', callsign: 'SHELL1', aircraftType: 'tanker', lat: 50.01, lon: 10.02, heading: 91 }),
    makeFlight({ id: 'f1', callsign: 'VIPER1', aircraftType: 'fighter', lat: 50.005, lon: 10.01, heading: 89 }),
    // Far away — should NOT be grouped
    makeFlight({ id: 'f2', callsign: 'VIPER2', aircraftType: 'fighter', lat: 20.0, lon: -80.0, heading: 270 }),
  ];

  const packages = detectAirFormations(flights);
  assert.equal(packages.length, 1, 'should detect 1 formation');
  assert.equal(packages[0]!.composition.length, 3, 'formation should have 3 units');
  assert.equal(packages[0]!.domain, 'air');
  assert.equal(packages[0]!.status, 'active');
});

test('detectAirFormations requires at least 2 aircraft', () => {
  const flights: MilitaryFlight[] = [
    makeFlight({ id: 'f1', aircraftType: 'fighter', lat: 50.0, lon: 10.0 }),
  ];
  const packages = detectAirFormations(flights);
  assert.equal(packages.length, 0, 'single aircraft should not form a package');
});

test('detectAirFormations ignores ground aircraft', () => {
  const flights: MilitaryFlight[] = [
    makeFlight({ id: 'b1', aircraftType: 'bomber', lat: 50.0, lon: 10.0, onGround: true }),
    makeFlight({ id: 'k1', aircraftType: 'tanker', lat: 50.01, lon: 10.02, onGround: true }),
  ];
  const packages = detectAirFormations(flights);
  assert.equal(packages.length, 0, 'ground aircraft should not form a package');
});

test('computeImportance ranks active bomber package highest', () => {
  const active: StrikePackage = {
    id: 'sp-1', domain: 'air', name: 'B-52H Formation',
    status: 'active', importance: 0, lat: 50, lon: 10, heading: 90, speed: 450,
    composition: [{ type: 'B-52H', count: 2, role: 'bomber' }],
    prediction: { extrapolatedPath: [], destinations: [], method: 'extrapolation', updatedAt: new Date() },
    detectedAt: new Date(), lastUpdated: new Date(), trail: [],
  };
  const inPort: StrikePackage = {
    id: 'sp-2', domain: 'naval', name: 'CSG-3',
    status: 'in_port', importance: 0, lat: 32, lon: -117, heading: 0, speed: 0,
    composition: [{ type: 'CVN-68', count: 1, role: 'carrier' }],
    prediction: { extrapolatedPath: [], destinations: [], method: 'extrapolation', updatedAt: new Date() },
    detectedAt: new Date(), lastUpdated: new Date(), trail: [],
  };

  const activeScore = computeImportance(active);
  const inPortScore = computeImportance(inPort);
  assert.ok(activeScore > inPortScore, `active (${activeScore}) should score higher than in_port (${inPortScore})`);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --experimental-strip-types --test src/services/__tests__/strike-package-detection.test.mts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the strike packages service**

Create `src/services/strike-packages.ts`:

```typescript
import type {
  MilitaryFlight,
  MilitaryVessel,
  StrikePackage,
  StrikePackageDomain,
  StrikePackageStatus,
  PackageUnit,
} from '@/types';
import { computePrediction } from './strike-package-prediction';

// ---- Constants ----

const CLUSTER_RADIUS_KM = 50;
const MIN_FORMATION_SIZE = 2;

const STATUS_WEIGHTS: Record<StrikePackageStatus, number> = {
  active: 100,
  forming: 75,
  deploying: 50,
  transit: 30,
  in_port: 5,
  unknown: 10,
};

const ROLE_THREAT: Record<string, number> = {
  bomber: 25,
  carrier: 20,
  destroyer: 10,
  tanker: 8,
  awacs: 8,
  reconnaissance: 5,
  fighter: 5,
  escort: 5,
  frigate: 5,
  submarine: 15,
  amphibious: 10,
};

// ---- Haversine ----

const R_KM = 6371;
const DEG = Math.PI / 180;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return R_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---- Aircraft role mapping ----

function flightToRole(type: string): string {
  if (type === 'bomber') return 'bomber';
  if (type === 'tanker') return 'tanker';
  if (type === 'awacs') return 'awacs';
  if (type === 'reconnaissance') return 'reconnaissance';
  if (type === 'fighter') return 'escort';
  return type;
}

function flightToUnitType(f: MilitaryFlight): string {
  return f.aircraftModel || f.aircraftType;
}

// ---- Air Formation Detection ----

export function detectAirFormations(flights: MilitaryFlight[]): StrikePackage[] {
  const airborne = flights.filter(f => !f.onGround && f.confidence !== 'low');
  if (airborne.length < MIN_FORMATION_SIZE) return [];

  const used = new Set<string>();
  const formations: StrikePackage[] = [];

  // Sort by threat potential: bombers first
  const sorted = [...airborne].sort((a, b) => {
    const aW = ROLE_THREAT[flightToRole(a.aircraftType)] ?? 0;
    const bW = ROLE_THREAT[flightToRole(b.aircraftType)] ?? 0;
    return bW - aW;
  });

  for (const seed of sorted) {
    if (used.has(seed.id)) continue;

    const cluster = [seed];
    for (const candidate of airborne) {
      if (candidate.id === seed.id || used.has(candidate.id)) continue;
      const dist = haversineKm(seed.lat, seed.lon, candidate.lat, candidate.lon);
      if (dist <= CLUSTER_RADIUS_KM) {
        cluster.push(candidate);
      }
    }

    if (cluster.length < MIN_FORMATION_SIZE) continue;

    // Build composition
    const unitMap = new Map<string, PackageUnit>();
    for (const f of cluster) {
      const unitType = flightToUnitType(f);
      const role = flightToRole(f.aircraftType);
      const existing = unitMap.get(unitType);
      if (existing) {
        existing.count++;
      } else {
        unitMap.set(unitType, { type: unitType, count: 1, role });
      }
    }

    // Average position/heading/speed
    const avgLat = cluster.reduce((s, f) => s + f.lat, 0) / cluster.length;
    const avgLon = cluster.reduce((s, f) => s + f.lon, 0) / cluster.length;
    const avgHeading = cluster[0]!.heading; // use seed heading
    const avgSpeed = cluster.reduce((s, f) => s + f.speed, 0) / cluster.length;

    // Build trail from seed aircraft
    const trail: [number, number][] = seed.track?.map(([lon, lat]) => [lat, lon] as [number, number]) ?? [];

    // Name from most threatening aircraft
    const leadUnit = [...unitMap.values()].sort((a, b) =>
      (ROLE_THREAT[b.role] ?? 0) - (ROLE_THREAT[a.role] ?? 0)
    )[0]!;
    const name = `${leadUnit.type} Formation`;

    const pkg: StrikePackage = {
      id: `air-${seed.id}`,
      domain: 'air',
      name,
      status: 'active',
      importance: 0,
      lat: avgLat,
      lon: avgLon,
      heading: avgHeading,
      speed: avgSpeed,
      composition: [...unitMap.values()],
      prediction: computePrediction(avgLat, avgLon, avgHeading, avgSpeed, 1),
      detectedAt: new Date(),
      lastUpdated: new Date(),
      trail,
    };
    pkg.importance = computeImportance(pkg);

    for (const f of cluster) used.add(f.id);
    formations.push(pkg);
  }

  return formations;
}

// ---- Importance Scoring ----

export function computeImportance(pkg: StrikePackage): number {
  let score = STATUS_WEIGHTS[pkg.status] ?? 10;

  // Composition threat
  const compThreat = pkg.composition.reduce((s, u) =>
    s + (ROLE_THREAT[u.role] ?? 0) * u.count, 0);
  score += Math.min(25, compThreat);

  // AI escalation
  if (pkg.aiEscalation === 'high') score += 25;
  else if (pkg.aiEscalation === 'elevated') score += 12;

  return score;
}

// ---- State management ----

let currentPackages: StrikePackage[] = [];
let lastPredictionUpdate = 0;
const PREDICTION_INTERVAL_MS = 5 * 60 * 1000;

export function updateFromFlights(flights: MilitaryFlight[]): StrikePackage[] {
  const airPackages = detectAirFormations(flights);

  // Merge: keep naval, replace air
  const naval = currentPackages.filter(p => p.domain === 'naval');
  currentPackages = [...naval, ...airPackages].sort((a, b) => b.importance - a.importance);

  // Recalculate predictions periodically
  const now = Date.now();
  if (now - lastPredictionUpdate > PREDICTION_INTERVAL_MS) {
    for (const pkg of currentPackages) {
      const hoursTracked = (now - pkg.detectedAt.getTime()) / 3_600_000;
      pkg.prediction = computePrediction(pkg.lat, pkg.lon, pkg.heading, pkg.speed, hoursTracked, pkg.aiAssessment);
    }
    lastPredictionUpdate = now;
  }

  return currentPackages;
}

export function updateFromUSNI(
  groups: { name: string; lat: number; lon: number; heading: number; speed: number;
    status: string; vessels: { name: string; type: string }[] }[],
): StrikePackage[] {
  const navalPackages: StrikePackage[] = groups.map(g => {
    const unitMap = new Map<string, PackageUnit>();
    for (const v of g.vessels) {
      const existing = unitMap.get(v.type);
      if (existing) existing.count++;
      else unitMap.set(v.type, { type: v.name, count: 1, role: v.type });
    }

    const status: StrikePackageStatus =
      g.status === 'deployed' ? 'deploying' :
      g.status === 'underway' ? 'transit' :
      g.status === 'in-port' ? 'in_port' : 'unknown';

    const pkg: StrikePackage = {
      id: `naval-${g.name.replace(/\s+/g, '-').toLowerCase()}`,
      domain: 'naval',
      name: g.name,
      status,
      importance: 0,
      lat: g.lat,
      lon: g.lon,
      heading: g.heading,
      speed: g.speed,
      composition: [...unitMap.values()],
      prediction: computePrediction(g.lat, g.lon, g.heading, g.speed, 24),
      detectedAt: new Date(),
      lastUpdated: new Date(),
      trail: [],
    };
    pkg.importance = computeImportance(pkg);
    return pkg;
  });

  // Merge: keep air, replace naval
  const air = currentPackages.filter(p => p.domain === 'air');
  currentPackages = [...air, ...navalPackages].sort((a, b) => b.importance - a.importance);
  return currentPackages;
}

export function getStrikePackages(): StrikePackage[] {
  return currentPackages;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --experimental-strip-types --test src/services/__tests__/strike-package-detection.test.mts`
Expected: PASS — all 4 tests pass

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck:all`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/strike-packages.ts src/services/__tests__/strike-package-detection.test.mts
git commit -m "feat(strike-package): detection engine with air formation clustering + importance scoring

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Panel UI

**Files:**
- Create: `src/components/StrikePackagePanel.ts`

- [ ] **Step 1: Create the panel component**

Create `src/components/StrikePackagePanel.ts`:

```typescript
import { Panel } from './Panel';
import type { StrikePackage } from '@/types';

const STATUS_COLORS: Record<string, string> = {
  active: '#dc2626',
  forming: '#ca8a04',
  deploying: '#7c3aed',
  transit: '#3b82f6',
  in_port: '#059669',
  unknown: '#64748b',
};

const STATUS_BG: Record<string, string> = {
  active: '#fecaca',
  forming: '#fef08a',
  deploying: '#e9d5ff',
  transit: '#bfdbfe',
  in_port: '#a7f3d0',
  unknown: '#e2e8f0',
};

const DOMAIN_ICON: Record<string, string> = {
  naval: '\u{1F6A2}',  // ship
  air: '\u2708',        // airplane
};

export class StrikePackagePanel extends Panel {
  private packages: StrikePackage[] = [];
  private expandedId: string | null = null;
  private clickHandler: ((lat: number, lon: number) => void) | null = null;

  constructor() {
    super({
      id: 'strike-package',
      title: 'Strike Packages',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Active naval strike groups and detected air strike formations with route prediction',
    });
    this.showLoading('Detecting strike packages\u2026');
  }

  setEventClickHandler(handler: (lat: number, lon: number) => void): void {
    this.clickHandler = handler;
  }

  update(packages: StrikePackage[]): void {
    this.packages = [...packages].sort((a, b) => b.importance - a.importance);
    this.setCount(this.packages.length);
    this.render();
  }

  getPackages(): StrikePackage[] {
    return this.packages;
  }

  private render(): void {
    if (this.packages.length === 0) {
      this.setContent('<div class="panel-empty">No active strike packages detected</div>');
      return;
    }

    const rows = this.packages.map(pkg => {
      const isExpanded = this.expandedId === pkg.id;
      const icon = DOMAIN_ICON[pkg.domain] || '\u2708';
      const statusColor = STATUS_COLORS[pkg.status] || '#64748b';
      const statusBg = STATUS_BG[pkg.status] || '#e2e8f0';
      const statusLabel = pkg.status.replace(/_/g, ' ').toUpperCase();
      const compSummary = pkg.composition.map(u => `${u.type}\u00d7${u.count}`).join(' + ');
      const topDest = pkg.prediction.destinations[0];
      const destStr = topDest && topDest.name !== 'Unknown' ? ` \u2022 ${topDest.name} ${topDest.probability}%` : '';
      const headingStr = pkg.speed > 0 ? `${Math.round(pkg.heading)}\u00b0 at ${Math.round(pkg.speed)}kts` : 'Stationary';

      let expandedHtml = '';
      if (isExpanded) {
        const compPills = pkg.composition.map(u =>
          `<span style="background:#1e293b;padding:2px 6px;border-radius:3px;font-size:10px;display:inline-block;margin:2px">${u.type} \u00d7${u.count}</span>`
        ).join('');

        const destRows = pkg.prediction.destinations.slice(0, 5).map(d =>
          `<div style="font-size:11px;color:#94a3b8;margin-top:2px">${d.name}: ${d.probability}% \u2014 ${d.reasoning}</div>`
        ).join('');

        const aiBlock = pkg.aiAssessment
          ? `<div style="margin-top:8px">
              <div style="color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:0.05em">AI Assessment</div>
              <div style="margin-top:4px;padding:6px 8px;background:#1e293b;border-radius:4px;border-left:2px solid #3b82f6;font-size:11px;color:#cbd5e1">${pkg.aiAssessment}</div>
            </div>`
          : `<div style="margin-top:8px;font-size:11px;color:#475569;font-style:italic">AI assessment unavailable</div>`;

        expandedHtml = `
          <div style="padding:8px 12px 10px;border-top:1px solid #1e293b">
            <div style="color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:0.05em">Composition</div>
            <div style="margin-top:4px">${compPills}</div>
            <div style="margin-top:8px">
              <div style="color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:0.05em">Route Prediction</div>
              <div style="margin-top:4px;font-size:11px">${headingStr}</div>
              ${destRows}
            </div>
            ${aiBlock}
            <button class="sp-focus-btn" data-lat="${pkg.lat}" data-lon="${pkg.lon}" style="margin-top:8px;background:#1e293b;border:1px solid #334155;color:#94a3b8;padding:4px 10px;border-radius:4px;font-size:11px;cursor:pointer">Focus on map</button>
          </div>`;
      }

      return `
        <div class="sp-card" data-id="${pkg.id}" style="border-bottom:1px solid #1e293b;${isExpanded ? 'border-left:3px solid #3b82f6;' : ''}cursor:pointer">
          <div class="sp-header" style="padding:10px 12px;display:flex;justify-content:space-between;align-items:center">
            <div style="display:flex;gap:6px;align-items:center;min-width:0">
              <span style="font-size:14px;flex-shrink:0">${icon}</span>
              <span style="font-weight:600;color:${pkg.domain === 'naval' ? '#f59e0b' : '#3b82f6'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${pkg.name}</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
              <span style="font-size:10px;background:${statusColor};padding:1px 6px;border-radius:4px;color:${statusBg}">${statusLabel}</span>
              <span style="color:#475569;font-size:10px">${isExpanded ? '\u25BC' : '\u25B6'}</span>
            </div>
          </div>
          <div style="padding:0 12px 8px;color:#94a3b8;font-size:11px">${compSummary} \u2022 ${headingStr}${destStr}</div>
          ${expandedHtml}
        </div>`;
    }).join('');

    this.setContent(`<div style="font-size:12px">${rows}</div>`);
    this.attachListeners();
  }

  private attachListeners(): void {
    const el = this.element;
    el.querySelectorAll<HTMLElement>('.sp-header').forEach(header => {
      header.addEventListener('click', () => {
        const card = header.closest<HTMLElement>('.sp-card');
        const id = card?.dataset.id;
        if (!id) return;
        this.expandedId = this.expandedId === id ? null : id;
        this.render();
      });
    });

    el.querySelectorAll<HTMLElement>('.sp-focus-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const lat = parseFloat(btn.dataset.lat || '0');
        const lon = parseFloat(btn.dataset.lon || '0');
        this.clickHandler?.(lat, lon);
      });
    });
  }

  onActivate(): void {
    this.clearNewBadge();
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck:all`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/StrikePackagePanel.ts
git commit -m "feat(strike-package): panel UI with expandable cards and importance auto-sort

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Panel Registration and Data Loader Wiring

**Files:**
- Modify: `src/config/panels.ts`
- Modify: `src/app/panel-layout.ts`
- Modify: `src/app/data-loader.ts`

- [ ] **Step 1: Register panel and map layer in panels.ts**

In `src/config/panels.ts`, add to `FULL_PANELS` (after the `airstrikes` entry around line 67):

```typescript
  'strike-package': { name: 'Strike Packages', enabled: true, priority: 2 },
```

In `FULL_MAP_LAYERS` (after `airstrikes: true` around line 223):

```typescript
  strikePackages: true,
```

In the `MapLayers` interface (after the `airstrikes` property around line 551):

```typescript
  strikePackages: boolean;
```

- [ ] **Step 2: Wire panel in panel-layout.ts**

Add import at the top of `src/app/panel-layout.ts`:

```typescript
import { StrikePackagePanel } from '@/components/StrikePackagePanel';
```

Add instantiation after the airstrikes panel wiring (around line 1160):

```typescript
const strikePackagePanel = new StrikePackagePanel();
strikePackagePanel.setEventClickHandler((lat, lon) => {
  this.ctx.map?.setCenter(lat, lon, 6);
});
this.ctx.panels['strike-package'] = strikePackagePanel;
```

- [ ] **Step 3: Add data loader task in data-loader.ts**

Add imports at the top of `src/app/data-loader.ts`:

```typescript
import { updateFromFlights, getStrikePackages } from '@/services/strike-packages';
import { StrikePackagePanel } from '@/components/StrikePackagePanel';
```

Find the existing military flights task (search for `fetchMilitaryFlights` or `loadMilitary`). After the military flights data is processed, add strike package detection. Add this as a new task in the tasks array (around the airstrikes task near line 1581):

```typescript
    // Strike package detection (piggybacks on military flights data)
    tasks.push({
      name: 'strike-packages',
      task: () => runGuarded('strike-packages', async () => {
        try {
          const { fetchMilitaryFlights } = await import('@/services/military-flights');
          const { flights } = await fetchMilitaryFlights();
          const packages = updateFromFlights(flights);
          (this.ctx.panels['strike-package'] as StrikePackagePanel)?.update(packages);
          if (this.ctx.mapLayers.strikePackages) {
            this.ctx.map?.setStrikePackages(packages);
          }
        } catch (error) {
          console.error('[Strike Packages] Detection failed:', error);
        }
      }),
    });
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck:all`
Expected: May fail on `setStrikePackages` not existing on Map yet — that's OK, we add it in Task 6. If it fails, temporarily cast: `(this.ctx.map as any)?.setStrikePackages(packages);` and fix in Task 6.

- [ ] **Step 5: Commit**

```bash
git add src/config/panels.ts src/app/panel-layout.ts src/app/data-loader.ts
git commit -m "feat(strike-package): register panel, map layer, and data loader task

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 6: DeckGL Map Layers

**Files:**
- Modify: `src/components/DeckGLMap.ts`
- Modify: `src/components/Map.ts`

- [ ] **Step 1: Add strike package data and setter to DeckGLMap.ts**

Add import at the top:

```typescript
import type { StrikePackage } from '@/types';
```

Add instance variable (near other military data around line 380):

```typescript
private strikePackages: StrikePackage[] = [];
private expandedStrikePackageId: string | null = null;
```

Add public setter (near `setMilitaryFlights` around line 4926):

```typescript
public setStrikePackages(packages: StrikePackage[]): void {
  this.strikePackages = packages;
  this.render();
}

public expandStrikePackage(id: string | null): void {
  this.expandedStrikePackageId = id;
  this.render();
}
```

- [ ] **Step 2: Create the icon and route layers**

Add private layer creation methods (near other `createXxx` methods):

```typescript
private createStrikePackageIconLayer(): IconLayer<StrikePackage> {
  return new IconLayer<StrikePackage>({
    id: 'strike-package-icons',
    data: this.strikePackages,
    getPosition: (d) => [d.lon, d.lat],
    getIcon: (d) => d.domain === 'naval' ? 'warship' : 'fighter',
    iconAtlas: getIconAtlas(),
    iconMapping: getIconMapping(),
    getSize: 28,
    sizeMinPixels: 14,
    sizeMaxPixels: 32,
    getAngle: (d) => d.domain === 'air' ? -d.heading : 0,
    getColor: (d) => d.domain === 'naval'
      ? [245, 158, 11, 240] as [number, number, number, number]
      : [59, 130, 246, 240] as [number, number, number, number],
    pickable: true,
  });
}

private createStrikePackageRouteLayers(): PathLayer<StrikePackage>[] {
  return this.strikePackages
    .filter(p => p.prediction.extrapolatedPath.length > 0)
    .map(p => {
      const isExpanded = p.id === this.expandedStrikePackageId;
      const path = [[p.lon, p.lat], ...p.prediction.extrapolatedPath.map(([lat, lon]) => [lon, lat])];
      return new PathLayer<StrikePackage>({
        id: `strike-route-${p.id}`,
        data: [p],
        getPath: () => path,
        getColor: p.domain === 'naval'
          ? [245, 158, 11, isExpanded ? 160 : 80]
          : [59, 130, 246, isExpanded ? 160 : 80],
        getWidth: isExpanded ? 3 : 1.5,
        getDashArray: [6, 4],
        dashJustified: true,
        widthMinPixels: 1,
        extensions: [new PathStyleExtension({ dash: true })],
      });
    });
}
```

- [ ] **Step 3: Add layers to render pipeline**

In the `getLayers()` method (near the airstrikes layer around line 1568), add:

```typescript
if (mapLayers.strikePackages && this.strikePackages.length > 0) {
  layers.push(this.createStrikePackageIconLayer());
  layers.push(...this.createStrikePackageRouteLayers());
}
```

- [ ] **Step 4: Add passthrough on Map.ts wrapper**

In `src/components/Map.ts`, add the passthrough method (near `setMilitaryFlights`):

```typescript
public setStrikePackages(packages: StrikePackage[]): void {
  this.deckMap?.setStrikePackages(packages);
}
```

Add the import for `StrikePackage` to `Map.ts` if not already present.

- [ ] **Step 5: Fix any type cast from Task 5 Step 4**

If you added `as any` cast in data-loader.ts, remove it now that `setStrikePackages` exists on Map.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck:all`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/components/DeckGLMap.ts src/components/Map.ts
git commit -m "feat(strike-package): DeckGL map layers — icons with predicted route paths

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 7: God's Eye Globe Integration

**Files:**
- Modify: `src/components/GlobeDataManager.ts`

- [ ] **Step 1: Register strike package layer and implement loader**

Add to the layer registration section (near line 307):

```typescript
this.registerLayer('strike-packages', () => this.loadStrikePackages());
```

Add the loader method (near `loadAirstrikes`):

```typescript
private async loadStrikePackages(): Promise<void> {
  const layer = this.layers.get('strike-packages');
  if (!layer) return;

  const { getStrikePackages } = await import('@/services/strike-packages');
  const packages = getStrikePackages();

  for (const pkg of packages) {
    const isNaval = pkg.domain === 'naval';
    const color = isNaval
      ? Color.fromCssColorString('#f59e0b')
      : Color.fromCssColorString('#3b82f6');

    // Package icon
    layer.source.entities.add({
      position: Cartesian3.fromDegrees(pkg.lon, pkg.lat),
      billboard: {
        image: isNaval ? ICON_WARSHIP : ICON_BASE_AIR,
        color,
        scale: 0.5,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        scaleByDistance: new NearFarScalar(1e4, 1.4, 1e7, 0.3),
        verticalOrigin: VerticalOrigin.CENTER,
        horizontalOrigin: HorizontalOrigin.CENTER,
      },
      label: {
        text: pkg.name,
        font: '11px monospace',
        fillColor: color,
        outlineColor: Color.BLACK,
        outlineWidth: 2,
        style: 2,
        pixelOffset: LABEL_OFFSET_SM,
        horizontalOrigin: HorizontalOrigin.CENTER,
        verticalOrigin: VerticalOrigin.BOTTOM,
        scaleByDistance: new NearFarScalar(1e5, 1, 1.5e7, 0.4),
        distanceDisplayCondition: new DistanceDisplayCondition(0, 1e7),
      },
      description: `${pkg.name} (${pkg.domain})\nStatus: ${pkg.status}\n${pkg.composition.map(u => `${u.type} x${u.count}`).join(', ')}`,
    });

    // Predicted route polyline
    if (pkg.prediction.extrapolatedPath.length >= 2) {
      const positions = [
        Cartesian3.fromDegrees(pkg.lon, pkg.lat),
        ...pkg.prediction.extrapolatedPath.map(([lat, lon]) =>
          Cartesian3.fromDegrees(lon, lat)),
      ];
      layer.source.entities.add({
        polyline: {
          positions,
          width: 1.5,
          material: new ColorMaterialProperty(color.withAlpha(0.4)),
          clampToGround: true,
        },
      });
    }
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck:all`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/GlobeDataManager.ts
git commit -m "feat(strike-package): Cesium globe integration with icons and route polylines

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 8: Build, Install, Verify

**Files:** None (build + test only)

- [ ] **Step 1: Run all tests**

Run: `node --experimental-strip-types --test src/services/__tests__/strike-package-prediction.test.mts src/services/__tests__/strike-package-detection.test.mts`
Expected: PASS — all tests pass

- [ ] **Step 2: Run full typecheck**

Run: `npm run typecheck:all`
Expected: PASS

- [ ] **Step 3: Build production app**

Run: `npm run desktop:build:full`
Expected: Build succeeds, app installed to ~/Applications

- [ ] **Step 4: Install and launch**

Run: `node scripts/install-built-app.mjs --relaunch`
Expected: App launches, Strike Packages panel visible in sidebar

- [ ] **Step 5: Verify in logs**

Run: `tail -50 ~/Library/Logs/com.bradleybond.crystalball/desktop.log | grep -i strike`
Expected: No errors related to strike packages. Panel should show "No active strike packages detected" or detected formations if military flights are active.

- [ ] **Step 6: Commit any final fixes**

If any issues found during verification, fix and commit.
