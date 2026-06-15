/**
 * Entity Graph — co-occurrence edge store (Cognitive Enhancement PR 5).
 *
 * Records which entities appear together in the same hypothesis and
 * maintains a decay-weighted co-occurrence graph so that entity-dossier.ts
 * can surface topAssociates: "whenever RUS appears, so does UKR (strength 0.82)".
 *
 * Design invariants (house plan):
 *   - Every edge weight has a recency bias: weight decays with a 72-hour
 *     exponential half-life (same as entity heat in entity-dossier.ts).
 *   - Contradictions surface (high co-occurrence is reported as-is, not hidden).
 *   - Stale edges are evicted rather than silently accumulating.
 *   - Pure deterministic core: no DOM, no fetch, no globals at import time.
 *
 * Caps: 2 000 edges (evict weakest-stale when exceeded).
 *
 * Persistence: localStorage mirror (crystalball-cognition-entity-graph-v1)
 * + IDB reasoning_memory, following the loaded/writtenSinceLoad guard
 * pattern from action-memory.ts and operator-model.ts.
 *
 * Ghost Mode: writes are suppressed; reads still work (same pattern as
 * operator-model.ts recordEngagement).
 *
 * Injectable storage for tests: pass StorageOverride to configure().
 */

import { isGhostMode } from '@/services/mode-manager';

// ── IDB lazy loader (same pattern as episodic-memory.ts) ─────────────────────

let _getMemory: (<T>(key: string) => Promise<T | null>) | null = null;
let _putMemory: (<T>(key: string, value: T) => Promise<void>) | null = null;

function lazyLoadIdb(): void {
  if (_getMemory !== null) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@/services/reasoning-memory') as {
      getMemory: <T>(key: string) => Promise<T | null>;
      putMemory: <T>(key: string, value: T) => Promise<void>;
    };
    _getMemory = mod.getMemory;
    _putMemory = mod.putMemory;
  } catch {
    _getMemory = () => Promise.resolve(null);
    _putMemory = () => Promise.resolve();
  }
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface EntityEdge {
  /** Canonical entity key (e.g. "country:RUS"). */
  a: string;
  /** Canonical entity key (e.g. "country:UKR"). */
  b: string;
  /**
   * Decay-adjusted co-occurrence weight. Increments by 1.0 per co-occurrence
   * and decays exponentially with a 72-hour half-life between updates.
   */
  weight: number;
  /** Unix-ms timestamp of the most recent co-occurrence. */
  lastSeen: number;
}

// ── Injectable storage interface ──────────────────────────────────────────────

