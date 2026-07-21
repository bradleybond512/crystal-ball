import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  islandPredictionId,
  islandReliability,
  islandRuleId,
  recordIslandPrediction,
  startIslandOutcomeTracking,
} from '../island-calibration';
import {
  getCorrelationCalibrationStore,
  resetCorrelationCalibration,
} from '../correlation-calibration';
import type { UnifiedAlert } from '../../unified-alerts';

const T0 = Date.UTC(2026, 6, 1, 12, 0, 0);
const HOUR = 3_600_000;

beforeEach(() => resetCorrelationCalibration());

test('recordIslandPrediction lands in the shared ledger under corr-rule:island:*', () => {
  assert.equal(recordIslandPrediction('corr-3-abc', 'earthquake|infrastructure', 'earthquake', 0.7, T0), true);
  const rec = getCorrelationCalibrationStore().get(islandPredictionId('corr-3-abc'))!;
  assert.equal(rec.sourceId, 'corr-rule:island:earthquake|infrastructure');
  assert.equal(rec.probability, 0.7);
  assert.equal(rec.status, 'pending');
  assert.equal(rec.resolveBy, T0 + 24 * HOUR);
});

test('duplicate alert ids and non-finite confidence are handled safely', () => {
  assert.equal(recordIslandPrediction('a1', 'x|y', 'x', Number.NaN, T0), true);
  assert.equal(getCorrelationCalibrationStore().get(islandPredictionId('a1'))!.probability, 0.5);
  assert.equal(recordIslandPrediction('a1', 'x|y', 'x', 0.9, T0 + 1000), false, 'duplicate id skipped');
});

test('flood control: sixth prediction for one island rule within an hour is dropped', () => {
  for (let i = 0; i < 5; i++) {
    assert.equal(recordIslandPrediction(`a${i}`, 'x|y', 'x', 0.7, T0 + i * 60_000), true);
  }
  assert.equal(recordIslandPrediction('a9', 'x|y', 'x', 0.7, T0 + 6 * 60_000), false);
  assert.equal(recordIslandPrediction('b1', 'other|pair', 'other', 0.7, T0 + 6 * 60_000), true);
});

test('islandReliability: neutral cold, dampens after ≥5 fast-dismissed outcomes', () => {
  assert.equal(islandReliability('x|y', T0), 1);
  const store = getCorrelationCalibrationStore();
  for (let i = 0; i < 6; i++) {
    recordIslandPrediction(`a${i}`, 'x|y', 'x', 0.9, T0 + i * 2 * HOUR);
    store.resolve(islandPredictionId(`a${i}`), false, T0 + i * 2 * HOUR + 1000);
  }
  const mult = islandReliability('x|y', T0 + 24 * HOUR);
  assert.ok(mult < 1 && mult >= 0.5, `noisy island rule dampens, got ${mult}`);
});

// ── outcome tracking ─────────────────────────────────────────────────────

interface FakeAlertStore {
  alerts: UnifiedAlert[];
  listeners: (() => void)[];
  getAll(): UnifiedAlert[];
  subscribe(l: () => void): () => void;
}

function fakeAlertStore(alerts: UnifiedAlert[]): FakeAlertStore {
  return {
    alerts,
    listeners: [],
    getAll() { return this.alerts; },
    subscribe(l) { this.listeners.push(l); return () => {}; },
  };
}

function islandAlert(id: string, overrides: Partial<UnifiedAlert> = {}): UnifiedAlert {
  return {
    id, source: 'correlation', severity: 'high', title: 't', body: 'b',
    timestamp: T0, relevanceScore: 70, acknowledged: false, pinned: false,
    correlationPair: ['earthquake', 'infrastructure'] as never,
    ...overrides,
  } as UnifiedAlert;
}

