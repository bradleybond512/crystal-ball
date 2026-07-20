/**
 * Open-Meteo Air Quality fetcher — the keyless backbone of the smoke engine.
 * Docs: https://open-meteo.com/en/docs/air-quality-api
 * Direct renderer fetch (CSP already allows https://*.open-meteo.com, same
 * as pollen.ts / air-quality.ts). Every call records freshness under the
 * dedicated 'smoke_forecast' source id (fail-closed pattern).
 */
import { dataFreshness } from '@/services/data-freshness';
import { parseOpenMeteoAq, hasAqData, type ParsedAq } from './smoke-parse';

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
    // Fail-closed: an empty/malformed 200 (including rows whose AQI values
    // are all null) must NOT clear errors or read as fresh.
    if (hasAqData(parsed)) {
      dataFreshness.recordUpdate('smoke_forecast', parsed.hourly.length);
    } else {
      dataFreshness.recordError('smoke_forecast', 'empty AQ payload');
    }
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
    const withData = out.filter((p) => p !== null && hasAqData(p)).length;
    // Fail-closed: a batch where nothing parsed to data is an error, not fresh.
    if (withData === 0) dataFreshness.recordError('smoke_forecast', 'empty AQ batch payload');
    else dataFreshness.recordUpdate('smoke_forecast', withData);
    return out;
  } catch (error) {
    dataFreshness.recordError('smoke_forecast', String(error));
    return points.map(() => null);
  }
}
