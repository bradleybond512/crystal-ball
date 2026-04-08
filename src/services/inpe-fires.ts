import { getApiBaseUrl } from '@/services/runtime';

export interface InpeHotspot {
  id: string;
  lat: number;
  lon: number;
  frp: number;
  riskScore: number;
  biome: string | null;
  state: string | null;
  municipality: string | null;
  acqTime: Date;
  confidence: 'high' | 'nominal' | 'low';
  source: 'INPE';
  brightness: number;
}

let _cache: { hotspots: InpeHotspot[]; ts: number } | null = null;
const CACHE_TTL_MS = 20 * 60 * 1000;

export async function fetchInpeFires(): Promise<InpeHotspot[]> {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) return _cache.hotspots;
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/inpe-fires`, { signal: AbortSignal.timeout(15000) });
 if (!res.ok) {
 _cache = { hotspots: [], ts: Date.now() };
 return [];
 }
 const raw = await res.json() as Array<InpeHotspot & { acqTime: string }>;
 const hotspots = raw.map(h => ({ ...h, acqTime: new Date(h.acqTime) }));
 _cache = { hotspots, ts: Date.now() };
 return hotspots;
  } catch {
 _cache = { hotspots: [], ts: Date.now() };
 return [];
  }
}
