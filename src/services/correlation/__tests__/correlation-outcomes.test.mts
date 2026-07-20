import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessPairOutcome,
  buildPairPrediction,
  DEFAULT_RESOLVE_HORIZON_MS,
  factDomainFor,
  observationIdsFromPredictionId,
  pairPredictionId,
  shouldRecordPair,
  type SituationLite,
} from '../correlation-outcomes';
import type { CorrelatedPair } from '../../intelligence/correlate-engine';
import type { ObservationEvent } from '../../../types/intelligence';
import type { PredictionRecord } from '../../intelligence/forecast-calibration';

const T0 = Date.UTC(2026, 6, 1, 12, 0, 0);
const HOUR = 3_600_000;

function obs(id: string, domain = 'weather'): ObservationEvent {
  return {
    id, sourceId: 'src', domain, timestamp: T0, severity: 'MEDIUM',
    title: `event ${id}`, raw: null, entityIds: [], tags: [],
  };
}

function pair(a: string, b: string, ruleId = 'weather-wildfire', confidence = 0.8): CorrelatedPair {
  return {
    ruleId, edgeType: 'causal-candidate',
    eventA: obs(a), eventB: obs(b),
    confidence, detectedAt: new Date(T0),
  };
}

test('pairPredictionId is order-independent and rule-scoped', () => {
  assert.equal(pairPredictionId(pair('x', 'y')), pairPredictionId(pair('y', 'x')));
  assert.notEqual(
    pairPredictionId(pair('x', 'y', 'rule-a')),
    pairPredictionId(pair('x', 'y', 'rule-b')),
  );
});

test('observationIdsFromPredictionId round-trips', () => {
  const id = pairPredictionId(pair('obs-1', 'obs-2'));
  assert.deepEqual(observationIdsFromPredictionId(id), { a: 'obs-1', b: 'obs-2' });
});

test('observationIdsFromPredictionId rejects foreign or malformed ids', () => {
  assert.equal(observationIdsFromPredictionId('some-other-prediction'), null);
  assert.equal(observationIdsFromPredictionId('corr|rule|only-one'), null);
  assert.equal(observationIdsFromPredictionId('corr|rule|a|b|extra'), null);
});

test('buildPairPrediction carries confidence as probability and 24h horizon', () => {
  const p = buildPairPrediction(pair('a', 'b', 'r1', 0.65), T0);
  assert.equal(p.probability, 0.65);
  assert.equal(p.sourceId, 'corr-rule:r1');
  assert.equal(p.predictedAt, T0);
  assert.equal(p.resolveBy, T0 + DEFAULT_RESOLVE_HORIZON_MS);
  assert.equal(p.status, 'pending');
  assert.match(p.claim, /corroboration expected within 24h/);
});

test('factDomainFor maps known domains and falls back to other', () => {
  assert.equal(factDomainFor('weather'), 'weather');
  assert.equal(factDomainFor('wildfire'), 'weather');
  assert.equal(factDomainFor('space-weather'), 'space');
  assert.equal(factDomainFor('infrastructure'), 'infra');
  assert.equal(factDomainFor('seismic'), 'other');
  assert.equal(factDomainFor(''), 'other');
});

function rec(ruleId: string, predictedAt: number): PredictionRecord {
  return buildPairPrediction(pair(`a${predictedAt}`, `b${predictedAt}`, ruleId), predictedAt);
}

test('shouldRecordPair allows up to 5 per rule per rolling hour', () => {
  const existing = [0, 1, 2, 3].map((i) => rec('r1', T0 + i * 60_000));
  assert.equal(shouldRecordPair(existing, 'r1', T0 + 5 * 60_000), true);
  const atCap = [...existing, rec('r1', T0 + 4 * 60_000)];
  assert.equal(shouldRecordPair(atCap, 'r1', T0 + 5 * 60_000), false);
});

test('shouldRecordPair: old records age out of the rolling window', () => {
  const old = [0, 1, 2, 3, 4].map((i) => rec('r1', T0 + i * 60_000));
  assert.equal(shouldRecordPair(old, 'r1', T0 + 2 * HOUR), true);
});

test('shouldRecordPair: other rules do not count against the cap', () => {
  const other = [0, 1, 2, 3, 4].map((i) => rec('other-rule', T0 + i * 60_000));
  assert.equal(shouldRecordPair(other, 'r1', T0 + 5 * 60_000), true);
});

function lite(ids: string[], edges: number, status: SituationLite['status'] = 'active'): SituationLite {
  return { observationIds: ids, edgeCount: edges, status };
}

test('assessPairOutcome: accretion by third observation resolves true', () => {
  const id = pairPredictionId(pair('a', 'b'));
  assert.equal(assessPairOutcome(id, [lite(['a', 'b', 'c'], 1)]), true);
});

test('assessPairOutcome: accretion by second edge resolves true', () => {
  const id = pairPredictionId(pair('a', 'b'));
  assert.equal(assessPairOutcome(id, [lite(['a', 'b'], 2)]), true);
});

test('assessPairOutcome: situation resolved without accretion resolves false', () => {
  const id = pairPredictionId(pair('a', 'b'));
  assert.equal(assessPairOutcome(id, [lite(['a', 'b'], 1, 'resolved')]), false);
});

test('assessPairOutcome: live un-accreted situation stays pending', () => {
  const id = pairPredictionId(pair('a', 'b'));
  assert.equal(assessPairOutcome(id, [lite(['a', 'b'], 1)]), null);
});

test('assessPairOutcome: evicted pair (no situation holds both) stays pending', () => {
  const id = pairPredictionId(pair('a', 'b'));
  assert.equal(assessPairOutcome(id, [lite(['a', 'z'], 3), lite(['b'], 0)]), null);
});

test('assessPairOutcome ignores foreign prediction ids', () => {
  assert.equal(assessPairOutcome('shortage-wheat-123', [lite(['a', 'b', 'c'], 5)]), null);
});
