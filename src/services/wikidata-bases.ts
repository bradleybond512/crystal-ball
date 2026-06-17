import { getApiBaseUrl } from './runtime';
import { dataFreshness } from './data-freshness';

export interface WikidataBase {
  id: string;     // QID, e.g. "Q1492642"
  name: string;
  country: string | null;
  lat: number;
  lon: number;
}

export interface WikidataBasesSnapshot {
  bases: WikidataBase[];
  count: number;
  fetchedAt: number;
}

const CLIENT_CACHE_TTL = 6 * 60 * 60 * 1000; // 6h client cache (server caches 12h)

let _cache: { snap: WikidataBasesSnapshot; ts: number } | null = null;

export async function fetchWikidataBases(limit = 2000): Promise<WikidataBasesSnapshot> {
  const now = Date.now();
  if (_cache && now - _cache.ts < CLIENT_CACHE_TTL) return _cache.snap;
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/wikidata-military-bases?limit=${Math.max(50, Math.min(5000, limit))}`);
 if (!res.ok) throw new Error(`HTTP ${res.status}`);
 const data = await res.json() as WikidataBasesSnapshot;
 if (!data || typeof data !== 'object' || !Array.isArray(data.bases)) throw new Error('bad shape');
 _cache = { snap: data, ts: now };
 if (data.bases.length > 0) dataFreshness.recordUpdate('wikidata-bases', data.bases.length);
 return data;
  } catch (error) {
 dataFreshness.recordError('wikidata-bases', error instanceof Error ? error.message : 'fetch failed');
 return { bases: [], count: 0, fetchedAt: now };
  }
}
