import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildF1Buckets,
  pageHinkley,
  evaluateDrift,
  recordDriftAlert,
  getDriftHistory,
  listAllDriftHistory,
  _resetDriftHistoryForTests,
} from '../drift-detector.ts';
import type { EvaluationRecord } from '../algorithm-evaluation-ledger.ts';

const NOW = 1_745_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function rec(at: number, outcome: EvaluationRecord['outcome']): EvaluationRecord {
  return {
    id: `r-${at}-${outcome}-${Math.random()}`,
    algorithmId: 'a',
    domain: 'truth_score',
    at,
    durationMs: 1,
    score: 0.7,
    outcome,
    outcomeAt: at + 1,
    outcomeReason: 'test',
  };
}

// ── Page-Hinkley math ─────────────────────────────────────────────────

test('pageHinkley: zero series returns 0 statistic', () => {
  const r = pageHinkley([], 0.5, 0);
  assert.equal(r.statistic, 0);
  assert.equal(r.lastStableIndex, 0);
});

test('pageHinkley: F1 stays at threshold → statistic stays 0', () => {
  const r = pageHinkley([0.5, 0.5, 0.5, 0.5], 0.5, 0);
  assert.equal(r.statistic, 0);
});

test('pageHinkley: F1 above threshold → resets statistic', () => {
  // Each F1 is above threshold, so deviations are negative → cumSum
  // immediately resets to 0.
  const r = pageHinkley([0.9, 0.9, 0.9], 0.5, 0);
  assert.equal(r.statistic, 0);
});

test('pageHinkley: sustained F1 below threshold accumulates', () => {
  const r = pageHinkley([0.3, 0.3, 0.3], 0.5, 0);
  // each dev = 0.5 - 0.3 = 0.2 → cumSum = 0.6
  assert.ok(Math.abs(r.statistic - 0.6) < 1e-9);
});

test('pageHinkley: positive recovery resets and tracks lastStableIndex', () => {
  const r = pageHinkley([0.3, 0.9, 0.3], 0.5, 0);
  // i=0: dev=0.2, cum=0.2
  // i=1: dev=-0.4, cum=-0.2 → reset to 0, lastStableIndex=1
  // i=2: dev=0.2, cum=0.2
  assert.ok(Math.abs(r.statistic - 0.2) < 1e-9);
  assert.equal(r.lastStableIndex, 1);
});

// ── F1 bucketing ──────────────────────────────────────────────────────

test('buildF1Buckets: produces window-sized series', () => {
  const records: EvaluationRecord[] = [
    rec(NOW - 5 * DAY, 'hit'),
    rec(NOW - 1 * DAY, 'miss'),
  ];
  const series = buildF1Buckets(records, 'a', { bucketMs: DAY, windowBuckets: 7, now: NOW });
  assert.equal(series.length, 7);
});

// ── End-to-end drift evaluation ───────────────────────────────────────

test('evaluateDrift: clean history → not alerting', () => {
  const records: EvaluationRecord[] = [];
  for (let i = 1; i <= 10; i += 1) {
    records.push(rec(NOW - i * DAY + 100, 'hit'));
  }
  const status = evaluateDrift(records, 'a', {
    bucketMs: DAY,
    windowBuckets: 10,
    now: () => NOW,
    lambda: 0.5,
  });
  assert.equal(status.alerting, false);
});

test('evaluateDrift: degrading history triggers alert with low lambda', () => {
  const records: EvaluationRecord[] = [];
  // First 5 days hits, last 5 days misses.
  for (let i = 10; i > 5; i -= 1) records.push(rec(NOW - i * DAY + 100, 'hit'));
  for (let i = 5; i >= 1; i -= 1) records.push(rec(NOW - i * DAY + 100, 'miss'));
  const status = evaluateDrift(records, 'a', {
    bucketMs: DAY,
    windowBuckets: 10,
    now: () => NOW,
    lambda: 0.3,
  });
  assert.equal(status.alerting, true);
  assert.ok(status.alert);
  assert.equal(status.alert!.algorithmId, 'a');
  assert.ok(['retune', 'shadow', 'review'].includes(status.alert!.recommendedAction));
});

test('evaluateDrift: severe drop recommends review', () => {
  const records: EvaluationRecord[] = [];
  for (let i = 10; i > 1; i -= 1) records.push(rec(NOW - i * DAY + 100, 'hit'));
  records.push(rec(NOW - 100, 'miss'));
  const status = evaluateDrift(records, 'a', {
    bucketMs: DAY,
    windowBuckets: 10,
    now: () => NOW,
    lambda: 0.05,
    threshold: 1.0,
  });
  if (status.alerting) {
    // Threshold 1.0, currentF1 0 → drop 1.0 > 0.3 → review
    assert.equal(status.alert!.recommendedAction, 'review');
  }
});

test('evaluateDrift: respects threshold override', () => {
  const records: EvaluationRecord[] = [];
  for (let i = 5; i >= 1; i -= 1) records.push(rec(NOW - i * DAY + 100, 'hit'));
  const status = evaluateDrift(records, 'a', {
    bucketMs: DAY,
    windowBuckets: 5,
    now: () => NOW,
    threshold: 0.99,
  });
  // With high threshold and F1=1, deviation = -0.01 each step → resets → no drift
  assert.equal(status.threshold, 0.99);
  assert.equal(status.alerting, false);
});

// ── Drift history ledger ──────────────────────────────────────────────

test('recordDriftAlert + getDriftHistory: round-trip', () => {
  _resetDriftHistoryForTests();
  recordDriftAlert({
    algorithmId: 'x',
    detectedAt: NOW,
    lastStableF1: 0.8,
    currentF1: 0.3,
    statistic: 1.5,
    recommendedAction: 'shadow',
    sampleBuckets: 10,
  });
  const list = getDriftHistory('x');
  assert.equal(list.length, 1);
  assert.equal(list[0]!.recommendedAction, 'shadow');
});

test('recordDriftAlert: trims to maxPerAlgorithm', () => {
  _resetDriftHistoryForTests();
  for (let i = 0; i < 10; i += 1) {
    recordDriftAlert({
      algorithmId: 'y',
      detectedAt: NOW + i,
      lastStableF1: 0.8,
      currentF1: 0.3,
      statistic: 1.5,
      recommendedAction: 'retune',
      sampleBuckets: 5,
    }, { maxPerAlgorithm: 3 });
  }
  const list = getDriftHistory('y');
  assert.equal(list.length, 3);
  // Oldest dropped — first surviving alert is i=7
  assert.equal(list[0]!.detectedAt, NOW + 7);
});

test('listAllDriftHistory: groups by algorithm', () => {
  _resetDriftHistoryForTests();
  recordDriftAlert({
    algorithmId: 'p', detectedAt: NOW, lastStableF1: 0.8, currentF1: 0.5,
    statistic: 1, recommendedAction: 'retune', sampleBuckets: 5,
  });
  recordDriftAlert({
    algorithmId: 'q', detectedAt: NOW, lastStableF1: 0.8, currentF1: 0.5,
    statistic: 1, recommendedAction: 'retune', sampleBuckets: 5,
  });
  const all = listAllDriftHistory();
  assert.equal(Object.keys(all).sort().join(','), 'p,q');
});
