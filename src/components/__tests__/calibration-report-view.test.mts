import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCalibrationReport,
  buildDomainReportCard,
  buildForecastWorkbench,
  createForecastWorkbenchState,
} from '../calibration-report-view.ts';
import type { ReliabilityCurve } from '@/services/cognition/recalibration';
import type { CalibrationComparison } from '@/services/cognition/forecast-journal';
import type { PredictionRecord } from '@/services/intelligence/forecast-calibration';

const curve: ReliabilityCurve = {
  domain: 'global',
  bins: [
    { lo: 0, hi: 0.1, n: 20, predictedMean: 0.08, observedRate: 0.08 },
    { lo: 0.9, hi: 1, n: 10, predictedMean: 0.92, observedRate: 0.7 },
  ],
  sampleSize: 30,
  brier: 0.12,
  generatedAt: 0,
};

test('summarizes a reliability curve into bin rows + a headline', () => {
  const view = buildCalibrationReport({ curve, coveragePct: 80, comparison: null });
  assert.equal(view.rows.length, 2);
  assert.deepEqual(view.rows[0], { predicted: 0.08, observed: 0.08, count: 20 });
  assert.deepEqual(view.rows[1], { predicted: 0.92, observed: 0.7, count: 10 });
  assert.ok(view.headline.includes('80%'));
  assert.equal(view.hasOperatorData, false);
  assert.equal(view.operatorLine, undefined);
});

test('includes operator-vs-system when comparison present with data', () => {
  const comparison: CalibrationComparison = {
    domain: 'global',
    operator: { brier: 0.15, n: 40, curve },
    system: { brier: 0.18, n: 40, curve },
    humanEdge: 0.03,
    explanation: 'Operator outperforms system in global',
  };
  const view = buildCalibrationReport({ curve, coveragePct: 80, comparison });
  assert.equal(view.hasOperatorData, true);
  assert.ok(view.operatorLine);
  assert.ok(view.operatorLine!.includes('operator'));
  assert.ok(view.operatorLine!.includes('0.15'));
  assert.ok(view.operatorLine!.includes('0.18'));
});

test('comparison with n=0 does not count as operator data', () => {
  const comparison: CalibrationComparison = {
    domain: 'global',
    operator: { brier: 0, n: 0, curve },
    system: { brier: 0.18, n: 40, curve },
    humanEdge: null,
    explanation: 'Insufficient data',
  };
  const view = buildCalibrationReport({ curve, coveragePct: 80, comparison });
  assert.equal(view.hasOperatorData, false);
  assert.equal(view.operatorLine, undefined);
});

test('comparison null yields hasOperatorData false', () => {
  const view = buildCalibrationReport({ curve, coveragePct: 50, comparison: null });
  assert.equal(view.hasOperatorData, false);
});

// ── buildDomainReportCard (Prediction Uplift PR A3) ─────────────────────────

function fakeRecord(over: Partial<PredictionRecord> = {}): PredictionRecord {
  return {
    id: `p${Math.random()}`,
    sourceId: 'test',
    domain: 'weather',
    claim: 'test claim',
    probability: 0.7,
    predictedAt: 0,
    resolveBy: 1000,
    status: 'pending',
    ...over,
  };
}

test('groups records by domain into one row per domain', () => {
  const records = [
    fakeRecord({ domain: 'weather' }),
    fakeRecord({ domain: 'weather' }),
    fakeRecord({ domain: 'markets' }),
  ];
  const card = buildDomainReportCard(records);
  assert.equal(card.rows.length, 2);
  const domains = card.rows.map((r) => r.domain).sort();
  assert.deepEqual(domains, ['markets', 'weather']);
});

test('total counts every record; resolved counts only resolved_true/resolved_false', () => {
  const records = [
    fakeRecord({ domain: 'cyber', status: 'resolved_true', probability: 0.9 }),
    fakeRecord({ domain: 'cyber', status: 'resolved_false', probability: 0.2 }),
    fakeRecord({ domain: 'cyber', status: 'pending' }),
    fakeRecord({ domain: 'cyber', status: 'expired' }),
  ];
  const card = buildDomainReportCard(records);
  const row = card.rows.find((r) => r.domain === 'cyber')!;
  assert.equal(row.total, 4);
  assert.equal(row.resolved, 2);
});

