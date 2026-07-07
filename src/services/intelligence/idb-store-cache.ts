/**
 * IndexedDB-backed storage for the large reasoning/cognition stores.
 *
 * These stores (situation store, bias detections, safety case, quality debt,
 * meta-confidence, counterfactuals, …) each serialize to 300–600 KB. Kept in
 * localStorage they collectively cross WebKit's ~5 MB quota, which (a) seizes
 * the renderer on a bare setItem throw and (b) drives an evict↔regen↔stringify
 * churn once the quota-safe eviction layer starts reclaiming them — a 60s+
 * `JSON.stringify` boot wedge that trips the renderer watchdog into a reload
 * loop.
 *
 * IndexedDB has no 5 MB cap, so moving these off localStorage removes the quota
 * pressure entirely. To keep the stores' existing SYNCHRONOUS `StorageLike`
 * contract (getItem/setItem in constructors and getters, no async ripple), this
 * module keeps an in-memory string mirror that is preloaded from IDB ONCE at
 * boot (`preloadIdbBackedStores`, awaited before the reasoning layer starts).
 * Reads hit the warm mirror; writes update the mirror synchronously and flush
 * to IDB asynchronously (debounced), so no store write blocks a frame.
 *
 * Migration is transparent: on preload, any key still living in localStorage is
 * copied into IDB and removed from localStorage, so an upgraded client keeps its
 * history and frees the localStorage budget.
 *
 * Backed by reasoning-memory's `crystalball_db` KV store (already version-safe
 * via probe-then-bump — see [[project_idb_shared_db_version_collision]]), under
 * a `store-cache/` key namespace so it never collides with reasoning memory.
 */

import { getMemory, putMemory, deleteMemory } from '@/services/reasoning-memory';

/** Minimal synchronous storage contract the reasoning stores depend on. */
export interface SyncStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const CACHE_PREFIX = 'store-cache/';
const FLUSH_DEBOUNCE_MS = 800;

/**
 * The localStorage keys whose stores are relocated to IndexedDB. Every entry is
 * a large, re-derivable reasoning/cognition cache — never user config/identity
 * (those stay in localStorage). Keep in sync with the stores that call
 * `getIdbBackedStorage()`.
 */
export const IDB_BACKED_STORE_KEYS: readonly string[] = [
  'wm-situation-store-v2',
  'wm-cognitive-bias-detections',
  'wm-safety-case',
  'wm-quality-debt',
  'wm-meta-confidence',
  'wm-counterfactuals',
  'wm-mission-control',
  'wm-intelligence-health',
  'wm-world-narrative',
  'wm-assumptions',
  'wm-assumption-annotations',
  'wm-hypothesis-sets',
  'wm-crisis-trajectories',
  'wm-multi-agent-review',
  'wm-situation-timeline',
  'wm-domain-dependency',
];

const mirror = new Map<string, string>();
/** Pending IDB writes: value string, or `null` to delete. */
const pending = new Map<string, string | null>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let preloaded = false;
let preloadPromise: Promise<void> | null = null;

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => { flushTimer = null; void flushPending(); }, FLUSH_DEBOUNCE_MS);
}

async function flushPending(): Promise<void> {
  const batch = [...pending.entries()];
  pending.clear();
  for (const [key, value] of batch) {
    // Best effort — the mirror stays authoritative this session on any failure.
    try {
      await (value === null ? deleteMemory(CACHE_PREFIX + key) : putMemory(CACHE_PREFIX + key, value));
    } catch { /* ignore */ }
  }
}

