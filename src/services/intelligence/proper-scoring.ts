/**
 * Proper scoring rules — the measurement-spine math the
 * CRYSTAL_BALL_OVERHAUL_ROADMAP.md Wave 1.5 ("scoring module") and Wave 4
 * (reliability diagrams + ECE) call for.
 *
 * `forecast-calibration.ts` already records predictions, resolves them, and
 * computes a binary Brier score over `PredictionRecord[]`. This module is the
 * record-agnostic *math layer* underneath that: proper scoring rules that
 * reward honest uncertainty and punish overconfidence, plus the calibration
 * diagnostics (reliability bins, Expected/Maximum Calibration Error) and the
 * continuous-forecast score (CRPS) that the binary Brier path cannot express.
 *
 * Why CRPS matters here: a Brier score only grades a yes/no claim. A forecast
 * like "CPA in 18 min ±5" or "wheat price +8% ± a spread" is *continuous*, and
 * the proper way to score it — rewarding a tight, well-placed predictive
 * distribution and penalising both bias and overconfident spread — is the
 * Continuous Ranked Probability Score. It generalises absolute error to a full
 * predictive distribution and reduces to it for a point forecast.
 *
 * Pure deterministic. No DOM, no fetch, no globals. Every function is a total
 * function of its inputs so the replay harness can score offline against
 * static fixtures.
 *
 * Invariants honored (per the four foundation-layer rules):
 *   - proper rules only (Brier, CRPS) — strictly proper, so honest probability
 *     is the score-minimising strategy;
 *   - degenerate inputs (empty sets, zero spread) return a defined value, never
 *     NaN, so a sparse track record never poisons a dashboard;
 *   - all aggregates are explainable (counts + decomposition exposed).
 */

import type { PredictionRecord } from './forecast-calibration';

// ── Binary forecasts (Brier family) ──────────────────────────────────────

/** A single probabilistic binary forecast paired with its realized outcome. */
export interface BinaryForecast {
  /** Forecast probability the event occurs, in 0..1. */
  probability: number;
  /** Realized outcome: true/1 if the event happened, false/0 otherwise. */
  outcome: boolean | 0 | 1;
}

export interface BrierResult {
  /** Mean quadratic Brier score in 0..1. 0 = perfect, 0.25 = fair coin,
   *  1 = confidently wrong every time. Lower is better. */
  score: number;
  /** Number of forecasts that contributed. */
  count: number;
}

/** Mean Brier score over a set of binary forecasts. Empty → 0. */
export function brierScore(forecasts: readonly BinaryForecast[]): BrierResult {
  let sum = 0;
  let n = 0;
  for (const f of forecasts) {
    const p = clamp01(f.probability);
    const o = outcomeBit(f.outcome);
    sum += (p - o) ** 2;
    n += 1;
  }
  if (n === 0) return { score: 0, count: 0 };
  return { score: round4(sum / n), count: n };
}

/**
 * Murphy (1973) decomposition of the Brier score into
 * `reliability − resolution + uncertainty`. This is what turns a single
 * number into something an operator can act on:
 *   - reliability (lower better): how far predicted probabilities sit from the
 *     observed frequency in their bin — i.e. miscalibration;
 *   - resolution (higher better): how much the forecasts separate high- from
 *     low-frequency regimes — i.e. discrimination;
 *   - uncertainty: the base-rate variance p̄(1−p̄), a property of the events,
 *     not the forecaster — the irreducible floor.
 *
 * Identity (up to binning granularity): score ≈ reliability − resolution +
 * uncertainty. `binCount` controls the granularity (default 10).
 */
export interface BrierDecomposition extends BrierResult {
  reliability: number;
  resolution: number;
  uncertainty: number;
  /** Base rate p̄ = fraction of outcomes that were 1. */
  baseRate: number;
}

export function brierDecomposition(
  forecasts: readonly BinaryForecast[],
  binCount = 10,
): BrierDecomposition {
  const base = brierScore(forecasts);
  if (base.count === 0) {
    return { ...base, reliability: 0, resolution: 0, uncertainty: 0, baseRate: 0 };
  }
  const n = base.count;
  const baseRate = forecasts.reduce((s, f) => s + outcomeBit(f.outcome), 0) / n;
  const bins = reliabilityBins(forecasts, binCount);
  let reliability = 0;
  let resolution = 0;
  for (const b of bins) {
    if (b.count === 0) continue;
    const w = b.count / n;
    reliability += w * (b.predictedMean - b.observedFrequency) ** 2;
    resolution += w * (b.observedFrequency - baseRate) ** 2;
  }
  return {
    score: base.score,
    count: n,
    reliability: round4(reliability),
    resolution: round4(resolution),
    uncertainty: round4(baseRate * (1 - baseRate)),
    baseRate: round4(baseRate),
  };
}

