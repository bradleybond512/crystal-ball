/**
 * ASN metadata lookup via RIPE stat. Public, key-free.
 *   GET /api/asn-info?asn=AS15169
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map();

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const degraded = (reason) => ({ result: null, degraded: true, reason, source: 'stat.ripe.net', generatedAt: new Date().toISOString() });

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);

  const url = new URL(req.url);
  const asnRaw = (url.searchParams.get('asn') || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!asnRaw) return j({ error: 'asn query param required' }, 400, cors);
  const asn = asnRaw.startsWith('AS') ? asnRaw : `AS${asnRaw}`;
  const cached = cache.get(asn);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return j(cached.payload, 200, cors);
  try {
    const r = await fetch(`https://stat.ripe.net/data/as-overview/data.json?resource=${encodeURIComponent(asn)}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'CrystalBall/2.10.21' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return j(degraded(`RIPE stat returned HTTP ${r.status}`), 200, cors);
    const payload = await r.json();
    const data = payload?.data ?? {};
    const result = {
      asn,
      holder: data?.holder ?? '',
      announced: data?.announced ?? false,
      block: data?.block ?? null,
      type: data?.type ?? '',
      resource: data?.resource ?? asn,
      source: 'stat.ripe.net',
      generatedAt: new Date().toISOString(),
    };
    cache.set(asn, { at: Date.now(), payload: result });
    return j(result, 200, cors);
  } catch (error) {
    return j(degraded(`RIPE stat fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}
