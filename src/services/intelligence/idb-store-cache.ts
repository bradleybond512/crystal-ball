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

import {
  getMemory as realGetMemory,
  putMemory as realPutMemory,
  deleteMemory as realDeleteMemory,
} from '@/services/reasoning-memory';

/**
 * The IndexedDB KV operations this module depends on, behind an indirection so
 * tests can inject an in-memory backend (node has no IndexedDB, so the real
 * ones fail — which otherwise makes the IDB-hit code paths untestable).
 */
interface MemoryBackend {
  getMemory: (key: string) => Promise<unknown>;
  putMemory: (key: string, value: unknown) => Promise<void>;
  deleteMemory: (key: string) => Promise<void>;
}
const defaultBackend: MemoryBackend = {
  getMemory: (k) => realGetMemory<string>(k),
  putMemory: (k, v) => realPutMemory(k, v),
  deleteMemory: (k) => realDeleteMemory(k),
};
let backend: MemoryBackend = defaultBackend;

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
  // Large, still-growing, lazily-hydrated caches that also crossed the budget.
  // Safe to route: each reads localStorage on first *access* (after routing is
  // installed), not eagerly at module import, so it hydrates from the mirror.
  'wm-algo-eval-ledger',
  'crystalball-notification-digests',
  'crystalball-alert-lifecycle-v1',
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
      await (value === null ? backend.deleteMemory(CACHE_PREFIX + key) : backend.putMemory(CACHE_PREFIX + key, value));
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
 * Persist a localStorage value into IDB and, only once the write is CONFIRMED
 * durable, free the localStorage slot. Never deletes the copy on failure — else
 * an IDB write error would drop the only durable copy (Codex review P1).
 * putMemory swallows its own errors, so confirm with a read-back rather than
 * trusting it not to throw; on failure the mirror still serves it this session
 * and the drain retries next boot. Returns the (now-durable) value.
 */
async function persistThenDrain(key: string, ls: Storage | null, legacy: string): Promise<string> {
  let persisted = false;
  try {
    await backend.putMemory(CACHE_PREFIX + key, legacy);
    persisted = (await backend.getMemory(CACHE_PREFIX + key)) === legacy;
  } catch { persisted = false; }
  if (persisted) {
    try { ls?.removeItem(key); } catch { /* best effort */ }
  }
  return legacy;
}

/**
 * Resolve one store's value: prefer the IDB copy; otherwise adopt the
 * localStorage copy (one-time migration — persist to IDB, free the localStorage
 * slot). Returns null when neither source has it.
 *
 * When the IDB copy exists, a lingering localStorage copy is drained on EVERY
 * boot (not just the migration boot) — the one-shot migration removeItem can be
 * skipped when its read-back gate races the shared-`crystalball_db`
 * versionchange churn, orphaning the copy forever. Left in place, the orphan
 * keeps localStorage over WebKit's ~5 MB quota and every synchronous
 * localStorage call wedges the renderer main thread (the 60–120 s watchdog
 * stall/reload loop).
 */
