import assert from 'node:assert/strict';
import test from 'node:test';

import {
  brierScore,
  brierDecomposition,
  reliabilityBins,
  calibrationError,
  crpsGaussian,
  crpsEnsemble,
  meanCrpsGaussian,
  binaryForecastsFromRecords,
  calibrationErrorFromRecords,
  reliabilityBinsFromRecords,
  reliabilityDiagram,
  wilsonInterval,
  gaussianMixtureCdf,
  pitValue,
  pitDiagnostic,
} from '../proper-scoring.ts';
import type { BinaryForecast } from '../proper-scoring.ts';
import type { PredictionRecord } from '../forecast-calibration.ts';

const close = (a: number, b: number, eps = 1e-3): boolean => Math.abs(a - b) <= eps;

// ── Brier score ───────────────────────────────────────────────────────────

test('brierScore: empty set returns 0/0 rather than NaN', () => {
  assert.deepEqual(brierScore([]), { score: 0, count: 0 });
});

test('brierScore: perfect confident forecasts score 0', () => {
  const fs: BinaryForecast[] = [
    { probability: 1, outcome: 1 },
    { probability: 0, outcome: 0 },
  ];
  assert.equal(brierScore(fs).score, 0);
});

test('brierScore: confidently wrong scores 1', () => {
  assert.equal(brierScore([{ probability: 1, outcome: 0 }]).score, 1);
});

test('brierScore: fair-coin guess on a 50/50 set is 0.25', () => {
  const fs: BinaryForecast[] = [
    { probability: 0.5, outcome: 1 },
    { probability: 0.5, outcome: 0 },
  ];
  assert.equal(brierScore(fs).score, 0.25);
});

test('brierScore: honest probability beats overconfidence (strictly proper)', () => {
  // Event happens 70% of the time. An honest 0.7 must score better than a
  // overconfident 0.95 over the same realized outcomes.
  const outcomes = [1, 1, 1, 1, 1, 1, 1, 0, 0, 0] as const;
  const honest = brierScore(outcomes.map((o) => ({ probability: 0.7, outcome: o }))).score;
  const overconfident = brierScore(outcomes.map((o) => ({ probability: 0.95, outcome: o }))).score;
  assert.ok(honest < overconfident, `honest ${honest} should beat overconfident ${overconfident}`);
});

test('brierScore: clamps out-of-range probabilities into 0..1', () => {
  assert.equal(brierScore([{ probability: 1.4, outcome: 1 }]).score, 0);
  assert.equal(brierScore([{ probability: -0.3, outcome: 0 }]).score, 0);
});

// ── Brier decomposition ────────────────────────────────────────────────────

test('brierDecomposition: identity score ≈ reliability − resolution + uncertainty', () => {
  const fs: BinaryForecast[] = [
    { probability: 0.1, outcome: 0 },
    { probability: 0.1, outcome: 0 },
    { probability: 0.4, outcome: 1 },
    { probability: 0.6, outcome: 0 },
    { probability: 0.9, outcome: 1 },
    { probability: 0.9, outcome: 1 },
  ];
  const d = brierDecomposition(fs);
  assert.ok(close(d.score, d.reliability - d.resolution + d.uncertainty), 'Murphy identity holds');
});

test('brierDecomposition: a perfectly calibrated forecaster has ~0 reliability', () => {
  // Two bins, observed frequency exactly matches the predicted probability.
  const fs: BinaryForecast[] = [
    { probability: 0.5, outcome: 1 },
    { probability: 0.5, outcome: 0 },
    { probability: 0.9, outcome: 1 },
    { probability: 0.9, outcome: 1 },
    { probability: 0.9, outcome: 1 },
    { probability: 0.9, outcome: 1 },
    { probability: 0.9, outcome: 1 },
    { probability: 0.9, outcome: 1 },
    { probability: 0.9, outcome: 1 },
    { probability: 0.9, outcome: 1 },
    { probability: 0.9, outcome: 1 },
    { probability: 0.9, outcome: 0 },
  ];
  assert.ok(brierDecomposition(fs).reliability < 0.01);
});

