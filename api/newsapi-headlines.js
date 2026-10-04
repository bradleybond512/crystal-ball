import { getCorsHeaders } from './_cors.js';
import { requireAppAuth } from './_auth.js';

export const config = { runtime: 'edge' };

// R4-LOW-006: NewsAPI's free tier is about 100 requests a day. Callers can no
// longer choose the query (an arbitrary `q` per request blinded the feed for
// everyone); the route serves the app's fixed query from a short cache and,
// in a cloud deployment, only to callers holding the app key.
export const NEWSAPI_FIXED_QUERY = 'geopolitics world news';
const NEWSAPI_PAGE_SIZE = 20;
const CACHE_TTL_MS = 20 * 60 * 1000;
let _cache = null;

/** Test seam: forget the cached headlines. */
export function __resetNewsApiCacheForTests() {
  _cache = null;
}

function clampPageSize(raw) {
  const value = Number.parseInt(raw ?? '10', 10);
  if (!Number.isFinite(value)) return 10;
  return Math.min(NEWSAPI_PAGE_SIZE, Math.max(1, value));
}

export default async function handler(req) {
  const corsHeaders = getCorsHeaders(req, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  const denied = requireAppAuth(req, corsHeaders);
  if (denied) return denied;

  const apiKey = process.env.NEWSAPI_KEY;
  if (!apiKey) {
 return Response.json({ error: 'NEWSAPI_KEY not configured' }, {
 status: 503,
 headers: { 'Content-Type': 'application/json', ...corsHeaders },
 });
  }

  const pageSize = clampPageSize(new URL(req.url).searchParams.get('pageSize'));
  const privateHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=120', ...corsHeaders };
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) {
 return Response.json(_cache.items.slice(0, pageSize), { status: 200, headers: privateHeaders });
  }

  try {
 const params = new URLSearchParams({
 q: NEWSAPI_FIXED_QUERY,
 pageSize: String(NEWSAPI_PAGE_SIZE),
 language: 'en',
 sortBy: 'publishedAt',
 apiKey,
 });
 // AbortSignal.timeout caps upstream hang — a slow newsapi.org should not
 // wedge our edge function for the full 30 s Vercel runtime limit.
 const resp = await fetch(`https://newsapi.org/v2/everything?${params}`, {
 headers: { Accept: 'application/json', 'User-Agent': 'CrystalBall/1.0' },
 signal: AbortSignal.timeout(10_000),
 });
 if (!resp.ok) {
 return Response.json([], { status: 200, headers: privateHeaders });
 }
 const data = await resp.json();
 const articles = Array.isArray(data?.articles) ? data.articles : [];
 const items = articles.map((a, i) => ({
 id: `newsapi-${i}`,
 source: a.source?.name ?? 'NewsAPI',
 title: a.title ?? '',
 link: a.url ?? '',
 pubDate: a.publishedAt ?? new Date().toISOString(),
 description: a.description ?? '',
 imageUrl: a.urlToImage ?? undefined,
 }));
 _cache = { at: Date.now(), items };
 return Response.json(items.slice(0, pageSize), { status: 200, headers: privateHeaders });
  } catch {
 return Response.json([], {
 status: 200,
 headers: { 'Content-Type': 'application/json', ...corsHeaders },
 });
  }
}
