/**
 * FRED single-series observations proxy. Requires FRED_API_KEY.
 *   GET /api/fred-series?series_id=DGS10&limit=500
 *
 * Default returns the last 500 observations of the 10-year Treasury yield,
 * which is what the macro-stress dashboard uses as its primary curve.
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map();

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const degraded = (reason) => ({ observations: [], degraded: true, reason, source: 'fred.stlouisfed.org', generatedAt: new Date().toISOString() });

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);

  const key = process.env.FRED_API_KEY;
  if (!key) return j(degraded('FRED_API_KEY not set'), 200, cors);

  const url = new URL(req.url);
  const series = (url.searchParams.get('series_id') || 'DGS10').replace(/[^A-Z0-9_]/gi, '').slice(0, 32);
  const limit = Math.min(2000, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '500', 10) || 500));
  const sort = url.searchParams.get('sort') === 'asc' ? 'asc' : 'desc';
  const cacheKey = `${series}|${limit}|${sort}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return j(cached.payload, 200, cors);

  try {
    const params = new URLSearchParams({
      series_id: series,
      api_key: key,
      file_type: 'json',
      sort_order: sort,
      limit: String(limit),
    });
    const r = await fetch(`https://api.stlouisfed.org/fred/series/observations?${params.toString()}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return j(degraded(`FRED returned HTTP ${r.status}`), 200, cors);
    const payload = await r.json();
    const obs = Array.isArray(payload?.observations) ? payload.observations : [];
    const observations = obs.map((o) => ({
      date: o?.date ?? '',
      value: o?.value === '.' ? null : Number.parseFloat(o?.value),
    })).filter((o) => o.date);
    const result = {
      series_id: series,
      observations,
      count: observations.length,
      sort,
      source: 'fred.stlouisfed.org',
      generatedAt: new Date().toISOString(),
    };
    cache.set(cacheKey, { at: Date.now(), payload: result });
    return j(result, 200, cors);
  } catch (error) {
    return j(degraded(`FRED fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}
