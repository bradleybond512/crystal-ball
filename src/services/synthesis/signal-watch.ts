/**
 * Signal-watch — Reddit-based keyword velocity tracker for the
 * SynthesisPanel. Tracks post velocity (posts per hour, last hour vs
 * trailing 24h baseline) for each user-watched keyword. A spike means
 * the public conversation has a sudden lift on that term.
 *
 * Sidecar: /api/signal-watch?q=keyword
 *
 * Pure-deterministic. No fetch, no globals.
 *
 * Deferred from the original brief:
 * - UN Security Council vote records — every UN digital library API
 *   path probed returned 404. Will revisit if a working endpoint is
 *   discovered.
 * - OpenSanctions newest entities — the free tier requires an API key
 *   (returned 401 in pre-build probes). Will land when the key is
 *   provisioned via runtime-config.
 */

export interface RedditChild {
  data?: {
    id?: string;
    title?: string;
    subreddit?: string;
    permalink?: string;
    created_utc?: number;
    score?: number;
    num_comments?: number;
    author?: string;
  };
}

export interface RedditListing {
  data?: {
    children?: RedditChild[];
  };
}

export interface SignalPost {
  id: string;
  title: string;
  subreddit: string;
  url: string;
  createdAt: number;
  score: number;
  comments: number;
  author: string;
}

export interface SignalWatchResult {
  keyword: string;
  /** Posts in the last hour. */
  lastHourCount: number;
  /** Posts per hour averaged over the trailing 24h (excluding the last hour). */
  baselineRate: number;
  /** Ratio = lastHourCount / max(baselineRate, 0.1). >2 = surge. */
  surgeRatio: number;
  surgeLevel: 'normal' | 'elevated' | 'surge' | 'spike';
  /** Total posts collected in the window (capped by Reddit's limit). */
  totalSeen: number;
  /** Sample of newest posts to display. */
  recent: SignalPost[];
}

const HOUR_S = 3600;
const DAY_S = 24 * HOUR_S;

/** Parse a Reddit search listing into normalized SignalPost rows.
 *  Drops malformed entries; sorted newest-first. */
export function parseSignalListing(listing: RedditListing): SignalPost[] {
  const children = listing?.data?.children;
  if (!Array.isArray(children)) return [];
  const out: SignalPost[] = [];
  for (const c of children) {
    const d = c?.data;
    if (!d?.id || !d.title || !d.subreddit || !d.permalink) continue;
    if (!Number.isFinite(d.created_utc)) continue;
    out.push({
      id: d.id,
      title: d.title,
      subreddit: d.subreddit,
      url: `https://www.reddit.com${d.permalink}`,
      createdAt: d.created_utc!,
      score: Number.isFinite(d.score) ? d.score! : 0,
      comments: Number.isFinite(d.num_comments) ? d.num_comments! : 0,
      author: d.author ?? 'unknown',
    });
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

/** Compute a SignalWatchResult from a set of posts.
 *  `nowSec` defaults to current epoch seconds. */
export function computeSignalWatch(
  keyword: string,
  posts: readonly SignalPost[],
  nowSec: number = Math.floor(Date.now() / 1000),
): SignalWatchResult {
  const oneHourAgo = nowSec - HOUR_S;
  const oneDayAgo = nowSec - DAY_S;

  let lastHourCount = 0;
  let lastDayPriorHourCount = 0;
  for (const p of posts) {
    if (p.createdAt >= oneHourAgo && p.createdAt <= nowSec) {
      lastHourCount += 1;
    } else if (p.createdAt >= oneDayAgo && p.createdAt < oneHourAgo) {
      lastDayPriorHourCount += 1;
    }
  }
  const baselineRate = lastDayPriorHourCount / 23; // 23 hours of prior data
  const denom = Math.max(baselineRate, 0.1);
  const surgeRatio = lastHourCount / denom;

  let surgeLevel: SignalWatchResult['surgeLevel'] = 'normal';
  if (surgeRatio >= 5) surgeLevel = 'spike';
  else if (surgeRatio >= 2.5) surgeLevel = 'surge';
  else if (surgeRatio >= 1.5) surgeLevel = 'elevated';

  return {
    keyword,
    lastHourCount,
    baselineRate: Number(baselineRate.toFixed(3)),
    surgeRatio: Number(surgeRatio.toFixed(2)),
    surgeLevel,
    totalSeen: posts.length,
    recent: [...posts].slice(0, 10),
  };
}
