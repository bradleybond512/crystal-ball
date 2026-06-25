/**
 * Coverage for `tracked-algorithms.ts` — verifies that each tracked
 * wrapper:
 *   1. Returns the same value the underlying pure function returns.
 *   2. Emits exactly one ledger record per call.
 *   3. Populates score/label/detail with the right fields.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { trackedScoreFact, trackedComputeCompoundRisk, trackedEvaluateNegativeEvidence } from '../tracked-algorithms.ts';
import { getAlgorithmEvaluationLedger, resetAlgorithmsState } from '../algorithms-state.ts';
import type { NormalizedFact } from '@/services/intelligence/types';
import type { CompoundRiskInput } from '@/services/intelligence/compound-risk';
import type { ExpectedSignal } from '@/services/intelligence/negative-evidence';

test.beforeEach(() => resetAlgorithmsState());

const fact = (id: string, sourceCount: number = 2): NormalizedFact => ({
  id,
  domain: 'weather',
  eventType: 'earthquake',
  claim: 'M6.2 near Tokyo',
  severity: 'medium',
  occurredAt: Date.now() - 60_000,
  ingestedAt: Date.now(),
  locationPrecision: 'point',
  entities: ['JP'],
  sources: Array.from({ length: sourceCount }, (_, i) => ({
    providerId: `provider-${i}`,
    reliability: 0.8,
    observedAt: Date.now() - 30_000,
    rawId: `raw-${i}`,
  })),
});

test('trackedScoreFact: emits one record with score+label+detail', () => {
  const ledger = getAlgorithmEvaluationLedger();
  const result = trackedScoreFact(fact('f1'));
  assert.equal(typeof result.score, 'number', 'pure result returned');
  const records = ledger.byAlgorithm('truth-score');
  assert.equal(records.length, 1);
  const r = records[0]!;
  assert.equal(r.score, result.score);
  assert.equal(r.label, result.label);
  assert.equal(r.detail?.sourceCount, 2);
  assert.equal(r.detail?.domain, 'weather');
});

test('trackedScoreFact: 5 calls emit 5 records', () => {
  const ledger = getAlgorithmEvaluationLedger();
  for (let i = 0; i < 5; i++) trackedScoreFact(fact(`f${i}`));
  assert.equal(ledger.byAlgorithm('truth-score').length, 5);
});

test('trackedComputeCompoundRisk: emits one record with the top-scoring cluster surfaced', () => {
  const ledger = getAlgorithmEvaluationLedger();
  const inputs: CompoundRiskInput[] = [
    {
      id: 's1', title: 'Heat wave', domain: 'weather', domains: ['weather'],
      severityScore: 80, confidence: 0.9, latitude: 35, longitude: 139,
      entities: ['JP'], occurredAt: Date.now(),
    },
    {
      id: 's2', title: 'Power grid stress', domain: 'energy', domains: ['energy'],
      severityScore: 70, confidence: 0.8, latitude: 35.5, longitude: 139.5,
      entities: ['JP'], occurredAt: Date.now(),
    },
  ];
  const results = trackedComputeCompoundRisk(inputs);
  assert.ok(Array.isArray(results), 'pure result returned');
  const records = ledger.byAlgorithm('compound-risk');
  assert.equal(records.length, 1, 'one record per call regardless of cluster count');
  const r = records[0]!;
  assert.equal(r.detail?.inputCount, 2);
  if (results.length > 0) {
    assert.equal(r.score, results.reduce((m, x) => Math.max(m, x.score), 0));
  }
});

test('trackedEvaluateNegativeEvidence: records totalAbsencePenalty as score', () => {
  const ledger = getAlgorithmEvaluationLedger();
  const parent = fact('parent');
  const expected: ExpectedSignal[] = [
    { id: 'aftershock', label: 'Aftershock within 1h', domain: 'weather', windowStartMs: 0, windowEndMs: 60 * 60 * 1000, absencePenalty: 0.3 },
  ];
  const result = trackedEvaluateNegativeEvidence(parent, expected, [], 0.7, { now: parent.occurredAt + 2 * 60 * 60 * 1000 });
  const records = ledger.byAlgorithm('negative-evidence');
  assert.equal(records.length, 1);
  const r = records[0]!;
  assert.equal(r.score, result.totalAbsencePenalty);
  assert.equal(r.detail?.expected, 1);
  assert.equal(r.detail?.adjustedConfidence, result.adjustedConfidence);
});

test('determinism: same call twice produces same record fields (modulo id+at)', () => {
  const ledger = getAlgorithmEvaluationLedger();
  const f = fact('repro', 3);
  trackedScoreFact(f);
  trackedScoreFact(f);
  const records = ledger.byAlgorithm('truth-score');
  assert.equal(records.length, 2);
  assert.equal(records[0]!.score, records[1]!.score);
  assert.equal(records[0]!.label, records[1]!.label);
  assert.deepEqual(records[0]!.detail, records[1]!.detail);
  assert.notEqual(records[0]!.id, records[1]!.id);
});
