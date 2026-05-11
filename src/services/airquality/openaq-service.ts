/**
 * OpenAQ v3 service — pure-deterministic parser + scorer.
 *
 * No DOM, no fetch at import time. The sidecar handles the network
 * round-trip; this module takes upstream-shaped JSON and produces
 * typed, sorted, JSON-serializable rows the renderer renders directly.
 *
 * The OpenAQ v3 API returns nested "locations" (each with multiple
 * "sensors") plus "latest" arrays keyed by parameter id. We flatten
 * those into one row per (location, parameter) and project the latest
 * measurement into a `MonitorReading` shape that pairs with our shared
 * EPA AQI ladder from purpleair-helpers.
 */

import { pm25ToAqi, categoryForAqi, type AqiCategory } from './purpleair-helpers';

// ─── Public types ─────────────────────────────────────────────────────

export type OpenaqParameter = 'pm25' | 'pm10' | 'o3' | 'no2' | 'so2' | 'co';

export interface MonitorReading {
  /** Stable id: `${locationId}:${parameter}` */
  id: string;
  locationId: number;
  station: string;
  city: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
  parameter: OpenaqParameter;
  value: number;
  unit: string;
  /** ms epoch of the latest reading. */
  observedAt: number | null;
  /** EPA AQI estimate when the parameter is PM2.5; null otherwise. */
  aqi: number | null;
  category: AqiCategory | null;
}

export interface NearbySummary {
  readings: MonitorReading[];
  /** Highest-AQI station in the result. */
  worst: MonitorReading | null;
  /** Number of stations whose AQI is in `sensitive` or above. */
  unhealthyCount: number;
}

// ─── Upstream shapes (defensive subset) ───────────────────────────────

export interface OpenaqLocationRaw {
  id?: unknown;
  name?: unknown;
  locality?: unknown;
  city?: unknown;
  country?: unknown;
  coordinates?: unknown;
  /** v3 returns `sensors[]` with embedded `parameter` + `latest`. */
  sensors?: unknown;
  /** Some v3 endpoints return latest measurements as a flat array. */
  latest?: unknown;
}

export interface OpenaqSensorRaw {
  parameter?: unknown;
  /** v3 `latest` shape: { value, datetime: { utc }, unit }. */
  latest?: unknown;
}

// ─── Parameter mapping ────────────────────────────────────────────────

const PARAM_ALIASES: Record<string, OpenaqParameter> = {
  pm25: 'pm25',
  'pm2.5': 'pm25',
  'pm 2.5': 'pm25',
  pm10: 'pm10',
  o3: 'o3',
  ozone: 'o3',
  no2: 'no2',
  so2: 'so2',
  co: 'co',
};