// ── Reliability diagram + calibration error ──────────────────────────────

export interface ReliabilityBin {
  /** Lower edge of the probability bin, inclusive. */
  lowerEdge: number;
  /** Upper edge of the probability bin, exclusive (inclusive on the last bin). */
  upperEdge: number;
  /** Number of forecasts that landed in this bin. */
  count: number;
  /** Mean forecast probability among this bin's members (0 when empty). */
  predictedMean: number;
  /** Observed frequency of outcome=1 among this bin's members (0 when empty). */
  observedFrequency: number;
}

/**
 * Bucket forecasts into `binCount` equal-width probability bins and report the
 * predicted-vs-observed frequency per bin — the raw material for a reliability
 * diagram. A perfectly calibrated forecaster has predictedMean ≈
 * observedFrequency in every populated bin (the diagonal).
 */
export function reliabilityBins(
  forecasts: readonly BinaryForecast[],
  binCount = 10,
): ReliabilityBin[] {
  const bins = Math.max(1, Math.floor(binCount));
  const width = 1 / bins;
  const acc = Array.from({ length: bins }, (_, i) => ({
    lowerEdge: round4(i * width),
    upperEdge: round4((i + 1) * width),
    count: 0,
    probSum: 0,
    outcomeSum: 0,
  }));
  for (const f of forecasts) {
    const p = clamp01(f.probability);
    // p === 1 falls into the last bin rather than overflowing.
    const idx = Math.min(bins - 1, Math.floor(p / width));
    const bin = acc[idx]!;
    bin.count += 1;
    bin.probSum += p;
    bin.outcomeSum += outcomeBit(f.outcome);
  }
  return acc.map((b) => ({
    lowerEdge: b.lowerEdge,
    upperEdge: b.upperEdge,
    count: b.count,
    predictedMean: b.count === 0 ? 0 : round4(b.probSum / b.count),
    observedFrequency: b.count === 0 ? 0 : round4(b.outcomeSum / b.count),
  }));
}

export interface CalibrationError {
  /** Expected Calibration Error: count-weighted mean |predicted − observed|
   *  across populated bins. 0 = perfectly calibrated. */
  ece: number;
  /** Maximum Calibration Error: worst single-bin gap. Surfaces a localized
   *  miscalibration that ECE's averaging can hide. */
  mce: number;
  count: number;
}

/** Expected + Maximum Calibration Error over a reliability binning. */
export function calibrationError(
  forecasts: readonly BinaryForecast[],
  binCount = 10,
): CalibrationError {
  const bins = reliabilityBins(forecasts, binCount);
  const total = bins.reduce((s, b) => s + b.count, 0);
  if (total === 0) return { ece: 0, mce: 0, count: 0 };
  let ece = 0;
  let mce = 0;
  for (const b of bins) {
    if (b.count === 0) continue;
    const gap = Math.abs(b.predictedMean - b.observedFrequency);
    ece += (b.count / total) * gap;
    if (gap > mce) mce = gap;
  }
  return { ece: round4(ece), mce: round4(mce), count: total };
}

// ── Continuous Ranked Probability Score (CRPS) ───────────────────────────

/**
 * Closed-form CRPS for a Gaussian predictive distribution N(mean, sd) against a
 * scalar observation. Use this when a forecast is summarised as a mean and a
 * standard deviation (e.g. a Kalman/EWMA state estimate, a "time-to-event 18min
 * ±5" prediction). Lower is better; in the same units as the observation.
 *
 * CRPS(N(μ,σ), y) = σ · [ z(2Φ(z) − 1) + 2φ(z) − 1/√π ], where z = (y − μ)/σ,
 * Φ/φ the standard-normal CDF/PDF. With sd = 0 this degenerates to |y − μ|.
 */
export function crpsGaussian(mean: number, sd: number, observation: number): number {
  // A non-finite observation is unscoreable — return 0 rather than propagate
  // NaN, honoring the module's "never NaN" invariant. Aggregators below skip
  // such rows entirely so a 0 can never masquerade as a perfect score.
  if (!Number.isFinite(observation) || !Number.isFinite(mean)) return 0;
  const sigma = Math.abs(sd);
  if (sigma === 0 || !Number.isFinite(sigma)) {
    return round4(Math.abs(observation - mean));
  }
  const z = (observation - mean) / sigma;
  const value = sigma * (z * (2 * standardNormalCdf(z) - 1) + 2 * standardNormalPdf(z) - INV_SQRT_PI);
  return round4(value);
}

