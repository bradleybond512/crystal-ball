/**
 * Cyber threats aggregate — combines CISA KEV + ThreatFox + URLhaus
 * + OTX into one normalized list. No external secrets needed beyond
 * the per-source ones (handled by the underlying handlers).
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const SOURCES = [
  { id: 'cisa-kev', path: '/api/cisa-kev', key: 'kev', label: 'CISA KEV' },
  { id: 'threatfox', path: '/api/threatfox-iocs', key: 'iocs', label: 'ThreatFox' },
  { id: 'urlhaus', path: '/api/urlhaus-feed', key: 'items', label: 'URLhaus' },
  { id: 'otx', path: '/api/otx-pulses', key: 'pulses', label: 'OTX' },
];

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);

  const port = process.env.LOCAL_API_PORT || '46123';
  const token = process.env.LOCAL_API_TOKEN || '';

  const results = await Promise.allSettled(SOURCES.map(async (s) => {
    try {
      const r = await fetch(`http://127.0.0.1:${port}${s.path}`, {
        headers: { 'Authorization': `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) return { source: s.label, count: 0, items: [], degraded: true, reason: `HTTP ${r.status}` };
      const data = await r.json();
      const items = Array.isArray(data?.[s.key]) ? data[s.key] : [];
      return {
        source: s.label,
        count: items.length,
        items: items.slice(0, 50),
        degraded: !!data?.degraded,
        reason: data?.reason,
      };
    } catch (error) {
      return { source: s.label, count: 0, items: [], degraded: true, reason: error?.message ?? String(error) };
    }
  }));

  const sources = results.map((r) => r.status === 'fulfilled' ? r.value : { source: 'unknown', count: 0, items: [], degraded: true, reason: 'fetch threw' });
  const totalCount = sources.reduce((sum, s) => sum + s.count, 0);
  const degradedCount = sources.filter((s) => s.degraded).length;

  return j({
    sources,
    totalCount,
    degradedSources: degradedCount,
    generatedAt: new Date().toISOString(),
  }, 200, cors);
}
