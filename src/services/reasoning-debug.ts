/**
 * Reasoning Debug — ring-buffer log + metrics for the analyst reasoning layer.
 *
 * Every service that can silently swallow errors should call logDebug(...)
 * before the catch. The ring buffer is 200 entries, persisted to IDB
 * reasoning_memory so it survives reloads (last 100 entries only — IDB
 * writes are debounced).
 *
 * Always on by default (unlike alert-debug which requires ?debug=triage) —
 * the reasoning layer is complex enough that we want baseline signal in
 * production from day one. Verbosity is controlled per-category.
 *
 * Exposes a window.cbReasoningDebug global for console inspection and
 * publishes a `cb:reasoning-debug-event` CustomEvent per log entry so the
 * ReasoningDebugOverlay can subscribe without polling.
 */

import { getMemory, putMemory } from './reasoning-memory';

// ── Types ─────────────────────────────────────────────────────────────────────

export type DebugLevel = 'info' | 'warn' | 'error';

export type DebugCategory =
  | 'bootstrap'
  | 'idb'
  | 'llm'
  | 'events'
  | 'commands'
  | 'hud'
  | 'hypothesis'
  | 'forecast'
  | 'budget'
  | 'sidecar'
  | 'other';

export interface DebugEntry {
  /** Wall-clock unix ms. */
  t: number;
  level: DebugLevel;
  category: DebugCategory;
  /** Short source tag (service name usually). */
  source: string;
  /** Human-readable message. */
  message: string;
  /** Optional structured payload — kept small. */
  data?: Record<string, unknown>;
  /** Latency in ms for timed ops. */
  latencyMs?: number;
}

// ── Config ───────────────────────────────────────────────────────────────────

const RING_SIZE = 200;
const PERSIST_SIZE = 100;
const PERSIST_KEY = 'crystalball-reasoning-debug-v1';
const EVENT_NAME = 'cb:reasoning-debug-event';
const PERSIST_DEBOUNCE_MS = 10_000;

// Default verbosity — info is kept but not shown prominently. Tune via
// setVerbosity() if a category is chatty.
const verbosity: Record<DebugCategory, DebugLevel> = {
  bootstrap: 'info',
  idb: 'info',
  llm: 'info',
  events: 'info',
  commands: 'info',
  hud: 'warn',
  hypothesis: 'info',
  forecast: 'info',
  budget: 'info',
  sidecar: 'info',
  other: 'info',
};

const LEVEL_RANK: Record<DebugLevel, number> = { info: 0, warn: 1, error: 2 };

// ── State ─────────────────────────────────────────────────────────────────────

const ring: DebugEntry[] = [];
/** Per-category error counters since the last reset. */
const errorCounts: Record<DebugCategory, number> = {
  bootstrap: 0, idb: 0, llm: 0, events: 0, commands: 0, hud: 0,
  hypothesis: 0, forecast: 0, budget: 0, sidecar: 0, other: 0,
};
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let loaded = false;

function applyLoaded(entries: DebugEntry[] | null): void {
  if (!Array.isArray(entries)) return;
  // Prepend persisted entries (oldest first) so ring is oldest→newest.
  for (const e of entries) {
    ring.push(e);
    if (ring.length > RING_SIZE) ring.shift();
  }
}

function load(): void {
  if (loaded) return;
  loaded = true;
  void getMemory<DebugEntry[]>(PERSIST_KEY).then(applyLoaded);
}

function schedulePersist(): void {
  if (persistTimer !== null) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void putMemory(PERSIST_KEY, ring.slice(-PERSIST_SIZE));
  }, PERSIST_DEBOUNCE_MS);
  // Don't keep the Node event loop alive under tsx --test; no-op in browser.
  const t = persistTimer as unknown as { unref?: () => void };
  if (typeof t?.unref === 'function') t.unref();
}

// ── Public write API ─────────────────────────────────────────────────────────

export function logDebug(entry: Omit<DebugEntry, 't'>): void {
  load();
  const required = verbosity[entry.category];
  if (LEVEL_RANK[entry.level] < LEVEL_RANK[required]) return;
  const full: DebugEntry = { t: Date.now(), ...entry };
  ring.push(full);
  if (ring.length > RING_SIZE) ring.shift();
  if (entry.level === 'error') errorCounts[entry.category] += 1;
  schedulePersist();
  try {
    document.dispatchEvent(new CustomEvent<DebugEntry>(EVENT_NAME, { detail: full }));
  } catch { /* ignore (SSR or pre-mount) */ }
}

/** Shortcut for timed operations. Prefer using timeOp() over raw logDebug. */
export function timeOp<T>(
  source: string,
  category: DebugCategory,
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const t0 = performance.now();
  return fn().then(
    result => {
      logDebug({ level: 'info', category, source, message: label, latencyMs: performance.now() - t0 });
      return result;
    },
    error => {
      logDebug({
        level: 'error', category, source, message: `${label} failed`,
        latencyMs: performance.now() - t0,
        data: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    },
  );
}

/** Sync variant for non-async paths. */
export function timeOpSync<T>(
  source: string,
  category: DebugCategory,
  label: string,
  fn: () => T,
): T {
  const t0 = performance.now();
  try {
    const result = fn();
    logDebug({ level: 'info', category, source, message: label, latencyMs: performance.now() - t0 });
    return result;
  } catch (error) {
    logDebug({
      level: 'error', category, source, message: `${label} threw`,
      latencyMs: performance.now() - t0,
      data: { error: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}

// ── Read API ─────────────────────────────────────────────────────────────────

export function dumpDebug(): DebugEntry[] {
  load();
  return [...ring];
}

export function getErrorCounts(): Readonly<Record<DebugCategory, number>> {
  return { ...errorCounts };
}

export function getTotalErrorCount(): number {
  let n = 0;
  for (const c of Object.values(errorCounts)) n += c;
  return n;
}

export function clearDebug(): void {
  ring.length = 0;
  for (const k of Object.keys(errorCounts) as DebugCategory[]) errorCounts[k] = 0;
  void putMemory(PERSIST_KEY, []);
}

export function setVerbosity(category: DebugCategory, level: DebugLevel): void {
  verbosity[category] = level;
}

export function getVerbosity(): Readonly<Record<DebugCategory, DebugLevel>> {
  return { ...verbosity };
}

export function subscribeDebug(cb: (entry: DebugEntry) => void): () => void {
  const handler = (e: Event): void => {
    const ce = e as CustomEvent<DebugEntry>;
    cb(ce.detail);
  };
  document.addEventListener(EVENT_NAME, handler);
  return () => { document.removeEventListener(EVENT_NAME, handler); };
}

// ── Boot ─────────────────────────────────────────────────────────────────────

let started = false;
export function startReasoningDebug(): void {
  if (started) return;
  started = true;
  load();
  try {
    (window as unknown as Record<string, unknown>).cbReasoningDebug = {
      // eslint-disable-next-line no-console
      dump: (): DebugEntry[] => { const arr = dumpDebug(); console.table(arr); return arr; },
      errors: (): Record<string, number> => ({ ...getErrorCounts() }),
      clear: clearDebug,
      verbosity: getVerbosity,
      setVerbosity,
    };
  } catch { /* ignore */ }
  logDebug({ level: 'info', category: 'bootstrap', source: 'reasoning-debug', message: 'ready' });
}
