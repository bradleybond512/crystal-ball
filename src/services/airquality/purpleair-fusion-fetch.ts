/**
 * Fail-closed PurpleAir nearby-sensor fetch — 4th air_quality fusion source,
 * keyed. The sidecar's v1 route returns `lastSeen` in raw Unix SECONDS (see
 * sidecarParseV1Sensors in local-api-server.mjs — its own public-JSON
 * fallback converts to ms, the v1 path currently does not), so this wrapper
 * does the ×1000 conversion itself to land observedAt in ms like every
 * other fusion source.
 *
 * The route itself returns every outdoor sensor globally (20-30k+, unfiltered
 * — the sidecar accepts no bbox/location params), so this wrapper applies a
 * pure radius filter (default 100km, 4x the domain's 25km fusion match
 * window) around the caller's reference coordinate before handing readings
 * to the caller. Without this, fusion-ingest's per-observation linear
 * cluster scan would run against tens of thousands of irrelevant global
 * sensors on every tick.
 */
import { getApiBaseUrl } from '@/services/runtime';
import { filterReadingsNearby, type PurpleairReading } from './airquality-fusion-observations';
import { MIN_CONFIDENCE } from './purpleair-helpers';

interface PurpleAirSensorRaw {
  lat?: number;
  lon?: number;
  pm25?: number;
  lastSeen?: number | null;
  confidence?: number;
}

export interface PurpleairFetchResult { ok: boolean; readings: PurpleairReading[] }

/**
 * Validate + normalize one raw sensor row into a PurpleairReading, or null
 * to drop it. Split out of fetchPurpleairNearby's loop to keep the caller's
 * cognitive complexity down.
 */
function toPurpleairReading(s: PurpleAirSensorRaw | null | undefined, now: number): PurpleairReading | null {
  if (!s || !Number.isFinite(s.lat) || !Number.isFinite(s.lon) || !Number.isFinite(s.pm25)) return null;
  if ((s.pm25 as number) < 0) return null;
  // A/B-channel disagreement shows up as a low confidence score — that's a
  // failing sensor, not a legitimate reading, and fusion is exactly where a
  // garbage vote turns into a false disagreement flag. Mirrors
  // purpleair-helpers.filterUsable's own confidence gate.
  if (!Number.isFinite(s.confidence) || (s.confidence as number) <= MIN_CONFIDENCE) return null;
  let observedAt = Number.isFinite(s.lastSeen) && (s.lastSeen as number) > 0 ? (s.lastSeen as number) * 1000 : now;
  // Plausibility guard: if seconds->ms conversion lands more than a day in
  // the future, the sidecar's lastSeen was probably already in ms (e.g. if
  // the parser at the source gets fixed) — use it as-is instead of producing
  // a millennia-future timestamp.
  if (observedAt > now + 24 * 60 * 60 * 1000) observedAt = s.lastSeen as number;
  return { lat: s.lat as number, lon: s.lon as number, pm25: s.pm25 as number, observedAt };
}

export async function fetchPurpleairNearby(lat: number, lon: number, radiusKm = 100): Promise<PurpleairFetchResult> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/airquality/purpleair`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return { ok: false, readings: [] };
    const data = (await res.json()) as { sensors?: PurpleAirSensorRaw[]; keyMissing?: boolean; error?: string } | null;
    if (!data || data.keyMissing || data.error || !Array.isArray(data.sensors)) return { ok: false, readings: [] };
    const now = Date.now();
    const readings: PurpleairReading[] = [];
    for (const s of data.sensors) {
      const reading = toPurpleairReading(s, now);
      if (reading) readings.push(reading);
    }
    const nearby = filterReadingsNearby(readings, lat, lon, radiusKm);
    if (nearby.length === 0) return { ok: false, readings: [] };
    return { ok: true, readings: nearby };
  } catch {
    return { ok: false, readings: [] };
  }
}