/**
 * Empirical CRPS from an ensemble / sample set against a scalar observation.
 * Use this when the predictive distribution is represented as a bag of samples
 * (multimodal hypothesis fans, particle sets) rather than a parametric form.
 *
 * Estimator: CRPS = mean_i|xᵢ − y| − ½·mean_{i,j}|xᵢ − xⱼ|. A single sample
 * reduces to |x − y| (the second term is 0). Lower is better, same units as y.
 */
export function crpsEnsemble(samples: readonly number[], observation: number): number {
  if (!Number.isFinite(observation)) return 0;
  const xs = samples.filter((x) => Number.isFinite(x));
  const m = xs.length;
  if (m === 0) return 0;
  if (m === 1) return round4(Math.abs(xs[0]! - observation));
  let absToObs = 0;
  for (const x of xs) absToObs += Math.abs(x - observation);
  absToObs /= m;
  let pairwise = 0;
  for (let i = 0; i < m; i += 1) {
    for (let j = 0; j < m; j += 1) {
      pairwise += Math.abs(xs[i]! - xs[j]!);
    }
  }
  pairwise /= m * m;
  return round4(absToObs - 0.5 * pairwise);
}

export interface CrpsResult {
  /** Mean CRPS across the scored forecasts (same units as the observations). */
  meanCrps: number;
  count: number;
}

/** A Gaussian predictive forecast paired with its realized observation. */
export interface GaussianForecast {
  mean: number;
  sd: number;
  observation: number;
}

/** Mean CRPS over a set of Gaussian predictive forecasts. Rows with a
 *  non-finite mean/sd/observation are unscoreable and skipped, so `count`
 *  reflects only scored forecasts and one bad row can't poison the mean.
 *  Empty (or all-unscoreable) → 0. */
export function meanCrpsGaussian(forecasts: readonly GaussianForecast[]): CrpsResult {
  const scoreable = forecasts.filter(
    (f) => Number.isFinite(f.mean) && Number.isFinite(f.sd) && Number.isFinite(f.observation),
  );
  if (scoreable.length === 0) return { meanCrps: 0, count: 0 };
  let sum = 0;
  for (const f of scoreable) sum += crpsGaussian(f.mean, f.sd, f.observation);
  return { meanCrps: round4(sum / scoreable.length), count: scoreable.length };
}

// ── Reliability diagram with Wilson bands + equal-mass binning (Wave 4a) ──
//
// Calibration estimates are themselves uncertain: a bin with 3 samples says
// little. Two upgrades over the plain `reliabilityBins` histogram:
//   - Wilson score intervals on each bin's observed frequency, so a renderer
//     can draw honest confidence bands and an operator can tell "miscalibrated"
//     from "too few samples to know";
//   - equal-mass (adaptive) binning, which puts an equal *count* in each bin —
//     far more robust than equal-width when predictions cluster (e.g. most
//     forecasts near 0 or 1).

export interface ReliabilityPoint extends ReliabilityBin {
  /** Wilson lower bound on the observed frequency (0..1). */
  ciLow: number;
  /** Wilson upper bound on the observed frequency (0..1). */
  ciHigh: number;
}

export type BinningMode = 'equal-width' | 'equal-mass';

export interface ReliabilityDiagramOptions {
  binCount?: number;
  mode?: BinningMode;
  /** z for the Wilson interval. Default 1.96 (95%). */
  z?: number;
}

/**
 * Reliability diagram with Wilson confidence bands. `equal-width` mirrors
 * `reliabilityBins` (fixed [0,1] bins); `equal-mass` partitions the sorted
 * forecasts into `binCount` groups of near-equal count. Empty bins are dropped
 * in equal-mass mode (they carry no data); equal-width keeps the fixed grid.
 */
export function reliabilityDiagram(
  forecasts: readonly BinaryForecast[],
  options: ReliabilityDiagramOptions = {},
): ReliabilityPoint[] {
  const binCount = Math.max(1, Math.floor(options.binCount ?? 10));
  const z = options.z ?? 1.96;
  const mode = options.mode ?? 'equal-width';

  if (mode === 'equal-mass') {
    return equalMassPoints(forecasts, binCount, z);
  }
  return reliabilityBins(forecasts, binCount).map((b) => {
    const successes = Math.round(b.observedFrequency * b.count);
    const ci = wilsonInterval(successes, b.count, z);
    return { ...b, ciLow: ci.low, ciHigh: ci.high };
  });
}

