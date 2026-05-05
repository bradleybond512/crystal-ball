/**
 * Dark Vessel Detection Service
 *
 * Detects vessels that disable AIS transponders in high-risk areas —
 * a key indicator of sanctions evasion, smuggling, or military operations.
 *
 * Monitors vessel positions and flags "going dark" events when:
 * 1. A vessel's AIS signal disappears for > threshold (default 6h)
 * 2. The last-known position is in a high-risk zone
 * 3. Optional: cross-reference against OFAC/OpenSanctions lists
 *
 * Inspired by Palantir Gotham maritime intelligence and Windward's
 * dark activity detection.
 */

export interface TrackedVessel {
  mmsi: string;
  name: string;
  flag: string;
  lat: number;
  lon: number;
  lastSeen: number;
  /** True if this vessel appears on sanctions lists */
  sanctioned: boolean;
  sanctionSource?: string;
  /** Speed in knots at last known position */
  speed?: number;
  /** Heading in degrees at last known position */
  heading?: number;
  /** Speed history (last 3 reports) for deceleration detection */
  speedHistory: number[];
  /** Was vessel decelerating before going dark? */
  decelerating: boolean;
  /** Was vessel heading toward a risk zone before going dark? */
  headingTowardRiskZone: boolean;
}

export interface PredictedRoute {
  predictedLat: number;
  predictedLon: number;
  predictedRiskZone: string | null;
  hoursToZone: number | null;
  confidenceNote: string;
}

export interface DarkVesselAlert {
  id: string;
  mmsi: string;
  vesselName: string;
  flag: string;
  lastLat: number;
  lastLon: number;
  lastSeen: number;
  /** Hours since last AIS transmission */
  darkHours: number;
  /** Which high-risk zone the vessel went dark in */
  riskZone: string;
  /** Whether this vessel is sanctioned */
  sanctioned: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  detectedAt: number;
  /** Last known speed (knots) */
  lastSpeed?: number;
  /** Last known heading (degrees) */
  lastHeading?: number;
  /** Was decelerating before going dark */
  wasDecelerating: boolean;
  /** Was heading toward a risk zone before going dark */
  wasHeadingTowardRiskZone: boolean;
  predictedRoute?: PredictedRoute;
}

// ── High-Risk Zones ──────────────────────────────────────────────────────────

interface RiskZone {
  name: string;
  lat: number;
  lon: number;
  radiusKm: number;
}

const RISK_ZONES: RiskZone[] = [
  { name: 'Strait of Hormuz', lat: 26.5, lon: 56.3, radiusKm: 200 },
  { name: 'Bab el-Mandeb', lat: 12.5, lon: 43.5, radiusKm: 150 },
  { name: 'Red Sea', lat: 20, lon: 38, radiusKm: 400 },
  { name: 'Suez Canal', lat: 30.5, lon: 32.3, radiusKm: 100 },
  { name: 'Malacca Strait', lat: 2, lon: 102, radiusKm: 200 },
  { name: 'Taiwan Strait', lat: 24.5, lon: 119, radiusKm: 200 },
  { name: 'South China Sea', lat: 12, lon: 115, radiusKm: 500 },
  { name: 'Black Sea', lat: 43, lon: 34, radiusKm: 400 },
  { name: 'Baltic Sea', lat: 57, lon: 20, radiusKm: 300 },
  { name: 'Persian Gulf', lat: 27, lon: 51, radiusKm: 300 },
  { name: 'Gulf of Guinea', lat: 3, lon: 3, radiusKm: 400 },
  { name: 'Somalia Coast', lat: 5, lon: 47, radiusKm: 300 },
  { name: 'Panama Canal', lat: 9.1, lon: -79.7, radiusKm: 150 },
  { name: 'Bosphorus Strait', lat: 41.1, lon: 29.0, radiusKm: 100 },
];

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
 Math.sin(dLat / 2) ** 2 +
 Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
 Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findRiskZone(lat: number, lon: number): string | null {
  for (const zone of RISK_ZONES) {
 if (haversineKm(lat, lon, zone.lat, zone.lon) <= zone.radiusKm) {
 return zone.name;
 }
  }
  return null;
}

