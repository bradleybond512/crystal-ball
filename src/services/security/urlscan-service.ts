/**
 * urlscan.io — renderer fetcher for `/api/security/urlscan` (search) and
 * `/api/security/urlscan/submit` (POST scan request). 15-min cache on the
 * search side; submit is uncached.
 */

import { getApiBaseUrl } from '../runtime';
import {
  parseUrlscanThreats,
  summariseUrlscan,
  validateSubmitUrl,
  type UrlscanStats,
  type UrlscanThreat,
} from './urlscan-classify';

const POLL_INTERVAL_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12 * 1000;

export interface UrlscanEnvelope {
  threats: UrlscanThreat[];
  stats: UrlscanStats;
  total: number;
  fetchedAt: number;
  degraded: boolean;
  reason?: string;
  source: string;
}

interface CacheEntry {
  envelope: UrlscanEnvelope;
  fetchedAt: number;
  key: string;
}

let cache: CacheEntry | null = null;
let inflight: Promise<UrlscanEnvelope> | null = null;

function emptyEnvelope(reason: string): UrlscanEnvelope {
  return {
    threats: [],
    stats: summariseUrlscan([]),
    total: 0,
    fetchedAt: Date.now(),
    degraded: true,
    reason,
    source: 'urlscan.io',
  };
}

export interface FetchUrlscanOptions {
  q?: string;
  size?: number;
}

export async function fetchUrlscanThreats(
  options: FetchUrlscanOptions = {},
): Promise<UrlscanEnvelope> {
  const q = (options.q ?? 'malicious:true').slice(0, 200);
  const size = clamp(options.size ?? 50, 1, 100);
  const key = `${q}:${size}`;
  const now = Date.now();

  if (cache?.key === key && now - cache.fetchedAt < POLL_INTERVAL_MS) {
    return cache.envelope;
  }
  if (inflight) return inflight;

  inflight = (async (): Promise<UrlscanEnvelope> => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const url = `${getApiBaseUrl()}/api/security/urlscan?q=${encodeURIComponent(q)}&size=${size}`;
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timer);
      if (!response.ok) {
        return { ...emptyEnvelope(`HTTP ${response.status}`), fetchedAt: now };
      }
      const body = (await response.json()) as {
        results?: unknown;
        total?: number;
        degraded?: boolean;
        reason?: string;
        source?: string;
        error?: string;
      };
      if (body.error) return { ...emptyEnvelope(body.error), fetchedAt: now };
      const threats = parseUrlscanThreats(body.results ?? body);
      const envelope: UrlscanEnvelope = {
        threats,
        stats: summariseUrlscan(threats),
        total: typeof body.total === 'number' ? body.total : threats.length,
        fetchedAt: now,
        degraded: body.degraded ?? false,
        reason: body.reason,
        source: body.source ?? 'urlscan.io',
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

export function clearUrlscanCache(): void {
  cache = null;
  inflight = null;
}

export interface UrlscanSubmitResult {
  ok: boolean;
  uuid?: string;
  reportUrl?: string;
  apiUrl?: string;
  error?: string;
}

export async function submitUrlscan(input: string): Promise<UrlscanSubmitResult> {
  const validation = validateSubmitUrl(input);
  if (!validation.ok) return { ok: false, error: validation.error };
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/security/urlscan/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: validation.url, visibility: 'public' }),
    });
    const body = await response.json().catch(() => ({})) as {
      uuid?: string;
      result?: string;
      api?: string;
      error?: string;
    };
    if (!response.ok) {
      return { ok: false, error: body.error ?? `HTTP ${response.status}` };
    }
    return {
      ok: true,
      uuid: body.uuid,
      reportUrl: body.result,
      apiUrl: body.api,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
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
