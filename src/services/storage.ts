import type { ReplayWatchSummary } from '@/services/replay-narrative';

const DB_NAME = 'crystalball_db';

interface BaselineEntry {
  key: string;
  counts: number[];
  timestamps: number[];
  avg7d: number;
  avg30d: number;
  lastUpdated: number;
}

let db: IDBDatabase | null = null;

function createStores(database: IDBDatabase): void {
  if (!database.objectStoreNames.contains('baselines')) {
 database.createObjectStore('baselines', { keyPath: 'key' });
  }

  if (!database.objectStoreNames.contains('snapshots')) {
 const store = database.createObjectStore('snapshots', { keyPath: 'timestamp' });
 store.createIndex('by_time', 'timestamp');
  }
}

function attachConn(conn: IDBDatabase, resolve: (database: IDBDatabase) => void): void {
  db = conn;
  conn.addEventListener('close', () => { db = null; });
  // Another module (reasoning-memory / alert-store) bumping the shared
  // crystalball_db version fires `versionchange` here. Close so the upgrade
  // isn't blocked; the next initDB() reopens at the new version.
  conn.addEventListener('versionchange', () => {
 conn.close();
 db = null;
  });
  resolve(conn);
}

/** Normalize an IDBRequest/transaction error (DOMException | null) to an Error
 *  for Promise rejection. */
function idbError(e: DOMException | null, context: string): Error {
  return new Error(e?.message ?? context);
}

function openWithUpgrade(currentVersion: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
 const request = indexedDB.open(DB_NAME, currentVersion + 1);
 request.addEventListener('error', () => reject(idbError(request.error, 'IndexedDB open failed')));
 request.addEventListener('blocked', () => reject(new Error('[storage] DB upgrade blocked by another open connection')));
 request.onupgradeneeded = (event) => {
 createStores((event.target as IDBOpenDBRequest).result);
 };
 request.onsuccess = () => attachConn(request.result, resolve);
  });
}

export async function initDB(): Promise<IDBDatabase> {
  if (db) return db;

  return new Promise((resolve, reject) => {
 // Open without a version first so we never request a version *lower* than
 // what alert-store / reasoning-memory may have already bumped the shared
 // crystalball_db to. Requesting a lower version throws "open ... using a
 // lower version than the existing version", which rejected initDB() and
 // broke every baseline/snapshot caller on boot.
 const probe = indexedDB.open(DB_NAME);

 probe.addEventListener('error', () => reject(idbError(probe.error, 'IndexedDB probe failed')));

 // Fires only when the DB does not exist yet (fresh DB created at v1) —
 // seed our stores immediately.
 probe.onupgradeneeded = (event) => {
 createStores((event.target as IDBOpenDBRequest).result);
 };

 probe.onsuccess = () => {
 const conn = probe.result;
 if (
 conn.objectStoreNames.contains('baselines') &&
 conn.objectStoreNames.contains('snapshots')
 ) {
 attachConn(conn, resolve);
 return;
 }
 // Stores missing on an existing (possibly already-bumped) DB — reopen
 // one version higher to add them, never requesting a lower version.
 const currentVersion = conn.version;
 conn.close();
 openWithUpgrade(currentVersion).then(resolve, reject);
 };
  });
}

async function withTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore, tx: IDBTransaction) => IDBRequest | void,
  extractResult?: boolean,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
 try {
 const database = await initDB();
 return await new Promise<T>((resolve, reject) => {
 const tx = database.transaction(storeName, mode);
 const store = tx.objectStore(storeName);
 const request = fn(store, tx);
 if (request && extractResult !== false) {
 request.onsuccess = () => resolve(request.result as T);
 request.addEventListener('error', () => reject(idbError(request.error, 'IndexedDB open failed')));
 } else {
 tx.oncomplete = () => resolve(undefined as T);
 tx.addEventListener('error', () => reject(idbError(tx.error, 'IndexedDB tx failed')));
 }
 });
 } catch (error: unknown) {
 if (error instanceof DOMException && error.name === 'InvalidStateError') {
 db = null;
 if (attempt === 0) continue;
 // eslint-disable-next-line no-console
 console.warn('[Storage] IndexedDB connection closing after retry');
 if (mode === 'readwrite') throw new DOMException('IndexedDB write failed — connection closing', 'InvalidStateError');
 return undefined as T;
 }
 throw error;
 }
  }
  throw new Error('IndexedDB transaction failed after retry');
}