// ── Behavior Analysis ────────────────────────────────────────────────────────

const DEG2RAD = Math.PI / 180;
const MAX_SPEED_HISTORY = 3;

/** Check if vessel is heading toward any risk zone (within 30deg of bearing to zone). */
function isHeadingTowardRiskZone(lat: number, lon: number, heading: number): boolean {
  for (const zone of RISK_ZONES) {
    const dLon = (zone.lon - lon) * DEG2RAD;
    const lat1 = lat * DEG2RAD;
    const lat2 = zone.lat * DEG2RAD;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    const bearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    const diff = Math.abs(heading - bearing);
    const angularDiff = diff > 180 ? 360 - diff : diff;
    if (angularDiff <= 30) return true;
  }
  return false;
}

/** Check if speed history shows deceleration (each report slower than previous). */
function isDecelerating(speedHistory: number[]): boolean {
  if (speedHistory.length < 2) return false;
  for (let i = 1; i < speedHistory.length; i++) {
    if (speedHistory[i]! >= speedHistory[i - 1]!) return false;
  }
  // Require meaningful deceleration (at least 20% drop from first to last)
  return speedHistory[speedHistory.length - 1]! < speedHistory[0]! * 0.8;
}

// ── Route Prediction ────────────────────────────────────────────────────────

function projectPosition(
  lat: number, lon: number, headingDeg: number, speedKnots: number, hoursAhead: number,
): { lat: number; lon: number } {
  const headingRad = headingDeg * DEG2RAD;
  const distKm = speedKnots * hoursAhead * 1.852;
  const newLat = lat + (distKm / 111.32) * Math.cos(headingRad);
  const newLon = lon + (distKm / (111.32 * Math.cos(lat * DEG2RAD))) * Math.sin(headingRad);
  return { lat: newLat, lon: newLon };
}

export function predictDarkVesselRoute(vessel: TrackedVessel): PredictedRoute | undefined {
  if (!vessel.speed || vessel.speed <= 0 || vessel.heading === undefined) return undefined;

  const projectionHours = [6, 12, 24];
  for (const h of projectionHours) {
    const pos = projectPosition(vessel.lat, vessel.lon, vessel.heading, vessel.speed, h);
    const zone = findRiskZone(pos.lat, pos.lon);
    if (zone) {
      return {
        predictedLat: pos.lat,
        predictedLon: pos.lon,
        predictedRiskZone: zone,
        hoursToZone: h,
        confidenceNote: `Equirectangular projection at ${vessel.speed}kn, heading ${vessel.heading}°, ${h}h ahead`,
      };
    }
  }

  const fallback = projectPosition(vessel.lat, vessel.lon, vessel.heading, vessel.speed, 12);
  return {
    predictedLat: fallback.lat,
    predictedLon: fallback.lon,
    predictedRiskZone: null,
    hoursToZone: null,
    confidenceNote: `No risk zone intercept within 24h at ${vessel.speed}kn, heading ${vessel.heading}°`,
  };
}

// ── State ────────────────────────────────────────────────────────────────────

const vessels = new Map<string, TrackedVessel>();
const DARK_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6 hours
let idCounter = 0;

// ── Ingest ───────────────────────────────────────────────────────────────────

export function updateVesselPosition(
  mmsi: string,
  name: string,
  flag: string,
  lat: number,
  lon: number,
  timestamp = Date.now(),
  sanctioned = false,
  sanctionSource?: string,
  speed?: number,
  heading?: number,
): void {
  const existing = vessels.get(mmsi);
  const speedHistory = existing?.speedHistory ?? [];
  if (speed !== undefined) {
    speedHistory.push(speed);
    if (speedHistory.length > MAX_SPEED_HISTORY) speedHistory.shift();
  }

  const headingToward = heading !== undefined ? isHeadingTowardRiskZone(lat, lon, heading) : false;

  vessels.set(mmsi, {
    mmsi, name, flag, lat, lon, lastSeen: timestamp,
    sanctioned, sanctionSource,
    speed, heading,
    speedHistory,
    decelerating: isDecelerating(speedHistory),
    headingTowardRiskZone: headingToward,
  });
}

