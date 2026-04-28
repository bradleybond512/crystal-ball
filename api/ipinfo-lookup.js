/**
 * IPinfo lookup proxy. Requires IPINFO_TOKEN.
 *   GET /api/ipinfo-lookup?ip=1.2.3.4
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { requireAppAuth, isLikelyIp } from './_auth.js';

export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map();

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const degraded = (reason) => ({ result: null, degraded: true, reason, source: 'ipinfo.io', generatedAt: new Date().toISOString() });

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);

  // Key-spending oracle path. Gate before we hit the upstream.
  const denied = requireAppAuth(req, cors);
  if (denied) return denied;

  const token = process.env.IPINFO_TOKEN || process.env.IPINFO_API_KEY;
  if (!token) return j(degraded('IPINFO_TOKEN not set'), 200, cors);

  const url = new URL(req.url);
  const ip = (url.searchParams.get('ip') || '').trim();
  if (!ip) return j({ error: 'ip query param required' }, 400, cors);
  if (!isLikelyIp(ip)) return j({ error: 'Invalid IP format' }, 400, cors);
  const cached = cache.get(ip);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return j(cached.payload, 200, cors);
  try {
    const r = await fetch(`https://ipinfo.io/${encodeURIComponent(ip)}?token=${encodeURIComponent(token)}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'CrystalBall/2.10.21' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return j(degraded(`IPinfo returned HTTP ${r.status}`), 200, cors);
    const payload = await r.json();
    const result = { ...payload, source: 'ipinfo.io', generatedAt: new Date().toISOString() };
    cache.set(ip, { at: Date.now(), payload: result });
    return j(result, 200, cors);
  } catch (error) {
    return j(degraded(`IPinfo fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}
