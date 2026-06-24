import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAlgorithmEvaluationLedger,
  summarizeCalibration,
  type EvaluationRecord,
} from '../algorithm-evaluation-ledger.ts';

const NOW = 1_745_000_000_000;

function makeLedger(now: number = NOW) {
  let t = now;
  const ledger = createAlgorithmEvaluationLedger({ now: () => t });
  return {
    ledger,
    setTime(ms: number) {
      t = ms;
    },
    advance(ms: number) {
      t += ms;
    },
  };
}

function baseEval(overrides: Partial<EvaluationRecord> = {}): Omit<EvaluationRecord, 'id' | 'outcome' | 'outcomeAt' | 'outcomeReason'> & { id?: string } {
  return {
    id: overrides.id,
    algorithmId: overrides.algorithmId ?? 'truth-score-v1',
    domain: overrides.domain ?? 'truth_score',
    version: overrides.version ?? 'v1.0',
    at: overrides.at ?? NOW,
    durationMs: overrides.durationMs ?? 12,
    inputHash: overrides.inputHash ?? 'abc',
    score: overrides.score ?? 0.82,
    label: overrides.label,
    notes: overrides.notes,
    detail: overrides.detail,
  };
}

// ── Recording evaluations ──────────────────────────────────────────────

test('recordEvaluation: assigns auto-id and clones detail', () => {
  const { ledger } = makeLedger();
  const r = ledger.recordEvaluation({ ...baseEval(), id: undefined, detail: { x: 1 } });
  assert.match(r.id, /^eval-/);
  assert.equal(r.detail?.x, 1);
});

test('recordEvaluation: caller-supplied id passes through; collision throws', () => {
  const { ledger } = makeLedger();
  ledger.recordEvaluation({ ...baseEval(), id: 'custom' });
  assert.throws(() => ledger.recordEvaluation({ ...baseEval(), id: 'custom' }), /already exists/);
});

test('recordEvaluation: rejects non-finite scores (NaN/Infinity would poison every hit-rate aggregate)', () => {
  const { ledger } = makeLedger();
  assert.throws(() => ledger.recordEvaluation(baseEval({ score: Number.NaN })), /must be finite/);
  assert.throws(() => ledger.recordEvaluation(baseEval({ score: Number.POSITIVE_INFINITY })), /must be finite/);
  assert.throws(() => ledger.recordEvaluation(baseEval({ score: Number.NEGATIVE_INFINITY })), /must be finite/);
  // Finite scores and an absent score are both accepted.
  assert.ok(ledger.recordEvaluation(baseEval({ id: 'finite', score: 0.5 })));
  assert.ok(ledger.recordEvaluation({ ...baseEval({ id: 'no-score' }), score: undefined }));
});

test('recordEvaluation: outcome fields cannot be set at recordEvaluation time (they are stripped by the type)', () => {
  const { ledger } = makeLedger();
  const r = ledger.recordEvaluation(baseEval());
  assert.equal(r.outcome, undefined);
  assert.equal(r.outcomeAt, undefined);
});

// ── Recording outcomes ─────────────────────────────────────────────────

test('recordOutcome: appends ground truth', () => {
  const { ledger, advance } = makeLedger();
  const r = ledger.recordEvaluation(baseEval());
  advance(60_000);
  const updated = ledger.recordOutcome(r.id, 'hit', 'Tornado warning fired 22 min before tornado.');
  assert.equal(updated.outcome, 'hit');
  assert.equal(updated.outcomeAt, NOW + 60_000);
  assert.match(updated.outcomeReason ?? '', /22 min/);
});

test('recordOutcome: refuses to overwrite a graded record', () => {
  const { ledger } = makeLedger();
  const r = ledger.recordEvaluation(baseEval());
  ledger.recordOutcome(r.id, 'hit', 'first');
  assert.throws(() => ledger.recordOutcome(r.id, 'miss', 'second'), /already graded/);
});

test('recordOutcome: throws when the record id is unknown', () => {
  const { ledger } = makeLedger();
  assert.throws(() => ledger.recordOutcome('missing', 'hit', 'x'), /not found/);
});

// ── Filters ────────────────────────────────────────────────────────────

