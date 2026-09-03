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
  retrievedAt?: number;
  centroid: [number, number] | null;
  geometry?: { type: string; coordinates: unknown } | null;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const SEVERITIES = new Set<NWSAlert['severity']>(['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown']);
const URGENCIES = new Set<NWSAlert['urgency']>(['Immediate', 'Expected', 'Future', 'Past', 'Unknown']);
let cache: { data: NWSAlert[]; ts: number } | null = null;
let inflight: Promise<NWSAlert[]> | null = null;

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isCentroid(value: unknown): value is [number, number] | null {
  if (value === null) return true;
  if (!Array.isArray(value) || value.length !== 2) return false;
  const lon: unknown = value[0];
  const lat: unknown = value[1];
  return typeof lon === 'number' && Number.isFinite(lon) && lon >= -180 && lon <= 180
    && typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

function isGeometry(value: unknown): value is NWSAlert['geometry'] {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const geometry = value as Record<string, unknown>;
  return typeof geometry.type === 'string' && geometry.type.length > 0
    && 'coordinates' in geometry;
}

function isNwsAlert(value: unknown): value is NWSAlert {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const alert = value as Record<string, unknown>;
  return typeof alert.id === 'string' && alert.id.length > 0
    && typeof alert.event === 'string'
    && typeof alert.headline === 'string'
    && typeof alert.description === 'string'
    && SEVERITIES.has(alert.severity as NWSAlert['severity'])
    && URGENCIES.has(alert.urgency as NWSAlert['urgency'])
    && typeof alert.areaDesc === 'string'
    && (alert.sent === undefined || isTimestamp(alert.sent))
    && isTimestamp(alert.onset)
    && isTimestamp(alert.expires)
    && typeof alert.status === 'string' && alert.status.length > 0
    && (alert.messageType === undefined || alert.messageType === null || typeof alert.messageType === 'string')
    && isCentroid(alert.centroid)
    && isGeometry(alert.geometry);
}

export function _resetNwsAlertsForTest(): void {
  cache = null;
  inflight = null;
}

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
    const body: unknown = await res.json();
    if (!Array.isArray(body) || !body.every((item) => isNwsAlert(item))) {
      throw new Error('NWS alerts response was malformed');
    }
    const retrievedAt = Date.now();
    const data = body.map((item) => ({ ...(item as NWSAlert), retrievedAt }));
    cache = { data, ts: retrievedAt };
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