export async function getBaseline(key: string): Promise<BaselineEntry | null> {
  const result = await withTransaction<BaselineEntry | undefined>(
 'baselines', 'readonly', (store) => store.get(key), true,
  );
  return result ?? null;
}

function mergeBaseline(existing: BaselineEntry | undefined, key: string, currentCount: number, now: number): BaselineEntry {
  const DAY_MS = 24 * 60 * 60 * 1000;

  if (!existing) {
 return {
 key,
 counts: [currentCount],
 timestamps: [now],
 avg7d: currentCount,
 avg30d: currentCount,
 lastUpdated: now,
 };
  }

  const entry = existing;
  entry.counts.push(currentCount);
  entry.timestamps.push(now);

  const cutoff30d = now - 30 * DAY_MS;
  const validIndices = entry.timestamps
 .map((t, i) => (t > cutoff30d ? i : -1))
 .filter(i => i >= 0);

  entry.counts = validIndices.map(i => entry.counts[i]!);
  entry.timestamps = validIndices.map(i => entry.timestamps[i]!);

  const cutoff7d = now - 7 * DAY_MS;
  const last7dCounts = entry.counts.filter((_, i) => entry.timestamps[i]! > cutoff7d);

  entry.avg7d = last7dCounts.length > 0
 ? last7dCounts.reduce((a, b) => a + b, 0) / last7dCounts.length
 : currentCount;

  entry.avg30d = entry.counts.length > 0
 ? entry.counts.reduce((a, b) => a + b, 0) / entry.counts.length
 : currentCount;

  entry.lastUpdated = now;
  return entry;
}

// Read-modify-write must happen inside a single readwrite transaction. Splitting
// the get and put across two transactions lets concurrent callers (e.g. two
// `news:intel` writers) read the same baseline and clobber each other's append,
// permanently dropping observations that skew avg7d/avg30d for anomaly detection.
export async function updateBaseline(key: string, currentCount: number): Promise<BaselineEntry> {
  const now = Date.now();

  for (let attempt = 0; attempt < 2; attempt++) {
 try {
 const database = await initDB();
 return await new Promise<BaselineEntry>((resolve, reject) => {
 const tx = database.transaction('baselines', 'readwrite');
 const store = tx.objectStore('baselines');
 const getReq = store.get(key);
 getReq.onsuccess = () => {
 const entry = mergeBaseline(getReq.result as BaselineEntry | undefined, key, currentCount, now);
 const putReq = store.put(entry);
 putReq.onsuccess = () => resolve(entry);
 putReq.addEventListener('error', () => reject(idbError(putReq.error, 'IndexedDB put failed')));
 };
 getReq.addEventListener('error', () => reject(idbError(getReq.error, 'IndexedDB get failed')));
 });
 } catch (error: unknown) {
 if (error instanceof DOMException && error.name === 'InvalidStateError') {
 db = null;
 if (attempt === 0) continue;
 // eslint-disable-next-line no-console
 console.warn('[Storage] IndexedDB connection closing after retry');
 throw new DOMException('IndexedDB write failed — connection closing', 'InvalidStateError');
 }
 throw error;
 }
  }
  throw new Error('IndexedDB transaction failed after retry');
}

