/**
 * UCDP (Uppsala Conflict Data Program) Georeferenced Events proxy.
 *
 * Requires UCDP_API_TOKEN. Returns the most recent georeferenced
 * conflict events. UCDP API: https://ucdp.uu.se/apidocs/
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const UPSTREAM_BASE = 'https://ucdpapi.pcr.uu.se/api/gedevents/24.1';
const CACHE_TTL_MS = 30 * 60 * 1000;

const cache = new Map();

function jsonResponse(payload, status, corsHeaders) {
  return Response.json(payload, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders },
  });
}

function degraded(reason) {
  return { events: [], degraded: true, reason, source: 'ucdp.uu.se', generatedAt: new Date().toISOString() };
}

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return jsonResponse({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405, cors);

  const token = process.env.UCDP_API_TOKEN;
  if (!token) return jsonResponse(degraded('UCDP_API_TOKEN not set'), 200, cors);

  const url = new URL(req.url);
  const params = new URLSearchParams();
  for (const key of ['Country', 'Region', 'StartDate', 'EndDate', 'pagesize']) {
    const v = url.searchParams.get(key);
    if (v) params.set(key, v);
  }
  if (!params.has('pagesize')) params.set('pagesize', '200');

  const cacheKey = params.toString();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return jsonResponse(cached.payload, 200, cors);

  try {
    const target = `${UPSTREAM_BASE}?${params.toString()}`;
    const r = await fetch(target, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'CrystalBall/2.10.21 (ucdp)',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return jsonResponse(degraded(`UCDP returned HTTP ${r.status}`), 200, cors);
    const payload = await r.json();
    const events = Array.isArray(payload?.Result) ? payload.Result : [];
    const result = {
      events,
      total: payload?.TotalCount ?? events.length,
      page: payload?.NextPageId ?? null,
      source: 'ucdp.uu.se',
      generatedAt: new Date().toISOString(),
    };
    cache.set(cacheKey, { at: Date.now(), payload: result });
    return jsonResponse(result, 200, cors);
  } catch (error) {
    return jsonResponse(degraded(`UCDP fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}
