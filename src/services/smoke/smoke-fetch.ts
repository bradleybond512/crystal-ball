/**
 * Open-Meteo Air Quality fetcher — the keyless backbone of the smoke engine.
 * Docs: https://open-meteo.com/en/docs/air-quality-api
 * Direct renderer fetch (CSP already allows https://*.open-meteo.com, same
 * as pollen.ts / air-quality.ts). Every call records freshness under the
 * dedicated 'smoke_forecast' source id (fail-closed pattern).
 */
import { dataFreshness } from '@/services/data-freshness';
import {
  parseOpenMeteoAq,
  parseOpenMeteoAqUnix,
  parseOpenMeteoWinds,
  hasAqData,
  type ParsedAq,
} from './smoke-parse';
import type { HourlyWind } from './smoke-types';
import type { GridPointAq } from './forecast-field';

export { parseOpenMeteoAq, avgNext6h, type ParsedAq } from './smoke-parse';

const BASE = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const WEATHER_BASE = 'https://api.open-meteo.com/v1/forecast';

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

/**
 * Hourly 10 m wind forecast at one coordinate — the transport input for the
 * smoke arrival estimator. Returns [] on failure (arrival estimates are an
 * enhancement; the freshness error still surfaces the outage).
 */
export async function fetchTransportWinds(lat: number, lon: number, forecastDays = 2): Promise<HourlyWind[]> {
  const url = `${WEATHER_BASE}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`
    + `&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=mph`
    + `&forecast_days=${forecastDays}&timezone=auto`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`open-meteo winds ${res.status}`);
    const winds = parseOpenMeteoWinds(await res.json());
    // Fail-closed: all-null rows are structure without data.
    if (winds.some((w) => w.speedMph !== null && w.directionDeg !== null)) {
      dataFreshness.recordUpdate('smoke_transport', winds.length);
    } else {
      dataFreshness.recordError('smoke_transport', 'empty wind payload');
    }
    return winds;
  } catch (error) {
    dataFreshness.recordError('smoke_transport', String(error));
    return [];
  }
}

/**
 * Batch AQ forecast for the map's forecast-field grid, fetched with
 * timeformat=unixtime so cells align on absolute time across timezone
 * boundaries. Null entries on failure — the field simply doesn't render.
 */
export async function fetchAqGrid(
  points: { lat: number; lon: number }[],
  forecastDays = 2,
): Promise<(GridPointAq | null)[]> {
  if (points.length === 0) return [];
  const lats = points.map((p) => p.lat.toFixed(4)).join(',');
  const lons = points.map((p) => p.lon.toFixed(4)).join(',');
  const url = `${BASE}?latitude=${lats}&longitude=${lons}`
    + `&hourly=us_aqi&forecast_days=${forecastDays}&timeformat=unixtime&timezone=UTC`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(25_000) });
    if (!res.ok) throw new Error(`open-meteo AQ grid ${res.status}`);
    const body: unknown = await res.json();
    const arr = Array.isArray(body) ? body : [body];
    const out = points.map((_, i) => (arr[i] ? parseOpenMeteoAqUnix(arr[i]) : null));
    const withData = out.filter((p) => p?.usAqi.some((v) => v !== null)).length;
    if (withData === 0) dataFreshness.recordError('smoke_field', 'empty AQ grid payload');
    else dataFreshness.recordUpdate('smoke_field', withData);
    return out;
  } catch (error) {
    dataFreshness.recordError('smoke_field', String(error));
    return points.map(() => null);
  }
}
