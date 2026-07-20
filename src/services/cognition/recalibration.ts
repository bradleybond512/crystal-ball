/**
 * Closed Calibration Loop — per-domain reliability curves.
 *
 * Implements binned monotonic recalibration (a deliberate, explainable substitute
 * for full isotonic regression) over the resolved PredictionRecords that
 * intelligence/forecast-calibration.ts already collects.
 *
 * Goal: stop applying one global boost multiplier and instead apply per-domain
 * reliability curves to every emitted probability. The data is already there —
 * this module uses it.
 *
 * Design invariants (house plan):
 *   - Every output carries an explanation string — never a bare number.
 *   - Stale data reduces confidence rather than disappearing silently.
 *   - All logic is pure deterministic (no DOM, no fetch, no globals at import).
 *   - Every output is testable with static fixtures.
 *
 * Algorithm:
 *   1. Divide [0,1] into 10 equal bins: [0,0.1), [0.1,0.2), …, [0.9,1.0].
 *   2. For each bin: compute predictedMean and observedRate over resolved records.
 *   3. Per-bin correction = observedRate − predictedMean, shrunk toward 0 by
 *      n_bin / (n_bin + 10)  [Laplace-style so a 3-sample bin can't swing wildly].
 *   4. Apply PAV (Pool Adjacent Violators) in-place to enforce monotonicity
 *      (higher predicted probability → higher calibrated probability).
 *   5. Clamp output to [0.02, 0.98] — the app never claims certainty.
 *
 * Fallback ladder:
 *   - Domain curve: n_domain ≥ 30 resolved → use domain curve.
 *   - Global/pooled curve: n_global ≥ 50 resolved → use pooled curve.
 *   - Identity: adjustment = 0, explanation states "insufficient history".
 *
 * Per docs/COGNITIVE_ENHANCEMENT_PLAN.md PR 2.
 */

import type { PredictionRecord } from '@/services/intelligence/forecast-calibration';
import type { FactDomain } from '@/services/intelligence/types';
import { getTunedParam } from '@/services/algorithms/tunable-params-store';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Number of equal-width bins across [0, 1]. */
export const BIN_COUNT = 10;

/** Laplace shrinkage pseudo-count: n_bin / (n_bin + SHRINK_PRIOR).
 *  Historical hardcoded default — the live value is the PR 12 tunable
 *  'recalibration:shrinkPrior' (bounds [5, 20]), read at curve-build time. */
export const SHRINK_PRIOR = 10;

/** Minimum resolved records for a per-domain curve (else fall back). */
export const MIN_DOMAIN_N = 30;

/** Minimum resolved records for a global/pooled curve (else identity). */
export const MIN_GLOBAL_N = 50;

/** Output probability lower bound — app never claims 0% certainty. */
export const CLAMP_LO = 0.02;

/** Output probability upper bound — app never claims 100% certainty. */
export const CLAMP_HI = 0.98;

// ── Public types ──────────────────────────────────────────────────────────────

/** A single reliability bin covering [lo, hi) in probability space. */
export interface ReliabilityBin {
  lo: number;
  hi: number;
  /** Number of resolved records whose predicted probability fell in this bin. */
  n: number;
  /** Mean predicted probability in this bin (weighted center). */
  predictedMean: number;
  /** Fraction of resolved-true outcomes in this bin. */
  observedRate: number;
}

/**
 * A per-domain (or global) reliability curve: 10 bins mapping predicted
 * probability to observed materialization rate, monotone-repaired and shrunk.
 */
export interface ReliabilityCurve {
  domain: FactDomain | 'global';
  bins: ReliabilityBin[];
  sampleSize: number;
  brier: number;
  generatedAt: number;
}

