import { createCircuitBreaker, getCSSColor } from '@/utils';

export interface WeatherAlert {
  id: string;
  event: string;
  severity: 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
  headline: string;
  description: string;
  areaDesc: string;
  onset: Date;
  expires: Date;
  coordinates: [number, number][];
  centroid?: [number, number];
  /** UGC zone/county codes the alert applies to (from properties.geocode.UGC).
   *  Used as the geometry-free fallback when an alert has no polygon. */
  ugcZones: string[];
}

interface NWSAlert {
  id: string;
  properties: {
 event: string;
 severity: string;
 headline: string;
 description: string;
 areaDesc: string;
 onset: string;
 expires: string;
 geocode?: { UGC?: string[]; SAME?: string[] };
  };
  geometry?: {
 type: string;
 coordinates: number[][][] | number[][];
  };
}

interface NWSResponse {
  features: NWSAlert[];
}

const NWS_API = 'https://api.weather.gov/alerts/active';
const breaker = createCircuitBreaker<WeatherAlert[]>({ name: 'NWS Weather', cacheTtlMs: 30 * 60 * 1000, persistCache: true });

/** Cap on active alerts retained from the national feed. The feed is
 *  sorted MOST-SEVERE-FIRST before this cap applies, so a busy severe-
 *  weather outbreak can't push the user's own warning out of range. Set
 *  well above a realistic simultaneous-warning count (the old value, 50,
 *  was smaller than a single big outbreak). */
export const MAX_ACTIVE_ALERTS = 200;

/** Higher = more severe. Drives the pre-cap priority sort so Extreme/
 *  Severe products always survive truncation. */
const SEVERITY_RANK: Record<string, number> = {
  Extreme: 4,
  Severe: 3,
  Moderate: 2,
  Minor: 1,
  Unknown: 0,
};

/** Alerts at or above this rank (Severe, Extreme) are never shed by the cap. */
const PROTECTED_SEVERITY_RANK = 3;

/**
 * Filter → prioritize → cap → normalize the raw NWS feature list into
 * `WeatherAlert[]`. Pure and deterministic (given feature timestamps) so
 * the truncation policy is unit-testable without a live fetch.
 *
 * The sort is the safety-critical part: personalization happens
 * DOWNSTREAM of this cap, so if a Severe/Extreme alert over the user is
 * dropped here it can never warn them. Sorting most-severe-first (stable
 * within a severity, so API order is preserved per tier) guarantees the
 * cap only ever sheds the least-severe products.
 */
export function selectAndNormalizeWeatherAlerts(features: readonly NWSAlert[]): WeatherAlert[] {
  const ranked = [...features]
    .filter((alert) => alert.properties.severity !== 'Unknown')
    .sort((a, b) => (SEVERITY_RANK[b.properties.severity] ?? 0) - (SEVERITY_RANK[a.properties.severity] ?? 0));
  // Never shed a Severe/Extreme product — those are the ones that can be over
  // the user, and personalization runs DOWNSTREAM of this cap. Because `ranked`
  // is severe-first, the protected set is a prefix: extend the slice to cover
  // it so the cap only ever trims the Moderate/Minor tail, even in an outbreak
  // with more Severe/Extreme warnings than MAX_ACTIVE_ALERTS.
  const protectedCount = ranked.filter(
    (a) => (SEVERITY_RANK[a.properties.severity] ?? 0) >= PROTECTED_SEVERITY_RANK,
  ).length;
  return ranked
    .slice(0, Math.max(MAX_ACTIVE_ALERTS, protectedCount))
    .map((alert) => {
      const coords = extractCoordinates(alert.geometry);
      return {
        id: alert.id,
        event: alert.properties.event,
        severity: alert.properties.severity as WeatherAlert['severity'],
        headline: alert.properties.headline,
        description: alert.properties.description?.slice(0, 500) ?? '',
        areaDesc: alert.properties.areaDesc,
        onset: new Date(alert.properties.onset),
        expires: new Date(alert.properties.expires),
        coordinates: coords,
        centroid: calculateCentroid(coords),
        ugcZones: alert.properties.geocode?.UGC ?? [],
      };
    });
}

export async function fetchWeatherAlerts(): Promise<WeatherAlert[]> {
  return breaker.execute(async () => {
 const response = await fetch(NWS_API, {
 headers: { 'User-Agent': 'CrystalBall/1.0' }
 });

 if (!response.ok) throw new Error(`HTTP ${response.status}`);

 const data = await response.json() as NWSResponse;
 if (!data || !Array.isArray(data.features)) return [];

 return selectAndNormalizeWeatherAlerts(data.features);
  }, []);
}

export function getWeatherStatus(): string {
  return breaker.getStatus();
}

interface NWSPointZones {
  properties?: { forecastZone?: string; county?: string };
}

