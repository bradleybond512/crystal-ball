/**
 * Feed resilience: circuit-breaker + ordered fallback + last-good cache.
 *
 * Self-contained — no imports from local-api-server.mjs.
 */
import https from 'node:https';

// ── Constants ────────────────────────────────────────────────────────────────
export const FAILURE_THRESHOLD = 3;
export const FAILURE_WINDOW_MS = 5 * 60 * 1000;   // 5 min
export const OPEN_DURATION_MS  = 10 * 60 * 1000;  // 10 min

// ── State ────────────────────────────────────────────────────────────────────
// { failureCount: number, windowStart: number|null, openSince: number|null }
const _circuits = new Map();

// { [key]: any }
const _cache = new Map();

// ── Circuit helpers ──────────────────────────────────────────────────────────
export function recordSuccess(key) {
  const entry = _circuits.get(key) ?? { failureCount: 0, windowStart: null, openSince: null };
  entry.failureCount = 0;
  entry.windowStart  = null;
  entry.openSince    = null;
  _circuits.set(key, entry);
}

export function recordFailure(key) {
  const now = Date.now();
  const entry = _circuits.get(key) ?? { failureCount: 0, windowStart: null, openSince: null };

  // Half-open probe failed → re-arm the open timer so the circuit stays open
  // for another full OPEN_DURATION_MS before the next half-open probe.
  if (entry.openSince !== null && now - entry.openSince >= OPEN_DURATION_MS) {
    entry.openSince = now;
    _circuits.set(key, entry);
    return;
  }

  // Reset window if it has expired (only when circuit is closed)
  if (entry.windowStart !== null && now - entry.windowStart > FAILURE_WINDOW_MS) {
    entry.failureCount = 0;
    entry.windowStart  = null;
  }

  if (entry.windowStart === null) {
    entry.windowStart = now;
  }

  entry.failureCount += 1;

  if (entry.failureCount >= FAILURE_THRESHOLD && entry.openSince === null) {
    entry.openSince = now;
  }

  _circuits.set(key, entry);
}

export function getCircuitState(key) {
  const entry = _circuits.get(key);
  if (!entry) return { status: 'closed', failureCount: 0, openSince: null };

  const { failureCount, openSince } = entry;

  if (openSince !== null) {
    const elapsed = Date.now() - openSince;
    const status = elapsed >= OPEN_DURATION_MS ? 'half-open' : 'open';
    return { status, failureCount, openSince };
  }

  return { status: 'closed', failureCount, openSince: null };
}

export function _resetCircuits() {
  _circuits.clear();
}

// ── Cache helpers ────────────────────────────────────────────────────────────
export function _getCached(key) {
  return _cache.has(key) ? _cache.get(key) : null;
}

export function _setCached(key, value) {
  if (value === null) {
    _cache.delete(key);
  } else {
    _cache.set(key, value);
  }
}

// ── Internal fetch ───────────────────────────────────────────────────────────
// HTTPS-only (all production feed URLs use TLS). Mirrors family:4 / IPv4
// pattern from local-api-server.mjs. Returns a Response-like object.
function _buildResponse(statusCode, body) {
  let parsed;
  let parseError;
  try { parsed = JSON.parse(body); } catch (error) { parseError = error; }
  return {
    ok         : statusCode >= 200 && statusCode < 300,
    status     : statusCode,
    _body      : body,
    _parsed    : parseError ? undefined : parsed,
    _parseError: parseError,
  };
}

function _fetchUrl(url, options = {}, timeoutMs = 12_000) {
  const u = new URL(url);
  const reqOpts = {
    hostname: u.hostname,
    port    : u.port || 443,
    path    : u.pathname + u.search,
    method  : options.method || 'GET',
    headers : options.headers || {},
    family  : 4,
  };

  return new Promise((resolve, reject) => {
    const req = https.request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(_buildResponse(res.statusCode, Buffer.concat(chunks).toString())));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Request timed out')));
    req.end();
  });
}

// ── Parse response data ──────────────────────────────────────────────────────
async function _parseData(resp) {
  if ('_parseError' in resp) {
    // Internal _fetchUrl response: JSON parse already attempted. A parse failure
    // (a 200 whose body is NOT valid JSON — an HTML error / captcha / maintenance
    // page) is NOT usable data. Return undefined so the caller treats it as a
    // failed attempt instead of caching the garbage as last-good + reporting
    // success. Every fetchWithFallback caller (NWS / NHC / WHO / USGS) is JSON.
    return resp._parseError ? undefined : resp._parsed;
  }
  // Injected fetchFn response: must be valid JSON; a parse failure is not data.
  try {
    return await resp.json();
  } catch {
    return undefined;
  }
}

// ── Single-URL attempt ───────────────────────────────────────────────────────
// Returns { ok: true, data } on success or { ok: false } on any failure.
async function _tryFetch(url, reqOptions, timeoutMs, fetchFn) {
  try {
    const resp = await fetchFn(url, reqOptions, timeoutMs);
    if (!resp.ok) return { ok: false };
    const data = await _parseData(resp);
    // A 200 with an unparseable body yields undefined — treat as a failed attempt
    // so we fall through to the next source / cache instead of returning garbage.
    if (data === undefined) return { ok: false };
    return { ok: true, data };
  } catch {
    return { ok: false };
  }
}

// ── fetchWithFallback ────────────────────────────────────────────────────────
export async function fetchWithFallback(primaryUrl, fallbacks = [], options = {}) {
  const {
    cacheKey  = null,
    timeoutMs = 12_000,
    fetchFn   = _fetchUrl,
    headers   = {},
  } = options;

  const reqOptions = { headers };

  // ── Try primary ────────────────────────────────────────────────────────────
  if (getCircuitState(primaryUrl).status !== 'open') {
    const result = await _tryFetch(primaryUrl, reqOptions, timeoutMs, fetchFn);
    if (result.ok) {
      recordSuccess(primaryUrl);
      if (cacheKey) _setCached(cacheKey, result.data);
      return { data: result.data, source: 'primary', degraded: false };
    }
    recordFailure(primaryUrl);
  }

  // ── Try fallbacks ──────────────────────────────────────────────────────────
  for (const [i, fallback] of fallbacks.entries()) {
    const result = await _tryFetch(fallback, reqOptions, timeoutMs, fetchFn);
    if (result.ok) {
      if (cacheKey) _setCached(cacheKey, result.data);
      return { data: result.data, source: `fallback-${i}`, degraded: true };
    }
  }

  // ── Cache fallback ─────────────────────────────────────────────────────────
  if (cacheKey) {
    const cached = _getCached(cacheKey);
    if (cached !== null) {
      return { data: cached, source: 'cached', degraded: true };
    }
  }

  throw new Error(`All sources exhausted for ${primaryUrl}`);
}
