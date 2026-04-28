/**
 * CISA Known Exploited Vulnerabilities feed proxy.
 *
 * No API key required — public CISA feed. Returns a JSON array of
 * `CyberThreat`-shaped items matching the existing sidecar `/api/cisa-kev`
 * response so `src/services/cyber-extra.ts` (which casts
 * `await res.json() as CyberThreat[]` and gates on `Array.isArray`)
 * accepts both code paths interchangeably.
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const UPSTREAM = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
const CACHE_TTL_MS = 10 * 60 * 1000;
const RECENT_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

let _cache = null;

function jsonResponse(payload, status, corsHeaders) {
  return Response.json(payload, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders },
  });
}

// Match the sidecar shape exactly — src/services/cyber-extra.ts already
// expects `Array.isArray(data)` and the panel reads these fields by
// name. Diverging would silently empty the panel.
function toCyberThreat(v, i) {
  return {
    id: `cisa-kev-${v?.cveID ?? i}`,
    type: 'exploited_vulnerability',
    source: 'cisa_kev',
    indicator: v?.cveID ?? `CVE-${i}`,
    indicatorType: 'domain',
    lat: 0,
    lon: 0,
    country: '',
    severity: 'critical',
    malwareFamily: `${v?.vendorProject ?? ''} ${v?.product ?? ''}`.trim(),
    tags: ['cisa', 'kev', 'actively-exploited'],
    firstSeen: v?.dateAdded ?? '',
    lastSeen: v?.dueDate ?? v?.dateAdded ?? '',
  };
}

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return jsonResponse({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405, cors);

  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(500, Number.parseInt(url.searchParams.get('limit') ?? '200', 10) || 200));

  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) {
    return jsonResponse(_cache.threats.slice(0, limit), 200, cors);
  }
  try {
    const r = await fetch(UPSTREAM, {
      headers: { 'User-Agent': 'CrystalBall/2.10.21 (cisa-kev)' },
      signal: AbortSignal.timeout(10_000),
    });
    // Empty array preserves the array contract (panels render "no
    // threats" instead of crashing on `.filter` of a non-array body).
    if (!r.ok) return jsonResponse([], 200, cors);
    const payload = await r.json();
    const items = Array.isArray(payload?.vulnerabilities) ? payload.vulnerabilities : [];
    const cutoff = Date.now() - RECENT_WINDOW_MS;
    const recent = items.filter((v) => {
      const t = Date.parse(v?.dateAdded ?? '');
      return Number.isFinite(t) && t >= cutoff;
    });
    const threats = recent
      .sort((a, b) => Date.parse(b?.dateAdded ?? '') - Date.parse(a?.dateAdded ?? ''))
      .map((v, i) => toCyberThreat(v, i));
    _cache = { at: Date.now(), threats };
    return jsonResponse(threats.slice(0, limit), 200, cors);
  } catch {
    return jsonResponse([], 200, cors);
  }
}
