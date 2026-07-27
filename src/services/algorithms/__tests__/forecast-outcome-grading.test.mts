import assert from 'node:assert/strict';
import test from 'node:test';

import { createAlgorithmEvaluationLedger } from '../algorithm-evaluation-ledger.ts';
import {
  ensureForecastEvaluation,
  gradeForecastOutcome,
  syncForecastEvaluations,
} from '../forecast-outcome-grading.ts';
import type { PredictionRecord } from '../../intelligence/forecast-calibration.ts';

const NOW = 1_800_000_000_000;

function prediction(overrides: Partial<PredictionRecord> = {}): PredictionRecord {
  return {
    id: 'hyp:private-prediction-id',
    sourceId: 'analyst-loop',
    targetKey: 'hypothesis:private-target',
    domain: 'conflict',
    claim: 'A bounded fixture event occurs',
    probability: 0.8,
    predictedAt: NOW - 60_000,
    resolveBy: NOW + 60_000,
    status: 'pending',
    algorithmVersion: '2.0.0',
    ...overrides,
  };
}

test('ensureForecastEvaluation links the exact target, horizon, and emitted version', () => {
  const ledger = createAlgorithmEvaluationLedger();
  const record = ensureForecastEvaluation(prediction(), ledger);

  assert.ok(record);
  assert.equal(record.algorithmId, 'analyst-loop');
  assert.equal(record.version, '2.0.0');
  assert.equal(record.at, NOW - 60_000);
  assert.equal(record.score, 0.8);
  assert.deepEqual(record.forecastTarget, {
    predictionId: 'hyp:private-prediction-id',
    targetKey: 'hypothesis:private-target',
    predictedAt: NOW - 60_000,
    resolveBy: NOW + 60_000,
  });
  assert.equal(record.inputHash, undefined);
  assert.doesNotMatch(record.id, /private/);
  assert.equal(ensureForecastEvaluation(prediction(), ledger)?.id, record.id);
  assert.equal(ledger.all().length, 1);
});

test('gradeForecastOutcome records direct authoritative evidence and correctness', () => {
  const ledger = createAlgorithmEvaluationLedger();
  const resolvedAt = NOW + 30_000;
  const record = gradeForecastOutcome(prediction({
    status: 'resolved_true',
    resolvedAt,
    resolutionNote: 'direct:market_move threshold observed',
    resolutionProvenance: {
      resolverId: 'market-move-v1',
      kind: 'direct',
      evidence: [{
        sourceIds: ['provider-a'],
        observedAt: resolvedAt,
        reference: 'sensitive-provider-reference',
      }],
    },
  }), ledger);

  assert.ok(record);
  assert.equal(record.outcome, 'hit');
  assert.equal(record.outcomeAt, resolvedAt);
  assert.equal(record.outcomeOrigin, 'direct');
  assert.equal(record.outcomeReference, 'market-move-v1');
  assert.doesNotMatch(JSON.stringify(record), /sensitive-provider-reference/);
});

test('gradeForecastOutcome records proxy misses separately', () => {
  const ledger = createAlgorithmEvaluationLedger();
  const record = gradeForecastOutcome(prediction({
    probability: 0.7,
    status: 'resolved_false',
    resolvedAt: NOW,
    resolutionProvenance: {
      resolverId: 'event-occurrence-v1',
      kind: 'proxy',
      evidence: [],
    },
  }), ledger);

  assert.equal(record?.outcome, 'miss');
  assert.equal(record?.outcomeOrigin, 'proxy');
});

test('structured grading skips forecasts without a target or version', () => {
  const ledger = createAlgorithmEvaluationLedger();

  assert.equal(ensureForecastEvaluation(prediction({ targetKey: undefined }), ledger), null);
  assert.equal(ensureForecastEvaluation(prediction({ algorithmVersion: undefined }), ledger), null);
  assert.equal(ledger.all().length, 0);
});

test('structured grading skips unknown forecast sources', () => {
  const ledger = createAlgorithmEvaluationLedger();
  assert.equal(
    ensureForecastEvaluation(prediction({ sourceId: 'unregistered-provider-model' }), ledger),
    null,
  );
  assert.equal(ledger.all().length, 0);
});

test('a prediction id cannot be relinked to a different target, horizon, or version', () => {
  const ledger = createAlgorithmEvaluationLedger();
  assert.ok(ensureForecastEvaluation(prediction(), ledger));

  assert.equal(gradeForecastOutcome(prediction({
    targetKey: 'hypothesis:different',
    status: 'resolved_true',
    resolvedAt: NOW,
  }), ledger), null);
  assert.equal(gradeForecastOutcome(prediction({
    resolveBy: NOW + 120_000,
    status: 'resolved_true',
    resolvedAt: NOW,
  }), ledger), null);
  assert.equal(gradeForecastOutcome(prediction({
    algorithmVersion: '3.0.0',
    status: 'resolved_true',
    resolvedAt: NOW,
  }), ledger), null);
  assert.equal(ledger.all().length, 1);
  assert.equal(ledger.graded().length, 0);
});

test('syncForecastEvaluations links pending forecasts and grades resolved forecasts once', () => {
  const ledger = createAlgorithmEvaluationLedger();
  const result = syncForecastEvaluations([
    prediction({ id: 'pending' }),
    prediction({
      id: 'resolved',
      status: 'resolved_false',
      resolvedAt: NOW,
      probability: 0.2,
    }),
  ], ledger);

  assert.deepEqual(result, {
    eligible: 2,
    linked: 2,
    graded: 1,
    alreadyLinked: 0,
    alreadyGraded: 0,
  });
  assert.equal(ledger.all().length, 2);
  assert.equal(ledger.graded().length, 1);

  assert.deepEqual(syncForecastEvaluations([
    prediction({ id: 'pending' }),
    prediction({
      id: 'resolved',
      status: 'resolved_false',
      resolvedAt: NOW,
      probability: 0.2,
    }),
  ], ledger), {
    eligible: 2,
    linked: 0,
    graded: 0,
    alreadyLinked: 2,
    alreadyGraded: 1,
  });
});

test('source adapters cover the production forecast bridges', () => {
  const ledger = createAlgorithmEvaluationLedger();
  const rows = [
    prediction({ id: 'analyst', sourceId: 'analyst-loop' }),
    prediction({ id: 'superforecast', sourceId: 'superforecast' }),
    prediction({ id: 'weather', sourceId: 'nws-warning', algorithmVersion: '1.0.0' }),
    prediction({ id: 'mode', sourceId: 'mode-forecast:security', algorithmVersion: '1.0.0' }),
    prediction({ id: 'shortage', sourceId: 'shortage:wheat', algorithmVersion: '1.0.0' }),
  ];

  const result = syncForecastEvaluations(rows, ledger);
  assert.equal(result.eligible, rows.length);
  assert.deepEqual(
    ledger.all().map((record) => record.algorithmId).sort(),
    ['analyst-loop', 'mode-forecast', 'shortage-wheat', 'superforecast', 'warning-verification'],
  );
});
