// Refresh cadence for quota-limited providers (R4-BUG-005 step 1).
//
// Each TTL gives nominal use at or under 80% for one cache miss per TTL,
// one query/key and one process. This is not a runtime spending governor:
// concurrent misses, failures, extra keys or restarts can exceed that estimate.
// tests/quota-budgets.test.mjs guards the nominal formula against TTL drift.
// Limits checked against provider docs on September 29, 2026.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const QUOTA_TTL_MS = Object.freeze({
  /** GreyNoise Community: 20 seed IPs per refresh, weekly. */
  greynoiseSeeds: 7 * DAY,
  /** AbuseIPDB blacklist endpoint. */
  abuseipdbBlacklist: 8 * HOUR,
  /** NewsAPI /v2/everything, one query. */
  newsapi: 20 * MINUTE,
  /** OpenSky global /states/all (shared by two routes). */
  openskyStates: 2 * MINUTE,
});

/**
 * Documented free limits and the cost of one refresh. `perRefresh` is in the
 * provider's own unit (lookups, requests, credits).
 */
export const QUOTA_BUDGETS = Object.freeze([
  { provider: 'GreyNoise Community', ttlKey: 'greynoiseSeeds', perRefresh: 20, limit: 50, windowMs: 7 * DAY },
  { provider: 'AbuseIPDB blacklist', ttlKey: 'abuseipdbBlacklist', perRefresh: 1, limit: 5, windowMs: DAY },
  { provider: 'NewsAPI', ttlKey: 'newsapi', perRefresh: 1, limit: 100, windowMs: DAY },
  { provider: 'OpenSky global states', ttlKey: 'openskyStates', perRefresh: 4, limit: 4000, windowMs: DAY },
]);

export const QUOTA_TARGET_SHARE = 0.8;

/** Worst-case use in one window: one refresh per TTL, rounded up. */
export function worstCaseUse({ ttlKey, perRefresh, windowMs }, ttls = QUOTA_TTL_MS) {
  return Math.ceil(windowMs / ttls[ttlKey]) * perRefresh;
}
