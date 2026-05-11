import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeF1ForAlgorithm,
  computeF1WeightsFromLedger,
  runEnsembleVote,
  registerEnsembleAlgorithm,
  recordEnsembleDecision,
  getLastEnsembleDecision,
  listEnsembleDomains,
  _resetEnsembleStateForTests,
  type AlgorithmVote,
} from '../ensemble-voter.ts';
import type { EvaluationRecord } from '../algorithm-evaluation-ledger.ts';
import { getAlgorithm, resetAlgorithmRegistry } from '../algorithm-registry.ts';

const NOW = 1_745_000_000_000;

function rec(overrides: Partial<EvaluationRecord> & {
  algorithmId: string;
  outcome: EvaluationRecord['outcome'];
  at?: number;
}): EvaluationRecord {
  return {
    id: overrides.id ?? `r-${Math.random()}`,
    algorithmId: overrides.algorithmId,
    domain: overrides.domain ?? 'truth_score',
    at: overrides.at ?? NOW,
    durationMs: overrides.durationMs ?? 5,
    score: overrides.score ?? 0.7,
    outcome: overrides.outcome,
    outcomeAt: overrides.outcome ? (overrides.at ?? NOW) + 1 : undefined,
    outcomeReason: overrides.outcome ? 'test' : undefined,
  };
}

// ── F1 score ───────────────────────────────────────────────────────────

test('computeF1ForAlgorithm: returns 0 with no graded records', () => {
  const f1 = computeF1ForAlgorithm([], 'a', { now: NOW });
  assert.equal(f1, 0);
});

test('computeF1ForAlgorithm: pure hits give F1=1', () => {
  const records: EvaluationRecord[] = [
    rec({ algorithmId: 'a', outcome: 'hit' }),
    rec({ algorithmId: 'a', outcome: 'hit' }),
  ];
  const f1 = computeF1ForAlgorithm(records, 'a', { now: NOW });
  assert.equal(f1, 1);
});

test('computeF1ForAlgorithm: penalizes misses + inconclusive', () => {
  const records: EvaluationRecord[] = [
    rec({ algorithmId: 'a', outcome: 'hit' }),
    rec({ algorithmId: 'a', outcome: 'miss' }),
    rec({ algorithmId: 'a', outcome: 'inconclusive' }),
  ];
  // tp=1, fp=1, fn=1 → 2/(2+1+1) = 0.5
  const f1 = computeF1ForAlgorithm(records, 'a', { now: NOW });
  assert.equal(f1, 0.5);
});

test('computeF1ForAlgorithm: ignores records outside window', () => {
  const records: EvaluationRecord[] = [
    rec({ algorithmId: 'a', outcome: 'miss', at: NOW - 60 * 24 * 60 * 60 * 1000 }),
    rec({ algorithmId: 'a', outcome: 'hit', at: NOW - 1 }),
  ];
  const f1 = computeF1ForAlgorithm(records, 'a', { now: NOW });
  assert.equal(f1, 1);
});

test('computeF1ForAlgorithm: partial counts as 0.5 hit', () => {
  const records: EvaluationRecord[] = [
    rec({ algorithmId: 'a', outcome: 'partial' }),
  ];
  // tp=0.5, fp=0, fn=0 → 1.0/1.0 = 1
  const f1 = computeF1ForAlgorithm(records, 'a', { now: NOW });
  assert.equal(f1, 1);
});

// ── Weight building ────────────────────────────────────────────────────

test('computeF1WeightsFromLedger: equal weights when no graded records', () => {
  const w = computeF1WeightsFromLedger([], ['a', 'b'], { now: NOW });
  assert.equal(w.a, 0.5);
  assert.equal(w.b, 0.5);
});

test('computeF1WeightsFromLedger: weights renormalize to 1', () => {
  const records: EvaluationRecord[] = [
    rec({ algorithmId: 'a', outcome: 'hit' }),
    rec({ algorithmId: 'b', outcome: 'miss' }),
  ];
  const w = computeF1WeightsFromLedger(records, ['a', 'b'], { now: NOW });
  const sum = w.a! + w.b!;
  assert.ok(Math.abs(sum - 1) < 1e-9, `weights must sum to 1, got ${sum}`);
  assert.ok(w.a! > w.b!, 'higher F1 → higher weight');
});

test('computeF1WeightsFromLedger: floor keeps zero-F1 algorithms participating', () => {
  const records: EvaluationRecord[] = [
    rec({ algorithmId: 'a', outcome: 'hit' }),
    rec({ algorithmId: 'b', outcome: 'miss' }),
  ];
  const w = computeF1WeightsFromLedger(records, ['a', 'b'], { now: NOW, floor: 0.05 });
  assert.ok(w.b! > 0, 'floor weight should be positive');
});

// ── Voting modes ───────────────────────────────────────────────────────

function v(id: string, decision: boolean, conf = 0.8): AlgorithmVote {
  return { algorithmId: id, decision, confidence: conf };
}