async function resolveStoreValue(key: string, ls: Storage | null): Promise<string | null> {
  let value: string | null = null;
  try { value = (await backend.getMemory(CACHE_PREFIX + key)) as string | null; } catch { value = null; }

  if (value !== null) {
    const orphan = readLegacy(ls, key);
    // Byte-identical (or absent) copy → safe to drop immediately.
    if (orphan === null || orphan === value) {
      if (orphan !== null) { try { ls?.removeItem(key); } catch { /* best effort */ } }
      return value;
    }
    // The localStorage copy DIVERGES — it may hold a value that never reached
    // IDB (e.g. a write before routing installed). Persist it before removal so
    // nothing is lost; next boot it is byte-identical and drains above. (These
    // are re-derivable caches, so a rare regression self-heals from live data.)
    return persistThenDrain(key, ls, orphan);
  }

  const legacy = readLegacy(ls, key);
  if (legacy === null) return null;
  return persistThenDrain(key, ls, legacy);
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
    const t0 = typeof performance === 'undefined' ? 0 : performance.now();
    let bytes = 0;
    for (const key of IDB_BACKED_STORE_KEYS) {
      const value = await resolveStoreValue(key, ls);
      if (value !== null) { mirror.set(key, value); bytes += value.length; }
      // Yield a macrotask between keys so the renderer heartbeat + input events
      // interleave with the (main-thread) IDB deserialize bursts rather than
      // being starved through the whole boot materialization.
      await new Promise<void>((r) => { setTimeout(r, 0); });
    }
    // eslint-disable-next-line no-console
    if (typeof performance !== 'undefined') console.warn(`[BOOT-TIMING] preloadIdbBackedStores: ${(performance.now() - t0).toFixed(0)}ms, ${(bytes / 1e6).toFixed(1)}MB mirror`);
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
 * Pick where to install a localStorage method patch. WKWebView's `localStorage`
 * is an exotic platform object: assigning to `localStorage.setItem` on the
 * INSTANCE is silently inert (the native method keeps running), so an
 * instance-level monkey-patch never intercepts. Patching `Storage.prototype`
 * DOES take effect. Fall back to the instance for a plain-object shim (unit
 * tests / SSR), whose prototype is `Object.prototype`.
 */
function storagePatchHost(ls: Storage): Storage {
  const proto = Object.getPrototypeOf(ls) as Storage | null;
  if (proto && proto !== Object.prototype && typeof proto.setItem === 'function') return proto;
  return ls;
}

/**
 * Route the IDB-backed keys through the mirror at the `localStorage` layer, so
 * the ~19 reasoning stores that read/write `globalThis.localStorage` directly
 * transparently persist to IndexedDB instead — no per-store change. Every other
 * key falls through to the underlying (possibly eviction-patched) localStorage.
 *
 * Patches `Storage.prototype` (see `storagePatchHost` — instance patches are
 * inert on WKWebView), guarding on `this === localStorage` so `sessionStorage`
 * is untouched.
 *
 * Install AFTER `installLocalStoragePatch()` and AFTER `preloadIdbBackedStores()`
 * so migration reads/clears the legacy localStorage copies first, then routing
 * takes over. Idempotent.
 */
export function installIdbStorageRouting(): void {
  if (typeof localStorage === 'undefined') return;
  if ((globalThis as Record<string, unknown>).__idbStoreRoutingInstalled) return;

  const target = localStorage;
  const host = storagePatchHost(target);
  // Capture the raw methods; they are re-invoked with the real `this` via
  // `.call(this, …)`, so binding here would pin the wrong receiver.
  /* eslint-disable @typescript-eslint/unbound-method */
  const nativeGet = host.getItem;
  const nativeSet = host.setItem;
  const nativeRemove = host.removeItem;
  /* eslint-enable @typescript-eslint/unbound-method */

  host.getItem = function (this: Storage, key: string): string | null {
    if (this === target && routedKeys.has(key)) return mirror.has(key) ? mirror.get(key)! : null;
    return nativeGet.call(this, key);
  };

  host.setItem = function (this: Storage, key: string, value: string): void {
    if (this === target && routedKeys.has(key)) {
      mirror.set(key, value);
      pending.set(key, value);
      scheduleFlush();
      return;
    }
    nativeSet.call(this, key, value);
  };

  host.removeItem = function (this: Storage, key: string): void {
    if (this === target && routedKeys.has(key)) {
      mirror.delete(key);
      pending.set(key, null);
      scheduleFlush();
      return;
    }
    nativeRemove.call(this, key);
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
  backend = defaultBackend;
  delete (globalThis as Record<string, unknown>).__idbStoreRoutingInstalled;
}

/** Test seam — inject an in-memory IDB backend (pass null to restore the real one). */
export function _setMemoryBackendForTest(b: MemoryBackend | null): void {
  backend = b ?? defaultBackend;
}

/** Test seam — read the current mirror value for a key. */
export function _mirrorGetForTest(key: string): string | null {
  return mirror.has(key) ? mirror.get(key)! : null;
}
