/**
 * S2U TAK Marti API client — per
 * docs/CLAUDE_S2U_INTEGRATION_2026-05-05 (PR C).
 *
 * Pure helpers + thin HTTPS-with-pinning client. Uses Node's built-in
 * https module so no bundle is required.
 *
 * Plan invariants:
 *   - Default: pin the SHA-256 cert fingerprint Brad supplied. Reject
 *     any other cert.
 *   - Opt-in only: S2U_TLS_INSECURE_OPT_IN=true bypasses pinning.
 *     Without that flag, a pin mismatch fails closed and surfaces a
 *     clear error.
 *   - Refuses to operate without user-supplied creds (URL + username
 *     + secret). No hardcoded fallback creds in this module.
 *   - Caches responses for 60 s to avoid hammering the public server.
 */

import https from 'node:https';
import { Buffer } from 'node:buffer';

// ── Public constants ────────────────────────────────────────────────────

/** SHA-256 cert fingerprint published by Brad on 2026-05-05 for
 *  ghostmaps.s2utak.com:8443. Pinned by default; bypass requires
 *  S2U_TLS_INSECURE_OPT_IN=true. */
export const S2U_TAK_PINNED_FINGERPRINT_SHA256 =
  '8B:7D:D7:B2:BA:74:19:76:D8:4F:18:6A:BB:3E:26:40:7C:18:BD:FB:1C:DC:FD:58:7A:E0:35:90:4D:B1:A7:1D';

export const TAK_CACHE_TTL_MS = 60_000;

// ── Pure helpers ────────────────────────────────────────────────────────

/** Normalize a fingerprint string to canonical UPPER:HEX:HEX form.
 *  Accepts hex with or without separators (`:`, `-`, whitespace) and an
 *  optional `SHA256:` prefix. */
export function normalizeFingerprint(raw) {
  if (typeof raw !== 'string') return '';
  const stripped = raw.replace(/^sha256:/i, '').replace(/[\s:-]/g, '').toUpperCase();
  // eslint-disable-next-line sonarjs/slow-regex -- single character class + linear; not ReDoS-vulnerable
  if (!/^[0-9A-F]+$/.test(stripped) || stripped.length % 2 !== 0) return '';
  return stripped.match(/.{2}/g)?.join(':') ?? '';
}

/** Constant-time-ish equality on two fingerprint strings. ASCII hex
 *  only — codePointAt is fine here (no surrogate-pair concerns). */
export function fingerprintsMatch(a, b) {
  const na = normalizeFingerprint(a);
  const nb = normalizeFingerprint(b);
  if (!na || !nb || na.length !== nb.length) return false;
  let diff = 0;
  for (let i = 0; i < na.length; i += 1) {
    diff |= (na.codePointAt(i) ?? 0) ^ (nb.codePointAt(i) ?? 0);
  }
  return diff === 0;
}

/** Build a Basic auth header value. Caller is responsible for ensuring
 *  username + password are present. */
