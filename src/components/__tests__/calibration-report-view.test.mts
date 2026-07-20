import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCalibrationReport } from '../calibration-report-view.ts';
import type { ReliabilityCurve } from '@/services/cognition/recalibration';
import type { CalibrationComparison } from '@/services/cognition/forecast-journal';

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
