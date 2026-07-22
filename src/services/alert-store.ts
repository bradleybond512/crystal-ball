/* eslint-disable sonarjs/no-nested-conditional */
/**
 * IndexedDB-backed alert store for 30-day alert persistence.
 *
 * Uses the shared `crystalball_db` database and adds a `unified_alerts`
 * object store via a version bump if it doesn't already exist.
 *
 * Exported singleton: `alertDB`
 */

import type { UnifiedAlert, AlertSource, AlertSeverity } from './unified-alerts';

const DB_NAME = 'crystalball_db';
const STORE_NAME = 'unified_alerts';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

let dbInstance: IDBDatabase | null = null;
/** Deduplicates concurrent openDB() calls before dbInstance is set.
 *  Without this, two callers racing before the probe settles each start their
 *  own indexedDB.open() — both can fall through to openWithUpgrade(), which
 *  makes the second upgrade request blocked with no handler, hanging forever. */
let dbOpenPromise: Promise<IDBDatabase> | null = null;

/** True when running in an environment without IndexedDB (smoke
 *  harness under happy-dom, certain Node test environments).
 *  Detected once at module load, then re-checked at openDB() time so
 *  hot-loading IndexedDB later still works. When false, the alert
 *  store degrades to in-memory no-ops rather than throwing. */
function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined';
  } catch {
    return false;
  }
}

/** Sentinel error subtype so callers can distinguish "no IDB"
 *  (degrade gracefully) from real DB failures (log + retry). */
class IndexedDbUnavailableError extends Error {
  constructor() {
    super('IndexedDB is not available in this environment');
    this.name = 'IndexedDbUnavailableError';
  }
}

/** Create indexes on the unified_alerts object store. */
function createAlertIndexes(store: IDBObjectStore): void {
  store.createIndex('timestamp', 'timestamp', { unique: false });
  store.createIndex('severity', 'severity', { unique: false });
  store.createIndex('source', 'source', { unique: false });
  store.createIndex('situationId', 'situationId', { unique: false });
  store.createIndex('acknowledged', 'acknowledged', { unique: false });
}

/** Handle the upgrade when the DB already exists but needs the unified_alerts store. */
function openWithUpgrade(currentVersion: number): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
 const upgrade = indexedDB.open(DB_NAME, currentVersion + 1);

 upgrade.addEventListener('error', () => {
 reject(upgrade.error ?? new Error('[alert-store] Upgrade open failed'));
 });

 upgrade.addEventListener('blocked', () => {
 reject(new Error('[alert-store] DB upgrade blocked by another open connection'));
 });

 upgrade.addEventListener('upgradeneeded', (event) => {
 const db = (event.target as IDBOpenDBRequest).result;

 if (!db.objectStoreNames.contains(STORE_NAME)) {
 const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
 createAlertIndexes(store);
 }
 });

 upgrade.addEventListener('success', () => {
 dbInstance = upgrade.result;
 upgrade.result.addEventListener('close', () => { dbInstance = null; });
 // Allow another module (reasoning-memory bumping to a higher version)
 // to upgrade the shared `crystalball_db` without being blocked by this
 // open connection.
 upgrade.result.addEventListener('versionchange', () => {
 upgrade.result.close();
 dbInstance = null;
 });
 resolve(upgrade.result);
 });
  });
}

/**
 * Open the crystalball_db, creating the unified_alerts object store
 * if it doesn't already exist (bumps the DB version by 1).
 */