test('brierDecomposition: empty set is all zeros', () => {
  const d = brierDecomposition([]);
  assert.deepEqual(
    { s: d.score, r: d.reliability, res: d.resolution, u: d.uncertainty, c: d.count },
    { s: 0, r: 0, res: 0, u: 0, c: 0 },
  );
});

// ── Reliability bins ───────────────────────────────────────────────────────

test('reliabilityBins: assigns forecasts to the correct bin and edges', () => {
  const bins = reliabilityBins([{ probability: 0.05, outcome: 1 }], 10);
  assert.equal(bins.length, 10);
  assert.equal(bins[0]!.count, 1);
  assert.equal(bins[0]!.lowerEdge, 0);
  assert.equal(bins[0]!.upperEdge, 0.1);
  assert.equal(bins[0]!.predictedMean, 0.05);
  assert.equal(bins[0]!.observedFrequency, 1);
});

test('reliabilityBins: probability of exactly 1 lands in the last bin', () => {
  const bins = reliabilityBins([{ probability: 1, outcome: 1 }], 10);
  assert.equal(bins[9]!.count, 1);
  assert.equal(bins[0]!.count, 0);
});

// ── Calibration error ──────────────────────────────────────────────────────

test('calibrationError: well-calibrated forecaster has near-zero ECE', () => {
  // Bin [0.7,0.8): predict 0.75, 4-of-... outcomes ~ 0.75.
  const fs: BinaryForecast[] = [
    { probability: 0.75, outcome: 1 },
    { probability: 0.75, outcome: 1 },
    { probability: 0.75, outcome: 1 },
    { probability: 0.75, outcome: 0 },
  ];
  const ce = calibrationError(fs);
  assert.ok(ce.ece <= 0.01, `ece ${ce.ece}`);
  assert.equal(ce.count, 4);
});

test('calibrationError: overconfident forecaster has large ECE and MCE', () => {
  // Predicts 0.95 but the event only happens half the time → ~0.45 gap.
  const fs: BinaryForecast[] = [
    { probability: 0.95, outcome: 1 },
    { probability: 0.95, outcome: 0 },
  ];
  const ce = calibrationError(fs);
  assert.ok(ce.ece > 0.4, `ece ${ce.ece}`);
  assert.ok(close(ce.mce, ce.ece), 'single populated bin: MCE equals ECE');
});

test('calibrationError: empty set returns zeros', () => {
  assert.deepEqual(calibrationError([]), { ece: 0, mce: 0, count: 0 });
});

// ── CRPS (Gaussian) ────────────────────────────────────────────────────────

test('crpsGaussian: sd=0 degenerates to absolute error', () => {
  assert.equal(crpsGaussian(10, 0, 13), 3);
});

test('crpsGaussian: observation at the mean equals σ(√2−1)/√π', () => {
  // CRPS(N(μ,σ), μ) = σ(2φ(0) − 1/√π) = σ(√2 − 1)/√π.
  const sigma = 2;
  const expected = (sigma * (Math.SQRT2 - 1)) / Math.sqrt(Math.PI);
  assert.ok(close(crpsGaussian(0, sigma, 0), expected), `${crpsGaussian(0, sigma, 0)} vs ${expected}`);
});

test('crpsGaussian: tighter well-placed distribution beats a wider one', () => {
  const tight = crpsGaussian(0, 1, 0);
  const wide = crpsGaussian(0, 5, 0);
  assert.ok(tight < wide, `tight ${tight} should beat wide ${wide}`);
});

test('crpsGaussian: a biased forecast is penalised', () => {
  const onTarget = crpsGaussian(0, 1, 0);
  const biased = crpsGaussian(0, 1, 4);
  assert.ok(biased > onTarget);
});

test('meanCrpsGaussian: averages and counts; empty → 0', () => {
  assert.deepEqual(meanCrpsGaussian([]), { meanCrps: 0, count: 0 });
  const r = meanCrpsGaussian([
    { mean: 10, sd: 0, observation: 12 },
    { mean: 10, sd: 0, observation: 8 },
  ]);
  assert.equal(r.count, 2);
  assert.equal(r.meanCrps, 2);
});

// ── CRPS (ensemble) ────────────────────────────────────────────────────────

