/* eslint-disable sonarjs/cognitive-complexity, sonarjs/no-nested-conditional */
/**
 * Strike Package Intelligence
 *
 * Detects coordinated military aircraft formations ("strike packages") from
 * raw MilitaryFlight data and classifies them by mission type. A strike
 * package is a group of aircraft flying in temporal + spatial proximity
 * whose role mix suggests a coordinated operation rather than routine
 * transit.
 *
 * Classifications:
 *  - "offensive-strike"  — strike + escort + tanker + (optionally) AWACS/EW
 *  - "combat-air-patrol" — 2+ fighters loitering in a defensive orbit
 *  - "isr-mission"       — reconnaissance + AEW/AWACS + tanker support
 *  - "tanker-bridge"     — multi-tanker refueling track supporting other assets
 *  - "humanitarian"      — transport cluster with no fighters/bombers
 *  - "training"          — fighter-heavy cluster near home bases, no tankers/AWACS
 *  - "unclassified"      — cluster below classification confidence
 *
 * Threat scoring is 0-100 weighted by:
 *  - Role diversity (fighter + strike + tanker + AWACS = high)
 *  - Proximity to sensitive airspace (hotspots / contested regions)
 *  - Operator (foreign operator in contested region = boost)
 *  - Altitude profile (strike altitudes vs transit altitudes)
 *  - Cluster size
 */

import type { MilitaryFlight, MilitaryAircraftType, MilitaryOperator } from '@/types';
import { haversineKm } from './proximity-filter';
import { classifyRegion, type MatrixRegion } from './correlation-matrix';

// ── Types ─────────────────────────────────────────────────────────────────────

export type StrikePackageType =
  | 'offensive-strike'
  | 'combat-air-patrol'
  | 'isr-mission'
  | 'tanker-bridge'
  | 'humanitarian'
  | 'training'
  | 'unclassified';

export type PackageThreatLevel = 'critical' | 'high' | 'elevated' | 'routine';

export interface StrikePackageRole {
  type: MilitaryAircraftType;
  count: number;
  examples: string[]; // up to 3 callsigns
}

export interface FormationCoherence {
  /** Heading convergence: 0 = scattered, 1 = all pointed same direction */
  headingConvergence: number;
  /** Speed coherence: 0 = wildly different speeds, 1 = all matching */
  speedCoherence: number;
  /** Are aircraft converging on a single point? */
  isConverging: boolean;
  /** If converging, estimated convergence point */
  convergenceLat?: number;
  convergenceLon?: number;
  /** Distance from convergence point to nearest sensitive zone (km), if converging */
  convergenceToSensitiveKm?: number;
}

