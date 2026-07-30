/**
 * Fail-closed MET Norway surface-temp fetch — 2nd surface_temp fusion
 * source. Single-point query, mirrors airnow-fusion-fetch.ts's ladder.
 */

import { getApiBaseUrl } from '@/services/runtime';
import type { TempReading } from './weather-fusion-observations';

export interface MetNorwayFetchResult {
  ok: boolean;
  readings: TempReading[];
}

export async function fetchMetNorwayTemp(lat: number, lon: number): Promise<MetNorwayFetchResult> {
  try {
    const url = `${getApiBaseUrl()}/api/met-norway-temp?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { ok: false, readings: [] };
    const data = (await res.json()) as { readings?: TempReading[]; degraded?: boolean } | null;
    if (!data || data.degraded || !Array.isArray(data.readings)) return { ok: false, readings: [] };
    const readings = data.readings.filter(
      (r): r is TempReading =>
        !!r && Number.isFinite(r.tempC) && Number.isFinite(r.lat) && Number.isFinite(r.lon) && Number.isFinite(r.observedAt),
    );
    if (readings.length === 0) return { ok: false, readings: [] };
    return { ok: true, readings };
  } catch {
    return { ok: false, readings: [] };
  }
}
