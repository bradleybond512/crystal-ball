import { getApiBaseUrl } from '@/services/runtime';
import { isFeatureAvailable } from '@/services/runtime-config';

export interface PulsediveIndicator {
  id: string | null;
  indicator: string | null;
  type: string | null;
  risk: string | null;
  stamp_added: string | null;
  stamp_updated: string | null;
  tags: string[];
  feeds: string[];
}

export async function fetchPulsediveFeed(): Promise<PulsediveIndicator[]> {
  if (!isFeatureAvailable('pulsediveThreatIntel')) return [];
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/pulsedive-feed`);
 if (!res.ok) return [];
 return (await res.json()) as PulsediveIndicator[];
  } catch {
 return [];
  }
}
