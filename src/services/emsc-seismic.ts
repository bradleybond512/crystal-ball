import { getApiBaseUrl } from '@/services/runtime';

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
  // Fail-closed (mirrors geofon-seismic): any failure throws so the loader
  // records ok=false for earthquake fusion — a dead source must never look
  // healthy-but-empty. 20s: comfortably above the sidecar's 15s upstream
  // deadline so a slow upstream fails in the sidecar (recorded properly)
  // rather than racing here.
  const res = await fetch(`${getApiBaseUrl()}/api/emsc-seismic`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`emsc-seismic ${res.status}`);
  const data = (await res.json()) as EmscEvent[] | null;
  if (!Array.isArray(data)) throw new Error('emsc-seismic malformed');
  return data;
}

export function getSuspectedNuclearTests(events: EmscEvent[]): EmscEvent[] {
  return events.filter(e => e.suspectedNuclearTest);
}
