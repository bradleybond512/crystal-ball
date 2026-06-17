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

export interface GeocodeResult {
  lat: number;
  lon: number;
  label: string;
}

/**
 * Geocode a city / state / country triple to lat/lon without requiring an
 * API key. Uses OpenStreetMap's Nominatim public endpoint, which is
 * CORS-friendly and permitted for infrequent use (single lookups per
 * click; 1 req/sec global cap per their policy).
 *
 * Empty fields are ignored — passing just a city or just a country works.
 * Returns null if nothing matched within the 6-second timeout.
 */
export async function geocodeCityStateCountry(
  city: string,
  state: string,
  country: string,
): Promise<GeocodeResult | null> {
  const params = new URLSearchParams({ format: 'jsonv2', limit: '1', addressdetails: '0' });
  if (city.trim()) params.set('city', city.trim());
  if (state.trim()) params.set('state', state.trim());
  if (country.trim()) params.set('country', country.trim());
  if (![...params.keys()].some(k => ['city', 'state', 'country'].includes(k))) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
 const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
 method: 'GET',
 headers: { Accept: 'application/json' },
 signal: controller.signal,
 referrerPolicy: 'no-referrer',
 });
 if (!res.ok) return null;
 const data = await res.json() as { lat?: string; lon?: string; display_name?: string }[];
 if (!Array.isArray(data)) return null;
 const hit = data[0];
 if (!hit) return null;
 const lat = Number.parseFloat(hit.lat ?? '');
 const lon = Number.parseFloat(hit.lon ?? '');
 if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
 const userLabel = [city.trim(), state.trim(), country.trim()].filter(Boolean).join(', ');
 // Fall through to the geocoder's display_name when the user left every
 // field blank (userLabel is ""). ?? would miss this because "" is
 // defined; || is the right operator here.
 /* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
 const label = userLabel
 || hit.display_name?.split(',').slice(0, 3).join(',').trim()
 || `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
 /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
 return { lat, lon, label };
  } catch {
 return null;
  } finally {
 clearTimeout(timer);
  }
}
