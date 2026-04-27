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

const EMERGENCY_SQUAWKS = new Set(['7500', '7600', '7700']);
const NOTABLE_CALLSIGN_PREFIXES = ['AF1', 'SAM', 'EXEC', 'VIP', 'RCH', 'REACH'];
const NOTABLE_ALT_METERS = 12_192;

/** Aircraft entry as returned by /api/adsb-aggregate. */
interface AggregateAircraft {
  icao: string;
  callsign: string | null;
  originCountry?: string | null;
  lat: number;
  lon: number;
  alt: number | null;
  speed: number | null;
  track: number | null;
  vsi: number | null;
  squawk: string | null;
  type?: string | null;
  military?: boolean | null;
  ts: number;
  sources: string[];
}

interface AggregateResponse {
  aircraft: AggregateAircraft[];
  sources: Record<string, { ok: boolean; count: number; ms: number; error?: string }>;
  fetchedAt: number;
}

/** Convert aggregator-format aircraft (ft/kt) to AdsbFlight (m/s/m). */
function unifiedToFlight(a: AggregateAircraft): AdsbFlight {
  return {
 icao24: a.icao,
 callsign: a.callsign,
 originCountry: a.originCountry ?? 'Unknown',
 lat: a.lat, lon: a.lon,
 altitude: a.alt == null ? null : Math.round(a.alt * 0.3048),
 onGround: false,
 velocity: a.speed == null ? null : Math.round(a.speed * 0.514_444),
 heading: a.track,
 verticalRate: a.vsi == null ? null : Math.round(a.vsi * 0.005_08 * 100) / 100,
 squawk: a.squawk,
  };
}

const breaker = createCircuitBreaker<AdsbSnapshot>({
  name: 'ADS-B',
  maxFailures: 3,
  cooldownMs: 5 * 60 * 1000,
});

let _cache: { snapshot: AdsbSnapshot; ts: number } | null = null;
const CLIENT_CACHE_TTL = 60 * 1000;

export interface AdsbViewport {
  lat: number;
  lon: number;
  zoom: number;
}

/** Conservative viewport→radius ladder so community feeds aren't slammed
 *  with 5000-NM-radius queries at mid-zoom. Below zoom 4, returns null
 *  (use OpenSky-only global mode). */
function radiusForZoom(zoom: number): number | null {
  if (zoom < 4) return null;
  if (zoom < 6) return 1000;
  if (zoom < 8) return 500;
  if (zoom < 10) return 200;
  return 100;
}

export async function fetchAdsbSnapshot(viewport?: AdsbViewport): Promise<AdsbSnapshot> {
  const now = Date.now();
  if (_cache && now - _cache.ts < CLIENT_CACHE_TTL) return _cache.snapshot;

  return breaker.execute(async () => {
 const radius = viewport ? radiusForZoom(viewport.zoom) : null;
 const url = (viewport && radius != null)
 ? `${getApiBaseUrl()}/api/adsb-aggregate?lat=${viewport.lat.toFixed(4)}&lon=${viewport.lon.toFixed(4)}&dist=${radius}`
 : `${getApiBaseUrl()}/api/adsb-aggregate`;
 const res = await fetch(url);
 if (res.status === 429) {
 return { flights: [], fetchedAt: Date.now(), totalCount: 0, rateLimited: true };
 }
 if (!res.ok) throw new Error(`HTTP ${res.status}`);
 const data = await res.json() as AggregateResponse;
 const flights = (data.aircraft ?? []).map((a) => unifiedToFlight(a));
 const snapshot: AdsbSnapshot = {
 flights, fetchedAt: now,
 totalCount: flights.length,
 rateLimited: false,
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
  const topCountries = [...countryCounts.entries()]
 .sort((a, b) => b[1] - a[1]).slice(0, 5)
 .map(([country, count]) => ({ country, count }));
  return { topCountries, notableFlights };
}
