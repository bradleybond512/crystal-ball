/**
 * Cached Theater Posture Service
 * Fetches pre-computed theater posture summaries from backend via sebuf RPC.
 * Shares calculation across all users via Redis cache.
 * Persists to localStorage so data shows instantly on reload.
 */

import { createAbortError, withCallerAbort } from './caller-abort';
import type { TheaterPostureSummary } from './military-surge';
import {
  MilitaryServiceClient,
  type GetTheaterPostureResponse,
  type TheaterPosture,
} from '@/generated/client/crystalball/military/v1/service_client';

// ---- Sebuf client ----

const client = new MilitaryServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

// ---- Legacy interface (preserved for consumer compatibility) ----

export interface CachedTheaterPosture {
  postures: TheaterPostureSummary[];
  totalFlights: number;
  timestamp: string;
  cached: boolean;
  stale?: boolean;
  error?: string;
}

// ---- Proto → legacy adapter ----

interface TheaterMeta {
  name: string;
  shortName: string;
  targetNation: string | null;
  centerLat: number;
  centerLon: number;
  bounds: { north: number; south: number; east: number; west: number };
}

const THEATER_META: Record<string, TheaterMeta> = {
  'iran-theater': { name: 'Iran Theater', shortName: 'IRAN', targetNation: 'Iran', centerLat: 31, centerLon: 47.5, bounds: { north: 42, south: 20, east: 65, west: 30 } },
  'taiwan-theater': { name: 'Taiwan Strait', shortName: 'TAIWAN', targetNation: 'Taiwan', centerLat: 24, centerLon: 122.5, bounds: { north: 30, south: 18, east: 130, west: 115 } },
  'baltic-theater': { name: 'Baltic Theater', shortName: 'BALTIC', targetNation: null, centerLat: 58.5, centerLon: 21, bounds: { north: 65, south: 52, east: 32, west: 10 } },
  'blacksea-theater': { name: 'Black Sea', shortName: 'BLACK SEA', targetNation: null, centerLat: 44, centerLon: 34, bounds: { north: 48, south: 40, east: 42, west: 26 } },
  'korea-theater': { name: 'Korean Peninsula', shortName: 'KOREA', targetNation: 'North Korea', centerLat: 38, centerLon: 128, bounds: { north: 43, south: 33, east: 132, west: 124 } },
  'south-china-sea': { name: 'South China Sea', shortName: 'SCS', targetNation: null, centerLat: 15, centerLon: 113, bounds: { north: 25, south: 5, east: 121, west: 105 } },
  'east-med-theater': { name: 'Eastern Mediterranean', shortName: 'E.MED', targetNation: null, centerLat: 35, centerLon: 31, bounds: { north: 37, south: 33, east: 37, west: 25 } },
  'israel-gaza-theater': { name: 'Israel/Gaza', shortName: 'GAZA', targetNation: 'Gaza', centerLat: 31, centerLon: 34.5, bounds: { north: 33, south: 29, east: 36, west: 33 } },
  'yemen-redsea-theater': { name: 'Yemen/Red Sea', shortName: 'RED SEA', targetNation: 'Yemen', centerLat: 16.5, centerLon: 43, bounds: { north: 22, south: 11, east: 54, west: 32 } },
};

function toPostureSummary(proto: TheaterPosture): TheaterPostureSummary {
  const meta = THEATER_META[proto.theater];
  const strikeCapable = proto.activeOperations.includes('strike_capable');
  const postureLevel = (proto.postureLevel === 'critical' || proto.postureLevel === 'elevated')
 ? proto.postureLevel as 'critical' | 'elevated'
 : 'normal' as const;

  return {
 theaterId: proto.theater,
 theaterName: meta?.name ?? proto.theater,
 shortName: meta?.shortName ?? proto.theater,
 targetNation: meta?.targetNation ?? null,
 // Per-type breakdowns unavailable from server; UI falls back to totalAircraft/totalVessels
 fighters: 0,
 tankers: 0,
 awacs: 0,
 reconnaissance: 0,
 transport: 0,
 bombers: 0,
 drones: 0,
 totalAircraft: proto.activeFlights,
 destroyers: 0,
 frigates: 0,
 carriers: 0,
 submarines: 0,
 patrol: 0,
 auxiliaryVessels: 0,
 totalVessels: proto.trackedVessels,
 byOperator: {},
 postureLevel,
 strikeCapable,
 strikeGroupPresent: false,
 trend: 'stable',
 changePercent: 0,
 summary: '',
 weekOverWeekTrend: 'stable',
 daysAtElevated: 0,

 headline: postureLevel === 'critical'
 ? `Critical military buildup - ${meta?.name ?? proto.theater}`
 // eslint-disable-next-line sonarjs/no-nested-conditional
 : (postureLevel === 'elevated'
 ? `Elevated military activity - ${meta?.name ?? proto.theater}`
 : `Normal activity - ${meta?.name ?? proto.theater}`),
 centerLat: meta?.centerLat ?? 0,
 centerLon: meta?.centerLon ?? 0,
 bounds: meta?.bounds,
  };
}

