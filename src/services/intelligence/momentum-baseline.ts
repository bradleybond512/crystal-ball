/**
 * ACC-302 momentum baseline — "the recent trend continues."
 *
 * Applicable ONLY to directional market targets (criteria.kind ===
 * 'market_move'): the criteria carry direction, threshold, and a price
 * basis, and the fused spot-price store retains the pre-forecast series.
 * Everything else returns null — the roadmap's `not_applicable`.
 *
 * Estimate: least-squares slope (reusing intelligence/momentum
 * linearSlope) over the price samples observed BEFORE the forecast was
 * made, projected across the forecast horizon, expressed as a fraction
 * of the required move in the criteria's direction, and squashed:
 *
 *   ratio = projectedPctInDirection / minAbsPct
 *   p     = clamp(0.05, 0.95, 0.5 + 0.4·tanh(ratio))
 *
 * No drift → 0.5; a trend exactly reaching the threshold → ≈0.80; the
 * same trend against the direction → ≈0.20. Bounded, deterministic,
 * monotone in the trend.
 *
 * Lookahead discipline: the caller supplies samples; this module ALSO
 * hard-filters to observedAt < target.predictedAt — a leaked future
 * sample can never influence the estimate.
 *
 * Pure: target + samples in, PredictionRecord | null out.
 */

import type { PredictionRecord } from './forecast-calibration';
import { fnv1a64 } from './hierarchical-base-rate';
import { linearSlope, type TimeSample } from './momentum';
import { isBaselineSourceId, MOMENTUM_BASELINE_SOURCE_ID } from './baseline-model-ids';


export const MOMENTUM_BASELINE_VERSION = '1.0.0';

/** Minimum pre-forecast samples for a defensible trend. */
const MIN_SAMPLES = 5;
/** Ignore samples older than this before the forecast. */
const LOOKBACK_MS = 6 * 3_600_000;
const P_FLOOR = 0.05;
const P_CEIL = 0.95;

export interface MomentumSample {
  observedAt: number;
  price: number;
}

export interface MomentumBaselineEstimate {
  probability: number;
  /** Projected % move over the horizon, signed toward criteria.direction. */
  projectedPctInDirection: number;
  sampleCount: number;
}

export function estimateMomentumBaseline(
  target: PredictionRecord,
  samples: readonly MomentumSample[],
): MomentumBaselineEstimate | null {
  if (target.status !== 'pending') return null;
  if (!target.targetKey) return null;
  if (isBaselineSourceId(target.sourceId)) return null;
  if (!Number.isFinite(target.predictedAt) || !Number.isFinite(target.resolveBy)) return null;
  if (target.resolveBy <= target.predictedAt) return null;
  const criteria = target.criteria;
  if (criteria?.kind !== 'market_move') return null;
  if (!Number.isFinite(criteria.minAbsPct) || criteria.minAbsPct <= 0) return null;
  if (!Number.isFinite(criteria.basisPrice) || criteria.basisPrice <= 0) return null;

  // Hard no-lookahead filter, regardless of what the caller passed.
  const cutoff = target.predictedAt;
  const usable: TimeSample[] = samples
    .filter(
      (s) =>
        Number.isFinite(s.observedAt) &&
        Number.isFinite(s.price) &&
        s.price > 0 &&
        s.observedAt < cutoff &&
        s.observedAt >= cutoff - LOOKBACK_MS,
    )
    .map((s) => ({ t: s.observedAt, v: s.price }))
    .sort((a, b) => a.t - b.t);
  if (usable.length < MIN_SAMPLES) return null;

  const slope = linearSlope(usable);
  const horizonMs = target.resolveBy - target.predictedAt;
  const projectedMove = slope.perMs * horizonMs;
  const projectedPct = (projectedMove / criteria.basisPrice) * 100;
  const signed = criteria.direction === 'down' ? -projectedPct : projectedPct;
  const ratio = signed / criteria.minAbsPct;
  const probability = Math.min(P_CEIL, Math.max(P_FLOOR, 0.5 + 0.4 * Math.tanh(ratio)));
  return {
    probability,
    projectedPctInDirection: signed,
    sampleCount: usable.length,
  };
}

export function buildMomentumBaselinePrediction(
  target: PredictionRecord,
  samples: readonly MomentumSample[],
): PredictionRecord | null {
  const estimate = estimateMomentumBaseline(target, samples);
  if (!estimate) return null;
  return {
    ...target,
    id: `momentum:${fnv1a64([
      target.targetKey!,
      target.domain,
      String(target.predictedAt),
      String(target.resolveBy),
    ].join('\u0000'))}`,
    sourceId: MOMENTUM_BASELINE_SOURCE_ID,
    probability: estimate.probability,
    algorithmVersion: MOMENTUM_BASELINE_VERSION,
  };
}

export {MOMENTUM_BASELINE_SOURCE_ID} from './baseline-model-ids';