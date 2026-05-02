import { getApiBaseUrl } from '@/services/runtime';
import { dataFreshness } from '@/services/data-freshness';

export interface WsbSnapshot {
  ticker: string;
  mentions: number;
  sentiment: number;
  rank: number;
}

let _cache: WsbSnapshot[] | null = null;
let _cacheTs = 0;
const CACHE_TTL_MS = 60 * 60 * 1000;

export async function fetchWsbSentiment(): Promise<WsbSnapshot[]> {
  if (_cache && Date.now() - _cacheTs < CACHE_TTL_MS) return _cache;
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/wsb-sentiment`, { signal: AbortSignal.timeout(8000) });
 if (!res.ok) {
 dataFreshness.recordError('wsb-sentiment', `HTTP ${res.status}`);
 return [];
 }
 const data = await res.json() as { snapshots: WsbSnapshot[] };
 _cache = Array.isArray(data.snapshots) ? data.snapshots : [];
 _cacheTs = Date.now();
 dataFreshness.recordUpdate('wsb-sentiment', _cache.length);
 return _cache;
  } catch (error) {
 dataFreshness.recordError('wsb-sentiment', String(error));
 return [];
  }
}