export interface GraphStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface EntityGraphOptions {
  storage?: GraphStorageLike | null;
  getMemoryFn?: <T>(key: string) => Promise<T | null>;
  putMemoryFn?: <T>(key: string, value: T) => Promise<void>;
  now?: () => number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'crystalball-cognition-entity-graph-v1';
const MAX_EDGES = 2000;

/**
 * 72-hour exponential half-life for edge weight decay.
 * λ = ln(2) / halfLifeMs so that weight × e^(−λ × Δt) = weight/2 after 72h.
 */
const HALF_LIFE_MS = 72 * 60 * 60 * 1000;
const DECAY_LAMBDA = Math.LN2 / HALF_LIFE_MS;

// ── State ─────────────────────────────────────────────────────────────────────

/** Map from canonical edge key (sorted "a|b") to EntityEdge. */
const edges = new Map<string, EntityEdge>();
let loaded = false;
let writtenSinceLoad = false;

// Injected overrides (populated via configure() for tests).
let _storage: GraphStorageLike | null | undefined = undefined; // undefined = use globalThis.localStorage
let _getMemoryOverride: (<T>(key: string) => Promise<T | null>) | null = null;
let _putMemoryOverride: (<T>(key: string, value: T) => Promise<void>) | null = null;
let _nowFn: () => number = Date.now;

// ── Configuration (injection for tests) ──────────────────────────────────────

/**
 * Configure injectable dependencies.  Call before first use in tests.
 * Resets loaded/written state so the store can be initialized fresh.
 */
export function configure(opts: EntityGraphOptions): void {
  _storage = opts.storage === undefined ? undefined : opts.storage;
  _getMemoryOverride = opts.getMemoryFn ?? null;
  _putMemoryOverride = opts.putMemoryFn ?? null;
  _nowFn = opts.now ?? Date.now;
  edges.clear();
  loaded = false;
  writtenSinceLoad = false;
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function resolveStorage(): GraphStorageLike | null {
  if (_storage !== undefined) return _storage;
  if (typeof globalThis !== 'undefined') {
    const ls = (globalThis as unknown as Record<string, unknown>).localStorage as GraphStorageLike | undefined;
    if (ls && typeof ls.getItem === 'function') return ls;
  }
  return null;
}

function isValidEdge(e: unknown): e is EntityEdge {
  if (!e || typeof e !== 'object') return false;
  const edge = e as Record<string, unknown>;
  return typeof edge.a === 'string' &&
    typeof edge.b === 'string' &&
    typeof edge.weight === 'number' &&
    typeof edge.lastSeen === 'number';
}

function applyLoaded(arr: EntityEdge[] | null): void {
  if (!Array.isArray(arr)) return;
  edges.clear();
  for (const e of arr) {
    if (!isValidEdge(e)) continue;
    const key = edgeKey(e.a, e.b);
    edges.set(key, e);
  }
}

function load(): void {
  if (loaded) return;
  loaded = true;
  const stor = resolveStorage();
  if (stor) {
    try {
      const raw = stor.getItem(STORAGE_KEY);
      if (raw) applyLoaded(JSON.parse(raw) as EntityEdge[]);
    } catch { /* ignore */ }
  }
  const getMemFn: (key: string) => Promise<EntityEdge[] | null> =
    _getMemoryOverride
      ? (key) => (_getMemoryOverride as (k: string) => Promise<EntityEdge[] | null>)(key)
      : (key) => { lazyLoadIdb(); return _getMemory!<EntityEdge[]>(key); };
  void getMemFn(STORAGE_KEY).then((arr) => {
    if (writtenSinceLoad) return;
    applyLoaded(arr);
  });
}

function save(): void {
  writtenSinceLoad = true;
  const arr = [...edges.values()];
  const stor = resolveStorage();
  if (stor) {
    try { stor.setItem(STORAGE_KEY, JSON.stringify(arr)); } catch { /* quota */ }
  }
  const putMemFn: (key: string, value: EntityEdge[]) => Promise<void> =
    _putMemoryOverride
      ? (key, value) => (_putMemoryOverride as (k: string, v: EntityEdge[]) => Promise<void>)(key, value)
      : (key, value) => { lazyLoadIdb(); return _putMemory!(key, value); };
  void putMemFn(STORAGE_KEY, arr);
}

// ── Edge key ──────────────────────────────────────────────────────────────────

/** Canonical key: sorted so (a,b) and (b,a) map to the same edge. */
function edgeKey(a: string, b: string): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

// ── Decay helper ──────────────────────────────────────────────────────────────

/**
 * Compute the decayed weight of an edge given the current time.
 * Exported so tests can verify the half-life math directly.
 */
export function decayedWeight(edge: EntityEdge, nowMs: number): number {
  const deltaMs = nowMs - edge.lastSeen;
  if (deltaMs <= 0) return edge.weight;
  return edge.weight * Math.exp(-DECAY_LAMBDA * deltaMs);
}

// ── Eviction ──────────────────────────────────────────────────────────────────

/**
 * When the edge cap is exceeded, evict the weakest-stale edges:
 * sort by decayed weight ascending and remove the lowest-weight entries.
 */
function evictIfNeeded(nowMs: number): void {
  if (edges.size <= MAX_EDGES) return;
  const sorted = [...edges.entries()]
    .map(([key, e]) => ({ key, dw: decayedWeight(e, nowMs) }))
    .sort((a, b) => a.dw - b.dw);
  const toRemove = sorted.slice(0, edges.size - MAX_EDGES);
  for (const { key } of toRemove) edges.delete(key);
}

// ── Public write API ──────────────────────────────────────────────────────────

/**
 * Record that a set of entities co-occurred at timestamp `ts`.
 * Every pair in the set gets an edge weight increment; existing edge weights
 * are first decayed to `ts` before adding 1.0, so recency is always honored.
 *
 * Ghost Mode suppresses writes (consistent with operator-model.ts).
 */
export function recordCoOccurrence(entities: readonly string[], ts: number): void {
  if (isGhostMode()) return;
  load();
  const nowMs = ts > 0 ? ts : _nowFn();
  if (entities.length < 2) return;
  // Build all pairs (order n^2 but typically n≤10 entities per hypothesis).
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i]!;
      const b = entities[j]!;
      const key = edgeKey(a, b);
      const existing = edges.get(key);
      if (existing) {
        // Decay the accumulated weight to now, then add 1.0 for this occurrence.
        const decayed = decayedWeight(existing, nowMs);
        edges.set(key, { a: existing.a, b: existing.b, weight: decayed + 1, lastSeen: nowMs });
      } else {
        edges.set(key, { a, b, weight: 1, lastSeen: nowMs });
      }
    }
  }
  evictIfNeeded(nowMs);
  save();
}

// ── Public read API ───────────────────────────────────────────────────────────

/**
 * Return edges connected to `entity`, sorted by current decayed weight
 * descending. Each entry in the result is the full EntityEdge record.
 *
 * `limit` defaults to 10. Pass 0 for unlimited.
 */
export function neighborsOf(entity: string, limit = 10): EntityEdge[] {
  load();
  const nowMs = _nowFn();
  const result: EntityEdge[] = [];
  for (const [, edge] of edges) {
    if (edge.a === entity || edge.b === entity) {
      result.push(edge);
    }
  }
  result.sort((a, b) => decayedWeight(b, nowMs) - decayedWeight(a, nowMs));
  return limit > 0 ? result.slice(0, limit) : result;
}

/** Return all edges (for testing / diagnostics). */
export function getAllEdges(): EntityEdge[] {
  load();
  return [...edges.values()];
}

/** Return the total count of stored edges (for testing caps). */
export function getEdgeCount(): number {
  load();
  return edges.size;
}

/** Reset all edge state (for testing). */
export function resetEntityGraph(): void {
  edges.clear();
  loaded = false;
  writtenSinceLoad = false;
}
