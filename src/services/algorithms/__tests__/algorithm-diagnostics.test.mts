import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAlgorithmDiagnosticsSnapshot,
  type BuildAlgorithmDiagnosticsInput,
} from '../algorithm-diagnostics.ts';

const NOW = 1_800_000_000_000;

function baseInput(): BuildAlgorithmDiagnosticsInput {
  return {
    generatedAt: NOW,
    definitions: [
      {
        algorithmId: 'fast-algo',
        label: 'Fast algorithm',
        domain: 'other',
        criticality: 'medium',
        minGradedSamples: 2,
        minWeightedHitRate: 0.5,
        maxMeanDurationMs: 500,
      },
    ],
    records: [
      {
        id: 'eval-1',
        algorithmId: 'fast-algo',
        domain: 'other',
        at: NOW - 2_000,
        durationMs: 10,
        label: 'matched',
        outcome: 'hit',
        outcomeAt: NOW - 1_000,
        outcomeReason: 'confirmed',
      },
      {
        id: 'eval-2',
        algorithmId: 'fast-algo',
        domain: 'other',
        at: NOW - 1_000,
        durationMs: 30,
        label: 'error',
        outcome: 'miss',
        outcomeAt: NOW,
        outcomeReason: 'rejected',
      },
    ],
    persistence: {
      lastLoadStatus: 'ok',
      lastLoadedAt: NOW - 10_000,
      lastSaveStatus: 'ok',
      lastSavedAt: NOW - 500,
      recordCount: 2,
      trimmedCount: 0,
      rejectedCount: 0,
      lastError: null,
    },
    tunings: [{
      algorithmId: 'fast-algo',
      parameters: [{
        parameterId: 'threshold',
        current: 0.5,
        min: 0.2,
        max: 0.8,
        step: 0.1,
        fixDirection: 'increase',
        description: 'Decision threshold.',
      }],
    }],
    tuningDecisions: [{
      at: NOW - 500,
      algorithmId: 'fast-algo',
      parameterId: 'threshold',
      priorValue: 0.4,
      nextValue: 0.5,
      kind: 'applied',
      ruleId: 'test-rule',
      reason: 'fixture',
    }],
  };
}

test('buildAlgorithmDiagnosticsSnapshot joins health, runtime, tuning, and persistence', () => {
  const snapshot = buildAlgorithmDiagnosticsSnapshot(baseInput());

  assert.equal(snapshot.schemaVersion, 1);
  assert.deepEqual(snapshot.ledger, {
    total: 2,
    graded: 2,
    pending: 0,
    lastEvaluationAt: NOW - 1_000,
    persistence: baseInput().persistence,
  });
  assert.equal(snapshot.health.status, 'healthy');
  assert.equal(snapshot.runtime[0]?.totalRuns, 2);
  assert.equal(snapshot.runtime[0]?.errors, 1);
  assert.equal(snapshot.runtime[0]?.latencyMs.p50, 30);
  assert.equal(snapshot.runtime[0]?.latencyMs.p95, 30);
  assert.equal(snapshot.runtime[0]?.latencyMs.max, 30);
  assert.equal(snapshot.tunings[0]?.parameters[0]?.current, 0.5);
  assert.equal(snapshot.recentTuningDecisions[0]?.kind, 'applied');
});

test('buildAlgorithmDiagnosticsSnapshot bounds recent evaluations and omits raw detail', () => {
  const input = baseInput();
  input.records = Array.from({ length: 40 }, (_, index) => ({
    id: `eval-${index}`,
    algorithmId: 'fast-algo',
    domain: 'other',
    at: NOW - (40 - index),
    durationMs: index,
    inputHash: `private-${index}`,
    notes: `raw note ${index}`,
    detail: { raw: `payload-${index}` },
  }));

  const snapshot = buildAlgorithmDiagnosticsSnapshot(input);

  assert.equal(snapshot.recentEvaluations.length, 20);
  assert.equal(snapshot.recentEvaluations[0]?.id, 'eval-39');
  assert.equal('detail' in snapshot.recentEvaluations[0]!, false);
  assert.equal('notes' in snapshot.recentEvaluations[0]!, false);
  assert.equal('inputHash' in snapshot.recentEvaluations[0]!, false);
});
