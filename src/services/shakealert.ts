/**
 * USGS ShakeMap events — M4.5+ in last 7 days with ShakeMap availability
 * Sidecar: GET /api/earthquakes/shakemap-events (30 min cache)
 */
import { getApiBaseUrl } from '@/services/runtime';
import { dataFreshness } from '@/services/data-freshness';

export interface ShakemapEvent {
  id: string;
  place: string;
  magnitude: number;
  depthKm: number;
  occurredAt: number;
  lat: number;
  lon: number;
  hasShakemap: boolean;
  maxMmi: number | null;
  mmiLabel: string;
  pagerAlert: string | null;
  detailUrl: string;
}

export interface ShakemapStatus {
  events: ShakemapEvent[];
  mostSignificantEventId: string | null;
  fetchedAt: string;
}

const CACHE_TTL_MS = 30 * 60 * 1000;
let cache: { data: ShakemapStatus; ts: number } | null = null;

const EMPTY: ShakemapStatus = { events: [], mostSignificantEventId: null, fetchedAt: new Date().toISOString() };

export async function fetchShakemapEvents(): Promise<ShakemapStatus> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.data;
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/earthquakes/shakemap-events`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      dataFreshness.recordError('shakealert', `HTTP ${res.status}`);
      return cache?.data ?? EMPTY;
    }
    const data = (await res.json()) as ShakemapStatus;
    cache = { data, ts: Date.now() };
    dataFreshness.recordUpdate('shakealert', data.events.length);
    return data;
  } catch (error) {
    dataFreshness.recordError('shakealert', String(error));
    return cache?.data ?? EMPTY;
  }
}

export function mmiLabel(mmi: number | null): string {
  if (mmi === null) return '—';
  if (mmi < 2) return 'Not Felt';
  if (mmi < 4) return 'Weak';
  if (mmi < 5) return 'Light';
  if (mmi < 6) return 'Moderate';
  if (mmi < 7) return 'Strong';
  if (mmi < 8) return 'Very Strong';
  if (mmi < 9) return 'Severe';
  if (mmi < 10) return 'Violent';
  return 'Extreme';
}

export function mmiHexColor(mmi: number | null): string {
  if (mmi === null || mmi < 2) return '#aaaaaa';
  if (mmi < 4) return '#7fff00';
  if (mmi < 5) return '#ffff00';
  if (mmi < 6) return '#ffcc00';
  if (mmi < 7) return '#ff8800';
  if (mmi < 8) return '#ff0000';
  if (mmi < 9) return '#dd0000';
  return '#800000';
}

export function pagerAlertColor(alert: string | null): string {
  return { green: '#22c55e', yellow: '#eab308', orange: '#f97316', red: '#ef4444' }[alert ?? ''] ?? '#6b7280';
}

export function shakemapAvailabilityLabel(hasShakemap: boolean): string {
  return hasShakemap ? 'ShakeMap available' : 'ShakeMap pending';
}
