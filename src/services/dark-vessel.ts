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
): void {
  vessels.set(mmsi, { mmsi, name, flag, lat, lon, lastSeen: timestamp, sanctioned, sanctionSource });
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