/** Derive a location's own UGC codes (forecast zone + county) from NWS
 *  `/points/{lat},{lon}`. Best-effort: returns `[]` on any failure so
 *  callers can degrade to polygon-only matching. The codes are the last
 *  path segment of the `forecastZone` / `county` URLs (e.g. `INZ001`). */
export async function fetchUgcZonesForPoint(lat: number, lon: number): Promise<string[]> {
  try {
    const res = await fetch(`https://api.weather.gov/points/${lat},${lon}`, {
      headers: { 'User-Agent': 'CrystalBall/1.0', Accept: 'application/geo+json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const payload = await res.json() as NWSPointZones;
    const zones = [payload.properties?.forecastZone, payload.properties?.county]
      .map((url) => url?.split('/').pop() ?? '')
      .filter((code) => /^[A-Z]{2}[CZ]\d{3}$/.test(code));
    return [...new Set(zones)];
  } catch {
    return [];
  }
}

function extractCoordinates(geometry?: NWSAlert['geometry']): [number, number][] {
  if (!geometry) return [];

  try {
 if (geometry.type === 'Polygon') {
 const coords = geometry.coordinates as unknown as number[][][];
 return coords[0]?.map(c => [c[0], c[1]] as [number, number]) ?? [];
 }
 if (geometry.type === 'MultiPolygon') {
 const coords = geometry.coordinates as unknown as number[][][][];
 return coords[0]?.[0]?.map(c => [c[0], c[1]] as [number, number]) ?? [];
 }
  } catch {
 return [];
  }
  return [];
}

function calculateCentroid(coords: [number, number][]): [number, number] | undefined {
  if (coords.length === 0) return undefined;

  const sum = coords.reduce(
 (acc, [lon, lat]) => [acc[0] + lon, acc[1] + lat],
 [0, 0]
  );

  return [sum[0] / coords.length, sum[1] / coords.length];
}

export function getSeverityColor(severity: WeatherAlert['severity']): string {
  switch (severity) {
 case 'Extreme': { return getCSSColor('--semantic-critical');
 }
 case 'Severe': { return getCSSColor('--semantic-high');
 }
 case 'Moderate': { return getCSSColor('--semantic-elevated');
 }
 case 'Minor': { return getCSSColor('--semantic-elevated');
 }
 default: { return getCSSColor('--text-dim');
 }
  }
}

export interface OpenMeteoConditions {
  temperature: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  windDirection: number;
  precipitation: number;
  weatherCode: number;
  isDay: boolean;
  uvIndex: number | null;
  fetchedAt: Date;
  source: 'open-meteo';
}

const _openMeteoCache = new Map<string, { data: OpenMeteoConditions; ts: number }>();
const OPEN_METEO_TTL_MS = 10 * 60 * 1000;

export async function fetchOpenMeteoConditions(
  lat: number,
  lon: number,
): Promise<OpenMeteoConditions | null> {
  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = _openMeteoCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < OPEN_METEO_TTL_MS) return cached.data;

  try {
    const url = `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation,weather_code,is_day,uv_index` +
      `&wind_speed_unit=kmh&timezone=auto`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const raw = await res.json() as { current?: Record<string, number | boolean | null> };
    if (!raw || typeof raw !== 'object') return null;
    const c = raw.current;
    if (!c) return null;
    const data: OpenMeteoConditions = {
      temperature: typeof c.temperature_2m === 'number' ? c.temperature_2m : 0,
      feelsLike: typeof c.apparent_temperature === 'number' ? c.apparent_temperature : 0,
      humidity: typeof c.relative_humidity_2m === 'number' ? c.relative_humidity_2m : 0,
      windSpeed: typeof c.wind_speed_10m === 'number' ? c.wind_speed_10m : 0,
      windDirection: typeof c.wind_direction_10m === 'number' ? c.wind_direction_10m : 0,
      precipitation: typeof c.precipitation === 'number' ? c.precipitation : 0,
      weatherCode: typeof c.weather_code === 'number' ? c.weather_code : 0,
      isDay: c.is_day === 1,
      uvIndex: typeof c.uv_index === 'number' ? c.uv_index : null,
      fetchedAt: new Date(),
      source: 'open-meteo',
    };
    _openMeteoCache.set(cacheKey, { data, ts: Date.now() });
    return data;
  } catch {
    return null;
  }
}

// ── Site-specific helpers for Data Center Readiness ─────────────

import type { ForecastSlot, SiteAirQuality, ConnectivitySignal } from './datacenter/datacenter-types.ts';

/** WMO weather code → single representative emoji. */
export function wmoCodeEmoji(code: number): string {
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤';
  if (code === 3) return '☁️';
  if (code <= 48) return '🌫';
  if (code <= 57) return '🌦';
  if (code <= 67) return '🌧';
  if (code <= 77) return '❄️';
  if (code <= 82) return '🌦';
  if (code <= 86) return '🌨';
  return '⛈';
}

/** Wind direction degrees → 8-point compass abbreviation. */
export function degreesToCompass(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8]!;
}

/** Celsius → Fahrenheit (rounded). */
export function cToF(c: number): number {
  return Math.round(c * 9 / 5 + 32);
}

/** US AQI value → short descriptive label. */
export function aqiLabel(aqi: number): string {
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Sensitive';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very Unhealthy';
  return 'Hazardous';
}

const _forecast24hCache = new Map<string, { data: ForecastSlot[]; ts: number }>();
const FORECAST_TTL_MS = 30 * 60 * 1000;

/** Fetch 4 forecast slots at +0h, +6h, +12h, +18h for a given location. */
export async function fetchSite24hForecast(lat: number, lon: number): Promise<ForecastSlot[]> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = _forecast24hCache.get(key);
  if (cached && Date.now() - cached.ts < FORECAST_TTL_MS) return cached.data;

  try {
    const url = `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lon}` +
      `&hourly=temperature_2m,precipitation_probability,weather_code` +
      `&forecast_days=1&timezone=auto`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const raw = await res.json() as {
      hourly?: {
        time?: string[];
        temperature_2m?: number[];
        precipitation_probability?: (number | null)[];
        weather_code?: number[];
      };
    };
    if (!raw || typeof raw !== 'object') return [];
    const h = raw.hourly;
    if (!h?.time?.length) return [];

    const nowHour = new Date().getHours();
    const slots: ForecastSlot[] = [];
    for (const offset of [0, 6, 12, 18]) {
      const idx = (nowHour + offset) % 24;
      if (idx >= (h.temperature_2m?.length ?? 0)) continue;
      slots.push({
        offsetHours: offset,
        tempC: h.temperature_2m?.[idx] ?? 0,
        precipProbabilityPct: h.precipitation_probability?.[idx] ?? 0,
        weatherCode: h.weather_code?.[idx] ?? 0,
      });
    }
    _forecast24hCache.set(key, { data: slots, ts: Date.now() });
    return slots;
  } catch {
    return [];
  }
}

