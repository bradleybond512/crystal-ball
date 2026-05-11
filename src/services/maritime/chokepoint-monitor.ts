/**
 * Maritime Chokepoint Monitor (pure-deterministic).
 *
 * Six globally critical maritime chokepoints. For each, score closure-risk
 * 0-100 from incident density (GDACS / ACLED / AIS disruptions) within 100km,
 * vessel transit count within 50km, and military vessel density within 75km.
 *
 * Inputs are caller-provided typed bags. No DOM, no fetch, no globals.
 */

export type ChokepointId =
  | 'hormuz'
  | 'suez'
  | 'malacca'
  | 'panama'
  | 'bosphorus'
  | 'bab-el-mandeb';

export type ThreatLevel = 'green' | 'yellow' | 'orange' | 'red';

export type IncidentSource = 'gdacs' | 'acled' | 'ais_disruption';
export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface ChokepointConfig {
  id: ChokepointId;
  name: string;
  lat: number;
  lon: number;
  primaryCommodities: string[];
  globalTradePctNote: string;
  vesselSearchRadiusKm: number;
  incidentSearchRadiusKm: number;
  militarySearchRadiusKm: number;
}

export interface ChokepointVesselReport {
  mmsi: string;
  lat: number;
  lon: number;
  observedAt: number;
  isMilitary?: boolean;
}

export interface ChokepointIncident {
  id: string;
  source: IncidentSource;
  lat: number;
  lon: number;
  occurredAt: number;
  severity: IncidentSeverity;
  description?: string;
}

export interface MonitorInput {
  /** Reports from any time window — pruning is the caller's job, but this
   * module honors the 24h / 7d cutoffs internally. */
  vessels: ChokepointVesselReport[];
  incidents: ChokepointIncident[];
  /** Now-ish, ms since epoch. Defaults to Date.now() at call time. */
  now?: number;
}

export interface ChokepointStatus {
  id: ChokepointId;
  name: string;
  lat: number;
  lon: number;
  vesselCount24h: number;
  militaryVesselCount: number;
  incidentCount7d: number;
  closureRisk: number;
  primaryCommodities: string[];
  globalTradePctNote: string;
  lastIncident: ChokepointIncident | null;
  threatLevel: ThreatLevel;
  drivers: string[];
}

// ── Static config ───────────────────────────────────────────────────────────

export const CHOKEPOINTS: Record<ChokepointId, ChokepointConfig> = {
  hormuz: {
    id: 'hormuz',
    name: 'Strait of Hormuz',
    lat: 26.6,
    lon: 56.5,
    primaryCommodities: ['crude_oil', 'lng', 'refined_products'],
    globalTradePctNote: '~21% of global petroleum',
    vesselSearchRadiusKm: 50,
    incidentSearchRadiusKm: 100,
    militarySearchRadiusKm: 75,
  },
  suez: {
    id: 'suez',
    name: 'Suez Canal',
    lat: 30.5,
    lon: 32.3,
    primaryCommodities: ['crude_oil', 'refined_products', 'containerized_goods', 'grain'],
    globalTradePctNote: '~12% of global trade',
    vesselSearchRadiusKm: 50,
    incidentSearchRadiusKm: 100,
    militarySearchRadiusKm: 75,
  },
  malacca: {
    id: 'malacca',
    name: 'Strait of Malacca',
    lat: 1.5,
    lon: 104,
    primaryCommodities: ['crude_oil', 'lng', 'electronics', 'containerized_goods'],
    globalTradePctNote: '~25% of global trade',
    vesselSearchRadiusKm: 50,
    incidentSearchRadiusKm: 100,
    militarySearchRadiusKm: 75,
  },
  panama: {
    id: 'panama',
    name: 'Panama Canal',
    lat: 9.1,
    lon: -79.7,
    primaryCommodities: ['containerized_goods', 'grain', 'lng'],
    globalTradePctNote: '~5% of global trade',
    vesselSearchRadiusKm: 50,
    incidentSearchRadiusKm: 100,
    militarySearchRadiusKm: 75,
  },
  bosphorus: {
    id: 'bosphorus',
    name: 'Bosphorus Strait',
    lat: 41.1,
    lon: 29,
    primaryCommodities: ['crude_oil', 'grain', 'fertilizer'],
    globalTradePctNote: 'critical for Russian Black Sea exports',
    vesselSearchRadiusKm: 50,
    incidentSearchRadiusKm: 100,
    militarySearchRadiusKm: 75,
  },
  'bab-el-mandeb': {
    id: 'bab-el-mandeb',
    name: 'Bab-el-Mandeb',
    lat: 12.6,
    lon: 43.4,
    primaryCommodities: ['crude_oil', 'lng', 'containerized_goods'],
    globalTradePctNote: '~10% of global trade (Yemen / Houthi threat zone)',
    vesselSearchRadiusKm: 50,
    incidentSearchRadiusKm: 100,
    militarySearchRadiusKm: 75,
  },
};

export const CHOKEPOINT_IDS: ChokepointId[] = [
  'hormuz', 'suez', 'malacca', 'panama', 'bosphorus', 'bab-el-mandeb',
];

// ── Geo helper ───────────────────────────────────────────────────────────────

const EARTH_KM = 6371;
const DEG2RAD = Math.PI / 180;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLon / 2) ** 2;
  return EARTH_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Scoring ──────────────────────────────────────────────────────────────────

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

const SEVERITY_WEIGHT: Record<IncidentSeverity, number> = {
  low: 4,
  medium: 9,
  high: 16,
  critical: 25,
};

const SOURCE_WEIGHT: Record<IncidentSource, number> = {
  gdacs: 1,
  acled: 1.1,
  ais_disruption: 0.85,
};

