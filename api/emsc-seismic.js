/**
 * EMSC (European-Mediterranean Seismological Centre) recent quakes feed.
 * Key-free FDSN-style endpoint. Returns the last 24h, M >= 4.0.
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 5 * 60 * 1000;
let _cache = null;

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const degraded = (reason) => ({ events: [], degraded: true, reason, source: 'emsc-csem.org', generatedAt: new Date().toISOString() });

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return j(_cache.payload, 200, cors);

  const start = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    starttime: start,
    minmagnitude: '4.0',
    format: 'json',
    limit: '200',
    orderby: 'time',
  });
  try {
    const r = await fetch(`https://www.seismicportal.eu/fdsnws/event/1/query?${params.toString()}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'CrystalBall/2.10.21' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return j(degraded(`EMSC returned HTTP ${r.status}`), 200, cors);
    const payload = await r.json();
    const features = Array.isArray(payload?.features) ? payload.features : [];
    const events = features.map((f) => {
      const p = f?.properties ?? {};
      const c = f?.geometry?.coordinates ?? [];
      return {
        id: f?.id ?? p?.unid ?? '',
        time: p?.time ?? '',
        mag: p?.mag ?? null,
        magType: p?.magtype ?? '',
        depthKm: c[2] ?? null,
        lat: c[1] ?? null,
        lng: c[0] ?? null,
        region: p?.flynn_region ?? p?.region ?? '',
        source: p?.source_id ?? 'EMSC',
      };
    });
    const result = { events, count: events.length, source: 'emsc-csem.org', generatedAt: new Date().toISOString() };
    _cache = { at: Date.now(), payload: result };
    return j(result, 200, cors);
  } catch (error) {
    return j(degraded(`EMSC fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}
