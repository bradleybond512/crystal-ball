import { getApiBaseUrl } from '@/services/runtime';
import { isFeatureAvailable } from '@/services/runtime-config';

export interface GreyNoiseResult {
  ip: string;
  seen: boolean;
  noise: boolean;
  riot: boolean;
  classification: 'malicious' | 'benign' | 'unknown';
  name: string | null;
  link: string | null;
  lastSeen: string | null;
  message: string | null;
}

export async function lookupGreyNoiseIP(ip: string): Promise<GreyNoiseResult | null> {
  if (!isFeatureAvailable('greynoiseIntel')) return null;
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/greynoise-lookup?ip=${encodeURIComponent(ip)}`);
 if (!res.ok) return null;
 return (await res.json()) as GreyNoiseResult;
  } catch {
 return null;
  }
}