function thresholdLevel(score: number): ThreatLevel {
  if (score >= 71) return 'red';
  if (score >= 41) return 'orange';
  if (score >= 16) return 'yellow';
  return 'green';
}

interface ScoredIncident {
  incident: ChokepointIncident;
  weighted: number;
}

function scoreIncidents(
  incidents: ChokepointIncident[],
  cfg: ChokepointConfig,
  now: number,
): { count: number; weighted: number; last: ChokepointIncident | null } {
  let weighted = 0;
  let count = 0;
  let last: ChokepointIncident | null = null;
  const cutoff = now - WEEK_MS;
  for (const inc of incidents) {
    if (inc.occurredAt < cutoff || inc.occurredAt > now) continue;
    if (haversineKm(inc.lat, inc.lon, cfg.lat, cfg.lon) > cfg.incidentSearchRadiusKm) continue;
    count += 1;
    const ageDays = Math.max(0, (now - inc.occurredAt) / DAY_MS);
    const recency = Math.max(0.25, 1 - ageDays / 7);
    weighted += SEVERITY_WEIGHT[inc.severity] * SOURCE_WEIGHT[inc.source] * recency;
    if (!last || inc.occurredAt > last.occurredAt) last = inc;
  }
  return { count, weighted, last };
}

function countVessels(
  vessels: ChokepointVesselReport[],
  cfg: ChokepointConfig,
  now: number,
): { transit24h: number; military: number } {
  const cutoff = now - DAY_MS;
  let transit = 0;
  let military = 0;
  const seen = new Set<string>();
  for (const v of vessels) {
    if (v.observedAt < cutoff || v.observedAt > now) continue;
    const distKm = haversineKm(v.lat, v.lon, cfg.lat, cfg.lon);
    if (distKm <= cfg.vesselSearchRadiusKm && !seen.has(v.mmsi)) {
      transit += 1;
      seen.add(v.mmsi);
    }
    if (v.isMilitary && distKm <= cfg.militarySearchRadiusKm) {
      military += 1;
    }
  }
  return { transit24h: transit, military };
}

function militaryDensityContribution(militaryCount: number): number {
  if (militaryCount <= 0) return 0;
  if (militaryCount === 1) return 5;
  if (militaryCount <= 3) return 10;
  if (militaryCount <= 6) return 18;
  return 25;
}

function buildDrivers(
  cfg: ChokepointConfig,
  incidents: ScoredIncident[],
  militaryCount: number,
  weightedIncidents: number,
): string[] {
  const drivers: string[] = [];
  if (weightedIncidents >= 25) {
    drivers.push(`${incidents.length} incidents within ${cfg.incidentSearchRadiusKm}km in last 7d`);
  } else if (incidents.length > 0) {
    drivers.push(`${incidents.length} low-severity incident(s) within ${cfg.incidentSearchRadiusKm}km in last 7d`);
  }
  if (militaryCount > 0) {
    drivers.push(`${militaryCount} military vessel(s) within ${cfg.militarySearchRadiusKm}km`);
  }
  const bySeverity: Record<IncidentSeverity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const { incident } of incidents) bySeverity[incident.severity] += 1;
  if (bySeverity.critical > 0) drivers.push(`${bySeverity.critical} CRITICAL incident(s)`);
  if (bySeverity.high > 0) drivers.push(`${bySeverity.high} high-severity incident(s)`);
  return drivers;
}

export function monitorSingleChokepoint(id: ChokepointId, input: MonitorInput): ChokepointStatus {
  const cfg = CHOKEPOINTS[id];
  const now = input.now ?? Date.now();

  const inWindow: ScoredIncident[] = [];
  const cutoff = now - WEEK_MS;
  for (const inc of input.incidents) {
    if (inc.occurredAt < cutoff || inc.occurredAt > now) continue;
    if (haversineKm(inc.lat, inc.lon, cfg.lat, cfg.lon) > cfg.incidentSearchRadiusKm) continue;
    const ageDays = Math.max(0, (now - inc.occurredAt) / DAY_MS);
    const recency = Math.max(0.25, 1 - ageDays / 7);
    const weighted = SEVERITY_WEIGHT[inc.severity] * SOURCE_WEIGHT[inc.source] * recency;
    inWindow.push({ incident: inc, weighted });
  }

  const incidentSummary = scoreIncidents(input.incidents, cfg, now);
  const vesselSummary = countVessels(input.vessels, cfg, now);

  const incidentScore = Math.min(75, incidentSummary.weighted);
  const militaryScore = militaryDensityContribution(vesselSummary.military);
  const closureRiskRaw = incidentScore + militaryScore;
  const closureRisk = Math.max(0, Math.min(100, Math.round(closureRiskRaw)));

  const threatLevel = thresholdLevel(closureRisk);
  const drivers = buildDrivers(cfg, inWindow, vesselSummary.military, incidentSummary.weighted);

  return {
    id: cfg.id,
    name: cfg.name,
    lat: cfg.lat,
    lon: cfg.lon,
    vesselCount24h: vesselSummary.transit24h,
    militaryVesselCount: vesselSummary.military,
    incidentCount7d: incidentSummary.count,
    closureRisk,
    primaryCommodities: [...cfg.primaryCommodities],
    globalTradePctNote: cfg.globalTradePctNote,
    lastIncident: incidentSummary.last,
    threatLevel,
    drivers,
  };
}

export function monitorChokepoints(input: MonitorInput): ChokepointStatus[] {
  return CHOKEPOINT_IDS.map((id) => monitorSingleChokepoint(id, input));
}
