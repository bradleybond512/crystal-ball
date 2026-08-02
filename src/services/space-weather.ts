// NOAA Space Weather Prediction Center — free, CORS-enabled, no API key required
// Docs: https://services.swpc.noaa.gov/
import { getApiBaseUrl } from '@/services/runtime';
import { dataFreshness } from '@/services/data-freshness';
import {
  parseAlerts,
  parseKpFeed,
  parseSolarWindFeed,
  parseXrayClass,
} from '@/services/space-weather-parse';

import type { SpaceWeatherAlert } from '@/services/space-weather-parse';

export type { SpaceWeatherAlert } from '@/services/space-weather-parse';

export interface SpaceWeatherData {
  kpIndex: number | null; // 0–9 planetary geomagnetic index
  kpClass: 'quiet' | 'unsettled' | 'active' | 'minor_storm' | 'moderate_storm' | 'severe_storm';
  solarWindSpeed: number | null; // km/s (typically 300–800)
  solarWindDensity: number | null;  // protons/cm³
  bz: number | null; // nT — southward Bz (<0) drives geomagnetic storms
  xrayClass: string | null; // 'A', 'B', 'C', 'M', 'X' + number
  /**
   * When the solar-wind row was measured, or null when the payload carried no
   * parseable timestamp. `fetchedAt` says when WE asked, which is not the same
   * thing — without this, telemetry of unknown age is indistinguishable from
   * current data.
   */
  windObservedAt: string | null;
  alertMessages: SpaceWeatherAlert[];
  fetchedAt: Date;
  donkiEvents: DonkiEvent[];
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
// A result missing one or more products is held only briefly. The sidecar
// deliberately gives a partial envelope a 60 s TTL; caching it here for the
// full five minutes would override that and pin the hole anyway.
const PARTIAL_CACHE_TTL_MS = 60 * 1000;
let cache: { data: SpaceWeatherData; fetchedAt: number; ttlMs: number } | null = null;

function kpClass(kp: number): SpaceWeatherData['kpClass'] {
  if (kp >= 7) return 'severe_storm';
  if (kp >= 6) return 'moderate_storm';
  if (kp >= 5) return 'minor_storm';
  if (kp >= 4) return 'active';
  if (kp >= 3) return 'unsettled';
  return 'quiet';
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
 const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
 if (!res.ok) return null;
 return (await res.json()) as T;
  } catch {
 return null;
  }
}

/** Shape of `/api/space-weather-feeds` — ONE object keyed by SWPC product. */
interface SpaceWeatherFeeds {
  kp?: unknown;
  wind?: unknown;
  xray?: unknown;
  alerts?: unknown;
}

export async function fetchSpaceWeather(): Promise<SpaceWeatherData> {
  if (cache && Date.now() - cache.fetchedAt < cache.ttlMs) {
    return cache.data;
  }

  // The route fans out to every SWPC product and returns them in a single
  // object. This used to issue five identical requests and gate each parse on
  // Array.isArray of that object, so every field stayed null.
  const feeds = await fetchJson<SpaceWeatherFeeds>(`${getApiBaseUrl()}/api/space-weather-feeds`);

  const now = Date.now();
  const kpIndex = parseKpFeed(feeds?.kp);
  const wind = parseSolarWindFeed(feeds?.wind);
  const xrayClass = parseXrayClass(feeds?.xray);
  const alertMessages = parseAlerts(feeds?.alerts, now);

  const data: SpaceWeatherData = {
    kpIndex,
    kpClass: kpIndex === null ? 'quiet' : kpClass(kpIndex),
    solarWindSpeed: wind.speed,
    solarWindDensity: wind.density,
    bz: wind.bz,
    xrayClass,
    windObservedAt: wind.observedAt,
    alertMessages,
    donkiEvents: [],
    fetchedAt: new Date(),
  };

  // Health is derived from what the PARSERS produced, not from the fetch
  // resolving. A 200 that yields nothing usable is a failure — reporting it as
  // a healthy update is the fail-open "phantom healthy vote" that let this
  // panel sit empty without ever flagging a problem.
  const parsedCount = alertMessages.length
    + [kpIndex, wind.speed, wind.density, wind.bz, xrayClass].filter((v) => v !== null).length;
  if (parsedCount === 0) {
    dataFreshness.recordError('space-weather', feeds ? 'no usable fields in SWPC payload' : 'space-weather-feeds fetch failed');
    // An empty result is a failure, not an empty success — leaving it uncached
    // means the next poll retries instead of pinning the panel blank for 5 min.
    return data;
  }
  dataFreshness.recordUpdate('space-weather', parsedCount);
  // Alerts are excluded from the completeness test on purpose: an empty alert
  // list is a legitimate quiet sky, not a missing product. The three
  // measurement products are not — each one has a current value at all times,
  // so a null there means we failed to get it.
  const complete = kpIndex !== null && xrayClass !== null
    && wind.speed !== null && wind.density !== null && wind.bz !== null;
  cache = { data, fetchedAt: now, ttlMs: complete ? CACHE_TTL_MS : PARTIAL_CACHE_TTL_MS };
  return data;
}

export interface DonkiEvent {
  id: string;
  type: 'flare' | 'cme' | 'geomagnetic-storm';
  startTime: string | null;
  peakTime: string | null;
  endTime: string | null;
  classType: string | null;
  kpIndex: number | null;
  estimatedArrival: string | null;
  severity: 'critical' | 'high' | 'medium' | 'low';
  url: string;
}

let donkiCache: { events: DonkiEvent[]; ts: number } | null = null;
const DONKI_CACHE_TTL_MS = 30 * 60 * 1000;

export async function fetchDonkiEvents(): Promise<DonkiEvent[]> {
  if (donkiCache && Date.now() - donkiCache.ts < DONKI_CACHE_TTL_MS) return donkiCache.events;
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/donki-events`, { signal: AbortSignal.timeout(15_000) });
 if (!res.ok) {
 donkiCache = { events: [], ts: Date.now() };
 return [];
 }
 const events = (await res.json()) as DonkiEvent[];
 donkiCache = { events, ts: Date.now() };
 return events;
  } catch {
 donkiCache = { events: [], ts: Date.now() };
 return [];
  }
}
