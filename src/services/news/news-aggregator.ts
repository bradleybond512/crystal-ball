/**
 * News aggregator — pure-deterministic projection over GDELT 2.0 Doc
 * articles (the existing /api/gdelt-intel sidecar shape) plus any
 * supplementary article rows passed in. No DOM, no fetch — the sidecar
 * does the network round-trip.
 *
 * Public surface:
 *   - normalizeArticle(): coerces upstream-shaped rows into the
 *     internal Article type, classifies by topic, and emits null for
 *     entries without a title + url.
 *   - aggregateHeadlines(): merges multiple feeds, dedups by url (keeps
 *     the most recent timestamp), filters by topic, returns the top-N
 *     newest articles per topic mix.
 *   - isBreaking(): boolean — true when an article is < BREAKING_AGE_MS
 *     old. Used by the panel's "Breaking" badge.
 *
 * Topic classification is keyword-driven over title + url + source.
 * Each topic has a small curated keyword set; we score the article
 * against every topic and assign the highest-scoring one (with a
 * default of "general" when nothing matches). The rule of thumb: keep
 * the set short so the classifier stays explainable.
 */

export type NewsTopic =
  | 'security'
  | 'geopolitical'
  | 'natural_disasters'
  | 'economic'
  | 'health'
  | 'general';

export interface Article {
  /** Stable id: lowercased URL (after stripping the query string). */
  id: string;
  title: string;
  url: string;
  source: string;
  country: string | null;
  /** ms epoch of publication. Null when upstream omits it. */
  publishedAt: number | null;
  topic: NewsTopic;
  /** GDELT tone, -1..+1 (rescaled). Null when not available. */
  tone: number | null;
}

export interface AggregateOptions {
  /** Filter to a single topic. 'all' (or undefined) keeps every topic. */
  topic?: NewsTopic | 'all';
  /** Cap on returned articles (default 50). */
  limit?: number;
  /** Optional keyword filter (matches title case-insensitively). */
  query?: string;
}

// ─── Topic classification ─────────────────────────────────────────────

const TOPIC_KEYWORDS: Record<Exclude<NewsTopic, 'general'>, readonly string[]> = {
  security: ['attack', 'shooting', 'terror', 'bomb', 'cyber', 'cyberattack', 'cyberattacks', 'hack', 'hacked', 'breach', 'ransomware', 'ransom', 'malware', 'phishing', 'espionage', 'arrest'],
  geopolitical: ['war', 'wars', 'conflict', 'sanction', 'sanctions', 'diplomat', 'embassy', 'treaty', 'border', 'invasion', 'china', 'russia', 'iran', 'nato', 'eu', 'nuclear'],
  natural_disasters: ['earthquake', 'hurricane', 'typhoon', 'tornado', 'flood', 'flooding', 'wildfire', 'wildfires', 'volcano', 'tsunami', 'landslide', 'drought', 'storm', 'cyclone'],
  economic: ['market', 'markets', 'stock', 'stocks', 'inflation', 'recession', 'gdp', 'tariff', 'tariffs', 'oil', 'crypto', 'bitcoin', 'fed', 'rate', 'jobs', 'unemployment'],
  health: ['outbreak', 'pandemic', 'virus', 'covid', 'flu', 'measles', 'cholera', 'ebola', 'who', 'cdc', 'vaccine', 'disease'],
};

/** Token-aware classifier: keywords must match whole words inside the
 *  haystack so "war" doesn't fire on "award" and "eu" doesn't fire on
 *  "europe". URLs are tokenised on non-alphanumerics. */
export function classifyTopic(title: string, url: string, source: string): NewsTopic {
  const tokens = new Set(
    `${title} ${url} ${source}`
      .toLowerCase()
      .split(/[^a-z0-9.]+/)
      .filter(Boolean),
  );
  let best: { topic: NewsTopic; hits: number } = { topic: 'general', hits: 0 };
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS) as [NewsTopic, readonly string[]][]) {
    let hits = 0;
    for (const kw of keywords) {
      if (tokens.has(kw)) hits++;
    }
    if (hits > best.hits) best = { topic, hits };
  }
  return best.topic;
}