function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);
  if (!isIndexedDbAvailable()) {
    return Promise.reject(new IndexedDbUnavailableError());
  }
  if (dbOpenPromise) return dbOpenPromise;

  dbOpenPromise = new Promise<IDBDatabase>((resolve, reject) => {
 // First, open without specifying a version to get the current version.
 const probe = indexedDB.open(DB_NAME);

 probe.addEventListener('error', () => {
 reject(probe.error ?? new Error('[alert-store] Probe open failed'));
 });

 probe.addEventListener('success', () => {
 const currentDB = probe.result;
 const currentVersion = currentDB.version;

 if (currentDB.objectStoreNames.contains(STORE_NAME)) {
 // Store already exists — reuse this connection.
 dbInstance = currentDB;
 currentDB.addEventListener('close', () => { dbInstance = null; });
 // Let reasoning-memory (or any future module) upgrade the shared
 // crystalball_db without this connection blocking them.
 currentDB.addEventListener('versionchange', () => {
 currentDB.close();
 dbInstance = null;
 });
 resolve(currentDB);
 return;
 }

 // Need to create the store — close and reopen with bumped version.
 currentDB.close();

 openWithUpgrade(currentVersion).then(resolve, reject);
 });

 // Handle the case where the DB doesn't exist at all yet.
 probe.addEventListener('upgradeneeded', (event) => {
 const db = (event.target as IDBOpenDBRequest).result;

 // Preserve existing stores that storage.ts would create.
 if (!db.objectStoreNames.contains('baselines')) {
 db.createObjectStore('baselines', { keyPath: 'key' });
 }
 if (!db.objectStoreNames.contains('snapshots')) {
 const store = db.createObjectStore('snapshots', { keyPath: 'timestamp' });
 store.createIndex('by_time', 'timestamp');
 }
 if (!db.objectStoreNames.contains(STORE_NAME)) {
 const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
 createAlertIndexes(store);
 }
 });
  });
  // Clear the in-flight promise after settlement so future calls start fresh
  // rather than returning a permanently-rejected promise (sticky rejection
  // would silently disable alert-store persistence for the entire session).
  dbOpenPromise.finally(() => { dbOpenPromise = null; }).catch(() => { /* handled by callers */ });
  return dbOpenPromise;
}

/**
 * Run a read/write transaction against the unified_alerts store.
 * Retries once on InvalidStateError (stale connection).
 */
async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest | void,
  extractResult = false,
): Promise<T> {
  // Fast path for IndexedDB-less environments (smoke harness, headless
  // Node). Re-throw the sentinel so AlertDB callers can convert it to
  // a no-op default rather than crashing.
  if (!isIndexedDbAvailable()) throw new IndexedDbUnavailableError();
  for (let attempt = 0; attempt < 2; attempt++) {
 try {
 const db = await openDB();
 return await new Promise<T>((resolve, reject) => {
 const tx = db.transaction(STORE_NAME, mode);
 const store = tx.objectStore(STORE_NAME);
 const request = fn(store);
 if (request && extractResult) {
 request.addEventListener('success', () => resolve(request.result as T));
 request.addEventListener('error', () => {
 reject(request.error ?? new Error('[alert-store] Request failed'));
 });
 } else {
 tx.addEventListener('complete', () => resolve(undefined as T));
 tx.addEventListener('error', () => {
 reject(tx.error ?? new Error('[alert-store] Transaction failed'));
 });
 }
 });
 } catch (error: unknown) {
 if (error instanceof DOMException && error.name === 'InvalidStateError') {
 dbInstance = null;
 if (attempt === 0) continue;
 }
 throw error;
 }
  }
  throw new Error('[alert-store] Transaction failed after retry');
}

export interface AlertQueryOpts {
  since?: number;
  source?: string;
  severity?: string;
  limit?: number;
}

export interface AlertStats {
  total: number;
  bySource: Record<string, number>;
  bySeverity: Record<string, number>;
  thisWeek: number;
  lastWeek: number;
}

/** Initialize the AlertDB and run auto-prune. */
async function initAlertDB(instance: AlertDB): Promise<void> {
  try {
 await openDB();
 // Auto-prune on startup
 const pruned = await instance.prune();
 if (pruned > 0) {
 // eslint-disable-next-line no-console
 console.log(`[alert-store] Pruned ${pruned} alerts older than 30 days`);
 }
  } catch (error) {
 // eslint-disable-next-line no-console
 console.warn('[alert-store] Init failed:', error);
  }
}

/** Identify the no-IDB sentinel error so callers can degrade silently. */
function isUnavailableError(error: unknown): boolean {
  return error instanceof IndexedDbUnavailableError;
}

class AlertDB {
  private ready: Promise<void> | null = null;

  /** Wait for DB to be ready (used internally). Lazily triggers init on first call. */
  private ensureReady(): Promise<void> {
 this.ready ??= initAlertDB(this);
 return this.ready;
  }

  /** True when IndexedDB is unavailable (e.g. happy-dom smoke env).
   *  Public methods short-circuit to safe defaults in that case. */
  isAvailable(): boolean {
 return isIndexedDbAvailable();
  }

  /** Upsert a single alert. */
  async put(alert: UnifiedAlert): Promise<void> {
 if (!this.isAvailable()) return;
 await this.ensureReady();
 try {
 await withStore<void>('readwrite', (store) => store.put(alert));
 } catch (error) {
 if (isUnavailableError(error)) return;
 throw error;
 }
  }

