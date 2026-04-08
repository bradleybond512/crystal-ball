import { getApiBaseUrl } from '@/services/runtime';
import { isFeatureAvailable } from '@/services/runtime-config';

export interface AcapsCrisis {
  id: string;
  country: string | null;
  countryCode: string | null;
  crisisName: string | null;
  severity: string | null;
  severityScore: number | null;
  category: string | null;
  peopleAffected: number | null;
  lastUpdated: string | null;
  trend: string | null;
}

export async function fetchAcapsCrises(): Promise<AcapsCrisis[]> {
  if (!isFeatureAvailable('acapsCrisisSeverity')) return [];
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/acaps-crises`);
 if (!res.ok) return [];
 return (await res.json()) as AcapsCrisis[];
  } catch {
 return [];
  }
}
