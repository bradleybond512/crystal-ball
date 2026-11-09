import { getCorsHeaders } from './_cors.js';
import { requireAppAuth } from './_auth.js';
import { newsAcquisition, newsFailure, newsStatus, newsHttpOutcome, normalizeNewsRows, newsEnvelope, legacyNewsItems } from './_news-provenance.js';

export const config = { runtime: 'edge' };

export const NEWSAPI_FIXED_QUERY = 'geopolitics world news';
const NEWSAPI_PAGE_SIZE = 20;
const CACHE_TTL_MS = 20 * 60 * 1000;
let cache = null;

export function __resetNewsApiCacheForTests() { cache = null; }

export default async function handler(req) {
  const corsHeaders = getCorsHeaders(req, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  const denied = requireAppAuth(req, { ...corsHeaders, 'Cache-Control': 'no-store' });
  if (denied) return denied;
  const reqUrl = new URL(req.url);
  const mode = reqUrl.searchParams.get('responseMode');
  const tracked = mode === 'tracked-v1';
  const respond = (items, acquisition) => {
    const failed = !['ok', 'empty'].includes(acquisition.outcome);
    return Response.json(tracked ? newsEnvelope(items, acquisition) : legacyNewsItems(items), {
      status: tracked ? newsStatus(acquisition.outcome) : 200,
      headers: { ...corsHeaders, 'Cache-Control': failed || tracked ? 'no-store' : 'private, max-age=120' },
    });
  };
  if (mode !== null && !tracked) return Response.json({ error: 'news_invalid_response_mode' }, { status: 400, headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
  const apiKey = process.env.NEWSAPI_KEY;
  if (!apiKey) {
    if (tracked) return respond([], newsAcquisition('unconfigured'));
    return Response.json({ error: 'news_unconfigured' }, { status: 503, headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
  }
  const q = NEWSAPI_FIXED_QUERY;
  const rawPageSize = Number.parseInt(reqUrl.searchParams.get('pageSize') ?? '10', 10);
  const pageSize = Math.min(NEWSAPI_PAGE_SIZE, Math.max(1, Number.isNaN(rawPageSize) ? 10 : rawPageSize));
  if (cache && Date.now() - cache.storedAt < CACHE_TTL_MS) {
    return respond(cache.items.slice(0, pageSize), {
      ...cache.acquisition, delivery: 'server_cache', cacheStoredAt: cache.storedAt,
    });
  }
  const attemptedAt = Date.now();
  try {
    const params = new URLSearchParams({ q, pageSize: String(NEWSAPI_PAGE_SIZE), language: 'en', sortBy: 'publishedAt', apiKey });
    const resp = await fetch(`https://newsapi.org/v2/everything?${params}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'CrystalBall/1.0' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return respond([], newsAcquisition(newsHttpOutcome(resp.status), attemptedAt));
    let data;
    try { data = await resp.json(); } catch { return respond([], newsAcquisition('malformed', attemptedAt)); }
    const items = normalizeNewsRows(data, 'newsapi');
    const acquiredAt = Date.now();
    const acquisition = newsAcquisition(items.length ? 'ok' : 'empty', attemptedAt, acquiredAt, items.length, 'upstream');
    cache = { items, acquisition, storedAt: acquiredAt };
    return respond(items.slice(0, pageSize), acquisition);
  } catch (error) {
    return respond([], newsAcquisition(newsFailure(error), attemptedAt));
  }
}