export function markVesselSanctioned(mmsi: string, source: string): void {
  const v = vessels.get(mmsi);
  if (v) {
 v.sanctioned = true;
 v.sanctionSource = source;
  }
}

// ── Detection ────────────────────────────────────────────────────────────────

export function detectDarkVessels(): DarkVesselAlert[] {
  const now = Date.now();
  const alerts: DarkVesselAlert[] = [];

  for (const v of vessels.values()) {
 const silentMs = now - v.lastSeen;
 if (silentMs < DARK_THRESHOLD_MS) continue;

 const riskZone = findRiskZone(v.lat, v.lon);
 if (!riskZone) continue; // Only alert if in a high-risk zone

 const darkHours = Math.round(silentMs / (60 * 60 * 1000));

 // Severity: sanctioned + long dark = critical
 let severity: DarkVesselAlert['severity'] = 'low';
 if (v.sanctioned && darkHours >= 24) severity = 'critical';
 else if (v.sanctioned || darkHours >= 48) severity = 'high';
 else if (darkHours >= 12) severity = 'medium';

 // Behavior boost: deceleration or heading toward risk zone before going dark
 if (severity !== 'critical' && (v.decelerating || v.headingTowardRiskZone)) {
 const sevOrder: DarkVesselAlert['severity'][] = ['low', 'medium', 'high', 'critical'];
 const idx = sevOrder.indexOf(severity);
 severity = sevOrder[Math.min(idx + 1, sevOrder.length - 1)]!;
 }

 alerts.push({
 id: `dark-${++idCounter}`,
 mmsi: v.mmsi,
 vesselName: v.name,
 flag: v.flag,
 lastLat: v.lat,
 lastLon: v.lon,
 lastSeen: v.lastSeen,
 darkHours,
 riskZone,
 sanctioned: v.sanctioned,
 severity,
 detectedAt: now,
 lastSpeed: v.speed,
 lastHeading: v.heading,
 wasDecelerating: v.decelerating,
 wasHeadingTowardRiskZone: v.headingTowardRiskZone,
 predictedRoute: predictDarkVesselRoute(v),
 });
  }

  alerts.sort((a, b) => {
 const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
 return sevOrder[a.severity] - sevOrder[b.severity] || b.darkHours - a.darkHours;
  });

  return alerts;
}

/** Get all currently tracked vessels */
export function getTrackedVessels(): TrackedVessel[] {
  return [...vessels.values()];
}

/** Get number of vessels currently dark */
export function getDarkVesselCount(): number {
  const now = Date.now();
  let count = 0;
  for (const v of vessels.values()) {
 if (now - v.lastSeen >= DARK_THRESHOLD_MS && findRiskZone(v.lat, v.lon)) {
 count++;
 }
  }
  return count;
}

// ── Snapshot-based gap detection (pure-deterministic) ────────────────────────

/**
 * Lightweight observation shape — typically derived from /api/ais-snapshot
 * candidate reports. Caller passes accumulated observations across recent
 * polls; the detector finds vessels whose latest observation is older than
 * the gap threshold AND was within range of a chokepoint / risk zone.
 */
export interface VesselSnapshotObservation {
  mmsi: string;
  lat: number;
  lon: number;
  observedAt: number;
  name?: string;
  shipType?: number;
}

export interface DarkVesselGapEvent {
  mmsi: string;
  vesselName?: string;
  lastKnownLat: number;
  lastKnownLon: number;
  lastSeenAt: number;
  gapDurationHours: number;
  nearestChokepoint: string | null;
  nearestChokepointKm: number | null;
  riskScore: number;
}

