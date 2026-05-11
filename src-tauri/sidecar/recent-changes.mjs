/**
 * Pure helper — no side-effects, no fetch.
 * Synthesises the "what changed in the last hour" tape from in-process data
 * already available in the sidecar: the feed-health tracker and the IPAWS
 * alert cache.
 */

const ALERT_WINDOW_MS = 60 * 60 * 1000;   // 60 min
const STALE_FEED_THRESHOLD_MS = 30 * 60 * 1000; // 30 min without success

/**
 * @param {Array<{key: string, lastSuccessAt: number|null, lastError: string|null, lastAttemptAt: number|null}>} feedSnapshots
 * @param {{alerts: Array<{event: string, headline: string, effective: string}>}|null} alertCache
 * @param {number} nowMs
 * @returns {{items: Array<{type: string, label: string, ageMs: number}>}}
 */
export function buildRecentChanges(feedSnapshots, alertCache, nowMs) {
  const items = [];
  collectAlerts(items, alertCache, nowMs);
  collectStaleFeeds(items, feedSnapshots, nowMs);
  items.sort((a, b) => a.ageMs - b.ageMs);
  return { items };
}

function collectAlerts(items, alertCache, nowMs) {
  if (!Array.isArray(alertCache?.alerts)) return;
  for (const alert of alertCache.alerts) {
    const effectiveMs = alert.effective ? Date.parse(alert.effective) : Number.NaN;
    if (Number.isNaN(effectiveMs) || effectiveMs > nowMs) continue;
    const ageMs = nowMs - effectiveMs;
    if (ageMs > ALERT_WINDOW_MS) continue;
    const label = alert.headline || alert.event || 'Alert';
    items.push({ type: 'alert', label, ageMs });
  }
}

function collectStaleFeeds(items, feedSnapshots, nowMs) {
  if (!Array.isArray(feedSnapshots)) return;
  for (const feed of feedSnapshots) {
    if (!feed.lastError || feed.lastAttemptAt == null) continue;
    const sinceSuccess = feed.lastSuccessAt == null
      ? Number.POSITIVE_INFINITY
      : nowMs - feed.lastSuccessAt;
    if (sinceSuccess < STALE_FEED_THRESHOLD_MS) continue;
    const ageMs = nowMs - feed.lastAttemptAt;
    if (ageMs > ALERT_WINDOW_MS) continue;
    items.push({ type: 'stale_feed', label: `${feed.key} feed error`, ageMs });
  }
}
