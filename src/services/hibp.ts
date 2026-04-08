import { getApiBaseUrl } from '@/services/runtime';
import { isFeatureAvailable } from '@/services/runtime-config';

export interface HibpBreach {
  name: string | null;
  title: string | null;
  domain: string | null;
  breachDate: string | null;
  pwnCount: number | null;
  dataClasses: string[];
  isVerified: boolean;
  isSensitive: boolean;
}

export async function fetchHibpBreaches(domain?: string): Promise<HibpBreach[]> {
  if (!isFeatureAvailable('hibpBreach')) return [];
  try {
 const params = domain ? `?domain=${encodeURIComponent(domain)}` : '';
 const res = await fetch(`${getApiBaseUrl()}/api/hibp-breaches${params}`);
 if (!res.ok) return [];
 return (await res.json()) as HibpBreach[];
  } catch {
 return [];
  }
}
