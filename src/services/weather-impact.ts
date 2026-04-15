/**
 * Weather Impact Analysis Service
 *
 * Correlates severe weather events with nearby critical infrastructure
 * (military bases, chokepoints, population centers, power grids, agricultural
 * regions) to assess their strategic impact. Each weather alert is checked
 * against ~30 hardcoded infrastructure points within 800 km, producing a
 * scored impact list that feeds into the correlation matrix and supply-chain
 * disruption pipeline.
 *
 * Key capabilities:
 *  - analyzeWeatherImpacts(): score weather alerts against critical infra
 *  - summarizeWeatherImpacts(): aggregate impacts by category and region
 *  - weatherToSupplyChainSignals(): emit DisruptionSignal-compatible objects
 *    for extreme/severe weather near maritime chokepoints
 */

import type { WeatherAlert } from '@/services/weather';
import { haversineKm } from '@/services/proximity-filter';
import { classifyRegion, type MatrixRegion } from '@/services/correlation-matrix';

// ── Types ────────────────────────────────────────────────────────────────────

export type ImpactCategory = 'military' | 'infrastructure' | 'supply-chain' | 'population' | 'agriculture';

export interface WeatherImpact {
  id: string;
  weatherAlertId: string;
  weatherEvent: string;
  weatherSeverity: string;
  category: ImpactCategory;
  targetName: string;
  targetLat: number;
  targetLon: number;
  distanceKm: number;
  /** Composite impact score, 0–100 */
  impactScore: number;
  region: MatrixRegion | null;
  description: string;
  detectedAt: number;
}

export interface WeatherImpactSummary {
  totalImpacts: number;
  criticalImpacts: number;
  byCategory: Record<ImpactCategory, number>;
  byRegion: Map<string, number>;
  topImpacts: WeatherImpact[];
}

// ── Critical Infrastructure ──────────────────────────────────────────────────

interface InfrastructurePoint {
  name: string;
  lat: number;
  lon: number;
  category: ImpactCategory;
  /** Strategic importance, 1–10 */
  importance: number;
}

