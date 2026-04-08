import { getApiBaseUrl } from '@/services/runtime';
import { isFeatureAvailable } from '@/services/runtime-config';

export interface UrlScanResult {
  id: string;
  url: string | null;
  domain: string | null;
  ip: string | null;
  country: string | null;
  score: number;
  malicious: boolean;
  tags: string[];
  submittedAt: string | null;
  screenshot: string | null;
}

export async function fetchUrlScanFeed(): Promise<UrlScanResult[]> {
  if (!isFeatureAvailable('urlscanThreatIntel')) return [];
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/urlscan-feed`);
 if (!res.ok) return [];
 return (await res.json()) as UrlScanResult[];
  } catch {
 return [];
  }
}
