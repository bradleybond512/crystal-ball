import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCalibrationReport, buildDomainReportCard } from '../calibration-report-view.ts';
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
