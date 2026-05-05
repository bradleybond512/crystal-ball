import assert from 'node:assert/strict';
import test from 'node:test';

import {
  pearsonCorrelation,
  classifyCorrelation,
  buildPairedConfidenceSeries,
  buildCorrelationMatrix,
  suggestDiverseEnsemble,
  recordCorrelationMatrix,
  getLastCorrelationMatrix,
  _resetCorrelationCacheForTests,
} from '../correlation-analyzer.ts';
import type { EvaluationRecord } from '../algorithm-evaluation-ledger.ts';

const NOW = 1_745_000_000_000;

function rec(args: {
  algorithmId: string;
  inputHash: string;
  score: number;
  at?: number;
}): EvaluationRecord {
  return {
    id: `${args.algorithmId}-${args.inputHash}`,
    algorithmId: args.algorithmId,
    domain: 'truth_score',
    at: args.at ?? NOW,
    durationMs: 1,
    inputHash: args.inputHash,
    score: args.score,
  };
}

// ── Pearson ───────────────────────────────────────────────────────────

test('pearsonCorrelation: perfectly correlated', () => {
  const r = pearsonCorrelation([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
  assert.ok(Math.abs(r - 1) < 1e-9);
});

test('pearsonCorrelation: perfectly anti-correlated', () => {
  const r = pearsonCorrelation([1, 2, 3], [3, 2, 1]);
  assert.ok(Math.abs(r + 1) < 1e-9);
});

test('pearsonCorrelation: NaN on length mismatch throws', () => {
  assert.throws(() => pearsonCorrelation([1], [1, 2]));
});

test('pearsonCorrelation: NaN on zero variance', () => {
  const r = pearsonCorrelation([1, 1, 1], [2, 4, 6]);
  assert.ok(Number.isNaN(r));
});

test('pearsonCorrelation: short series → NaN', () => {
  assert.ok(Number.isNaN(pearsonCorrelation([1], [2])));
});

// ── Classification ────────────────────────────────────────────────────

test('classifyCorrelation: redundant when r >= 0.8', () => {
  assert.equal(classifyCorrelation(0.85), 'redundant');
});

test('classifyCorrelation: disagreement when r <= -0.3', () => {
  assert.equal(classifyCorrelation(-0.4), 'disagreement');
});

test('classifyCorrelation: independent when |r| <= 0.2', () => {
  assert.equal(classifyCorrelation(0.1), 'independent');
});

test('classifyCorrelation: mild otherwise', () => {
  assert.equal(classifyCorrelation(0.5), 'mild');
});

test('classifyCorrelation: NaN treated as independent', () => {
  assert.equal(classifyCorrelation(Number.NaN), 'independent');
});

// ── Pair extraction ───────────────────────────────────────────────────

test('buildPairedConfidenceSeries: matches by inputHash', () => {
  const records: EvaluationRecord[] = [
    rec({ algorithmId: 'a', inputHash: 'h1', score: 0.5 }),
    rec({ algorithmId: 'b', inputHash: 'h1', score: 0.6 }),
    rec({ algorithmId: 'a', inputHash: 'h2', score: 0.7 }),
    rec({ algorithmId: 'b', inputHash: 'h2', score: 0.8 }),
    rec({ algorithmId: 'b', inputHash: 'orphan', score: 0.9 }),
  ];
  const { xs, ys } = buildPairedConfidenceSeries(records, 'a', 'b', 500);
  assert.equal(xs.length, 2);
  assert.equal(ys.length, 2);
});

test('buildPairedConfidenceSeries: respects window size', () => {
  const records: EvaluationRecord[] = [];
  for (let i = 0; i < 20; i += 1) {
    records.push(rec({ algorithmId: 'a', inputHash: `h${i}`, score: i / 20, at: NOW + i }));
    records.push(rec({ algorithmId: 'b', inputHash: `h${i}`, score: i / 20, at: NOW + i }));
  }
  const { xs } = buildPairedConfidenceSeries(records, 'a', 'b', 5);
  assert.equal(xs.length, 5);
});

// ── Matrix ────────────────────────────────────────────────────────────

test('buildCorrelationMatrix: produces all-pairs entries', () => {
  const records: EvaluationRecord[] = [];
  for (let i = 0; i < 10; i += 1) {
    records.push(rec({ algorithmId: 'a', inputHash: `h${i}`, score: i / 10 }));
    records.push(rec({ algorithmId: 'b', inputHash: `h${i}`, score: i / 10 })); // perfectly correlated
    records.push(rec({ algorithmId: 'c', inputHash: `h${i}`, score: 1 - i / 10 })); // anti-correlated
  }
  const matrix = buildCorrelationMatrix(records, ['a', 'b', 'c'], { now: () => NOW });
  assert.equal(matrix.pairs.length, 3); // C(3,2) = 3
  const ab = matrix.pairs.find((p) => p.algorithmA === 'a' && p.algorithmB === 'b');
  const ac = matrix.pairs.find((p) => p.algorithmA === 'a' && p.algorithmB === 'c');
  assert.ok(ab && Math.abs(ab.r - 1) < 1e-9);
  assert.equal(ab.classification, 'redundant');
  assert.ok(ac && Math.abs(ac.r + 1) < 1e-9);
  assert.equal(ac.classification, 'disagreement');
});

test('buildCorrelationMatrix: NaN with too few pairs', () => {
  const records: EvaluationRecord[] = [
    rec({ algorithmId: 'a', inputHash: 'h1', score: 0.5 }),
    rec({ algorithmId: 'b', inputHash: 'h1', score: 0.6 }),
  ];
  const matrix = buildCorrelationMatrix(records, ['a', 'b'], { minPairs: 5, now: () => NOW });
  assert.ok(Number.isNaN(matrix.pairs[0]!.r));
});

// ── Ensemble composition ──────────────────────────────────────────────

test('suggestDiverseEnsemble: prefers low-correlation peers', () => {
  // a-b strongly correlated; a-c independent; b-c independent
  const records: EvaluationRecord[] = [];
  for (let i = 0; i < 10; i += 1) {
    records.push(rec({ algorithmId: 'a', inputHash: `h${i}`, score: i / 10 }));
    records.push(rec({ algorithmId: 'b', inputHash: `h${i}`, score: i / 10 + 0.001 }));
    // c uncorrelated
    records.push(rec({ algorithmId: 'c', inputHash: `h${i}`, score: (i % 2) / 10 }));
  }
  const matrix = buildCorrelationMatrix(records, ['a', 'b', 'c'], { now: () => NOW });
  const composition = suggestDiverseEnsemble(matrix, ['a', 'b', 'c'], 2);
  assert.equal(composition.length, 2);
  // Second pick should NOT be the strongly-correlated counterpart of the seed.
  const [seed, second] = composition;
  if (seed === 'a') assert.notEqual(second, 'b');
  if (seed === 'b') assert.notEqual(second, 'a');
});

test('suggestDiverseEnsemble: returns empty for size 0', () => {
  const matrix = buildCorrelationMatrix([], ['a'], { now: () => NOW });
  assert.deepEqual(suggestDiverseEnsemble(matrix, ['a'], 0), []);
});

// ── Cache ─────────────────────────────────────────────────────────────

test('record / getLast CorrelationMatrix: round-trip', () => {
  _resetCorrelationCacheForTests();
  const matrix = buildCorrelationMatrix([], ['a'], { now: () => NOW });
  recordCorrelationMatrix(matrix);
  assert.equal(getLastCorrelationMatrix()?.algorithmIds[0], 'a');
});
