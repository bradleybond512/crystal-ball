/**
 * ThreatFox IOC feed proxy. Free with THREATFOX_API_KEY.
 * https://threatfox.abuse.ch/api/
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const UPSTREAM = 'https://threatfox-api.abuse.ch/api/v1/';
const CACHE_TTL_MS = 5 * 60 * 1000;
let _cache = null;

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const degraded = (reason) => ({ iocs: [], degraded: true, reason, source: 'abuse.ch', generatedAt: new Date().toISOString() });

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);
  const key = process.env.THREATFOX_API_KEY;
  if (!key) return j(degraded('THREATFOX_API_KEY not set'), 200, cors);
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return j(_cache.payload, 200, cors);
  try {
    const r = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'Auth-Key': key, 'Content-Type': 'application/json', 'User-Agent': 'CrystalBall/2.10.21 (threatfox)' },
      body: JSON.stringify({ query: 'get_iocs', days: 1 }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return j(degraded(`ThreatFox returned HTTP ${r.status}`), 200, cors);
    const payload = await r.json();
    const iocs = Array.isArray(payload?.data) ? payload.data : [];
    const result = { iocs, count: iocs.length, source: 'abuse.ch', generatedAt: new Date().toISOString() };
    _cache = { at: Date.now(), payload: result };
    return j(result, 200, cors);
  } catch (error) {
    return j(degraded(`ThreatFox fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}
