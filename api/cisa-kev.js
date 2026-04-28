/**
 * CISA Known Exploited Vulnerabilities feed proxy.
 *
 * No API key required — public CISA feed. Returns the most recent N
 * KEVs with their CVE IDs, vendor, product, and remediation deadline.
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const UPSTREAM = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
const CACHE_TTL_MS = 10 * 60 * 1000;

let _cache = null;

function jsonResponse(payload, status, corsHeaders) {
  return Response.json(payload, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders },
  });
}

function degraded(reason) {
  return {
    kev: [],
    degraded: true,
    reason,
    source: 'cisa.gov',
    generatedAt: new Date().toISOString(),
  };
}

function normalize(v) {
  return {
    cveID: v.cveID ?? '',
    vendor: v.vendorProject ?? '',
    product: v.product ?? '',
    name: v.vulnerabilityName ?? '',
    dateAdded: v.dateAdded ?? '',
    shortDescription: v.shortDescription ?? '',
    requiredAction: v.requiredAction ?? '',
    dueDate: v.dueDate ?? '',
    knownRansomwareCampaignUse: v.knownRansomwareCampaignUse ?? 'Unknown',
  };
}

function sliceKev(payload, limit) {
  return { ...payload, kev: payload.kev.slice(0, Math.max(1, Math.min(500, limit))) };
}

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return jsonResponse({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405, cors);

  const url = new URL(req.url);
  const limit = Number.parseInt(url.searchParams.get('limit') ?? '100', 10);

  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) {
    return jsonResponse(sliceKev(_cache.payload, limit), 200, cors);
  }
  try {
    const r = await fetch(UPSTREAM, {
      headers: { 'User-Agent': 'CrystalBall/2.10.21 (cisa-kev)' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return jsonResponse(degraded(`CISA returned HTTP ${r.status}`), 200, cors);
    const payload = await r.json();
    const items = Array.isArray(payload?.vulnerabilities) ? payload.vulnerabilities : [];
    const normalized = items
      .map((v) => normalize(v))
      .sort((a, b) => (b.dateAdded ?? '').localeCompare(a.dateAdded ?? ''));
    _cache = {
      at: Date.now(),
      payload: {
        kev: normalized,
        catalogVersion: payload?.catalogVersion,
        dateReleased: payload?.dateReleased,
        count: normalized.length,
        source: 'cisa.gov',
        generatedAt: new Date().toISOString(),
      },
    };
    return jsonResponse(sliceKev(_cache.payload, limit), 200, cors);
  } catch (error) {
    return jsonResponse(degraded(`CISA fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}
