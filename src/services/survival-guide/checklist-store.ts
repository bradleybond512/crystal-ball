/**
 * Persisted survival-checklist state: which ChecklistItem ids are ticked.
 *
 * Singleton (module closure). Persists to localStorage key
 * `cb-survival-checklist` via the quota-safe writer. The key is deliberately
 * NOT in EVICTABLE_CACHE_PREFIXES, so quota-pressure eviction never wipes the
 * user's prep state. Degrades to in-memory when storage is unavailable —
 * guides stay readable, ticks last the session, nothing throws.
 */

import { safeSetItem } from '@/utils/safe-storage';

const STORAGE_KEY = 'cb-survival-checklist';
const VERSION = 1;

let checked = new Set<string>();
let hydrated = false;
const listeners = new Set<() => void>();

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { v?: number; checked?: unknown };
    if (parsed?.v === VERSION && Array.isArray(parsed.checked)) {
      checked = new Set(parsed.checked.filter((x): x is string => typeof x === 'string'));
    }
  } catch {
    // Corrupt/absent — start empty.
  }
}

function persist(): void {
  try {
    safeSetItem(STORAGE_KEY, JSON.stringify({ v: VERSION, checked: [...checked] }));
  } catch {
    // safeSetItem never throws; guard is belt-and-suspenders for the shim.
  }
}

function notify(): void {
  for (const fn of listeners) fn();
}

export function getCheckedIds(): ReadonlySet<string> {
  hydrate();
  return checked;
}

export function isChecked(id: string): boolean {
  hydrate();
  return checked.has(id);
}

export function setChecked(id: string, value: boolean): void {
  hydrate();
  const had = checked.has(id);
  if (value && !had) checked.add(id);
  else if (!value && had) checked.delete(id);
  else return;
  persist();
  notify();
}

export function toggle(id: string): void {
  setChecked(id, !isChecked(id));
}

/** Drop any checked id not present in `validIds` (content edits). */
export function pruneUnknown(validIds: ReadonlySet<string>): void {
  hydrate();
  let changed = false;
  for (const id of checked) {
    if (!validIds.has(id)) {
      checked.delete(id);
      changed = true;
    }
  }
  if (changed) {
    persist();
    notify();
  }
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only. */
export function _resetForTest(): void {
  checked = new Set();
  hydrated = false;
  listeners.clear();
}
/** Test-only: force a re-read from storage. */
export function _hydrateForTest(): void {
  hydrate();
}