  /** Batch upsert alerts in a single transaction. */
  async putBatch(alerts: UnifiedAlert[]): Promise<void> {
 if (alerts.length === 0) return;
 if (!this.isAvailable()) return;
 await this.ensureReady();

 try {
 const db = await openDB();
 return await new Promise<void>((resolve, reject) => {
 const tx = db.transaction(STORE_NAME, 'readwrite');
 const store = tx.objectStore(STORE_NAME);
 for (const alert of alerts) {
 store.put(alert);
 }
 tx.addEventListener('complete', () => resolve());
 tx.addEventListener('error', () => {
 reject(tx.error ?? new Error('[alert-store] Batch put failed'));
 });
 });
 } catch (error) {
 if (isUnavailableError(error)) return;
 throw error;
 }
  }

  /** Query alerts with optional filters. */
  async getAll(opts?: AlertQueryOpts): Promise<UnifiedAlert[]> {
 if (!this.isAvailable()) return [];
 await this.ensureReady();

 let all: UnifiedAlert[] | undefined;
 try {
 if (opts?.since != null) {
 // Use the 'timestamp' index + lowerBound to avoid a full table scan.
 // Only rows with timestamp >= since are returned by IDB, cutting
 // deserialization cost from the entire 30-day store to the query window.
 const since = opts.since;
 all = await withStore<UnifiedAlert[]>(
 'readonly',
 (store) => store.index('timestamp').getAll(IDBKeyRange.lowerBound(since)),
 true,
 );
 } else {
 all = await withStore<UnifiedAlert[]>(
 'readonly',
 (store) => store.getAll(),
 true,
 );
 }
 } catch (error) {
 if (isUnavailableError(error)) return [];
 throw error;
 }

 let results = all ?? [];

 if (opts?.source != null) {
 results = results.filter((a) => a.source === opts.source);
 }
 if (opts?.severity != null) {
 results = results.filter((a) => a.severity === opts.severity);
 }

 // Sort newest first
 results.sort((a, b) => b.timestamp - a.timestamp);

 if (opts?.limit != null && opts.limit > 0) {
 results = results.slice(0, opts.limit);
 }

 return results;
  }

  /** Full-text search across title and body (case-insensitive). */
  async search(text: string): Promise<UnifiedAlert[]> {
 if (!this.isAvailable()) return [];
 await this.ensureReady();

 let all: UnifiedAlert[] | undefined;
 try {
 all = await withStore<UnifiedAlert[]>(
 'readonly',
 (store) => store.getAll(),
 true,
 );
 } catch (error) {
 if (isUnavailableError(error)) return [];
 throw error;
 }

 const lower = text.toLowerCase();
 const results = (all ?? []).filter(
 (a) =>
 a.title.toLowerCase().includes(lower) ||
 a.body.toLowerCase().includes(lower),
 );

 results.sort((a, b) => b.timestamp - a.timestamp);
 return results;
  }

  /** Delete alerts older than 30 days. Returns count deleted. */
  async prune(): Promise<number> {
 if (!this.isAvailable()) return 0;
 const cutoff = Date.now() - THIRTY_DAYS_MS;

 try {
 const db = await openDB();
 return await new Promise<number>((resolve, reject) => {
 const tx = db.transaction(STORE_NAME, 'readwrite');
 const store = tx.objectStore(STORE_NAME);
 const index = store.index('timestamp');
 const range = IDBKeyRange.upperBound(cutoff, true);
 const request = index.openCursor(range);
 let deleted = 0;

 request.addEventListener('success', () => {
 const cursor = request.result;
 if (cursor) {
 cursor.delete();
 deleted++;
 cursor.continue();
 }
 });

 tx.addEventListener('complete', () => resolve(deleted));
 tx.addEventListener('error', () => {
 reject(tx.error ?? new Error('[alert-store] Prune failed'));
 });
 });
 } catch (error) {
 if (isUnavailableError(error)) return 0;
 throw error;
 }
  }

