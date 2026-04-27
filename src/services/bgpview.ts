import { getApiBaseUrl } from '@/services/runtime';
import { isFeatureAvailable } from '@/services/runtime-config';

export interface BgpAsnInfo {
  asn: number;
  name: string;
  description: string;
  countryCode: string;
  website: string;
  rir: string;
  ipv4Prefixes: number;
  ipv6Prefixes: number;
  /** Which upstream actually answered: 'peeringdb' or 'ripe'. */
  source?: 'peeringdb' | 'ripe';
}

const cache = new Map<number, { data: BgpAsnInfo; ts: number }>();
const TTL_MS = 60 * 60 * 1000; // 1 hour

export async function fetchAsnInfo(asn: number): Promise<BgpAsnInfo | null> {
  // The feature still exists for togglability, but it no longer requires a
  // secret — the sidecar uses PeeringDB → RIPE stat, both unauthenticated.
  if (!isFeatureAvailable('bgpViewEnrichment')) return null;
  const cached = cache.get(asn);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.data;
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/asn-info?asn=${asn}`);
 if (!res.ok) return null;
 const data = (await res.json()) as BgpAsnInfo;
 if (data?.asn) cache.set(asn, { data, ts: Date.now() });
 return data;
  } catch {
 return null;
  }
}
