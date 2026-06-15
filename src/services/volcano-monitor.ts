/**
 * USGS Volcano Hazards Program — volcanoesHazardLevel API + Smithsonian GVP bulletin RSS
 * Sidecar: GET /api/volcanoes/status (30 min cache)
 */
import { getApiBaseUrl } from '@/services/runtime';
import { dataFreshness } from '@/services/data-freshness';

export interface VolcanoMonitorItem {
  id: string;
  name: string;
  location: string;
  alertLevel: 'Normal' | 'Advisory' | 'Watch' | 'Warning';
  aviationColor: 'Green' | 'Yellow' | 'Orange' | 'Red';
  lat: number;
  lon: number;
  updatedAt: string;
  observatory: string;
  gvpBulletin?: string;
}

export interface VolcanoMonitorStatus {
  volcanoes: VolcanoMonitorItem[];
  activeCount: number;
  fetchedAt: string;
}

const CACHE_TTL_MS = 30 * 60 * 1000;
let cache: { data: VolcanoMonitorStatus; ts: number } | null = null;

export async function fetchVolcanoMonitorStatus(): Promise<VolcanoMonitorStatus> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.data;
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/volcanoes/status`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      dataFreshness.recordError('volcano-monitor', `HTTP ${res.status}`);
      return cache?.data ?? { volcanoes: [], activeCount: 0, fetchedAt: new Date().toISOString() };
    }
    const data = (await res.json()) as VolcanoMonitorStatus;
    if (!data || !Array.isArray(data.volcanoes)) {
      dataFreshness.recordError('volcano-monitor', 'malformed response shape');
      return cache?.data ?? { volcanoes: [], activeCount: 0, fetchedAt: new Date().toISOString() };
    }
    cache = { data, ts: Date.now() };
    dataFreshness.recordUpdate('volcano-monitor', data.volcanoes.length);
    return data;
  } catch (error) {
    dataFreshness.recordError('volcano-monitor', String(error));
    return cache?.data ?? { volcanoes: [], activeCount: 0, fetchedAt: new Date().toISOString() };
  }
}

export function alertLevelColor(level: VolcanoMonitorItem['alertLevel']): string {
  return { Normal: '#22c55e', Advisory: '#eab308', Watch: '#f97316', Warning: '#ef4444' }[level] ?? '#6b7280';
}

export function alertLevelBadgeClass(level: VolcanoMonitorItem['alertLevel']): string {
  return { Normal: '', Advisory: 'eq-row eq-moderate', Watch: 'eq-row eq-strong', Warning: 'eq-row eq-major' }[level] ?? '';
}

export function aviationColorHex(color: VolcanoMonitorItem['aviationColor']): string {
  return { Green: '#22c55e', Yellow: '#eab308', Orange: '#f97316', Red: '#ef4444' }[color] ?? '#6b7280';
}
