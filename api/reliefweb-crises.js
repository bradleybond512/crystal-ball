/**
 * ReliefWeb crises proxy. Public, key-free.
 * Pulls latest reports tagged with humanitarian crises (last 14 days).
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 30 * 60 * 1000;
let _cache = null;

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const degraded = (reason) => ({ reports: [], degraded: true, reason, source: 'reliefweb.int', generatedAt: new Date().toISOString() });

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return j(_cache.payload, 200, cors);

  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const body = {
    fields: { include: ['title', 'date', 'url', 'country', 'theme', 'source', 'body'] },
    filter: { field: 'date.created', value: { from: since } },
    sort: ['date.created:desc'],
    limit: 50,
  };
  try {
    const r = await fetch('https://api.reliefweb.int/v1/reports?appname=crystalball', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'CrystalBall/2.10.21' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return j(degraded(`ReliefWeb returned HTTP ${r.status}`), 200, cors);
    const payload = await r.json();
    const data = Array.isArray(payload?.data) ? payload.data : [];
    const reports = data.map((d) => {
      const f = d?.fields ?? {};
      return {
        id: d?.id ?? '',
        title: f?.title ?? '',
        date: f?.date?.created ?? '',
        link: f?.url ?? '',
        countries: (f?.country ?? []).map((c) => c?.name ?? '').filter(Boolean),
        themes: (f?.theme ?? []).map((t) => t?.name ?? '').filter(Boolean),
        source: f?.source?.[0]?.name ?? '',
        body: (f?.body ?? '').replaceAll(/<[^>]{0,4096}>/g, ' ').replaceAll(/\s+/g, ' ').trim().slice(0, 600),
      };
    });
    const result = { reports, count: reports.length, source: 'reliefweb.int', generatedAt: new Date().toISOString() };
    _cache = { at: Date.now(), payload: result };
    return j(result, 200, cors);
  } catch (error) {
    return j(degraded(`ReliefWeb fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}
