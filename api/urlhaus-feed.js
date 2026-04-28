/**
 * URLhaus malicious URL feed proxy. Free with URLHAUS_AUTH_KEY.
 * https://urlhaus-api.abuse.ch/
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const UPSTREAM = 'https://urlhaus-api.abuse.ch/v1/urls/recent/';
const CACHE_TTL_MS = 5 * 60 * 1000;
let _cache = null;

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const degraded = (reason) => ({ items: [], degraded: true, reason, source: 'urlhaus.abuse.ch', generatedAt: new Date().toISOString() });

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);
  const key = process.env.URLHAUS_AUTH_KEY;
  if (!key) return j(degraded('URLHAUS_AUTH_KEY not set'), 200, cors);
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return j(_cache.payload, 200, cors);
  try {
    // URLhaus dropped anonymous access in 2024; the Auth-Key header is now required.
    const r = await fetch(UPSTREAM, {
      method: 'POST',
      headers: {
        'Auth-Key': key,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'CrystalBall/2.10.21 (urlhaus)',
      },
      body: 'limit=100',
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return j(degraded(`URLhaus returned HTTP ${r.status}`), 200, cors);
    const payload = await r.json();
    const items = Array.isArray(payload?.urls) ? payload.urls : [];
    const result = { items, count: items.length, source: 'urlhaus.abuse.ch', generatedAt: new Date().toISOString() };
    _cache = { at: Date.now(), payload: result };
    return j(result, 200, cors);
  } catch (error) {
    return j(degraded(`URLhaus fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}
