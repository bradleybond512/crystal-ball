/**
 * Fail-closed AirNow current-observations fetch — 3rd air_quality fusion
 * source, keyed. Single-point query (nearest-station search, see the
 * sidecar route), so callers pass the coordinate to query around rather
 * than this module picking one itself.
 */
import { getApiBaseUrl } from '@/services/runtime';
import type { AirnowReading } from './airquality-fusion-observations';

export interface AirnowFetchResult { ok: boolean; readings: AirnowReading[] }

export async function fetchAirnowCurrent(lat: number, lon: number): Promise<AirnowFetchResult> {
  try {
    const url = `${getApiBaseUrl()}/api/airnow/current?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { ok: false, readings: [] };
    const data = (await res.json()) as { readings?: AirnowReading[]; degraded?: boolean; error?: string } | null;
    if (!data || data.degraded || data.error || !Array.isArray(data.readings)) return { ok: false, readings: [] };
    const readings = data.readings.filter((r): r is AirnowReading =>
      !!r && Number.isFinite(r.aqi) && r.aqi >= 0 && Number.isFinite(r.lat) && Number.isFinite(r.lon) && Number.isFinite(r.observedAt));
    if (readings.length === 0) return { ok: false, readings: [] };
    return { ok: true, readings };
  } catch {
    return { ok: false, readings: [] };
  }
}