// ─── Normalization ────────────────────────────────────────────────────

export interface RawArticle {
  title?: unknown;
  url?: unknown;
  source?: unknown;
  /** GDELT uses `domain`; some feeds use `source.name`. Both accepted. */
  domain?: unknown;
  country?: unknown;
  /** ms epoch, ISO string, or GDELT `seendate` (YYYYMMDDTHHMMSSZ). */
  timestamp?: unknown;
  publishedAt?: unknown;
  published_at?: unknown;
  seendate?: unknown;
  tone?: unknown;
}

export function normalizeArticle(raw: RawArticle): Article | null {
  const title = stringOrEmpty(raw.title);
  const url = stringOrEmpty(raw.url);
  if (!title || !url) return null;
  const source = stringOrEmpty(raw.source ?? raw.domain);
  const country = stringOrNull(raw.country);
  const publishedAt = parseAnyTimestamp(raw.publishedAt ?? raw.published_at ?? raw.timestamp ?? raw.seendate);
  const tone = numOrNull(raw.tone);
  return {
    id: urlToId(url),
    title,
    url,
    source: source || 'unknown',
    country,
    publishedAt,
    topic: classifyTopic(title, url, source),
    tone,
  };
}

function urlToId(url: string): string {
  const qmark = url.indexOf('?');
  return (qmark === -1 ? url : url.slice(0, qmark)).toLowerCase();
}

// ─── Aggregation ──────────────────────────────────────────────────────

export function aggregateHeadlines(
  feeds: readonly (readonly RawArticle[])[],
  opts: AggregateOptions = {},
): Article[] {
  const byId = dedupArticles(feeds);
  let merged = [...byId.values()];
  const wantedTopic = opts.topic && opts.topic !== 'all' ? opts.topic : null;
  if (wantedTopic) merged = merged.filter((a) => a.topic === wantedTopic);
  const query = opts.query?.trim().toLowerCase();
  if (query) merged = merged.filter((a) => a.title.toLowerCase().includes(query));
  merged.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
  const limit = Math.max(1, Math.min(500, opts.limit ?? 50));
  return merged.slice(0, limit);
}

function dedupArticles(feeds: readonly (readonly RawArticle[])[]): Map<string, Article> {
  const byId = new Map<string, Article>();
  for (const feed of feeds) {
    for (const raw of feed) {
      const article = normalizeArticle(raw);
      if (!article) continue;
      const existing = byId.get(article.id);
      if (!existing || shouldReplace(existing, article)) {
        byId.set(article.id, article);
      }
    }
  }
  return byId;
}

/** Replace when newer-by-publishedAt, or same time but longer (less-truncated) title. */
function shouldReplace(existing: Article, candidate: Article): boolean {
  const existingAt = existing.publishedAt ?? 0;
  const candidateAt = candidate.publishedAt ?? 0;
  if (candidateAt > existingAt) return true;
  if (candidateAt === existingAt) return candidate.title.length > existing.title.length;
  return false;
}

// ─── Breaking flag ────────────────────────────────────────────────────

export const BREAKING_AGE_MS = 30 * 60 * 1000;

export function isBreaking(article: Article, now: number): boolean {
  if (article.publishedAt === null) return false;
  return now - article.publishedAt < BREAKING_AGE_MS && now >= article.publishedAt;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function stringOrEmpty(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function stringOrNull(v: unknown): string | null {
  if (typeof v === 'string') {
    const s = v.trim();
    return s || null;
  }
  return null;
}

function numOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

const GDELT_TIMESTAMP_RX = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;

/**
 * Accepts:
 *   - ms epoch number
 *   - ISO-8601 string
 *   - GDELT `seendate` (YYYYMMDDTHHMMSSZ)
 *   - seconds-since-epoch number (auto-detected when < 1e12)
 */
function parseAnyTimestamp(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v < 1e12 ? v * 1000 : v;
  }
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  const gdeltMatch = GDELT_TIMESTAMP_RX.exec(s);
  if (gdeltMatch?.[1]) {
    const [, y, mo, d, h, mi, se] = gdeltMatch;
    const t = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se));
    return Number.isFinite(t) ? t : null;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}
