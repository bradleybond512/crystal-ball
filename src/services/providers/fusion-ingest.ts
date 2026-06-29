/**
 * Fusion ingest: turn per-provider observations of a fact-type into
 * matched, fused facts with per-provider fingerprints. The keystone that
 * activates source-fusion.ts on live data.
 *
 * Pure: no DOM, no fetch, no globals. The data-loader adapts live
 * responses into DomainObservation[] and calls ingestDomain().
 */

import type { FusionResult, SourceObservation } from './provider-types.ts';
import type { ProviderHealthState } from './provider-health.ts';
import { fuseObservations } from './source-fusion.ts';
import { fusionConfigFor, type FactMatchConfig } from './provider-domain-map.ts';

export interface DomainObservation {
  providerId: string;
  /** The numeric value to corroborate (e.g. earthquake magnitude). */
  value: number;
  lat: number;
  lon: number;
  /** When the fact occurred (ms). */
  occurredAt: number;
  /** Optional provider-native id, for debugging. */
  externalId?: string;
}

export interface FusedFact {
  providerIds: string[];
  value: number;
  lat: number;
  lon: number;
  occurredAt: number;
  fusion: FusionResult;
  /** Per-provider fingerprint for this fact (agree → equal, disagree → differ). */
  fingerprints: Record<string, string>;
}

export interface IngestResult {
  facts: FusedFact[];
  /** Headline per-provider fingerprints (most significant fact) for the
   *  domain-level provider-redundancy snapshot. */
  providerFingerprints: Record<string, string>;
}

const EARTH_RADIUS_KM = 6371;

export function ingestDomain(
  key: string,
  observations: readonly DomainObservation[],
  healthState: ProviderHealthState,
  now: number,
): IngestResult {
  const cfg = fusionConfigFor(key);
  if (!cfg) return { facts: [], providerFingerprints: {} };

  const allowed = new Set(cfg.providerIds);
  // Sort to a canonical order (time, then space) so clustering is independent
  // of provider-concat / input order.
  const relevant = observations
    .filter((o) => allowed.has(o.providerId))
    .sort((a, b) => a.occurredAt - b.occurredAt || a.lat - b.lat || a.lon - b.lon);
  const clusters = clusterObservations(relevant, cfg.match);

  const facts: FusedFact[] = clusters.map((cluster) => {
    const sourceObs: SourceObservation[] = cluster.map((o) => ({
      providerId: o.providerId,
      value: o.value,
      observedAt: o.occurredAt,
    }));
    const fusion = fuseObservations({
      observations: sourceObs,
      healthState,
      now,
      numericTolerance: cfg.numericTolerance,
    });
    // Fingerprint reflects fusion's consensus decision, NOT each raw value.
    // All consensus providers share one fingerprint; only providers fusion
    // flagged as disagreeing get a distinct one. This keeps the redundancy
    // verdict consistent with fuseObservations — two values within tolerance
    // that straddle a bucket boundary must NOT read as a disagreement.
    const disagreeIds = new Set(fusion.disagreements.flatMap((d) => d.providerIds));
    const consensusObs = cluster.filter((o) => !disagreeIds.has(o.providerId));
    const consensusValue = (consensusObs[0] ?? cluster[0]!).value;
    const consensusFp = `c:${bucket(consensusValue, cfg.numericTolerance)}`;
    const fingerprints: Record<string, string> = {};
    for (const o of cluster) {
      fingerprints[o.providerId] = disagreeIds.has(o.providerId)
        ? `d:${bucket(o.value, cfg.numericTolerance)}:${o.providerId}`
        : consensusFp;
    }
    const rep = cluster[0]!;
    return {
      providerIds: cluster.map((o) => o.providerId),
      value: rep.value,
      lat: rep.lat,
      lon: rep.lon,
      occurredAt: rep.occurredAt,
      fusion,
      fingerprints,
    };
  });

  return { facts, providerFingerprints: headlineFingerprints(facts) };
}

/** Greedy clustering: each observation joins the NEAREST existing cluster
 *  whose seed is within the match window; otherwise it seeds a new one.
 *  Comparing only against the seed prevents transitive chaining; picking the
 *  nearest qualifying cluster (not the first) keeps membership deterministic. */
function clusterObservations(
  observations: readonly DomainObservation[],
  match: FactMatchConfig,
): DomainObservation[][] {
  const clusters: DomainObservation[][] = [];
  for (const o of observations) {
    let best: DomainObservation[] | null = null;
    let bestDist = Infinity;
    for (const c of clusters) {
      const seed = c[0]!;
      if (Math.abs(seed.occurredAt - o.occurredAt) > match.maxTimeDeltaMs) continue;
      const d = haversineKm(seed.lat, seed.lon, o.lat, o.lon);
      if (d <= match.maxDistanceKm && d < bestDist) {
        best = c;
        bestDist = d;
      }
    }
    if (best) best.push(o);
    else clusters.push([o]);
  }
  return clusters;
}

/** Pick the fact with the most independent providers, breaking ties by value. */
function headlineFingerprints(facts: readonly FusedFact[]): Record<string, string> {
  if (facts.length === 0) return {};
  const headline = [...facts].sort((a, b) => {
    if (b.providerIds.length !== a.providerIds.length) return b.providerIds.length - a.providerIds.length;
    return b.value - a.value;
  })[0]!;
  return { ...headline.fingerprints };
}

function bucket(value: number, tolerance: number): string {
  const size = tolerance > 0 ? tolerance : 1;
  return `v:${Math.round(value / size)}`;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
