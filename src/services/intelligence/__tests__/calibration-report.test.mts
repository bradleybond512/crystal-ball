import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCalibrationReport } from '../calibration-report.ts';
import type { PredictionRecord } from '../forecast-calibration.ts';

let seq = 0;
function rec(overrides: Partial<PredictionRecord>): PredictionRecord {
  seq += 1;
  return {
    id: `p-${seq}`,
    sourceId: 'model-a',
    domain: 'macro',
    claim: 'c',
    probability: 0.7,
    predictedAt: 0,
    resolveBy: 1,
    status: 'pending',
    ...overrides,
  };
}

/** n predictions at probability p, of which `trues` resolve true. */
function batch(p: number, n: number, trues: number, extra: Partial<PredictionRecord> = {}): PredictionRecord[] {
  const out: PredictionRecord[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push(rec({ probability: p, status: i < trues ? 'resolved_true' : 'resolved_false', ...extra }));
  }
  return out;
}

test('insufficient data: too few resolved → insufficient_data verdict', () => {
  const r = buildCalibrationReport([rec({ status: 'resolved_true' })], { minResolvedForVerdict: 10 });
  assert.equal(r.assessment.verdict, 'insufficient_data');
  assert.equal(r.resolvedCount, 1);
});

test('pending/expired rows are excluded from the resolved set', () => {
  const records = [
    ...batch(0.5, 5, 3),
    rec({ status: 'pending' }),
    rec({ status: 'expired' }),
  ];
  const r = buildCalibrationReport(records, { minResolvedForVerdict: 3 });
  assert.equal(r.totalRecords, 7);
  assert.equal(r.resolvedCount, 5);
});

test('well-calibrated: predicted ≈ observed across bins → well_calibrated, ~0 bias', () => {
  // 0.7 bin resolves true 7/10; 0.3 bin resolves true 3/10.
  const records = [...batch(0.7, 10, 7), ...batch(0.3, 10, 3)];
  const r = buildCalibrationReport(records, { minResolvedForVerdict: 10 });
  assert.equal(r.assessment.verdict, 'well_calibrated');
  assert.ok(Math.abs(r.assessment.signedBias) <= 0.05, `bias ${r.assessment.signedBias}`);
});

test('overconfident: predicts 0.9 but only half resolve true → positive bias', () => {
  const records = batch(0.9, 20, 10);
  const r = buildCalibrationReport(records, { minResolvedForVerdict: 10 });
  assert.equal(r.assessment.verdict, 'overconfident');
  assert.ok(r.assessment.signedBias > 0.05);
  assert.ok(r.assessment.summary.toLowerCase().includes('overconfident'));
  // worst band should be the 0.9 bin.
  assert.equal(r.assessment.worstBand?.lowerEdge, 0.9);
});

test('underconfident: predicts 0.2 but most resolve true → negative bias', () => {
  const records = batch(0.2, 20, 16);
  const r = buildCalibrationReport(records, { minResolvedForVerdict: 10 });
  assert.equal(r.assessment.verdict, 'underconfident');
  assert.ok(r.assessment.signedBias < -0.05);
});

test('per-domain rollup: each domain assessed independently, sorted worst-ECE first', () => {
  const records = [
    ...batch(0.9, 20, 10, { domain: 'cyber' }),   // overconfident, high ECE
    ...batch(0.7, 20, 14, { domain: 'weather' }),  // well-calibrated, low ECE
  ];
  const r = buildCalibrationReport(records, { minResolvedForVerdict: 10 });
  assert.equal(r.byDomain.length, 2);
  assert.equal(r.byDomain[0]!.key, 'cyber'); // worst ECE first
  assert.equal(r.byDomain[0]!.assessment.verdict, 'overconfident');
  assert.equal(r.byDomain[1]!.key, 'weather');
  assert.equal(r.byDomain[1]!.assessment.verdict, 'well_calibrated');
});

test('per-source rollup keys on sourceId', () => {
  const records = [
    ...batch(0.8, 12, 6, { sourceId: 'noisy-model' }),
    ...batch(0.8, 12, 10, { sourceId: 'good-model' }),
  ];
  const r = buildCalibrationReport(records, { minResolvedForVerdict: 10 });
  const keys = r.bySource.map((g) => g.key).sort();
  assert.deepEqual(keys, ['good-model', 'noisy-model']);
});

test('Brier decomposition + calibration error are populated on the report', () => {
  const records = [...batch(0.7, 10, 7), ...batch(0.3, 10, 3)];
  const r = buildCalibrationReport(records);
  assert.equal(r.brier.count, 20);
  assert.equal(r.calibration.count, 20);
  assert.equal(r.reliability.length, 10);
  // Murphy identity sanity.
  assert.ok(Math.abs(r.brier.score - (r.brier.reliability - r.brier.resolution + r.brier.uncertainty)) < 1e-3);
});

test('optional CRPS rollup folds in when Gaussian forecasts supplied', () => {
  const records = batch(0.7, 10, 7);
  const r = buildCalibrationReport(records, {
    gaussianForecasts: [
      { mean: 10, sd: 0, observation: 12 },
      { mean: 10, sd: 0, observation: 8 },
    ],
  });
  assert.ok(r.crps);
  assert.equal(r.crps!.count, 2);
  assert.equal(r.crps!.meanCrps, 2);
});

test('optional PIT diagnostic folds in when PIT values supplied', () => {
  const records = batch(0.7, 10, 7);
  // Evenly-spread PIT values → uniform / well-calibrated continuous side.
  const pitValues = Array.from({ length: 20 }, (_, i) => (i + 0.5) / 20);
  const r = buildCalibrationReport(records, { pitValues });
  assert.ok(r.pit);
  assert.equal(r.pit!.shape, 'uniform');
  assert.equal(r.pit!.count, 20);
});

test('empty ledger: no crash, insufficient_data, zero counts', () => {
  const r = buildCalibrationReport([]);
  assert.equal(r.totalRecords, 0);
  assert.equal(r.resolvedCount, 0);
  assert.equal(r.assessment.verdict, 'insufficient_data');
  assert.equal(r.byDomain.length, 0);
  assert.equal(r.crps, undefined);
});
