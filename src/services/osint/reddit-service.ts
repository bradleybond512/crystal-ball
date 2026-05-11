/**
 * Reddit OSINT service.
 *
 * Pure-deterministic helpers + thin renderer-side fetch wrapper around
 * `/api/osint/reddit`. The sidecar handles the actual reddit.com HTTPS
 * call (User-Agent rule + per-subreddit caching) — this module owns
 * the JSON-shape parsers and keyword-match scaffolding so they can be
 * unit-tested on fixtures.
 *
 * No DOM, no globals at import time.
 */

import { getApiBaseUrl } from '../runtime';

// ── Public types ───────────────────────────────────────────────────────

export interface RedditPost {
  id: string;
  subreddit: string;
  title: string;
  url: string;
  permalink: string;
  score: number;
  numComments: number;
  /** Seconds since epoch. */
  createdUtc: number;
  flair: string | null;
  author: string;
  /** "self.netsec" for self-posts, otherwise the linked-out hostname. */
  domain: string | null;
  /** True when Reddit flagged the post as 18+ — we surface but don't
   *  hide; OSINT users need access to anything that might be relevant. */
  over18: boolean;
}

export interface RedditFeed {
  posts: RedditPost[];
  /** Subreddits actually fetched (subset of requested, in case any
   *  returned a permanent 4xx). */
  subreddits: string[];
  /** Set when one or more subreddits returned a non-200 / 429. */
  degraded: boolean;
  /** ISO timestamp of the snapshot. */
  generatedAt: string;
  /** Sidecar-supplied error string when `degraded` — null otherwise. */
  reason: string | null;
}

/** Default subreddits the panel polls — threat-relevant feeds. The
 *  spec calls out these six explicitly. Mutable allowlists live in
 *  localStorage on the renderer side. */
export const DEFAULT_SUBREDDITS: readonly string[] = [
  'netsec',
  'cybersecurity',
  'worldnews',
  'geopolitics',
  'RBI',
  'EmergencyManagement',
];

const VALID_SUBREDDIT = /^[a-z0-9][a-z0-9_]{1,20}$/i;

/** Filter a free-form comma-separated list into valid subreddit names.
 *  Reddit subreddit names are alphanumeric + underscore, 2..21 chars,
 *  must start with a letter or digit. */
export function parseSubredditList(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of raw.split(',')) {
    const trimmed = token.trim().replace(/^r\//i, '');
    if (!VALID_SUBREDDIT.test(trimmed)) continue;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(trimmed);
  }
  return out;
}

// ── Pure parsers ───────────────────────────────────────────────────────

interface RedditApiChild {
  kind?: unknown;
  data?: unknown;
}

interface RedditApiPostData {
  id?: unknown;
  subreddit?: unknown;
  title?: unknown;
  url?: unknown;
  permalink?: unknown;
  score?: unknown;
  num_comments?: unknown;
  created_utc?: unknown;
  link_flair_text?: unknown;
  author?: unknown;
  domain?: unknown;
  over_18?: unknown;
  stickied?: unknown;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Parse the Reddit JSON listing payload. Reddit's `t3` (link) records
 * are wrapped in `data.children[].data` — we drop stickied posts
 * (announcements / pinned megathreads) and skip anything missing an
 * id / title.
 */
export function parseRedditListing(raw: unknown, defaultSubreddit = ''): RedditPost[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  const dataNode = obj.data as Record<string, unknown> | undefined;
  const children = dataNode && Array.isArray(dataNode.children) ? dataNode.children : [];
  const out: RedditPost[] = [];
  for (const child of children as RedditApiChild[]) {
    if (!child?.data || typeof child.data !== 'object') continue;
    if (child.kind !== undefined && child.kind !== 't3') continue;
    const p = child.data as RedditApiPostData;
    if (p.stickied === true) continue;
    const id = asString(p.id);
    const title = asString(p.title);
    if (!id || !title) continue;
    const subreddit = asString(p.subreddit) ?? defaultSubreddit;
    const permalinkPath = asString(p.permalink) ?? `/r/${subreddit}/comments/${id}`;
    out.push({
      id,
      subreddit,
      title,
      url: asString(p.url) ?? `https://www.reddit.com${permalinkPath}`,
      permalink: `https://www.reddit.com${permalinkPath}`,
      score: asNumber(p.score) ?? 0,
      numComments: asNumber(p.num_comments) ?? 0,
      createdUtc: asNumber(p.created_utc) ?? 0,
      flair: asString(p.link_flair_text) ?? null,
      author: asString(p.author) ?? '[deleted]',
      domain: asString(p.domain) ?? null,
      over18: p.over_18 === true,
    });
  }
  return out;
}

// ── Keyword highlight scaffolding ──────────────────────────────────────

const KEYWORDS_STORAGE_KEY = 'cb:reddit-osint-keywords';

/** Default keywords seeded when the user has nothing saved. The spec
 *  calls out "breach, ransomware, earthquake" — we add a few more that
 *  are obviously action-worthy. */
export const DEFAULT_KEYWORDS: readonly string[] = [
  'breach', 'ransomware', 'earthquake', 'zero-day', 'critical', 'CVE-',
];

export function loadSavedKeywords(): string[] {
  try {
    const raw = localStorage.getItem(KEYWORDS_STORAGE_KEY);
    if (!raw) return [...DEFAULT_KEYWORDS];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_KEYWORDS];
    const out: string[] = [];
    for (const item of parsed) {
      if (typeof item === 'string' && item.trim().length > 0) out.push(item.trim());
    }
    return out.length > 0 ? out : [...DEFAULT_KEYWORDS];
  } catch {
    return [...DEFAULT_KEYWORDS];
  }
}

