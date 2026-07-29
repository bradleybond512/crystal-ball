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

interface PurpleAirSensorRaw {
  lat?: number;
  lon?: number;
  pm25?: number;
  lastSeen?: number | null;
}

export interface PurpleairFetchResult { ok: boolean; readings: PurpleairReading[] }

export async function fetchPurpleairNearby(lat: number, lon: number, radiusKm = 100): Promise<PurpleairFetchResult> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/airquality/purpleair`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return { ok: false, readings: [] };
    const data = (await res.json()) as { sensors?: PurpleAirSensorRaw[]; keyMissing?: boolean; error?: string } | null;
    if (!data || data.keyMissing || data.error || !Array.isArray(data.sensors)) return { ok: false, readings: [] };
    const now = Date.now();
    const readings: PurpleairReading[] = [];
    for (const s of data.sensors) {
      if (!s || !Number.isFinite(s.lat) || !Number.isFinite(s.lon) || !Number.isFinite(s.pm25)) continue;
      if ((s.pm25 as number) < 0) continue;
      const observedAt = Number.isFinite(s.lastSeen) && (s.lastSeen as number) > 0 ? (s.lastSeen as number) * 1000 : now;
      readings.push({ lat: s.lat as number, lon: s.lon as number, pm25: s.pm25 as number, observedAt });
    }
    const nearby = filterReadingsNearby(readings, lat, lon, radiusKm);
    if (nearby.length === 0) return { ok: false, readings: [] };
    return { ok: true, readings: nearby };
  } catch {
    return { ok: false, readings: [] };
  }
}
