import { safeSetItem } from '@/utils/safe-storage';

const PINNED_KEY = 'crystalball-pinned-webcams';
const listeners = new Set<() => void>();

export function getPinnedIds(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function isPinned(id: string): boolean {
  return getPinnedIds().includes(id);
}

function persist(ids: string[]): void {
  safeSetItem(PINNED_KEY, JSON.stringify(ids));
  for (const cb of listeners) cb();
}

export function pinFeed(id: string): void {
  const current = getPinnedIds();
  if (current.includes(id)) return;
  persist([...current, id]);
}

export function unpinFeed(id: string): void {
  const current = getPinnedIds();
  if (!current.includes(id)) return;
  persist(current.filter((x) => x !== id));
}

/** Toggle pinned state for a feed id. Returns the new pinned state. */
export function togglePin(id: string): boolean {
  const current = getPinnedIds();
  if (current.includes(id)) {
    persist(current.filter((x) => x !== id));
    return false;
  }
  persist([...current, id]);
  return true;
}

/** Subscribe to pin/unpin changes. Returns an unsubscribe function. */
export function onPinnedChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
