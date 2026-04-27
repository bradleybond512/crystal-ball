/**
 * Provider Health — runtime success/error/latency tracking on top of the
 * static registry. Status is derived (not assigned) from observed events
 * so health flips automatically as conditions change.
 *
 * Persistence: snapshots are persisted to localStorage so a fresh tab
 * doesn't lose all health context, but the in-memory store is the source
 * of truth during a session.
 */

import type { ProviderDefinition } from './registry';
import { getProvider } from './registry';

export type ProviderStatus =
  | 'unknown'    // never called this session
  | 'healthy'    // recent success
  | 'degraded'   // recent successes mixed with failures, OR slow
  | 'stale'      // last success older than 2x ttl
  | 'rateLimited' // observed 429
  | 'down';       // last attempt failed and no recent success

export interface ProviderHealthRecord {
  providerId: string;
  status: ProviderStatus;
  /** Epoch ms of last successful call. */
  lastSuccessAt: number | null;
  /** Epoch ms of last failed call. */
  lastErrorAt: number | null;
  /** Last failure message (truncated). */
  lastError: string | null;
  /** Latency of the last successful call (ms). */
  lastLatencyMs: number | null;
  /** Rolling average of last N latencies (ms). */
  avgLatencyMs: number | null;
  /** Counts since session start. */
  successCount: number;
  errorCount: number;
  /** Epoch ms when rate-limit window resets, if known. */
  quotaResetsAt: number | null;
}

const STORAGE_KEY = 'cb:provider-health:v1';
const ROLLING_WINDOW = 10;
const ERROR_TRUNCATE = 200;
const STALE_MULTIPLIER = 2;        // last success older than 2x ttl → stale
const SLOW_LATENCY_MS = 5000;      // sustained > 5s avg → degraded
const DEGRADED_ERROR_RATIO = 0.25; // errors >= 25% of attempts → degraded

const _records = new Map<string, ProviderHealthRecord>();
const _latencyWindows = new Map<string, number[]>();

function blank(providerId: string): ProviderHealthRecord {
  return {
    providerId,
    status: 'unknown',
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    lastLatencyMs: null,
    avgLatencyMs: null,
    successCount: 0,
    errorCount: 0,
    quotaResetsAt: null,
  };
}

function getOrInit(providerId: string): ProviderHealthRecord {
  const existing = _records.get(providerId);
  if (existing) return existing;
  const fresh = blank(providerId);
  _records.set(providerId, fresh);
  return fresh;
}

function pushLatency(providerId: string, latencyMs: number): number {
  const w = _latencyWindows.get(providerId) ?? [];
  w.push(latencyMs);
  if (w.length > ROLLING_WINDOW) w.shift();
  _latencyWindows.set(providerId, w);
  const sum = w.reduce((s, x) => s + x, 0);
  return Math.round(sum / w.length);
}

/** Re-derive status from current counters and the provider's TTL. Called
 *  internally after every record/recordError so callers don't have to. */
function deriveStatus(rec: ProviderHealthRecord, def: ProviderDefinition | undefined): ProviderStatus {
  // Rate-limited supersedes everything else until reset.
  if (rec.quotaResetsAt && Date.now() < rec.quotaResetsAt) return 'rateLimited';

  const total = rec.successCount + rec.errorCount;
  if (total === 0) return 'unknown';

  // No success ever or last success very old.
  if (rec.lastSuccessAt === null) {
    return rec.errorCount > 0 ? 'down' : 'unknown';
  }

  if (def) {
    const stalenessThreshold = def.ttlMs * STALE_MULTIPLIER;
    if (Date.now() - rec.lastSuccessAt > stalenessThreshold) return 'stale';
  }

  // Sustained-error ratio after at least 4 attempts.
  if (total >= 4) {
    const ratio = rec.errorCount / total;
    if (ratio >= DEGRADED_ERROR_RATIO) return 'degraded';
  }

  if (rec.avgLatencyMs !== null && rec.avgLatencyMs >= SLOW_LATENCY_MS) return 'degraded';

  return 'healthy';
}

/** Record a successful call. */
export function recordSuccess(providerId: string, latencyMs: number): void {
  const rec = getOrInit(providerId);
  rec.lastSuccessAt = Date.now();
  rec.lastLatencyMs = latencyMs;
  rec.avgLatencyMs = pushLatency(providerId, latencyMs);
  rec.successCount += 1;
  rec.status = deriveStatus(rec, getProvider(providerId));
  persistAsync();
}

/** Record a failed call. `quotaResetsAt` should be set if the failure
 *  was a rate-limit (429) and the provider returned a Retry-After or
 *  similar hint. */
export function recordError(providerId: string, message: string, opts: { quotaResetsAt?: number } = {}): void {
  const rec = getOrInit(providerId);
  rec.lastErrorAt = Date.now();
  rec.lastError = message.slice(0, ERROR_TRUNCATE);
  rec.errorCount += 1;
  if (opts.quotaResetsAt) rec.quotaResetsAt = opts.quotaResetsAt;
  rec.status = deriveStatus(rec, getProvider(providerId));
  persistAsync();
}

/** Wrap an async fetch with automatic health recording. */
export async function instrument<T>(providerId: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    recordSuccess(providerId, Date.now() - start);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 429-style errors set a quota reset if available via header info.
    recordError(providerId, message);
    throw error;
  }
}

/** Snapshot of every known health record, sorted by status severity
 *  (down → degraded → stale → healthy → unknown). For status panels. */
export function getAllHealth(): ProviderHealthRecord[] {
  const order: ProviderStatus[] = ['down', 'degraded', 'rateLimited', 'stale', 'unknown', 'healthy'];
  return [..._records.values()].sort(
    (a, b) => order.indexOf(a.status) - order.indexOf(b.status),
  );
}

/** One provider's current record, or null if it has never been observed. */
export function getHealth(providerId: string): ProviderHealthRecord | null {
  return _records.get(providerId) ?? null;
}

/** Test helper — wipe all in-memory health and the persisted snapshot. */
export function resetHealthForTests(): void {
  _records.clear();
  _latencyWindows.clear();
  if (typeof localStorage !== 'undefined') {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* SSR / locked */ }
  }
}

// ── persistence ───────────────────────────────────────────────────────────

let _persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced write — health updates in a tight loop won't thrash storage. */
function persistAsync(): void {
  if (typeof localStorage === 'undefined') return;
  if (_persistTimer) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    try {
      const payload = JSON.stringify([..._records.entries()]);
      localStorage.setItem(STORAGE_KEY, payload);
    } catch { /* quota or locked */ }
  }, 250);
}

/** Restore persisted state. Call once at app boot. Safe to call when
 *  there's nothing to restore. */
export function loadPersistedHealth(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const entries = JSON.parse(raw) as [string, ProviderHealthRecord][];
    for (const [k, v] of entries) {
      if (k && v && typeof v === 'object') _records.set(k, v);
    }
  } catch { /* corrupt entry — ignore */ }
}
