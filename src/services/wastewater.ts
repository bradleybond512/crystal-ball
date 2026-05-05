// Wastewater epidemiology — CDC NWSS surveillance via the sidecar.
// The sidecar owns the WWTP-row aggregation and surge-watch heuristic;
// this module is a thin client returning typed signals.

import { getApiBaseUrl } from '@/services/runtime';
import { dataFreshness } from '@/services/data-freshness';

export type WastewaterPathogen =
  | 'COVID-19'
  | 'flu_a'
  | 'flu_b'
  | 'rsv'
  | 'mpox'
  | 'norovirus';

export type WastewaterLevel = 'low' | 'moderate' | 'elevated' | 'high';
export type WastewaterTrend = 'increasing' | 'decreasing' | 'stable';

export interface WastewaterSignal {
  pathogen: WastewaterPathogen;
  jurisdiction: string;
  level: WastewaterLevel;
  trend: WastewaterTrend;
  percentile15d: number | null;
  ptc15d: number | null;
  lastUpdated: string;
}

export interface WastewaterData {
  signals: WastewaterSignal[];
  surgeWatches: string[];
  lastUpdated: string | null;
  fetchedAt: Date;
  degraded?: boolean;
  reason?: string;
}

const CACHE_TTL_MS = 30 * 60 * 1000;
let _cache: { data: WastewaterData; ts: number } | null = null;

export async function fetchWastewater(): Promise<WastewaterData> {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) return _cache.data;

  try {
    const base = getApiBaseUrl();
    const res = await fetch(`${base}/api/wastewater`, { signal: AbortSignal.timeout(25_000) });
    if (!res.ok) throw new Error(`wastewater: ${res.status}`);

    const raw = (await res.json()) as Partial<WastewaterData> & { fetchedAt?: string };
    const data: WastewaterData = {
      signals: Array.isArray(raw.signals) ? raw.signals : [],
      surgeWatches: Array.isArray(raw.surgeWatches) ? raw.surgeWatches : [],
      lastUpdated: typeof raw.lastUpdated === 'string' ? raw.lastUpdated : null,
      fetchedAt: raw.fetchedAt ? new Date(raw.fetchedAt) : new Date(),
      ...(raw.degraded ? { degraded: true, reason: raw.reason } : {}),
    };

    _cache = { data, ts: Date.now() };
    dataFreshness.recordUpdate('wastewater', data.signals.length);
    return data;
  } catch (error) {
    const fallback: WastewaterData = {
      signals: [],
      surgeWatches: [],
      lastUpdated: null,
      fetchedAt: new Date(),
      degraded: true,
      reason: error instanceof Error ? error.message : String(error),
    };
    return fallback;
  }
}

export function clearWastewaterCache(): void {
  _cache = null;
}