export function normalizeParameter(raw: unknown): OpenaqParameter | null {
  if (typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase();
  return PARAM_ALIASES[key] ?? null;
}

// ─── Parser ───────────────────────────────────────────────────────────

/**
 * Walk an array of OpenAQ v3 location objects and emit one row per
 * supported (location, parameter) pair. Locations missing coordinates
 * or sensors are skipped silently; readings with non-finite values are
 * skipped.
 */
export function parseOpenaqLocations(locations: readonly OpenaqLocationRaw[]): MonitorReading[] {
  const out: MonitorReading[] = [];
  for (const loc of locations) {
    const locationId = numOrNull(loc.id);
    if (locationId === null) continue;
    const station = stringOrEmpty(loc.name) || 'Unknown station';
    const city = stringOrNull(loc.city ?? loc.locality);
    const country = stringOrNull(loc.country);
    const coords = (loc.coordinates && typeof loc.coordinates === 'object') ? loc.coordinates as Record<string, unknown> : null;
    const lat = numOrNull(coords?.latitude);
    const lon = numOrNull(coords?.longitude);
    const sensors = Array.isArray(loc.sensors) ? (loc.sensors as OpenaqSensorRaw[]) : [];
    for (const sensor of sensors) {
      const reading = projectSensorToReading(sensor, { locationId, station, city, country, lat, lon });
      if (reading) out.push(reading);
    }
  }
  return out;
}

interface LocationContext {
  locationId: number;
  station: string;
  city: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
}

function projectSensorToReading(sensor: OpenaqSensorRaw, ctx: LocationContext): MonitorReading | null {
  const paramRaw = (sensor.parameter && typeof sensor.parameter === 'object')
    ? (sensor.parameter as Record<string, unknown>).name
    : sensor.parameter;
  const parameter = normalizeParameter(paramRaw);
  if (!parameter) return null;
  const latest = (sensor.latest && typeof sensor.latest === 'object')
    ? sensor.latest as Record<string, unknown>
    : null;
  if (!latest) return null;
  const value = numOrNull(latest.value);
  if (value === null) return null;
  const datetime = (latest.datetime && typeof latest.datetime === 'object')
    ? latest.datetime as Record<string, unknown>
    : null;
  const observedAt = parseTimestamp(datetime?.utc ?? latest.datetime);
  const unit = stringOrEmpty(latest.unit) || defaultUnitFor(parameter);
  const aqi = parameter === 'pm25' ? pm25ToAqi(value) : null;
  const category = aqi === null ? null : categoryForAqi(aqi);
  return {
    id: `${ctx.locationId}:${parameter}`,
    locationId: ctx.locationId,
    station: ctx.station,
    city: ctx.city,
    country: ctx.country,
    lat: ctx.lat,
    lon: ctx.lon,
    parameter,
    value,
    unit,
    observedAt,
    aqi,
    category,
  };
}

function defaultUnitFor(p: OpenaqParameter): string {
  return p === 'pm25' || p === 'pm10' ? 'µg/m³' : 'ppm';
}

// ─── Ranking + summaries ──────────────────────────────────────────────

/**
 * Sort readings worst → best:
 *   1. PM2.5 AQI desc (when present)
 *   2. PM10 / other-pollutant value desc as a tie-breaker
 *   3. Most recent observation first
 *
 * Stale (>6h) readings sink to the bottom regardless of value so we
 * don't accidentally surface "worst air right now" from a sensor that
 * last reported yesterday.
 */
export const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export function rankReadings(readings: readonly MonitorReading[], now: number): MonitorReading[] {
  return [...readings].sort((a, b) => {
    const staleA = isStale(a, now);
    const staleB = isStale(b, now);
    if (staleA !== staleB) return staleA ? 1 : -1;
    const aqiA = a.aqi ?? -1;
    const aqiB = b.aqi ?? -1;
    if (aqiA !== aqiB) return aqiB - aqiA;
    if (a.value !== b.value) return b.value - a.value;
    return (b.observedAt ?? 0) - (a.observedAt ?? 0);
  });
}

function isStale(r: MonitorReading, now: number): boolean {
  if (r.observedAt === null) return true;
  return now - r.observedAt > STALE_AFTER_MS;
}

export function summarizeNearby(readings: readonly MonitorReading[], now: number): NearbySummary {
  const ranked = rankReadings(readings, now);
  const worst = ranked.find((r) => !isStale(r, now)) ?? ranked[0] ?? null;
  const unhealthyCount = ranked.filter((r) => {
    if (r.category === null) return false;
    return r.category === 'sensitive' || r.category === 'unhealthy' || r.category === 'very_unhealthy' || r.category === 'hazardous';
  }).length;
  return { readings: ranked, worst, unhealthyCount };
}

/** Top-N globally-worst readings (rank then slice). */
export function pickGlobalWorst(readings: readonly MonitorReading[], now: number, topN = 20): MonitorReading[] {
  return rankReadings(readings, now)
    .filter((r) => !isStale(r, now) && r.aqi !== null)
    .slice(0, Math.max(1, topN));
}

// ─── Helpers ──────────────────────────────────────────────────────────

function stringOrEmpty(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function stringOrNull(v: unknown): string | null {
  if (typeof v === 'string') {
    const s = v.trim();
    return s || null;
  }
  return null;
}

function numOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseTimestamp(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}