test('pin resolves the prediction true', () => {
  recordIslandPrediction('c1', 'x|y', 'x', 0.7, T0);
  const store = fakeAlertStore([islandAlert('c1')]);
  let clock = T0;
  const stop = startIslandOutcomeTracking(store, () => clock);
  clock = T0 + HOUR;
  store.alerts = [islandAlert('c1', { pinned: true })];
  store.listeners[0]!();
  assert.equal(getCorrelationCalibrationStore().get(islandPredictionId('c1'))!.status, 'resolved_true');
  stop();
});

test('fast ack (<10s from first sight) resolves false; slow ack stays pending', () => {
  recordIslandPrediction('c2', 'x|y', 'x', 0.7, T0);
  recordIslandPrediction('c3', 'x|y', 'x', 0.7, T0 + 1000);
  const store = fakeAlertStore([islandAlert('c2'), islandAlert('c3')]);
  let clock = T0;
  const stop = startIslandOutcomeTracking(store, () => clock);
  clock = T0 + 5000; // within fast-ack window
  store.alerts = [islandAlert('c2', { acknowledged: true }), islandAlert('c3')];
  store.listeners[0]!();
  assert.equal(getCorrelationCalibrationStore().get(islandPredictionId('c2'))!.status, 'resolved_false');
  clock = T0 + 2 * HOUR; // long after first sight
  store.alerts = [islandAlert('c2', { acknowledged: true }), islandAlert('c3', { acknowledged: true })];
  store.listeners[0]!();
  assert.equal(
    getCorrelationCalibrationStore().get(islandPredictionId('c3'))!.status,
    'pending',
    'considered ack is neutral — left to expiry',
  );
  stop();
});

test('non-island alerts (no correlationPair or other source) are ignored', () => {
  recordIslandPrediction('c4', 'x|y', 'x', 0.7, T0);
  const store = fakeAlertStore([
    islandAlert('c4', { source: 'nws-alerts' as never, pinned: true }),
    islandAlert('other', { correlationPair: undefined, pinned: true }),
  ]);
  const stop = startIslandOutcomeTracking(store, () => T0 + HOUR);
  assert.equal(getCorrelationCalibrationStore().get(islandPredictionId('c4'))!.status, 'pending');
  stop();
});

test('pin wins over a simultaneous fast ack (single resolution)', () => {
  recordIslandPrediction('c5', 'x|y', 'x', 0.7, T0);
  const store = fakeAlertStore([islandAlert('c5')]);
  let clock = T0;
  const stop = startIslandOutcomeTracking(store, () => clock);
  clock = T0 + 3000;
  store.alerts = [islandAlert('c5', { pinned: true, acknowledged: true })];
  store.listeners[0]!();
  assert.equal(getCorrelationCalibrationStore().get(islandPredictionId('c5'))!.status, 'resolved_true');
  stop();
});

test('tracking maps are bounded: evicted alerts are pruned', () => {
  const store = fakeAlertStore([islandAlert('c6')]);
  const stop = startIslandOutcomeTracking(store, () => T0);
  store.alerts = [];
  store.listeners[0]!();
  // Re-appearing later restarts its fast-ack clock (fresh firstSeen) —
  // observable as: an ack long after ORIGINAL first sight still counts
  // as fast if within 10s of re-appearance.
  recordIslandPrediction('c6', 'x|y', 'x', 0.7, T0);
  const s2 = fakeAlertStore([islandAlert('c6')]);
  let clock = T0 + 5 * HOUR;
  const stop2 = startIslandOutcomeTracking(s2, () => clock);
  clock = T0 + 5 * HOUR + 4000;
  s2.alerts = [islandAlert('c6', { acknowledged: true })];
  s2.listeners[0]!();
  assert.equal(getCorrelationCalibrationStore().get(islandPredictionId('c6'))!.status, 'resolved_false');
  stop();
  stop2();
});

test('islandRuleId and islandPredictionId are stable and namespaced', () => {
  assert.equal(islandRuleId('a|b'), 'island:a|b');
  assert.equal(islandPredictionId('corr-3-xyz'), 'island|corr-3-xyz');
  assert.match(islandPredictionId('weird|id'), /^island\|weird%7Cid$/);
});