  /** Aggregate statistics for the alert store. */
  async getStats(): Promise<AlertStats> {
 if (!this.isAvailable()) {
 return { total: 0, bySource: {}, bySeverity: {}, thisWeek: 0, lastWeek: 0 };
 }
 await this.ensureReady();

 let all: UnifiedAlert[] | undefined;
 try {
 all = await withStore<UnifiedAlert[]>(
 'readonly',
 (store) => store.getAll(),
 true,
 );
 } catch (error) {
 if (isUnavailableError(error)) {
 return { total: 0, bySource: {}, bySeverity: {}, thisWeek: 0, lastWeek: 0 };
 }
 throw error;
 }

 const alerts = all ?? [];
 const now = Date.now();
 const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
 const thisWeekCutoff = now - oneWeekMs;
 const lastWeekCutoff = now - 2 * oneWeekMs;

 const bySource: Record<string, number> = {};
 const bySeverity: Record<string, number> = {};
 let thisWeek = 0;
 let lastWeek = 0;

 for (const alert of alerts) {
 bySource[alert.source] = (bySource[alert.source] ?? 0) + 1;
 bySeverity[alert.severity] = (bySeverity[alert.severity] ?? 0) + 1;

 if (alert.timestamp >= thisWeekCutoff) {
 thisWeek++;
 } else if (alert.timestamp >= lastWeekCutoff) {
 lastWeek++;
 }
 }

 return {
 total: alerts.length,
 bySource,
 bySeverity,
 thisWeek,
 lastWeek,
 };
  }
}

/** Singleton alert database instance. */
export const alertDB = new AlertDB();

// ── Phase 1.3 archive API ──────────────────────────────────────────────

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface ArchiveQueryOpts {
  source?: AlertSource;
  severity?: AlertSeverity;
  sinceMs?: number;
  limit?: number;
  searchText?: string;
}

export interface AlertTrendStats {
  totalAlerts: number;
  bySeverity: Record<AlertSeverity, number>;
  bySource: Record<string, number>;
  /** % change in totalAlerts vs the immediately preceding window of equal length. */
  deltaFromPrevious: number;
}

/** Archive a single alert to IndexedDB (30-day retention). */
export async function archiveAlert(alert: UnifiedAlert): Promise<void> {
  await alertDB.put(alert);
}

/** Query the archive with combined filters and optional full-text search. */
export async function getArchivedAlerts(opts: ArchiveQueryOpts = {}): Promise<UnifiedAlert[]> {
  const since = opts.sinceMs ?? Date.now() - SEVEN_DAYS_MS;
  const limit = opts.limit ?? 500;
  let results = await alertDB.getAll({
    since,
    source: opts.source,
    severity: opts.severity,
  });
  if (opts.searchText) {
    const lower = opts.searchText.toLowerCase();
    results = results.filter(
      (a) => a.title.toLowerCase().includes(lower) || a.body.toLowerCase().includes(lower),
    );
  }
  return results.slice(0, limit);
}

/** Compute trend stats for a window (default 7 days), with % delta vs the previous equal window. */
export async function getAlertTrendStats(windowMs: number = SEVEN_DAYS_MS): Promise<AlertTrendStats> {
  const now = Date.now();
  const currentSince = now - windowMs;
  const previousSince = now - 2 * windowMs;

  // Two targeted index-range queries instead of two full table scans.
  const current = await alertDB.getAll({ since: currentSince });
  // Previous window: [previousSince, currentSince) — bounded index range
  // avoids fetching current-window rows a second time.
  const previous = await withStore<UnifiedAlert[]>(
    'readonly',
    (store) => store
      .index('timestamp')
      .getAll(IDBKeyRange.bound(previousSince, currentSince, false, true)),
    true,
  ).catch(() => [] as UnifiedAlert[]);

  const bySeverity: Record<AlertSeverity, number> = {
    critical: 0, high: 0, medium: 0, low: 0, info: 0,
  };
  const bySource: Record<string, number> = {};
  for (const alert of current) {
    bySeverity[alert.severity] = (bySeverity[alert.severity] ?? 0) + 1;
    bySource[alert.source] = (bySource[alert.source] ?? 0) + 1;
  }

  const deltaFromPrevious = previous.length === 0
    ? (current.length === 0 ? 0 : 100)
    : ((current.length - previous.length) / previous.length) * 100;

  return {
    totalAlerts: current.length,
    bySeverity,
    bySource,
    deltaFromPrevious,
  };
}

/** Delete archived alerts older than the given age in ms. Returns count deleted. */
export async function pruneOldAlerts(olderThanMs: number): Promise<number> {
  const cutoff = Date.now() - olderThanMs;
  const db = await openDB();
  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('timestamp');
    const range = IDBKeyRange.upperBound(cutoff, true);
    const request = index.openCursor(range);
    let deleted = 0;
    request.addEventListener('success', () => {
      const cursor = request.result;
      if (cursor) {
        cursor.delete();
        deleted++;
        cursor.continue();
      }
    });
    tx.addEventListener('complete', () => resolve(deleted));
    tx.addEventListener('error', () => {
      reject(tx.error ?? new Error('[alert-store] pruneOldAlerts failed'));
    });
  });
}
