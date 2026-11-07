/**
 * Aviation Intelligence Service — PR 1.
 *
 * Renderer-side wrapper that fetches the five aviation feeds via the
 * sidecar (so CORS / API-key concerns are confined to the Node process)
 * and returns typed envelopes. Cached for 5 minutes by default.
 *
 * Pure deterministic core lives in `aviation-intel-normalize.ts`; this
 * module is the thin I/O layer.
 */

import { AVIATION_CACHE_MS, SIGMET_HAZARDS } from './aviation-intel-types';
import { getApiBaseUrl } from '../runtime';
import type {
  AirportGroundDelay,
  AviationFetchEnvelope,
  AviationNotam,
  AviationPirep,
  AviationSigmet,
  MilitaryAircraft,
  VolcanicAshAdvisory,
} from './aviation-intel-types';

export type {
  AviationNotam,
  AviationSigmet,
  AviationPirep,
  MilitaryAircraft,
  AirportGroundDelay,
  VolcanicAshAdvisory,
  AviationFetchEnvelope,
} from './aviation-intel-types';

const POLL_INTERVAL_MS = AVIATION_CACHE_MS;
const FETCH_TIMEOUT_MS = 12 * 1000;

interface CacheEntry<T> {
  envelope: AviationFetchEnvelope<T>;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<AviationFetchEnvelope<unknown>>>();

async function fetchWithCache<T>(
  path: string,
  defaultEnvelope: () => AviationFetchEnvelope<T>,
  accept?: (row: T) => boolean,
): Promise<AviationFetchEnvelope<T>> {
  const now = Date.now();
  const hit = cache.get(path) as CacheEntry<T> | undefined;
  if (hit && now - hit.fetchedAt < POLL_INTERVAL_MS) {
    return hit.envelope;
  }

  const existing = inflight.get(path) as Promise<AviationFetchEnvelope<T>> | undefined;
  if (existing) return existing;

  const promise = (async (): Promise<AviationFetchEnvelope<T>> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(`${getApiBaseUrl()}${path}`, { signal: controller.signal });
      if (!response.ok) {
        const fallback = defaultEnvelope();
        return { ...fallback, degraded: true, reason: `HTTP ${response.status}` };
      }
      const body = (await response.json()) as AviationFetchEnvelope<T>;
      if (accept) {
        if (body?.source !== defaultEnvelope().source || !Array.isArray(body.data) || typeof body.degraded !== 'boolean'
          || !Number.isSafeInteger(body.fetchedAt) || body.fetchedAt <= 0 || body.fetchedAt > Date.now()
          || body.fetchedAt + AVIATION_CACHE_MS <= Date.now()) return defaultEnvelope();
        const rows = body.data.filter((row) => row && typeof row === 'object' && accept(row));
        if (rows.length !== body.data.length) return { ...body, data: rows, degraded: true, reason: 'Invalid provider rows' };
        if (body.degraded) return body;
      }
      cache.set(path, { envelope: body, fetchedAt: now });
      return body;
    } catch (error) {
      const fallback = defaultEnvelope();
      return {
        ...fallback,
        degraded: true,
        reason: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timer);
      inflight.delete(path);
    }
  })();

  inflight.set(path, promise as Promise<AviationFetchEnvelope<unknown>>);
  return promise;
}

function emptyEnvelope<T>(source: string): () => AviationFetchEnvelope<T> {
  return () => ({
    data: [],
    fetchedAt: Date.now(),
    degraded: true,
    reason: 'unavailable',
    source,
  });
}

// Public fetchers

export async function fetchNotams(): Promise<AviationFetchEnvelope<AviationNotam>> {
  return fetchWithCache<AviationNotam>('/api/aviation/notams', emptyEnvelope('faa.gov/notamapi'));
}

export async function fetchSigmets(): Promise<AviationFetchEnvelope<AviationSigmet>> {
  return fetchWithCache<AviationSigmet>(
    '/api/aviation/sigmets',
    emptyEnvelope('aviationweather.gov'),
    (row) => typeof row.id === 'string' && typeof row.text === 'string' && SIGMET_HAZARDS.includes(row.hazard)
      && ['light', 'moderate', 'severe', 'extreme'].includes(row.severity) && typeof row.isAirmet === 'boolean'
      && Number.isFinite(row.validFrom) && Number.isFinite(row.validTo) && row.validFrom < row.validTo
      && Array.isArray(row.polygon) && (!row.altitudeFt || (Number.isFinite(row.altitudeFt.min) && Number.isFinite(row.altitudeFt.max))),
  );
}

export async function fetchPireps(): Promise<AviationFetchEnvelope<AviationPirep>> {
  return fetchWithCache<AviationPirep>(
    '/api/aviation/pireps',
    emptyEnvelope('aviationweather.gov'),
  );
}

export async function fetchMilitaryAircraft(): Promise<AviationFetchEnvelope<MilitaryAircraft>> {
  return fetchWithCache<MilitaryAircraft>(
    '/api/aviation/military',
    emptyEnvelope('adsb.lol+opensky'),
  );
}

export async function fetchAirportDelays(): Promise<AviationFetchEnvelope<AirportGroundDelay>> {
  return fetchWithCache<AirportGroundDelay>(
    '/api/aviation/delays', emptyEnvelope('nasstatus.faa.gov'),
    (row) => typeof row.airport === 'string' && typeof row.reason === 'string'
      && ['ground_stop', 'ground_delay', 'arrival_delay', 'other'].includes(row.programType)
      && [row.startedAt, row.endsAt, row.avgDelayMinutes, row.maxDelayMinutes].every((v) => v === null || Number.isFinite(v)),
  );
}

export async function fetchVolcanicAsh(): Promise<AviationFetchEnvelope<VolcanicAshAdvisory>> {
  return fetchWithCache<VolcanicAshAdvisory>(
    '/api/aviation/volcanic-ash',
    emptyEnvelope('aviationweather.gov'),
  );
}

// Aggregate snapshot used by the panel + globe layer

export interface AviationIntelSnapshot {
  notams: AviationFetchEnvelope<AviationNotam>;
  sigmets: AviationFetchEnvelope<AviationSigmet>;
  pireps: AviationFetchEnvelope<AviationPirep>;
  military: AviationFetchEnvelope<MilitaryAircraft>;
  delays: AviationFetchEnvelope<AirportGroundDelay>;
  volcanicAsh: AviationFetchEnvelope<VolcanicAshAdvisory>;
}

export async function fetchAviationIntelSnapshot(): Promise<AviationIntelSnapshot> {
  const [notams, sigmets, pireps, military, delays, volcanicAsh] = await Promise.all([
    fetchNotams(),
    fetchSigmets(),
    fetchPireps(),
    fetchMilitaryAircraft(),
    fetchAirportDelays(),
    fetchVolcanicAsh(),
  ]);
  return { notams, sigmets, pireps, military, delays, volcanicAsh };
}

// TFR + presidential filtering helpers

export function selectTfrs(notams: readonly AviationNotam[]): AviationNotam[] {
  return notams.filter(
    (n) => n.classification === 'TFR' || /TFR/i.test(n.text),
  );
}

export function selectPresidentialTfrs(notams: readonly AviationNotam[]): AviationNotam[] {
  return selectTfrs(notams).filter((n) => n.presidential);
}

export function clearAviationCache(): void {
  cache.clear();
  inflight.clear();
}

export const __TEST_HOOKS__ = {
  cache,
  inflight,
  POLL_INTERVAL_MS,
};
