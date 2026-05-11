import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildIsolationForest,
  isolationForestScore,
  detectBlackSwan,
  recordBlackSwanScore,
  recordBlackSwanAlert,
  getBlackSwanStatus,
  _resetBlackSwanCacheForTests,
  type EventFeatures,
} from '../blackswan-detector.ts';

const NOW = 1_745_000_000_000;

function makeRng(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 0x1_0000_0000;
    return s / 0x1_0000_0000;
  };
}

function evt(id: string, features: number[], at: number = NOW): EventFeatures {
  return { id, features, at };
}

// ── Forest building ───────────────────────────────────────────────────

test('buildIsolationForest: empty history → empty forest', () => {
  const f = buildIsolationForest([]);
  assert.equal(f.trees.length, 0);
  assert.equal(f.sampleSize, 0);
});

test('buildIsolationForest: respects tree count', () => {
  const history: EventFeatures[] = Array.from({ length: 30 }, (_, i) => evt(`h${i}`, [i, i * 2]));
  const f = buildIsolationForest(history, { trees: 10, sampleSize: 16, rng: makeRng(7) });
  assert.equal(f.trees.length, 10);
});

// ── Scoring ───────────────────────────────────────────────────────────

test('isolationForestScore: empty forest → 0', () => {
  const f = buildIsolationForest([]);
  assert.equal(isolationForestScore(f, [1, 2]), 0);
});

test('isolationForestScore: in-distribution point scores low', () => {
  const history: EventFeatures[] = Array.from({ length: 100 }, (_, i) =>
    evt(`h${i}`, [(i % 10) / 10, ((i * 7) % 10) / 10]),
  );
  const f = buildIsolationForest(history, { trees: 50, sampleSize: 32, rng: makeRng(11) });
  const inDist = isolationForestScore(f, [0.4, 0.5]);
  const outOfDist = isolationForestScore(f, [50, 50]);
  assert.ok(outOfDist > inDist, `out-of-dist (${outOfDist}) should exceed in-dist (${inDist})`);
});

// ── End-to-end detection ──────────────────────────────────────────────

test('detectBlackSwan: in-distribution → null alert', () => {
  const history: EventFeatures[] = Array.from({ length: 50 }, (_, i) => evt(`h${i}`, [i / 50, 0.5]));
  const candidate = evt('cand', [0.5, 0.5]);
  const result = detectBlackSwan({
    candidate,
    history,
    threshold: 0.85,
    forestOptions: { trees: 30, sampleSize: 16, rng: makeRng(3) },
    now: () => NOW,
  });
  assert.equal(result.alert, null);
});

test('detectBlackSwan: extreme outlier → alert with suggestion', () => {
  const history: EventFeatures[] = Array.from({ length: 50 }, (_, i) => evt(`h${i}`, [i / 50, 0.5]));
  const candidate = evt('outlier', [1e6, 1e6]);
  const result = detectBlackSwan({
    candidate,
    history,
    affectedAlgorithms: ['truth-score', 'compound-risk'],
    nearestHistoricalAnalog: 'analog-1',
    threshold: 0.85,
    forestOptions: { trees: 30, sampleSize: 16, rng: makeRng(3) },
    now: () => NOW,
  });
  assert.ok(result.alert);
  assert.equal(result.alert!.eventId, 'outlier');
  assert.equal(result.alert!.affectedAlgorithms.length, 2);
  assert.equal(result.alert!.nearestHistoricalAnalog, 'analog-1');
  assert.ok([
    'monitor',
    'expand_window',
    'consult_analog',
    'escalate_to_review',
  ].includes(result.alert!.suggestedAction));
});

test('detectBlackSwan: passes through nearestHistoricalAnalog as null when omitted', () => {
  const history: EventFeatures[] = Array.from({ length: 30 }, (_, i) => evt(`h${i}`, [i / 30]));
  const candidate = evt('o', [9999]);
  const result = detectBlackSwan({
    candidate,
    history,
    threshold: 0.5,
    forestOptions: { trees: 20, sampleSize: 16, rng: makeRng(5) },
    now: () => NOW,
  });
  if (result.alert) {
    assert.equal(result.alert.nearestHistoricalAnalog, null);
  }
});

// ── Status cache ──────────────────────────────────────────────────────

test('recordBlackSwanScore: trims to 200', () => {
  _resetBlackSwanCacheForTests();
  for (let i = 0; i < 250; i += 1) recordBlackSwanScore(`e${i}`, 0.1, NOW + i);
  const status = getBlackSwanStatus(NOW);
  assert.equal(status.recentScores.length, 200);
});

test('recordBlackSwanAlert: stored and retrievable', () => {
  _resetBlackSwanCacheForTests();
  recordBlackSwanAlert({
    detectedAt: NOW,
    eventId: 'e1',
    anomalyScore: 0.95,
    affectedAlgorithms: ['a'],
    nearestHistoricalAnalog: null,
    suggestedAction: 'escalate_to_review',
  });
  const status = getBlackSwanStatus(NOW);
  assert.equal(status.alerts.length, 1);
});