const CRITICAL_INFRASTRUCTURE: InfrastructurePoint[] = [
  // Military
  { name: 'Norfolk Naval Base',        lat: 36.95,  lon: -76.33,  category: 'military',       importance: 9 },
  { name: 'San Diego Naval Base',      lat: 32.68,  lon: -117.15, category: 'military',       importance: 9 },
  { name: 'Ramstein AFB',              lat: 49.44,  lon: 7.6,    category: 'military',       importance: 8 },
  { name: 'Diego Garcia',              lat: -7.32,  lon: 72.42,   category: 'military',       importance: 8 },
  { name: 'Yokosuka Naval Base',       lat: 35.28,  lon: 139.67,  category: 'military',       importance: 9 },
  { name: 'Pearl Harbor',              lat: 21.35,  lon: -157.95, category: 'military',       importance: 9 },
  { name: 'Camp Humphreys',            lat: 36.96,  lon: 127.03,  category: 'military',       importance: 7 },
  { name: 'RAF Lakenheath',            lat: 52.41,  lon: 0.56,    category: 'military',       importance: 7 },

  // Infrastructure — maritime chokepoints
  { name: 'Panama Canal',              lat: 9.08,   lon: -79.68,  category: 'infrastructure', importance: 10 },
  { name: 'Suez Canal',                lat: 30.46,  lon: 32.35,   category: 'infrastructure', importance: 10 },
  { name: 'Strait of Hormuz',          lat: 26.57,  lon: 56.25,   category: 'infrastructure', importance: 10 },
  { name: 'Strait of Malacca',         lat: 2.5,   lon: 101,  category: 'infrastructure', importance: 10 },
  { name: 'Bab el-Mandeb',             lat: 12.58,  lon: 43.33,   category: 'infrastructure', importance: 9 },
  { name: 'Houston Ship Channel',      lat: 29.73,  lon: -95.01,  category: 'infrastructure', importance: 8 },
  { name: 'Rotterdam Port',            lat: 51.95,  lon: 4.12,    category: 'infrastructure', importance: 8 },
  { name: 'Singapore Port',            lat: 1.26,   lon: 103.84,  category: 'infrastructure', importance: 9 },
  { name: 'Shanghai Port',             lat: 31.35,  lon: 121.5,  category: 'infrastructure', importance: 8 },

  // Power grid hubs
  { name: 'Texas ERCOT Region',        lat: 31,  lon: -97,  category: 'infrastructure', importance: 8 },
  { name: 'PJM Interconnection',       lat: 39.95,  lon: -75.17,  category: 'infrastructure', importance: 8 },
  { name: 'European Grid Hub',         lat: 50.85,  lon: 4.35,    category: 'infrastructure', importance: 7 },

  // Population centers
  { name: 'Tokyo',                     lat: 35.68,  lon: 139.69,  category: 'population',     importance: 9 },
  { name: 'Mumbai',                    lat: 19.08,  lon: 72.88,   category: 'population',     importance: 8 },
  { name: 'Lagos',                     lat: 6.52,   lon: 3.38,    category: 'population',     importance: 7 },
  { name: 'Dhaka',                     lat: 23.81,  lon: 90.41,   category: 'population',     importance: 7 },
  { name: 'Mexico City',               lat: 19.43,  lon: -99.13,  category: 'population',     importance: 7 },
  { name: 'Cairo',                     lat: 30.04,  lon: 31.24,   category: 'population',     importance: 7 },

  // Agriculture
  { name: 'US Corn Belt',              lat: 41.5,  lon: -93,  category: 'agriculture',    importance: 9 },
  { name: 'Ukraine Breadbasket',       lat: 49,  lon: 32,   category: 'agriculture',    importance: 8 },
  { name: 'Punjab',                    lat: 31,  lon: 75,   category: 'agriculture',    importance: 8 },
  { name: 'Brazilian Cerrado',         lat: -15.5, lon: -47.6,  category: 'agriculture',    importance: 7 },
];

// ── Chokepoints used for supply-chain signal generation ──────────────────────

const SUPPLY_CHAIN_CHOKEPOINTS = [
  'Panama Canal',
  'Suez Canal',
  'Strait of Hormuz',
  'Strait of Malacca',
  'Bab el-Mandeb',
] as const;

// ── Severity scoring ─────────────────────────────────────────────────────────

const MAX_DISTANCE_KM = 800;
const MAX_IMPACTS = 50;
const MIN_IMPACT_SCORE = 20;

/** Map NWS severity string to a base score (0–100 range). */
export function weatherSeverityToScore(severity: string): number {
  switch (severity) {
    case 'Extreme': {  return 90;
    }
    case 'Severe': {   return 70;
    }
    case 'Moderate': { return 45;
    }
    case 'Minor': {    return 25;
    }
    default: {         return 15;
    }
  }
}

// ── Impact analysis ──────────────────────────────────────────────────────────

let _impactCounter = 0;

/**
 * Analyse a set of weather alerts against known critical infrastructure.
 *
 * For every alert that has a centroid, each infrastructure point within
 * 800 km is scored. The composite score weights weather severity, distance
 * decay, and the target's strategic importance.
 *
 * Returns up to 50 impacts, sorted by score descending.
 */
