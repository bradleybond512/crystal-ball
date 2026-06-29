/**
 * Out-of-distribution (OOD) confidence decay. Forecasts currently start
 * equally confident regardless of how far the case sits from anything the
 * system has seen. This penalizes confidence by distance from the training
 * distribution AND by how little training data backs it — so rare commodities
 * and emerging conflicts stop being reported with unearned certainty.
 *
 * Pure: no DOM, no fetch, no globals. Fixture-testable.
 */

export interface DistributionStats {
  mean: number;
  /** Population std-dev. A 0 std-dev means a constant feature (no spread). */
  stdDev: number;
  /** Number of training samples backing these stats. */
  n: number;
}

export interface OodResult {
  /** Aggregate standardized distance (worst-feature z-score). */
  distance: number;
  /** 0..1 multiplier to apply to a forecast's confidence. */
  decayMultiplier: number;
  inDistribution: boolean;
  /** 0..1 — how well training data covers this kind of case (from min n). */
  coverage: number;
  rationale: string;
}

export interface OodOptions {
  /** z below which there is no distance decay. Default 2. */
  softZ?: number;
  /** z at/above which distance decay hits its floor. Default 5. */
  hardZ?: number;
  /** Lowest the distance-decay term can reach. Default 0.4. */
  floor?: number;
  /** Training-sample count for full coverage. Default 30. */
  fullCoverageN?: number;
  /** Lowest the coverage term can reach when training is empty. Default 0.5. */
  coverageFloor?: number;
}

export function fitDistribution(samples: readonly number[]): DistributionStats {
  const n = samples.length;
  if (n === 0) return { mean: 0, stdDev: 0, n: 0 };
  const mean = samples.reduce((s, x) => s + x, 0) / n;
  const variance = samples.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
  return { mean, stdDev: Math.sqrt(variance), n };
}

/** Decay multiplier for a feature vector given per-feature training stats.
 *  Distance is the worst (max) per-feature z-score — conservative: one wildly
 *  off-distribution feature is enough to dent confidence. */
export function oodDecay(
  features: readonly number[],
  refs: readonly DistributionStats[],
  options: OodOptions = {},
): OodResult {
  const softZ = options.softZ ?? 2;
  const hardZ = options.hardZ ?? 5;
  const floor = options.floor ?? 0.4;
  const fullCoverageN = options.fullCoverageN ?? 30;
  const coverageFloor = options.coverageFloor ?? 0.5;

  if (features.length === 0 || refs.length === 0) {
    return {
      distance: 0,
      decayMultiplier: coverageFloor,
      inDistribution: false,
      coverage: 0,
      rationale: 'No features or no training distribution — confidence capped to the coverage floor.',
    };
  }

  // Every feature must have matching training stats. A feature beyond `refs`
  // has no coverage at all — treat it as maximally far AND zero-coverage so it
  // can't be silently dropped into unearned full confidence (fail-closed).
  let distance = 0;
  let minN = Infinity;
  for (const [i, x] of features.entries()) {
    const ref = refs[i];
    if (!ref) {
      distance = Math.max(distance, hardZ);
      minN = 0;
      continue;
    }
    minN = Math.min(minN, ref.n);
    distance = Math.max(distance, featureZ(x, ref, hardZ));
  }

  const distanceDecay = distanceTerm(distance, softZ, hardZ, floor);
  const coverage = clamp01((Number.isFinite(minN) ? minN : 0) / fullCoverageN);
  const coverageTerm = coverageFloor + (1 - coverageFloor) * coverage;
  const decayMultiplier = clamp01(distanceDecay * coverageTerm);
  const inDistribution = distance <= softZ && coverage >= 1;

  return {
    distance,
    decayMultiplier,
    inDistribution,
    coverage,
    rationale: `Worst-feature z=${distance.toFixed(2)} (soft ${softZ}/hard ${hardZ}); coverage ${(coverage * 100).toFixed(0)}% → ×${decayMultiplier.toFixed(2)}.`,
  };
}

/** Single-feature convenience. */
export function oodDecayScalar(value: number, stats: DistributionStats, options: OodOptions = {}): OodResult {
  return oodDecay([value], [stats], options);
}

/** Per-feature standardized distance. A constant (zero-spread) feature reads
 *  as in-distribution on an exact match and maximally far otherwise. */
function featureZ(value: number, ref: DistributionStats, hardZ: number): number {
  // Non-finite value or stats (missing sensor / model output) → maximally far.
  if (!Number.isFinite(value) || !Number.isFinite(ref.mean) || !Number.isFinite(ref.stdDev)) return hardZ;
  if (ref.stdDev > 0) return Math.abs(value - ref.mean) / ref.stdDev;
  return value === ref.mean ? 0 : hardZ;
}

function distanceTerm(distance: number, softZ: number, hardZ: number, floor: number): number {
  if (distance <= softZ) return 1;
  if (distance >= hardZ) return floor;
  const frac = (distance - softZ) / (hardZ - softZ);
  return 1 - frac * (1 - floor);
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}
