// Refresh cadence for quota-limited providers (R4-BUG-005 step 1).
//
// Each TTL is chosen so worst-case use (one upstream call per TTL, all day,
// every day) stays at or under 80% of the provider's documented free limit,
// leaving headroom for on-demand lookups. `tests/quota-budgets.test.mjs`
// enforces that, so a future TTL change that breaks a budget fails CI.
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
  /** PurpleAir, small box around a saved place. */
  purpleairBbox: 60 * MINUTE,
  /** PurpleAir worldwide snapshot (Bradley: once a day). */
  purpleairGlobal: DAY,
});

/** PurpleAir: only sensors reporting within the last hour (fewer rows = fewer points). */
export const PURPLEAIR_MAX_AGE_S = 3600;

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

// ── Quota Governor rules (R4-BUG-005 step 2) ─────────────────────────────
//
// Every sidecar call to a matching host/path is counted before it is sent
// (see quota-governor.mjs). Limits are the documented free limits checked
// on September 29, 2026; `unverified` marks one that was not. A window with
// `limit: null` is tracked and shown but never blocks: those providers are
// governed only by their own 429 / rate-limit headers (Bradley's decisions:
// PurpleAir points are an estimate with no app cap; Anthropic spend is
// guarded by the Console's monthly limit).

const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const SECOND = 1000;

/** OpenSky /states/* credits by bounding-box area (OpenSky REST docs). */
export function openskyStatesCost(url) {
  const box = ['lamin', 'lamax', 'lomin', 'lomax'].map((k) => Number.parseFloat(url.searchParams.get(k) ?? ''));
  if (box.some((v) => !Number.isFinite(v))) return 4;
  const area = (box[1] - box[0]) * (box[3] - box[2]);
  if (Number.isNaN(area) || area < 0) return 4;
  if (area <= 25) return 1;
  if (area <= 100) return 2;
  if (area <= 400) return 3;
  return 4;
}

/** PurpleAir fields requested (each field costs points per returned row). */
export function purpleairFieldCount(url) {
  const fields = url.searchParams.get('fields');
  return fields ? fields.split(',').filter(Boolean).length : 1;
}

export const QUOTA_RULES = Object.freeze([
  { id: 'greynoise', label: 'GreyNoise Community', host: 'api.greynoise.io', pathPrefix: '/v3/community/', unit: 'lookups', secretKeys: ['GREYNOISE_API_KEY'], windows: [{ ms: WEEK, limit: 50 }] },
  { id: 'abuseipdb-blacklist', label: 'AbuseIPDB blacklist', host: 'api.abuseipdb.com', pathPrefix: '/api/v2/blacklist', unit: 'requests', secretKeys: ['ABUSEIPDB_API_KEY'], windows: [{ ms: DAY, limit: 5 }] },
  { id: 'abuseipdb-check', label: 'AbuseIPDB check', host: 'api.abuseipdb.com', pathPrefix: '/api/v2/check', unit: 'requests', secretKeys: ['ABUSEIPDB_API_KEY'], windows: [{ ms: DAY, limit: 1000 }] },
  { id: 'opensky-states', label: 'OpenSky states', host: 'opensky-network.org', pathPrefix: '/api/states/', unit: 'credits', secretKeys: ['OPENSKY_CLIENT_ID', 'OPENSKY_CLIENT_SECRET'], windows: [{ ms: DAY, limit: 4000 }], cost: openskyStatesCost },
  { id: 'newsapi', label: 'NewsAPI', host: 'newsapi.org', pathPrefix: '/v2/', unit: 'requests', secretKeys: ['NEWSAPI_KEY'], windows: [{ ms: DAY, limit: 100 }] },
  { id: 'purpleair', label: 'PurpleAir', host: 'api.purpleair.com', pathPrefix: '/v1/', unit: 'points', estimate: true, secretKeys: ['PURPLEAIR_API_KEY'], windows: [{ ms: MONTH, limit: null }], pointsPerRow: purpleairFieldCount },
  { id: 'openweathermap', label: 'OpenWeatherMap', host: 'api.openweathermap.org', pathPrefix: '/', unit: 'requests', secretKeys: ['OWM_API_KEY'], windows: [{ ms: MONTH, limit: 1_000_000 }, { ms: MINUTE, limit: 60 }] },
  { id: 'virustotal', label: 'VirusTotal', host: 'www.virustotal.com', pathPrefix: '/api/v3/', unit: 'requests', secretKeys: ['VIRUSTOTAL_API_KEY'], windows: [{ ms: DAY, limit: 500 }, { ms: MINUTE, limit: 4 }] },
  { id: 'geonames', label: 'GeoNames', host: 'secure.geonames.org', pathPrefix: '/', unit: 'credits', secretKeys: ['GEONAMES_USERNAME'], windows: [{ ms: DAY, limit: 10_000 }, { ms: HOUR, limit: 1000 }] },
  { id: 'newsdata', label: 'NewsData.io', host: 'newsdata.io', pathPrefix: '/api/1/', unit: 'credits', unverified: true, secretKeys: ['NEWSDATA_API_KEY'], windows: [{ ms: DAY, limit: 200 }] },
  { id: 'openrouter', label: 'OpenRouter (free models)', host: 'openrouter.ai', pathPrefix: '/api/v1/', unit: 'requests', secretKeys: ['OPENROUTER_API_KEY'], windows: [{ ms: DAY, limit: 50 }, { ms: MINUTE, limit: 20 }] },
  { id: 'groq', label: 'Groq', host: 'api.groq.com', pathPrefix: '/openai/v1/', unit: 'requests', secretKeys: ['GROQ_API_KEY'], windows: [{ ms: DAY, limit: null }] },
  { id: 'anthropic', label: 'Anthropic', host: 'api.anthropic.com', pathPrefix: '/v1/messages', unit: 'requests', tracksTokens: true, secretKeys: ['ANTHROPIC_API_KEY'], windows: [{ ms: MONTH, limit: null }] },
]);

/** Cooldown bounds: a provider header can never pause a feed for longer than its window. */
export const QUOTA_MIN_COOLDOWN_MS = MINUTE;
export const QUOTA_DEFAULT_COOLDOWN_MS = HOUR;
/** A non-governed host that answers 429 + Retry-After is left alone for at most this long. */
export const QUOTA_GENERIC_COOLDOWN_MAX_MS = HOUR;
/** Background use at or above this share of the background ceiling doubles refresh intervals. */
export const QUOTA_PACING_SHARE = 0.8;
export const QUOTA_PACING_FACTOR = 2;
export const QUOTA_LEDGER_WRITE_DELAY_MS = SECOND;