export interface StrikePackage {
  id: string;
  /** Classification of the formation */
  packageType: StrikePackageType;
  /** Primary label for UI */
  label: string;
  /** Human-readable description */
  description: string;
  /** Aircraft composition */
  roles: StrikePackageRole[];
  /** Total number of aircraft */
  aircraftCount: number;
  /** Unique operator countries */
  operators: MilitaryOperator[];
  /** Centroid of the formation */
  lat: number;
  lon: number;
  /** Approximate radius of the formation in km */
  radiusKm: number;
  /** Mean altitude of the package (feet) */
  meanAltitudeFt: number;
  /** Mean speed (knots) */
  meanSpeedKts: number;
  /** Matrix region classification */
  region: MatrixRegion | null;
  /** Threat score 0-100 */
  threatScore: number;
  /** Threat level label */
  threatLevel: PackageThreatLevel;
  /** Is formation in a sensitive airspace near a hotspot? */
  inSensitiveAirspace: boolean;
  /** Formation heading/velocity analysis */
  coherence: FormationCoherence;
  /** Flight IDs in this package */
  flightIds: string[];
  /** Timestamp of detection */
  detectedAt: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Spatial clustering tolerance. Aircraft within this radius of any member
 *  can be grouped into the same package. */
const PACKAGE_RADIUS_KM = 150;

/** Minimum aircraft to constitute a package. */
const MIN_PACKAGE_SIZE = 3;

/** Aircraft types considered offensive/strike-capable. */
const STRIKE_TYPES = new Set<MilitaryAircraftType>(['fighter', 'bomber']);

/** Sensitive airspace hotspots (lat, lon, radius km, label). Used to flag
 *  packages that appear in contested or strategically important areas. */
const SENSITIVE_AIRSPACE: { lat: number; lon: number; radiusKm: number; label: string }[] = [
  { lat: 24.5,  lon: 54.5,  radiusKm: 800, label: 'Persian Gulf' },
  { lat: 24,  lon: 122, radiusKm: 800, label: 'Taiwan Strait' },
  { lat: 50,  lon: 30,  radiusKm: 800, label: 'Ukraine' },
  { lat: 31.5,  lon: 34.5,  radiusKm: 500, label: 'Israel/Gaza' },
  { lat: 15,  lon: 45,  radiusKm: 800, label: 'Yemen/Red Sea' },
  { lat: 38,  lon: 126, radiusKm: 500, label: 'Korean Peninsula' },
  { lat: 43,  lon: 34,  radiusKm: 500, label: 'Black Sea' },
  { lat: 57,  lon: 24,  radiusKm: 800, label: 'Baltic' },
  { lat: 14,  lon: 115, radiusKm: 800, label: 'South China Sea' },
  { lat: 35,  lon: 36,  radiusKm: 500, label: 'Syria' },
  { lat: 80,  lon: 20,  radiusKm: 1500, label: 'Arctic' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function isInSensitiveAirspace(lat: number, lon: number): { inZone: boolean; zoneLabel?: string } {
  for (const zone of SENSITIVE_AIRSPACE) {
    if (haversineKm(lat, lon, zone.lat, zone.lon) <= zone.radiusKm) {
      return { inZone: true, zoneLabel: zone.label };
    }
  }
  return { inZone: false };
}

function clusterFlights(flights: MilitaryFlight[]): MilitaryFlight[][] {
  const clusters: MilitaryFlight[][] = [];
  const assigned = new Set<string>();

  for (const seed of flights) {
    if (assigned.has(seed.id)) continue;
    if (seed.onGround) continue;

    const cluster: MilitaryFlight[] = [seed];
    assigned.add(seed.id);

    // Expand cluster greedily: any flight within PACKAGE_RADIUS_KM of any member joins.
    let grew = true;
    while (grew) {
      grew = false;
      for (const candidate of flights) {
        if (assigned.has(candidate.id)) continue;
        if (candidate.onGround) continue;
        for (const member of cluster) {
          if (haversineKm(member.lat, member.lon, candidate.lat, candidate.lon) <= PACKAGE_RADIUS_KM) {
            cluster.push(candidate);
            assigned.add(candidate.id);
            grew = true;
            break;
          }
        }
      }
    }

    if (cluster.length >= MIN_PACKAGE_SIZE) clusters.push(cluster);
  }

  return clusters;
}

function roleBreakdown(cluster: MilitaryFlight[]): StrikePackageRole[] {
  const byType = new Map<MilitaryAircraftType, { count: number; examples: string[] }>();
  for (const f of cluster) {
    const entry = byType.get(f.aircraftType) ?? { count: 0, examples: [] };
    entry.count += 1;
    if (entry.examples.length < 3 && f.callsign) entry.examples.push(f.callsign);
    byType.set(f.aircraftType, entry);
  }
  return [...byType.entries()]
    .map(([type, info]) => ({ type, count: info.count, examples: info.examples }))
    .sort((a, b) => b.count - a.count);
}

function countByCategory(roles: StrikePackageRole[]): { strike: number; tanker: number; awacs: number; recon: number; transport: number; support: number; fighter: number; bomber: number } {
  let strike = 0, tanker = 0, awacs = 0, recon = 0, transport = 0, fighter = 0, bomber = 0;
  for (const r of roles) {
    if (r.type === 'fighter') fighter += r.count;
    if (r.type === 'bomber') bomber += r.count;
    if (STRIKE_TYPES.has(r.type)) strike += r.count;
    if (r.type === 'tanker') tanker += r.count;
    if (r.type === 'awacs') awacs += r.count;
    if (r.type === 'reconnaissance') recon += r.count;
    if (r.type === 'transport') transport += r.count;
  }
  const support = tanker + awacs + recon;
  return { strike, tanker, awacs, recon, transport, support, fighter, bomber };
}

/** Heading convergence: 1 = all same direction, 0 = scattered. Uses circular variance. */
function headingConvergence(headings: number[]): number {
  if (headings.length < 2) return 1;
  let sinSum = 0;
  let cosSum = 0;
  for (const h of headings) {
    const rad = (h * Math.PI) / 180;
    sinSum += Math.sin(rad);
    cosSum += Math.cos(rad);
  }
  // R̄ = resultant length / n — 1 when perfectly aligned, 0 when uniform spread
  return Math.hypot(sinSum, cosSum) / headings.length;
}

/** Speed coherence: 1 = all same speed, 0 = wildly different. Uses coefficient of variation. */
function speedCoherence(speeds: number[]): number {
  if (speeds.length < 2) return 1;
  const m = speeds.reduce((s, v) => s + v, 0) / speeds.length;
  if (m <= 0) return 1;
  const variance = speeds.reduce((s, v) => s + (v - m) ** 2, 0) / speeds.length;
  const cv = Math.sqrt(variance) / m;
  // CV of 0 = perfect coherence, CV of 1+ = no coherence
  return Math.max(0, 1 - cv);
}

/** Degrees to radians */
const DEG2RAD = Math.PI / 180;

/**
 * Project a point along a heading by a distance (km).
 * Simple equirectangular approximation — sufficient for 200-500km distances.
 */
function projectPoint(lat: number, lon: number, headingDeg: number, distKm: number): { lat: number; lon: number } {
  const R = 6371;
  const d = distKm / R; // angular distance
  const h = headingDeg * DEG2RAD;
  const latRad = lat * DEG2RAD;
  const newLat = lat + (d * Math.cos(h) * 180) / Math.PI;
  const newLon = lon + ((d * Math.sin(h)) / Math.cos(latRad)) * (180 / Math.PI);
  return { lat: newLat, lon: newLon };
}

/**
 * Analyze formation coherence: heading convergence, speed matching,
 * and whether the formation is converging on a point near sensitive airspace.
 */
function analyzeFormation(cluster: MilitaryFlight[]): FormationCoherence {
  const airborne = cluster.filter(f => !f.onGround && f.speed > 50);
  if (airborne.length < 2) {
    return { headingConvergence: 0, speedCoherence: 0, isConverging: false };
  }

  const headings = airborne.map(f => f.heading);
  const speeds = airborne.map(f => f.speed);
  const hConv = headingConvergence(headings);
  const sCoherence = speedCoherence(speeds);

  // Check convergence: project each aircraft along its heading by 200km,
  // see if projected points cluster tightly (within 100km of each other).
  const projections = airborne.map(f => projectPoint(f.lat, f.lon, f.heading, 200));
  const projLat = projections.reduce((s, p) => s + p.lat, 0) / projections.length;
  const projLon = projections.reduce((s, p) => s + p.lon, 0) / projections.length;

  let maxProjSpread = 0;
  for (const p of projections) {
    const d = haversineKm(projLat, projLon, p.lat, p.lon);
    if (d > maxProjSpread) maxProjSpread = d;
  }

  // Converging if projected points are within 100km of their centroid
  // AND tighter than their current spread
  const currentLat = airborne.reduce((s, f) => s + f.lat, 0) / airborne.length;
  const currentLon = airborne.reduce((s, f) => s + f.lon, 0) / airborne.length;
  let currentSpread = 0;
  for (const f of airborne) {
    const d = haversineKm(currentLat, currentLon, f.lat, f.lon);
    if (d > currentSpread) currentSpread = d;
  }

  const isConverging = maxProjSpread < 100 && maxProjSpread < currentSpread * 0.7;

  const result: FormationCoherence = { headingConvergence: hConv, speedCoherence: sCoherence, isConverging };

  if (isConverging) {
    result.convergenceLat = projLat;
    result.convergenceLon = projLon;
    // Check distance from convergence point to nearest sensitive zone
    for (const zone of SENSITIVE_AIRSPACE) {
      const d = haversineKm(projLat, projLon, zone.lat, zone.lon);
      if (d <= zone.radiusKm) {
        result.convergenceToSensitiveKm = Math.round(d);
        break;
      }
    }
  }

  return result;
}

function classifyPackage(
  cluster: MilitaryFlight[],
  roles: StrikePackageRole[],
): { type: StrikePackageType; label: string; description: string } {
  const c = countByCategory(roles);
  const n = cluster.length;
  const fighterPct = c.fighter / n;
  const transportPct = c.transport / n;

  // Offensive strike: strike + support (tanker or AWACS)
  if (c.strike >= 2 && (c.tanker >= 1 || c.awacs >= 1)) {
    const composition = [
      c.fighter > 0 ? `${c.fighter} fighter${c.fighter === 1 ? '' : 's'}` : '',
      c.bomber > 0 ? `${c.bomber} bomber${c.bomber === 1 ? '' : 's'}` : '',
      c.tanker > 0 ? `${c.tanker} tanker${c.tanker === 1 ? '' : 's'}` : '',
      c.awacs > 0 ? `${c.awacs} AWACS` : '',
    ].filter(Boolean).join(' + ');
    return {
      type: 'offensive-strike',
      label: 'Offensive Strike Package',
      description: `Coordinated strike formation: ${composition}. Supported by refueling/C2 assets — signature of a pre-planned offensive operation.`,
    };
  }

  // ISR mission: recon + AWACS + tanker, no strike
  if ((c.recon >= 1 || c.awacs >= 1) && c.tanker >= 1 && c.strike <= 1) {
    return {
      type: 'isr-mission',
      label: 'ISR / Surveillance Mission',
      description: `Intelligence, surveillance, and reconnaissance formation with ${c.recon + c.awacs} sensor platform(s) and ${c.tanker} tanker(s). Loiter operation.`,
    };
  }

  // Tanker bridge: 2+ tankers, supporting other assets across distance
  if (c.tanker >= 2 && c.fighter >= 1) {
    return {
      type: 'tanker-bridge',
      label: 'Tanker Bridge',
      description: `Multi-tanker refueling track (${c.tanker} tankers) supporting deployment or long-range strike projection.`,
    };
  }

  // Combat air patrol: multiple fighters, no strike ordnance carriers, minimal support
  if (c.fighter >= 2 && c.bomber === 0 && c.tanker <= 1 && fighterPct >= 0.5) {
    return {
      type: 'combat-air-patrol',
      label: 'Combat Air Patrol (CAP)',
      description: `Defensive fighter formation: ${c.fighter} fighters patrolling airspace. Posture consistent with alert readiness.`,
    };
  }

  // Humanitarian / logistics: transport-heavy, no combat aircraft
  if (transportPct >= 0.6 && c.strike === 0) {
    return {
      type: 'humanitarian',
      label: 'Logistics / Humanitarian',
      description: `Transport-dominant cluster (${c.transport} lift aircraft). Airlift mission profile — resupply, evacuation, or humanitarian operation.`,
    };
  }

  // Training: fighter-heavy but no combat support, near home base
  if (c.fighter >= 3 && c.tanker === 0 && c.awacs === 0) {
    return {
      type: 'training',
      label: 'Training Formation',
      description: `${c.fighter} fighters operating without combat support assets. Consistent with training exercise or workup.`,
    };
  }

  return {
    type: 'unclassified',
    label: 'Mixed Formation',
    description: `${n} military aircraft in proximity. Mission profile unclear — continue monitoring.`,
  };
}

function computeThreatScore(
  pkg: Omit<StrikePackage, 'threatScore' | 'threatLevel'>,
): number {
  let score = 0;

  // Type-based base score
  const typeBase: Record<StrikePackageType, number> = {
    'offensive-strike': 70,
    'combat-air-patrol': 40,
    'isr-mission': 35,
    'tanker-bridge': 45,
    'humanitarian': 15,
    'training': 20,
    'unclassified': 25,
  };
  score += typeBase[pkg.packageType];

  // Size boost
  if (pkg.aircraftCount >= 10) score += 15;
  else if (pkg.aircraftCount >= 6) score += 10;
  else if (pkg.aircraftCount >= 4) score += 5;

  // Sensitive airspace boost
  if (pkg.inSensitiveAirspace) score += 20;

  // Multi-operator (coalition) boost — signature of real operations
  if (pkg.operators.length >= 2) score += 10;

  // Strike altitude check (30-45k ft is strike/transit altitude band)
  if (pkg.meanAltitudeFt >= 25_000 && pkg.meanAltitudeFt <= 45_000 && pkg.packageType === 'offensive-strike') score += 5;

  // Formation coherence boosts
  const { coherence } = pkg;
  // Tight formation (high heading convergence + speed matching) = coordinated
  if (coherence.headingConvergence >= 0.8 && coherence.speedCoherence >= 0.7) score += 10;
  // Converging on a single point is more threatening than scattered
  if (coherence.isConverging) score += 10;
  // Converging directly toward sensitive airspace = major threat signal
  if (coherence.isConverging && coherence.convergenceToSensitiveKm !== undefined) score += 10;

  return Math.min(100, Math.max(0, Math.round(score)));
}

function threatLevelFromScore(score: number): PackageThreatLevel {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 40) return 'elevated';
  return 'routine';
}

// ── Main Detection ────────────────────────────────────────────────────────────

let cachedPackages: StrikePackage[] = [];
let cacheTs = 0;
const CACHE_TTL_MS = 3 * 60 * 1000;

/**
 * Detect strike packages from current military flight data.
 * Returns classified packages sorted by threat score desc, capped at 30.
 */
export function detectStrikePackages(flights: MilitaryFlight[]): StrikePackage[] {
  const now = Date.now();
  const clusters = clusterFlights(flights);
  const packages: StrikePackage[] = [];

  for (const cluster of clusters) {
    const roles = roleBreakdown(cluster);
    const { type, label, description } = classifyPackage(cluster, roles);

    // Centroid
    const lat = cluster.reduce((s, f) => s + f.lat, 0) / cluster.length;
    const lon = cluster.reduce((s, f) => s + f.lon, 0) / cluster.length;

    // Radius (max distance from centroid)
    let radiusKm = 0;
    for (const f of cluster) {
      const d = haversineKm(lat, lon, f.lat, f.lon);
      if (d > radiusKm) radiusKm = d;
    }

    const meanAltitudeFt = cluster.reduce((s, f) => s + (f.altitude || 0), 0) / cluster.length;
    const meanSpeedKts = cluster.reduce((s, f) => s + (f.speed || 0), 0) / cluster.length;
    const operators = [...new Set(cluster.map(f => f.operator))];
    const { inZone } = isInSensitiveAirspace(lat, lon);
    const coherence = analyzeFormation(cluster);

    const pkgBase: Omit<StrikePackage, 'threatScore' | 'threatLevel'> = {
      id: `sp-${now}-${Math.round(lat * 10)}-${Math.round(lon * 10)}`,
      packageType: type,
      label,
      description,
      roles,
      aircraftCount: cluster.length,
      operators,
      lat,
      lon,
      radiusKm: Math.round(radiusKm),
      meanAltitudeFt: Math.round(meanAltitudeFt),
      meanSpeedKts: Math.round(meanSpeedKts),
      region: classifyRegion(lat, lon),
      inSensitiveAirspace: inZone,
      coherence,
      flightIds: cluster.map(f => f.id),
      detectedAt: now,
    };

    const threatScore = computeThreatScore(pkgBase);
    packages.push({
      ...pkgBase,
      threatScore,
      threatLevel: threatLevelFromScore(threatScore),
    });
  }

  packages.sort((a, b) => b.threatScore - a.threatScore);
  const results = packages.slice(0, 30);
  cachedPackages = results;
  cacheTs = now;
  return results;
}

/**
 * Return cached strike packages if within the TTL; empty array otherwise.
 */
export function getActiveStrikePackages(): StrikePackage[] {
  if (Date.now() - cacheTs > CACHE_TTL_MS) return [];
  return cachedPackages;
}

/**
 * Summary statistics for the current strike packages, suitable for
 * dashboard consumption.
 */
export interface StrikePackageSummary {
  total: number;
  critical: number;
  high: number;
  inSensitiveAirspace: number;
  byType: Record<StrikePackageType, number>;
  topThreat: StrikePackage | null;
}

export function summarizeStrikePackages(packages: StrikePackage[]): StrikePackageSummary {
  const byType: Record<StrikePackageType, number> = {
    'offensive-strike': 0,
    'combat-air-patrol': 0,
    'isr-mission': 0,
    'tanker-bridge': 0,
    'humanitarian': 0,
    'training': 0,
    'unclassified': 0,
  };
  let critical = 0;
  let high = 0;
  let inSensitiveAirspace = 0;

  for (const p of packages) {
    byType[p.packageType]++;
    if (p.threatLevel === 'critical') critical++;
    if (p.threatLevel === 'high') high++;
    if (p.inSensitiveAirspace) inSensitiveAirspace++;
  }

  return {
    total: packages.length,
    critical,
    high,
    inSensitiveAirspace,
    byType,
    topThreat: packages[0] ?? null,
  };
}
