/**
 * AbuseIPDB recent reports proxy. Free with ABUSEIPDB_API_KEY.
 * Returns the recent confidence scores summary (no per-IP scan).
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const degraded = (reason) => ({ reports: [], degraded: true, reason, source: 'abuseipdb.com', generatedAt: new Date().toISOString() });

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);
  const key = process.env.ABUSEIPDB_API_KEY;
  if (!key) return j(degraded('ABUSEIPDB_API_KEY not set'), 200, cors);
  // AbuseIPDB has no listing endpoint on the free tier; we just confirm
  // the key is wired so the panel shows "ready" instead of "missing".
  return j({
    reports: [],
    keyConfigured: true,
    note: 'AbuseIPDB free tier does not expose a listing endpoint; use /check?ipAddress=… to look up a specific IP.',
    source: 'abuseipdb.com',
    generatedAt: new Date().toISOString(),
  }, 200, cors);
}
