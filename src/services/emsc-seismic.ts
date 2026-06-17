import { getApiBaseUrl } from '@/services/runtime';
import { isFeatureAvailable } from '@/services/runtime-config';

export interface EmscEvent {
  id: string | null;
  magnitude: number | null;
  magnitudeType: string | null;
  depth: number | null;
  lat: number;
  lon: number;
  region: string | null;
  time: string | null;
  source: string | null;
  suspectedNuclearTest: boolean;
  nearTestSite: { label: string; country: string } | null;
}

export async function fetchEmscSeismic(): Promise<EmscEvent[]> {
  if (!isFeatureAvailable('emscSeismic')) return [];
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/emsc-seismic`, { signal: AbortSignal.timeout(10000) });
 if (!res.ok) {
 console.warn(`[emsc-seismic] feed returned HTTP ${res.status}`);
 return [];
 }
 return (await res.json()) as EmscEvent[];
  } catch (error) {
 console.warn('[emsc-seismic] feed fetch failed (timeout or network):', error);
 return [];
  }
}

export function getSuspectedNuclearTests(events: EmscEvent[]): EmscEvent[] {
  return events.filter(e => e.suspectedNuclearTest);
}