export function analyzeWeatherImpacts(weatherAlerts: WeatherAlert[]): WeatherImpact[] {
  const impacts: WeatherImpact[] = [];
  const now = Date.now();

  for (const alert of weatherAlerts) {
    if (!alert.centroid) continue;

    const [centroidLon, centroidLat] = alert.centroid;
    const severityScore = weatherSeverityToScore(alert.severity);

    for (const infra of CRITICAL_INFRASTRUCTURE) {
      const distance = haversineKm(centroidLat, centroidLon, infra.lat, infra.lon);
      if (distance > MAX_DISTANCE_KM) continue;

      const distanceDecay = 1 - distance / MAX_DISTANCE_KM;
      const importanceFactor = infra.importance / 10;
      const raw = severityScore * distanceDecay * importanceFactor;
      const impactScore = Math.min(100, Math.max(0, Math.round(raw)));

      if (impactScore < MIN_IMPACT_SCORE) continue;

      _impactCounter += 1;
      impacts.push({
        id: `wi-${now}-${_impactCounter}`,
        weatherAlertId: alert.id,
        weatherEvent: alert.event,
        weatherSeverity: alert.severity,
        category: infra.category,
        targetName: infra.name,
        targetLat: infra.lat,
        targetLon: infra.lon,
        distanceKm: Math.round(distance),
        impactScore,
        region: classifyRegion(infra.lat, infra.lon),
        description: `${alert.severity} ${alert.event} within ${Math.round(distance)} km of ${infra.name}`,
        detectedAt: now,
      });
    }
  }

  impacts.sort((a, b) => b.impactScore - a.impactScore);
  return impacts.slice(0, MAX_IMPACTS);
}

// ── Summary aggregation ──────────────────────────────────────────────────────

const ALL_CATEGORIES: ImpactCategory[] = [
  'military',
  'infrastructure',
  'supply-chain',
  'population',
  'agriculture',
];

/** Aggregate a list of weather impacts into a dashboard-ready summary. */
export function summarizeWeatherImpacts(impacts: WeatherImpact[]): WeatherImpactSummary {
  const byCategory = Object.fromEntries(
    ALL_CATEGORIES.map(c => [c, 0]),
  ) as Record<ImpactCategory, number>;

  const byRegion = new Map<string, number>();
  let criticalCount = 0;

  for (const impact of impacts) {
    byCategory[impact.category] = (byCategory[impact.category] ?? 0) + 1;

    if (impact.region) {
      byRegion.set(impact.region, (byRegion.get(impact.region) ?? 0) + 1);
    }

    if (impact.impactScore >= 70) {
      criticalCount += 1;
    }
  }

  // Top 10 impacts for the summary card
  const topImpacts = [...impacts]
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, 10);

  return {
    totalImpacts: impacts.length,
    criticalImpacts: criticalCount,
    byCategory,
    byRegion,
    topImpacts,
  };
}

// ── Supply-chain signal bridge ───────────────────────────────────────────────

/**
 * Convert weather alerts near maritime chokepoints into DisruptionSignal-
 * compatible objects that can be fed directly to the supply-chain-impact
 * service.
 *
 * Only Extreme and Severe weather within 400 km of a tracked chokepoint
 * produces a signal.
 */
export function weatherToSupplyChainSignals(
  weatherAlerts: WeatherAlert[],
): { source: 'weather'; severity: number; description: string; timestamp: string }[] {
  const CHOKEPOINT_RADIUS_KM = 400;
  const signals: { source: 'weather'; severity: number; description: string; timestamp: string }[] = [];

  const chokepoints = CRITICAL_INFRASTRUCTURE.filter(
    p => (SUPPLY_CHAIN_CHOKEPOINTS as readonly string[]).includes(p.name),
  );

  for (const alert of weatherAlerts) {
    if (!alert.centroid) continue;
    if (alert.severity !== 'Extreme' && alert.severity !== 'Severe') continue;

    const [centroidLon, centroidLat] = alert.centroid;

    for (const cp of chokepoints) {
      const distance = haversineKm(centroidLat, centroidLon, cp.lat, cp.lon);
      if (distance > CHOKEPOINT_RADIUS_KM) continue;

      const severityNormalized = alert.severity === 'Extreme' ? 0.9 : 0.6;
      const distanceDecay = 1 - distance / CHOKEPOINT_RADIUS_KM;
      const severity = Math.min(1, Math.max(0, severityNormalized * distanceDecay));

      signals.push({
        source: 'weather',
        severity: Math.round(severity * 100) / 100,
        description: `${alert.severity} ${alert.event} within ${Math.round(distance)} km of ${cp.name}`,
        timestamp: new Date().toISOString(),
      });
    }
  }

  return signals;
}
