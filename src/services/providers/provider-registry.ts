/**
 * Static provider catalog. Definitions are cheap — fetcher wiring for the
 * P0 expansion batch lands in later PRs, one domain at a time.
 */

import type { ProviderDefinition, ProviderDomain } from './provider-types.ts';

const HOUR = 3_600_000;
const MIN = 60_000;

export const PROVIDER_DEFINITIONS: readonly ProviderDefinition[] = [
  // ── Currently live ────────────────────────────────────────────────
  { id: 'nws-alerts', domain: 'weather', displayName: 'NWS Alerts', authType: 'none', baseUrl: 'https://api.weather.gov', rateLimitNote: 'unauthenticated, be gentle', freshnessTtlMs: 10 * MIN, reliabilityWeight: 0.95, fallbackPriority: 1, independenceGroup: 'noaa' },
  { id: 'gdacs', domain: 'disasters', displayName: 'GDACS', authType: 'none', baseUrl: 'https://www.gdacs.org', rateLimitNote: 'no published limit', freshnessTtlMs: 30 * MIN, reliabilityWeight: 0.85, fallbackPriority: 1, independenceGroup: 'gdacs' },
  { id: 'usgs-earthquakes', domain: 'disasters', displayName: 'USGS Earthquakes', authType: 'none', baseUrl: 'https://earthquake.usgs.gov', rateLimitNote: 'no published limit', freshnessTtlMs: 10 * MIN, reliabilityWeight: 0.95, fallbackPriority: 2, independenceGroup: 'usgs' },
  { id: 'emsc-seismic', domain: 'disasters', displayName: 'EMSC Seismic', authType: 'none', baseUrl: 'https://www.seismicportal.eu', rateLimitNote: 'fair-use, no key', freshnessTtlMs: 10 * MIN, reliabilityWeight: 0.9, fallbackPriority: 5, independenceGroup: 'emsc' },
  { id: 'opensky', domain: 'adsb', displayName: 'OpenSky Network', authType: 'none', baseUrl: 'https://opensky-network.org', rateLimitNote: 'anonymous: 100 req/day burst limits', freshnessTtlMs: 2 * MIN, reliabilityWeight: 0.7, fallbackPriority: 1, independenceGroup: 'opensky' },
  { id: 'wingbits', domain: 'adsb', displayName: 'Wingbits', authType: 'free_key', requiredSecret: 'WINGBITS_API_KEY', baseUrl: 'https://customer-api.wingbits.com', rateLimitNote: 'keyed, per-plan limits', freshnessTtlMs: 2 * MIN, reliabilityWeight: 0.85, fallbackPriority: 2, independenceGroup: 'wingbits' },
  { id: 'eia', domain: 'commodities', displayName: 'EIA', authType: 'free_key', requiredSecret: 'EIA_API_KEY', baseUrl: 'https://api.eia.gov', rateLimitNote: '5000 req/hour', freshnessTtlMs: 6 * HOUR, reliabilityWeight: 0.95, fallbackPriority: 1, independenceGroup: 'us-gov-energy' },
  { id: 'fred', domain: 'markets', displayName: 'FRED', authType: 'free_key', requiredSecret: 'FRED_API_KEY', baseUrl: 'https://api.stlouisfed.org', rateLimitNote: '120 req/min', freshnessTtlMs: 12 * HOUR, reliabilityWeight: 0.95, fallbackPriority: 1, independenceGroup: 'us-fed' },
  { id: 'fews-net', domain: 'food_security', displayName: 'FEWS NET', authType: 'none', baseUrl: 'https://fews.net', rateLimitNote: 'no published limit', freshnessTtlMs: 24 * HOUR, reliabilityWeight: 0.85, fallbackPriority: 1, independenceGroup: 'fews' },
  // ── P0 expansion batch (definitions only; fetchers in later PRs) ──
  { id: 'airplanes-live', domain: 'adsb', displayName: 'Airplanes.live', authType: 'none', baseUrl: 'https://api.airplanes.live', rateLimitNote: '1 req/sec community API', freshnessTtlMs: 2 * MIN, reliabilityWeight: 0.7, fallbackPriority: 3, independenceGroup: 'community-adsb' },
  { id: 'adsb-lol', domain: 'adsb', displayName: 'ADSB.lol', authType: 'none', baseUrl: 'https://api.adsb.lol', rateLimitNote: 'community API, be gentle', freshnessTtlMs: 2 * MIN, reliabilityWeight: 0.65, fallbackPriority: 4, independenceGroup: 'community-adsb' },
  { id: 'adsb-fi', domain: 'adsb', displayName: 'ADSB.fi', authType: 'none', baseUrl: 'https://opendata.adsb.fi', rateLimitNote: 'community API, be gentle', freshnessTtlMs: 2 * MIN, reliabilityWeight: 0.65, fallbackPriority: 5, independenceGroup: 'community-adsb' },

  { id: 'aviationweather-gov', domain: 'aviation', displayName: 'AviationWeather.gov', authType: 'none', baseUrl: 'https://aviationweather.gov/api', rateLimitNote: 'no key, NOAA', freshnessTtlMs: 15 * MIN, reliabilityWeight: 0.95, fallbackPriority: 1, independenceGroup: 'noaa' },
  { id: 'open-meteo-forecast', domain: 'weather', displayName: 'Open-Meteo Forecast', authType: 'none', baseUrl: 'https://api.open-meteo.com', rateLimitNote: '10k req/day non-commercial', freshnessTtlMs: 30 * MIN, reliabilityWeight: 0.85, fallbackPriority: 2, independenceGroup: 'open-meteo' },
  { id: 'open-meteo-flood', domain: 'disasters', displayName: 'Open-Meteo Flood', authType: 'none', baseUrl: 'https://flood-api.open-meteo.com', rateLimitNote: '10k req/day non-commercial', freshnessTtlMs: 3 * HOUR, reliabilityWeight: 0.8, fallbackPriority: 3, independenceGroup: 'open-meteo' },
  { id: 'open-meteo-marine', domain: 'maritime', displayName: 'Open-Meteo Marine', authType: 'none', baseUrl: 'https://marine-api.open-meteo.com', rateLimitNote: '10k req/day non-commercial', freshnessTtlMs: HOUR, reliabilityWeight: 0.8, fallbackPriority: 1, independenceGroup: 'open-meteo' },
  { id: 'nasa-eonet', domain: 'disasters', displayName: 'NASA EONET', authType: 'none', baseUrl: 'https://eonet.gsfc.nasa.gov', rateLimitNote: 'no published limit', freshnessTtlMs: HOUR, reliabilityWeight: 0.85, fallbackPriority: 4, independenceGroup: 'nasa' },
  { id: 'nvd', domain: 'cyber', displayName: 'NVD CVE API', authType: 'none', baseUrl: 'https://services.nvd.nist.gov', rateLimitNote: '5 req/30s without key', freshnessTtlMs: 6 * HOUR, reliabilityWeight: 0.9, fallbackPriority: 1, independenceGroup: 'nist' },
  { id: 'first-epss', domain: 'cyber', displayName: 'FIRST EPSS', authType: 'none', baseUrl: 'https://api.first.org', rateLimitNote: 'no published limit', freshnessTtlMs: 24 * HOUR, reliabilityWeight: 0.9, fallbackPriority: 2, independenceGroup: 'first' },
  { id: 'cisa-kev', domain: 'cyber', displayName: 'CISA KEV', authType: 'none', baseUrl: 'https://www.cisa.gov', rateLimitNote: 'static JSON catalog', freshnessTtlMs: 24 * HOUR, reliabilityWeight: 0.95, fallbackPriority: 3, independenceGroup: 'cisa' },
  { id: 'sec-edgar', domain: 'markets', displayName: 'SEC EDGAR', authType: 'none', baseUrl: 'https://data.sec.gov', rateLimitNote: '10 req/sec with UA header', freshnessTtlMs: 6 * HOUR, reliabilityWeight: 0.95, fallbackPriority: 2, independenceGroup: 'sec' },
  { id: 'treasury-fiscal', domain: 'markets', displayName: 'Treasury Fiscal Data', authType: 'none', baseUrl: 'https://api.fiscaldata.treasury.gov', rateLimitNote: 'no published limit', freshnessTtlMs: 24 * HOUR, reliabilityWeight: 0.95, fallbackPriority: 3, independenceGroup: 'us-treasury' },
  { id: 'celestrak', domain: 'space', displayName: 'CelesTrak', authType: 'none', baseUrl: 'https://celestrak.org', rateLimitNote: 'cache aggressively', freshnessTtlMs: 12 * HOUR, reliabilityWeight: 0.9, fallbackPriority: 1, independenceGroup: 'celestrak' },
  { id: 'wikidata', domain: 'infrastructure', displayName: 'Wikidata SPARQL', authType: 'none', baseUrl: 'https://query.wikidata.org', rateLimitNote: '60s query timeout, be gentle', freshnessTtlMs: 7 * 24 * HOUR, reliabilityWeight: 0.8, fallbackPriority: 1, independenceGroup: 'wikimedia' },
  { id: 'overpass', domain: 'infrastructure', displayName: 'Overpass API', authType: 'none', baseUrl: 'https://overpass-api.de', rateLimitNote: 'fair-use policy, cache results', freshnessTtlMs: 7 * 24 * HOUR, reliabilityWeight: 0.75, fallbackPriority: 2, independenceGroup: 'osm' },
  // ── Air quality (fused: Open-Meteo AQ + OpenAQ v3, both no-key) ──
  { id: 'open-meteo-aqi', domain: 'air_quality', displayName: 'Open-Meteo Air Quality', authType: 'none', baseUrl: 'https://air-quality-api.open-meteo.com', rateLimitNote: '10k req/day non-commercial', freshnessTtlMs: HOUR, reliabilityWeight: 0.85, fallbackPriority: 1, independenceGroup: 'open-meteo' },
  { id: 'openaq-v3', domain: 'air_quality', displayName: 'OpenAQ v3', authType: 'none', baseUrl: 'https://api.openaq.org', rateLimitNote: 'anonymous reads ok; key raises limits', freshnessTtlMs: 2 * HOUR, reliabilityWeight: 0.85, fallbackPriority: 2, independenceGroup: 'openaq' },
  // ── Crypto prices (fused by symbol: CoinGecko + Coinbase, both no-key) ──
  { id: 'coingecko', domain: 'markets', displayName: 'CoinGecko', authType: 'none', baseUrl: 'https://api.coingecko.com', rateLimitNote: 'free tier, be gentle', freshnessTtlMs: 5 * MIN, reliabilityWeight: 0.85, fallbackPriority: 4, independenceGroup: 'coingecko' },
  { id: 'coinbase', domain: 'markets', displayName: 'Coinbase', authType: 'none', baseUrl: 'https://api.coinbase.com', rateLimitNote: 'public spot prices, no key', freshnessTtlMs: 5 * MIN, reliabilityWeight: 0.85, fallbackPriority: 5, independenceGroup: 'coinbase' },
  // ── Stock prices (fused by ticker: Stooq + Yahoo, both no-key). Own
  // 'equities' domain so stock fingerprints don't collide with crypto's in
  // the per-domain redundancy group. ──
  { id: 'stooq', domain: 'equities', displayName: 'Stooq', authType: 'none', baseUrl: 'https://stooq.com', rateLimitNote: 'free CSV, be gentle', freshnessTtlMs: 5 * MIN, reliabilityWeight: 0.8, fallbackPriority: 1, independenceGroup: 'stooq' },
  { id: 'yahoo-finance', domain: 'equities', displayName: 'Yahoo Finance', authType: 'none', baseUrl: 'https://query1.finance.yahoo.com', rateLimitNote: 'unofficial chart API, be gentle', freshnessTtlMs: 5 * MIN, reliabilityWeight: 0.8, fallbackPriority: 2, independenceGroup: 'yahoo' },
];

const BY_ID = new Map(PROVIDER_DEFINITIONS.map((d) => [d.id, d]));

export function getProviderDefinition(id: string): ProviderDefinition | undefined {
  return BY_ID.get(id);
}

export function providersForDomain(domain: ProviderDomain): readonly ProviderDefinition[] {
  return PROVIDER_DEFINITIONS
    .filter((d) => d.domain === domain)
    .sort((a, b) => a.fallbackPriority - b.fallbackPriority);
}

/** Distinct independence groups among the given provider ids.
 *  Unknown ids are ignored. */
export function independentGroupsFor(providerIds: readonly string[]): Set<string> {
  const groups = new Set<string>();
  for (const id of providerIds) {
    const def = BY_ID.get(id);
    if (def) groups.add(def.independenceGroup);
  }
  return groups;
}
