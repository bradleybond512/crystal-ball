/**
 * Maritime threats — war-risk zones + ACLED-filtered maritime incidents.
 *
 * Pure-deterministic. No fetch, no globals.
 *
 * Why static zones: Lloyd's JWLA-027 list is paywalled and BIMCO/Ambrey
 * publications change shape week to week. A small in-repo set of current
 * high-risk areas (with effective-from dates) is honest and reviewable
 * via PR. Update on a quarterly cadence.
 */

/** Light coord shape — avoids depending on chokepoint-monitor's full
 *  config to keep this module independently buildable. */
export interface ChokepointCoord {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

// ── War-risk zones ───────────────────────────────────────────────────────────

export interface WarRiskZone {
  id: string;
  name: string;
  /** Center for radius checks. */
  centerLat: number;
  centerLon: number;
  /** Radius in km — vessels within are flagged. */
  radiusKm: number;
  /** When this designation took effect (ISO date). */
  effectiveFrom: string;
  /** Citation for the designation, in plain English. */
  rationale: string;
  threatCategory: 'piracy' | 'state_conflict' | 'missile_drone' | 'mixed';
}

/**
 * Current published high-risk areas as of 2026-04-01. Update quarterly
 * via PR. Sources: open-press maritime advisories from UKMTO, MSCHOA,
 * and recent flag-state notices.
 */
export const WAR_RISK_ZONES: readonly WarRiskZone[] = [
  {
    id: 'red-sea-houthi',
    name: 'Red Sea / Bab-el-Mandeb (Houthi missile + USV)',
    centerLat: 14.5,
    centerLon: 42.5,
    radiusKm: 600,
    effectiveFrom: '2024-01-01',
    rationale:
      'Active Houthi anti-ship missile and USV attacks against commercial shipping. UKMTO advisories ongoing.',
    threatCategory: 'missile_drone',
  },
  {
    id: 'black-sea',
    name: 'Black Sea (Russia–Ukraine war)',
    centerLat: 44,
    centerLon: 33,
    radiusKm: 700,
    effectiveFrom: '2022-02-24',
    rationale:
      'Ongoing Russian Navy ops, sea mines, and missile strikes. Insurance markets price war risk.',
    threatCategory: 'state_conflict',
  },
  {
    id: 'persian-gulf-strait-of-hormuz',
    name: 'Persian Gulf approaches / Strait of Hormuz',
    centerLat: 26.5,
    centerLon: 56.3,
    radiusKm: 350,
    effectiveFrom: '2019-06-01',
    rationale:
      'IRGC small-boat seizures and limpet-mine incidents. Periodic escalation tied to Iran tensions.',
    threatCategory: 'state_conflict',
  },
  {
    id: 'gulf-of-guinea',
    name: 'Gulf of Guinea (piracy)',
    centerLat: 3,
    centerLon: 4,
    radiusKm: 800,
    effectiveFrom: '2020-01-01',
    rationale:
      'IMB-listed piracy hot spot. Crew kidnap attacks remain the dominant pattern despite recent declines.',
    threatCategory: 'piracy',
  },
  {
    id: 'somalia-coast',
    name: 'Somalia coast / western Indian Ocean',
    centerLat: 5,
    centerLon: 50,
    radiusKm: 600,
    effectiveFrom: '2008-01-01',
    rationale:
      'Resurgent Somali piracy 2024–2026 after a multi-year lull. Operates further offshore than 2010-era attacks.',
    threatCategory: 'piracy',
  },
];

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Returns every war-risk zone that contains (lat, lon). Empty if none. */
export function zonesContainingPosition(
  lat: number,
  lon: number,
  zones: readonly WarRiskZone[] = WAR_RISK_ZONES,
): WarRiskZone[] {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const matches: WarRiskZone[] = [];
  for (const z of zones) {
    if (haversineKm(lat, lon, z.centerLat, z.centerLon) <= z.radiusKm) {
      matches.push(z);
    }
  }
  return matches;
}

// ── ACLED maritime-incident filter ───────────────────────────────────────────

/**
 * Lightweight ACLED row shape — matches /api/acled-events response.
 * We don't import ACLED's official types because the sidecar already
 * narrows the columns we receive.
 */
export interface AcledEventRow {
  event_id_cnty: string;
  event_date: string;
  event_type: string;
  sub_event_type: string;
  actor1: string;
  actor2?: string;
  country: string;
  location: string;
  latitude: number | string;
  longitude: number | string;
  fatalities: number | string;
  notes: string;
}

export interface MaritimeIncident {
  id: string;
  date: string;
  eventType: string;
  subEventType: string;
  actor: string;
  country: string;
  location: string;
  lat: number;
  lon: number;
  fatalities: number;
  notes: string;
  /** Closest chokepoint name (if within radiusKm), else null. */
  nearestChokepoint: string | null;
  nearestChokepointKm: number | null;
  /** War-risk zones that contain this position (may be empty). */
  warRiskZones: string[];
}

export interface MaritimeFilterOptions {
  /** Reject events farther than this many km from every chokepoint. */
  chokepointRadiusKm?: number;
  /**
   * Optional override of chokepoint set — defaults to the
   * chokepoint-monitor list when not provided.
   */
  chokepoints?: readonly ChokepointCoord[];
  warRiskZones?: readonly WarRiskZone[];
}

export const DEFAULT_CHOKEPOINT_RADIUS_KM = 300;

/**
 * Default chokepoint set — kept inline so this module doesn't depend
 * on the chokepoint-monitor module's runtime initialization. Matches
 * the 6 chokepoints in MaritimeIntelPanel (PR D).
 */
const DEFAULT_CHOKEPOINTS: readonly ChokepointCoord[] = [
  { id: 'hormuz', name: 'Strait of Hormuz', lat: 26.6, lon: 56.5 },
  { id: 'suez', name: 'Suez Canal', lat: 30.5, lon: 32.3 },
  { id: 'malacca', name: 'Strait of Malacca', lat: 1.5, lon: 104 },
  { id: 'panama', name: 'Panama Canal', lat: 9.1, lon: -79.7 },
  { id: 'bosphorus', name: 'Bosphorus Strait', lat: 41.1, lon: 29 },
  { id: 'bab-el-mandeb', name: 'Bab-el-Mandeb', lat: 12.6, lon: 43.4 },
];

function toFiniteNumber(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? (n as number) : null;
}

function findNearestChokepoint(
  lat: number,
  lon: number,
  chokepoints: readonly ChokepointCoord[],
): { name: string; distanceKm: number } | null {
  let nearest: { name: string; distanceKm: number } | null = null;
  for (const cp of chokepoints) {
    const d = haversineKm(lat, lon, cp.lat, cp.lon);
    if (!nearest || d < nearest.distanceKm) {
      nearest = { name: cp.name, distanceKm: d };
    }
  }
  return nearest;
}

function compareDateDesc(a: MaritimeIncident, b: MaritimeIncident): number {
  if (a.date < b.date) return 1;
  if (a.date > b.date) return -1;
  return 0;
}

function buildIncident(
  r: AcledEventRow,
  lat: number,
  lon: number,
  nearestName: string | null,
  nearestKm: number | null,
  matchedZones: string[],
  inChokepointRange: boolean,
): MaritimeIncident {
  return {
    id: r.event_id_cnty,
    date: r.event_date,
    eventType: r.event_type,
    subEventType: r.sub_event_type,
    actor: r.actor1,
    country: r.country,
    location: r.location,
    lat,
    lon,
    fatalities: toFiniteNumber(r.fatalities) ?? 0,
    notes: r.notes,
    nearestChokepoint: inChokepointRange ? nearestName : null,
    nearestChokepointKm: inChokepointRange && nearestKm !== null ? Math.round(nearestKm) : null,
    warRiskZones: matchedZones,
  };
}

/** Pure filter: keep ACLED rows that lie within radius of any chokepoint
 *  OR within any war-risk zone. Returns the enriched MaritimeIncident set
 *  sorted newest-first. */
export function filterAcledMaritimeIncidents(
  rows: readonly AcledEventRow[],
  options: MaritimeFilterOptions = {},
): MaritimeIncident[] {
  const radius = options.chokepointRadiusKm ?? DEFAULT_CHOKEPOINT_RADIUS_KM;
  const chokepoints = options.chokepoints ?? DEFAULT_CHOKEPOINTS;
  const zones = options.warRiskZones ?? WAR_RISK_ZONES;
  const out: MaritimeIncident[] = [];

  for (const r of rows) {
    const lat = toFiniteNumber(r.latitude);
    const lon = toFiniteNumber(r.longitude);
    if (lat === null || lon === null) continue;

    const nearest = findNearestChokepoint(lat, lon, chokepoints);
    const matchedZones = zonesContainingPosition(lat, lon, zones).map((z) => z.name);
    const inChokepointRange = nearest !== null && nearest.distanceKm <= radius;
    if (!inChokepointRange && matchedZones.length === 0) continue;

    out.push(buildIncident(
      r, lat, lon,
      nearest?.name ?? null,
      nearest?.distanceKm ?? null,
      matchedZones,
      inChokepointRange,
    ));
  }

  out.sort(compareDateDesc);
  return out;
}
