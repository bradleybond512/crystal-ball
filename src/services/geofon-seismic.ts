/**
 * GEOFON (GFZ Potsdam) seismic events via the sidecar proxy. Third
 * independence group for earthquake fusion beside USGS + EMSC.
 */
import { getApiBaseUrl } from '@/services/runtime';

export interface GeofonEvent {
  id: string;
  time: string;
  lat: number;
  lon: number;
  depthKm: number;
  magnitude: number;
  region: string;
}

export async function fetchGeofonSeismic(): Promise<GeofonEvent[]> {
  // 15s: comfortably above the sidecar's 12s upstream deadline so a slow
  // upstream fails in the sidecar (recorded properly) rather than racing here.
  const res = await fetch(`${getApiBaseUrl()}/api/geofon-seismic`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`geofon-seismic ${res.status}`);
  const data = (await res.json()) as { events?: GeofonEvent[]; degraded?: boolean; error?: string } | null;
  if (!data || data.degraded || data.error || !Array.isArray(data.events)) throw new Error(data?.error ?? 'geofon-seismic malformed');
  return data.events;
}
