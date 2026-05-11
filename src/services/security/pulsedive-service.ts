/**
 * Pulsedive — renderer fetcher. Two query modes:
 *   - explore: `risk:high type:domain limit:50` (default)
 *   - lookup: pass an `indicator` (IP/domain/URL) to `info.php`
 *
 * 1-hour cache on each (risk,type,limit) and per-indicator lookup key.
 */

import { getApiBaseUrl } from '../runtime';
import {
  parsePulsediveIndicators,
  summarisePulsedive,
  type PulsediveIndicator,
  type PulsediveRisk,
  type PulsediveStats,
  type PulsediveType,
} from './pulsedive-classify';

const POLL_INTERVAL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12 * 1000;

export interface PulsediveEnvelope {
  indicators: PulsediveIndicator[];
  stats: PulsediveStats;
  query: { risk: string; type: string; limit: number; indicator: string | null };
  fetchedAt: number;
  degraded: boolean;
  reason?: string;
  source: string;
}

interface CacheEntry {
  envelope: PulsediveEnvelope;
  fetchedAt: number;
  key: string;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<PulsediveEnvelope>>();

export interface FetchPulsediveOptions {
  risk?: PulsediveRisk | 'all';
  type?: PulsediveType | 'all';
  limit?: number;
  indicator?: string;
}

function emptyEnvelope(
  reason: string,
  query: PulsediveEnvelope['query'],
): PulsediveEnvelope {
  return {
    indicators: [],
    stats: summarisePulsedive([]),
    query,
    fetchedAt: Date.now(),
    degraded: true,
    reason,
    source: 'pulsedive.com',
  };
}

export async function fetchPulsediveIndicators(
  options: FetchPulsediveOptions = {},
): Promise<PulsediveEnvelope> {
  const risk: PulsediveRisk | 'all' = options.risk ?? 'high';
  const type: PulsediveType | 'all' = options.type ?? 'all';
  const limit = clamp(options.limit ?? 50, 1, 100);
  const indicator = (options.indicator ?? '').trim();
  const query: PulsediveEnvelope['query'] = {
    risk,
    type,
    limit,
    indicator: indicator || null,
  };
  const key = indicator
    ? `lookup:${indicator.toLowerCase()}`
    : `explore:${risk}:${type}:${limit}`;
  const now = Date.now();

  const cached = cache.get(key);
  if (cached && now - cached.fetchedAt < POLL_INTERVAL_MS) {
    return cached.envelope;
  }
  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = (async (): Promise<PulsediveEnvelope> => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const params = new URLSearchParams();
      params.set('risk', risk);
      params.set('type', type);
      params.set('limit', String(limit));
      if (indicator) params.set('indicator', indicator);
      const url = `${getApiBaseUrl()}/api/security/pulsedive?${params.toString()}`;
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timer);
      if (!response.ok) {
        return { ...emptyEnvelope(`HTTP ${response.status}`, query), fetchedAt: now };
      }
      const body = (await response.json()) as {
        indicators?: unknown;
        degraded?: boolean;
        reason?: string;
        source?: string;
        error?: string;
      };
      if (body.error) {
        return { ...emptyEnvelope(body.error, query), fetchedAt: now };
      }
      const indicators = parsePulsediveIndicators(body.indicators ?? body);
      const envelope: PulsediveEnvelope = {
        indicators,
        stats: summarisePulsedive(indicators),
        query,
        fetchedAt: now,
        degraded: body.degraded ?? false,
        reason: body.reason,
        source: body.source ?? 'pulsedive.com',
      };
      cache.set(key, { envelope, fetchedAt: now, key });
      return envelope;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ...emptyEnvelope(reason, query), fetchedAt: now };
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

export function clearPulsediveCache(): void {
  cache.clear();
  inflight.clear();
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export const __TEST_HOOKS__ = {
  get cache(): Map<string, CacheEntry> {
    return cache;
  },
  POLL_INTERVAL_MS,
};
