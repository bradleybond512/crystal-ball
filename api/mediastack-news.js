/**
 * MediaStack news proxy. Free tier requires MEDIASTACK_API_KEY (500 req/mo).
 * Returns array of {id, title, description, url, source, category, country,
 * language, publishedAt} matching the MediaStackArticle interface.
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { requireAppAuth } from './_auth.js';

export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 10 * 60 * 1000;
// R4-LOW-006: one global cache served the FIRST caller's categories to
// everyone. Entries are now keyed by the normalized category set; the limit is
// applied after the cache (always fetch the maximum once), so callers cannot
// multiply upstream calls by varying it.
export const MEDIASTACK_CATEGORIES = Object.freeze(['business', 'entertainment', 'general', 'health', 'science', 'sports', 'technology']);
const DEFAULT_CATEGORIES = 'business,general,technology';
const FETCH_LIMIT = 100;
const _cache = new Map();

/** Test seam: forget every cached category set. */
export function __resetMediastackCacheForTests() {
  _cache.clear();
}

/** Lower-case, allowlisted, de-duplicated and sorted, so equivalent requests
 *  share one cache entry; nothing valid falls back to the default set. */
export function normalizeCategories(raw) {
  const allowed = new Set(MEDIASTACK_CATEGORIES);
  const picked = new Set(String(raw ?? '').split(',').map((c) => c.trim().toLowerCase()).filter((c) => allowed.has(c)));
  return picked.size > 0 ? [...picked].sort().join(',') : DEFAULT_CATEGORIES;
}

function clampLimit(raw) {
  const value = Number.parseInt(raw ?? '50', 10);
  if (!Number.isFinite(value)) return 50;
  return Math.min(FETCH_LIMIT, Math.max(1, value));
}

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);
  const denied = requireAppAuth(req, cors);
  if (denied) return denied;
  const key = process.env.MEDIASTACK_API_KEY;
  if (!key) return j([], 200, cors);

  const url = new URL(req.url);
  const categories = normalizeCategories(url.searchParams.get('categories'));
  const limit = clampLimit(url.searchParams.get('limit'));
  const cached = _cache.get(categories);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return j(cached.payload.slice(0, limit), 200, cors);

  const params = new URLSearchParams({
    access_key: key,
    languages: 'en',
    categories,
    limit: String(FETCH_LIMIT),
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
    _cache.set(categories, { at: Date.now(), payload: articles });
    return j(articles.slice(0, limit), 200, cors);
  } catch {
    return j([], 200, cors);
  }
}
