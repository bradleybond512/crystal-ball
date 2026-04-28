/**
 * OpenPhish phishing URL feed. Public free-tier endpoint emits 500 most
 * recent verified phishing URLs (one per line, plain text).
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 5 * 60 * 1000;
let _cache = null;

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const degraded = (reason) => ({ urls: [], degraded: true, reason, source: 'openphish.com', generatedAt: new Date().toISOString() });

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return j(_cache.payload, 200, cors);
  try {
    const r = await fetch('https://openphish.com/feed.txt', {
      headers: { 'User-Agent': 'CrystalBall/2.10.21', Accept: 'text/plain' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return j(degraded(`OpenPhish returned HTTP ${r.status}`), 200, cors);
    const text = await r.text();
    const urls = text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.startsWith('http'));
    const result = { urls, count: urls.length, source: 'openphish.com', generatedAt: new Date().toISOString() };
    _cache = { at: Date.now(), payload: result };
    return j(result, 200, cors);
  } catch (error) {
    return j(degraded(`OpenPhish fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}
