import assert from 'node:assert/strict';
import test from 'node:test';

import {
  binaryLogLossContribution,
  brierContribution,
  brierSkillScore,
  calibrationSlopeIntercept,
  empiricalBaseRate,
  equalMassExpectedCalibrationError,
  evaluateForecastCohort,
  evaluateForecastReport,
  forecastLossAttribution,
  forecastCoverage,
  horizonBucket,
  meanBinaryLogLoss,
  meanBrierScore,
  pairedBootstrapMeanDifference,
  splitForecastRecordsChronologically,
  type EvaluationForecast,
} from '../forecast-evaluation.ts';
import type { PredictionRecord } from '../forecast-calibration.ts';

const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;

let sequence = 0;
function record(overrides: Partial<PredictionRecord> = {}): PredictionRecord {
  sequence += 1;
  return {
    id: `forecast-${sequence}`,
    sourceId: 'model-a',
    targetKey: `target-${sequence}`,
    domain: 'weather',
    claim: 'A test event occurs',
    probability: 0.7,
    predictedAt: 100,
    resolveBy: 100 + DAY,
    status: 'pending',
    algorithmVersion: 'v1',
    ...overrides,
  };
}

function resolved(
  probability: number,
  outcome: 0 | 1,
  overrides: Partial<PredictionRecord> = {},
): PredictionRecord {
  return record({
    probability,
    status: outcome === 1 ? 'resolved_true' : 'resolved_false',
    resolvedAt: overrides.resolveBy ?? 100 + DAY,
    ...overrides,
  });
}

function close(actual: number, expected: number, tolerance = 1e-6): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test('per-record Brier and clipped log-loss contributions match known answers', () => {
  close(brierContribution(0.8, 1), 0.04);
  close(brierContribution(0.8, 0), 0.64);
  close(binaryLogLossContribution(0.8, 1), -Math.log(0.8));
  close(binaryLogLossContribution(0.8, 0), -Math.log(0.2));

  const certainMiss = binaryLogLossContribution(1, 0, 1e-6);
  assert.ok(Number.isFinite(certainMiss));
  close(certainMiss, -Math.log(1e-6));
});

test('aggregate Brier and log loss return insufficient_evidence below their floor', () => {
  const forecasts: EvaluationForecast[] = [{ probability: 0.8, outcome: 1 }];
  assert.deepEqual(meanBrierScore(forecasts, 2), {
    status: 'insufficient_evidence',
    sampleSize: 1,
    minSampleSize: 2,
  });
  assert.deepEqual(meanBinaryLogLoss(forecasts, { minSamples: 2 }), {
    status: 'insufficient_evidence',
    sampleSize: 1,
    minSampleSize: 2,
  });
});

test('aggregate Brier, log loss, empirical base rate, and skill match known answers', () => {
  const evaluation: EvaluationForecast[] = [
    { probability: 0.9, outcome: 1 },
    { probability: 0.1, outcome: 0 },
  ];
  const training: EvaluationForecast[] = [
    { probability: 0.5, outcome: 1 },
    { probability: 0.5, outcome: 0 },
    { probability: 0.5, outcome: 0 },
    { probability: 0.5, outcome: 0 },
  ];

  const brier = meanBrierScore(evaluation, 2);
  const logLoss = meanBinaryLogLoss(evaluation, { minSamples: 2 });
  const baseRate = empiricalBaseRate(training, 2);
  assert.equal(brier.status, 'ok');
  assert.equal(logLoss.status, 'ok');
  assert.equal(baseRate.status, 'ok');
  if (brier.status !== 'ok' || logLoss.status !== 'ok' || baseRate.status !== 'ok') return;

  close(brier.value, 0.01);
  close(logLoss.value, -Math.log(0.9));
  close(baseRate.value, 0.25);

  const skill = brierSkillScore(evaluation, baseRate.value, 2);
  assert.equal(skill.status, 'ok');
  if (skill.status !== 'ok') return;
  close(skill.forecastBrier, 0.01);
  close(skill.baselineBrier, 0.3125);
  close(skill.value, 0.968);
});

test('Brier skill is insufficient when the baseline has zero error', () => {
  const skill = brierSkillScore([{ probability: 0, outcome: 0 }], 0, 1);
  assert.deepEqual(skill, {
    status: 'insufficient_evidence',
    sampleSize: 1,
    minSampleSize: 1,
    reason: 'zero_baseline_error',
  });
});

