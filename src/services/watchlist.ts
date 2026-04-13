/**
 * Watchlist — entities, keywords, and locations that boost alert relevance.
 *
 * Stored in localStorage for cross-session persistence. Used by normalizers
 * to stamp `relevanceScore = 100` on matching alerts, which the scoring
 * function multiplies by WATCHLIST_MULT.
 */

import { computeDistanceKm } from './unified-alerts';

const STORAGE_KEY = 'crystalball-watchlist-v1';

export interface WatchlistEntry {
  id: string;
  label: string;
  keywords: string[];
  lat?: number;
  lon?: number;
  radiusKm?: number;
}

let cache: WatchlistEntry[] | null = null;

export function getWatchlist(): WatchlistEntry[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cache = raw ? (JSON.parse(raw) as WatchlistEntry[]) : [];
  } catch { cache = []; }
  return cache!;
}

export function saveWatchlist(entries: WatchlistEntry[]): void {
  cache = entries;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch { /* full */ }
}

/**
 * Returns true if any watchlist entry matches the given text or geo point.
 * A match boosts the alert's relevance score.
 */
export function matchesWatchlist(opts: {
  text?: string;
  lat?: number;
  lon?: number;
}): boolean {
  const list = getWatchlist();
  if (list.length === 0) return false;
  const text = (opts.text ?? '').toLowerCase();
  for (const entry of list) {
    if (text && entry.keywords.some(k => k && text.includes(k.toLowerCase()))) return true;
    if (typeof opts.lat === 'number' && typeof opts.lon === 'number'
      && typeof entry.lat === 'number' && typeof entry.lon === 'number') {
      const r = entry.radiusKm ?? 100;
      if (computeDistanceKm(entry.lat, entry.lon, opts.lat, opts.lon) <= r) return true;
    }
  }
  return false;
}