function equalMassPoints(
  forecasts: readonly BinaryForecast[],
  binCount: number,
  z: number,
): ReliabilityPoint[] {
  const sorted = forecasts
    .map((f) => ({ p: clamp01(f.probability), o: outcomeBit(f.outcome) }))
    .sort((a, b) => a.p - b.p);
  const n = sorted.length;
  if (n === 0) return [];
  const points: ReliabilityPoint[] = [];
  for (let i = 0; i < binCount; i += 1) {
    const start = Math.floor((i * n) / binCount);
    const end = Math.floor(((i + 1) * n) / binCount);
    if (end <= start) continue;
    const slice = sorted.slice(start, end);
    const count = slice.length;
    const successes = slice.reduce((s, r) => s + r.o, 0);
    const probSum = slice.reduce((s, r) => s + r.p, 0);
    const ci = wilsonInterval(successes, count, z);
    points.push({
      lowerEdge: round4(slice[0]!.p),
      upperEdge: round4(slice[count - 1]!.p),
      count,
      predictedMean: round4(probSum / count),
      observedFrequency: round4(successes / count),
      ciLow: ci.low,
      ciHigh: ci.high,
    });
  }
  return points;
}

/** Wilson score interval for a binomial proportion `successes/n`. n=0 → [0,1]
 *  (maximal ignorance). Clamped to [0,1]. */
export function wilsonInterval(
  successes: number,
  n: number,
  z = 1.96,
): { low: number; high: number } {
  if (n <= 0) return { low: 0, high: 1 };
  const phat = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (phat + z2 / (2 * n)) / denom;
  const margin = (z / denom) * Math.sqrt((phat * (1 - phat)) / n + z2 / (4 * n * n));
  return {
    low: round4(Math.max(0, center - margin)),
    high: round4(Math.min(1, center + margin)),
  };
}

// ── PIT calibration for continuous forecasts (Wave 4a) ────────────────────
//
// Reliability diagrams calibrate *binary* forecasts. The continuous analogue
// is the Probability Integral Transform: if a predictive CDF F is calibrated,
// then F(y) — the predicted CDF at the realized value — is Uniform[0,1] across
// forecasts. Deviations diagnose the failure mode:
//   - U-shaped (mass at 0 and 1)  → overconfident (intervals too narrow);
//   - dome-shaped (mass in middle) → underconfident (intervals too wide);
//   - sloped                       → biased (systematically high/low).

export interface GaussianMixtureComponent {
  weight: number;
  mean: number;
  sd: number;
}

/** Closed-form CDF of a Gaussian mixture at `y`. Weights are normalized
 *  defensively; an sd=0 component acts as a step (point mass) at its mean. */
export function gaussianMixtureCdf(
  components: readonly GaussianMixtureComponent[],
  y: number,
): number {
  let wSum = 0;
  for (const c of components) wSum += Math.max(0, c.weight);
  if (wSum <= 0) return 0;
  let cdf = 0;
  for (const c of components) {
    const w = Math.max(0, c.weight) / wSum;
    if (w === 0) continue;
    const sigma = Math.abs(c.sd);
    cdf += w * (sigma === 0 ? (y >= c.mean ? 1 : 0) : standardNormalCdf((y - c.mean) / sigma));
  }
  return clamp01(cdf);
}

/** PIT value F(y) for one continuous forecast given as a Gaussian mixture. */
export function pitValue(
  components: readonly GaussianMixtureComponent[],
  observation: number,
): number {
  return gaussianMixtureCdf(components, observation);
}

export type PitShape = 'uniform' | 'overconfident' | 'underconfident' | 'biased' | 'insufficient_data';

export interface PitDiagnostic {
  count: number;
  /** Equal-width [0,1] histogram of the PIT values. */
  histogram: number[];
  /** Kolmogorov–Smirnov statistic vs Uniform[0,1]. 0 = perfectly uniform. */
  ksStat: number;
  shape: PitShape;
  summary: string;
}

/**
 * Diagnose calibration of continuous forecasts from their PIT values. Pass the
 * collected `F(y)` values (e.g. from `pitValue`). `minForShape` (default 10)
 * gates the shape verdict on having enough data.
 */
