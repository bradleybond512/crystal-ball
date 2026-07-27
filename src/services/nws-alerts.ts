/**
 * NOAA National Weather Service All-Hazards Alerts
 * Public API — no authentication required
 * Docs: https://www.weather.gov/documentation/services-web-api
 */
import { getApiBaseUrl } from '@/services/runtime';
import { dataFreshness } from '@/services/data-freshness';

export interface NWSAlert {
  id: string;
  event: string;
  headline: string;
  description: string;
  severity: 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
  urgency: 'Immediate' | 'Expected' | 'Future' | 'Past' | 'Unknown';
  areaDesc: string;
  sent?: string;
  onset: string;
  expires: string;
  status: string;
  messageType?: string | null;
  centroid: [number, number] | null;
  geometry?: { type: string; coordinates: unknown } | null;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { data: NWSAlert[]; ts: number } | null = null;
let inflight: Promise<NWSAlert[]> | null = null;

export async function fetchNWSAlerts(): Promise<NWSAlert[]> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.data;
  if (inflight) return inflight;
  inflight = doFetchNWSAlerts().finally(() => { inflight = null; });
  return inflight;
}

async function doFetchNWSAlerts(): Promise<NWSAlert[]> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/nws-alerts`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      dataFreshness.recordError('nws-alerts', `HTTP ${res.status}`);
      return cache?.data ?? [];
    }
    const data = (await res.json()) as NWSAlert[];
    cache = { data, ts: Date.now() };
    dataFreshness.recordUpdate('nws-alerts', data.length);
    return data;
  } catch (error) {
    dataFreshness.recordError('nws-alerts', String(error));
    return cache?.data ?? [];
  }
}

export function nwsSeverityClass(severity: NWSAlert['severity']): string {
  return {
    Extreme: 'eq-row eq-major',
    Severe: 'eq-row eq-strong',
    Moderate: 'eq-row eq-moderate',
    Minor: 'eq-row',
    Unknown: 'eq-row',
  }[severity] ?? 'eq-row';
}