test('equal-mass ECE partitions by count and matches a hand-computed fixture', () => {
  const result = equalMassExpectedCalibrationError([
    { probability: 0.1, outcome: 0 },
    { probability: 0.2, outcome: 0 },
    { probability: 0.8, outcome: 1 },
    { probability: 0.9, outcome: 1 },
  ], { binCount: 2, minSamples: 4 });

  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  close(result.value, 0.15);
  assert.deepEqual(
    result.bins.map((bin) => ({
      count: bin.count,
      predictedMean: bin.predictedMean,
      observedFrequency: bin.observedFrequency,
    })),
    [
      { count: 2, predictedMean: 0.15, observedFrequency: 0 },
      { count: 2, predictedMean: 0.85, observedFrequency: 1 },
    ],
  );
});

test('calibration slope and intercept recover a calibrated synthetic cohort', () => {
  const forecasts: EvaluationForecast[] = [];
  for (const probability of [0.1, 0.2, 0.3, 0.4, 0.6, 0.7, 0.8, 0.9]) {
    const positives = Math.round(probability * 10);
    for (let i = 0; i < 10; i += 1) {
      forecasts.push({ probability, outcome: i < positives ? 1 : 0 });
    }
  }

  const fit = calibrationSlopeIntercept(forecasts, { minSamples: 50 });
  assert.equal(fit.status, 'ok');
  if (fit.status !== 'ok') return;
  close(fit.intercept, 0, 1e-5);
  close(fit.slope, 1, 1e-5);
  assert.equal(fit.converged, true);
});

test('calibration fit fails closed for small or degenerate cohorts', () => {
  assert.deepEqual(
    calibrationSlopeIntercept([{ probability: 0.8, outcome: 1 }], { minSamples: 2 }),
    {
      status: 'insufficient_evidence',
      sampleSize: 1,
      minSampleSize: 2,
      reason: 'sample_floor',
    },
  );

  const oneClass = Array.from({ length: 10 }, (_, index) => ({
    probability: (index + 1) / 12,
    outcome: 1 as const,
  }));
  assert.deepEqual(
    calibrationSlopeIntercept(oneClass, { minSamples: 10 }),
    {
      status: 'insufficient_evidence',
      sampleSize: 10,
      minSampleSize: 10,
      reason: 'degenerate_outcomes',
    },
  );
});

test('coverage reports resolved, expired, closed, and overdue shares', () => {
  const records = [
    resolved(0.8, 1, { resolveBy: 200, resolvedAt: 190 }),
    resolved(0.2, 0, { resolveBy: 200, resolvedAt: 195 }),
    record({ status: 'expired', resolveBy: 180, resolvedAt: 181 }),
    record({ status: 'pending', resolveBy: 150 }),
  ];
  assert.deepEqual(forecastCoverage(records, 200), {
    total: 4,
    resolved: 2,
    expired: 1,
    pending: 1,
    overduePending: 1,
    resolutionCoverage: 0.5,
    expirationRate: 0.25,
    closedCoverage: 0.75,
  });
  assert.equal(forecastCoverage(records).overduePending, null);
});

test('cohort evaluation excludes proxy outcomes by default and includes them explicitly', () => {
  const direct = resolved(0.9, 1, {
    predictedAt: 200,
    resolutionProvenance: {
      resolverId: 'direct-resolver',
      kind: 'direct',
      evidence: [],
    },
  });
  const proxy = resolved(0.9, 0, {
    predictedAt: 200,
    resolutionProvenance: {
      resolverId: 'proxy-resolver',
      kind: 'proxy',
      evidence: [],
    },
  });
  const training = [
    resolved(0.5, 1, { predictedAt: 100, resolvedAt: 150 }),
    resolved(0.5, 0, { predictedAt: 101, resolvedAt: 151 }),
  ];

  const safe = evaluateForecastCohort(
    { trainingRecords: training, evaluationRecords: [direct, proxy] },
    { minResolved: 1, minTrainingResolved: 1, minCalibrationFit: 2 },
  );
  assert.equal(safe.scoredRecords.length, 1);
  assert.equal(safe.exclusions.proxyLabels, 1);
  assert.equal(safe.brier.status, 'ok');
  if (safe.brier.status === 'ok') close(safe.brier.value, 0.01);

  const inclusive = evaluateForecastCohort(
    { trainingRecords: training, evaluationRecords: [direct, proxy] },
    {
      includeProxyLabels: true,
      minResolved: 1,
      minTrainingResolved: 1,
      minCalibrationFit: 2,
    },
  );
  assert.equal(inclusive.scoredRecords.length, 2);
  assert.equal(inclusive.exclusions.proxyLabels, 0);
  assert.equal(inclusive.brier.status, 'ok');
  if (inclusive.brier.status === 'ok') close(inclusive.brier.value, 0.41);
});

