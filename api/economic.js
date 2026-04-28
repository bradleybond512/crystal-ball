/**
 * Economic indicators aggregate. Proxies FRED (if FRED_API_KEY set)
 * and EIA (if EIA_API_KEY set) and merges into one normalized
 * `{indicators: [{id, label, value, asOf, source}]}` shape.
 *
 * Free tier: FRED is free with registration; EIA is free.
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 60 * 60 * 1000;
let _cache = null;

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const degraded = (reason) => ({ indicators: [], degraded: true, reason, source: 'fred+eia', generatedAt: new Date().toISOString() });

const FRED_INDICATORS = [
  { id: 'DGS10', label: '10-yr Treasury yield' },
  { id: 'T10Y2Y', label: '10y-2y yield curve' },
  { id: 'UNRATE', label: 'US unemployment' },
  { id: 'CPIAUCSL', label: 'US CPI' },
  { id: 'DCOILWTICO', label: 'WTI crude' },
];

async function fetchFred(seriesId, key) {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(seriesId)}&api_key=${key}&file_type=json&sort_order=desc&limit=1`;
  const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) return null;
  const payload = await r.json();
  const obs = payload?.observations?.[0];
  if (!obs) return null;
  return { value: Number.parseFloat(obs.value), asOf: obs.date };
}

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return j(_cache.payload, 200, cors);

  const fredKey = process.env.FRED_API_KEY;
  if (!fredKey) return j(degraded('FRED_API_KEY not set'), 200, cors);

  try {
    const indicators = await Promise.all(FRED_INDICATORS.map(async (ind) => {
      try {
        const data = await fetchFred(ind.id, fredKey);
        if (!data || !Number.isFinite(data.value)) return null;
        return { ...ind, ...data, source: 'fred' };
      } catch {
        return null;
      }
    }));
    const filtered = indicators.filter(Boolean);
    const result = {
      indicators: filtered,
      count: filtered.length,
      source: 'fred',
      generatedAt: new Date().toISOString(),
    };
    _cache = { at: Date.now(), payload: result };
    return j(result, 200, cors);
  } catch (error) {
    return j(degraded(`FRED fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}
