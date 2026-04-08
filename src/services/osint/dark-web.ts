import { getApiBaseUrl } from '@/services/runtime';

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

export interface TorMetrics {
  totalRelays: number;
  exitNodes: number;
  byCountry: Record<string, number>;
}

export async function fetchHibpBreaches(): Promise<HibpBreach[]> {
  try {
 const r = await fetch(`${getApiBaseUrl()}/api/hibp-breaches`);
 if (!r.ok) return [];
 const data = await r.json() as unknown;
 if (!Array.isArray(data)) return [];
 return data as HibpBreach[];
  } catch { return []; }
}

export async function fetchTorMetrics(): Promise<TorMetrics | null> {
  try {
 const r = await fetch(`${getApiBaseUrl()}/api/tor-metrics`);
 if (!r.ok) return null;
 return await r.json() as TorMetrics;
  } catch { return null; }
}
