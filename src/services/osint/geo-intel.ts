import { getApiBaseUrl } from '@/services/runtime';
import { isFeatureAvailable } from '@/services/runtime-config';

export interface AcledEvent {
  event_type: string;
  actor1: string;
  fatalities: number;
  event_date: string;
  latitude: number;
  longitude: number;
  country: string;
  source: string;
  notes: string;
}

export interface AdsbMilitaryFlight {
  icao24: string;
  callsign: string;
  longitude: number;
  latitude: number;
  baro_altitude: number | null;
  velocity: number | null;
  squawk: string;
}

export async function fetchAcledEvents(): Promise<AcledEvent[]> {
  if (!isFeatureAvailable('acledConflicts')) return [];
  try {
 const r = await fetch(`${getApiBaseUrl()}/api/acled-events`);
 if (!r.ok) return [];
 const data = await r.json() as unknown;
 // Existing route returns { events: [...] }
 const events = (data as { events?: unknown[] }).events ?? (Array.isArray(data) ? data : []);
 return (events as AcledEvent[]);
  } catch { return []; }
}

export async function fetchAdsbMilitary(): Promise<AdsbMilitaryFlight[]> {
  try {
 const r = await fetch(`${getApiBaseUrl()}/api/adsb-military`);
 if (!r.ok) return [];
 const data = await r.json() as unknown;
 if (!Array.isArray(data)) return [];
 return data as AdsbMilitaryFlight[];
  } catch { return []; }
}
