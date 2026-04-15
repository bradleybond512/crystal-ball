import type {
  MilitaryFlight,
  StrikePackage,
  StrikePackageStatus,
  PackageUnit,
} from '@/types';
import { computePrediction } from './strike-package-prediction.ts';

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
  return f.aircraftModel ?? f.aircraftType;
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
    const avgHeading = seed.heading;
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
