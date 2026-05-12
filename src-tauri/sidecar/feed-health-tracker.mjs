/**
 * Feed health tracker: circuit-breaker-aware per-feed status.
 *
 * Self-contained — no imports from local-api-server.mjs.
 */

// ── State ─────────────────────────────────────────────────────────────────────
// { feedId, status, lastSuccess, lastAttempt, lastError, lastSource }
const _feeds = new Map();

// ── Exports ───────────────────────────────────────────────────────────────────

/**
 * Record that a feed fetch succeeded.
 * @param {string} feedId
 * @param {string} source  - 'primary' | 'fallback-0' | ... | 'cached'
 * @param {number} [atMs]
 */
export function trackSuccess(feedId, source, atMs = Date.now()) {
  if (!feedId) return;
  const entry = _feeds.get(feedId) ?? { feedId };
  entry.lastSuccess = atMs;
  entry.lastAttempt = atMs;
  entry.lastError = null;
  entry.lastSource = source ?? null;
  entry.status = source === 'primary' ? 'up' : 'degraded';
  _feeds.set(feedId, entry);
}

/**
 * Record that a feed fetch failed (all sources exhausted or threw).
 * @param {string} feedId
 * @param {string|Error} error
 * @param {number} [atMs]
 */
export function trackFailure(feedId, error, atMs = Date.now()) {
  if (!feedId) return;
  const entry = _feeds.get(feedId) ?? { feedId };
  entry.lastAttempt = atMs;
  entry.lastError = String(error?.message ?? error ?? 'unknown error');
  entry.lastSource = null;
  entry.status = 'down';
  _feeds.set(feedId, entry);
}

/**
 * Returns the current health status of one feed.
 * @param {string} feedId
 * @returns {{ feedId: string, status: 'up'|'degraded'|'down'|'unknown', lastSuccess: number|null, lastAttempt: number|null, lastError: string|null, lastSource: string|null }}
 */
export function getFeedStatus(feedId) {
  const entry = _feeds.get(feedId);
  if (!entry) {
    return { feedId, status: 'unknown', lastSuccess: null, lastAttempt: null, lastError: null, lastSource: null };
  }
  return {
    feedId: entry.feedId,
    status: entry.status ?? 'unknown',
    lastSuccess: entry.lastSuccess ?? null,
    lastAttempt: entry.lastAttempt ?? null,
    lastError: entry.lastError ?? null,
    lastSource: entry.lastSource ?? null,
  };
}

/**
 * Returns status for all tracked feeds, sorted by feedId.
 * @returns {Array<ReturnType<typeof getFeedStatus>>}
 */
export function getAllFeedStatuses() {
  return [..._feeds.keys()]
    .sort()
    .map(feedId => getFeedStatus(feedId));
}

/**
 * For tests — clears all state.
 */
export function _resetFeedHealthTracker() {
  _feeds.clear();
}
