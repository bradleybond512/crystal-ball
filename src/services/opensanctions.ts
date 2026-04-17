import { getApiBaseUrl } from '@/services/runtime';
import { isFeatureAvailable } from '@/services/runtime-config';

export interface SanctionedEntity {
  id: string;
  name: string;
  schema: string;
  countries: string[];
  datasets: string[];
  topics: string[];
  firstSeen: string | null;
  lastSeen: string | null;
  sanctionPrograms: string | null;
}

export interface OpenSanctionsSearchResult {
  query: string;
  total: number;
  results: {
 id: string;
 name: string;
 schema: string;
 countries: string[];
 datasets: string[];
 topics: string[];
 score: number | null;
  }[];
}

export async function fetchRecentSanctions(): Promise<SanctionedEntity[]> {
  if (!isFeatureAvailable('openSanctions')) return [];
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/opensanctions-recent`);
 if (!res.ok) return [];
 return (await res.json()) as SanctionedEntity[];
  } catch {
 return [];
  }
}

export async function searchOpenSanctions(query: string): Promise<OpenSanctionsSearchResult | null> {
  if (!isFeatureAvailable('openSanctions')) return null;
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/opensanctions-search?q=${encodeURIComponent(query)}`);
 if (!res.ok) return null;
 return (await res.json()) as OpenSanctionsSearchResult;
  } catch {
 return null;
  }
}