const _aqCache = new Map<string, { data: SiteAirQuality; ts: number }>();
const AQ_TTL_MS = 30 * 60 * 1000;

/** Fetch US AQI + PM2.5 for a specific location via open-meteo air quality API. */
export async function fetchSiteAirQuality(lat: number, lon: number): Promise<SiteAirQuality | null> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = _aqCache.get(key);
  if (cached && Date.now() - cached.ts < AQ_TTL_MS) return cached.data;

  try {
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality` +
      `?latitude=${lat}&longitude=${lon}&current=us_aqi,pm2_5`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const raw = await res.json() as { current?: { us_aqi?: number | null; pm2_5?: number | null } };
    if (!raw || typeof raw !== 'object') return null;
    const c = raw.current;
    if (!c) return null;
    const data: SiteAirQuality = {
      usAqi: typeof c.us_aqi === 'number' ? c.us_aqi : null,
      pm25: typeof c.pm2_5 === 'number' ? c.pm2_5 : null,
    };
    _aqCache.set(key, { data, ts: Date.now() });
    return data;
  } catch {
    return null;
  }
}

let _connCache: { data: ConnectivitySignal; ts: number } | null = null;
const CONN_TTL_MS = 5 * 60 * 1000;

/** Check Cloudflare + Fastly status pages and return a blended connectivity signal. */
export async function fetchConnectivitySignal(): Promise<ConnectivitySignal> {
  if (_connCache && Date.now() - _connCache.ts < CONN_TTL_MS) return _connCache.data;

  const [cf, fastly] = await Promise.allSettled([
    fetch('https://www.cloudflarestatus.com/api/v2/summary.json', { signal: AbortSignal.timeout(5000) })
      .then((r) => r.json() as Promise<{ status?: { indicator?: string } }>)
      .then((j) => j.status?.indicator === 'none'),
    fetch('https://www.fastlystatus.com/status.json', { signal: AbortSignal.timeout(5000) })
      .then((r) => r.json() as Promise<{ status?: { indicator?: string } }>)
      .then((j) => j.status?.indicator === 'none'),
  ]);

  const cfOk = cf.status === 'fulfilled' ? cf.value : null;
  const fastlyOk = fastly.status === 'fulfilled' ? fastly.value : null;

  let status: ConnectivitySignal['status'] = 'normal';
  if (cfOk === false || fastlyOk === false) status = 'degraded';
  if (cfOk === false && fastlyOk === false) status = 'outage';

  const data: ConnectivitySignal = { status, cloudflare: cfOk, fastly: fastlyOk };
  _connCache = { data, ts: Date.now() };
  return data;
}
