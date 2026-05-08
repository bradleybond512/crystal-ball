/**
 * PurpleAir hyper-local AQI fetch wrapper.
 *
 * Always goes through the sidecar (`/api/airquality/purpleair`) so the
 * renderer never holds the API key. The sidecar prefers PURPLEAIR_API_KEY
 * (`/v1/sensors`) and falls back to the deprecated public `/json` endpoint
 * when no key is configured. Returns the top-N sensors by PM2.5 with AQI
 * already scored.
 */

import { getApiBaseUrl } from '../runtime';
import {
  scoreAndRank,
  filterUsable,
  TOP_N_SENSORS,
  type PurpleAirSensor,
  type ScoredPurpleAirSensor,
} from './purpleair-helpers';

export type {
  PurpleAirSensor,
  ScoredPurpleAirSensor,
  AqiCategory,
} from './purpleair-helpers';
export { colorForCategory, POLL_INTERVAL_MS } from './purpleair-helpers';

interface SidecarPurpleAirResponse {
  /** Sensors already filtered + parsed sidecar-side. */
  sensors?: PurpleAirSensor[];
  /** Source the sidecar reached: 'v1' (api key) or 'public' (fallback) or 'cache'. */
  source?: 'v1' | 'public' | 'cache';
  fetchedAt?: number;
  error?: string;
}

export interface PurpleAirSnapshot {
  sensors: ScoredPurpleAirSensor[];
  source: 'v1' | 'public' | 'cache' | 'unknown';
  fetchedAt: number;
}

let _cache: { snapshot: PurpleAirSnapshot; ts: number } | null = null;
const CACHE_TTL_MS = 9 * 60 * 1000;

export async function fetchPurpleAirSnapshot(
  topN: number = TOP_N_SENSORS,
): Promise<PurpleAirSnapshot> {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) {
    return _cache.snapshot;
  }
  const fallback: PurpleAirSnapshot = {
    sensors: [],
    source: 'unknown',
    fetchedAt: Date.now(),
  };
  try {
    const resp = await fetch(`${getApiBaseUrl()}/api/airquality/purpleair`);
    if (!resp.ok) return _cache?.snapshot ?? fallback;
    const data = (await resp.json()) as SidecarPurpleAirResponse;
    const usable = filterUsable(data.sensors ?? []);
    const snapshot: PurpleAirSnapshot = {
      sensors: scoreAndRank(usable, topN),
      source: data.source ?? 'unknown',
      fetchedAt: data.fetchedAt ?? Date.now(),
    };
    _cache = { snapshot, ts: Date.now() };
    return snapshot;
  } catch {
    return _cache?.snapshot ?? fallback;
  }
}

export function _resetPurpleAirCacheForTesting(): void {
  _cache = null;
}
