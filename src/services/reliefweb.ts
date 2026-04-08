import { getApiBaseUrl } from '@/services/runtime';
import { isFeatureAvailable } from '@/services/runtime-config';

export interface ReliefWebReport {
  id: string | null;
  title: string | null;
  date: string | null;
  country: string | null;
  countries: string[];
  source: string | null;
  url: string | null;
  format: string | null;
  themes: string[];
  summary: string | null;
}

export async function fetchReliefWebCrises(): Promise<ReliefWebReport[]> {
  if (!isFeatureAvailable('reliefwebCrises')) return [];
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/reliefweb-crises`);
 if (!res.ok) return [];
 return (await res.json()) as ReliefWebReport[];
  } catch {
 return [];
  }
}