test('byAlgorithm / byDomain / graded / pending', () => {
  const { ledger } = makeLedger();
  const a = ledger.recordEvaluation(baseEval({ algorithmId: 'a', at: NOW + 1 }));
  ledger.recordEvaluation(baseEval({ algorithmId: 'b', at: NOW + 2, domain: 'compound_risk' }));
  ledger.recordOutcome(a.id, 'hit', 'ok');
  assert.deepEqual(ledger.byAlgorithm('a').map((r) => r.id), [a.id]);
  assert.equal(ledger.byDomain('compound_risk').length, 1);
  assert.equal(ledger.graded().length, 1);
  assert.equal(ledger.pending().length, 1);
});

// ── trim / persistence ─────────────────────────────────────────────────

test('trim: drops oldest until cap', () => {
  const { ledger } = makeLedger();
  for (let i = 0; i < 5; i += 1) {
    ledger.recordEvaluation(baseEval({ algorithmId: 'a', at: NOW + i }));
  }
  const removed = ledger.trim(3);
  assert.equal(removed, 2);
  const ids = ledger.all().map((r) => r.id);
  assert.equal(ids.length, 3);
  assert.equal(ids[0], 'eval-3');
});

test('toJson / loadJson: round-trip preserves everything and bumps id counter', () => {
  const { ledger } = makeLedger();
  const r = ledger.recordEvaluation(baseEval({ id: 'eval-7' }));
  ledger.recordOutcome(r.id, 'hit', 'fast');
  const json = ledger.toJson();
  ledger.clear();
  ledger.loadJson(json);
  const reloaded = ledger.get('eval-7');
  assert.equal(reloaded?.outcome, 'hit');
  // After loading id 7, the next assigned id should be 8.
  const next = ledger.recordEvaluation(baseEval());
  assert.equal(next.id, 'eval-8');
});

// ── Calibration roll-up ────────────────────────────────────────────────

test('summarizeCalibration: tallies hits/misses/partials per algorithm', () => {
  const { ledger } = makeLedger();
  const a1 = ledger.recordEvaluation(baseEval({ algorithmId: 'truth-v1', at: NOW + 1 }));
  const a2 = ledger.recordEvaluation(baseEval({ algorithmId: 'truth-v1', at: NOW + 2 }));
  const a3 = ledger.recordEvaluation(baseEval({ algorithmId: 'truth-v1', at: NOW + 3 }));
  const b1 = ledger.recordEvaluation(
    baseEval({ algorithmId: 'compound-v1', at: NOW + 4, domain: 'compound_risk' }),
  );
  ledger.recordOutcome(a1.id, 'hit', '');
  ledger.recordOutcome(a2.id, 'partial', '');
  ledger.recordOutcome(a3.id, 'miss', '');
  ledger.recordOutcome(b1.id, 'hit', '');

  const summary = summarizeCalibration(ledger.all());
  const truth = summary.find((s) => s.algorithmId === 'truth-v1')!;
  assert.equal(truth.graded, 3);
  assert.equal(truth.hits, 1);
  assert.equal(truth.partials, 1);
  assert.equal(truth.misses, 1);
  // hitRate = 1/3
  assert.ok(Math.abs(truth.hitRate - 1 / 3) < 1e-9);
  // weighted = (1 + 0.5)/3 = 0.5
  assert.ok(Math.abs(truth.weightedHitRate - 0.5) < 1e-9);

  const compound = summary.find((s) => s.algorithmId === 'compound-v1')!;
  assert.equal(compound.hits, 1);
  assert.equal(compound.hitRate, 1);
});

test('summarizeCalibration: ignores ungraded records', () => {
  const { ledger } = makeLedger();
  ledger.recordEvaluation(baseEval({ algorithmId: 'a' }));
  const summary = summarizeCalibration(ledger.all());
  assert.equal(summary.length, 0);
});

// ── JSON serializability ───────────────────────────────────────────────

test('records are JSON-serializable', () => {
  const { ledger } = makeLedger();
  const r = ledger.recordEvaluation(baseEval({ detail: { hash: 'x' } }));
  ledger.recordOutcome(r.id, 'partial', 'ok');
  const json = JSON.stringify(ledger.all());
  const parsed = JSON.parse(json) as EvaluationRecord[];
  assert.equal(parsed[0]?.outcome, 'partial');
});