function legacyLocalStorage(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

/** Read a legacy localStorage value, tolerating a throwing/absent store. */
function readLegacy(ls: Storage | null, key: string): string | null {
  if (!ls) return null;
  try { return ls.getItem(key); } catch { return null; }
}

/**
 * Resolve one store's value: prefer the IDB copy; otherwise adopt the
 * localStorage copy (one-time migration — persist to IDB, free the localStorage
 * slot). Returns null when neither source has it.
 */
async function resolveStoreValue(key: string, ls: Storage | null): Promise<string | null> {
  let value: string | null = null;
  try { value = await getMemory<string>(CACHE_PREFIX + key); } catch { value = null; }
  if (value !== null) return value;

  const legacy = readLegacy(ls, key);
  if (legacy === null) return null;
  try { await putMemory(CACHE_PREFIX + key, legacy); } catch { /* keep in mirror */ }
  try { ls?.removeItem(key); } catch { /* best effort */ }
  return legacy;
}

/**
 * Load every IDB-backed store key into the in-memory mirror, migrating any key
 * still in localStorage. MUST be awaited during boot before the reasoning layer
 * first touches these stores, so their synchronous hydration reads a warm
 * mirror rather than an empty one. Idempotent + concurrency-safe.
 */
export function preloadIdbBackedStores(): Promise<void> {
  if (preloaded) return Promise.resolve();
  preloadPromise ??= (async (): Promise<void> => {
    const ls = legacyLocalStorage();
    for (const key of IDB_BACKED_STORE_KEYS) {
      const value = await resolveStoreValue(key, ls);
      if (value !== null) mirror.set(key, value);
    }
    preloaded = true;
  })();
  return preloadPromise;
}

/**
 * A synchronous `StorageLike` backed by the IDB mirror — for stores that accept
 * an injected `StorageLike`. Reads hit the mirror; writes update it immediately
 * and flush to IDB asynchronously.
 */
export function getIdbBackedStorage(): SyncStorageLike {
  return {
    getItem(key: string): string | null {
      return mirror.has(key) ? mirror.get(key)! : null;
    },
    setItem(key: string, value: string): void {
      mirror.set(key, value);
      pending.set(key, value);
      scheduleFlush();
    },
    removeItem(key: string): void {
      mirror.delete(key);
      pending.set(key, null);
      scheduleFlush();
    },
  };
}

const routedKeys = new Set(IDB_BACKED_STORE_KEYS);

/**
 * Route the IDB-backed keys through the mirror at the `localStorage` layer, so
 * the ~16 reasoning stores that read/write `globalThis.localStorage` directly
 * transparently persist to IndexedDB instead — no per-store change. Every other
 * key falls through to the underlying (possibly eviction-patched) localStorage.
 *
 * Install AFTER `installLocalStoragePatch()` and AFTER `preloadIdbBackedStores()`
 * so migration reads/clears the legacy localStorage copies first, then routing
 * takes over. Idempotent.
 */
export function installIdbStorageRouting(): void {
  if (typeof localStorage === 'undefined') return;
  if ((globalThis as Record<string, unknown>).__idbStoreRoutingInstalled) return;

  const underlyingGet = localStorage.getItem.bind(localStorage);
  const underlyingSet = localStorage.setItem.bind(localStorage);
  const underlyingRemove = localStorage.removeItem.bind(localStorage);

  localStorage.getItem = (key: string): string | null => {
    if (!routedKeys.has(key)) return underlyingGet(key);
    return mirror.has(key) ? mirror.get(key)! : null;
  };

  localStorage.setItem = (key: string, value: string): void => {
    if (!routedKeys.has(key)) { underlyingSet(key, value); return; }
    mirror.set(key, value);
    pending.set(key, value);
    scheduleFlush();
  };

  localStorage.removeItem = (key: string): void => {
    if (!routedKeys.has(key)) { underlyingRemove(key); return; }
    mirror.delete(key);
    pending.set(key, null);
    scheduleFlush();
  };

  (globalThis as Record<string, unknown>).__idbStoreRoutingInstalled = true;
}

/** Test seam — reset module state between cases. */
export function _resetIdbStoreCacheForTest(): void {
  mirror.clear();
  pending.clear();
  if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null; }
  preloaded = false;
  preloadPromise = null;
  delete (globalThis as Record<string, unknown>).__idbStoreRoutingInstalled;
}

/** Test seam — read the current mirror value for a key. */
export function _mirrorGetForTest(key: string): string | null {
  return mirror.has(key) ? mirror.get(key)! : null;
}
