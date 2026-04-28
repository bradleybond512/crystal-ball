/**
 * AlienVault OTX recent pulses proxy. Free with OTX_API_KEY.
 * https://otx.alienvault.com/api
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const UPSTREAM = 'https://otx.alienvault.com/api/v1/pulses/subscribed';
const CACHE_TTL_MS = 10 * 60 * 1000;
let _cache = null;

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const degraded = (reason) => ({ pulses: [], degraded: true, reason, source: 'otx.alienvault.com', generatedAt: new Date().toISOString() });

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);
  const key = process.env.OTX_API_KEY;
  if (!key) return j(degraded('OTX_API_KEY not set'), 200, cors);
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return j(_cache.payload, 200, cors);
  try {
    const url = new URL(UPSTREAM);
    url.searchParams.set('limit', '50');
    const r = await fetch(url.toString(), {
      headers: { 'X-OTX-API-KEY': key, 'User-Agent': 'CrystalBall/2.10.21 (otx)' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return j(degraded(`OTX returned HTTP ${r.status}`), 200, cors);
    const payload = await r.json();
    const pulses = Array.isArray(payload?.results) ? payload.results : [];
    const result = { pulses, count: pulses.length, source: 'otx.alienvault.com', generatedAt: new Date().toISOString() };
    _cache = { at: Date.now(), payload: result };
    return j(result, 200, cors);
  } catch (error) {
    return j(degraded(`OTX fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}