/** Result of recalibrating a single probability through a curve. */
export interface RecalibrationResult {
  /** Recalibrated probability, clamped to [CLAMP_LO, CLAMP_HI]. */
  p: number;
  /** Signed adjustment applied: p - original_p. */
  adjustment: number;
  /** Human-readable explanation (plan invariant: every score has an explanation). */
  explanation: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** Which of the 10 bins does probability p fall into? Returns bin index 0–9. */
function binIndex(p: number): number {
  if (p >= 1) return BIN_COUNT - 1;
  return Math.min(BIN_COUNT - 1, Math.floor(p * BIN_COUNT));
}

/** Return only resolved records from a list. */
function resolved(records: readonly PredictionRecord[]): PredictionRecord[] {
  return records.filter(r => r.status === 'resolved_true' || r.status === 'resolved_false');
}

/** Brier score over an array of resolved records. */
function brierFor(recs: readonly PredictionRecord[]): number {
  if (recs.length === 0) return 0;
  let sum = 0;
  for (const r of recs) {
    const outcome = r.status === 'resolved_true' ? 1 : 0;
    sum += (r.probability - outcome) ** 2;
  }
  return round3(sum / recs.length);
}

// ── PAV (Pool Adjacent Violators) ─────────────────────────────────────────────
//
// Enforces monotonicity of the calibrated values in-place.
// We want: for bins i < j, calibrated(i) ≤ calibrated(j).
// PAV merges adjacent pairs that violate this, replacing both with their
// weighted mean, then repeats until no violations remain.
//
// Input: array of { value, weight } objects (modified in-place).
// ~20 lines, no dependencies.

interface PavItem {
  value: number;
  weight: number;
}

function pavMakeMonotone(items: PavItem[]): void {
  // Keep merging adjacent violating pairs until done.
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < items.length - 1; i++) {
      const a = items[i]!;
      const b = items[i + 1]!;
      if (a.value > b.value) {
        // Violation: merge into weighted average.
        const totalW = a.weight + b.weight;
        const merged = totalW > 0 ? (a.value * a.weight + b.value * b.weight) / totalW : (a.value + b.value) / 2;
        a.value = merged;
        b.value = merged;
        a.weight = totalW;
        b.weight = totalW;
        changed = true;
      }
    }
  }
}

// ── buildCurve ────────────────────────────────────────────────────────────────

/**
 * Build a ReliabilityCurve from a set of PredictionRecords.
 *
 * @param records  All prediction records (may include pending/expired — only
 *                 resolved_true/resolved_false are used).
 * @param domain   If provided, filters records to that domain and labels the
 *                 curve accordingly. If omitted, builds a 'global' curve.
 */
export function buildCurve(
  records: readonly PredictionRecord[],
  domain?: FactDomain,
): ReliabilityCurve {
  const pool = domain
    ? resolved(records).filter(r => r.domain === domain)
    : resolved(records);

  // Accumulate per-bin statistics.
  const binPredSum = new Float64Array(BIN_COUNT);
  const binTrueCount = new Float64Array(BIN_COUNT);
  const binN = new Float64Array(BIN_COUNT);

  for (const r of pool) {
    const bi = binIndex(r.probability);
    // Float64Array index access is always in-bounds here (binIndex clamps to 0..BIN_COUNT-1),
    // but TypeScript strict mode requires explicit default fallback for typed arrays.
    binPredSum[bi] = (binPredSum[bi] ?? 0) + r.probability;
    binN[bi] = (binN[bi] ?? 0) + 1;
    if (r.status === 'resolved_true') binTrueCount[bi] = (binTrueCount[bi] ?? 0) + 1;
  }

  // Build raw bins with shrinkage on the correction term.
  const shrinkPrior = getTunedParam('recalibration', 'shrinkPrior', SHRINK_PRIOR);
  const pavItems: PavItem[] = [];
  const bins: ReliabilityBin[] = [];

  for (let i = 0; i < BIN_COUNT; i++) {
    const lo = i / BIN_COUNT;
    const hi = (i + 1) / BIN_COUNT;
    const n = binN[i]!;
    const predictedMean = n > 0 ? binPredSum[i]! / n : (lo + hi) / 2;
    const rawObservedRate = n > 0 ? binTrueCount[i]! / n : predictedMean;

    // Laplace-style shrinkage: pull correction toward 0 when n is small.
    const shrinkage = n / (n + shrinkPrior);
    const rawCorrection = rawObservedRate - predictedMean;
    const correction = rawCorrection * shrinkage;
    const calibratedValue = predictedMean + correction;

    bins.push({
      lo,
      hi,
      n,
      predictedMean: round3(predictedMean),
      observedRate: round3(rawObservedRate),
    });

    // PAV uses the calibrated probability (predictedMean + correction) as the
    // monotonicity target, weighted by sample count (0-sample bins get weight 0).
    pavItems.push({ value: calibratedValue, weight: n });
  }

  // Enforce monotonicity via PAV.
  pavMakeMonotone(pavItems);

  // Write PAV-corrected calibrated values back into bins as observedRate
  // (overwriting — this is now the monotone-repaired smoothed rate).
  for (let i = 0; i < BIN_COUNT; i++) {
    bins[i]!.observedRate = round3(clamp(pavItems[i]!.value, 0, 1));
  }

  return {
    domain: domain ?? 'global',
    bins,
    sampleSize: pool.length,
    brier: brierFor(pool),
    generatedAt: Date.now(),
  };
}

