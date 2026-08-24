/**
 * Reasoning Metrics — latency histograms + counters for the reasoning layer.
 *
 * Complements reasoning-debug (narrative log) with aggregate distributions:
 * p50/p95/p99 for each named operation, counters for events/errors/calls,
 * and a per-cycle record (what fired, how long, what changed).
 *
 * Everything is in-memory, rolling windows (default 500 samples per op).
 * Exposed via window.cbReasoningMetrics and a new MCP tool.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LatencySample {
  t: number;       // unix ms
  latencyMs: number;
}

export interface LatencyStats {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  mean: number;
  last: number;
}

export interface MetricsSnapshot {
  timestamp: number;
  latencies: Record<string, LatencyStats>;
  counters: Record<string, number>;
}

// ── Config ───────────────────────────────────────────────────────────────────

const SAMPLES_PER_OP = 500;

// ── State ─────────────────────────────────────────────────────────────────────

const latencies = new Map<string, LatencySample[]>();
const counters = new Map<string, number>();

// ── Write API ────────────────────────────────────────────────────────────────

/** Record a latency sample for the named operation. */
export function recordLatency(op: string, latencyMs: number): void {
  if (!Number.isFinite(latencyMs)) return;
  let arr = latencies.get(op);
  if (!arr) { arr = []; latencies.set(op, arr); }
  arr.push({ t: Date.now(), latencyMs });
  if (arr.length > SAMPLES_PER_OP) arr.splice(0, arr.length - SAMPLES_PER_OP);
}

// ── Persistence (counter snapshot) ───────────────────────────────────────────

const COUNTERS_KEY = 'cb-reasoning-counters-v1';
const PERSIST_DEBOUNCE_MS = 10_000;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let countersLoaded = false;

function scheduleCounterPersist(): void {
  if (persistTimer !== null) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistCounters();
  }, PERSIST_DEBOUNCE_MS);
  // Don't hold the Node event loop open in tests.
  const t = persistTimer as unknown as { unref?: () => void };
  if (typeof t?.unref === 'function') t.unref();
}

async function persistCounters(): Promise<void> {
  try {
    const { putMemory } = await import('./reasoning-memory');
    const snap: Record<string, number> = {};
    for (const [k, v] of counters) snap[k] = v;
    await putMemory(COUNTERS_KEY, snap, { instrument: false });
  } catch { /* IDB unavailable — not a hard failure */ }
}

function hydrateCounters(stored: Record<string, number>): void {
  for (const [k, v] of Object.entries(stored)) {
    counters.set(k, (counters.get(k) ?? 0) + v);
  }
}

function loadCounters(): void {
  if (countersLoaded) return;
  countersLoaded = true;
  void import('./reasoning-memory')
    .then(({ getMemory }) => getMemory<Record<string, number>>(COUNTERS_KEY, { instrument: false }))
    .then((stored) => {
      if (stored !== null && typeof stored === 'object') hydrateCounters(stored);
    })
    .catch(() => { /* IDB unavailable */ });
}

// ── Test-only APIs ────────────────────────────────────────────────────────────

/** Inject a counter snapshot directly (for tests that can't use real IDB). */
export function initCountersForTest(stored: Record<string, number>): Promise<void> {
  countersLoaded = true; // prevent real IDB load from clobbering
  hydrateCounters(stored);
  return Promise.resolve();
}

/** Synchronously flush pending debounced persist to a callback (for tests). */
export function flushCountersForTest(
  persist: (counters: Record<string, number>) => void,
): Promise<void> {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  const snap: Record<string, number> = {};
  for (const [k, v] of counters) snap[k] = v;
  persist(snap);
  return Promise.resolve();
}

/** Increment a named counter. */
export function incrementCounter(name: string, by = 1): void {
  loadCounters();
  counters.set(name, (counters.get(name) ?? 0) + by);
  scheduleCounterPersist();
}

/** Time an async op and record its latency; errors still count (and throw). */
export async function timeMetric<T>(op: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    const r = await fn();
    recordLatency(op, performance.now() - t0);
    return r;
  } catch (error) {
    recordLatency(op, performance.now() - t0);
    incrementCounter(`${op}.errors`);
    throw error;
  }
}

export function timeMetricSync<T>(op: string, fn: () => T): T {
  const t0 = performance.now();
  try {
    const r = fn();
    recordLatency(op, performance.now() - t0);
    return r;
  } catch (error) {
    recordLatency(op, performance.now() - t0);
    incrementCounter(`${op}.errors`);
    throw error;
  }
}

// ── Read API ─────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

export function getLatencyStats(op: string): LatencyStats | null {
  const arr = latencies.get(op);
  if (!arr || arr.length === 0) return null;
  const sorted = arr.map(s => s.latencyMs).sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    min: sorted[0] ?? 0,
    max: sorted[count - 1] ?? 0,
    mean: sum / count,
    last: arr[arr.length - 1]?.latencyMs ?? 0,
  };
}

export function getAllLatencyStats(): Record<string, LatencyStats> {
  const out: Record<string, LatencyStats> = {};
  for (const op of latencies.keys()) {
    const s = getLatencyStats(op);
    if (s) out[op] = s;
  }
  return out;
}

export function getCounters(): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [k, v] of counters) out[k] = v;
  return out;
}

export function getMetricsSnapshot(): MetricsSnapshot {
  return {
    timestamp: Date.now(),
    latencies: getAllLatencyStats(),
    counters: getCounters(),
  };
}

export function resetMetrics(): void {
  latencies.clear();
  counters.clear();
  countersLoaded = false;
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
}

// ── Boot ─────────────────────────────────────────────────────────────────────

let started = false;
export function startReasoningMetrics(): void {
  if (started) return;
  started = true;
  try {
    (window as unknown as Record<string, unknown>).cbReasoningMetrics = {
      snapshot: getMetricsSnapshot,
      latency: getLatencyStats,
      counters: getCounters,
      reset: resetMetrics,
    };
  } catch { /* ignore */ }
}