export function saveSavedKeywords(keywords: readonly string[]): void {
  try {
    localStorage.setItem(KEYWORDS_STORAGE_KEY, JSON.stringify([...keywords]));
  } catch { /* quota / unavailable storage */ }
}

/** Build a case-insensitive matcher that tells the panel which keyword
 *  (if any) matched a given post — used both for highlighting and for
 *  the "only show matches" filter. Empty list → returns null match. */
export function buildKeywordMatcher(
  keywords: readonly string[],
): (post: RedditPost) => string | null {
  const normalised = keywords
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0);
  if (normalised.length === 0) return () => null;
  return (post: RedditPost) => {
    const haystack = `${post.title} ${post.flair ?? ''} ${post.domain ?? ''}`.toLowerCase();
    for (const keyword of normalised) {
      if (haystack.includes(keyword)) return keyword;
    }
    return null;
  };
}

// ── Time-ago formatting ────────────────────────────────────────────────

export function formatTimeAgo(createdUtc: number, nowMs: number = Date.now()): string {
  if (!Number.isFinite(createdUtc) || createdUtc <= 0) return '—';
  const seconds = Math.max(0, Math.floor(nowMs / 1000 - createdUtc));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// ── Renderer-side fetch wrapper ────────────────────────────────────────

export interface FetchRedditFeedOptions {
  subreddits?: readonly string[];
  limit?: number;
}

const FEED_PATH = '/api/osint/reddit';
const DEFAULT_LIMIT = 25;

export async function fetchRedditFeed(opts: FetchRedditFeedOptions = {}): Promise<RedditFeed> {
  const subreddits = opts.subreddits && opts.subreddits.length > 0
    ? [...opts.subreddits]
    : [...DEFAULT_SUBREDDITS];
  const limit = typeof opts.limit === 'number' && opts.limit > 0 ? Math.min(100, Math.floor(opts.limit)) : DEFAULT_LIMIT;

  try {
    const params = new URLSearchParams();
    params.set('subreddits', subreddits.join(','));
    params.set('limit', String(limit));
    const url = `${getApiBaseUrl()}${FEED_PATH}?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) return emptyFeed(subreddits, `HTTP ${res.status}`);
    const data = (await res.json()) as Partial<RedditFeed>;
    return {
      posts: Array.isArray(data.posts) ? data.posts : [],
      subreddits: Array.isArray(data.subreddits) ? data.subreddits : subreddits,
      degraded: data.degraded === true,
      generatedAt: typeof data.generatedAt === 'string' ? data.generatedAt : new Date(0).toISOString(),
      reason: typeof data.reason === 'string' ? data.reason : null,
    };
  } catch (error) {
    return emptyFeed(subreddits, error instanceof Error ? error.message : String(error));
  }
}

function emptyFeed(subreddits: string[], reason: string): RedditFeed {
  return {
    posts: [],
    subreddits,
    degraded: true,
    generatedAt: new Date(0).toISOString(),
    reason,
  };
}
