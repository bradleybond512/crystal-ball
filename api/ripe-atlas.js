/**
 * RIPE Atlas measurement-network status proxy. Public, key-free.
 *   GET /api/ripe-atlas?type=status   (default)  → probe-status counts
 *   GET /api/ripe-atlas?type=anchors             → list of anchors
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map();

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const degraded = (reason) => ({ status: null, anchors: [], degraded: true, reason, source: 'atlas.ripe.net', generatedAt: new Date().toISOString() });

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);

  const url = new URL(req.url);
  const type = url.searchParams.get('type') === 'anchors' ? 'anchors' : 'status';
  const cached = cache.get(type);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return j(cached.payload, 200, cors);

  try {
    if (type === 'status') {
      const r = await fetch('https://atlas.ripe.net/api/v2/probes/?status=1&page_size=1&fields=id', {
        headers: { Accept: 'application/json', 'User-Agent': 'CrystalBall/2.10.21' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) return j(degraded(`RIPE Atlas returned HTTP ${r.status}`), 200, cors);
      const payload = await r.json();
      const result = {
        connectedProbes: payload?.count ?? 0,
        type: 'status',
        source: 'atlas.ripe.net',
        generatedAt: new Date().toISOString(),
      };
      cache.set(type, { at: Date.now(), payload: result });
      return j(result, 200, cors);
    }
    // anchors
    const r = await fetch('https://atlas.ripe.net/api/v2/anchors/?page_size=200', {
      headers: { Accept: 'application/json', 'User-Agent': 'CrystalBall/2.10.21' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return j(degraded(`RIPE Atlas returned HTTP ${r.status}`), 200, cors);
    const payload = await r.json();
    const anchors = (payload?.results ?? []).map((a) => ({
      id: a?.id,
      fqdn: a?.fqdn ?? '',
      city: a?.city ?? '',
      country: a?.country ?? '',
      lat: a?.geometry?.coordinates?.[1] ?? null,
      lng: a?.geometry?.coordinates?.[0] ?? null,
      asn_v4: a?.as_v4 ?? null,
      asn_v6: a?.as_v6 ?? null,
    }));
    const result = { anchors, count: anchors.length, type: 'anchors', source: 'atlas.ripe.net', generatedAt: new Date().toISOString() };
    cache.set(type, { at: Date.now(), payload: result });
    return j(result, 200, cors);
  } catch (error) {
    return j(degraded(`RIPE Atlas fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}