export function calculateDeviation(current: number, baseline: BaselineEntry): {
  zScore: number;
  percentChange: number;
  level: 'normal' | 'elevated' | 'spike' | 'quiet';
} {
  const avg = baseline.avg7d;
  const counts = baseline.counts;

  if (counts.length < 3) {
 return { zScore: 0, percentChange: 0, level: 'normal' };
  }

  const variance = counts.reduce((sum, c) => sum + Math.pow(c - avg, 2), 0) / counts.length;
  const stdDev = Math.sqrt(variance) || 1;

  const zScore = (current - avg) / stdDev;
  const percentChange = avg > 0 ? ((current - avg) / avg) * 100 : 0;

  let level: 'normal' | 'elevated' | 'spike' | 'quiet' = 'normal';
  if (zScore > 2.5) level = 'spike';
  else if (zScore > 1.5) level = 'elevated';
  else if (zScore < -2) level = 'quiet';

  return {
 zScore: Math.round(zScore * 100) / 100,
 percentChange: Math.round(percentChange),
 level,
  };
}

export async function getAllBaselines(): Promise<BaselineEntry[]> {
  return (await withTransaction<BaselineEntry[]>(
 'baselines', 'readonly', (store) => store.getAll(), true,
  )) || [];
}

// Snapshot types and functions
export interface DashboardSnapshot {
  timestamp: number;
  events: unknown[];
  marketPrices: Record<string, number>;
  predictions: { title: string; yesPrice: number }[];
  hotspotLevels: Record<string, string>;
  watchlistSummary?: ReplayWatchSummary | null;
}

const SNAPSHOT_RETENTION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Hard count ceiling on top of the 7-day window. Each DashboardSnapshot is
 *  ~0.3 MB, so this bounds the store at ~45 MB even if a boot loop or a busy
 *  day saves far more than the usual ~25/day (the fastest-growing IDB store). */
const MAX_SNAPSHOTS = 150;

export async function saveSnapshot(snapshot: DashboardSnapshot): Promise<void> {
  await withTransaction<void>(
 'snapshots', 'readwrite', (store) => { store.put(snapshot); }, false,
  );
}

export async function getSnapshots(fromTime?: number, toTime?: number): Promise<DashboardSnapshot[]> {
  const from = fromTime ?? Date.now() - SNAPSHOT_RETENTION_DAYS * DAY_MS;
  const to = toTime ?? Date.now();

  return (await withTransaction<DashboardSnapshot[]>(
 'snapshots', 'readonly',
 (store) => store.index('by_time').getAll(IDBKeyRange.bound(from, to)),
 true,
  )) || [];
}

export async function getSnapshotAt(timestamp: number): Promise<DashboardSnapshot | null> {
  const snapshots = await getSnapshots(timestamp - 15 * 60 * 1000, timestamp + 15 * 60 * 1000);
  if (snapshots.length === 0) return null;

  // Find closest snapshot to requested time
  return snapshots.reduce((closest, snap) =>
 Math.abs(snap.timestamp - timestamp) < Math.abs(closest.timestamp - timestamp) ? snap : closest,
  snapshots[0]!);
}

export async function cleanOldSnapshots(): Promise<void> {
  const cutoff = Date.now() - SNAPSHOT_RETENTION_DAYS * DAY_MS;

  // 1. Time retention — drop anything older than the window.
  await withTransaction<void>(
 'snapshots', 'readwrite',
 (store) => {
 const request = store.index('by_time').openCursor(IDBKeyRange.upperBound(cutoff));
 request.onsuccess = () => {
 const cursor = request.result;
 if (cursor) { cursor.delete(); cursor.continue(); }
 };
 },
 false,
  );

  // 2. Hard count cap — keep only the newest MAX_SNAPSHOTS (deletes oldest-first).
  await withTransaction<void>(
 'snapshots', 'readwrite',
 (store) => {
 const countReq = store.count();
 countReq.onsuccess = () => {
 const excess = countReq.result - MAX_SNAPSHOTS;
 if (excess <= 0) return;
 let removed = 0;
 const cursorReq = store.index('by_time').openCursor(); // ascending ⇒ oldest first
 cursorReq.onsuccess = () => {
 const cursor = cursorReq.result;
 if (cursor && removed < excess) { cursor.delete(); removed += 1; cursor.continue(); }
 };
 };
 },
 false,
  );
}

export async function getSnapshotTimestamps(): Promise<number[]> {
  return (await withTransaction<number[]>(
 'snapshots', 'readonly', (store) => store.getAllKeys() as IDBRequest<number[]>, true,
  )) || [];
}
