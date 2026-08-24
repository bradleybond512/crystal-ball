/**
 * Reasoning Memory — IndexedDB-backed key-value store for long-lived
 * reasoning state (hypothesis-threads, hypothesis-accuracy, relevance
 * weights). Shares the `crystalball_db` database with alert-store.
 *
 * Why IndexedDB instead of localStorage:
 *   - localStorage is capped at ~5MB total for the origin, shared with
 *     every other persistence key in the app. The reasoning services can
 *     accumulate MBs of history over weeks.
 *   - localStorage is synchronous and blocks the main thread on writes.
 *   - Browsers may evict localStorage more aggressively than IDB.
 *
 * Services use this as their primary store but keep a localStorage
 * mirror for synchronous bootstrap — the first render has data while
 * the async IDB load is in flight, and falls back gracefully if IDB
 * is unavailable (private browsing, quota, etc).
 */

// NOTE: Do NOT import from ./reasoning-debug here. reasoning-memory is a
// low-level IDB primitive consumed by reasoning-debug; importing back would
// create a real runtime circular dependency (arch-audit 2026-07-17). Because
// logDebug is therefore off-limits here, IDB blocked/error paths log via
// console — hence the file-scoped no-console exemption below.
/* eslint-disable no-console -- see layering note above: logDebug would re-create the reasoning-debug cycle */
import { recordLatency, incrementCounter } from './reasoning-metrics';

const DB_NAME = 'crystalball_db';
const STORE_NAME = 'reasoning_memory';

let dbInstance: IDBDatabase | null = null;
let openPromise: Promise<IDBDatabase> | null = null;

interface StoredRecord<T> {
  key: string;
  value: T;
  updatedAt: number;
}

export interface MemoryOperationOptions {
  instrument?: boolean;
}

// ── DB open with version bump if needed ──────────────────────────────────────

function createOtherStoresIfMissing(db: IDBDatabase): void {
  // Preserve stores that other modules expect so their upgradeneeded paths
  // still work when we bump the version from here.
  if (!db.objectStoreNames.contains('baselines')) {
    db.createObjectStore('baselines', { keyPath: 'key' });
  }
  if (!db.objectStoreNames.contains('snapshots')) {
    const s = db.createObjectStore('snapshots', { keyPath: 'timestamp' });
    s.createIndex('by_time', 'timestamp');
  }
  if (!db.objectStoreNames.contains('unified_alerts')) {
    const s = db.createObjectStore('unified_alerts', { keyPath: 'id' });
    s.createIndex('timestamp', 'timestamp', { unique: false });
    s.createIndex('severity', 'severity', { unique: false });
    s.createIndex('source', 'source', { unique: false });
    s.createIndex('situationId', 'situationId', { unique: false });
    s.createIndex('acknowledged', 'acknowledged', { unique: false });
  }
}

function attachCloseHandlers(db: IDBDatabase): void {
  db.addEventListener('close', () => { dbInstance = null; });
  // When another module (alert-store, storage.ts, or a future tab) tries
  // to open at a higher version, a `versionchange` event fires on this
  // open connection. If we don't close, the upgrade request is `blocked`
  // forever. Closing here lets the upgrade proceed; the next getMemory/
  // putMemory call will reopen at the new version.
  db.addEventListener('versionchange', () => {
    db.close();
    dbInstance = null;
  });
}

function openWithUpgrade(currentVersion: number, instrument: boolean): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const upgrade = indexedDB.open(DB_NAME, currentVersion + 1);
    upgrade.addEventListener('error', () => {
      reject(upgrade.error ?? new Error('[reasoning-memory] upgrade failed'));
    });
    upgrade.addEventListener('blocked', () => {
      console.error('[reasoning-memory] upgrade blocked by another connection', { currentVersion });
      if (instrument) incrementCounter('idb.upgrade.blocked');
      reject(new Error('[reasoning-memory] upgrade blocked by another connection'));
    });
    upgrade.addEventListener('upgradeneeded', (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      createOtherStoresIfMissing(db);
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    });
    upgrade.addEventListener('success', () => {
      dbInstance = upgrade.result;
      attachCloseHandlers(upgrade.result);
      resolve(upgrade.result);
    });
  });
}

