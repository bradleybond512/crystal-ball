/**
 * Fail-closed Open-Meteo current-temperature fetch — 1st surface_temp
 * fusion source, reusing the existing local-forecast route's `current`
 * block. Mirrors airnow-fusion-fetch.ts's ladder.
 */

import { getApiBaseUrl } from '@/services/runtime';
import type { TempReading } from './weather-fusion-observations';

export interface OpenMeteoTempFetchResult {
  ok: boolean;
  readings: TempReading[];
}

interface OpenMeteoForecastResponse {
  latitude?: number;
  longitude?: number;
  current?: { temperature_2m?: number };
  currentObservedAtMs?: number;
  error?: string;
}

export async function fetchOpenMeteoTemp(lat: number, lon: number): Promise<OpenMeteoTempFetchResult> {
  try {
    const url = `${getApiBaseUrl()}/api/weather/local-forecast?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { ok: false, readings: [] };
    const data = (await res.json()) as OpenMeteoForecastResponse | null;
    if (!data || data.error) return { ok: false, readings: [] };
    const tempC = data.current?.temperature_2m;
    const observedAt = data.currentObservedAtMs;
    if (!Number.isFinite(tempC) || !Number.isFinite(observedAt)) return { ok: false, readings: [] };
    const readingLat = data.latitude ?? lat;
    const readingLon = data.longitude ?? lon;
    return { ok: true, readings: [{ lat: readingLat, lon: readingLon, tempC: tempC as number, observedAt: observedAt as number }] };
  } catch {
    return { ok: false, readings: [] };
  }
}
