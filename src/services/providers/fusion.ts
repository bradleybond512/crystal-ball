/**
 * Source Fusion Scoring — combines a provider's static reliability with
 * runtime health and observation freshness into a single confidence
 * label that a panel can render or use to weight aggregation.
 *
 * Inputs:
 *   - ProviderDefinition.baselineWeight  (prior on source reliability)
 *   - ProviderHealthRecord               (recent success/error/latency)
 *   - observation timestamp               (vs ttlMs)
 *
 * Outputs:
 *   - freshnessScore   ∈ [0, 1]
 *   - reliabilityScore ∈ [0, 1]
 *   - corroborationScore ∈ [0, 1]   (only meaningful when ≥ 2 sources observed the same fact)
 *   - confidence label:  'high' | 'medium' | 'low' | 'conflict'
 *
 * Design choice: never throw. Missing inputs collapse to neutral
 * scores (0.5) and label 'medium' so a panel always renders.
 */

import type { ProviderDefinition } from './registry';
import type { ProviderHealthRecord, ProviderStatus } from './health';

export type ConfidenceLabel = 'high' | 'medium' | 'low' | 'conflict';

export interface FusionScore {
  freshness: number;       // [0,1]
  reliability: number;     // [0,1]
  corroboration: number;   // [0,1]
  confidence: ConfidenceLabel;
  /** Diagnostic — which sources contributed and how each scored. */
  contributors: { providerId: string; score: number; status: ProviderStatus }[];
  /** True if sources flagged as observing the same fact disagreed. */
  conflictDetected: boolean;
}

/** Score how fresh an observation is relative to the provider's TTL.
 *  At observation time → 1.0. At ttl elapsed → 0.5. At 2x ttl → 0.0. */
export function scoreFreshness(observedAt: number, ttlMs: number, now: number = Date.now()): number {
  if (!Number.isFinite(observedAt) || ttlMs <= 0) return 0.5;
  const ageMs = Math.max(0, now - observedAt);
  const ratio = ageMs / ttlMs;
  if (ratio <= 0) return 1;
  if (ratio >= 2) return 0;
  // Linear decay between 1.0 (fresh) and 0.0 (twice TTL).
  return Math.max(0, Math.min(1, 1 - ratio / 2));
}

/** Combine a provider's baseline weight with its runtime health into
 *  a current reliability score in [0,1]. */
export function scoreReliability(
  def: ProviderDefinition,
  health: ProviderHealthRecord | null,
): number {
  const base = clamp01(def.baselineWeight);
  if (!health) return base;
  switch (health.status) {
    case 'healthy': { return base;
    }
    case 'unknown': { return base * 0.9;
    }     // light prior penalty until we see traffic
    case 'degraded': { return base * 0.6;
    }
    case 'rateLimited': { return base * 0.5;
    }
    case 'stale': { return base * 0.4;
    }
    case 'down': { return 0;
    }
    default: { return base;
    }
  }
}

/** Score corroboration across N sources that all observed the same
 *  fact. Single source → 0.5 (no corroboration). Two agreeing sources
 *  → 0.75. Three+ → 0.9-1.0 with diminishing returns. Disagreement
 *  pulls the score down sharply. */
export function scoreCorroboration(opts: { agreeing: number; disagreeing: number }): { score: number; conflict: boolean } {
  const { agreeing, disagreeing } = opts;
  const total = agreeing + disagreeing;
  if (total === 0) return { score: 0.5, conflict: false };
  if (disagreeing === 0) {
    if (agreeing === 1) return { score: 0.5, conflict: false };
    if (agreeing === 2) return { score: 0.75, conflict: false };
    if (agreeing === 3) return { score: 0.9, conflict: false };
    return { score: 1, conflict: false };
  }
  // Disagreement: ratio of agreeing to total. If half disagree, score caps at 0.4.
  const agreementRatio = agreeing / total;
  const conflictPenalty = (disagreeing / total) * 0.6;
  const score = Math.max(0, agreementRatio - conflictPenalty);
  // Mark as conflict when at least 1 disagreeing source AND minority is meaningful.
  const conflict = disagreeing >= 1 && agreementRatio <= 0.66;
  return { score, conflict };
}

/** Combine all three component scores plus per-source observations into
 *  a final fused output. Weights: reliability 0.4, freshness 0.3,
 *  corroboration 0.3 — roughly mirroring "is this source any good
 *  right now, was the data we have recent, did anyone else see it." */
export function combineScores(args: {
  contributors: {
    providerDef: ProviderDefinition;
    health: ProviderHealthRecord | null;
    observedAt: number;
    /** True if this contributor's reading agrees with the consensus.
     *  When the panel doesn't have the concept of agreement (e.g. it's
     *  just listing aircraft from N feeds), pass true for all sources. */
    agrees?: boolean;
  }[];
}): FusionScore {
  const contribs = args.contributors;
  if (contribs.length === 0) {
    return {
      freshness: 0,
      reliability: 0,
      corroboration: 0,
      confidence: 'low',
      contributors: [],
      conflictDetected: false,
    };
  }

  // Per-source rough score (used for ordering + diagnostics).
  const perSource = contribs.map((c) => {
    const freshness = scoreFreshness(c.observedAt, c.providerDef.ttlMs);
    const reliability = scoreReliability(c.providerDef, c.health);
    const score = clamp01((freshness + reliability) / 2);
    return {
      providerId: c.providerDef.id,
      score,
      status: c.health?.status ?? 'unknown' as ProviderStatus,
    };
  });

  // Aggregate freshness + reliability across contributors (weighted by
  // baselineWeight so noisy low-prior sources don't drag everyone down).
  const totalWeight = contribs.reduce((s, c) => s + c.providerDef.baselineWeight, 0) || 1;
  const freshness = contribs.reduce(
    (s, c) => s + scoreFreshness(c.observedAt, c.providerDef.ttlMs) * c.providerDef.baselineWeight,
    0,
  ) / totalWeight;
  const reliability = contribs.reduce(
    (s, c) => s + scoreReliability(c.providerDef, c.health) * c.providerDef.baselineWeight,
    0,
  ) / totalWeight;

  // Corroboration based on agreement flags.
  const agreeing = contribs.filter((c) => c.agrees !== false).length;
  const disagreeing = contribs.length - agreeing;
  const { score: corroboration, conflict } = scoreCorroboration({ agreeing, disagreeing });

  // Final blended score → label. Weight corroboration heavier (0.4) so a
  // single fresh source can't reach `high` on its own; matters most when
  // the user is wondering whether to act on intel.
  const blended = freshness * 0.25 + reliability * 0.35 + corroboration * 0.4;
  const confidence: ConfidenceLabel = conflict ? 'conflict' : labelForBlended(blended);

  return {
    freshness: round3(freshness),
    reliability: round3(reliability),
    corroboration: round3(corroboration),
    confidence,
    contributors: perSource,
    conflictDetected: conflict,
  };
}

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }
function round3(x: number): number { return Math.round(x * 1000) / 1000; }

/** Map a non-conflicted blended score to a confidence label. */
function labelForBlended(blended: number): Exclude<ConfidenceLabel, 'conflict'> {
  if (blended >= 0.8) return 'high';
  if (blended >= 0.45) return 'medium';
  return 'low';
}