test('crpsEnsemble: single sample reduces to absolute error', () => {
  assert.equal(crpsEnsemble([7], 10), 3);
});

test('crpsEnsemble: empty sample set returns 0', () => {
  assert.equal(crpsEnsemble([], 10), 0);
});

test('crpsEnsemble: tight ensemble on target beats a dispersed one', () => {
  const tight = crpsEnsemble([9.9, 10, 10.1], 10);
  const dispersed = crpsEnsemble([0, 10, 20], 10);
  assert.ok(tight < dispersed, `tight ${tight} should beat dispersed ${dispersed}`);
});

test('crpsEnsemble: bimodal ensemble straddling the truth is rewarded over a confident miss', () => {
  // 50/50 "goes left or right" with the truth between beats a confident wrong blob.
  const straddle = crpsEnsemble([-5, -5, 5, 5], 0);
  const confidentMiss = crpsEnsemble([-5, -5, -5, -5], 0);
  assert.ok(straddle < confidentMiss);
});

// ── Ledger adapters ────────────────────────────────────────────────────────

function rec(overrides: Partial<PredictionRecord>): PredictionRecord {
  return {
    id: 'p',
    sourceId: 's',
    domain: 'macro',
    claim: 'c',
    probability: 0.7,
    predictedAt: 0,
    resolveBy: 1,
    status: 'pending',
    ...overrides,
  };
}

test('binaryForecastsFromRecords: keeps only resolved rows', () => {
  const fs = binaryForecastsFromRecords([
    rec({ id: 'a', status: 'resolved_true', probability: 0.8 }),
    rec({ id: 'b', status: 'resolved_false', probability: 0.2 }),
    rec({ id: 'c', status: 'pending' }),
    rec({ id: 'd', status: 'expired' }),
  ]);
  assert.equal(fs.length, 2);
  assert.deepEqual(fs[0], { probability: 0.8, outcome: 1 });
  assert.deepEqual(fs[1], { probability: 0.2, outcome: 0 });
});

// ── CRPS non-finite guards (review hardening) ───────────────────────────────

test('crpsGaussian: non-finite observation is unscoreable → 0, never NaN', () => {
  assert.equal(crpsGaussian(0, 1, Number.NaN), 0);
  assert.equal(crpsGaussian(0, 1, Number.POSITIVE_INFINITY), 0);
});

test('crpsEnsemble: non-finite observation → 0', () => {
  assert.equal(crpsEnsemble([1, 2, 3], Number.NaN), 0);
});

test('meanCrpsGaussian: skips non-finite rows so one bad row cannot poison the mean', () => {
  const r = meanCrpsGaussian([
    { mean: 10, sd: 0, observation: 12 },
    { mean: 10, sd: 0, observation: Number.NaN }, // skipped
    { mean: 10, sd: 0, observation: 8 },
  ]);
  assert.equal(r.count, 2);
  assert.equal(r.meanCrps, 2);
  assert.ok(Number.isFinite(r.meanCrps));
});

// ── Wilson interval + reliability diagram ────────────────────────────────────

test('wilsonInterval: n=0 → maximal ignorance [0,1]', () => {
  assert.deepEqual(wilsonInterval(0, 0), { low: 0, high: 1 });
});

test('wilsonInterval: brackets the point estimate and tightens with n', () => {
  const small = wilsonInterval(3, 4);
  const large = wilsonInterval(75, 100);
  assert.ok(small.low < 0.75 && small.high > 0.75);
  assert.ok(large.high - large.low < small.high - small.low, 'more data → tighter band');
});

test('reliabilityDiagram equal-width: adds Wilson bands bracketing observed freq', () => {
  const fs: BinaryForecast[] = [
    { probability: 0.75, outcome: 1 },
    { probability: 0.75, outcome: 1 },
    { probability: 0.75, outcome: 1 },
    { probability: 0.75, outcome: 0 },
  ];
  const pts = reliabilityDiagram(fs, { binCount: 10, mode: 'equal-width' });
  const bin = pts.find((p) => p.count > 0)!;
  assert.equal(bin.count, 4);
  assert.ok(bin.ciLow <= bin.observedFrequency && bin.ciHigh >= bin.observedFrequency);
});

