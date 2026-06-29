/**
 * Momentum: rate-of-change, slope, and volatility over a time series.
 *
 * Point-in-time models score a fast spike and a slow climb identically.
 * Momentum captures the DERIVATIVE — a 5pt/day climb is worse than a 5pt
 * move spread over weeks — so downstream models can weight fast-moving
 * shocks higher. Pure: no DOM, no fetch, no globals. Fixture-testable.
 */

export interface TimeSample {
  /** epoch ms */
  t: number;
  /** numeric observation */
  v: number;
}

export interface SlopeResult {
  /** Least-squares slope in value-units per millisecond. */
  perMs: number;
  /** Same slope expressed per day (the human-facing unit). */
  perDay: number;
  /** Coefficient of determination 0..1 (how linear the trend is). */
  rSquared: number;
  /** Number of samples used. */
  n: number;
}

export type MomentumDirection = 'falling' | 'flat' | 'rising' | 'surging';

export interface MomentumResult {
  slopePerDay: number;
  /** Population std-dev of consecutive period-over-period changes. */
  volatility: number;
  /** 0..100 risk-oriented momentum magnitude (scaled by `riseScalePerDay`). */
  momentumScore: number;
  direction: MomentumDirection;
  /** 0..1 — low when too few samples or a noisy (low-R²) trend. */
  confidence: number;
  n: number;
}

const DAY_MS = 86_400_000;

/** Least-squares regression of v over t. Returns a zero slope for <2
 *  samples or when all timestamps coincide (degenerate, no trend). */
export function linearSlope(samples: readonly TimeSample[]): SlopeResult {
  const n = samples.length;
  if (n < 2) return { perMs: 0, perDay: 0, rSquared: 0, n };

  const meanT = mean(samples.map((s) => s.t));
  const meanV = mean(samples.map((s) => s.v));
  let sTT = 0;
  let sTV = 0;
  let sVV = 0;
  for (const s of samples) {
    const dt = s.t - meanT;
    const dv = s.v - meanV;
    sTT += dt * dt;
    sTV += dt * dv;
    sVV += dv * dv;
  }
  if (sTT === 0) return { perMs: 0, perDay: 0, rSquared: 0, n };
  const perMs = sTV / sTT;
  const rSquared = sVV === 0 ? 1 : clamp01((sTV * sTV) / (sTT * sVV));
  return { perMs, perDay: perMs * DAY_MS, rSquared, n };
}

/** Population std-dev of consecutive value changes (period-over-period). */
export function volatility(samples: readonly TimeSample[]): number {
  if (samples.length < 2) return 0;
  const ordered = [...samples].sort((a, b) => a.t - b.t);
  const deltas: number[] = [];
  for (let i = 1; i < ordered.length; i += 1) deltas.push(ordered[i]!.v - ordered[i - 1]!.v);
  const m = mean(deltas);
  const variance = mean(deltas.map((d) => (d - m) ** 2));
  return Math.sqrt(variance);
}

export interface MomentumOptions {
  /** Slope-per-day magnitude that maps to a momentumScore of 100. Default 10. */
  riseScalePerDay?: number;
  /** |slopePerDay| below this reads as 'flat'. Default 0.5. */
  flatBand?: number;
  /** |slopePerDay| at/above this reads as 'surging'/'falling-fast'. Default = riseScalePerDay. */
  surgeThresholdPerDay?: number;
  /** Minimum samples for full confidence. Default 6. */
  minSamples?: number;
}

export function computeMomentum(samples: readonly TimeSample[], options: MomentumOptions = {}): MomentumResult {
  const riseScale = options.riseScalePerDay ?? 10;
  const flatBand = options.flatBand ?? 0.5;
  const surge = options.surgeThresholdPerDay ?? riseScale;
  const minSamples = options.minSamples ?? 6;

  const ordered = [...samples].sort((a, b) => a.t - b.t);
  const slope = linearSlope(ordered);
  const vol = volatility(ordered);
  const momentumScore = clamp(0, 100, (Math.abs(slope.perDay) / Math.max(riseScale, 1e-9)) * 100);

  let direction: MomentumDirection;
  if (Math.abs(slope.perDay) < flatBand) direction = 'flat';
  else if (slope.perDay >= surge) direction = 'surging';
  else if (slope.perDay > 0) direction = 'rising';
  else direction = 'falling';

  // Confidence rises with sample count and trend linearity (R²).
  const sampleConf = clamp01(slope.n / minSamples);
  const confidence = clamp01(0.4 * sampleConf + 0.6 * sampleConf * slope.rSquared);

  return { slopePerDay: slope.perDay, volatility: vol, momentumScore, direction, confidence, n: slope.n };
}

function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function clamp(lo: number, hi: number, x: number): number {
  return Math.min(hi, Math.max(lo, x));
}