test('brier is null when fewer than 5 resolved predictions', () => {
  const records = [
    fakeRecord({ domain: 'conflict', status: 'resolved_true', probability: 0.9 }),
    fakeRecord({ domain: 'conflict', status: 'resolved_false', probability: 0.1 }),
    fakeRecord({ domain: 'conflict', status: 'pending' }),
  ];
  const card = buildDomainReportCard(records);
  const row = card.rows.find((r) => r.domain === 'conflict')!;
  assert.equal(row.resolved, 2);
  assert.equal(row.brier, null);
});

test('brier is computed and rounded to 4dp once resolved reaches 5', () => {
  const records = [
    fakeRecord({ domain: 'markets', status: 'resolved_true', probability: 0.9 }),
    fakeRecord({ domain: 'markets', status: 'resolved_true', probability: 0.8 }),
    fakeRecord({ domain: 'markets', status: 'resolved_false', probability: 0.2 }),
    fakeRecord({ domain: 'markets', status: 'resolved_false', probability: 0.3 }),
    fakeRecord({ domain: 'markets', status: 'resolved_true', probability: 0.6 }),
  ];
  const card = buildDomainReportCard(records);
  const row = card.rows.find((r) => r.domain === 'markets')!;
  assert.equal(row.resolved, 5);
  assert.ok(row.brier !== null);
  // ((0.9-1)^2 + (0.8-1)^2 + (0.2-0)^2 + (0.3-0)^2 + (0.6-1)^2) / 5
  const expected = ((0.1 ** 2) + (0.2 ** 2) + (0.2 ** 2) + (0.3 ** 2) + (0.4 ** 2)) / 5;
  assert.equal(row.brier, Math.round(expected * 10_000) / 10_000);
  assert.equal(row.brier, Math.round((row.brier as number) * 10_000) / 10_000, 'idempotent under 4dp rounding');
});

test('rows sort by resolved count descending', () => {
  const records = [
    fakeRecord({ domain: 'macro', status: 'resolved_true' }),
    fakeRecord({ domain: 'infra', status: 'resolved_true' }),
    fakeRecord({ domain: 'infra', status: 'resolved_true' }),
    fakeRecord({ domain: 'infra', status: 'resolved_false' }),
  ];
  const card = buildDomainReportCard(records);
  assert.deepEqual(card.rows.map((r) => r.domain), ['infra', 'macro']);
});

// ── Per-forecast workbench (ACC-202) ───────────────────────────────────────

const HOUR = 60 * 60 * 1_000;

function resolvedRecord(
  overrides: Partial<PredictionRecord> = {},
): PredictionRecord {
  return fakeRecord({
    id: 'resolved',
    targetKey: 'target:test',
    probability: 0.8,
    predictedAt: 100,
    resolveBy: 100 + HOUR,
    status: 'resolved_true',
    resolvedAt: 1_000,
    resolutionNote: 'direct: confirmed by observation',
    resolutionProvenance: {
      resolverId: 'test-resolver',
      kind: 'direct',
      evidence: [{
        sourceIds: ['test'],
        observedAt: 750,
        reference: 'observation:test',
      }],
    },
    algorithmVersion: 'v1',
    ...overrides,
  });
}

