/**
 * Maps a fusable fact-type (finer than ProviderDomain) to the providers
 * that feed it, the numeric tolerance for agreement, and the
 * spatiotemporal window that decides whether two observations are the
 * same real-world fact. Pure data — no DOM, no fetch, no globals.
 */

export interface FactMatchConfig {
  /** Two observations are the same fact if within this great-circle distance. */
  maxDistanceKm: number;
  /** ...and within this time delta. */
  maxTimeDeltaMs: number;
}

export interface FusionDomainConfig {
  /** Registered provider ids that feed this fact-type. */
  providerIds: readonly string[];
  /** Numeric values within this absolute tolerance agree (passed to fuseObservations). */
  numericTolerance: number;
  match: FactMatchConfig;
}

export type FusionDomainKey = 'earthquakes' | 'air_quality';

export const FUSION_DOMAINS: Record<FusionDomainKey, FusionDomainConfig> = {
  earthquakes: {
    providerIds: ['usgs-earthquakes', 'emsc-seismic'],
    numericTolerance: 0.5,
    match: { maxDistanceKm: 50, maxTimeDeltaMs: 120_000 },
  },
  // AQI is a bounded 0–500 scale, so an absolute tolerance works; two sources
  // sampling the same locale (≤25 km) within a few hours should agree within
  // ~25 AQI points. Open-Meteo (modeled) + OpenAQ v3 (ground stations).
  air_quality: {
    providerIds: ['open-meteo-aqi', 'openaq-v3'],
    numericTolerance: 25,
    match: { maxDistanceKm: 25, maxTimeDeltaMs: 3 * 60 * 60_000 },
  },
};

export function fusionConfigFor(key: string): FusionDomainConfig | undefined {
  return (FUSION_DOMAINS as Record<string, FusionDomainConfig>)[key];
}
