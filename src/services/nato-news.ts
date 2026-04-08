import { getApiBaseUrl } from '@/services/runtime';
import { isFeatureAvailable } from '@/services/runtime-config';

export interface NatoNewsItem {
  title: string | null;
  link: string | null;
  pubDate: string | null;
  description: string | null;
  source: string;
}

export async function fetchNatoNews(): Promise<NatoNewsItem[]> {
  if (!isFeatureAvailable('natoNewsRss')) return [];
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/nato-news`);
 if (!res.ok) return [];
 return (await res.json()) as NatoNewsItem[];
  } catch {
 return [];
  }
}