test('reliabilityDiagram equal-mass: equal counts per bin, empties dropped', () => {
  // 9 forecasts clustered, 3 equal-mass bins → 3 each.
  const fs: BinaryForecast[] = [
    { probability: 0.01, outcome: 0 }, { probability: 0.02, outcome: 0 }, { probability: 0.03, outcome: 0 },
    { probability: 0.5, outcome: 1 }, { probability: 0.5, outcome: 0 }, { probability: 0.51, outcome: 1 },
    { probability: 0.98, outcome: 1 }, { probability: 0.99, outcome: 1 }, { probability: 1, outcome: 1 },
  ];
  const pts = reliabilityDiagram(fs, { binCount: 3, mode: 'equal-mass' });
  assert.equal(pts.length, 3);
  assert.deepEqual(pts.map((p) => p.count), [3, 3, 3]);
});

// ── PIT (continuous calibration) ─────────────────────────────────────────────

test('gaussianMixtureCdf: single Gaussian matches Φ; sd=0 is a step', () => {
  assert.ok(Math.abs(gaussianMixtureCdf([{ weight: 1, mean: 0, sd: 1 }], 0) - 0.5) < 1e-6);
  assert.equal(gaussianMixtureCdf([{ weight: 1, mean: 5, sd: 0 }], 4), 0);
  assert.equal(gaussianMixtureCdf([{ weight: 1, mean: 5, sd: 0 }], 6), 1);
});

test('gaussianMixtureCdf: normalizes weights defensively', () => {
  // Unnormalized weights (sum 4) should still yield a valid CDF in [0,1].
  const v = gaussianMixtureCdf([{ weight: 3, mean: 0, sd: 1 }, { weight: 1, mean: 0, sd: 1 }], 0);
  assert.ok(Math.abs(v - 0.5) < 1e-6);
});

test('pitValue: equals F(y) for the predictive distribution', () => {
  assert.ok(Math.abs(pitValue([{ weight: 1, mean: 10, sd: 2 }], 10) - 0.5) < 1e-6);
});

test('pitDiagnostic: well-calibrated → approximately uniform, low KS', () => {
  // PIT values evenly spread across [0,1].
  const vals = Array.from({ length: 20 }, (_, i) => (i + 0.5) / 20);
  const d = pitDiagnostic(vals, 10);
  assert.equal(d.shape, 'uniform');
  assert.ok(d.ksStat < 0.1, `ks ${d.ksStat}`);
});

test('pitDiagnostic: U-shaped PIT → overconfident (intervals too narrow)', () => {
  // Mass piled at 0 and 1.
  const vals = [
    ...Array.from({ length: 10 }, () => 0.02),
    ...Array.from({ length: 10 }, () => 0.98),
  ];
  assert.equal(pitDiagnostic(vals, 10).shape, 'overconfident');
});

test('pitDiagnostic: dome-shaped PIT → underconfident (intervals too wide)', () => {
  const vals = Array.from({ length: 20 }, () => 0.5);
  assert.equal(pitDiagnostic(vals, 10).shape, 'underconfident');
});

test('pitDiagnostic: too few values → insufficient_data', () => {
  assert.equal(pitDiagnostic([0.1, 0.9], 10).shape, 'insufficient_data');
});

test('calibrationErrorFromRecords + reliabilityBinsFromRecords run end-to-end on a ledger', () => {
  const records = [
    rec({ id: 'a', status: 'resolved_true', probability: 0.75 }),
    rec({ id: 'b', status: 'resolved_true', probability: 0.75 }),
    rec({ id: 'c', status: 'resolved_true', probability: 0.75 }),
    rec({ id: 'd', status: 'resolved_false', probability: 0.75 }),
    rec({ id: 'e', status: 'pending', probability: 0.99 }),
  ];
  const ce = calibrationErrorFromRecords(records);
  assert.equal(ce.count, 4); // pending row excluded
  assert.ok(ce.ece <= 0.01);
  const bins = reliabilityBinsFromRecords(records);
  assert.equal(bins[7]!.count, 4); // [0.7,0.8) bin
});
