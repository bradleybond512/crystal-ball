import { getApiBaseUrl } from '@/services/runtime';
import { isFeatureAvailable } from '@/services/runtime-config';

export type RipeNccData = Record<string, unknown>;

export async function fetchRipeNccAsn(asn: string): Promise<RipeNccData | null> {
  if (!isFeatureAvailable('ripeNccData')) return null;
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/ripe-ncc?asn=${encodeURIComponent(asn)}`);
 if (!res.ok) return null;
 return (await res.json()) as RipeNccData;
  } catch {
 return null;
  }
}

export async function fetchRipeNccRoutingStatus(): Promise<RipeNccData | null> {
  if (!isFeatureAvailable('ripeNccData')) return null;
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/ripe-ncc`);
 if (!res.ok) return null;
 return (await res.json()) as RipeNccData;
  } catch {
 return null;
  }
}