test('cohort baseline uses only records strictly before the evaluation window', () => {
  const training = [
    resolved(0.5, 0, { predictedAt: 50, resolvedAt: 75 }),
    resolved(0.5, 1, { predictedAt: 200, resolvedAt: 250 }),
  ];
  const evaluation = [resolved(0.8, 1, { predictedAt: 100 })];
  const result = evaluateForecastCohort(
    { trainingRecords: training, evaluationRecords: evaluation },
    { minResolved: 1, minTrainingResolved: 1, minCalibrationFit: 1 },
  );

  assert.equal(result.exclusions.trainingWindowOverlap, 1);
  assert.equal(result.baseRate.status, 'ok');
  if (result.baseRate.status === 'ok') assert.equal(result.baseRate.value, 0);
});

test('cohort baseline excludes outcomes that were not known before evaluation began', () => {
  const result = evaluateForecastCohort(
    {
      trainingRecords: [
        resolved(0.5, 0, { predictedAt: 25, resolvedAt: 75 }),
        resolved(0.5, 1, { predictedAt: 50, resolvedAt: 125 }),
        resolved(0.5, 1, { predictedAt: 60, resolvedAt: undefined }),
      ],
      evaluationRecords: [resolved(0.8, 1, { predictedAt: 100 })],
    },
    { minResolved: 1, minTrainingResolved: 1, minCalibrationFit: 1 },
  );

  assert.equal(result.exclusions.trainingWindowOverlap, 2);
  assert.equal(result.baseRate.status, 'ok');
  if (result.baseRate.status === 'ok') assert.equal(result.baseRate.value, 0);
});

test('cohort evaluation skips non-finite probabilities instead of emitting NaN', () => {
  const invalid = resolved(Number.NaN, 1, { predictedAt: 200 });
  const result = evaluateForecastCohort(
    {
      trainingRecords: [
        resolved(0.5, 1, { predictedAt: 100, resolvedAt: 150 }),
      ],
      evaluationRecords: [invalid],
    },
    { minResolved: 1, minTrainingResolved: 1, minCalibrationFit: 1 },
  );
  assert.equal(result.scoredRecords.length, 0);
  assert.equal(result.exclusions.invalidProbabilities, 1);
  assert.equal(result.brier.status, 'insufficient_evidence');
});

test('horizon buckets have stable, non-overlapping boundaries', () => {
  assert.equal(horizonBucket(0), '<1h');
  assert.equal(horizonBucket(HOUR - 1), '<1h');
  assert.equal(horizonBucket(HOUR), '1h-6h');
  assert.equal(horizonBucket(6 * HOUR), '6h-24h');
  assert.equal(horizonBucket(DAY), '1d-7d');
  assert.equal(horizonBucket(7 * DAY), '7d-30d');
  assert.equal(horizonBucket(30 * DAY), '30d+');
  assert.equal(horizonBucket(-1), 'invalid');
  assert.equal(horizonBucket(Number.NaN), 'invalid');
});

test('chronological forecast split is stable and keeps invalid timestamps out of training', () => {
  const records = [
    record({ id: 'same-b', predictedAt: 200 }),
    record({ id: 'invalid', predictedAt: Number.NaN }),
    record({ id: 'oldest', predictedAt: 100 }),
    record({ id: 'same-a', predictedAt: 200 }),
    record({ id: 'newest', predictedAt: 300 }),
  ];

  const split = splitForecastRecordsChronologically(records);

  assert.deepEqual(split.training.map((item) => item.id), [
    'oldest',
    'same-a',
    'same-b',
  ]);
  assert.deepEqual(split.evaluation.map((item) => item.id), [
    'newest',
    'invalid',
  ]);
  assert.deepEqual(
    splitForecastRecordsChronologically([records[0]!]),
    { training: [], evaluation: [records[0]!] },
  );
});

