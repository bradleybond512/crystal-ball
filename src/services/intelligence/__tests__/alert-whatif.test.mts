import assert from 'node:assert/strict';
import test from 'node:test';

import { whatIfAlert, advanceClock } from '../alert-whatif.ts';
import type { AlertSignal } from '../alert-prioritization.ts';

const HOUR = 3_600_000;

function alert(overrides: Partial<AlertSignal>): AlertSignal {
  return { id: 'a', probability: 0.8, impact: 50, ...overrides };
}

// ── whatIfAlert ──────────────────────────────────────────────────────────────

test('whatIfAlert: raising probability lifts score and crosses into act_now', () => {
  const alerts = [alert({ id: 'x', probability: 0.4, impact: 100, timeToDeadlineMs: 0 })]; // score 40 → prepare
  const r = whatIfAlert(alerts, 'x', { probability: 0.9 })!;
  assert.ok(r.scoreDelta > 0);
  assert.equal(r.recommendationBefore, 'prepare');
  assert.equal(r.recommendationAfter, 'act_now');
  assert.equal(r.crossedIntoActNow, true);
  assert.match(r.summary, /now ACT NOW/);
});

test('whatIfAlert: probabilityDelta is added on top of the current probability', () => {
  const alerts = [alert({ id: 'x', probability: 0.4, impact: 100, timeToDeadlineMs: 0 })];
  const r = whatIfAlert(alerts, 'x', { probabilityDelta: 0.5 })!; // 0.4 + 0.5 = 0.9
  assert.equal(r.after.components.calibratedProbability, 0.9);
});

test('whatIfAlert: a mutation can move an alert up past another in rank', () => {
  const alerts = [
    alert({ id: 'low', probability: 0.3, impact: 100, timeToDeadlineMs: 0 }),  // 30
    alert({ id: 'high', probability: 0.9, impact: 100, timeToDeadlineMs: 0 }), // 90
  ];
  const r = whatIfAlert(alerts, 'low', { probability: 1 })!; // 100, overtakes 'high'
  assert.equal(r.rankBefore, 2);
  assert.equal(r.rankAfter, 1);
  assert.equal(r.rankDelta, 1);
  assert.match(r.summary, /rises #2→#1/);
});

test('whatIfAlert: lowering probability drops rank', () => {
  const alerts = [
    alert({ id: 'a', probability: 0.9, impact: 100, timeToDeadlineMs: 0 }),
    alert({ id: 'b', probability: 0.5, impact: 100, timeToDeadlineMs: 0 }),
  ];
  const r = whatIfAlert(alerts, 'a', { probability: 0.1 })!;
  assert.equal(r.rankBefore, 1);
  assert.equal(r.rankAfter, 2);
  assert.ok(r.scoreDelta < 0);
});

test('whatIfAlert: unknown id → undefined', () => {
  assert.equal(whatIfAlert([alert({ id: 'x' })], 'nope', { probability: 1 }), undefined);
});

// ── advanceClock ─────────────────────────────────────────────────────────────

test('advanceClock: an approaching deadline pushes an alert into act_now', () => {
  const alerts = [alert({ id: 'x', probability: 1, impact: 100, timeToDeadlineMs: 25 * HOUR })]; // baseline urgency → 30
  const r = advanceClock(alerts, 24.5 * HOUR, {}); // deadline → 0.5h, urgency maxes
  assert.deepEqual(r.newlyActNow, ['x']);
  const after = r.after.find((p) => p.id === 'x')!;
  assert.equal(after.recommendation, 'act_now');
});

test('advanceClock: deadline-less alerts are unaffected', () => {
  const alerts = [alert({ id: 'no-deadline', probability: 1, impact: 100 })];
  const r = advanceClock(alerts, 10 * HOUR, {});
  const before = r.before.find((p) => p.id === 'no-deadline')!;
  const after = r.after.find((p) => p.id === 'no-deadline')!;
  assert.equal(before.score, after.score);
  assert.deepEqual(r.newlyActNow, []);
});

test('advanceClock: already-urgent alerts are not double-counted as newly act_now', () => {
  const alerts = [alert({ id: 'x', probability: 1, impact: 100, timeToDeadlineMs: 0 })]; // already act_now
  const r = advanceClock(alerts, HOUR, {});
  assert.deepEqual(r.newlyActNow, []);
});
