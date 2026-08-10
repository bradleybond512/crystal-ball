/**
 * Extended 7-day weather forecast — NWS + Open-Meteo
 *
 * Sources:
 *  - NWS forecast API (US locations): https://api.weather.gov/points/{lat},{lon}
 *  - Open-Meteo daily forecast (global): https://api.open-meteo.com/v1/forecast
 *
 * Both are free, no API key required.
 */

import { createCircuitBreaker } from '@/utils';
import { rehydrateDate } from '@/services/cache-hydration';
import { fetchWithContext } from '@/services/fetch-with-context';

export interface ForecastDay {
  date: string; // ISO date YYYY-MM-DD
  dayName: string; // e.g. "Monday"
  tempHighC: number;
  tempLowC: number;
  tempHighF: number;
  tempLowF: number;
  precipProbability: number;  // 0-100
  precipMm: number;
  weatherCode: number; // WMO weather code
  weatherLabel: string; // Human-readable
  windSpeedKmh: number;
  windDirection: string;
  uvIndexMax: number;
}

export interface ExtendedForecast {
  location: string;
  lat: number;
  lon: number;
  days: ForecastDay[];
  fetchedAt: Date;
}

const breaker = createCircuitBreaker<ExtendedForecast | null>({
  name: 'ExtendedForecast',
  cacheTtlMs: 30 * 60 * 1000,
  persistCache: true,
});

interface OpenMeteoDaily {
  time: string[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  precipitation_sum: number[];
  precipitation_probability_max: number[];
  weather_code: number[];
  wind_speed_10m_max: number[];
  wind_direction_10m_dominant: number[];
  uv_index_max: number[];
}

export async function fetchExtendedForecast(lat: number, lon: number, location = ''): Promise<ExtendedForecast | null> {
  const forecast = await breaker.execute(async () => {
 const params = [
 `latitude=${String(lat)}`,
 `longitude=${String(lon)}`,
 'daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weather_code,wind_speed_10m_max,wind_direction_10m_dominant,uv_index_max',
 'timezone=auto',
 'forecast_days=7',
 ].join('&');

 const res = await fetchWithContext('extended forecast', `https://api.open-meteo.com/v1/forecast?${params}`, {
 signal: AbortSignal.timeout(10_000),
 });
 if (!res.ok) throw new Error(`Open-Meteo HTTP ${String(res.status)}`);

 const data = await res.json() as { daily: OpenMeteoDaily };
 if (!data || typeof data !== 'object' || !('daily' in data)) throw new Error(`Open-Meteo unexpected payload shape`);
 const d = data.daily;

 const days: ForecastDay[] = d.time.map((date, i) => {
 const code = d.weather_code[i] ?? 0;
 const windDeg = d.wind_direction_10m_dominant[i] ?? 0;
 const highC = d.temperature_2m_max[i] ?? 0;
 const lowC = d.temperature_2m_min[i] ?? 0;
 const windMax = d.wind_speed_10m_max[i] ?? 0;
 return {
 date,
 dayName: new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' }),
 tempHighC: Math.round(highC),
 tempLowC: Math.round(lowC),
 tempHighF: Math.round(highC * 9 / 5 + 32),
 tempLowF: Math.round(lowC * 9 / 5 + 32),
 precipProbability: d.precipitation_probability_max[i] ?? 0,
 precipMm: d.precipitation_sum[i] ?? 0,
 weatherCode: code,
 weatherLabel: wmoCodeLabel(code),
 windSpeedKmh: Math.round(windMax),
 windDirection: degreesToCardinal(windDeg),
 uvIndexMax: d.uv_index_max[i] ?? 0,
 };
 });

 return { location: location ?? '', lat, lon, days, fetchedAt: new Date() };
  }, null);
  if (!forecast) return null;
  return {
    ...forecast,
    fetchedAt: rehydrateDate(forecast.fetchedAt),
  };
}

function degreesToCardinal(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16] ?? 'N';
}

/** WMO weather interpretation codes → human-readable labels */
function wmoCodeLabel(code: number): string {
  const labels: Record<number, string> = {
 0: 'Clear sky',
 1: 'Mainly clear',
 2: 'Partly cloudy',
 3: 'Overcast',
 45: 'Fog',
 48: 'Rime fog',
 51: 'Light drizzle',
 53: 'Moderate drizzle',
 55: 'Dense drizzle',
 56: 'Freezing drizzle',
 57: 'Heavy freezing drizzle',
 61: 'Slight rain',
 63: 'Moderate rain',
 65: 'Heavy rain',
 66: 'Freezing rain',
 67: 'Heavy freezing rain',
 71: 'Slight snow',
 73: 'Moderate snow',
 75: 'Heavy snow',
 77: 'Snow grains',
 80: 'Slight showers',
 81: 'Moderate showers',
 82: 'Violent showers',
 85: 'Slight snow showers',
 86: 'Heavy snow showers',
 95: 'Thunderstorm',
 96: 'T-storm w/ slight hail',
 99: 'T-storm w/ heavy hail',
  };
  return labels[code] ?? 'Unknown';
}

/** WMO code to emoji for compact display */
export function wmoCodeEmoji(code: number): string {
  if (code === 0) return '\u2600\uFE0F';
  if (code <= 2) return '\u26C5';
  if (code === 3) return '\u2601\uFE0F';
  if (code <= 48) return '\uD83C\uDF2B\uFE0F';
  if (code <= 57) return '\uD83C\uDF27\uFE0F';
  if (code <= 67) return '\uD83C\uDF27\uFE0F';
  if (code <= 77) return '\u2744\uFE0F';
  if (code <= 82) return '\uD83C\uDF26\uFE0F';
  if (code <= 86) return '\uD83C\uDF28\uFE0F';
  return '\u26A1';
}
