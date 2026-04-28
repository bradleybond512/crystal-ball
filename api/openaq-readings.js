/**
 * OpenAQ recent measurements proxy. Uses OPENAQ_API_KEY if set; works
 * without it on the v2 public tier (rate-limited).
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 10 * 60 * 1000;
let _cache = null;

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const degraded = (reason) => ({ readings: [], degraded: true, reason, source: 'openaq.org', generatedAt: new Date().toISOString() });

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return j(_cache.payload, 200, cors);

  const url = new URL(req.url);
  const limit = Math.min(500, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '200', 10) || 200));
  const params = new URLSearchParams({
    parameter: 'pm25',
    order_by: 'datetime',
    sort: 'desc',
    limit: String(limit),
  });
  const headers = { Accept: 'application/json', 'User-Agent': 'CrystalBall/2.10.21' };
  if (process.env.OPENAQ_API_KEY) headers['X-API-Key'] = process.env.OPENAQ_API_KEY;
  try {
    const r = await fetch(`https://api.openaq.org/v2/measurements?${params.toString()}`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return j(degraded(`OpenAQ returned HTTP ${r.status}`), 200, cors);
    const payload = await r.json();
    const results = Array.isArray(payload?.results) ? payload.results : [];
    const readings = results.map((r) => ({
      location: r?.location ?? '',
      city: r?.city ?? '',
      country: r?.country ?? '',
      parameter: r?.parameter ?? '',
      value: r?.value ?? null,
      unit: r?.unit ?? '',
      lat: r?.coordinates?.latitude ?? null,
      lng: r?.coordinates?.longitude ?? null,
      datetime: r?.date?.utc ?? '',
    }));
    const result = { readings, count: readings.length, source: 'openaq.org', generatedAt: new Date().toISOString() };
    _cache = { at: Date.now(), payload: result };
    return j(result, 200, cors);
  } catch (error) {
    return j(degraded(`OpenAQ fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}
