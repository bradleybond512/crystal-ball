import { getApiBaseUrl } from '@/services/runtime';
import { isFeatureAvailable } from '@/services/runtime-config';

export interface DodNewsItem {
  title: string | null;
  link: string | null;
  pubDate: string | null;
  description: string | null;
  source: string;
}

export async function fetchDodNews(): Promise<DodNewsItem[]> {
  if (!isFeatureAvailable('dodNewsRss')) return [];
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/dod-news`);
 if (!res.ok) return [];
 return (await res.json()) as DodNewsItem[];
  } catch {
 return [];
  }
}
