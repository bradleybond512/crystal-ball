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
  { id: 'geofon-seismic', domain: 'disasters', displayName: 'GEOFON (GFZ Potsdam)', authType: 'none', baseUrl: 'https://geofon.gfz-potsdam.de', rateLimitNote: 'FDSN event service, fair-use', freshnessTtlMs: 10 * MIN, reliabilityWeight: 0.9, fallbackPriority: 6, independenceGroup: 'gfz' },
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
  // ── Stock prices (fused by ticker: Yahoo (no-key, primary) + Finnhub
  // (keyed, corroborating). Own 'equities' domain so stock fingerprints don't
  // collide with crypto's in the per-domain redundancy group. ──
  { id: 'yahoo-finance', domain: 'equities', displayName: 'Yahoo Finance', authType: 'none', baseUrl: 'https://query1.finance.yahoo.com', rateLimitNote: 'unofficial chart API, be gentle', freshnessTtlMs: 5 * MIN, reliabilityWeight: 0.8, fallbackPriority: 1, independenceGroup: 'yahoo' },
  { id: 'finnhub', domain: 'equities', displayName: 'Finnhub', authType: 'free_key', requiredSecret: 'FINNHUB_API_KEY', baseUrl: 'https://finnhub.io', rateLimitNote: '60 req/min free tier', freshnessTtlMs: 5 * MIN, reliabilityWeight: 0.9, fallbackPriority: 2, independenceGroup: 'finnhub' },
  // ── Intel Expansion Cluster 1: abuse.ch cyber trio ───────────────────────
  // All three share independenceGroup 'abuse-ch' — same operator, same data
  // pipeline. They MUST NOT count as 3 independent votes in corroboration.
  // Sidecar routes: /api/cyber-c2 · /api/cyber-iocs · /api/malware-urls
  { id: 'feodo-abuse-ch', domain: 'cyber_threat', displayName: 'Feodo Tracker (C2)', authType: 'none', baseUrl: 'https://feodotracker.abuse.ch', rateLimitNote: 'bulk JSON, no key', freshnessTtlMs: 10 * MIN, reliabilityWeight: 0.8, fallbackPriority: 1, independenceGroup: 'abuse-ch' },
  { id: 'threatfox-abuse-ch', domain: 'cyber_threat', displayName: 'ThreatFox IOCs', authType: 'none', baseUrl: 'https://threatfox.abuse.ch', rateLimitNote: 'CSV export, no key', freshnessTtlMs: 10 * MIN, reliabilityWeight: 0.8, fallbackPriority: 2, independenceGroup: 'abuse-ch' },
  { id: 'urlhaus-abuse-ch', domain: 'cyber_threat', displayName: 'URLhaus Malware URLs', authType: 'none', baseUrl: 'https://urlhaus.abuse.ch', rateLimitNote: 'CSV export, no key', freshnessTtlMs: 10 * MIN, reliabilityWeight: 0.8, fallbackPriority: 3, independenceGroup: 'abuse-ch' },
  // ── Intel Expansion Cluster 1: Frankfurter FX ────────────────────────────
  // ECB-sourced FX rates via Frankfurter API. New 'fx' domain.
  // Sidecar route: /api/fx-rates?base=USD&symbols=EUR,GBP,...
  { id: 'frankfurter-fx', domain: 'fx', displayName: 'Frankfurter FX (ECB)', authType: 'none', baseUrl: 'https://api.frankfurter.dev', rateLimitNote: 'no key, no published limit', freshnessTtlMs: 12 * 60 * MIN, reliabilityWeight: 0.9, fallbackPriority: 1, independenceGroup: 'ecb-fx' },
  // ── Intel Expansion Cluster 2: IMF PortWatch ─────────────────────────────
  // Daily maritime chokepoint transit counts from IMF PortWatch ArcGIS
  // FeatureServer. Keyless, ~daily cadence — 6h cache. New 'supply_chain' domain.
  // Sidecar route: /api/chokepoint-transits
  { id: 'imf-portwatch', domain: 'supply_chain', displayName: 'IMF PortWatch Chokepoints', authType: 'none', baseUrl: 'https://services9.arcgis.com', rateLimitNote: 'ArcGIS FeatureServer, no key, daily data', freshnessTtlMs: 6 * 60 * MIN, reliabilityWeight: 0.9, fallbackPriority: 1, independenceGroup: 'imf-portwatch' },
  // ── Intel Expansion Cluster 3 ─────────────────────────────────────────────
  // IODA internet outage alerts. New 'internet_health' domain. 15 min cache.
  // Sidecar route: /api/internet-outages?from=<epoch>&until=<epoch>
  { id: 'ioda', domain: 'internet_health', displayName: 'IODA Internet Outages (Georgia Tech)', authType: 'none', baseUrl: 'https://api.ioda.inetintel.cc.gatech.edu', rateLimitNote: 'no key required, fair-use', freshnessTtlMs: 15 * MIN, reliabilityWeight: 0.85, fallbackPriority: 1, independenceGroup: 'ioda' },
  // openFDA drug shortages + enforcement recalls. New 'health' domain. 6h cache.
  // Sidecar routes: /api/pharma-shortages · /api/recalls?type=drug|food
  { id: 'openfda', domain: 'health', displayName: 'openFDA (Shortages + Recalls)', authType: 'none', baseUrl: 'https://api.fda.gov', rateLimitNote: 'no key, 240 req/min per IP', freshnessTtlMs: 6 * 60 * MIN, reliabilityWeight: 0.9, fallbackPriority: 1, independenceGroup: 'openfda' },
  // ORNL ODIN real-time power outages by county. New 'grid' domain. 15 min cache.
  // Sidecar route: /api/grid-outages
  { id: 'ornl-odin', domain: 'grid', displayName: 'ORNL ODIN Power Outages', authType: 'none', baseUrl: 'https://ornl.opendatasoft.com', rateLimitNote: 'no key, Socrata ODS API', freshnessTtlMs: 15 * MIN, reliabilityWeight: 0.85, fallbackPriority: 1, independenceGroup: 'ornl-odin' },
  // Copernicus EMS emergency activations. 'disasters' domain. 30 min cache.
  // Sidecar route: /api/ems-activations
  { id: 'copernicus-ems', domain: 'disasters', displayName: 'Copernicus Emergency Management', authType: 'none', baseUrl: 'https://mapping.emergency.copernicus.eu', rateLimitNote: 'no key, DRF public API', freshnessTtlMs: 30 * MIN, reliabilityWeight: 0.9, fallbackPriority: 5, independenceGroup: 'copernicus-ems' },
  // GLEIF LEI entity lookup (legal entity identifier registry). New 'entities' domain. 24h cache.
  // Sidecar route: /api/entity-lei?name=<legal name>
  { id: 'gleif', domain: 'entities', displayName: 'GLEIF LEI Registry', authType: 'none', baseUrl: 'https://api.gleif.org', rateLimitNote: 'no key, JSON:API, fair-use', freshnessTtlMs: 24 * 60 * MIN, reliabilityWeight: 0.9, fallbackPriority: 1, independenceGroup: 'gleif' },

  // ── Intel Expansion Cluster 4 ─────────────────────────────────────────────
  // GDELT GKG geocoded events. New 'osint' domain. 15 min cache.
  // Sidecar route: /api/gdelt-geo?query=&timespan=
  { id: 'gdelt-gkg', domain: 'osint', displayName: 'GDELT GKG Geocoded Events', authType: 'none', baseUrl: 'https://api.gdeltproject.org', rateLimitNote: 'no key, fair-use, gkg_geojson v1', freshnessTtlMs: 15 * MIN, reliabilityWeight: 0.75, fallbackPriority: 1, independenceGroup: 'gdelt' },
  // SWPC OVATION aurora forecast. New 'space_weather' domain. 15 min cache.
  // Sidecar route: /api/spaceweather-extra (combined with solar-regions below)
  { id: 'swpc-ovation', domain: 'space_weather', displayName: 'SWPC OVATION Aurora Forecast', authType: 'none', baseUrl: 'https://services.swpc.noaa.gov', rateLimitNote: 'no key, NOAA SWPC JSON feed', freshnessTtlMs: 15 * MIN, reliabilityWeight: 0.9, fallbackPriority: 1, independenceGroup: 'noaa-swpc' },
  // SWPC solar active regions + flare probabilities. Same 'space_weather' domain. 15 min cache.
  { id: 'swpc-solar-regions', domain: 'space_weather', displayName: 'SWPC Solar Active Regions', authType: 'none', baseUrl: 'https://services.swpc.noaa.gov', rateLimitNote: 'no key, NOAA SWPC JSON feed', freshnessTtlMs: 15 * MIN, reliabilityWeight: 0.9, fallbackPriority: 2, independenceGroup: 'noaa-swpc' },
  // AviationWeather SIGMET/G-AIRMET airspace hazard notices. 'aviation' domain. 10 min cache.
  // Shares independenceGroup with existing aviationweather-gov — same upstream.
  // Sidecar route: /api/aviation-hazards
  { id: 'aviationweather-hazards', domain: 'aviation', displayName: 'AviationWeather SIGMET/G-AIRMET', authType: 'none', baseUrl: 'https://aviationweather.gov', rateLimitNote: 'no key, NWS/FAA JSON API', freshnessTtlMs: 10 * MIN, reliabilityWeight: 0.9, fallbackPriority: 2, independenceGroup: 'noaa' },
  // FAA NAS Status — airport ground stops, delays, closures. 'aviation' domain. 5 min cache.
  // Sidecar route: /api/faa-nas-status
  { id: 'faa-nas', domain: 'aviation', displayName: 'FAA NAS Status (Airport Events)', authType: 'none', baseUrl: 'https://nasstatus.faa.gov', rateLimitNote: 'no key, FAA public API', freshnessTtlMs: 5 * MIN, reliabilityWeight: 0.95, fallbackPriority: 3, independenceGroup: 'faa' },
  // BfS ODL German gamma-dose monitoring network. New 'nuclear' domain. 60 min cache.
  // Sidecar route: /api/radiation-grid
  { id: 'bfs-odl', domain: 'nuclear', displayName: 'BfS ODL Radiation Grid (Germany)', authType: 'none', baseUrl: 'https://www.imis.bfs.de', rateLimitNote: 'no key, WFS GeoJSON, ~1679 stations', freshnessTtlMs: 60 * MIN, reliabilityWeight: 0.95, fallbackPriority: 1, independenceGroup: 'bfs-odl' },
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
