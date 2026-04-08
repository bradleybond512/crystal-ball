import { getApiBaseUrl } from '@/services/runtime';
import { isFeatureAvailable } from '@/services/runtime-config';

export interface BitcoinAbuseReport {
  id: string;
  address: string | null;
  abuseType: string | null;
  abuseTypeOther: string | null;
  description: string | null;
  reportedAt: string | null;
}

export async function fetchBitcoinAbuseReports(): Promise<BitcoinAbuseReport[]> {
  if (!isFeatureAvailable('bitcoinabuseIocs')) return [];
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/bitcoinabuse-feed`);
 if (!res.ok) return [];
 return (await res.json()) as BitcoinAbuseReport[];
  } catch {
 return [];
  }
}
