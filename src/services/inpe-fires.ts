import { getApiBaseUrl } from '@/services/runtime';
import { dataFreshness } from '@/services/data-freshness';

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
 const res = await fetch(`${getApiBaseUrl()}/api/inpe-fires`, { signal: AbortSignal.timeout(15_000) });
 if (!res.ok) {
 dataFreshness.recordError('inpe-fires', `HTTP ${res.status}`);
 _cache = { hotspots: [], ts: Date.now() };
 return [];
 }
 const raw = await res.json() as (InpeHotspot & { acqTime: string })[];
 if (!Array.isArray(raw)) {
 dataFreshness.recordError('inpe-fires', 'malformed response');
 _cache = { hotspots: [], ts: Date.now() };
 return [];
 }
 const hotspots = raw.map(h => ({ ...h, acqTime: new Date(h.acqTime) }));
 _cache = { hotspots, ts: Date.now() };
 dataFreshness.recordUpdate('inpe-fires', hotspots.length);
 return hotspots;
  } catch (error) {
 dataFreshness.recordError('inpe-fires', String(error));
 _cache = { hotspots: [], ts: Date.now() };
 return [];
  }
}