export interface GapDetectorOptions {
  thresholdHours?: number;
  /** Defaults to Date.now() */
  now?: number;
  /** Only emit events for vessels whose last position is within this many km
   * of a chokepoint / risk zone. Default 200 km. */
  riskZoneRadiusKm?: number;
}

export const DEFAULT_GAP_THRESHOLD_HOURS = 6;

/** Find the closest risk zone to a position. Returns null if none defined. */
function nearestRiskZone(lat: number, lon: number): { name: string; distanceKm: number } | null {
  let best: { name: string; distanceKm: number } | null = null;
  for (const zone of RISK_ZONES) {
    const d = haversineKm(lat, lon, zone.lat, zone.lon);
    if (!best || d < best.distanceKm) {
      best = { name: zone.name, distanceKm: d };
    }
  }
  return best;
}

/**
 * Score gap risk 0..100. Longer gap + closer to chokepoint = higher risk.
 * Sanctions / military dimensions are tracked separately by the stateful
 * `detectDarkVessels` path; this function focuses on pure spatiotemporal
 * gap evidence.
 */
export function computeGapRiskScore(gapHours: number, distanceKm: number): number {
  let score = 0;
  if (gapHours >= 48) score += 50;
  else if (gapHours >= 24) score += 35;
  else if (gapHours >= 12) score += 20;
  else if (gapHours >= 6) score += 10;

  if (distanceKm <= 50) score += 50;
  else if (distanceKm <= 100) score += 35;
  else if (distanceKm <= 150) score += 20;
  else if (distanceKm <= 200) score += 10;

  return Math.min(100, score);
}

/**
 * Pure detector. Given a flat list of vessel observations from the recent
 * past (callers typically accumulate from poll-to-poll), return the gap
 * events for vessels that haven't been seen for >= thresholdHours AND
 * whose last known position was within riskZoneRadiusKm of a chokepoint.
 *
 * No state, no side effects.
 */
export function detectAisGapEvents(
  observations: readonly VesselSnapshotObservation[],
  options: GapDetectorOptions = {},
): DarkVesselGapEvent[] {
  const now = options.now ?? Date.now();
  const thresholdHours = options.thresholdHours ?? DEFAULT_GAP_THRESHOLD_HOURS;
  const radiusKm = options.riskZoneRadiusKm ?? 200;
  const thresholdMs = thresholdHours * 60 * 60 * 1000;

  // Group by mmsi, find latest observation per vessel
  const latest = new Map<string, VesselSnapshotObservation>();
  for (const obs of observations) {
    if (!Number.isFinite(obs.lat) || !Number.isFinite(obs.lon)) continue;
    if (!Number.isFinite(obs.observedAt)) continue;
    const cur = latest.get(obs.mmsi);
    if (!cur || obs.observedAt > cur.observedAt) {
      latest.set(obs.mmsi, obs);
    }
  }

  const events: DarkVesselGapEvent[] = [];
  for (const obs of latest.values()) {
    const gapMs = now - obs.observedAt;
    if (gapMs < thresholdMs) continue;

    const nearest = nearestRiskZone(obs.lat, obs.lon);
    if (!nearest || nearest.distanceKm > radiusKm) continue;

    const gapHours = gapMs / (60 * 60 * 1000);
    events.push({
      mmsi: obs.mmsi,
      vesselName: obs.name,
      lastKnownLat: obs.lat,
      lastKnownLon: obs.lon,
      lastSeenAt: obs.observedAt,
      gapDurationHours: Math.round(gapHours * 10) / 10,
      nearestChokepoint: nearest.name,
      nearestChokepointKm: Math.round(nearest.distanceKm),
      riskScore: computeGapRiskScore(gapHours, nearest.distanceKm),
    });
  }

  events.sort((a, b) => b.riskScore - a.riskScore || b.gapDurationHours - a.gapDurationHours);
  return events;
}
