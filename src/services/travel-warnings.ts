import { getApiBaseUrl } from '@/services/runtime';
import { isFeatureAvailable } from '@/services/runtime-config';

export interface TravelWarning {
  country: string;
  date: string | null;
  link: string | null;
  summary: string | null;
  source: string;
  title: string;
}

export interface GovConvergenceResult {
  country: string;
  sources: string[];
  recentSources: string[];
  recentCount: number;
  isConvergenceAlert: boolean;
  latestUpdate: string | null;
  warnings: TravelWarning[];
}

export async function fetchFcdoWarnings(): Promise<TravelWarning[]> {
  if (!isFeatureAvailable('fcdoTravelWarnings')) return [];
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/fcdo-warnings`);
 if (!res.ok) return [];
 return (await res.json()) as TravelWarning[];
  } catch {
 return [];
  }
}

export async function fetchDfatWarnings(): Promise<TravelWarning[]> {
  if (!isFeatureAvailable('dfatTravelWarnings')) return [];
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/dfat-warnings`);
 if (!res.ok) return [];
 return (await res.json()) as TravelWarning[];
  } catch {
 return [];
  }
}

export async function fetchGacWarnings(): Promise<TravelWarning[]> {
  if (!isFeatureAvailable('gacTravelWarnings')) return [];
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/gac-warnings`);
 if (!res.ok) return [];
 return (await res.json()) as TravelWarning[];
  } catch {
 return [];
  }
}

export async function fetchGovWarningConvergence(): Promise<GovConvergenceResult[]> {
  if (!isFeatureAvailable('govWarningConvergence')) return [];
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/gov-convergence`);
 if (!res.ok) return [];
 return (await res.json()) as GovConvergenceResult[];
  } catch {
 return [];
  }
}

export function getConvergenceAlerts(results: GovConvergenceResult[]): GovConvergenceResult[] {
  return results.filter(r => r.isConvergenceAlert);
}
