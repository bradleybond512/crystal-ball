import { getApiBaseUrl } from '@/services/runtime';

export interface FederalDocument {
  id: string;
  title: string;
  type: string;
  agency: string;
  date: string;
  abstract: string;
  severity: 'critical' | 'high' | 'normal';
}

let _cache: FederalDocument[] | null = null;
let _cacheTs = 0;
const CACHE_TTL_MS = 30 * 60 * 1000;

export async function fetchFederalRegister(): Promise<FederalDocument[]> {
  if (_cache && Date.now() - _cacheTs < CACHE_TTL_MS) return _cache;
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/federal-register`, { signal: AbortSignal.timeout(8000) });
 if (!res.ok) return [];
 const data = await res.json() as { documents: FederalDocument[] };
 _cache = Array.isArray(data.documents) ? data.documents : [];
 _cacheTs = Date.now();
 return _cache;
  } catch {
 return [];
  }
}
