/* eslint-disable @typescript-eslint/no-base-to-string, unicorn/prefer-spread -- pre-existing */
import { createCircuitBreaker } from '@/utils';
import { dataFreshness } from './data-freshness';
import { getApiBaseUrl } from './runtime';

export interface AdsbFlight {
  icao24: string;
  callsign: string | null;
  originCountry: string;
  lon: number;
  lat: number;
  altitude: number | null;
  onGround: boolean;
  velocity: number | null;
  heading: number | null;
  verticalRate: number | null;
  squawk: string | null;
}

export interface AdsbSnapshot {
  flights: AdsbFlight[];
  fetchedAt: number;
  totalCount: number;
  rateLimited: boolean;
}

export interface AdsbStats {
  topCountries: { country: string; count: number }[];
  notableFlights: AdsbFlight[];
}

const IDX = {
  ICAO24: 0, CALLSIGN: 1, ORIGIN_COUNTRY: 2, TIME_POS: 3, LAST_CONTACT: 4,
  LON: 5, LAT: 6, BARO_ALT: 7, ON_GROUND: 8, VELOCITY: 9,
  TRUE_TRACK: 10, VERT_RATE: 11, SENSORS: 12, GEO_ALT: 13,
  SQUAWK: 14, SPI: 15, POS_SOURCE: 16,
} as const;

const EMERGENCY_SQUAWKS = new Set(['7500', '7600', '7700']);
const NOTABLE_CALLSIGN_PREFIXES = ['AF1', 'SAM', 'EXEC', 'VIP', 'RCH', 'REACH'];
const NOTABLE_ALT_METERS = 12_192;

const breaker = createCircuitBreaker<AdsbSnapshot>({
  name: 'ADS-B',
  maxFailures: 3,
  cooldownMs: 5 * 60 * 1000,
});

let _cache: { snapshot: AdsbSnapshot; ts: number } | null = null;
const CLIENT_CACHE_TTL = 60 * 1000;

function parseStates(states: unknown[][]): AdsbFlight[] {
  const flights: AdsbFlight[] = [];
  for (const s of states) {
 const lon = s[IDX.LON] as number | null;
 const lat = s[IDX.LAT] as number | null;
 if (lon == null || lat == null) continue;
 if (s[IDX.ON_GROUND] === true) continue;
 flights.push({
 icao24: String(s[IDX.ICAO24] ?? ''),
 callsign: s[IDX.CALLSIGN] ? String(s[IDX.CALLSIGN]).trim() || null : null,
 originCountry: String(s[IDX.ORIGIN_COUNTRY] ?? 'Unknown'),
 lon, lat,
 altitude: (s[IDX.BARO_ALT] as number | null) ?? null,
 onGround: false,
 velocity: (s[IDX.VELOCITY] as number | null) ?? null,
 heading: (s[IDX.TRUE_TRACK] as number | null) ?? null,
 verticalRate: (s[IDX.VERT_RATE] as number | null) ?? null,
 squawk: s[IDX.SQUAWK] ? String(s[IDX.SQUAWK]) : null,
 });
  }
  return flights;
}

export async function fetchAdsbSnapshot(): Promise<AdsbSnapshot> {
  const now = Date.now();
  if (_cache && now - _cache.ts < CLIENT_CACHE_TTL) return _cache.snapshot;

  return breaker.execute(async () => {
 const res = await fetch(`${getApiBaseUrl()}/api/adsb`);
 if (res.status === 429) {
 return { flights: [], fetchedAt: Date.now(), totalCount: 0, rateLimited: true };
 }
 if (!res.ok) throw new Error(`HTTP ${res.status}`);
 const data = await res.json() as { states: unknown[][] | null; time: number; rateLimited?: boolean };
 if (!data || typeof data !== 'object') return { flights: [], fetchedAt: Date.now(), totalCount: 0, rateLimited: false };
 const states = data.states ?? [];
 const flights = parseStates(states);
 const snapshot: AdsbSnapshot = {
 flights, fetchedAt: now,
 totalCount: states.length,
 rateLimited: data.rateLimited ?? false,
 };
 _cache = { snapshot, ts: now };
 dataFreshness.recordUpdate('adsb', snapshot.flights.length);
 return snapshot;
  }, _cache?.snapshot ?? { flights: [], fetchedAt: 0, totalCount: 0, rateLimited: false });
}

export function getAdsbStats(snapshot: AdsbSnapshot): AdsbStats {
  const countryCounts = new Map<string, number>();
  const notableFlights: AdsbFlight[] = [];
  for (const f of snapshot.flights) {
 countryCounts.set(f.originCountry, (countryCounts.get(f.originCountry) ?? 0) + 1);
 const isEmergency = f.squawk !== null && EMERGENCY_SQUAWKS.has(f.squawk);
 const isHighAlt = f.altitude !== null && f.altitude > NOTABLE_ALT_METERS;
 const callsignUpper = (f.callsign ?? '').toUpperCase();
 const isNotableCallsign = NOTABLE_CALLSIGN_PREFIXES.some(p => callsignUpper.startsWith(p));
 if ((isEmergency || isHighAlt || isNotableCallsign) && notableFlights.length < 8) {
 notableFlights.push(f);
 }
  }
  const topCountries = Array.from(countryCounts.entries())
 .sort((a, b) => b[1] - a[1]).slice(0, 5)
 .map(([country, count]) => ({ country, count }));
  return { topCountries, notableFlights };
}