test('runEnsembleVote: MAJORITY fires on >50%', () => {
  const d = runEnsembleVote({
    domain: 'weather',
    votingMode: 'MAJORITY',
    votes: [v('a', true), v('b', true), v('c', false)],
    generatedAt: NOW,
  });
  assert.equal(d.finalDecision, 'fire');
  assert.equal(d.dissent.length, 1);
  assert.equal(d.dissent[0]!.algorithmId, 'c');
});

test('runEnsembleVote: MAJORITY at exactly 0.5 → undecided', () => {
  const d = runEnsembleVote({
    domain: 'weather',
    votingMode: 'MAJORITY',
    votes: [v('a', true), v('b', false)],
    generatedAt: NOW,
  });
  assert.equal(d.finalDecision, 'undecided');
});

test('runEnsembleVote: CONSENSUS fires only above 75%', () => {
  const fire3of4 = runEnsembleVote({
    domain: 'weather',
    votingMode: 'CONSENSUS',
    votes: [v('a', true), v('b', true), v('c', true), v('d', false)],
    generatedAt: NOW,
  });
  // 3/4 = 0.75, threshold is >0.75 → hold
  assert.equal(fire3of4.finalDecision, 'hold');

  const fire4of5 = runEnsembleVote({
    domain: 'weather',
    votingMode: 'CONSENSUS',
    votes: [v('a', true), v('b', true), v('c', true), v('d', true), v('e', false)],
    generatedAt: NOW,
  });
  assert.equal(fire4of5.finalDecision, 'fire');
});

test('runEnsembleVote: UNANIMOUS requires 100%', () => {
  const d = runEnsembleVote({
    domain: 'weather',
    votingMode: 'UNANIMOUS',
    votes: [v('a', true), v('b', true), v('c', false)],
    generatedAt: NOW,
  });
  assert.equal(d.finalDecision, 'hold');
  const all = runEnsembleVote({
    domain: 'weather',
    votingMode: 'UNANIMOUS',
    votes: [v('a', true), v('b', true)],
    generatedAt: NOW,
  });
  assert.equal(all.finalDecision, 'fire');
});

test('runEnsembleVote: CONFIDENCE_WEIGHTED averages yes-confidences', () => {
  const d = runEnsembleVote({
    domain: 'weather',
    votingMode: 'CONFIDENCE_WEIGHTED',
    votes: [v('a', true, 0.9), v('b', true, 0.7), v('c', false, 0.6)],
    weights: { a: 1, b: 1, c: 1 },
    generatedAt: NOW,
  });
  // yes-conf = (0.9 + 0.7) / 2 = 0.8 > 0.5 → fire
  assert.equal(d.finalDecision, 'fire');
  assert.ok(Math.abs(d.weightedConfidence - 0.8) < 1e-9);
});

test('runEnsembleVote: weights are renormalized', () => {
  const d = runEnsembleVote({
    domain: 'weather',
    votingMode: 'MAJORITY',
    votes: [v('a', true), v('b', false)],
    weights: { a: 5, b: 5 }, // raw, must renormalize
    generatedAt: NOW,
  });
  const sum = (d.weights.a ?? 0) + (d.weights.b ?? 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test('runEnsembleVote: dissent recorded for differing votes', () => {
  const d = runEnsembleVote({
    domain: 'weather',
    votingMode: 'CONSENSUS',
    votes: [v('a', true), v('b', true), v('c', true), v('d', true), v('e', false)],
    generatedAt: NOW,
  });
  assert.equal(d.finalDecision, 'fire');
  assert.equal(d.dissent.length, 1);
  assert.equal(d.dissent[0]!.algorithmId, 'e');
});

// ── Self-registration ──────────────────────────────────────────────────

test('registerEnsembleAlgorithm: registers ensemble in registry', () => {
  resetAlgorithmRegistry();
  const def = registerEnsembleAlgorithm('weather', { participating: ['nws-polygon-match'] });
  assert.equal(def.id, 'ensemble-weather');
  assert.equal(getAlgorithm('ensemble-weather')?.label, 'Ensemble (weather)');
});

test('registerEnsembleAlgorithm: idempotent (replace on re-register)', () => {
  resetAlgorithmRegistry();
  registerEnsembleAlgorithm('finance', { participating: ['a'] });
  // No throw on re-register
  const def2 = registerEnsembleAlgorithm('finance', { participating: ['a', 'b'] });
  assert.equal(def2.dependencies.services.length, 2);
});

// ── Mirror cache ───────────────────────────────────────────────────────

test('recordEnsembleDecision + getLastEnsembleDecision round-trip', () => {
  _resetEnsembleStateForTests();
  const d = runEnsembleVote({
    domain: 'finance',
    votingMode: 'MAJORITY',
    votes: [v('a', true), v('b', true)],
    generatedAt: NOW,
  });
  recordEnsembleDecision(d);
  const back = getLastEnsembleDecision('finance');
  assert.equal(back?.finalDecision, 'fire');
  assert.deepEqual(listEnsembleDomains(), ['finance']);
});
