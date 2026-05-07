/**
 * MITRE ATT&CK enterprise STIX bundle weekly cache.
 *
 * GET /api/attack/groups
 *   → { bundle: SlimStixBundle, updatedAt, source, groupsCount }
 *
 * Returns a STIX bundle slimmed to just the `intrusion-set` objects —
 * the only kind apt-tracker.parseAttackBundle reads. The full
 * enterprise-attack.json is ~30 MB; the slim form is ~50–100 KB.
 *
 * Cache: 7 days (matches MITRE's roughly-monthly publishing cadence
 * with margin for early refresh). Best-effort on-disk persistence at
 * data/attack-cache.json so a sidecar restart doesn't refetch 30 MB —
 * fails silently when fs is unavailable (Edge runtime).
 *
 * The client runs `parseAttackBundle(bundle)` from apt-tracker.ts on
 * the response — no parser duplication on the route side.
 */

import { getCorsHeaders, isDisallowedOrigin } from '../_cors.js';

export const config = { runtime: 'edge' };

const SOURCE_URL = 'https://raw.githubusercontent.com/mitre/cti/master/enterprise-attack/enterprise-attack.json';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 60_000;
const DISK_CACHE_PATH = 'data/attack-cache.json';

let _cache = null;
let _diskHydrationAttempted = false;

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const degraded = (reason) => ({
  bundle: null, updatedAt: Date.now(), source: 'mitre-attack-enterprise',
  groupsCount: 0, degraded: true, reason,
});

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);

  // Cold start: try to hydrate from disk before fetching.
  if (!_cache && !_diskHydrationAttempted) {
    _cache = await tryLoadFromDisk();
    _diskHydrationAttempted = true;
  }

  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) {
    return j(_cache.payload, 200, cors);
  }

  try {
    const bundle = await fetchBundle();
    const slim = slimBundle(bundle);
    const payload = {
      bundle: slim,
      updatedAt: Date.now(),
      source: 'mitre-attack-enterprise',
      groupsCount: countIntrusionSets(slim),
    };
    _cache = { at: Date.now(), payload };
    void trySaveToDisk(_cache);
    return j(payload, 200, cors);
  } catch (error) {
    // On upstream failure, serve stale cache if we have one.
    if (_cache) return j({ ...(_cache.payload), staleAfterError: String(error?.message ?? error) }, 200, cors);
    return j(degraded(`MITRE fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}

async function fetchBundle() {
  const r = await fetch(SOURCE_URL, {
    headers: { 'User-Agent': 'CrystalBall (mitre-attack)', Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.json();
}

/** Filter the STIX bundle to just the `intrusion-set` objects.
 *  parseAttackBundle reads no other type, so we drop techniques /
 *  software / relationships / malware / etc. wholesale.
 *  Preserves bundle envelope so the consumer's parseAttackBundle
 *  type-check (`b.type !== 'bundle'`) still passes. */
export function slimBundle(bundle) {
  if (!bundle || typeof bundle !== 'object') return { type: 'bundle', objects: [] };
  const rawObjects = Array.isArray(bundle.objects) ? bundle.objects : [];
  const objects = rawObjects.filter((o) => o?.type === 'intrusion-set' && o.revoked !== true);
  return { type: 'bundle', id: bundle.id, objects };
}

function countIntrusionSets(slim) {
  return Array.isArray(slim?.objects) ? slim.objects.length : 0;
}

async function tryLoadFromDisk() {
  try {
    const fs = await import('node:fs/promises');
    const text = await fs.readFile(DISK_CACHE_PATH, 'utf8');
    const parsed = JSON.parse(text);
    if (parsed?.at && parsed?.payload?.bundle) return parsed;
  } catch { /* fs unavailable, file missing, or malformed — fall through to fetch */ }
  return null;
}

async function trySaveToDisk(cacheEntry) {
  try {
    const fs = await import('node:fs/promises');
    await fs.mkdir('data', { recursive: true });
    await fs.writeFile(DISK_CACHE_PATH, JSON.stringify(cacheEntry), 'utf8');
  } catch { /* edge runtime, read-only fs, or other; not a hard failure */ }
}

export function __resetCacheForTests() {
  _cache = null;
  _diskHydrationAttempted = true;     // skip disk hydration during tests
}