// ── recalibrate ───────────────────────────────────────────────────────────────

/**
 * Recalibrate a raw probability through a reliability curve.
 *
 * The recalibrated value is the curve's smoothed observedRate for the bin
 * containing p, blended with the raw predicted probability using the bin's
 * sample-count weight (shrinkage). Output clamped to [CLAMP_LO, CLAMP_HI].
 *
 * When the curve is an identity (sampleSize < threshold), returns p unchanged
 * with an explanation stating insufficient history.
 *
 * Plan invariant: explanation is always non-empty.
 *
 * @example
 * // "finance forecasts at ~70% have materialized 54% of the time (n=41) → adjusted to 58%"
 */
export function recalibrate(p: number, curve: ReliabilityCurve): RecalibrationResult {
  const originalP = clamp(p, 0, 1);
  const bi = binIndex(originalP);
  const bin = curve.bins[bi]!;

  // Identity path: insufficient data.
  if (curve.sampleSize < MIN_GLOBAL_N && curve.domain === 'global') {
    const explanation = `insufficient calibration history (n=${curve.sampleSize} < ${MIN_GLOBAL_N} required) — probability unchanged`;
    return { p: clamp(originalP, CLAMP_LO, CLAMP_HI), adjustment: 0, explanation };
  }
  if (curve.sampleSize < MIN_DOMAIN_N && curve.domain !== 'global') {
    const explanation = `insufficient ${String(curve.domain)} calibration history (n=${curve.sampleSize} < ${MIN_DOMAIN_N} required) — probability unchanged`;
    return { p: clamp(originalP, CLAMP_LO, CLAMP_HI), adjustment: 0, explanation };
  }

  // The calibrated value is the PAV-repaired observedRate for this bin.
  const calibratedP = clamp(bin.observedRate, CLAMP_LO, CLAMP_HI);
  const adjustment = round3(calibratedP - clamp(originalP, CLAMP_LO, CLAMP_HI));

  // Build explanation (plan invariant: every score has an explanation).
  const domainLabel = curve.domain === 'global' ? 'forecasts' : `${String(curve.domain)} forecasts`;
  const pctRaw = Math.round(originalP * 100);
  const pctObs = Math.round(bin.observedRate * 100);
  const pctAdj = Math.round(calibratedP * 100);
  const binN = bin.n;

  const explanation = adjustment === 0 ? `${domainLabel} at ~${pctRaw}% are well-calibrated (n=${binN}, observed ${pctObs}%) — no adjustment` : `${domainLabel} at ~${pctRaw}% have materialized ${pctObs}% of the time (n=${binN}) → adjusted to ${pctAdj}%`;

  return { p: calibratedP, adjustment, explanation };
}

// ── pooledCurve ───────────────────────────────────────────────────────────────

