/**
 * IndexedDB-backed alert store for 30-day alert persistence.
 *
 * Uses the shared `crystalball_db` database and adds a `unified_alerts`
 * object store via a version bump if it doesn't already exist.
 *
 * Exported singleton: `alertDB`
 */

import type { UnifiedAlert } from './unified-alerts';

const DB_NAME = 'crystalball_db';
const STORE_NAME = 'unified_alerts';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

let dbInstance: IDBDatabase | null = null;

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

  return new Promise<IDBDatabase>((resolve, reject) => {
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

class AlertDB {
  private ready: Promise<void> | null = null;

  /** Wait for DB to be ready (used internally). Lazily triggers init on first call. */
  private ensureReady(): Promise<void> {
 this.ready ??= initAlertDB(this);
 return this.ready;
  }

  /** Upsert a single alert. */
  async put(alert: UnifiedAlert): Promise<void> {
 await this.ensureReady();
 await withStore<void>('readwrite', (store) => store.put(alert));
  }

  /** Batch upsert alerts in a single transaction. */
  async putBatch(alerts: UnifiedAlert[]): Promise<void> {
 if (alerts.length === 0) return;
 await this.ensureReady();

 const db = await openDB();
 return new Promise<void>((resolve, reject) => {
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
  }

  /** Query alerts with optional filters. */
  async getAll(opts?: AlertQueryOpts): Promise<UnifiedAlert[]> {
 await this.ensureReady();

 const all = await withStore<UnifiedAlert[]>(
 'readonly',
 (store) => store.getAll(),
 true,
 );

 let results = all ?? [];

 if (opts?.since != null) {
 results = results.filter((a) => a.timestamp >= opts.since!);
 }
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
 await this.ensureReady();

 const all = await withStore<UnifiedAlert[]>(
 'readonly',
 (store) => store.getAll(),
 true,
 );

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
 const cutoff = Date.now() - THIRTY_DAYS_MS;

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
 reject(tx.error ?? new Error('[alert-store] Prune failed'));
 });
 });
  }

  /** Aggregate statistics for the alert store. */
  async getStats(): Promise<AlertStats> {
 await this.ensureReady();

 const all = await withStore<UnifiedAlert[]>(
 'readonly',
 (store) => store.getAll(),
 true,
 );

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
