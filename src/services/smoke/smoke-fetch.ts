/**
 * Open-Meteo Air Quality fetcher — the keyless backbone of the smoke engine.
 * Docs: https://open-meteo.com/en/docs/air-quality-api
 * Direct renderer fetch (CSP already allows https://*.open-meteo.com, same
 * as pollen.ts / air-quality.ts). Every call records freshness under the
 * dedicated 'smoke_forecast' source id (fail-closed pattern).
 */
import { dataFreshness } from '@/services/data-freshness';
import { parseOpenMeteoAq, type ParsedAq } from './smoke-parse';

export { parseOpenMeteoAq, avgNext6h, type ParsedAq } from './smoke-parse';

const BASE = 'https://air-quality-api.open-meteo.com/v1/air-quality';

/** Fetch current + hourly forecast for one coordinate. */
export async function fetchAqForPoint(lat: number, lon: number, forecastDays = 3): Promise<ParsedAq> {
  const url = `${BASE}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`
    + `&current=us_aqi,pm2_5&hourly=us_aqi,pm2_5&forecast_days=${forecastDays}&timezone=auto`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`open-meteo AQ ${res.status}`);
    const parsed = parseOpenMeteoAq(await res.json());
    dataFreshness.recordUpdate('smoke_forecast', parsed.hourly.length > 0 ? 1 : 0);
    return parsed;
  } catch (error) {
    dataFreshness.recordError('smoke_forecast', String(error));
    throw error;
  }
}

/**
 * Batch fetch for many coordinates (compass ring). Open-Meteo accepts
 * comma-separated latitude/longitude lists and returns an array of
 * responses in the same order. Falls back to null entries on failure.
 */
export async function fetchAqForPoints(points: { lat: number; lon: number }[]): Promise<(ParsedAq | null)[]> {
  if (points.length === 0) return [];
  const lats = points.map((p) => p.lat.toFixed(4)).join(',');
  const lons = points.map((p) => p.lon.toFixed(4)).join(',');
  const url = `${BASE}?latitude=${lats}&longitude=${lons}`
    + `&hourly=us_aqi,pm2_5&forecast_days=1&timezone=auto`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`open-meteo AQ batch ${res.status}`);
    const body: unknown = await res.json();
    const arr = Array.isArray(body) ? body : [body];
    const out = points.map((_, i) => (arr[i] ? parseOpenMeteoAq(arr[i]) : null));
    dataFreshness.recordUpdate('smoke_forecast', out.filter(Boolean).length);
    return out;
  } catch (error) {
    dataFreshness.recordError('smoke_forecast', String(error));
    return points.map(() => null);
  }
}
