import { getApiBaseUrl } from '@/services/runtime';
import { isFeatureAvailable } from '@/services/runtime-config';

export interface MediaStackArticle {
  id: string;
  title: string | null;
  description: string | null;
  url: string | null;
  source: string | null;
  category: string | null;
  country: string | null;
  language: string | null;
  publishedAt: string | null;
}

export async function fetchMediaStackNews(): Promise<MediaStackArticle[]> {
  if (!isFeatureAvailable('mediastackNews')) return [];
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/mediastack-news`);
 if (!res.ok) return [];
 return (await res.json()) as MediaStackArticle[];
  } catch {
 return [];
  }
}
