/**
 * MediaStack news proxy. Free tier requires MEDIASTACK_API_KEY (500 req/mo).
 * Returns array of {id, title, description, url, source, category, country,
 * language, publishedAt} matching the MediaStackArticle interface.
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 10 * 60 * 1000;
let _cache = null;

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);
  const key = process.env.MEDIASTACK_API_KEY;
  if (!key) return j([], 200, cors);
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return j(_cache.payload, 200, cors);

  const url = new URL(req.url);
  const categories = url.searchParams.get('categories') || 'general,business,technology';
  const limit = Math.min(100, Number.parseInt(url.searchParams.get('limit') || '50', 10) || 50);
  const params = new URLSearchParams({
    access_key: key,
    languages: 'en',
    categories,
    limit: String(limit),
    sort: 'published_desc',
  });
  // MediaStack free tier requires HTTP (not HTTPS).
  const upstream = `http://api.mediastack.com/v1/news?${params.toString()}`;
  try {
    const r = await fetch(upstream, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return j([], 200, cors);
    const payload = await r.json();
    const data = Array.isArray(payload?.data) ? payload.data : [];
    const articles = data.map((a, i) => ({
      id: `mediastack-${a?.published_at ?? i}-${i}`,
      title: a?.title ?? null,
      description: a?.description ?? null,
      url: a?.url ?? null,
      source: a?.source ?? null,
      category: a?.category ?? null,
      country: a?.country ?? null,
      language: a?.language ?? null,
      publishedAt: a?.published_at ?? null,
    }));
    _cache = { at: Date.now(), payload: articles };
    return j(articles, 200, cors);
  } catch {
    return j([], 200, cors);
  }
}