function openDB(instrument = true): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);
  if (openPromise) return openPromise;

  openPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const probe = indexedDB.open(DB_NAME);
    probe.addEventListener('error', () => {
      reject(probe.error ?? new Error('[reasoning-memory] probe failed'));
    });
    probe.addEventListener('blocked', () => {
      console.error('[reasoning-memory] probe blocked');
      if (instrument) incrementCounter('idb.probe.blocked');
      reject(new Error('[reasoning-memory] probe blocked'));
    });
    probe.addEventListener('success', () => {
      const currentDB = probe.result;
      if (currentDB.objectStoreNames.contains(STORE_NAME)) {
        dbInstance = currentDB;
        attachCloseHandlers(currentDB);
        resolve(currentDB);
        return;
      }
      const version = currentDB.version;
      currentDB.close();
      openWithUpgrade(version, instrument).then(resolve, reject);
    });
    probe.addEventListener('upgradeneeded', (event) => {
      // Fresh DB — create all expected stores up-front.
      const db = (event.target as IDBOpenDBRequest).result;
      createOtherStoresIfMissing(db);
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    });
  });
  openPromise.finally(() => { openPromise = null; }).catch(() => { /* swallow */ });
  return openPromise;
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Write a value under `key`. Errors are logged and swallowed. */
export async function putMemory<T>(
  key: string,
  value: T,
  options: MemoryOperationOptions = {},
): Promise<void> {
  const t0 = performance.now();
  const instrument = options.instrument !== false;
  try {
    const db = await openDB(instrument);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const record: StoredRecord<T> = { key, value, updatedAt: Date.now() };
      store.put(record);
      tx.addEventListener('complete', () => resolve());
      tx.addEventListener('error', () => reject(tx.error ?? new Error('put failed')));
    });
    if (instrument) {
      recordLatency('idb.put', performance.now() - t0);
      incrementCounter('idb.put.success');
    }
  } catch (error) {
    if (instrument) {
      recordLatency('idb.put', performance.now() - t0);
      incrementCounter('idb.put.error');
    }
    console.error('[reasoning-memory] put failed', {
      key, latencyMs: performance.now() - t0,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Read a value by key. Returns null if missing or on error. */
export async function getMemory<T>(
  key: string,
  options: MemoryOperationOptions = {},
): Promise<T | null> {
  const t0 = performance.now();
  const instrument = options.instrument !== false;
  try {
    const db = await openDB(instrument);
    const value = await new Promise<T | null>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.addEventListener('success', () => {
        const record = req.result as StoredRecord<T> | undefined;
        resolve(record?.value ?? null);
      });
      req.addEventListener('error', () => resolve(null));
    });
    if (instrument) {
      recordLatency('idb.get', performance.now() - t0);
      incrementCounter(value === null ? 'idb.get.miss' : 'idb.get.hit');
    }
    return value;
  } catch (error) {
    if (instrument) {
      recordLatency('idb.get', performance.now() - t0);
      incrementCounter('idb.get.error');
    }
    console.error('[reasoning-memory] get failed', {
      key, latencyMs: performance.now() - t0,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Delete a value by key. Silent on failure. */
export async function deleteMemory(key: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.addEventListener('complete', () => resolve());
      tx.addEventListener('error', () => resolve());
    });
  } catch { /* ignore */ }
}

/** List all keys in the reasoning_memory store (for debug/migration). */
export async function listMemoryKeys(): Promise<string[]> {
  try {
    const db = await openDB();
    return await new Promise<string[]>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAllKeys();
      req.addEventListener('success', () => {
        const keys = (req.result as IDBValidKey[]).map(k =>
          typeof k === 'string' ? k : JSON.stringify(k));
        resolve(keys);
      });
      req.addEventListener('error', () => resolve([]));
    });
  } catch { return []; }
}
