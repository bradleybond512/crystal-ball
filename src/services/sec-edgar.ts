import { getApiBaseUrl } from '@/services/runtime';
import { isFeatureAvailable } from '@/services/runtime-config';

export interface EdgarFiling {
  id: string;
  company: string;
  cik: string | null;
  formType: string;
  filedAt: string | null;
  description: string;
  accessionNo: string | null;
}

export interface EdgarSearchResult {
  query: string;
  total: number;
  results: {
 id: string;
 company: string;
 cik: string | null;
 formType: string;
 filedAt: string | null;
 accessionNo: string | null;
  }[];
}

export async function fetchRecentEdgarFilings(): Promise<EdgarFiling[]> {
  if (!isFeatureAvailable('secEdgar')) return [];
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/edgar-filings`);
 if (!res.ok) return [];
 return (await res.json()) as EdgarFiling[];
  } catch {
 return [];
  }
}

export async function searchEdgar(query: string): Promise<EdgarSearchResult | null> {
  if (!isFeatureAvailable('secEdgar')) return null;
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/edgar-search?q=${encodeURIComponent(query)}`);
 if (!res.ok) return null;
 return (await res.json()) as EdgarSearchResult;
  } catch {
 return null;
  }
}
