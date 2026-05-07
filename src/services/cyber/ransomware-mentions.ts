/**
 * Reddit-derived ransomware activity proxy. The user's preferred source
 * (ransomwatch.telemetry.ltd /api/v2/posts.json) returned 404 in
 * pre-build probes, so we use Reddit's public JSON search as a noisier
 * but reachable proxy: posts mentioning "ransomware" in r/all sorted
 * newest-first surface group names + victim discussions.
 *
 * Sidecar: /api/cyber-ransomware-mentions (Reddit search proxy)
 *
 * Pure-deterministic. No fetch, no globals.
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
    selftext?: string;
  };
}

export interface RedditListing {
  data?: {
    children?: RedditChild[];
  };
}

export interface RansomwareMention {
  id: string;
  title: string;
  subreddit: string;
  url: string;
  createdAt: number;
  score: number;
  comments: number;
  author: string;
  /** Group names extracted from the title (e.g. "LockBit", "ALPHV"). */
  groups: string[];
}

/**
 * Static catalog of well-known ransomware-as-a-service group names
 * (recognized in lowercase, surfaced as Title Case). Update as the
 * landscape changes.
 */
export const KNOWN_RANSOMWARE_GROUPS: readonly string[] = [
  'LockBit',
  'ALPHV',
  'BlackCat',
  'Cl0p',
  'Clop',
  'Royal',
  'Akira',
  'Play',
  'Medusa',
  'BianLian',
  'Rhysida',
  'Black Basta',
  'Hive',
  'Conti',
  '8Base',
  'Cactus',
  'NoEscape',
  'Qilin',
  'Trigona',
  'Vice Society',
];

const GROUP_LOOKUP = new Map<string, string>();
for (const g of KNOWN_RANSOMWARE_GROUPS) {
  GROUP_LOOKUP.set(g.toLowerCase(), g);
}

/** Extract recognized ransomware group names from arbitrary text. */
export function extractGroups(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const found = new Set<string>();
  for (const [needle, canonical] of GROUP_LOOKUP) {
    if (lower.includes(needle)) found.add(canonical);
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

/** Normalize a Reddit listing into RansomwareMention[]. Skips entries
 *  missing required fields. Sorted newest-first. */
export function parseRedditListing(listing: RedditListing): RansomwareMention[] {
  const children = listing?.data?.children;
  if (!Array.isArray(children)) return [];
  const out: RansomwareMention[] = [];
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
      groups: extractGroups(`${d.title}\n${d.selftext ?? ''}`),
    });
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

/** Aggregate group mention counts across a set of mentions. */
export function aggregateGroupCounts(mentions: readonly RansomwareMention[]): { group: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const m of mentions) {
    for (const g of m.groups) {
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([group, count]) => ({ group, count }))
    .sort((a, b) => b.count - a.count || a.group.localeCompare(b.group));
}
