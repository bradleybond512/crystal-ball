/**
 * Fail-closed PurpleAir nearby-sensor fetch — 4th air_quality fusion source,
 * keyed. `lastSeen` arrives from the sidecar in epoch ms (sidecarParseV1Sensors
 * converts v1's unix-seconds `last_seen` at the source) and lands directly in
 * `observedAt`.
 *
 * The request carries a PurpleAir-native nwlng/nwlat/selng/selat bounding box
 * around the caller's reference coordinate, so the upstream fetch, transfer,
 * and parse stay bounded instead of covering all 20-30k global outdoor
 * sensors. The pure radius filter (default 100km, 4x the domain's 25km fusion
 * match window) remains as the precise gate — the bbox corners reach ~√2 ×
 * radius from the center, and pole/antimeridian clamping can narrow the box.
 */
import { getApiBaseUrl } from '@/services/runtime';
import { bboxAround, filterReadingsNearby, type PurpleairReading } from './airquality-fusion-observations';
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
  const observedAt = Number.isFinite(s.lastSeen) && (s.lastSeen as number) > 0 ? (s.lastSeen as number) : now;
  return { lat: s.lat as number, lon: s.lon as number, pm25: s.pm25 as number, observedAt };
}

export async function fetchPurpleairNearby(lat: number, lon: number, radiusKm = 100): Promise<PurpleairFetchResult> {
  try {
    const box = bboxAround(lat, lon, radiusKm);
    const params = new URLSearchParams({
      nwlng: String(box.nwLng),
      nwlat: String(box.nwLat),
      selng: String(box.seLng),
      selat: String(box.seLat),
    });
    const res = await fetch(`${getApiBaseUrl()}/api/airquality/purpleair?${params}`, { signal: AbortSignal.timeout(20_000) });
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
