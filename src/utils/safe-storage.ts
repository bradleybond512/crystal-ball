/**
 * Quota-safe localStorage writes.
 *
 * Long sessions accumulate cache entries until `localStorage` fills. Once full,
 * every bare `localStorage.setItem` throws `QuotaExceededError` synchronously —
 * and an unhandled throw inside a refresh tick or click handler seizes the
 * renderer thread (observed: 10-minute paints, multi-hundred-second refreshes).
 *
 * `safeSetItem` makes a write attempt, and on quota failure evicts the LARGEST
 * disposable cache entries first (freeing the most bytes per deletion), then
 * retries exactly once. If it still can't fit, it trips the shared quota latch
 * and returns `false` — it NEVER throws to the caller. Precious keys (settings,
 * consent, installation id, watchlist, saved places) are never evicted; only the
 * allowlisted re-fetchable cache namespaces are.
 */

import { isQuotaError, markStorageQuotaExceeded, _resetStorageQuotaForTest } from './storage-quota';

/**
 * Key prefixes whose entries are disposable — safe to drop under quota pressure
 * because the data is either re-fetchable on the next refresh or a loss-tolerant
 * rolling buffer. Anything NOT matching one of these (settings, consent,
 * installation id, watchlist, saved places, themes, map state) is treated as
 * precious and never evicted.
 */
export const EVICTABLE_CACHE_PREFIXES: readonly string[] = [
  // Re-fetchable derived caches (largest byte-hogs — most reclaimed per delete).
  // `crystalball-persistent-cache:` also covers proxy `api-response:` entries,
  // which are nested under it (setPersistentCache re-prefixes the key) rather
  // than stored raw.
  'crystalball-persistent-cache:',   // persistent-cache.ts localStorage fallback
  'crystalball-market-stale-',       // market/index.ts stale fallback
  // offline-alert-cache.ts last-known snapshots — saved-place-weather,
  // place-briefs, local-logistics and every other offline-cached service write
  // under the `wm_offline_<serviceId>` prefix, not their raw service names.
  'wm_offline_',
  // High-frequency writers + loss-tolerant rolling buffers (the log-spam sources).
  'wm-analytics-offline-queue',      // analytics.ts offline event queue
  'crystalball-pressure-history-v1', // pressure-history.ts sparkline samples
  'crystalball-snapshot-archive-v1', // snapshot-archive.ts 120-entry ring
  'crystalball-briefing-archive-v1', // briefing-archive.ts 200-entry ring
  // Re-derivable reasoning/cognition stores. These grow the FASTEST and LARGEST
  // (observed: a single session accumulated 4.9 MB across these, exhausting the
  // ~5 MB localStorage quota and seizing the renderer). Every one is recomputed
  // from live feeds + IndexedDB on the next analyst pass, so dropping them under
  // pressure loses nothing durable. Listed explicitly (not a blanket `wm-`
  // prefix) so the precious small wm-* keys — wm_saved_places_v1,
  // wm-country-watchlist-v1, wm_proximity_config, wm-basemap, wm-situational-mode,
  // consent flags — are NEVER evicted.
  'wm-assumption-annotations',       // assumption-tracker.ts (largest single hog)
  'wm-assumptions',                  // assumption-tracker-v2.ts
  'wm-quality-debt',                 // quality-debt.ts (+ wm-quality-debt-tracker)
  'wm-cognitive-bias-detections',    // cognitive-bias detector cache
  'wm-safety-case',                  // safety-case store
  'wm-intelligence-health',          // intelligence-health snapshot
  'wm-mission-control',              // mission-control derived state
  'wm-situation-store-v2',           // situation-store-v2.ts
  'wm-situation-timeline',           // situation timeline
  'wm-situations-v1',                // legacy situations cache
  'wm-counterfactuals',              // counterfactual reasoning cache
  'wm-meta-confidence',              // meta-confidence store
  'wm-world-narrative',              // world-narrative cache
  'wm-crisis-trajectories',          // crisis-trajectory projections
  'wm-multi-agent-review',           // multi-agent review cache
  'wm-hypothesis-sets',              // competitive-hypothesis.ts
  'wm-domain-dependency',            // domain-dependency graph cache
  'wm-domain-scorecard',             // wm-domain-scorecards + -snapshots
  'wm-model-governance',             // model-governance cache
  'wm-collection-gaps',              // collection-gap analysis cache
  'wm-bias-signals',                 // bias-signal cache
  'wm-algo-eval-ledger',             // algorithm evaluation ledger (re-graded)
  'wm-intelligence-briefing-v1',     // derived intelligence briefing
  'wm-unified-alerts-v1',            // unified-alerts.ts derived alert cache
];

function isEvictable(key: string): boolean {
  return EVICTABLE_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

interface EvictableEntry {
  key: string;
  size: number;
}

/**
 * Drop evictable cache entries largest-first until at least `targetBytes` have
 * been freed (or the evictable set is exhausted). Returns the number removed.
 */
function evictLargestCache(targetBytes: number): number {
  const entries: EvictableEntry[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !isEvictable(key)) continue;
    const value = localStorage.getItem(key) ?? '';
    entries.push({ key, size: key.length + value.length });
  }
  entries.sort((a, b) => b.size - a.size);

  let freed = 0;
  let removed = 0;
  for (const entry of entries) {
    localStorage.removeItem(entry.key);
    freed += entry.size;
    removed += 1;
    if (freed >= targetBytes) break;
  }
  return removed;
}

/**
 * Write to localStorage without ever throwing.
 *
 * @returns `true` if the value was persisted, `false` if it could not be
 *          (quota exhausted after eviction, or a non-quota storage error).
 */
export function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    if (!isQuotaError(error)) {
      // SecurityError (storage disabled), etc. — nothing to evict, just fail closed.
      return false;
    }
  }

  // Quota hit: reclaim space from disposable cache, then retry once.
  const needed = key.length + value.length;
  const removed = evictLargestCache(needed);
  if (removed === 0) {
    // Nothing left to evict — the retry would fail identically.
    markStorageQuotaExceeded();
    return false;
  }

  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    if (isQuotaError(error)) markStorageQuotaExceeded();
    return false;
  }
}

/**
 * Monkey-patch `localStorage.setItem` so EVERY caller gets quota-safe
 * eviction automatically — even the ~100 bare `localStorage.setItem` calls
 * across the codebase that don't use `safeSetItem`.
 *
 * Must be called once at boot (main.ts), before any data-loading begins.
 */
export function installLocalStoragePatch(): void {
  if (typeof localStorage === 'undefined') return;
  if ((globalThis as Record<string, unknown>).__lsPatchInstalled) return;

  const nativeSetItem = localStorage.setItem.bind(localStorage);

  localStorage.setItem = (key: string, value: string): void => {
    try {
      nativeSetItem(key, value);
    } catch (error) {
      if (!isQuotaError(error)) throw error;
      const needed = key.length + value.length;
      const removed = evictLargestCache(needed);
      if (removed === 0) {
        markStorageQuotaExceeded();
        return; // swallow — nothing left to evict
      }
      try {
        nativeSetItem(key, value);
      } catch (retryError) {
        if (isQuotaError(retryError)) markStorageQuotaExceeded();
        // swallow — never throw QuotaExceededError to unsuspecting callers
      }
    }
  };

  (globalThis as Record<string, unknown>).__lsPatchInstalled = true;
}

/** Test-only: reset the shared quota latch between cases. */
export function _resetQuotaLatchForTest(): void {
  _resetStorageQuotaForTest();
}
