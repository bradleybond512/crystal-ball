/**
 * Have I Been Pwned breaches proxy. The /breaches endpoint is public and
 * key-free; the /breachedaccount lookup requires HIBP_API_KEY.
 *
 * GET /api/hibp-breaches            → recent breach catalog (last 365 days)
 * GET /api/hibp-breaches?account=…  → per-account breach lookup (auth)
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 60 * 60 * 1000;
let _catalogCache = null;

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const degraded = (reason) => ({ breaches: [], degraded: true, reason, source: 'haveibeenpwned.com', generatedAt: new Date().toISOString() });

async function lookupAccount(account, cors) {
  const key = process.env.HIBP_API_KEY;
  if (!key) return j(degraded('HIBP_API_KEY not set; account lookup unavailable'), 200, cors);
  try {
    const r = await fetch(
      `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(account)}?truncateResponse=false`,
      {
        headers: {
          'hibp-api-key': key,
          'User-Agent': 'CrystalBall/2.10.21',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (r.status === 404) return j({ breaches: [], account, count: 0, source: 'haveibeenpwned.com', generatedAt: new Date().toISOString() }, 200, cors);
    if (!r.ok) return j(degraded(`HIBP returned HTTP ${r.status}`), 200, cors);
    const breaches = await r.json();
    return j({ breaches, account, count: breaches.length, source: 'haveibeenpwned.com', generatedAt: new Date().toISOString() }, 200, cors);
  } catch (error) {
    return j(degraded(`HIBP lookup failed: ${error?.message ?? error}`), 200, cors);
  }
}

async function fetchCatalog(cors) {
  if (_catalogCache && Date.now() - _catalogCache.at < CACHE_TTL_MS) return j(_catalogCache.payload, 200, cors);
  try {
    const r = await fetch('https://haveibeenpwned.com/api/v3/breaches', {
      headers: { 'User-Agent': 'CrystalBall/2.10.21', Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return j(degraded(`HIBP catalog returned HTTP ${r.status}`), 200, cors);
    const all = await r.json();
    const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;
    const recent = (Array.isArray(all) ? all : [])
      .filter((b) => {
        const t = Date.parse(b?.AddedDate ?? b?.BreachDate ?? '');
        return Number.isFinite(t) && t >= cutoff;
      })
      .sort((a, b) => Date.parse(b?.AddedDate ?? '') - Date.parse(a?.AddedDate ?? ''));
    const result = {
      breaches: recent.slice(0, 100),
      count: recent.length,
      source: 'haveibeenpwned.com',
      generatedAt: new Date().toISOString(),
    };
    _catalogCache = { at: Date.now(), payload: result };
    return j(result, 200, cors);
  } catch (error) {
    return j(degraded(`HIBP catalog fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);

  const url = new URL(req.url);
  const account = url.searchParams.get('account');
  return account ? lookupAccount(account, cors) : fetchCatalog(cors);
}