test('forecast workbench rows expose audit fields and classify resolution methods', () => {
  const view = buildForecastWorkbench([
    resolvedRecord({
      id: 'direct',
      probability: 0.8,
      status: 'resolved_false',
      targetKey: 'target:direct',
    }),
    resolvedRecord({
      id: 'proxy',
      resolutionNote: 'proxy: inferred from a nearby signal',
      resolutionProvenance: {
        resolverId: 'proxy-resolver',
        kind: 'proxy',
        evidence: [{ sourceIds: ['proxy'], observedAt: 700 }],
      },
    }),
    resolvedRecord({
      id: 'manual',
      resolutionNote: 'Operator confirmed the outcome',
      resolutionProvenance: undefined,
    }),
    fakeRecord({ id: 'pending', targetKey: 'target:pending' }),
  ]);

  const direct = view.rows.find((row) => row.id === 'direct')!;
  assert.equal(direct.target, 'target:direct');
  assert.equal(direct.outcome, 0);
  assert.ok(Math.abs((direct.brierContribution ?? 0) - 0.64) < 1e-12);
  assert.equal(direct.evidenceAgeMs, 250);
  assert.equal(direct.resolutionMethod, 'direct');
  assert.equal(direct.resolutionNote, 'direct: confirmed by observation');
  assert.equal(direct.excludedFromMetrics, true);
  assert.equal(direct.metricExclusionReason, 'training');

  assert.equal(view.rows.find((row) => row.id === 'proxy')!.resolutionMethod, 'proxy');
  assert.equal(view.rows.find((row) => row.id === 'proxy')!.excludedFromMetrics, true);
  assert.equal(view.rows.find((row) => row.id === 'proxy')!.metricExclusionReason, 'proxy');
  assert.equal(view.rows.find((row) => row.id === 'manual')!.resolutionMethod, 'manual');
  assert.equal(view.rows.find((row) => row.id === 'manual')!.metricExclusionReason, null);
  assert.equal(view.rows.find((row) => row.id === 'pending')!.resolutionMethod, 'unresolved');
  assert.equal(view.rows.find((row) => row.id === 'pending')!.metricExclusionReason, 'training');
});

test('forecast workbench applies every requested filter', () => {
  const matchingFields: Partial<PredictionRecord> = {
    id: 'matching',
    sourceId: 'model-a',
    domain: 'weather',
    resolveBy: 100 + 3 * HOUR,
    algorithmVersion: 'v2',
  };
  const matching = resolvedRecord(matchingFields);
  const state = createForecastWorkbenchState();
  state.filters = {
    source: 'model-a',
    domain: 'weather',
    horizon: '1h-6h',
    version: 'v2',
    resolutionMethod: 'direct',
  };

  const view = buildForecastWorkbench([
    matching,
    resolvedRecord({ ...matchingFields, id: 'wrong-source', sourceId: 'model-b' }),
    resolvedRecord({ ...matchingFields, id: 'wrong-domain', domain: 'markets' }),
    resolvedRecord({
      ...matchingFields,
      id: 'wrong-horizon',
      resolveBy: 100 + 12 * HOUR,
    }),
    resolvedRecord({ ...matchingFields, id: 'wrong-version', algorithmVersion: 'v3' }),
    resolvedRecord({
      ...matchingFields,
      id: 'wrong-method',
      resolutionNote: 'proxy: inferred',
      resolutionProvenance: {
        resolverId: 'proxy',
        kind: 'proxy',
        evidence: [{ sourceIds: ['proxy'], observedAt: 800 }],
      },
    }),
  ], state);

  assert.deepEqual(view.rows.map((row) => row.id), ['matching']);
  assert.equal(view.totalMatching, 1);
  assert.equal(view.hasActiveFilters, true);
  assert.ok(view.filterOptions.sources.some((option) => option.value === 'model-b'));
  assert.ok(view.filterOptions.resolutionMethods.some((option) => option.value === 'proxy'));
});

test('forecast workbench excludes proxy labels from holdout metrics', () => {
  const records = [
    resolvedRecord({ id: 'training-a', predictedAt: 0, resolvedAt: 1 }),
    resolvedRecord({ id: 'training-b', predictedAt: 1, resolvedAt: 1 }),
    resolvedRecord({
      id: 'evaluation-direct',
      predictedAt: 2,
      resolvedAt: 4,
    }),
    resolvedRecord({
      id: 'evaluation-proxy',
      predictedAt: 3,
      resolvedAt: 4,
      resolutionNote: 'proxy: inferred',
      resolutionProvenance: {
        resolverId: 'proxy',
        kind: 'proxy',
        evidence: [{ sourceIds: ['proxy'], observedAt: 4 }],
      },
    }),
  ];

  const view = buildForecastWorkbench(records, createForecastWorkbenchState(), {
    minResolved: 1,
    minTrainingResolved: 1,
  });

  assert.equal(view.comparison.selected.scored, 1);
  assert.equal(view.comparison.selected.proxyLabelsExcluded, 1);
  assert.equal(view.comparison.selected.brier.status, 'ok');
  assert.deepEqual(view.worstErrors.map((row) => row.id), ['evaluation-direct']);
});

