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

export type FusionDomainKey = 'earthquakes';

export const FUSION_DOMAINS: Record<FusionDomainKey, FusionDomainConfig> = {
  earthquakes: {
    providerIds: ['usgs-earthquakes', 'emsc-seismic'],
    numericTolerance: 0.5,
    match: { maxDistanceKm: 50, maxTimeDeltaMs: 120_000 },
  },
};

export function fusionConfigFor(key: string): FusionDomainConfig | undefined {
  return (FUSION_DOMAINS as Record<string, FusionDomainConfig>)[key];
}
