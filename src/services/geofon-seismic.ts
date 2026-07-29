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
  const res = await fetch(`${getApiBaseUrl()}/api/geofon-seismic`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`geofon-seismic ${res.status}`);
  const data = (await res.json()) as { events?: GeofonEvent[]; error?: string } | null;
  if (!data || data.error || !Array.isArray(data.events)) throw new Error(data?.error ?? 'geofon-seismic malformed');
  return data.events;
}
