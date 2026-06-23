import { isDesktopRuntime } from './runtime';
import { invokeTauri } from './tauri-bridge';
import { isStorageQuotaExceeded, isIndexedDbQuotaExceeded, isQuotaError, markIndexedDbQuotaExceeded, safeSetItem } from '@/utils';

interface CacheEnvelope<T> {
  key: string;
  updatedAt: number;
  data: T;
  /** Absolute expiry (ms epoch). Web-only honoring; desktop enforces TTL in Rust. */
  expiresAt?: number;
}

const CACHE_PREFIX = 'crystalball-persistent-cache:';
const CACHE_DB_NAME = 'crystalball_persistent_cache';
const CACHE_DB_VERSION = 1;
const CACHE_STORE = 'entries';
/** Hard cap on web IDB entries; oldest live entries are evicted past this. */
const MAX_ENTRIES = 500;
const PRUNE_INTERVAL_MS = 5 * 60_000;

// Suppress repeated fallback warnings — fires once per session per operation.
let warnedDesktopRead = false;
let warnedDesktopWrite = false;
let warnedIdbRead = false;
let warnedIdbWrite = false;

let cacheDbPromise: Promise<IDBDatabase> | null = null;
let lastPruneAt = 0;

function isIndexedDbAvailable(): boolean {
  return typeof window !== 'undefined' && window.indexedDB != null;
}

function isExpired(env: { expiresAt?: number }): boolean {
  return env.expiresAt !== undefined && Date.now() > env.expiresAt;
}

function getCacheDb(): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) {
    return Promise.reject(new Error('IndexedDB unavailable'));
  }

  if (cacheDbPromise) return cacheDbPromise;

  cacheDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);

    request.addEventListener('error', () => reject(request.error ?? new Error('Failed to open cache IndexedDB')));

    request.addEventListener('upgradeneeded', () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
      }
    });

    request.addEventListener('success', () => {
      const db = request.result;
      db.addEventListener('close', () => { cacheDbPromise = null; });
      resolve(db);
    });
  });

  return cacheDbPromise;
}

async function getFromIndexedDb<T>(key: string): Promise<CacheEnvelope<T> | null> {
  const db = await getCacheDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, 'readonly');
    const store = tx.objectStore(CACHE_STORE);
    const request = store.get(key);
    request.addEventListener('success', () => resolve((request.result as CacheEnvelope<T> | undefined) ?? null));
    request.addEventListener('error', () => reject(request.error ?? new Error('cache read failed')));
  });
}

async function setInIndexedDb<T>(payload: CacheEnvelope<T>): Promise<void> {
  const db = await getCacheDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    tx.addEventListener('complete', () => resolve());
    tx.addEventListener('error', () => reject(tx.error ?? new Error('cache write failed')));
    tx.objectStore(CACHE_STORE).put(payload);
  });
}

/** Throttled background eviction: drops expired entries and, when the store is
 *  over MAX_ENTRIES live entries, the oldest ones by updatedAt. Best-effort. */
function maybePrune(): void {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  void pruneCache().catch(() => { /* eviction is best-effort */ });
}

async function pruneCache(): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  const db = await getCacheDb();
  const all = await new Promise<CacheEnvelope<unknown>[]>((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, 'readonly');
    const request = tx.objectStore(CACHE_STORE).getAll();
    request.addEventListener('success', () => resolve((request.result as CacheEnvelope<unknown>[] | undefined) ?? []));
    request.addEventListener('error', () => reject(request.error ?? new Error('cache scan failed')));
  });

  const live = all.filter((e) => !isExpired(e));
  const toDelete = all.filter((e) => isExpired(e)).map((e) => e.key);
  if (live.length > MAX_ENTRIES) {
    const oldest = [...live].sort((a, b) => a.updatedAt - b.updatedAt).slice(0, live.length - MAX_ENTRIES);
    for (const e of oldest) toDelete.push(e.key);
  }
  if (toDelete.length === 0) return;

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    tx.addEventListener('complete', () => resolve());
    tx.addEventListener('error', () => reject(tx.error ?? new Error('cache prune failed')));
    const store = tx.objectStore(CACHE_STORE);
    for (const key of toDelete) store.delete(key);
  });
}

