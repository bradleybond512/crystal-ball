/**
 * NWS active alerts proxy. No API key. https://www.weather.gov/documentation/services-web-api
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const UPSTREAM = 'https://api.weather.gov/alerts/active';
const CACHE_TTL_MS = 60 * 1000;
let _cache = null;

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const degraded = (reason) => ({ alerts: [], degraded: true, reason, source: 'api.weather.gov', generatedAt: new Date().toISOString() });

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return j(_cache.payload, 200, cors);
  try {
    const r = await fetch(UPSTREAM, {
      headers: {
        'User-Agent': 'CrystalBall/2.10.21 (contact@crystalball.app)',
        'Accept': 'application/geo+json',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return j(degraded(`NWS returned HTTP ${r.status}`), 200, cors);
    const payload = await r.json();
    const features = Array.isArray(payload?.features) ? payload.features : [];
    const result = {
      alerts: features,
      count: features.length,
      updated: payload?.updated,
      source: 'api.weather.gov',
      generatedAt: new Date().toISOString(),
    };
    _cache = { at: Date.now(), payload: result };
    return j(result, 200, cors);
  } catch (error) {
    return j(degraded(`NWS fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}
