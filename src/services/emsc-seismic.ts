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
 const res = await fetch(`${getApiBaseUrl()}/api/emsc-seismic`);
 if (!res.ok) return [];
 return (await res.json()) as EmscEvent[];
  } catch {
 return [];
  }
}

export function getSuspectedNuclearTests(events: EmscEvent[]): EmscEvent[] {
  return events.filter(e => e.suspectedNuclearTest);
}
