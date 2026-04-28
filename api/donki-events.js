/**
 * NASA DONKI space-weather event proxy. NASA_API_KEY optional (DEMO_KEY works).
 * https://api.nasa.gov/DONKI/notifications
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const UPSTREAM = 'https://api.nasa.gov/DONKI/notifications';
const CACHE_TTL_MS = 5 * 60 * 1000;
let _cache = null;

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const degraded = (reason) => ({ events: [], degraded: true, reason, source: 'api.nasa.gov/DONKI', generatedAt: new Date().toISOString() });

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return j(_cache.payload, 200, cors);

  const key = process.env.NASA_API_KEY || 'DEMO_KEY';
  const url = new URL(UPSTREAM);
  url.searchParams.set('api_key', key);
  url.searchParams.set('type', 'all');
  // Last 7 days
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  url.searchParams.set('startDate', start.toISOString().slice(0, 10));
  url.searchParams.set('endDate', end.toISOString().slice(0, 10));

  try {
    const r = await fetch(url.toString(), {
      headers: { 'User-Agent': 'CrystalBall/2.10.21 (donki)' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return j(degraded(`NASA DONKI returned HTTP ${r.status}`), 200, cors);
    const events = await r.json();
    const arr = Array.isArray(events) ? events : [];
    const result = { events: arr, count: arr.length, source: 'api.nasa.gov/DONKI', generatedAt: new Date().toISOString() };
    _cache = { at: Date.now(), payload: result };
    return j(result, 200, cors);
  } catch (error) {
    return j(degraded(`DONKI fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}
