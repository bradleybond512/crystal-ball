import { getApiBaseUrl } from '@/services/runtime';
import { isFeatureAvailable } from '@/services/runtime-config';

export interface BellingcatPost {
  title: string;
  link: string | null;
  pubDate: string | null;
  description: string | null;
  creator: string | null;
}

export async function fetchBellingcatOsint(): Promise<BellingcatPost[]> {
  if (!isFeatureAvailable('bellingcatOsint')) return [];
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/bellingcat`);
 if (!res.ok) return [];
 return (await res.json()) as BellingcatPost[];
  } catch {
 return [];
  }
}
