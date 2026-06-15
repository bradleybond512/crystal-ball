import { createCircuitBreaker } from '@/utils';
import { getHydratedData } from '@/services/bootstrap';
import { getApiBaseUrl } from '@/services/runtime';
import { dataFreshness } from '@/services/data-freshness';

import type {
  GetShippingRatesResponse,
  GetChokepointStatusResponse,
  GetCriticalMineralsResponse,
} from '@/generated/client/crystalball/supply_chain/v1/service_client';

export type {
  ShippingIndex,
  ChokepointInfo,
  CriticalMineral,
  MineralProducer,
  ShippingRatePoint,
  GetShippingRatesResponse,
  GetChokepointStatusResponse,
  GetCriticalMineralsResponse,
} from '@/generated/client/crystalball/supply_chain/v1/service_client';

interface SidecarSupplyChain {
  bdi: { value: number; date: string } | null;
  chokepoints: { name: string; status: string; throughput_pct: number | null; region: string }[];
  fetchedAt: string;
}

const shippingBreaker = createCircuitBreaker<GetShippingRatesResponse>({ name: 'Shipping Rates', cacheTtlMs: 15 * 60 * 1000, persistCache: true });
const chokepointBreaker = createCircuitBreaker<GetChokepointStatusResponse>({ name: 'Chokepoint Status', cacheTtlMs: 20 * 60 * 1000, persistCache: true });
const mineralsBreaker = createCircuitBreaker<GetCriticalMineralsResponse>({ name: 'Critical Minerals', cacheTtlMs: 60 * 60 * 1000, persistCache: true });

const emptyShipping: GetShippingRatesResponse = { indices: [], fetchedAt: '', upstreamUnavailable: false };
// Distinct fallback for the breaker/catch paths so a real outage is marked
// `upstreamUnavailable` (and recorded as a dataFreshness error) rather than
// looking like a healthy "no chokepoints" response.
const unavailableChokepoints: GetChokepointStatusResponse = { chokepoints: [], fetchedAt: '', upstreamUnavailable: true };
const emptyMinerals: GetCriticalMineralsResponse = { minerals: [], fetchedAt: '', upstreamUnavailable: false };

async function fetchSidecarData(): Promise<SidecarSupplyChain> {
  const resp = await fetch(`${getApiBaseUrl()}/api/supply-chain`);
  if (!resp.ok) throw new Error(`supply-chain sidecar ${resp.status}`);
  return resp.json() as Promise<SidecarSupplyChain>;
}

export async function fetchShippingRates(): Promise<GetShippingRatesResponse> {
  const hydrated = getHydratedData('shippingRates') as GetShippingRatesResponse | undefined;
  if (hydrated) return hydrated;

  try {
 return await shippingBreaker.execute(async () => {
 const data = await fetchSidecarData();
 if (!data.bdi) return { ...emptyShipping, upstreamUnavailable: true };
 return {
 indices: [{
 indexId: 'BDI',
 name: 'Baltic Dry Index',
 currentValue: data.bdi.value,
 previousValue: 0,
 changePct: 0,
 unit: 'points',
 history: [{ date: data.bdi.date, value: data.bdi.value }],
 spikeAlert: false,
 }],
 fetchedAt: data.fetchedAt,
 upstreamUnavailable: false,
 };
 }, emptyShipping);
  } catch {
 return emptyShipping;
  }
}

export async function fetchChokepointStatus(): Promise<GetChokepointStatusResponse> {
  const hydrated = getHydratedData('chokepoints') as GetChokepointStatusResponse | undefined;
  if (hydrated) {
    // Bootstrap-hydrated payloads bypass the fetch below, so record their health
    // here too — otherwise valid hydrated data leaves the supply_chain feed
    // looking down to the shortage fail-closed merge.
    if (hydrated.upstreamUnavailable) {
      dataFreshness.recordError('supply_chain', 'hydrated payload marked upstream unavailable');
    } else {
      dataFreshness.recordUpdate('supply_chain', hydrated.chokepoints.length);
    }
    return hydrated;
  }

  try {
 const result = await chokepointBreaker.execute(async () => {
 const data = await fetchSidecarData();
 return {
 chokepoints: data.chokepoints.map((c, i) => ({
 id: String(i),
 name: c.name,
 lat: 0,
 lon: 0,
 disruptionScore: c.throughput_pct == null ? 0 : Math.max(0, 100 - c.throughput_pct),
 status: c.status,
 activeWarnings: 0,
 congestionLevel: '',
 affectedRoutes: [],
 description: c.region,
 })),
 fetchedAt: data.fetchedAt,
 upstreamUnavailable: false,
 };
 }, unavailableChokepoints);
    if (result.upstreamUnavailable) {
      dataFreshness.recordError('supply_chain', 'upstream unavailable');
    } else {
      dataFreshness.recordUpdate('supply_chain', result.chokepoints.length);
    }
    return result;
  } catch {
    dataFreshness.recordError('supply_chain', 'fetch threw');
    return unavailableChokepoints;
  }
}

export async function fetchCriticalMinerals(): Promise<GetCriticalMineralsResponse> {
  const hydrated = getHydratedData('minerals') as GetCriticalMineralsResponse | undefined;
  if (hydrated) return hydrated;

  try {
 return await mineralsBreaker.execute(() => Promise.resolve(emptyMinerals), emptyMinerals);
  } catch {
 return emptyMinerals;
  }
}
