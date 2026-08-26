/**
 * OpenAQ v3 service — pure-deterministic parser + scorer.
 *
 * No DOM, no fetch at import time. The sidecar handles the network
 * round-trip; this module takes app-owned normalized JSON and produces
 * typed, sorted, JSON-serializable rows the renderer renders directly.
 *
 * The sidecar owns OpenAQ's external schema and emits normalized readings.
 * This module validates that app-owned contract and adds EPA AQI scoring.
 */

import { pm25ToAqi, categoryForAqi, type AqiCategory } from './purpleair-helpers';

// ─── Public types ─────────────────────────────────────────────────────

export type OpenaqParameter = 'pm25' | 'pm10' | 'o3' | 'no2' | 'so2' | 'co';

export interface MonitorReading {
  /** Stable id from the normalized provider boundary. */
  id: string;
  sensorId?: number;
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

export interface OpenaqNormalizedReadingRaw {
  id?: unknown;
  sensorId?: unknown;
  locationId?: unknown;
  station?: unknown;
  city?: unknown;
  country?: unknown;
  lat?: unknown;
  lon?: unknown;
  parameter?: unknown;
  value?: unknown;
  unit?: unknown;
  observedAt?: unknown;
}

export interface OpenaqSampleMetadata {
  windowStart: string;
  windowEnd: string;
  reportedFoundAtStart: number;
  plannedPages: number;
  fetchedPages: number;
  rawRows: number;
  uniqueSensorRows: number;
  acceptedRows: number;
  duplicateRows: number;
  invalidRows: number;
  rejectionReasons: Record<string, number>;
}

export type OpenaqEnvelopeResult =
  | { ok: true; readings: MonitorReading[]; sample: OpenaqSampleMetadata }
  | { ok: false; error: string };

const OPENAQ_REJECTION_REASONS = new Set([
  'invalidSensorId', 'invalidLocationId', 'invalidValue', 'invalidCoordinates',
  'invalidTimestamp', 'outsideWindow', 'equalTimestampConflict',
]);

export function parseOpenaqEnvelope(raw: unknown): OpenaqEnvelopeResult {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'invalid OpenAQ response' };
  const value = raw as Record<string, unknown>;
  if (value.schemaVersion !== 2 || value.provider !== 'openaq-v3'
    || value.coverage !== 'best_effort_sample' || value.complete !== false || !Array.isArray(value.readings)) {
    return { ok: false, error: 'invalid OpenAQ response' };
  }
  const sample = value.sample as Record<string, unknown> | null;
  const counters = ['reportedFoundAtStart', 'plannedPages', 'fetchedPages', 'rawRows', 'uniqueSensorRows', 'acceptedRows', 'duplicateRows', 'invalidRows'];
  if (!sample || typeof sample.windowStart !== 'string' || typeof sample.windowEnd !== 'string'
    || !Number.isFinite(Date.parse(sample.windowStart)) || !Number.isFinite(Date.parse(sample.windowEnd))
    || counters.some((key) => !Number.isSafeInteger(sample[key]) || (sample[key] as number) < 0)
    || sample.fetchedPages !== sample.plannedPages
    || sample.rawRows !== (sample.acceptedRows as number) + (sample.duplicateRows as number) + (sample.invalidRows as number)
    || !validRejectionReasons(sample.rejectionReasons, sample.rawRows as number)) {
    return { ok: false, error: 'invalid OpenAQ response' };
  }
  const readings = parseOpenaqReadings(value.readings as OpenaqNormalizedReadingRaw[]);
  if (readings.length !== value.readings.length || readings.length > (sample.acceptedRows as number)) {
    return { ok: false, error: 'invalid OpenAQ response' };
  }
  return { ok: true, readings, sample: sample as unknown as OpenaqSampleMetadata };
}

// ─── Parser ───────────────────────────────────────────────────────────

/** Validate the app-owned schema returned by the sidecar OpenAQ boundary. */
export function parseOpenaqReadings(rows: readonly OpenaqNormalizedReadingRaw[]): MonitorReading[] {
  const readings: MonitorReading[] = [];
  for (const row of rows) {
    const sensorId = positiveSafeInteger(row.sensorId);
    const locationId = positiveSafeInteger(row.locationId);
    const lat = coordinateOrNull(row.lat, -90, 90);
    const lon = coordinateOrNull(row.lon, -180, 180);
    const value = typeof row.value === 'number' && Number.isFinite(row.value) && row.value >= 0 ? row.value : null;
    const observedAt = typeof row.observedAt === 'number' && Number.isFinite(row.observedAt) && row.observedAt > 0
      ? row.observedAt
      : null;
    if (sensorId === null || locationId === null || lat === null || lon === null
      || value === null || observedAt === null || row.parameter !== 'pm25' || row.unit !== 'µg/m³') {
      continue;
    }
    const aqi = pm25ToAqi(value);
    if (aqi === null) continue;
    readings.push({
      id: `openaq:${sensorId}`,
      sensorId,
      locationId,
      station: stringOrEmpty(row.station) || `OpenAQ location ${locationId}`,
      city: stringOrNull(row.city),
      country: stringOrNull(row.country),
      lat,
      lon,
      parameter: 'pm25',
      value,
      unit: 'µg/m³',
      observedAt,
      aqi,
      category: categoryForAqi(aqi),
    });
  }
  return readings;
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

function validRejectionReasons(value: unknown, rawRows: number): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, count]) => (
    OPENAQ_REJECTION_REASONS.has(key)
    && Number.isSafeInteger(count)
    && (count as number) >= 0
    && (count as number) <= rawRows
  ));
}

function positiveSafeInteger(v: unknown): number | null {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null;
}

function coordinateOrNull(v: unknown, minimum: number, maximum: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= minimum && v <= maximum ? v : null;
}
