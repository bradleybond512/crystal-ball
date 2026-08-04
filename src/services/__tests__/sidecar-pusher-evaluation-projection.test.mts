import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildEvaluationReportProjectionFromDiagnostics,
  evaluationReportProjectionRefreshDue,
} from '../sidecar-pusher';
import type { AlgorithmDiagnosticsSnapshot } from '../algorithms/algorithm-diagnostics';
import type { ChampionStatusRuntimeSnapshot } from '../cognition/champion-status-runtime';

const GENERATED_AT = 1_785_000_000_000;

function diagnosticsFixture(): AlgorithmDiagnosticsSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    health: {
      status: 'unsafe',
      summary: 'fixture',
      generatedAt: GENERATED_AT,
      algorithms: [
        { status: 'unsafe' },
        { status: 'healthy' },
      ],
      recommendations: [],
    },
    forecastCalibration: {
      summary: {
        total: 20,
        resolved: 10,
        pending: 8,
        overduePending: 2,
        expired: 2,
      },
      resolutionQuality: {
        summary: { resolutionCoverage: 0.5 },
      },
      evaluation: {
        overall: {
          brier: { status: 'ok', sampleSize: 10, value: 0.2 },
          logLoss: { status: 'ok', sampleSize: 10, value: 0.6 },
          brierSkill: { status: 'insufficient_evidence', sampleSize: 10, minSampleSize: 30 },
          equalMassEce: { status: 'ok', sampleSize: 10, value: 0.08 },
        },
        lossAttribution: {
          byAlgorithmVersion: [
            { shareOfBrierLoss: 0.3 },
            { shareOfBrierLoss: 0.7 },
          ],
        },
      },
    },
  } as unknown as AlgorithmDiagnosticsSnapshot;
}

function championFixture(): ChampionStatusRuntimeSnapshot {
  return {
    view: {
      slot: 'forecast-primary',
      championId: 'production',
      championVersion: '1.0.0',
      championActivatedAt: 1_700_000_000_000,
      challengers: [],
    },
    history: [{
      slot: 'forecast-primary',
      modelId: 'production',
      modelVersion: '1.0.0',
      activatedAt: 1_700_000_000_000,
      reason: 'initial',
    }],
  } as unknown as ChampionStatusRuntimeSnapshot;
}

test('sidecar pusher maps diagnostics and champion state into the bounded report projection', () => {
  const projection = buildEvaluationReportProjectionFromDiagnostics(
    diagnosticsFixture(),
    championFixture(),
  );

  assert.equal(projection?.generatedAt, GENERATED_AT);
  assert.deepEqual(projection?.forecast, {
    total: 20,
    resolved: 10,
    pending: 8,
    overduePending: 2,
    expired: 2,
    resolutionCoverage: 0.5,
    expirationRate: 0.1,
    metrics: {
      brier: { status: 'ok', sampleSize: 10, value: 0.2 },
      logLoss: { status: 'ok', sampleSize: 10, value: 0.6 },
      brierSkill: { status: 'insufficient_evidence', sampleSize: 10, minSampleSize: 30 },
      equalMassEce: { status: 'ok', sampleSize: 10, value: 0.08 },
    },
    largestVersionLossShare: 0.7,
    quarantinedCount: 1,
  });
  assert.equal(projection?.champion.active?.model, 'production');
});

test('sidecar pusher rate-limits report composition to one refresh per fifteen minutes', () => {
  assert.equal(evaluationReportProjectionRefreshDue(null, GENERATED_AT), true);
  assert.equal(evaluationReportProjectionRefreshDue(GENERATED_AT, GENERATED_AT + 899_999), false);
  assert.equal(evaluationReportProjectionRefreshDue(GENERATED_AT, GENERATED_AT + 900_000), true);
  assert.equal(evaluationReportProjectionRefreshDue(GENERATED_AT, GENERATED_AT - 1), false);
});
