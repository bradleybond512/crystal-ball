import { getApiBaseUrl } from '@/services/runtime';
import { isFeatureAvailable } from '@/services/runtime-config';

export interface IswReport {
  title: string;
  link: string | null;
  pubDate: string | null;
  description: string | null;
  category: string | null;
}

export async function fetchIswReports(): Promise<IswReport[]> {
  if (!isFeatureAvailable('iswSituationReports')) return [];
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/isw-reports`);
 if (!res.ok) return [];
 return (await res.json()) as IswReport[];
  } catch {
 return [];
  }
}
