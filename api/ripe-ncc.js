/**
 * RIPE NCC announced-prefixes lookup. Public, key-free.
 *   GET /api/ripe-ncc                → routing summary (last visibility)
 *   GET /api/ripe-ncc?asn=AS15169    → announced prefixes for ASN
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map();

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const degraded = (reason) => ({ prefixes: [], degraded: true, reason, source: 'stat.ripe.net', generatedAt: new Date().toISOString() });

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);

  const url = new URL(req.url);
  const asnRaw = (url.searchParams.get('asn') || '').toUpperCase().replaceAll(/[^0-9A-Z]/g, '');
  let asn = '';
  if (asnRaw) asn = asnRaw.startsWith('AS') ? asnRaw : `AS${asnRaw}`;
  const cacheKey = asn || 'default';
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return j(cached.payload, 200, cors);

  try {
    const endpoint = asn
      ? `https://stat.ripe.net/data/announced-prefixes/data.json?resource=${encodeURIComponent(asn)}`
      : 'https://stat.ripe.net/data/ris-peers/data.json';
    const r = await fetch(endpoint, {
      headers: { Accept: 'application/json', 'User-Agent': 'CrystalBall/2.10.21' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return j(degraded(`RIPE stat returned HTTP ${r.status}`), 200, cors);
    const payload = await r.json();
    if (asn) {
      const prefixes = (payload?.data?.prefixes ?? []).map((p) => ({
        prefix: p?.prefix ?? '',
        timelines: p?.timelines ?? [],
      }));
      const result = { asn, prefixes, count: prefixes.length, source: 'stat.ripe.net', generatedAt: new Date().toISOString() };
      cache.set(cacheKey, { at: Date.now(), payload: result });
      return j(result, 200, cors);
    }
    // ris-peers summary view
    const peers = payload?.data?.peers ?? {};
    const collectors = Object.keys(peers).map((c) => ({
      collector: c,
      v4_peers: peers[c]?.v4 ?? 0,
      v6_peers: peers[c]?.v6 ?? 0,
    }));
    const result = { collectors, count: collectors.length, source: 'stat.ripe.net', generatedAt: new Date().toISOString() };
    cache.set(cacheKey, { at: Date.now(), payload: result });
    return j(result, 200, cors);
  } catch (error) {
    return j(degraded(`RIPE NCC fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}
