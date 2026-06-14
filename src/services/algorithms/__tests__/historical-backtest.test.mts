import assert from 'node:assert/strict';
import test from 'node:test';

import {
  backtestChange,
  backtestPassesForChange,
  isBacktestable,
  DEFAULT_WINDOW_DAYS,
  MIN_DECISIVE_SAMPLES,
  __internals,
  type BacktestChange,
} from '../historical-backtest.ts';
import type { EvaluationRecord, EvaluationOutcome } from '../algorithm-evaluation-ledger.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;

let _seq = 0;
function rec(
  score: number | undefined,
  outcome: EvaluationOutcome | undefined,
  at: number,
  algorithmId = 'big-event-detector',
): EvaluationRecord {
  return {
    id: `r-${_seq++}`,
    algorithmId,
    domain: 'reasoning_hypothesis',
    at,
    durationMs: 1,
    score,
    outcome,
  };
}

/** Build N records all in-window (at = NOW - DAY). */
function inWindow(
  specs: ReadonlyArray<{ score: number; outcome: EvaluationOutcome; n: number }>,
): EvaluationRecord[] {
  const out: EvaluationRecord[] = [];
  for (const s of specs) {
    for (let i = 0; i < s.n; i += 1) out.push(rec(s.score, s.outcome, NOW - DAY));
  }
  return out;
}

const CHANGE = (priorValue: number, nextValue: number): BacktestChange => ({
  algorithmId: 'big-event-detector',
  parameterId: 'threshold',
  priorValue,
  nextValue,
});

// ── isBacktestable / registry ─────────────────────────────────────────────

test('isBacktestable: big-event-detector threshold is backtestable, others are not', () => {
  assert.equal(isBacktestable('big-event-detector', 'threshold'), true);
  assert.equal(isBacktestable('negative-evidence', 'maxPenalty'), false);
  assert.equal(isBacktestable('unknown-algo', 'whatever'), false);
});

test('registry only declares score-comparable knobs', () => {
  for (const v of Object.values(__internals.BACKTESTABLE_KNOBS)) {
    assert.ok(v.compare === 'score_ge' || v.compare === 'score_lt');
  }
});

// ── Fail-closed paths ──────────────────────────────────────────────────────

test('non-backtestable knob fails closed with NaN scores', () => {
  const change: BacktestChange = { algorithmId: 'negative-evidence', parameterId: 'maxPenalty', priorValue: 0.6, nextValue: 0.5 };
  const r = backtestChange(change, [], { now: NOW });
  assert.equal(r.verdict, 'fail');
  assert.ok(Number.isNaN(r.currentScore));
  assert.ok(Number.isNaN(r.backtestScore));
  assert.match(r.reason, /not backtestable/);
});

test('non-finite prior or candidate fails closed', () => {
  const r = backtestChange(CHANGE(Number.NaN, 45), inWindow([{ score: 0.5, outcome: 'hit', n: 20 }]), { now: NOW });
  assert.equal(r.verdict, 'fail');
  assert.match(r.reason, /finite/);
});

test('insufficient decisive samples fails closed and reports the count', () => {
  const records = inWindow([{ score: 0.5, outcome: 'hit', n: MIN_DECISIVE_SAMPLES - 1 }]);
  const r = backtestChange(CHANGE(40, 45), records, { now: NOW });
  assert.equal(r.verdict, 'fail');
  assert.equal(r.sampleSize, MIN_DECISIVE_SAMPLES - 1);
  assert.match(r.reason, /decisive sample/);
});

// ── Filtering: window, outcome, score, algorithm ───────────────────────────

test('records outside the 30-day window are excluded', () => {
  // 15 in-window, 15 stale (older than 30 days). Only in-window count.
  const records: EvaluationRecord[] = [
    ...inWindow([{ score: 0.5, outcome: 'hit', n: 15 }]),
    ...Array.from({ length: 15 }, () => rec(0.5, 'hit' as const, NOW - (DEFAULT_WINDOW_DAYS + 5) * DAY)),
  ];
  const r = backtestChange(CHANGE(40, 41), records, { now: NOW });
  assert.equal(r.sampleSize, 15);
});

test('window boundary is inclusive at windowStart, exclusive before it', () => {
  const windowStart = NOW - DEFAULT_WINDOW_DAYS * DAY;
  const records: EvaluationRecord[] = [
    ...Array.from({ length: 12 }, () => rec(0.5, 'hit' as const, windowStart)),       // inclusive → counted
    ...Array.from({ length: 12 }, () => rec(0.5, 'hit' as const, windowStart - 1)),   // before → excluded
  ];
  const r = backtestChange(CHANGE(40, 41), records, { now: NOW });
  assert.equal(r.sampleSize, 12);
});

test('inconclusive outcomes and missing scores are excluded from the sample', () => {
  const records: EvaluationRecord[] = [
    ...inWindow([{ score: 0.5, outcome: 'hit', n: 12 }]),
    ...Array.from({ length: 5 }, () => rec(0.5, 'inconclusive' as const, NOW - DAY)),
    ...Array.from({ length: 5 }, () => rec(undefined, 'hit' as const, NOW - DAY)),
  ];
  const r = backtestChange(CHANGE(40, 41), records, { now: NOW });
  assert.equal(r.sampleSize, 12);
});

test('records from a different algorithm are excluded', () => {
  const records: EvaluationRecord[] = [
    ...inWindow([{ score: 0.5, outcome: 'hit', n: 12 }]),
    ...Array.from({ length: 8 }, () => rec(0.5, 'miss' as const, NOW - DAY, 'some-other-algo')),
  ];
  const r = backtestChange(CHANGE(40, 41), records, { now: NOW });
  assert.equal(r.sampleSize, 12);
});

