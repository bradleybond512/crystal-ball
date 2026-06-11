import { getApiBaseUrl } from '@/services/runtime';
import { isFeatureAvailable } from '@/services/runtime-config';
import type { SanctionsDataset } from '@/components/open-sanctions-helpers';

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

interface RecentSanctionsItem {
  id?: string;
  name?: string;
  countries?: string[];
  lastSeen?: string | null;
  entityCount?: number | null;
}

/**
 * Consolidated-watchlist coverage from the free OpenSanctions /catalog feed
 * (surfaced by the sidecar as recently-exported sanctions datasets). Each
 * dataset carries its own entity count + last-export timestamp, which the
 * panel aggregates into coverage stats via aggregateStats().
 */
export async function fetchSanctionsCoverage(): Promise<SanctionsDataset[]> {
  if (!isFeatureAvailable('openSanctions')) return [];
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/opensanctions-recent`);
    if (!res.ok) return [];
    const items = (await res.json()) as RecentSanctionsItem[];
    if (!Array.isArray(items)) return [];
    return items.map((it) => ({
      name: it.id ?? '',
      title: it.name ?? it.id ?? 'Unknown sanctions list',
      entityCount: typeof it.entityCount === 'number' ? it.entityCount : 0,
      lastUpdated: it.lastSeen ?? '',
      countries: Array.isArray(it.countries) ? it.countries : [],
    }));
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
