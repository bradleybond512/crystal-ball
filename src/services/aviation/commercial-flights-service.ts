/**
 * Commercial flights — renderer-side fetcher for `/api/aviation/flights`.
 *
 * Thin I/O wrapper. Pure classification + cross-reference logic lives in
 * `commercial-flights-classify.ts`. Caches in-memory for 10 min so the
 * 100-req/day OpenSky free-tier limit isn't blown by a chatty UI.
 */

import { getApiBaseUrl } from '../runtime';
import {
  classifyFlights,
  summariseFlights,
  type LiveFlight,
  type FlightCategoryCounts,
} from './commercial-flights-classify';

const POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 min — respects OpenSky free-tier rate limit
const FETCH_TIMEOUT_MS = 12 * 1000;

export interface LiveFlightsEnvelope {
  flights: LiveFlight[];
  counts: FlightCategoryCounts;
  fetchedAt: number;
  degraded: boolean;
  reason?: string;
  source: string;
}

interface CacheEntry {
  envelope: LiveFlightsEnvelope;
  fetchedAt: number;
}

let cache: CacheEntry | null = null;
let inflight: Promise<LiveFlightsEnvelope> | null = null;

function emptyEnvelope(reason: string): LiveFlightsEnvelope {
  return {
    flights: [],
    counts: summariseFlights([]),
    fetchedAt: Date.now(),
    degraded: true,
    reason,
    source: 'opensky-network.org',
  };
}

export async function fetchLiveFlights(): Promise<LiveFlightsEnvelope> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < POLL_INTERVAL_MS) {
    return cache.envelope;
  }
  if (inflight) return inflight;

  inflight = (async (): Promise<LiveFlightsEnvelope> => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const response = await fetch(`${getApiBaseUrl()}/api/aviation/flights`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timer);
      if (!response.ok) {
        return { ...emptyEnvelope(`HTTP ${response.status}`), fetchedAt: now };
      }
      const body = (await response.json()) as Partial<LiveFlightsEnvelope> & {
        states?: unknown;
        rateLimited?: boolean;
        error?: string;
      };
      // Accept either the pre-classified envelope from /api/aviation/flights,
      // or a raw OpenSky response (fallback path) we classify renderer-side.
      let flights: LiveFlight[];
      if (Array.isArray(body.flights)) {
        flights = body.flights as LiveFlight[];
      } else if (Array.isArray(body.states)) {
        flights = classifyFlights(body);
      } else if (body.error) {
        return { ...emptyEnvelope(body.error), fetchedAt: now };
      } else if (body.rateLimited) {
        return { ...emptyEnvelope('rate limited'), fetchedAt: now };
      } else {
        flights = [];
      }
      const counts = body.counts ?? summariseFlights(flights);
      const envelope: LiveFlightsEnvelope = {
        flights,
        counts,
        fetchedAt: now,
        degraded: body.degraded ?? false,
        reason: body.reason,
        source: body.source ?? 'opensky-network.org',
      };
      cache = { envelope, fetchedAt: now };
      return envelope;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ...emptyEnvelope(reason), fetchedAt: now };
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function clearLiveFlightsCache(): void {
  cache = null;
  inflight = null;
}

export const __TEST_HOOKS__ = {
  get cache(): CacheEntry | null {
    return cache;
  },
  setCache(entry: CacheEntry | null): void {
    cache = entry;
  },
  POLL_INTERVAL_MS,
};
