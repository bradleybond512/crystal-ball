import assert from 'node:assert/strict';
import test from 'node:test';

import { inferOutcome, resolveWithProxy, type ProxySignal } from '../proxy-outcomes.ts';
import { createForecastCalibrationStore, type PredictionRecord } from '../forecast-calibration.ts';

const NOW = 1_745_000_000_000;

function sig(polarity: ProxySignal['polarity'], strength: number, id = `${polarity}-${strength}`): ProxySignal {
  return { id, polarity, strength, observedAt: NOW };
}

test('confirming proxies dominate → resolved_true with confidence', () => {
  const r = inferOutcome([sig('confirming', 0.8), sig('confirming', 0.6)]);
  assert.equal(r.outcome, 'resolved_true');
  assert.ok(r.confidence > 0, `confidence ${r.confidence}`);
  assert.ok(r.netScore > 0.9);
});

test('refuting proxies dominate → resolved_false', () => {
  const r = inferOutcome([sig('refuting', 0.7), sig('confirming', 0.1)]);
  assert.equal(r.outcome, 'resolved_false');
  assert.ok(r.netScore < 0);
});

test('insufficient evidence → unknown', () => {
  const r = inferOutcome([sig('confirming', 0.2)], { minEvidence: 0.5 });
  assert.equal(r.outcome, 'unknown');
  assert.equal(r.confidence, 0);
});

test('conflicting proxies near parity → unknown (never guesses)', () => {
  const r = inferOutcome([sig('confirming', 0.5), sig('refuting', 0.5)], { decisionThreshold: 0.3 });
  assert.equal(r.outcome, 'unknown');
});

test('resolveWithProxy resolves a pending prediction when decisive', () => {
  const store = createForecastCalibrationStore();
  const rec: PredictionRecord = {
    id: 'p1', sourceId: 'weather-model', domain: 'weather',
    claim: 'severe wind at site within 6h', probability: 0.7,
    predictedAt: NOW, resolveBy: NOW + 6 * 3_600_000, status: 'pending',
  };
  store.record(rec);
  const res = resolveWithProxy(store, 'p1', [sig('confirming', 0.9), sig('confirming', 0.7)], { when: NOW + 1000 });
  assert.equal(res.resolved, true);
  assert.equal(store.get('p1')?.status, 'resolved_true');
});

test('a NaN strength carries no evidence → unknown, never a false resolution', () => {
  const r = inferOutcome([{ id: 'x', polarity: 'refuting', strength: Number.NaN, observedAt: NOW }]);
  assert.equal(r.outcome, 'unknown');
  assert.equal(r.evidence, 0);

  const store = createForecastCalibrationStore();
  store.record({
    id: 'p3', sourceId: 'm', domain: 'weather', claim: 'c', probability: 0.5,
    predictedAt: NOW, resolveBy: NOW + 3_600_000, status: 'pending',
  });
  const res = resolveWithProxy(store, 'p3', [{ id: 'x', polarity: 'refuting', strength: Number.NaN, observedAt: NOW }]);
  assert.equal(res.resolved, false);
  assert.equal(store.get('p3')?.status, 'pending');
});

test('resolveWithProxy leaves the prediction pending when proxies are weak', () => {
  const store = createForecastCalibrationStore();
  store.record({
    id: 'p2', sourceId: 'cyber-model', domain: 'cyber',
    claim: 'intrusion confirmed', probability: 0.5,
    predictedAt: NOW, resolveBy: NOW + 86_400_000, status: 'pending',
  });
  const res = resolveWithProxy(store, 'p2', [sig('confirming', 0.2)], { minConfidence: 0.4 });
  assert.equal(res.resolved, false);
  assert.equal(store.get('p2')?.status, 'pending');
});
