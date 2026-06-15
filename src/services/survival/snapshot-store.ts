// src/services/survival/snapshot-store.ts
import type { WorldSnapshot } from './survival-types.ts';

const KEY = 'cb:survival-snapshot/v1';

/** Persist the latest survival snapshot for grid-down restore. localStorage
 *  (not IndexedDB) — a single small snapshot needs no object store, and this
 *  avoids any shared-DB version-bump/blocking on crystalball_db. */
export function saveSnapshot(snapshot: WorldSnapshot): Promise<void> {
  try {
    localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    /* best-effort: quota/serialization failures must not break the panel */
  }
  return Promise.resolve();
}

export function loadLatestSnapshot(): Promise<WorldSnapshot | null> {
  try {
    const raw = localStorage.getItem(KEY);
    return Promise.resolve(raw ? (JSON.parse(raw) as WorldSnapshot) : null);
  } catch {
    return Promise.resolve(null);
  }
}
