/**
 * Maritime-Air Convergence Detection
 *
 * Cross-correlates naval dark vessel events with military airlift/fighter
 * surges in the same theater. A dark vessel in the Strait of Hormuz
 * concurrent with an airlift surge in the Middle East theater is a much
 * stronger signal than either alone.
 */

import { detectDarkVessels, type DarkVesselAlert } from './dark-vessel';
import { getActiveSurges, type SurgeAlert } from './military-surge';

// ── Types ────────────────────────────────────────────────────────────────────

export interface MaritimeAirConvergence {
  id: string;
  darkVessels: { mmsi: string; vesselName: string; riskZone: string; darkHours: number }[];
  surge: { theaterId: string; theaterName: string; surgeType: string; surgeMultiple: number };
  convergenceScore: number;
  description: string;
  detectedAt: number;
}

// ── Zone-to-Theater mapping ──────────────────────────────────────────────────

const ZONE_THEATER_MAP: Record<string, string[]> = {
  'Strait of Hormuz':  ['middle-east'],
  'Persian Gulf':      ['middle-east'],
  'Red Sea':           ['middle-east', 'africa-horn'],
  'Bab el-Mandeb':     ['middle-east', 'africa-horn'],
  'Suez Canal':        ['middle-east'],
  'Taiwan Strait':     ['pacific-west'],
  'South China Sea':   ['pacific-west'],
  'Black Sea':         ['europe-east'],
  'Baltic Sea':        ['europe-east', 'europe-west'],
  'Gulf of Guinea':    ['africa-horn'],
  'Somalia Coast':     ['africa-horn'],
  'Malacca Strait':    ['pacific-west'],
};

// ── Detection ────────────────────────────────────────────────────────────────

let cachedConvergences: MaritimeAirConvergence[] = [];
let lastCheck = 0;
const CHECK_COOLDOWN_MS = 5 * 60 * 1000;

function groupDarkByTheater(darkAlerts: DarkVesselAlert[]): Map<string, DarkVesselAlert[]> {
  const darkByTheater = new Map<string, DarkVesselAlert[]>();
  for (const alert of darkAlerts) {
    const theaters = ZONE_THEATER_MAP[alert.riskZone];
    if (!theaters) continue;
    for (const theaterId of theaters) {
      let list = darkByTheater.get(theaterId);
      if (!list) { list = []; darkByTheater.set(theaterId, list); }
      list.push(alert);
    }
  }
  return darkByTheater;
}

function scoreConvergence(darkList: DarkVesselAlert[], surge: SurgeAlert): number {
  const sanctionedCount = darkList.filter(d => d.sanctioned).length;
  let score = 40;
  score += Math.min(20, darkList.length * 5);
  score += Math.min(15, (surge.surgeMultiple - 2) * 5);
  if (sanctionedCount > 0) score += 15;
  if (darkList.some(d => d.wasDecelerating)) score += 5;
  return Math.min(100, score);
}

export function detectMaritimeAirConvergence(): MaritimeAirConvergence[] {
  const now = Date.now();
  if (now - lastCheck < CHECK_COOLDOWN_MS) return cachedConvergences;
  lastCheck = now;

  const darkAlerts = detectDarkVessels();
  const surges = getActiveSurges();
  if (darkAlerts.length === 0 || surges.length === 0) {
    cachedConvergences = [];
    return [];
  }

  const darkByTheater = groupDarkByTheater(darkAlerts);

  const surgeByTheater = new Map<string, SurgeAlert>();
  for (const s of surges) {
    const existing = surgeByTheater.get(s.theater.id);
    if (!existing || s.surgeMultiple > existing.surgeMultiple) {
      surgeByTheater.set(s.theater.id, s);
    }
  }

  const convergences: MaritimeAirConvergence[] = [];
  for (const [theaterId, darkList] of darkByTheater) {
    const surge = surgeByTheater.get(theaterId);
    if (!surge) continue;

    convergences.push({
      id: `mac-${theaterId}-${now}`,
      darkVessels: darkList.map(d => ({
        mmsi: d.mmsi, vesselName: d.vesselName, riskZone: d.riskZone, darkHours: d.darkHours,
      })),
      surge: {
        theaterId: surge.theater.id, theaterName: surge.theater.name,
        surgeType: surge.type, surgeMultiple: surge.surgeMultiple,
      },
      convergenceScore: scoreConvergence(darkList, surge),
      description: `${darkList.length} dark vessel(s) in ${darkList[0]!.riskZone} concurrent with ${surge.type} surge (${surge.surgeMultiple.toFixed(1)}x) in ${surge.theater.name}`,
      detectedAt: now,
    });
  }

  convergences.sort((a, b) => b.convergenceScore - a.convergenceScore);
  cachedConvergences = convergences;
  return convergences;
}

export function getActiveMaritimeAirConvergences(): MaritimeAirConvergence[] {
  return cachedConvergences;
}
