import type { NewsItem } from '@/types';
import type { NewsFetchResult } from './news-provenance';
import { fetchSupplementalNews } from './newsapi';

export async function fetchNewsDataFeedTracked(query = 'world news'): Promise<NewsFetchResult<NewsItem>> {
  return fetchSupplementalNews('newsdata', new URLSearchParams({ q: query }));
}

export async function fetchNewsDataFeed(query = 'world news'): Promise<NewsItem[]> {
  const result = await fetchNewsDataFeedTracked(query);
  return result.items;
}
