import {
  SeismologyServiceClient,
  type Earthquake,
  type ListEarthquakesResponse,
} from '@/generated/client/crystalball/seismology/v1/service_client';
import { createCircuitBreaker } from '@/utils';
import { getHydratedData } from '@/services/bootstrap';
import type { BreakerDataState } from '@/utils/circuit-breaker';

// Re-export the proto Earthquake type as the domain's public type


const client = new SeismologyServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });
const breaker = createCircuitBreaker<ListEarthquakesResponse>({ name: 'Seismology', cacheTtlMs: 30 * 60 * 1000, persistCache: true });

const emptyFallback: ListEarthquakesResponse = { earthquakes: [] };

export interface EarthquakeFetchResult {
  earthquakes: Earthquake[];
  dataState: BreakerDataState;
}

export function parseEarthquakeResponse(data: unknown): ListEarthquakesResponse {
  if (!data || typeof data !== 'object' || !Array.isArray((data as { earthquakes?: unknown }).earthquakes)) {
    throw new Error('USGS response is missing an earthquakes array');
  }
  return data as ListEarthquakesResponse;
}

export async function fetchEarthquakesTracked(): Promise<EarthquakeFetchResult> {
  const hydrated = getHydratedData('earthquakes') as ListEarthquakesResponse | undefined;
  if (hydrated) {
    const response = parseEarthquakeResponse(hydrated);
    return {
      earthquakes: response.earthquakes,
      dataState: { mode: 'cached', timestamp: null, offline: false },
    };
  }

  const { data: response, dataState } = await breaker.executeTracked(async () => {
 const data = await client.listEarthquakes({ minMagnitude: 0, start: 0, end: 0, pageSize: 0, cursor: '' });
 return parseEarthquakeResponse(data);
  }, emptyFallback);
  return { earthquakes: response.earthquakes, dataState };
}

export async function fetchEarthquakes(): Promise<Earthquake[]> {
  const result = await fetchEarthquakesTracked();
  return result.earthquakes;
}

export {type Earthquake} from '@/generated/client/crystalball/seismology/v1/service_client';
