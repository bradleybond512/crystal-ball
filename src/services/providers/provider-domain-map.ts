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

export type FusionDomainKey =
  | 'earthquakes'
  | 'air_quality'
  | 'crypto'
  | 'stocks'
  | 'surface_temp'
  | 'fx_rates'
  | 'space_weather';

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
  // Matched by SAVED-PLACE ID, not geography: two saved places can sit only
  // a few km apart (home + work), and spatial matching at any workable
  // radius would blend their readings into one fact — a lake-effect gradient
  // of several °C over a handful of km is ordinary weather, not disagreement.
  // The 90-minute window covers the systematic gap between the two providers'
  // cadences even when both are perfectly fresh: Open-Meteo `current` is a
  // 15-minute-bucketed nowcast, MET Norway `timeseries[0]` is the next hourly
  // forecast step, so the two land 0-60 min apart by construction. Same-place
  // same-hour temps from independent models should still agree within
  // ~2.5°C; larger gaps are real forecast disagreement worth surfacing.
  surface_temp: {
    providerIds: ['open-meteo-forecast', 'met-norway'],
    numericTolerance: 2.5,
    match: { matchBy: 'key', maxDistanceKm: 0, maxTimeDeltaMs: 90 * 60_000 },
  },
  // USD-based FX rates matched by CURRENCY CODE. Frankfurter (ECB daily
  // reference fixing) + open.er-api (continuously-updated aggregator).
  fx_rates: {
    providerIds: ['frankfurter-fx', 'er-api-fx'],
    toleranceMode: 'relative',
    // 1%, NOT 0.5%. Live side-by-side probe of both upstreams in the same
    // minute (2026-07-30): EUR 0.87873 vs 0.875576 = 0.36% apart, GBP 0.24%,
    // JPY 0.09%. The two sources differ structurally — a daily fixing vs a
    // continuous aggregate — so a small persistent gap is expected, not a
    // defect. At 0.5% EUR would flip to "disagreement" on an ordinary day, a
    // permanent false positive that trains the user to ignore the flag. 1%
    // still catches a genuinely broken feed: a stale-by-days rate or a wrong
    // base currency moves far more than 1%. Relative, not absolute: the
    // measured absolute gaps span JPY 0.149 and KRW 3.36 down to SEK 0.028,
    // all ≤0.36% relative, so one absolute band cannot fit both ends.
    numericTolerance: 0.01,
    // 5 days, NOT the minutes-scale window the spatial domains use. Frankfurter
    // stamps observations with the ECB *fixing date* (UTC midnight) and the ECB
    // does not publish on weekends or TARGET holidays — a Sunday query returns
    // Friday's fixing, so the two sources sit ~48 h apart every weekend and ~72 h
    // apart on Monday morning. Anything tighter makes this domain stop
    // corroborating for 2 days in 7 without any visible error. Do not "tidy" this
    // number down.
    match: { matchBy: 'key', maxDistanceKm: 0, maxTimeDeltaMs: 5 * 24 * 60 * 60_000 },
  },
  // Planetary Kp matched by its 3-HOUR BIN START — Kp is a global index with
  // no geography, so there is nothing spatial to match on. SWPC (8-station
  // estimate, near-real-time) + GFZ Potsdam (13-observatory network, its own
  // algorithm).
  space_weather: {
    providerIds: ['swpc-kp', 'gfz-kp'],
    // 1.5 Kp units, NOT 0.5. Kp is quantized to thirds (0, 0.333, 0.667, 1,
    // ...), so the two agencies' independent algorithms routinely land 1-3
    // steps apart on the same bin. Measured across 60 shared bins
    // (2026-07-23..2026-07-30): median delta 0.333, p95 1.003, max 1.003 —
    // not one bin exceeded 1.5. At 0.5 the domain would flag 16 of those 60
    // bins (26.7%) as disagreement on entirely ordinary space weather, a
    // permanent false positive that trains the user to ignore the flag. 1.5
    // still catches what matters: a split across the G1-storm threshold
    // (Kp 5) is ≥1.5 whenever one source says quiet and the other says storm.
    numericTolerance: 1.5,
    // Both sources stamp the bin START, so the real delta is 0; the 3h window
    // is headroom for a mid-bin timestamp, not a corroboration loophole —
    // adjacent bins have different keys and cannot match regardless.
    match: { matchBy: 'key', maxDistanceKm: 0, maxTimeDeltaMs: 3 * 60 * 60_000 },
  },
};

export function fusionConfigFor(key: string): FusionDomainConfig | undefined {
  return (FUSION_DOMAINS as Record<string, FusionDomainConfig>)[key];
}
