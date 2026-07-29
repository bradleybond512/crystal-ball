/**
 * Maps a fusable fact-type (finer than ProviderDomain) to the providers
 * that feed it, the numeric tolerance for agreement, and the
 * spatiotemporal window that decides whether two observations are the
 * same real-world fact. Pure data — no DOM, no fetch, no globals.
 */

export interface FactMatchConfig {
  /** How observations are matched into one fact. 'spatial' (default) uses
   *  distance+time; 'key' uses an identity key (e.g. a crypto symbol)+time. */
  matchBy?: 'spatial' | 'key';
  /** Two observations are the same fact if within this great-circle distance
   *  (spatial mode only). */
  maxDistanceKm: number;
  /** ...and within this time delta (both modes). */
  maxTimeDeltaMs: number;
}

export interface FusionDomainConfig {
  /** Registered provider ids that feed this fact-type. */
  providerIds: readonly string[];
  /** Agreement tolerance mode. 'absolute' (default): values within
   *  ±numericTolerance agree. 'relative': values within numericTolerance × the
   *  larger magnitude agree (for values spanning orders of magnitude). */
  toleranceMode?: 'absolute' | 'relative';
  /** Absolute tolerance, or the fraction (0..1) when toleranceMode is 'relative'. */
  numericTolerance: number;
  match: FactMatchConfig;
}

export type FusionDomainKey = 'earthquakes' | 'air_quality' | 'crypto' | 'stocks';

export const FUSION_DOMAINS: Record<FusionDomainKey, FusionDomainConfig> = {
  earthquakes: {
    providerIds: ['usgs-earthquakes', 'emsc-seismic', 'geofon-seismic'],
    numericTolerance: 0.5,
    match: { maxDistanceKm: 50, maxTimeDeltaMs: 120_000 },
  },
  // AQI is a bounded 0–500 scale, so an absolute tolerance works; two sources
  // sampling the same locale (≤25 km) within a few hours should agree within
  // ~25 AQI points. Open-Meteo (modeled) + OpenAQ v3 (ground stations) +
  // AirNow (EPA ground stations) + PurpleAir (crowdsourced sensors, PM2.5→AQI
  // converted). AirNow feeds OpenAQ's US coverage too, but they're kept as
  // separate independenceGroups (see provider-registry.ts) since AirNow's own
  // direct-report cadence and QA process differ from OpenAQ's aggregation —
  // revisit if live disagreement data suggests they should be merged.
  air_quality: {
    providerIds: ['open-meteo-aqi', 'openaq-v3', 'airnow', 'purpleair'],
    numericTolerance: 25,
    match: { maxDistanceKm: 25, maxTimeDeltaMs: 3 * 60 * 60_000 },
  },
  // Crypto prices: matched by SYMBOL (not geography), agree within 2% (prices
  // span $0.50 to $60k so the band must scale with magnitude). CoinGecko +
  // CoinPaprika (aggregators) + Coinbase + Kraken (exchanges), all no-key,
  // all US-reachable.
  crypto: {
    providerIds: ['coingecko', 'coinbase', 'coinpaprika', 'kraken'],
    toleranceMode: 'relative',
    numericTolerance: 0.02,
    match: { matchBy: 'key', maxDistanceKm: 0, maxTimeDeltaMs: 5 * 60_000 },
  },
  // Stock prices: matched by TICKER, agree within 1% (quotes from different
  // feeds for the same instant rarely diverge more). Yahoo (no-key) + Finnhub
  // (keyed) + FMP (keyed) — FMP corroborates when its key is set, Yahoo-only
  // + Finnhub otherwise.
  stocks: {
    providerIds: ['yahoo-finance', 'finnhub', 'fmp'],
    toleranceMode: 'relative',
    numericTolerance: 0.01,
    match: { matchBy: 'key', maxDistanceKm: 0, maxTimeDeltaMs: 3 * 60_000 },
  },
};

export function fusionConfigFor(key: string): FusionDomainConfig | undefined {
  return (FUSION_DOMAINS as Record<string, FusionDomainConfig>)[key];
}
