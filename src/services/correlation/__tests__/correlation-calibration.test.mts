import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getCorrelationCalibrationStore,
  recordPairPrediction,
  reliabilityForRule,
  resetCorrelationCalibration,
  resolvePairPredictions,
  startCorrelationCalibration,
} from '../correlation-calibration';
import { pairPredictionId } from '../correlation-outcomes';
import { SituationStoreV2 } from '../../intelligence/situation-store-v2';
import type { CorrelatedPair } from '../../intelligence/correlate-engine';
import type { ObservationEvent } from '../../../types/intelligence';

const T0 = Date.UTC(2026, 6, 1, 12, 0, 0);
const HOUR = 3_600_000;

beforeEach(() => resetCorrelationCalibration());

function obs(id: string, overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id, sourceId: 'src', domain: 'weather', timestamp: T0, severity: 'HIGH',
    title: `event ${id}`, raw: null, entityIds: [], tags: [], ...overrides,
  };
}

function pair(a: string, b: string, ruleId = 'rule-x', confidence = 0.8): CorrelatedPair {
  return {
    ruleId, edgeType: 'causal-candidate',
    eventA: obs(a), eventB: obs(b),
    confidence, detectedAt: new Date(T0),
  };
}

test('recordPairPrediction stores once; duplicate pair is a no-op', () => {
  assert.equal(recordPairPrediction(pair('a', 'b'), T0), true);
  assert.equal(recordPairPrediction(pair('a', 'b'), T0 + 1000), false);
  assert.equal(getCorrelationCalibrationStore().all().length, 1);
});

test('flood control: sixth pair for a rule within an hour is dropped', () => {
  for (let i = 0; i < 5; i++) {
    assert.equal(recordPairPrediction(pair(`a${i}`, `b${i}`, 'noisy'), T0 + i * 60_000), true);
  }
  assert.equal(recordPairPrediction(pair('a9', 'b9', 'noisy'), T0 + 6 * 60_000), false);
  assert.equal(recordPairPrediction(pair('c1', 'd1', 'quiet'), T0 + 6 * 60_000), true);
});

test('reliabilityForRule is neutral below 5 resolved outcomes', () => {
  for (let i = 0; i < 4; i++) {
    recordPairPrediction(pair(`a${i}`, `b${i}`, 'young'), T0 + i * 61_000 * 5);
    getCorrelationCalibrationStore().resolve(
      pairPredictionId(pair(`a${i}`, `b${i}`, 'young')), true, T0 + HOUR,
    );
  }
  assert.equal(reliabilityForRule('young', T0 + 2 * HOUR), 1);
});

test('a miss-heavy rule earns a sub-1 multiplier; a hit-heavy rule earns >1', () => {
  const store = getCorrelationCalibrationStore();
  for (let i = 0; i < 6; i++) {
    const t = T0 + i * 2 * HOUR;
    recordPairPrediction(pair(`m${i}`, `n${i}`, 'bad-rule', 0.9), t);
    store.resolve(pairPredictionId(pair(`m${i}`, `n${i}`, 'bad-rule')), false, t + HOUR);
    recordPairPrediction(pair(`p${i}`, `q${i}`, 'good-rule', 0.9), t);
    store.resolve(pairPredictionId(pair(`p${i}`, `q${i}`, 'good-rule')), true, t + HOUR);
  }
  const bad = reliabilityForRule('bad-rule', T0 + 24 * HOUR);
  const good = reliabilityForRule('good-rule', T0 + 24 * HOUR);
  assert.ok(bad < 1, `bad rule should dampen, got ${bad}`);
  assert.ok(good > 1, `good rule should boost, got ${good}`);
  assert.ok(bad >= 0.5 && good <= 1.5, 'clamped to [0.5, 1.5]');
});

test('reliability cache refreshes when now advances past the TTL', () => {
  const store = getCorrelationCalibrationStore();
  assert.equal(reliabilityForRule('r', T0), 1);
  for (let i = 0; i < 6; i++) {
    const t = T0 + i * 2 * HOUR;
    recordPairPrediction(pair(`x${i}`, `y${i}`, 'r', 0.9), t);
    store.resolve(pairPredictionId(pair(`x${i}`, `y${i}`, 'r')), false, t + HOUR);
  }
  assert.ok(reliabilityForRule('r', T0 + 24 * HOUR) < 1);
});

test('resolvePairPredictions resolves accreted pairs true via situations', () => {
  recordPairPrediction(pair('a', 'b'), T0);
  const situations = [{
    observations: [obs('a'), obs('b'), obs('c')],
    edges: [{ confidence: 0.8 }, { confidence: 0.7 }],
    status: 'active',
  }] as never;
  const { resolved } = resolvePairPredictions(situations, T0 + HOUR);
  assert.equal(resolved, 1);
  const rec = getCorrelationCalibrationStore().get(pairPredictionId(pair('a', 'b')));
  assert.equal(rec!.status, 'resolved_true');
});

test('resolvePairPredictions expires overdue pending pairs', () => {
  recordPairPrediction(pair('a', 'b'), T0);
  const { expired } = resolvePairPredictions([], T0 + 25 * HOUR);
  assert.equal(expired, 1);
  const rec = getCorrelationCalibrationStore().get(pairPredictionId(pair('a', 'b')));
  assert.equal(rec!.status, 'expired');
});

test('expired records do not count toward reliability (Brier excludes them)', () => {
  for (let i = 0; i < 6; i++) {
    recordPairPrediction(pair(`a${i}`, `b${i}`, 'expiry-rule', 0.9), T0 + i * 2 * HOUR);
  }
  resolvePairPredictions([], T0 + 100 * HOUR);
  assert.equal(reliabilityForRule('expiry-rule', T0 + 200 * HOUR), 1);
});

test('end-to-end: a built-in rule match during ingest lands in the ledger', () => {
  const store = new SituationStoreV2({ clock: () => T0 + HOUR });
  const cleanup = startCorrelationCalibration(store);
  try {
    // Red-flag NWS alert + wildfire sharing an entity → weather-wildfire rule.
    store.ingest([
      obs('w1', {
        sourceId: 'nws-alerts', tags: ['red-flag-warning'],
        entityIds: ['county:IN-091'], location: { lat: 40, lon: -86 },
      }),
      obs('f1', {
        sourceId: 'inciweb-wildfire', tags: ['wildfire'],
        entityIds: ['county:IN-091'], location: { lat: 40.1, lon: -86.1 },
        timestamp: T0 + HOUR,
      }),
    ]);
    const recs = getCorrelationCalibrationStore().all();
    assert.equal(recs.length, 1);
    assert.equal(recs[0]!.sourceId, 'corr-rule:weather-wildfire');
    assert.equal(recs[0]!.status, 'pending');
    assert.ok(recs[0]!.probability > 0 && recs[0]!.probability <= 1);
  } finally {
    cleanup();
  }
});

test('startCorrelationCalibration is idempotent and cleanup detaches hooks', () => {
  const store = new SituationStoreV2({ clock: () => T0 });
  const cleanup1 = startCorrelationCalibration(store);
  const cleanup2 = startCorrelationCalibration(store);
  cleanup2();
  cleanup1();
  // After cleanup a new start succeeds again.
  const cleanup3 = startCorrelationCalibration(store);
  cleanup3();
});
