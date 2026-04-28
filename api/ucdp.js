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

// Test-only: scrub the module cache between tests so each case sees a
// pristine fetch path.
export function __resetCacheForTests() { cache.clear(); }

function jsonResponse(payload, status, corsHeaders) {
  return Response.json(payload, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders },
  });
}

function degraded(reason) {
  return { events: [], degraded: true, reason, source: 'ucdp.uu.se', generatedAt: new Date().toISOString() };
}

// ── Input validation (extracted to keep handler complexity low) ────
const RE_SIMPLE_ID = /^[A-Za-z0-9 _.-]{1,64}$/;
const RE_ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function buildUcdpParams(searchParams) {
  const params = new URLSearchParams();
  // Country / Region: simple identifiers only. Refuse newlines / shell
  // metachars / wide unicode by accepting an explicit allowlist.
  for (const key of ['Country', 'Region']) {
    const v = searchParams.get(key);
    if (v && RE_SIMPLE_ID.test(v)) params.set(key, v);
  }
  // StartDate / EndDate: ISO-ish YYYY-MM-DD only.
  for (const key of ['StartDate', 'EndDate']) {
    const v = searchParams.get(key);
    if (v && RE_ISO_DATE.test(v) && !Number.isNaN(Date.parse(v))) params.set(key, v);
  }
  // pagesize: clamp to upstream-supported range [1..1000], default 200.
  const psRaw = Number.parseInt(searchParams.get('pagesize') ?? '', 10);
  const pagesize = Number.isFinite(psRaw) && psRaw > 0 ? Math.min(1000, psRaw) : 200;
  params.set('pagesize', String(pagesize));
  return params;
}

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return jsonResponse({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405, cors);

  const token = process.env.UCDP_API_TOKEN;
  if (!token) return jsonResponse(degraded('UCDP_API_TOKEN not set'), 200, cors);

  const url = new URL(req.url);
  const params = buildUcdpParams(url.searchParams);

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
