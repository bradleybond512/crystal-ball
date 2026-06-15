// src/services/survival/snapshot-store.ts
import type { WorldSnapshot } from './survival-types.ts';

const DB_NAME = 'crystalball_db';
const STORE = 'survival_snapshots';
const KEY = 'latest';

let dbInstance: IDBDatabase | null = null;
let openPromise: Promise<IDBDatabase> | null = null;

function attach(db: IDBDatabase): void {
  db.addEventListener('close', () => { dbInstance = null; });
  db.addEventListener('versionchange', () => { db.close(); dbInstance = null; });
}

function upgrade(version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, version + 1);
    req.addEventListener('upgradeneeded', () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    });
    req.addEventListener('success', () => { dbInstance = req.result; attach(req.result); resolve(req.result); });
    req.addEventListener('error', () => reject(req.error ?? new Error('upgrade failed')));
    req.addEventListener('blocked', () => reject(new Error('snapshot-store upgrade blocked by an open crystalball_db connection')));
  });
}

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);
  if (openPromise) return openPromise;
  openPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const probe = indexedDB.open(DB_NAME);
    probe.addEventListener('success', () => {
      const db = probe.result;
      if (db.objectStoreNames.contains(STORE)) { dbInstance = db; attach(db); resolve(db); return; }
      const v = db.version; db.close(); upgrade(v).then(resolve, reject);
    });
    probe.addEventListener('error', () => reject(probe.error ?? new Error('probe failed')));
  });
  openPromise.finally(() => { openPromise = null; }).catch(() => { /* swallow */ });
  return openPromise;
}

export async function saveSnapshot(snapshot: WorldSnapshot): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ id: KEY, snapshot, updatedAt: snapshot.capturedAtMs });
      tx.addEventListener('complete', () => resolve());
      tx.addEventListener('error', () => reject(tx.error ?? new Error('put failed')));
    });
  } catch { /* save failed — grid-down persistence is best-effort */ }
}

interface SnapshotRecord { id: string; snapshot: WorldSnapshot; updatedAt: number; }

export async function loadLatestSnapshot(): Promise<WorldSnapshot | null> {
  try {
    const db = await openDB();
    return await new Promise<WorldSnapshot | null>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.addEventListener('success', () => {
        const record = req.result as SnapshotRecord | undefined;
        resolve(record?.snapshot ?? null);
      });
      req.addEventListener('error', () => resolve(null));
    });
  } catch { return null; }
}
