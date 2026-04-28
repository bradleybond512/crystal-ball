/**
 * Cyber threats aggregate — combines CISA KEV + ThreatFox + URLhaus
 * + OTX into one normalized list. Sidecar-only by design: in the
 * desktop sidecar each per-source route is a sibling on the same
 * 127.0.0.1:LOCAL_API_PORT origin. On Vercel edge that loopback
 * doesn't exist (each function runs in its own isolate), so we'd be
 * fetching nothing — we degrade fast instead.
 *
 * For the cloud deployment, callers should hit the per-source routes
 * directly (each one fetches its own upstream over the public internet)
 * rather than relying on this aggregator.
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

function emptyAggregate(reason) {
  return {
    sources: SOURCES.map((s) => ({ source: s.label, count: 0, items: [], degraded: true, reason })),
    totalCount: 0,
    degradedSources: SOURCES.length,
    degraded: true,
    reason,
    generatedAt: new Date().toISOString(),
  };
}

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);

  // Only run when LOCAL_API_PORT is set (sidecar mode). On Vercel
  // edge this env var is absent and 127.0.0.1 wouldn't reach our
  // sister functions anyway — bail out with a degraded payload so
  // panels render an empty banner instead of stalling on 4×15-second
  // timeouts.
  const port = process.env.LOCAL_API_PORT;
  const token = process.env.LOCAL_API_TOKEN;
  if (!port) {
    return j(
      emptyAggregate('Aggregator only runs in the desktop sidecar; cloud deployments should query per-source routes directly.'),
      200,
      cors,
    );
  }

  const results = await Promise.allSettled(SOURCES.map(async (s) => {
    try {
      const r = await fetch(`http://127.0.0.1:${port}${s.path}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) return { source: s.label, count: 0, items: [], degraded: true, reason: `HTTP ${r.status}` };
      const data = await r.json();
      // Per-source routes return either a normalized array (the
      // existing `cisa-kev` / `otx-iocs` contracts) or a `{ key: [] }`
      // wrapper (ThreatFox / URLhaus). Accept both.
      let items;
      if (Array.isArray(data)) {
        items = data;
      } else if (Array.isArray(data?.[s.key])) {
        items = data[s.key];
      } else {
        items = [];
      }
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
