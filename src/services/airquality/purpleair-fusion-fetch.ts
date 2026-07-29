/**
 * Fail-closed PurpleAir nearby-sensor fetch — 4th air_quality fusion source,
 * keyed. The sidecar's v1 route returns `lastSeen` in raw Unix SECONDS (see
 * sidecarParseV1Sensors in local-api-server.mjs — its own public-JSON
 * fallback converts to ms, the v1 path currently does not), so this wrapper
 * does the ×1000 conversion itself to land observedAt in ms like every
 * other fusion source.
 */
import { getApiBaseUrl } from '@/services/runtime';
import type { PurpleairReading } from './airquality-fusion-observations';

interface PurpleAirSensorRaw {
  lat?: number;
  lon?: number;
  pm25?: number;
  lastSeen?: number | null;
}

export interface PurpleairFetchResult { ok: boolean; readings: PurpleairReading[] }

export async function fetchPurpleairNearby(): Promise<PurpleairFetchResult> {
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
    if (readings.length === 0) return { ok: false, readings: [] };
    return { ok: true, readings };
  } catch {
    return { ok: false, readings: [] };
  }
}
