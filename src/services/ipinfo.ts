import { getApiBaseUrl } from '@/services/runtime';
import { isFeatureAvailable } from '@/services/runtime-config';

export interface IpInfoResult {
  ip: string;
  hostname: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  loc: string | null;
  org: string | null;
  postal: string | null;
  timezone: string | null;
  asn: unknown;
  abuse: unknown;
}

export async function lookupIpInfo(ip: string): Promise<IpInfoResult | null> {
  if (!isFeatureAvailable('ipInfoLookup')) return null;
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/ipinfo-lookup?ip=${encodeURIComponent(ip)}`);
 if (!res.ok) return null;
 return (await res.json()) as IpInfoResult;
  } catch {
 return null;
  }
}
