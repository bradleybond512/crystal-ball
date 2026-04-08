import { getApiBaseUrl } from '@/services/runtime';
import { isFeatureAvailable } from '@/services/runtime-config';

export interface GeoNamesPlace {
  id: number | null;
  name: string | null;
  toponym: string | null;
  country: string | null;
  countryCode: string | null;
  lat: number | null;
  lon: number | null;
  population: number | null;
  featureClass: string | null;
  featureCode: string | null;
  adminName1: string | null;
}

export async function searchGeoNames(query: string): Promise<GeoNamesPlace[]> {
  if (!isFeatureAvailable('geoNames')) return [];
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/geonames-search?q=${encodeURIComponent(query)}`);
 if (!res.ok) return [];
 return (await res.json()) as GeoNamesPlace[];
  } catch {
 return [];
  }
}
