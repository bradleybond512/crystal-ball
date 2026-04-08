// Spaceflight News API v4 — free, no auth, CORS-enabled
// https://api.spaceflightnewsapi.net/v4/articles/

const API_URL = 'https://api.spaceflightnewsapi.net/v4/articles/?limit=20&ordering=-published_at';
const CACHE_TTL_MS = 60 * 60 * 1000;

export interface SpaceflightArticle {
  id: number;
  title: string;
  url: string;
  imageUrl: string | null;
  newsSite: string;
  summary: string;
  publishedAt: Date;
  launches: { id: string; provider: string }[];
  events: { id: number; name: string }[];
}

interface RawArticle {
  id: number;
  title: string;
  url: string;
  image_url?: string | null;
  news_site: string;
  summary: string;
  published_at: string;
  launches?: { launch_id: string; provider: string }[];
  events?: { event_id: number; provider: string }[];
}

let _cache: { articles: SpaceflightArticle[]; ts: number } | null = null;

export async function fetchSpaceflightNews(): Promise<SpaceflightArticle[]> {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) return _cache.articles;
  try {
 const res = await fetch(API_URL, { signal: AbortSignal.timeout(10000) });
 if (!res.ok) {
 _cache = { articles: [], ts: Date.now() };
 return [];
 }
 const json = await res.json() as { results?: RawArticle[] };
 const raw = json.results ?? [];
 const articles: SpaceflightArticle[] = raw.map(r => ({
 id: r.id,
 title: r.title,
 url: r.url,
 imageUrl: r.image_url ?? null,
 newsSite: r.news_site,
 summary: r.summary.slice(0, 300),
 publishedAt: new Date(r.published_at),
 launches: (r.launches ?? []).map(l => ({ id: l.launch_id, provider: l.provider })),
 events: (r.events ?? []).map(e => ({ id: e.event_id, name: e.provider })),
 }));
 _cache = { articles, ts: Date.now() };
 return articles;
  } catch {
 _cache = { articles: [], ts: Date.now() };
 return [];
  }
}