test('report groups evaluation cohorts by target, source, domain, horizon, and version', () => {
  const evaluation = [
    resolved(0.8, 1, {
      targetKey: 'storm-a',
      sourceId: 'model-a',
      domain: 'weather',
      algorithmVersion: 'v1',
      predictedAt: 200,
      resolveBy: 200 + 2 * HOUR,
    }),
    resolved(0.3, 0, {
      targetKey: 'conflict-b',
      sourceId: 'model-b',
      domain: 'conflict',
      algorithmVersion: 'v2',
      predictedAt: 200,
      resolveBy: 200 + 2 * DAY,
    }),
    resolved(0.6, 1, {
      targetKey: undefined,
      sourceId: 'model-a',
      domain: 'weather',
      algorithmVersion: undefined,
      predictedAt: 200,
      resolveBy: 200 + 40 * DAY,
    }),
  ];
  const training = evaluation.map((item, index) => ({
    ...item,
    id: `training-${index}`,
    predictedAt: 100 + index,
    resolveBy: item.resolveBy - 100,
    resolvedAt: 150 + index,
  }));
  const report = evaluateForecastReport(
    { trainingRecords: training, evaluationRecords: evaluation },
    { minResolved: 1, minTrainingResolved: 1, minCalibrationFit: 1 },
  );

  assert.deepEqual(report.groups.byTarget.map((group) => group.key), [
    'conflict-b',
    'storm-a',
    'unkeyed',
  ]);
  assert.deepEqual(report.groups.bySource.map((group) => group.key), [
    'model-a',
    'model-b',
  ]);
  assert.deepEqual(report.groups.byDomain.map((group) => group.key), [
    'weather',
    'conflict',
  ]);
  assert.deepEqual(report.groups.byHorizon.map((group) => group.key), [
    '1h-6h',
    '1d-7d',
    '30d+',
  ]);
  assert.deepEqual(report.groups.byAlgorithmVersion.map((group) => group.key), [
    'unversioned',
    'v1',
    'v2',
  ]);
});

test('Brier loss attribution ranks exact source, domain, horizon, and version contributors', () => {
  const evaluation = evaluateForecastCohort({
    trainingRecords: [
      resolved(0.5, 0, { predictedAt: 1, resolvedAt: 2 }),
      resolved(0.5, 1, { predictedAt: 2, resolvedAt: 3 }),
    ],
    evaluationRecords: [
      resolved(0.9, 0, {
        sourceId: 'model-bad',
        domain: 'weather',
        algorithmVersion: 'bad-v1',
        predictedAt: 10,
        resolveBy: 10 + 2 * HOUR,
      }),
      resolved(0.8, 1, {
        sourceId: 'model-good',
        domain: 'cyber',
        algorithmVersion: 'good-v1',
        predictedAt: 11,
        resolveBy: 11 + 2 * DAY,
      }),
      resolved(0.6, 0, {
        sourceId: 'model-bad',
        domain: 'weather',
        algorithmVersion: 'bad-v1',
        predictedAt: 12,
        resolveBy: 12 + 2 * HOUR,
      }),
    ],
  }, {
    minResolved: 1,
    minTrainingResolved: 1,
  });

  const attribution = forecastLossAttribution(evaluation.scoredRecords);

  assert.equal(attribution.sampleSize, 3);
  close(attribution.totalBrierLoss, 1.21);
  assert.equal(attribution.highConfidenceMisses, 1);
  assert.deepEqual(
    attribution.bySource.map((row) => ({
      key: row.key,
      sampleSize: row.sampleSize,
      highConfidenceMisses: row.highConfidenceMisses,
    })),
    [
      { key: 'model-bad', sampleSize: 2, highConfidenceMisses: 1 },
      { key: 'model-good', sampleSize: 1, highConfidenceMisses: 0 },
    ],
  );
  close(attribution.bySource[0]!.totalBrierLoss, 1.17);
  close(attribution.bySource[0]!.shareOfBrierLoss, 1.17 / 1.21);
  assert.deepEqual(attribution.byDomain.map((row) => row.key), [
    'weather',
    'cyber',
  ]);
  assert.deepEqual(attribution.byHorizon.map((row) => row.key), [
    '1h-6h',
    '1d-7d',
  ]);
  assert.deepEqual(attribution.byAlgorithmVersion.map((row) => row.key), [
    'bad-v1',
    'good-v1',
  ]);
});

test('paired bootstrap interval is seeded, repeatable, and uses challenger minus incumbent', () => {
  const pairs = [
    { incumbent: 0.25, challenger: 0.04 },
    { incumbent: 0.36, challenger: 0.09 },
    { incumbent: 0.16, challenger: 0.01 },
    { incumbent: 0.49, challenger: 0.25 },
    { incumbent: 0.09, challenger: 0.01 },
  ];
  const options = {
    seed: 42,
    iterations: 500,
    confidenceLevel: 0.9,
    minPairs: 5,
  };
  const first = pairedBootstrapMeanDifference(pairs, options);
  const second = pairedBootstrapMeanDifference(pairs, options);
  assert.deepEqual(first, second);
  assert.equal(first.status, 'ok');
  if (first.status !== 'ok') return;
  assert.ok(first.meanDifference < 0);
  assert.ok(first.upperBound < 0);
});

test('paired bootstrap returns insufficient_evidence below the pair floor', () => {
  assert.deepEqual(
    pairedBootstrapMeanDifference(
      [{ incumbent: 0.25, challenger: 0.04 }],
      { minPairs: 2, iterations: 100, seed: 7 },
    ),
    {
      status: 'insufficient_evidence',
      sampleSize: 1,
      minSampleSize: 2,
    },
  );
});
