import { getCorsHeaders } from './_cors.js';
import { newsAcquisition, newsFailure, newsStatus, newsHttpOutcome, normalizeNewsRows, newsEnvelope, legacyNewsItems } from './_news-provenance.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const corsHeaders = getCorsHeaders(req, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  const reqUrl = new URL(req.url);
  const mode = reqUrl.searchParams.get('responseMode');
  const tracked = mode === 'tracked-v1';
  const respond = (items, acquisition) => {
    const failed = !['ok', 'empty'].includes(acquisition.outcome);
    return Response.json(tracked ? newsEnvelope(items, acquisition) : legacyNewsItems(items), {
      status: tracked ? newsStatus(acquisition.outcome) : 200,
      headers: { ...corsHeaders, 'Cache-Control': failed || tracked ? 'no-store' : 'public, max-age=120, s-maxage=300' },
    });
  };
  if (mode !== null && !tracked) return Response.json({ error: 'news_invalid_response_mode' }, { status: 400, headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
  const apiKey = process.env.NEWSAPI_KEY;
  if (!apiKey) {
    if (tracked) return respond([], newsAcquisition('unconfigured'));
    return Response.json({ error: 'news_unconfigured' }, { status: 503, headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
  }
  const q = reqUrl.searchParams.get('q') ?? 'geopolitics world news';
  const rawPageSize = Number.parseInt(reqUrl.searchParams.get('pageSize') ?? '10', 10);
  const pageSize = Math.min(20, Number.isNaN(rawPageSize) ? 10 : rawPageSize);
  const attemptedAt = Date.now();
  try {
    const params = new URLSearchParams({ q, pageSize: String(pageSize), language: 'en', sortBy: 'publishedAt', apiKey });
    const resp = await fetch(`https://newsapi.org/v2/everything?${params}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'CrystalBall/1.0' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return respond([], newsAcquisition(newsHttpOutcome(resp.status), attemptedAt));
    let data;
    try { data = await resp.json(); } catch { return respond([], newsAcquisition('malformed', attemptedAt)); }
    const items = normalizeNewsRows(data, 'newsapi');
    return respond(items, newsAcquisition(items.length ? 'ok' : 'empty', attemptedAt, Date.now(), items.length, 'upstream'));
  } catch (error) {
    return respond([], newsAcquisition(newsFailure(error), attemptedAt));
  }
}
