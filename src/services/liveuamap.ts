import { getApiBaseUrl } from '@/services/runtime';
import { isFeatureAvailable } from '@/services/runtime-config';

export interface LiveUaEvent {
  title: string | null;
  link: string | null;
  pubDate: string | null;
  description: string | null;
  lat: number | null;
  lon: number | null;
  source: string;
}

export async function fetchLiveUaMap(): Promise<LiveUaEvent[]> {
  if (!isFeatureAvailable('liveUaMapFeed')) return [];
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/liveuamap`);
 if (!res.ok) return [];
 return (await res.json()) as LiveUaEvent[];
  } catch {
 return [];
  }
}
