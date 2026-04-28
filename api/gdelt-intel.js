/**
 * GDELT 2.0 DOC API proxy. Key-free, public.
 * Returns {events: GdeltEvent[], updatedAt} matching the GdeltIntelPanel.
 *
 * The DOC API endpoint is api.gdeltproject.org/api/v2/doc/doc — the older
 * api.gdeltproject.org/api/v2/* paths sometimes 404; the doc endpoint is
 * the long-term-stable entry point.
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 5 * 60 * 1000;
let _cache = null;

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const empty = (reason) => ({ events: [], updatedAt: Date.now(), stale: true, error: reason });

const DEFAULT_QUERY = '(conflict OR escalation OR strike OR sanctions OR cyberattack OR outbreak)';

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return j(_cache.payload, 200, cors);

  const url = new URL(req.url);
  const query = url.searchParams.get('query') || DEFAULT_QUERY;
  const params = new URLSearchParams({
    query,
    mode: 'ArtList',
    maxrecords: '75',
    format: 'json',
    sort: 'datedesc',
    timespan: '24h',
  });
  try {
    const r = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`, {
      headers: { 'User-Agent': 'CrystalBall/2.10.21 (gdelt)', Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return j(empty(`GDELT returned HTTP ${r.status}`), 200, cors);
    const text = await r.text();
    if (!text || text[0] !== '{' && text[0] !== '[') return j(empty('GDELT returned non-JSON'), 200, cors);
    let payload;
    try { payload = JSON.parse(text); } catch { return j(empty('GDELT JSON parse failed'), 200, cors); }
    const articles = Array.isArray(payload?.articles) ? payload.articles : [];
    const events = articles.map((a) => ({
      title: a?.title ?? '',
      url: a?.url ?? '',
      source: a?.domain ?? a?.sourcecountry ?? 'gdelt',
      tone: Number.parseFloat(a?.tone ?? '0') || 0,
      country: a?.sourcecountry ?? '',
      timestamp: parseGdeltTimestamp(a?.seendate ?? '') ?? Date.now(),
    }));
    const result = { events, updatedAt: Date.now() };
    _cache = { at: Date.now(), payload: result };
    return j(result, 200, cors);
  } catch (error) {
    return j(empty(`GDELT fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}

// GDELT seendate is "YYYYMMDDTHHMMSSZ"
function parseGdeltTimestamp(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return Date.parse(s) || null;
  const [, y, mo, d, h, mi, se] = m;
  const t = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se));
  return Number.isFinite(t) ? t : null;
}
