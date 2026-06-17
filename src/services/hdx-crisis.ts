import { getApiBaseUrl } from '@/services/runtime';
import { dataFreshness } from '@/services/data-freshness';

export type CrisisType = 'conflict' | 'displacement' | 'food-insecurity' | 'disease' | 'disaster' | 'other';

export interface HumanitarianCrisis {
  id: string;
  title: string;
  country: string;
  countryCode: string;
  crisisType: CrisisType;
  affectedPeople: number | null;
  organization: string;
  updatedAt: Date;
  url: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  numResources: number;
}

let _cache: { crises: HumanitarianCrisis[]; ts: number } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000;

export async function fetchHdxCrises(): Promise<HumanitarianCrisis[]> {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) return _cache.crises;
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/hdx-crises`, { signal: AbortSignal.timeout(15_000) });
 if (!res.ok) {
 dataFreshness.recordError('hdx-crisis', `HTTP ${res.status}`);
 _cache = { crises: [], ts: Date.now() };
 return [];
 }
 const raw = await res.json() as (HumanitarianCrisis & { updatedAt: string })[];
 if (!Array.isArray(raw)) {
 dataFreshness.recordError('hdx-crisis', 'malformed response');
 _cache = { crises: [], ts: Date.now() };
 return [];
 }
 const crises = raw.map(r => ({ ...r, updatedAt: new Date(r.updatedAt) }));
 _cache = { crises, ts: Date.now() };
 dataFreshness.recordUpdate('hdx-crisis', crises.length);
 return crises;
  } catch (error) {
 dataFreshness.recordError('hdx-crisis', String(error));
 _cache = { crises: [], ts: Date.now() };
 return [];
  }
}

export function crisisTypeLabel(type: CrisisType): string {
  return {
 conflict: 'Conflict',
 displacement: 'Displacement',
 'food-insecurity': 'Food Crisis',
 disease: 'Disease',
 disaster: 'Disaster',
 other: 'Crisis',
  }[type] ?? 'Crisis';
}

export function crisisSeverityClass(severity: HumanitarianCrisis['severity']): string {
  return {
 critical: 'eq-row eq-major',
 high: 'eq-row eq-strong',
 medium: 'eq-row eq-moderate',
 low: 'eq-row',
  }[severity] ?? 'eq-row';
}