export function buildBasicAuthHeader(username, password) {
  if (!username || !password) return null;
  const token = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

/** Build the full URL for a Marti API path under the configured base. */
export function buildMartiUrl(baseUrl, path) {
  if (!baseUrl) return null;
  let trimmed = baseUrl;
  while (trimmed.endsWith('/')) trimmed = trimmed.slice(0, -1);
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${trimmed}${suffix}`;
}

/** Pick the first non-empty string from a list of candidate values.
 *  Used to tolerate camelCase / PascalCase variants from different TAK
 *  server implementations without nested ternaries. */
function firstString(...candidates) {
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  return '';
}

/** Pick the first array from a list of candidates. */
function firstArray(...candidates) {
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return [];
}

/** Shape a raw Marti `/api/feeds` response into the panel's view-model.
 *  Tolerates missing fields — the public TAK server's exact schema
 *  isn't documented and varies between FreeTAKServer and TAK Server. */
export function shapeFeedsResponse(raw) {
  if (raw == null) return [];
  const list = firstArray(raw, raw?.data);
  return list.map((entry) => ({
    uuid: firstString(entry?.uuid, entry?.UUID),
    name: firstString(entry?.name),
    type: firstString(entry?.type),
    address: firstString(entry?.address),
    protocol: firstString(entry?.protocol),
    auth: firstString(entry?.auth),
    raw: entry,
  })).filter((e) => e.uuid || e.name);
}

/** Shape `/Marti/api/clientEndPoints` (active users) into a stable list. */
export function shapeClientEndpointsResponse(raw) {
  const list = firstArray(raw, raw?.data);
  return list.map((entry) => ({
    callsign: firstString(entry?.callsign),
    uid: firstString(entry?.uid),
    username: firstString(entry?.username),
    lastEventTime: firstString(entry?.lastEventTime),
    raw: entry,
  })).filter((e) => e.uid || e.callsign);
}

/** Shape `/Marti/sync/search` package list. */
export function shapePackageSearchResponse(raw) {
  const list = firstArray(raw?.results, raw, raw?.data);
  return list.map((entry) => ({
    hash: firstString(entry?.Hash, entry?.hash),
    name: firstString(entry?.Name, entry?.name),
    submissionUser: firstString(entry?.SubmissionUser),
    keywords: firstArray(entry?.Keywords, entry?.keywords),
    submitTime: firstString(entry?.SubmissionDateTime),
    raw: entry,
  })).filter((e) => e.hash || e.name);
}

// ── Cache ───────────────────────────────────────────────────────────────

const cache = new Map();

function cacheGet(key, nowMs) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (nowMs - entry.fetchedAt > TAK_CACHE_TTL_MS) return null;
  return entry;
}

function cacheSet(key, value, nowMs) {
  cache.set(key, { fetchedAt: nowMs, value });
}

export function __resetCacheForTests() {
  cache.clear();
}

// ── HTTPS request with pinning ──────────────────────────────────────────

/**
 * Perform a GET against the configured TAK server. Returns
 * `{ ok, status, body, error }`. When pinning is on and the cert
 * fingerprint doesn't match, returns `{ ok: false, error: 'tls-pin-mismatch' }`.
 */
export function takFetchJson({
  url,
  username,
  password,
  insecureOptIn,
  pinnedFingerprint = S2U_TAK_PINNED_FINGERPRINT_SHA256,
  timeoutMs = 10_000,
}) {
  return new Promise((resolve) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (error) {
      resolve({ ok: false, error: `bad-url: ${error?.message ?? error}` });
      return;
    }

    const auth = buildBasicAuthHeader(username, password);
    if (!auth) {
      resolve({ ok: false, error: 'creds-missing' });
      return;
    }

    const agent = new https.Agent({
      // Pinning rejects any cert whose SHA-256 doesn't match. The
      // built-in PKI check is bypassed *only* when the pin matches —
      // we never trust the system trust store as the sole gate.
      rejectUnauthorized: !insecureOptIn,
      checkServerIdentity: (_hostname, cert) => {
        if (insecureOptIn) return undefined; // user opted out
        const observed = cert?.fingerprint256 ?? '';
        if (fingerprintsMatch(observed, pinnedFingerprint)) {
          return undefined; // pin matches — accept
        }
        return new Error(`tls-pin-mismatch (observed ${observed})`);
      },
    });

    const req = https.request({
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method: 'GET',
      headers: {
        Authorization: auth,
        Accept: 'application/json',
        'User-Agent': 'CrystalBall/2.10 (+https://github.com/bradleybond512/crystal-ball)',
      },
      agent,
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body = null;
        try { body = text ? JSON.parse(text) : null; } catch { body = text; }
        const ok = (res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 300;
        resolve({ ok, status: res.statusCode, body });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });

    req.on('error', (error) => {
      const msg = error?.message ?? String(error);
      if (msg.includes('tls-pin-mismatch')) {
        resolve({ ok: false, error: 'tls-pin-mismatch', detail: msg });
      } else {
        resolve({ ok: false, error: msg });
      }
    });

    req.end();
  });
}

// ── High-level snapshot helpers (used by /api endpoints) ───────────────

/** Get cached or fresh `/Marti/api/feeds`, shaped. */
export async function getTakFeeds(opts) {
  const nowMs = Date.now();
  const key = `feeds|${opts.url}`;
  const hit = cacheGet(key, nowMs);
  if (hit) return { ok: true, source: 'cache', feeds: hit.value, fetchedAt: hit.fetchedAt };

  const url = buildMartiUrl(opts.url, '/Marti/api/feeds');
  if (!url) return { ok: false, error: 'url-missing' };
  const res = await takFetchJson({ ...opts, url });
  if (!res.ok) return { ok: false, error: res.error ?? `http-${res.status}`, detail: res.detail };
  const feeds = shapeFeedsResponse(res.body);
  cacheSet(key, feeds, nowMs);
  return { ok: true, source: 'live', feeds, fetchedAt: nowMs };
}

/** Get a "situation" snapshot combining clientEndPoints + sync/search public. */
export async function getTakSituation(opts) {
  const nowMs = Date.now();
  const key = `situation|${opts.url}`;
  const hit = cacheGet(key, nowMs);
  if (hit) return { ok: true, source: 'cache', situation: hit.value, fetchedAt: hit.fetchedAt };

  const endpointsUrl = buildMartiUrl(opts.url, '/Marti/api/clientEndPoints?secAgo=86400');
  const searchUrl = buildMartiUrl(opts.url, '/Marti/sync/search?tool=public');
  if (!endpointsUrl || !searchUrl) return { ok: false, error: 'url-missing' };

  const [epRes, searchRes] = await Promise.all([
    takFetchJson({ ...opts, url: endpointsUrl }),
    takFetchJson({ ...opts, url: searchUrl }),
  ]);

  // If both sub-requests fail with the same TLS pin issue, bubble that up
  // verbatim so the panel can show a single actionable error.
  if (!epRes.ok && !searchRes.ok && epRes.error === searchRes.error) {
    return { ok: false, error: epRes.error, detail: epRes.detail };
  }

  const situation = {
    activeUsers: epRes.ok ? shapeClientEndpointsResponse(epRes.body) : [],
    publicPackages: searchRes.ok ? shapePackageSearchResponse(searchRes.body) : [],
    activeUsersError: epRes.ok ? null : (epRes.error ?? `http-${epRes.status}`),
    publicPackagesError: searchRes.ok ? null : (searchRes.error ?? `http-${searchRes.status}`),
  };
  cacheSet(key, situation, nowMs);
  return { ok: true, source: 'live', situation, fetchedAt: nowMs };
}