export async function getPersistentCache<T>(key: string): Promise<CacheEnvelope<T> | null> {
  if (isDesktopRuntime()) {
    try {
      const value = await invokeTauri<CacheEnvelope<T> | null>('read_cache_entry', { key });
      return value ?? null;
    } catch (error) {
      if (!warnedDesktopRead) { warnedDesktopRead = true; console.warn('[persistent-cache] Desktop read failed; falling back to browser storage', error); } // eslint-disable-line no-console
    }
  }

  if (isIndexedDbAvailable()) {
    try {
      const env = await getFromIndexedDb<T>(key);
      if (env && isExpired(env)) { void deletePersistentCache(key); return null; }
      return env;
    } catch (error) {
      if (!warnedIdbRead) { warnedIdbRead = true; console.warn('[persistent-cache] IndexedDB read failed; falling back to localStorage', error); } // eslint-disable-line no-console
      cacheDbPromise = null;
    }
  }

  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${key}`);
    const env = raw ? JSON.parse(raw) as CacheEnvelope<T> : null;
    if (env && isExpired(env)) {
      try { localStorage.removeItem(`${CACHE_PREFIX}${key}`); } catch { /* ignore */ }
      return null;
    }
    return env;
  } catch {
    return null;
  }
}

export async function setPersistentCache<T>(key: string, data: T, ttlMs?: number): Promise<void> {
  const now = Date.now();
  const payload: CacheEnvelope<T> = {
    key,
    data,
    updatedAt: now,
    expiresAt: ttlMs && ttlMs > 0 ? now + ttlMs : undefined,
  };

  if (isDesktopRuntime()) {
    try {
      await invokeTauri<void>('write_cache_entry', { key, value: JSON.stringify(payload), ttlMs });
      return;
    } catch (error) {
      if (!warnedDesktopWrite) { warnedDesktopWrite = true; console.warn('[persistent-cache] Desktop write failed; falling back to browser storage', error); } // eslint-disable-line no-console
    }
  }

  if (isIndexedDbAvailable() && !isIndexedDbQuotaExceeded()) {
    try {
      await setInIndexedDb(payload);
      maybePrune();
      return;
    } catch (error) {
      if (isQuotaError(error)) markIndexedDbQuotaExceeded();
      else if (!warnedIdbWrite) { warnedIdbWrite = true; console.warn('[persistent-cache] IndexedDB write failed; falling back to localStorage', error); } // eslint-disable-line no-console
      cacheDbPromise = null;
    }
  }

  safeSetItem(`${CACHE_PREFIX}${key}`, JSON.stringify(payload));
}

export async function deletePersistentCache(key: string): Promise<void> {
  if (isDesktopRuntime()) {
    try {
      await invokeTauri<void>('delete_cache_entry', { key });
      return;
    } catch {
      // Fall through to browser storage
    }
  }

  if (isIndexedDbAvailable()) {
    try {
      const db = await getCacheDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(CACHE_STORE, 'readwrite');
        tx.addEventListener('complete', () => resolve());
        tx.addEventListener('error', () => reject(tx.error ?? new Error('cache delete failed')));
        tx.objectStore(CACHE_STORE).delete(key);
      });
      return;
    } catch (error) {
      console.warn('[persistent-cache] IndexedDB delete failed; falling back to localStorage', error); // eslint-disable-line no-console
      cacheDbPromise = null;
    }
  }

  if (isStorageQuotaExceeded()) return;
  try {
    localStorage.removeItem(`${CACHE_PREFIX}${key}`);
  } catch {
    // Ignore
  }
}

export function cacheAgeMs(updatedAt: number): number {
  return Math.max(0, Date.now() - updatedAt);
}

export function describeFreshness(updatedAt: number): string {
  const age = cacheAgeMs(updatedAt);
  const mins = Math.floor(age / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
