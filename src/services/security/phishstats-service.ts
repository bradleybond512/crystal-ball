/**
 * PhishStats — renderer-side fetcher for `/api/security/phishing`.
 *
 * Thin I/O wrapper. Parsing + classification live in
 * `phishstats-classify.ts`. 30-min memory cache to respect upstream rate
 * limits.
 */

import { getApiBaseUrl } from '../runtime';
import {
  parsePhishingRecords,
  summarisePhishing,
  type PhishingRecord,
  type PhishingStats,
} from './phishstats-classify';

const POLL_INTERVAL_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12 * 1000;

export interface PhishingEnvelope {
  records: PhishingRecord[];
  stats: PhishingStats;
  fetchedAt: number;
  degraded: boolean;
  reason?: string;
  source: string;
}

interface CacheEntry {
  envelope: PhishingEnvelope;
  fetchedAt: number;
  key: string;
}

let cache: CacheEntry | null = null;
let inflight: Promise<PhishingEnvelope> | null = null;

function emptyEnvelope(reason: string): PhishingEnvelope {
  return {
    records: [],
    stats: summarisePhishing([]),
    fetchedAt: Date.now(),
    degraded: true,
    reason,
    source: 'phishstats.info',
  };
}

export interface FetchPhishingOptions {
  limit?: number;
  minScore?: number;
}

export async function fetchPhishingRecords(
  options: FetchPhishingOptions = {},
): Promise<PhishingEnvelope> {
  const limit = clamp(options.limit ?? 50, 1, 500);
  const minScore = clamp(options.minScore ?? 5, 0, 10);
  const key = `${limit}:${minScore}`;
  const now = Date.now();

  if (cache?.key === key && now - cache.fetchedAt < POLL_INTERVAL_MS) {
    return cache.envelope;
  }
  if (inflight) return inflight;

  inflight = (async (): Promise<PhishingEnvelope> => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const url = `${getApiBaseUrl()}/api/security/phishing?limit=${limit}&minScore=${minScore}`;
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timer);
      if (!response.ok) {
        return { ...emptyEnvelope(`HTTP ${response.status}`), fetchedAt: now };
      }
      const body = (await response.json()) as Partial<PhishingEnvelope> & {
        error?: string;
      };
      // Accept either pre-shaped envelope, or raw PhishStats array.
      let records: PhishingRecord[];
      if (Array.isArray(body.records)) {
        records = body.records as PhishingRecord[];
      } else if (Array.isArray(body)) {
        records = parsePhishingRecords(body);
      } else if (body.error) {
        return { ...emptyEnvelope(body.error), fetchedAt: now };
      } else {
        records = [];
      }
      const envelope: PhishingEnvelope = {
        records,
        stats: body.stats ?? summarisePhishing(records),
        fetchedAt: now,
        degraded: body.degraded ?? false,
        reason: body.reason,
        source: body.source ?? 'phishstats.info',
      };
      cache = { envelope, fetchedAt: now, key };
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

export function clearPhishingCache(): void {
  cache = null;
  inflight = null;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export const __TEST_HOOKS__ = {
  get cache(): CacheEntry | null {
    return cache;
  },
  POLL_INTERVAL_MS,
};