export function pitDiagnostic(
  pitValues: readonly number[],
  binCount = 10,
  minForShape = 10,
): PitDiagnostic {
  const vals = pitValues.filter((v) => Number.isFinite(v)).map((v) => clamp01(v));
  const n = vals.length;
  const bins = Math.max(1, Math.floor(binCount));
  const histogram = Array.from({ length: bins }, () => 0);
  for (const v of vals) {
    const idx = Math.min(bins - 1, Math.floor(v * bins));
    histogram[idx] += 1;
  }
  if (n < minForShape) {
    return {
      count: n,
      histogram,
      ksStat: 0,
      shape: 'insufficient_data',
      summary: `Only ${n} PIT value(s) — need ${minForShape} to diagnose continuous calibration.`,
    };
  }

  // KS statistic vs U[0,1].
  const sorted = [...vals].sort((a, b) => a - b);
  let ks = 0;
  for (let i = 0; i < n; i += 1) {
    const u = sorted[i]!;
    ks = Math.max(ks, Math.abs((i + 1) / n - u), Math.abs(u - i / n));
  }

  const shape = classifyPitShape(histogram, n);
  return { count: n, histogram, ksStat: round4(ks), shape, summary: summarizePit(shape, round4(ks)) };
}

function classifyPitShape(histogram: readonly number[], n: number): PitShape {
  const bins = histogram.length;
  if (bins < 3) return 'uniform';
  const expected = n / bins;
  const third = Math.max(1, Math.floor(bins / 3));
  const edges = histogram.slice(0, third).reduce((s, c) => s + c, 0) +
    histogram.slice(bins - third).reduce((s, c) => s + c, 0);
  const middle = histogram.slice(third, bins - third).reduce((s, c) => s + c, 0);
  const edgesExpected = expected * 2 * third;
  const middleExpected = expected * (bins - 2 * third);
  const leftMass = histogram.slice(0, Math.floor(bins / 2)).reduce((s, c) => s + c, 0);
  const rightMass = n - leftMass;

  // 20% relative deviations flag a shape; otherwise uniform.
  if (edges > edgesExpected * 1.2 && middle < middleExpected * 0.9) return 'overconfident';
  if (middle > middleExpected * 1.2 && edges < edgesExpected * 0.9) return 'underconfident';
  if (Math.abs(leftMass - rightMass) > n * 0.2) return 'biased';
  return 'uniform';
}

function summarizePit(shape: PitShape, ks: number): string {
  switch (shape) {
    case 'overconfident':
      return `Overconfident — PIT is U-shaped (KS ${ks}); predictive intervals are too narrow.`;
    case 'underconfident':
      return `Underconfident — PIT is dome-shaped (KS ${ks}); predictive intervals are too wide.`;
    case 'biased':
      return `Biased — PIT mass is skewed to one side (KS ${ks}); forecasts run systematically high or low.`;
    case 'uniform':
      return `Well-calibrated — PIT is approximately uniform (KS ${ks}).`;
    default:
      return 'Insufficient data to diagnose continuous calibration.';
  }
}

// ── Adapters from the existing prediction ledger ─────────────────────────

/**
 * Project the resolved rows of a `forecast-calibration` ledger into the
 * binary-forecast shape this module scores. `pending`/`expired` rows carry no
 * ground truth and are skipped, so the result is exactly the evaluable set.
 */
export function binaryForecastsFromRecords(
  records: readonly PredictionRecord[],
): BinaryForecast[] {
  const out: BinaryForecast[] = [];
  for (const r of records) {
    if (r.status === 'resolved_true') out.push({ probability: r.probability, outcome: 1 });
    else if (r.status === 'resolved_false') out.push({ probability: r.probability, outcome: 0 });
  }
  return out;
}

/** Calibration error computed directly over a prediction ledger. */
export function calibrationErrorFromRecords(
  records: readonly PredictionRecord[],
  binCount = 10,
): CalibrationError {
  return calibrationError(binaryForecastsFromRecords(records), binCount);
}

/** Reliability diagram computed directly over a prediction ledger. */
export function reliabilityBinsFromRecords(
  records: readonly PredictionRecord[],
  binCount = 10,
): ReliabilityBin[] {
  return reliabilityBins(binaryForecastsFromRecords(records), binCount);
}

// ── Standard-normal helpers ──────────────────────────────────────────────

const INV_SQRT_PI = 1 / Math.sqrt(Math.PI);
const INV_SQRT_2PI = 1 / Math.sqrt(2 * Math.PI);

function standardNormalPdf(x: number): number {
  return INV_SQRT_2PI * Math.exp(-0.5 * x * x);
}

/** Φ(x) via the Abramowitz & Stegun 7.1.26 erf approximation (|ε| ≤ 1.5e-7). */
function standardNormalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/* eslint-disable unicorn/numeric-separators-style -- Abramowitz & Stegun 7.1.26
   fitted erf coefficients; digit separators would imply a grouping these
   constants do not have. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}
/* eslint-enable unicorn/numeric-separators-style */

// ── Local helpers ─────────────────────────────────────────────────────────

function outcomeBit(outcome: boolean | 0 | 1): 0 | 1 {
  return outcome === true || outcome === 1 ? 1 : 0;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function round4(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}
