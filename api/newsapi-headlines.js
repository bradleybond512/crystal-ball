import { getCorsHeaders } from './_cors.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const corsHeaders = getCorsHeaders(req, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

  const apiKey = process.env.NEWSAPI_KEY;
  if (!apiKey) {
 return Response.json({ error: 'NEWSAPI_KEY not configured' }, {
 status: 503,
 headers: { 'Content-Type': 'application/json', ...corsHeaders },
 });
  }

  const reqUrl = new URL(req.url);
  const q = reqUrl.searchParams.get('q') ?? 'geopolitics world news';
  const rawPageSize = Number.parseInt(reqUrl.searchParams.get('pageSize') ?? '10', 10);
  const pageSize = Math.min(20, Number.isNaN(rawPageSize) ? 10 : rawPageSize);

  try {
 const params = new URLSearchParams({ q, pageSize: String(pageSize), language: 'en', sortBy: 'publishedAt', apiKey });
 // AbortSignal.timeout caps upstream hang — a slow newsapi.org should not
 // wedge our edge function for the full 30 s Vercel runtime limit.
 const resp = await fetch(`https://newsapi.org/v2/everything?${params}`, {
 headers: { Accept: 'application/json', 'User-Agent': 'CrystalBall/1.0' },
 signal: AbortSignal.timeout(10_000),
 });
 if (!resp.ok) {
 return Response.json([], {
 status: 200,
 headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120', ...corsHeaders },
 });
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
 return Response.json(items, {
 status: 200,
 headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120, s-maxage=300', ...corsHeaders },
 });
  } catch {
 return Response.json([], {
 status: 200,
 headers: { 'Content-Type': 'application/json', ...corsHeaders },
 });
  }
}