/**
 * Merge multiple per-domain curves into a single 'global' pooled curve.
 * Each bin's pooled observedRate is the weighted mean of domain bin rates
 * (weighted by each domain's bin sample count).
 *
 * PAV is re-applied after pooling to restore monotonicity.
 */
export function pooledCurve(curves: readonly ReliabilityCurve[]): ReliabilityCurve {
  if (curves.length === 0) {
    // Return a zero-sample identity curve.
    const bins: ReliabilityBin[] = Array.from({ length: BIN_COUNT }, (_, i) => ({
      lo: i / BIN_COUNT,
      hi: (i + 1) / BIN_COUNT,
      n: 0,
      predictedMean: round3((i + 0.5) / BIN_COUNT),
      observedRate: round3((i + 0.5) / BIN_COUNT),
    }));
    return { domain: 'global', bins, sampleSize: 0, brier: 0, generatedAt: Date.now() };
  }

  const pooledBinRateSum = new Float64Array(BIN_COUNT);
  const pooledBinWeightSum = new Float64Array(BIN_COUNT);
  const pooledBinPredSum = new Float64Array(BIN_COUNT);
  const pooledBinN = new Float64Array(BIN_COUNT);
  let totalSampleSize = 0;
  let totalBrierWeightedSum = 0;

  for (const curve of curves) {
    totalSampleSize += curve.sampleSize;
    totalBrierWeightedSum += curve.brier * curve.sampleSize;
    for (let i = 0; i < BIN_COUNT; i++) {
      const bin = curve.bins[i]!;
      pooledBinRateSum[i] = (pooledBinRateSum[i] ?? 0) + bin.observedRate * bin.n;
      pooledBinWeightSum[i] = (pooledBinWeightSum[i] ?? 0) + bin.n;
      pooledBinPredSum[i] = (pooledBinPredSum[i] ?? 0) + bin.predictedMean * bin.n;
      pooledBinN[i] = (pooledBinN[i] ?? 0) + bin.n;
    }
  }

  const pavItems: PavItem[] = [];
  const bins: ReliabilityBin[] = [];

  for (let i = 0; i < BIN_COUNT; i++) {
    const lo = i / BIN_COUNT;
    const hi = (i + 1) / BIN_COUNT;
    const w = pooledBinWeightSum[i]!;
    const n = pooledBinN[i]!;
    const predictedMean = n > 0 ? pooledBinPredSum[i]! / n : (lo + hi) / 2;
    const observedRate = w > 0 ? pooledBinRateSum[i]! / w : predictedMean;

    bins.push({ lo, hi, n, predictedMean: round3(predictedMean), observedRate: round3(observedRate) });
    pavItems.push({ value: observedRate, weight: n });
  }

  pavMakeMonotone(pavItems);

  for (let i = 0; i < BIN_COUNT; i++) {
    bins[i]!.observedRate = round3(clamp(pavItems[i]!.value, 0, 1));
  }

  const pooledBrier = totalSampleSize > 0 ? round3(totalBrierWeightedSum / totalSampleSize) : 0;

  return {
    domain: 'global',
    bins,
    sampleSize: totalSampleSize,
    brier: pooledBrier,
    generatedAt: Date.now(),
  };
}

// ── identityCurve (helper used by adapter) ────────────────────────────────────

/**
 * Build an identity curve (adjustment = 0 for all bins) with explicit sample
 * counts set to 0. Used when neither domain nor global thresholds are met.
 */
export function identityCurve(domain: FactDomain | 'global'): ReliabilityCurve {
  const bins: ReliabilityBin[] = Array.from({ length: BIN_COUNT }, (_, i) => ({
    lo: i / BIN_COUNT,
    hi: (i + 1) / BIN_COUNT,
    n: 0,
    predictedMean: round3((i + 0.5) / BIN_COUNT),
    observedRate: round3((i + 0.5) / BIN_COUNT),
  }));
  return { domain, bins, sampleSize: 0, brier: 0, generatedAt: Date.now() };
}
