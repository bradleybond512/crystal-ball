import { getApiBaseUrl } from '@/services/runtime';
import { isFeatureAvailable } from '@/services/runtime-config';

export interface CveEntry {
  id: string | null;
  description: string;
  published: string | null;
  lastModified: string | null;
  severity: string | null;
  cvssScore: number | null;
  attackVector: string | null;
  references: string[];
}

export interface VulnersResult {
  id: string | null;
  title: string | null;
  description: string | null;
  cvss: number | null;
  published: string | null;
  type: string | null;
  href: string | null;
}

export async function fetchRecentCves(): Promise<CveEntry[]> {
  if (!isFeatureAvailable('cveTracker')) return [];
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/nvd-cve`);
 if (!res.ok) return [];
 return (await res.json()) as CveEntry[];
  } catch {
 return [];
  }
}

export async function searchVulners(query?: string): Promise<VulnersResult[]> {
  if (!isFeatureAvailable('vulnersCve')) return [];
  try {
 const params = query ? `?q=${encodeURIComponent(query)}` : '';
 const res = await fetch(`${getApiBaseUrl()}/api/vulners-search${params}`);
 if (!res.ok) return [];
 return (await res.json()) as VulnersResult[];
  } catch {
 return [];
  }
}
