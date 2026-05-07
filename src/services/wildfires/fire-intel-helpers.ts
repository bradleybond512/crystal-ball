/**
 * Fire Intel pure helpers — clustering, threat ranking, AQI categorization.
 *
 * Kept in a sibling file with no value imports so unit tests can run under
 * tsx without pulling the Vite-only `@/utils` chain.
 */

import type { MapFire } from './index';
import type { IncidentReport } from '../inciweb';

// ── Types ────────────────────────────────────────────────────────────────

export interface HotspotCluster {
  /** Grid cell center (rounded to gridDeg). */
  lat: number;
  lon: number;
  fireCount: number;
  totalFrp: number;
  maxBrightness: number;
  /** True if any contributing pixel has confidence >= 95. */
  highConfidence: boolean;
  region: string;
}

export type AqiCategory =
  | 'good'
  | 'moderate'
  | 'sensitive'
  | 'unhealthy'
  | 'very_unhealthy'
  | 'hazardous'
  | 'unknown';

export interface RankedThreat {
  incident: IncidentReport;
  /** acreage × (1 - containment/100). Containment unknown → treated as 0%. */
  threatScore: number;
}

// ── Constants ────────────────────────────────────────────────────────────

export const DEFAULT_GRID_DEG = 0.1;
export const DEFAULT_TOP_N = 500;
const HIGH_CONFIDENCE_THRESHOLD = 95;

// ── Pure helpers ─────────────────────────────────────────────────────────

export function clusterHotspots(
  fires: MapFire[],
  opts: { gridDeg?: number; topN?: number } = {},
): HotspotCluster[] {
  const gridDeg = opts.gridDeg ?? DEFAULT_GRID_DEG;
  const topN = opts.topN ?? DEFAULT_TOP_N;
  if (fires.length === 0) return [];

  const buckets = new Map<string, HotspotCluster>();
  for (const f of fires) {
    if (!Number.isFinite(f.lat) || !Number.isFinite(f.lon)) continue;
    const cellLat = Math.round(f.lat / gridDeg) * gridDeg;
    const cellLon = Math.round(f.lon / gridDeg) * gridDeg;
    const key = `${cellLat.toFixed(4)}|${cellLon.toFixed(4)}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.fireCount += 1;
      existing.totalFrp += f.frp || 0;
      if (f.brightness > existing.maxBrightness) existing.maxBrightness = f.brightness;
      if (f.confidence >= HIGH_CONFIDENCE_THRESHOLD) existing.highConfidence = true;
    } else {
      buckets.set(key, {
        lat: cellLat,
        lon: cellLon,
        fireCount: 1,
        totalFrp: f.frp || 0,
        maxBrightness: f.brightness,
        highConfidence: f.confidence >= HIGH_CONFIDENCE_THRESHOLD,
        region: f.region || 'Unknown',
      });
    }
  }

  return [...buckets.values()]
    .sort((a, b) => b.totalFrp - a.totalFrp)
    .slice(0, topN);
}

export function rankIncidentsByThreat(incidents: IncidentReport[]): RankedThreat[] {
  return incidents
    .map((incident) => {
      const acres = incident.acresBurned ?? 0;
      const contained = incident.percentContained ?? 0;
      const threatScore = acres * (1 - Math.max(0, Math.min(100, contained)) / 100);
      return { incident, threatScore };
    })
    .sort((a, b) => b.threatScore - a.threatScore);
}

export function categorizeAqi(aqi: number | null): AqiCategory {
  if (aqi === null || !Number.isFinite(aqi)) return 'unknown';
  if (aqi <= 50) return 'good';
  if (aqi <= 100) return 'moderate';
  if (aqi <= 150) return 'sensitive';
  if (aqi <= 200) return 'unhealthy';
  if (aqi <= 300) return 'very_unhealthy';
  return 'hazardous';
}
