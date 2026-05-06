import { getApiBaseUrl } from '@/services/runtime';
import type { NWSAlert } from '@/services/nws-alerts';
import type { GDACSEvent } from '@/services/gdacs';
import { dataFreshness } from '@/services/data-freshness';
import type { FlightRule, MetarData } from '@/services/webcams/metar-types';

export interface FAACamera {
  id: string;
  name: string;
  lat: number;
  lon: number;
  state: string;
  category: string;
  imageUrl: string;
  isOnline: boolean;
  lastUpdated: string;
  nearestMetarStation?: string | null;
  currentMetar?: MetarData | null;
  flightRule?: FlightRule | null;
  adsbCount?: number;
}

export interface ScoredFAACamera extends FAACamera {
  alertProximityMi: number | null;
  alertLabel: string | null;
  relevanceScore: number;
  aiConditions: string | null;
}

const CACHE_TTL_MS = 15 * 60 * 1000;
let cache: { data: FAACamera[]; ts: number } | null = null;

/** Defensive parse — accepts a raw FAACamera[] or any of the
 *  documented envelope shapes ({cameras|items|data: [...]}). Falls
 *  back to [] for unknown / degraded payloads. The smoke harness's
 *  default mock returns `{ ok: true, items: [], data: [] }` which
 *  used to cast straight to FAACamera[] and crash downstream. */
export function parseFAACamerasResponse(payload: unknown): FAACamera[] {
  if (Array.isArray(payload)) return payload as FAACamera[];
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    for (const key of ['cameras', 'items', 'data']) {
      const v = obj[key];
      if (Array.isArray(v)) return v as FAACamera[];
    }
  }
  return [];
}

export async function fetchFAACameras(): Promise<FAACamera[]> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.data;
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/faa-cameras?withMetar=1`, {
 signal: AbortSignal.timeout(20_000),
 });
 if (!res.ok) {
 dataFreshness.recordError('faa-cameras', `HTTP ${res.status}`);
 return cache?.data ?? [];
 }
 const data = parseFAACamerasResponse(await res.json());
 cache = { data, ts: Date.now() };
 dataFreshness.recordUpdate('faa-cameras', data.length);
 return data;
  } catch (error) {
 dataFreshness.recordError('faa-cameras', String(error));
 return cache?.data ?? [];
  }
}

function haversineMi(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
 Math.sin(dLat / 2) ** 2 +
 Math.cos((lat1 * Math.PI) / 180) *
 Math.cos((lat2 * Math.PI) / 180) *
 Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeScore(
  cam: FAACamera,
  closestMi: number | null,
): number {
  let score = 0;
  if (closestMi !== null && closestMi < 50) score += 40;
  else if (closestMi !== null && closestMi < 150) score += 20;
  if (cam.category === 'remote') score += 20;
  if (cam.isOnline) score += 10;
  const ageMs = Date.now() - new Date(cam.lastUpdated).getTime();
  if (ageMs < 20 * 60 * 1000) score += 10;
  return score;
}

export function scoreCamerasAgainstAlerts(
  cameras: FAACamera[],
  nwsAlerts: NWSAlert[],
  gdacsEvents: GDACSEvent[],
  radiusMi = 150,
): ScoredFAACamera[] {
  // Defensive — callers can deserialize an arbitrary JSON shape into
  // these slots. Coerce to [] rather than crashing on .map / for-of.
  const camArr: FAACamera[] = Array.isArray(cameras) ? cameras : [];
  const alertArr: NWSAlert[] = Array.isArray(nwsAlerts) ? nwsAlerts : [];
  const gdacsArr: GDACSEvent[] = Array.isArray(gdacsEvents) ? gdacsEvents : [];
  return camArr.map(cam => {
 let closestMi: number | null = null;
 let alertLabel: string | null = null;

 for (const alert of alertArr) {
 if (!alert.centroid) continue;
 const mi = haversineMi(cam.lat, cam.lon, alert.centroid[1], alert.centroid[0]);
 if (mi < radiusMi && (closestMi === null || mi < closestMi)) {
 closestMi = mi;
 alertLabel = `NWS ${alert.event}`;
 }
 }

 for (const event of gdacsArr) {
 if (event.alertLevel === 'Green') continue;
 const mi = haversineMi(cam.lat, cam.lon, event.coordinates[1], event.coordinates[0]);
 if (mi < radiusMi && (closestMi === null || mi < closestMi)) {
 closestMi = mi;
 alertLabel = `GDACS ${event.eventType} — ${event.name}`;
 }
 }

 return {
 ...cam,
 alertProximityMi: closestMi,
 alertLabel,
 relevanceScore: computeScore(cam, closestMi),
 aiConditions: null,
 };
  }).sort((a, b) => b.relevanceScore - a.relevanceScore);
}

export function getDisasterProximateCameras(
  cameras: FAACamera[],
  nwsAlerts: NWSAlert[],
  gdacsEvents: GDACSEvent[],
): ScoredFAACamera[] {
  const severeNws = nwsAlerts.filter(a => a.severity === 'Extreme' || a.severity === 'Severe');
  const severeGdacs = gdacsEvents.filter(e => e.alertLevel === 'Orange' || e.alertLevel === 'Red');
  const scored = scoreCamerasAgainstAlerts(cameras, severeNws, severeGdacs, 200);
  return scored.filter(c => c.alertProximityMi !== null);
}
