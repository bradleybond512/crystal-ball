/**
 * Trade policy intelligence service -- Global Trade Alert data source.
 * Trade restrictions via sidecar /api/trade-policy; tariffs/flows/barriers return empty stubs.
 */

import { createCircuitBreaker } from '@/utils';
import { isFeatureAvailable } from '../runtime-config';
import { getApiBaseUrl } from '../runtime';

export type {
  TradeRestriction,
  TariffDataPoint,
  TradeFlowRecord,
  TradeBarrier,
  GetTradeRestrictionsResponse,
  GetTariffTrendsResponse,
  GetTradeFlowsResponse,
  GetTradeBarriersResponse,
} from '@/generated/client/crystalball/trade/v1/service_client';

import type {
  GetTradeRestrictionsResponse,
  GetTariffTrendsResponse,
  GetTradeFlowsResponse,
  GetTradeBarriersResponse,
} from '@/generated/client/crystalball/trade/v1/service_client';

const restrictionsBreaker = createCircuitBreaker<GetTradeRestrictionsResponse>({ name: 'WTO Restrictions', cacheTtlMs: 30 * 60 * 1000, persistCache: true });

const emptyRestrictions: GetTradeRestrictionsResponse = { restrictions: [], fetchedAt: '', upstreamUnavailable: false };
const emptyTariffs: GetTariffTrendsResponse = { datapoints: [], fetchedAt: '', upstreamUnavailable: false };
const emptyFlows: GetTradeFlowsResponse = { flows: [], fetchedAt: '', upstreamUnavailable: false };
const emptyBarriers: GetTradeBarriersResponse = { barriers: [], fetchedAt: '', upstreamUnavailable: false };

export async function fetchTradeRestrictions(countries: string[] = [], limit = 50): Promise<GetTradeRestrictionsResponse> {
  if (!isFeatureAvailable('wtoTrade')) return emptyRestrictions;
  try {
 return await restrictionsBreaker.execute(async () => {
 const resp = await fetch(`${getApiBaseUrl()}/api/trade-policy`);
 if (!resp.ok) return { ...emptyRestrictions, upstreamUnavailable: true };
 const raw = await resp.json() as unknown;
 if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { interventions?: unknown }).interventions)) return { ...emptyRestrictions, upstreamUnavailable: true };
 const data = raw as { interventions: Array<{ id: string; title: string; country: string; type: string; announced: string; status: string; affected_countries: string[] }>; fetchedAt: string };
 const filtered = countries.length > 0
 ? data.interventions.filter(i => countries.includes(i.country) || i.affected_countries.some(c => countries.includes(c)))
 : data.interventions;
 return {
 restrictions: filtered.slice(0, limit).map(i => ({
 id: i.id,
 reportingCountry: i.country,
 affectedCountry: i.affected_countries[0] ?? '',
 productSector: '',
 measureType: i.type,
 description: i.title,
 status: i.status,
 notifiedAt: i.announced,
 sourceUrl: '',
 })),
 fetchedAt: data.fetchedAt,
 upstreamUnavailable: false,
 };
 }, emptyRestrictions);
  } catch {
 return emptyRestrictions;
  }
}

export async function fetchTariffTrends(_reportingCountry: string, _partnerCountry: string, _productSector = '', _years = 10): Promise<GetTariffTrendsResponse> {
  return emptyTariffs;
}

export async function fetchTradeFlows(_reportingCountry: string, _partnerCountry: string, _years = 10): Promise<GetTradeFlowsResponse> {
  return emptyFlows;
}

export async function fetchTradeBarriers(_countries: string[] = [], _measureType = '', _limit = 50): Promise<GetTradeBarriersResponse> {
  return emptyBarriers;
}
