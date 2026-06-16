import { getApiBaseUrl } from '@/services/runtime';
import { isFeatureAvailable } from '@/services/runtime-config';
import { dataFreshness } from '@/services/data-freshness';

export interface AirstrikeEvent {
  id: string;
  date: string;
  country: string;
  region: string;
  location: string;
  lat: number;
  lon: number;
  actor: string;
  targetActor: string;
  eventType: string;
  subEventType: string;
  fatalities: number;
  notes: string;
}

interface AcledRawEvent {
  event_id_cnty?: string;
  event_date?: string;
  country?: string;
  admin1?: string;
  location?: string;
  latitude?: string | number;
  longitude?: string | number;
  actor1?: string;
  actor2?: string;
  event_type?: string;
  sub_event_type?: string;
  fatalities?: string | number;
  notes?: string;
}

function asStr(v: string | undefined): string {
  return v ?? '';
}

function asNum(v: string | number | undefined): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number.parseFloat(v);
  return Number.NaN;
}

let _cache: { data: AirstrikeEvent[]; ts: number } | null = null;
const CACHE_TTL_MS = 15 * 60 * 1000;

export async function fetchAirstrikes(): Promise<AirstrikeEvent[]> {
  if (!isFeatureAvailable('acledAirstrikes')) return [];

  if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) return _cache.data;

  try {
 const url = `${getApiBaseUrl()}/api/acled-events`;
 const res = await fetch(url);
 if (!res.ok) return _cache?.data ?? [];
 const json = await res.json() as { events?: unknown[]; error?: string };
 if (!Array.isArray(json.events)) return _cache?.data ?? [];

 const events: AirstrikeEvent[] = (json.events as AcledRawEvent[]).map(e => ({
 id: asStr(e.event_id_cnty),
 date: asStr(e.event_date),
 country: asStr(e.country),
 region: asStr(e.admin1),
 location: asStr(e.location),
 lat: asNum(e.latitude),
 lon: asNum(e.longitude),
 actor: asStr(e.actor1),
 targetActor: asStr(e.actor2),
 eventType: asStr(e.event_type),
 subEventType: asStr(e.sub_event_type),
 fatalities: typeof e.fatalities === 'number' ? e.fatalities : Number.parseInt(asStr(e.fatalities as string | undefined), 10) || 0,
 notes: asStr(e.notes),
 })).filter(e => e.id && !Number.isNaN(e.lat) && !Number.isNaN(e.lon));

 _cache = { data: events, ts: Date.now() };
 dataFreshness.recordUpdate('acled_airstrikes', events.length);
 return events;
  } catch (error) {
 dataFreshness.recordError('acled_airstrikes', String(error));
 return _cache?.data ?? [];
  }
}

export function invalidateAirstrikesCache(): void {
  _cache = null;
}
