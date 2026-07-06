/**
 * Source fusion: score a set of observations of the same fact from
 * multiple providers. Disagreements surface explicitly and are never
 * averaged away (plan invariant). Output slots into ConfidenceBreakdown.
 */

import type { Disagreement, FusionLabel, FusionResult, SourceObservation } from './provider-types.ts';
import { getProviderDefinition, independentGroupsFor } from './provider-registry.ts';
import type { ProviderHealthState } from './provider-health.ts';
import { deriveProviderHealth } from './provider-health.ts';

export interface FuseInput {
  observations: readonly SourceObservation[];
  healthState: ProviderHealthState;
  now: number;
  /** Numeric values within this absolute tolerance of the consensus agree.
   *  Ignored for string values (those must match exactly). Default 0. */
  numericTolerance?: number;
}

const DISAGREEMENT_CAP = 0.6; // mirrors redundant_disagreement in provider-redundancy.ts
const WEIGHTS = { freshness: 0.25, reliability: 0.25, corroboration: 0.5 };

/** Multiply the raw reliability score by this factor based on derived health status.
 *  A 'down' provider contributes nothing regardless of historical successRate. */
const STATUS_RELIABILITY_FACTOR: Record<string, number> = {
  healthy: 1,
  degraded: 0.7,
  stale: 0.5,
  down: 0,
  unknown_provider: 0,
};

export function fuseObservations(input: FuseInput): FusionResult {
  const known = input.observations.filter((o) => getProviderDefinition(o.providerId));
  const droppedCount = input.observations.length - known.length;

  if (known.length === 0) {
    const why = droppedCount > 0
      ? `No observations from registered providers (${droppedCount} dropped as unknown).`
      : 'No observations.';
    return {
      confidenceMultiplier: 0,
      label: 'very_low',
      components: {
        freshness: { score: 0, reason: why },
        reliability: { score: 0, reason: why },
        corroboration: { score: 0, reason: why },
      },
      disagreements: [],
      independentSourceCount: 0,
    };
  }

  const { consensus, disagreements } = splitConsensus(known, input.numericTolerance ?? 0);

  // Freshness: mean linear decay of consensus observations vs provider TTL.
  const freshnessScores = consensus.map((o) => {
    const ttl = getProviderDefinition(o.providerId)!.freshnessTtlMs;
    const age = Math.max(0, input.now - Math.min(o.observedAt, input.now));
    return Math.max(0, 1 - age / ttl);
  });
  const freshness = mean(freshnessScores);

  // Reliability: registry prior × observed success rate × status factor.
  // A 'down' provider contributes 0 even if historical successRate is high.
  const reliabilityScores = consensus.map((o) => {
    const def = getProviderDefinition(o.providerId)!;
    const health = deriveProviderHealth(input.healthState, o.providerId, input.now);
    const statusFactor = STATUS_RELIABILITY_FACTOR[health.status] ?? 0;
    return def.reliabilityWeight * health.successRate * statusFactor;
  });
  const reliability = mean(reliabilityScores);

  // Corroboration: independent groups in consensus, not raw provider count.
  const groups = independentGroupsFor(consensus.map((o) => o.providerId));
  const independentSourceCount = groups.size;
  let corroboration: number;
  if (independentSourceCount >= 3) corroboration = 0.95;
  else if (independentSourceCount === 2) corroboration = 0.8;
  else if (independentSourceCount === 1) corroboration = 0.5;
  else corroboration = 0;

  let multiplier = freshness * WEIGHTS.freshness + reliability * WEIGHTS.reliability + corroboration * WEIGHTS.corroboration;
  if (disagreements.length > 0) multiplier = Math.min(multiplier, DISAGREEMENT_CAP);
  multiplier = clamp01(multiplier);

  return {
    confidenceMultiplier: multiplier,
    label: labelFor(multiplier),
    components: {
      freshness: { score: freshness, reason: `Mean freshness ${freshness.toFixed(2)} across ${consensus.length} consensus observation(s).` },
      reliability: { score: reliability, reason: `Mean prior×observed reliability×status factor ${reliability.toFixed(2)}.` },
      corroboration: { score: corroboration, reason: buildCorrobReason(independentSourceCount, droppedCount) },
    },
    disagreements,
    independentSourceCount,
  };
}

function buildCorrobReason(independentSourceCount: number, droppedCount: number): string {
  const base = `${independentSourceCount} independent source group(s) agree`;
  return droppedCount > 0 ? `${base}; ${droppedCount} unknown-provider observation(s) dropped` : `${base}.`;
}

/** Consensus = the cluster with the most distinct independence groups.
 *  Ties broken by observation count, then summed reliabilityWeight (via
 *  registry lookup), then first-seen order. */
function splitConsensus(
  observations: readonly SourceObservation[],
  tolerance: number,
): { consensus: SourceObservation[]; disagreements: Disagreement[] } {
  const clusters: SourceObservation[][] = [];
  for (const o of observations) {
    const home = clusters.find((c) => c[0] !== undefined && agrees(c[0].value, o.value, tolerance));
    if (home) home.push(o);
    else clusters.push([o]);
  }
  clusters.sort((a, b) => {
    // Primary: most distinct independence groups
    const ga = independentGroupsFor(a.map((o) => o.providerId)).size;
    const gb = independentGroupsFor(b.map((o) => o.providerId)).size;
    if (gb !== ga) return gb - ga;
    // Tie-break 1: observation count
    if (b.length !== a.length) return b.length - a.length;
    // Tie-break 2: summed reliabilityWeight
    const wa = a.reduce((s, o) => s + (getProviderDefinition(o.providerId)?.reliabilityWeight ?? 0), 0);
    const wb = b.reduce((s, o) => s + (getProviderDefinition(o.providerId)?.reliabilityWeight ?? 0), 0);
    if (wb !== wa) return wb - wa;
    // Tie-break 3: first-seen order (stable — no change)
    return 0;
  });
  const [consensus = [], ...rest] = clusters;
  const disagreements = rest.map((c) => ({
    providerIds: c.map((o) => o.providerId),
    value: c[0]!.value,
    reason: `Differs from consensus value ${String(consensus[0]?.value)}.`,
  }));
  return { consensus, disagreements };
}

function agrees(a: number | string, b: number | string, tolerance: number): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= tolerance;
  return a === b;
}

function labelFor(m: number): FusionLabel {
  if (!Number.isFinite(m) || m < 0.2) return 'very_low';
  if (m < 0.4) return 'low';
  if (m < 0.6) return 'moderate';
  if (m < 0.8) return 'high';
  return 'very_high';
}

function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}

function clamp01(x: number): number {
  // NaN/Infinity (e.g. a NaN observedAt propagating through freshness) must
  // fail safe to 0, not slip past the `<` comparisons in labelFor and display
  // as maximum trust.
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}
