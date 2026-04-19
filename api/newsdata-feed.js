import { getCorsHeaders } from './_cors.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const corsHeaders = getCorsHeaders(req, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

  const apiKey = process.env.NEWSDATA_API_KEY;
  if (!apiKey) {
 return Response.json({ error: 'NEWSDATA_API_KEY not configured' }, {
 status: 503,
 headers: { 'Content-Type': 'application/json', ...corsHeaders },
 });
  }

  const reqUrl = new URL(req.url);
  const q = reqUrl.searchParams.get('q') ?? 'world news';

  try {
 const params = new URLSearchParams({ apikey: apiKey, q, language: 'en' });
 // Bound upstream latency so a newsdata.io stall can't wedge the edge function.
 const resp = await fetch(`https://newsdata.io/api/1/latest?${params}`, {
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
 const results = Array.isArray(data?.results) ? data.results : [];
 const items = results.map((a, i) => ({
 id: `newsdata-${i}`,
 source: a.source_name ?? a.source_id ?? 'NewsData',
 title: a.title ?? '',
 link: a.link ?? '',
 pubDate: a.pubDate ?? new Date().toISOString(),
 description: a.description ?? '',
 imageUrl: a.image_url ?? undefined,
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
