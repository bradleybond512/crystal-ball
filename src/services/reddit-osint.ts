import { getApiBaseUrl } from '@/services/runtime';
import { isFeatureAvailable } from '@/services/runtime-config';

export interface RedditPost {
  id: string | null;
  title: string | null;
  subreddit: string | null;
  url: string | null;
  permalink: string;
  score: number;
  numComments: number;
  flair: string | null;
  createdUtc: number | null;
  domain: string | null;
}

export async function fetchRedditGeoPosts(subreddit?: string): Promise<RedditPost[]> {
  if (!isFeatureAvailable('redditOsint')) return [];
  try {
 const params = subreddit ? `?sub=${encodeURIComponent(subreddit)}` : '';
 const res = await fetch(`${getApiBaseUrl()}/api/reddit-geo${params}`);
 if (!res.ok) return [];
 return (await res.json()) as RedditPost[];
  } catch {
 return [];
  }
}