test('forecast workbench sorts numeric errors descending with unavailable values last', () => {
  const state = createForecastWorkbenchState();
  state.sort = { field: 'brier', direction: 'desc' };
  const view = buildForecastWorkbench([
    resolvedRecord({
      id: 'small-error',
      probability: 0.9,
      status: 'resolved_true',
    }),
    fakeRecord({ id: 'pending' }),
    resolvedRecord({
      id: 'large-error',
      probability: 0.9,
      status: 'resolved_false',
    }),
  ], state);

  assert.deepEqual(view.rows.map((row) => row.id), [
    'large-error',
    'small-error',
    'pending',
  ]);
});

test('forecast workbench sorts targets alphabetically', () => {
  const state = createForecastWorkbenchState();
  state.sort = { field: 'target', direction: 'asc' };
  const view = buildForecastWorkbench([
    resolvedRecord({ id: 'z', targetKey: 'Zulu target' }),
    resolvedRecord({ id: 'a', targetKey: 'Alpha target' }),
  ], state);

  assert.deepEqual(view.rows.map((row) => row.target), [
    'Alpha target',
    'Zulu target',
  ]);
});

test('forecast workbench builds leakage-safe holdout reliability and cohort comparison', () => {
  const records = Array.from({ length: 10 }, (_, index) => resolvedRecord({
    id: `split-${index}`,
    sourceId: index % 2 === 0 ? 'model-a' : 'model-b',
    probability: index % 2 === 0 ? 0.8 : 0.2,
    status: index % 2 === 0 ? 'resolved_true' : 'resolved_false',
    predictedAt: index,
    resolveBy: index + HOUR,
    resolvedAt: index < 6 ? 5 : 20,
  }));
  const state = createForecastWorkbenchState();
  state.filters.source = 'model-a';

  const view = buildForecastWorkbench(records, state, {
    minResolved: 2,
    minTrainingResolved: 2,
    binCount: 2,
  });

  assert.deepEqual(view.window, {
    trainingRecords: 6,
    evaluationRecords: 4,
    evaluationWindowStart: 6,
  });
  assert.equal(view.reliability.status, 'ok');
  assert.equal(view.reliability.sampleSize, 2);
  assert.equal(view.reliability.bins.length, 2);
  assert.equal(view.comparison.overall.brier.status, 'ok');
  assert.equal(view.comparison.overall.brier.sampleSize, 4);
  assert.equal(view.comparison.selected.brier.status, 'ok');
  assert.equal(view.comparison.selected.brier.sampleSize, 2);
  assert.equal(
    view.rows.find((row) => row.id === 'split-0')!.metricExclusionReason,
    'training',
  );
  assert.equal(
    view.rows.find((row) => row.id === 'split-6')!.metricExclusionReason,
    null,
  );
});

test('forecast workbench reports explicit insufficient evidence states', () => {
  const view = buildForecastWorkbench([
    resolvedRecord({ id: 'only-record' }),
  ]);

  assert.deepEqual(view.reliability, {
    status: 'insufficient_evidence',
    sampleSize: 1,
    minSampleSize: 20,
    bins: [],
  });
  assert.equal(view.comparison.selected.brier.status, 'insufficient_evidence');
  assert.equal(view.comparison.selected.ece.status, 'insufficient_evidence');
});

test('forecast workbench surfaces worst errors and high-confidence misses', () => {
  const view = buildForecastWorkbench([
    resolvedRecord({ id: 'training-0', predictedAt: 0 }),
    resolvedRecord({ id: 'training-1', predictedAt: 1 }),
    resolvedRecord({ id: 'training-2', predictedAt: 2 }),
    resolvedRecord({
      id: 'confident-false-positive',
      probability: 0.95,
      status: 'resolved_false',
      predictedAt: 3,
    }),
    resolvedRecord({
      id: 'confident-false-negative',
      probability: 0.1,
      status: 'resolved_true',
      predictedAt: 4,
    }),
    resolvedRecord({
      id: 'correct',
      probability: 0.9,
      status: 'resolved_true',
      predictedAt: 5,
    }),
  ]);

  assert.equal(view.worstErrors[0]!.id, 'confident-false-positive');
  assert.deepEqual(
    view.highConfidenceMisses.map((row) => row.id),
    ['confident-false-positive', 'confident-false-negative'],
  );
});