function toPostureData(resp: GetTheaterPostureResponse): CachedTheaterPosture {
  // Defensive — degraded sidecar shapes can omit `theaters`.
  const theaters = Array.isArray(resp?.theaters) ? resp.theaters : [];
  // eslint-disable-next-line unicorn/no-array-callback-reference
  const postures = theaters.map(toPostureSummary);
  const totalFlights = postures.reduce((sum, p) => sum + p.totalAircraft, 0);
  return {
 postures,
 totalFlights,
 timestamp: new Date().toISOString(),
 cached: true,
  };
}

// ---- Local storage persistence ----

const LS_KEY = 'wm:theater-posture';
const LS_MAX_AGE_MS = 30 * 60 * 1000; // 30 min max staleness for localStorage

let cachedPosture: CachedTheaterPosture | null = null;
let fetchPromise: Promise<CachedTheaterPosture | null> | null = null;
let lastFetchTime = 0;
let lastErrorAt = 0;
const REFETCH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes - reduce upstream API pressure
const ERROR_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes between failure retries

function loadFromStorage(): CachedTheaterPosture | null {
  try {
 const raw = localStorage.getItem(LS_KEY);
 if (!raw) return null;
 // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
 const { data, savedAt } = JSON.parse(raw);
 if (Date.now() - savedAt > LS_MAX_AGE_MS) {
 localStorage.removeItem(LS_KEY);
 return null;
 }
 // eslint-disable-next-line @typescript-eslint/no-unsafe-return
 return { ...data, stale: true };
  } catch {
 return null;
  }
}

function saveToStorage(data: CachedTheaterPosture): void {
  try {
 localStorage.setItem(LS_KEY, JSON.stringify({ data, savedAt: Date.now() }));
  } catch { /* quota exceeded - ignore */ }
}

// Hydrate in-memory cache from localStorage on module load
const stored = loadFromStorage();
if (stored) {
  cachedPosture = stored;
}

export async function fetchCachedTheaterPosture(signal?: AbortSignal): Promise<CachedTheaterPosture | null> {
  if (signal?.aborted) throw createAbortError();
  const now = Date.now();

  // Return cached if fresh
  if (cachedPosture && !cachedPosture.stale && now - lastFetchTime < REFETCH_INTERVAL_MS) {
 return cachedPosture;
  }

  // Throttle retries after errors — prevents retry storms when the sidecar is down
  if (lastErrorAt && now - lastErrorAt < ERROR_BACKOFF_MS) {
 return cachedPosture;
  }

  // Deduplicate concurrent fetches
  if (fetchPromise) {
 return withCallerAbort(fetchPromise, signal);
  }

  // If we have stale localStorage data, return it immediately but fetch in background
  const hasStaleData = cachedPosture?.stale;

  fetchPromise = (async () => {
 try {
 const resp = await client.getTheaterPosture({ theater: '' });
 const data = toPostureData(resp);
 cachedPosture = data;
 lastFetchTime = Date.now();
 lastErrorAt = 0; // Reset backoff on success
 saveToStorage(data);
 // eslint-disable-next-line no-console
 console.info(`[CachedTheaterPosture] OK — ${data.postures.length} theaters, ${data.totalFlights} active flights`);
 return cachedPosture;
 } catch (error) {
 // Every failure takes the cache fallback, including the runtime's own 15s
 // fetch timeout. This body is shared by every deduplicated caller, so it must
 // not decide anything on one caller's behalf: rethrowing here would hand an
 // AbortError to callers that never cancelled, and skip the backoff below.
 // Per-caller cancellation is withCallerAbort's job at the return sites.
 const msg = error instanceof Error ? error.message : String(error);
 // eslint-disable-next-line no-console
 console.error(`[CachedTheaterPosture] Fetch error: ${msg}`);
 lastErrorAt = Date.now();
 return cachedPosture; // Return stale cache on error
 } finally {
 fetchPromise = null;
 }
  })();

  // If we have stale data, return it now — the fetch updates in background.
  // Nothing awaits fetchPromise on this path, so it keeps its own handler: an
  // unhandled rejection is reported as a renderer ERROR even though the caller
  // was served fine from cache.
  if (hasStaleData) {
 void fetchPromise.catch(() => { /* background refresh; the catch above already logged */ });
 return cachedPosture;
  }

  return withCallerAbort(fetchPromise, signal);
}

export function getCachedPosture(): CachedTheaterPosture | null {
  return cachedPosture;
}

export function hasCachedPosture(): boolean {
  return cachedPosture !== null;
}

/**
 * Ingest locally-computed postures (from flight data) as a fallback when the
 * upstream cloud API returns nothing.  Only updates if we have no fresh data.
 */
export function ingestLocalPostures(postures: TheaterPostureSummary[]): void {
  if (postures.length === 0) return;
  // Don't overwrite a fresh cloud fetch
  if (cachedPosture && !cachedPosture.stale && Date.now() - lastFetchTime < REFETCH_INTERVAL_MS) return;
  const totalFlights = postures.reduce((sum, p) => sum + p.totalAircraft, 0);
  cachedPosture = {
 postures,
 totalFlights,
 timestamp: new Date().toISOString(),
 cached: false,
 stale: false,
  };
  lastFetchTime = Date.now();
}
