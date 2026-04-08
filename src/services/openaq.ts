import { getApiBaseUrl } from '@/services/runtime';
import { isFeatureAvailable } from '@/services/runtime-config';

export interface OpenAqMeasurement {
  parameter: string | null;
  value: number | null;
  unit: string | null;
  lastUpdated: string | null;
}

export interface OpenAqReading {
  id: string | null;
  locationId: number | null;
  city: string | null;
  country: string | null;
  coordinates: { latitude: number; longitude: number } | null;
  measurements: OpenAqMeasurement[];
}

export async function fetchOpenAqReadings(): Promise<OpenAqReading[]> {
  if (!isFeatureAvailable('openAqMonitor')) return [];
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/openaq-readings`);
 if (!res.ok) return [];
 return (await res.json()) as OpenAqReading[];
  } catch {
 return [];
  }
}