// ── Accuracy replay ────────────────────────────────────────────────────────

test('currentScore recovers the weighted hit rate at the prior threshold', () => {
  // 16 hits + 4 misses, all fire at prior=40 (score 50). accuracy = 16/20 = 0.8.
  const records = inWindow([
    { score: 0.5, outcome: 'hit', n: 16 },
    { score: 0.5, outcome: 'miss', n: 4 },
  ]);
  const r = backtestChange(CHANGE(40, 40), records, { now: NOW });
  assert.ok(Math.abs(r.currentScore - 0.8) < 1e-9);
});

test('candidate that fixes false positives passes (accuracy improves)', () => {
  // 10 hits @50 (should-fire true), 5 misses @42 (fired at prior but should-NOT fire).
  // Raising threshold to 45 stops the false positives firing → accuracy 0.667 → 1.0.
  const records = inWindow([
    { score: 0.5, outcome: 'hit', n: 10 },
    { score: 0.42, outcome: 'miss', n: 5 },
  ]);
  const r = backtestChange(CHANGE(40, 45), records, { now: NOW });
  assert.equal(r.verdict, 'pass');
  assert.ok(Math.abs(r.currentScore - 10 / 15) < 1e-9);
  assert.ok(Math.abs(r.backtestScore - 1) < 1e-9);
  assert.ok(r.delta > 0);
});

test('candidate that regresses accuracy is blocked', () => {
  // Same set, but raise threshold to 55 — now the genuine hits @50 stop firing.
  const records = inWindow([
    { score: 0.5, outcome: 'hit', n: 10 },
    { score: 0.42, outcome: 'miss', n: 5 },
  ]);
  const r = backtestChange(CHANGE(40, 55), records, { now: NOW });
  assert.equal(r.verdict, 'fail');
  assert.ok(r.delta < 0);
  assert.match(r.reason, /regress|blocked/);
});

test('candidate with equal accuracy is not blocked (no measurable regression)', () => {
  // prior=40, candidate=41: hits @50 still fire, misses @42 still fire → identical.
  const records = inWindow([
    { score: 0.5, outcome: 'hit', n: 10 },
    { score: 0.42, outcome: 'miss', n: 5 },
  ]);
  const r = backtestChange(CHANGE(40, 41), records, { now: NOW });
  assert.equal(r.verdict, 'pass');
  assert.ok(Math.abs(r.delta) < 1e-9);
});

test('partial outcomes contribute half weight', () => {
  // 12 partials @50 only. At prior=40 they fire and (partial → should-fire=firedPrior)
  // are correct → accuracy 1.0. sampleSize counts them; total weight = 6.
  const records = inWindow([{ score: 0.5, outcome: 'partial', n: 12 }]);
  const r = backtestChange(CHANGE(40, 40), records, { now: NOW });
  assert.equal(r.sampleSize, 12);
  assert.ok(Math.abs(r.currentScore - 1) < 1e-9);
});

// ── Convenience boolean ────────────────────────────────────────────────────

test('backtestPassesForChange mirrors the verdict', () => {
  const records = inWindow([
    { score: 0.5, outcome: 'hit', n: 10 },
    { score: 0.42, outcome: 'miss', n: 5 },
  ]);
  assert.equal(backtestPassesForChange(CHANGE(40, 45), records, { now: NOW }), true);
  assert.equal(backtestPassesForChange(CHANGE(40, 55), records, { now: NOW }), false);
  // Fail-closed for a non-backtestable knob.
  assert.equal(
    backtestPassesForChange({ algorithmId: 'x', parameterId: 'y', priorValue: 1, nextValue: 2 }, records, { now: NOW }),
    false,
  );
});

test('custom windowDays is honored', () => {
  // A 7-day window excludes records 10 days old.
  const records = Array.from({ length: 12 }, () => rec(0.5, 'hit' as const, NOW - 10 * DAY));
  const wide = backtestChange(CHANGE(40, 41), records, { now: NOW, windowDays: 30 });
  const narrow = backtestChange(CHANGE(40, 41), records, { now: NOW, windowDays: 7 });
  assert.equal(wide.sampleSize, 12);
  assert.equal(narrow.verdict, 'fail');
  assert.equal(narrow.sampleSize, 0);
});

// ── Scale normalization (regression guard) ─────────────────────────────────
// The big-event-detector ledger records `score: totalScore / 100` (a 0..1
// value) while its `threshold` knob lives on the 0..100 totalScore scale
// (range 20..60). The recorded score MUST be scaled back up before comparison,
// otherwise `score >= threshold` is one-sided for every threshold and the gate
// silently passes any change. These records use realistic 0..1 scores so the
// suite exercises that normalization end to end.

test('recorded scores are normalized to the knob scale (raising past the cluster discriminates)', () => {
  // Genuine big events cluster at totalScore 50 (recorded 0.50). At the prior
  // threshold 40 they correctly fire; raising the threshold to 55 stops them
  // firing and MUST register as a regression. Without scale normalization the
  // recorded 0.50 is below every threshold in [20,60], so every threshold
  // scores identically and a real regression would slip through as "equal".
  const records = inWindow([{ score: 0.5, outcome: 'hit', n: 18 }]);
  const r = backtestChange(CHANGE(40, 55), records, { now: NOW });
  assert.equal(r.verdict, 'fail');
  assert.ok(Math.abs(r.currentScore - 1) < 1e-9, 'all hits fire at prior 40 → accuracy 1.0');
  assert.ok(Math.abs(r.backtestScore - 0) < 1e-9, 'no hits fire at 55 → accuracy 0.0');
  assert.ok(r.delta < 0);
});
