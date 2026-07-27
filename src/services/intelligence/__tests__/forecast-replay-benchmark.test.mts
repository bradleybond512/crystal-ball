import assert from 'node:assert/strict';
import test from 'node:test';

import committedBaseline from '../__bench__/forecast-replay-baseline.json' with { type: 'json' };
import { FORECAST_REPLAY_CORPUS } from '../__bench__/forecast-replay-corpus.ts';
import {
  compareForecastReplayToBaseline,
  runForecastReplayBenchmark,
  type ForecastReplayBaseline,
  type ForecastReplayFixture,
} from '../forecast-replay-benchmark.ts';

const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;

function fixture(
  sequence: number,
  overrides: Partial<ForecastReplayFixture> = {},
): ForecastReplayFixture {
  const predictedAt = sequence * DAY;
  return {
    id: `fixture-${sequence}`,
    sourceId: 'analyst-loop',
    domain: 'weather',
    probability: sequence % 2 === 0 ? 0.8 : 0.2,
    predictedAt,
    resolveBy: predictedAt + DAY,
    status: sequence % 2 === 0 ? 'resolved_true' : 'resolved_false',
    resolvedAt: predictedAt + HOUR,
    labelOrigin: 'direct',
    algorithmVersion: 'analyst-v1',
    ...overrides,
  };
}

test('walk-forward replay is chronological and excludes outcomes unavailable at each cutoff', () => {
  const fixtures = Array.from({ length: 8 }, (_, index) => fixture(index + 1));
  fixtures[1] = fixture(2, { resolvedAt: 5 * DAY });
  fixtures[3] = fixture(4, { resolvedAt: 8 * DAY });
  fixtures.reverse();

  const report = runForecastReplayBenchmark(fixtures, {
    initialTrainingRecords: 4,
    evaluationWindowRecords: 2,
    minTrainingResolved: 2,
  });

  assert.equal(report.strategy, 'expanding_window');
  assert.deepEqual(
    report.folds.map((fold) => ({
      evaluationWindowStart: fold.evaluationWindowStart,
      trainingRecords: fold.trainingRecords,
      trainingResolved: fold.trainingResolved,
      evaluationRecords: fold.evaluationRecords,
    })),
    [
      {
        evaluationWindowStart: 5 * DAY,
        trainingRecords: 4,
        trainingResolved: 2,
        evaluationRecords: 2,
      },
      {
        evaluationWindowStart: 7 * DAY,
        trainingRecords: 6,
        trainingResolved: 5,
        evaluationRecords: 2,
      },
    ],
  );
});

test('replay excludes proxy labels and reports loss by source, domain, horizon, and version', () => {
  const fixtures = Array.from({ length: 12 }, (_, index) => fixture(index + 1));
  fixtures[8] = fixture(9, {
    sourceId: 'weather-model',
    domain: 'weather',
    algorithmVersion: 'weather-v2',
    probability: 0.95,
    status: 'resolved_false',
    resolveBy: 9 * DAY + 2 * HOUR,
  });
  fixtures[9] = fixture(10, {
    sourceId: 'weather-model',
    domain: 'weather',
    algorithmVersion: 'weather-v2',
    probability: 0.95,
    status: 'resolved_false',
    resolveBy: 10 * DAY + 2 * HOUR,
  });
  fixtures[10] = fixture(11, {
    sourceId: 'conflict-model',
    domain: 'conflict',
    algorithmVersion: 'conflict-v1',
    resolveBy: 11 * DAY + 10 * DAY,
    labelOrigin: 'proxy',
  });
  fixtures[11] = fixture(12, {
    sourceId: 'conflict-model',
    domain: 'conflict',
    algorithmVersion: 'conflict-v1',
    resolveBy: 12 * DAY + 10 * DAY,
  });

  const report = runForecastReplayBenchmark(fixtures, {
    initialTrainingRecords: 8,
    evaluationWindowRecords: 4,
    minTrainingResolved: 2,
  });

  assert.equal(report.overall.evaluationRecords, 4);
  assert.equal(report.overall.scored, 3);
  assert.equal(report.overall.proxyLabelsExcluded, 1);
  assert.equal(report.overall.highConfidenceMisses, 2);
  assert.deepEqual(
    report.groups.bySource.map((row) => row.key),
    ['weather-model', 'conflict-model'],
  );
  assert.deepEqual(
    report.groups.byDomain.map((row) => row.key),
    ['weather', 'conflict'],
  );
  assert.deepEqual(
    report.groups.byHorizon.map((row) => row.key),
    ['1h-6h', '7d-30d'],
  );
  assert.deepEqual(
    report.groups.byAlgorithmVersion.map((row) => row.key),
    ['weather-v2', 'conflict-v1'],
  );
  assert.ok(report.groups.bySource[0]!.shareOfBrierLoss > 0.95);
});

test('forecast replay regression gate covers every required metric', () => {
  const baseline: ForecastReplayBaseline = {
    schemaVersion: 1,
    corpusId: 'gate-fixture',
    recordCount: 10,
    metrics: {
      brierSkill: 0.1,
      logLoss: 0.5,
      resolutionCoverage: 0.9,
      highConfidenceMisses: 1,
    },
    tolerances: {
      brierSkillDrop: 0.01,
      logLossIncrease: 0.01,
      resolutionCoverageDrop: 0.01,
      highConfidenceMissIncrease: 0,
    },
  };
  const report = {
    ...runForecastReplayBenchmark(
      Array.from({ length: 10 }, (_, index) => fixture(index + 1)),
      {
        corpusId: 'gate-fixture',
        initialTrainingRecords: 6,
        evaluationWindowRecords: 4,
        minTrainingResolved: 2,
      },
    ),
    overall: {
      ...runForecastReplayBenchmark(
        Array.from({ length: 10 }, (_, index) => fixture(index + 1)),
        {
          corpusId: 'gate-fixture',
          initialTrainingRecords: 6,
          evaluationWindowRecords: 4,
          minTrainingResolved: 2,
        },
      ).overall,
      brierSkill: 0.08,
      logLoss: 0.52,
      resolutionCoverage: 0.88,
      highConfidenceMisses: 2,
    },
  };

  const comparison = compareForecastReplayToBaseline(report, baseline);

  assert.equal(comparison.ok, false);
  assert.deepEqual(
    comparison.regressions.map((regression) => regression.metric),
    [
      'brierSkill',
      'logLoss',
      'resolutionCoverage',
      'highConfidenceMisses',
    ],
  );
});

test('committed replay corpus is privacy-safe and matches its reviewed baseline', () => {
  const serialized = JSON.stringify(FORECAST_REPLAY_CORPUS);
  assert.doesNotMatch(
    serialized,
    /claim|targetKey|criteria|resolutionNote|provenance|evidence|latitude|longitude/,
  );

  const report = runForecastReplayBenchmark(FORECAST_REPLAY_CORPUS);
  const comparison = compareForecastReplayToBaseline(
    report,
    committedBaseline as ForecastReplayBaseline,
  );

  assert.equal(
    comparison.ok,
    true,
    comparison.regressions.map((regression) => regression.message).join('\n'),
  );
  assert.ok(report.folds.length >= 3);
  assert.ok(report.groups.bySource.length >= 2);
  assert.ok(report.groups.byDomain.length >= 3);
  assert.ok(report.overall.scored >= 40);
});
