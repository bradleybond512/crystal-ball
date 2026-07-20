/**
 * Pure parsing half of the Open-Meteo AQ fetcher — zero imports beyond types
 * so fixture tests run under tsx without the Vite alias chain.
 */
import type { AqiSample, HourlyWind } from './smoke-types';
import type { GridPointAq } from './forecast-field';

export interface ParsedAq {
  current: { usAqi: number | null; pm25: number | null };
  hourly: AqiSample[];
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function parseOpenMeteoAq(raw: unknown): ParsedAq {
  const r = raw as {
    current?: { us_aqi?: unknown; pm2_5?: unknown };
    hourly?: { time?: unknown[]; us_aqi?: unknown[]; pm2_5?: unknown[] };
  } | null;
  const times = Array.isArray(r?.hourly?.time) ? r.hourly.time : [];
  const aqis = Array.isArray(r?.hourly?.us_aqi) ? r.hourly.us_aqi : [];
  const pms = Array.isArray(r?.hourly?.pm2_5) ? r.hourly.pm2_5 : [];
  const hourly: AqiSample[] = times.map((t, i) => ({
    time: String(t),
    usAqi: num(aqis[i]),
    pm25: num(pms[i]),
  }));
  return {
    current: { usAqi: num(r?.current?.us_aqi), pm25: num(r?.current?.pm2_5) },
    hourly,
  };
}

/** True when the payload carries at least one real AQI value — rows whose
 *  us_aqi are all null are structure without data and must not read as fresh. */
export function hasAqData(parsed: ParsedAq): boolean {
  return parsed.hourly.some((s) => s.usAqi !== null) || parsed.current.usAqi !== null;
}

/** Parse an Open-Meteo weather-forecast payload's hourly 10 m winds. */
export function parseOpenMeteoWinds(raw: unknown): HourlyWind[] {
  const r = raw as {
    hourly?: { time?: unknown[]; wind_speed_10m?: unknown[]; wind_direction_10m?: unknown[] };
  } | null;
  const times = Array.isArray(r?.hourly?.time) ? r.hourly.time : [];
  const speeds = Array.isArray(r?.hourly?.wind_speed_10m) ? r.hourly.wind_speed_10m : [];
  const dirs = Array.isArray(r?.hourly?.wind_direction_10m) ? r.hourly.wind_direction_10m : [];
  return times.map((t, i) => ({
    time: String(t),
    speedMph: num(speeds[i]),
    directionDeg: num(dirs[i]),
  }));
}

/** Parse one Open-Meteo AQ response fetched with timeformat=unixtime into
 *  absolute-time hourly AQI (forecast-field cells align on absolute time). */
export function parseOpenMeteoAqUnix(raw: unknown): GridPointAq | null {
  const r = raw as { hourly?: { time?: unknown[]; us_aqi?: unknown[] } } | null;
  const times = Array.isArray(r?.hourly?.time) ? r.hourly.time : [];
  if (times.length === 0) return null;
  const aqis = Array.isArray(r?.hourly?.us_aqi) ? r.hourly.us_aqi : [];
  const timesMs: number[] = [];
  const usAqi: (number | null)[] = [];
  for (const [i, t] of times.entries()) {
    const sec = num(t);
    if (sec === null) continue;
    timesMs.push(sec * 1000);
    usAqi.push(num(aqis[i]));
  }
  return timesMs.length > 0 ? { timesMs, usAqi } : null;
}

/** Mean us_aqi of the first ≤6 samples with data; null if none have data. */
export function avgNext6h(hourly: AqiSample[]): number | null {
  const vals = hourly.slice(0, 6).map((s) => s.usAqi).filter((v): v is number => v !== null);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
