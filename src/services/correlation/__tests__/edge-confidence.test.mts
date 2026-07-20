import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeEdgeConfidence,
  pairDistanceKm,
  sharedEntityCount,
} from '../edge-confidence';
import type { ObservationEvent } from '../../../types/intelligence';

const HOUR = 3_600_000;

function base(overrides: Partial<Parameters<typeof computeEdgeConfidence>[0]> = {}) {
  return computeEdgeConfidence({
    gapMs: 0,
    timeWindowMs: 6 * HOUR,
    sharedEntityCount: 0,
    ...overrides,
  });
}

test('gap 0 with no other factors scores 1.0', () => {
  const r = base();
  assert.equal(r.value, 1);
  assert.equal(r.factors.temporal, 1);
});

test('temporal kernel hits 0.5 at half the window', () => {
  const r = base({ gapMs: 3 * HOUR });
  assert.ok(Math.abs(r.factors.temporal - 0.5) < 1e-9);
  assert.equal(r.value, 0.5);
});

test('temporal kernel is ~0.25 at the full window', () => {
  const r = base({ gapMs: 6 * HOUR });
  assert.ok(Math.abs(r.factors.temporal - 0.25) < 1e-9);
});

test('value clamps at the 0.2 floor', () => {
  const r = base({ gapMs: 24 * HOUR, timeWindowMs: 6 * HOUR, reliability: 0.5 });
  assert.equal(r.value, 0.2);
});

test('zero/negative window is temporal-neutral, not division blowup', () => {
  assert.equal(base({ timeWindowMs: 0, gapMs: HOUR }).factors.temporal, 1);
  assert.equal(base({ timeWindowMs: -5, gapMs: HOUR }).factors.temporal, 1);
});

test('spatial factor is neutral when distance is unknown', () => {
  const r = base({ distanceKm: undefined });
  assert.equal(r.factors.spatial, 1);
});

test('spatial factor is neutral within 25km', () => {
  assert.equal(base({ distanceKm: 10 }).factors.spatial, 1);
  assert.equal(base({ distanceKm: 25 }).factors.spatial, 1);
});

test('spatial factor decays with distance and floors at 0.5', () => {
  const near = base({ distanceKm: 100 }).factors.spatial;
  const far = base({ distanceKm: 500 }).factors.spatial;
  assert.ok(near < 1 && near > far);
  assert.equal(base({ distanceKm: 5000 }).factors.spatial, 0.5);
});

test('entity boost: 0 shared neutral, 1 shared ×1.15, cap at 2 shared', () => {
  assert.equal(base().factors.entity, 1);
  assert.equal(base({ sharedEntityCount: 1 }).factors.entity, 1.15);
  assert.equal(base({ sharedEntityCount: 2 }).factors.entity, 1.3);
  assert.equal(base({ sharedEntityCount: 7 }).factors.entity, 1.3);
});

test('entity boost cannot push the value above 1', () => {
  const r = base({ sharedEntityCount: 2 });
  assert.equal(r.value, 1);
});

test('baseConfidence disables temporal decay but keeps spatial modulation', () => {
  const r = base({ baseConfidence: 0.8, gapMs: 100 * HOUR, distanceKm: 500 });
  assert.equal(r.factors.temporal, 1);
  assert.equal(r.factors.base, 0.8);
  assert.ok(r.value < 0.8, 'spatial decay still applies');
});

test('reliability multiplier applies and clamps to [0.5, 1.5]', () => {
  assert.equal(base({ reliability: 0.7 }).factors.reliability, 0.7);
  assert.equal(base({ reliability: 0.1 }).factors.reliability, 0.5);
  assert.equal(base({ reliability: 9 }).factors.reliability, 1.5);
  assert.equal(base({ reliability: undefined }).factors.reliability, 1);
});

test('regime factor is boost-only: clamps to [1, 1.15]', () => {
  assert.equal(base({ regimeFactor: 1.15 }).factors.regime, 1.15);
  assert.equal(base({ regimeFactor: 2 }).factors.regime, 1.15);
  assert.equal(base({ regimeFactor: 0.1 }).factors.regime, 1);
  assert.equal(base({ regimeFactor: 0 }).factors.regime, 1);
});

test('non-finite provider values fall back to neutral, never NaN', () => {
  const r = base({
    reliability: Number.NaN,
    regimeFactor: Number.POSITIVE_INFINITY,
    distanceKm: Number.NaN,
    baseConfidence: Number.NaN,
    gapMs: Number.NaN,
    sharedEntityCount: Number.NaN,
  });
  assert.equal(r.factors.reliability, 1);
  assert.ok(r.factors.regime <= 1.15 && Number.isFinite(r.factors.regime));
  assert.equal(r.factors.spatial, 1);
  assert.equal(r.factors.entity, 1);
  assert.ok(Number.isFinite(r.value));
  assert.equal(r.value, 1);
});

test('negative-infinity reliability stays within clamp', () => {
  const r = base({ reliability: Number.NEGATIVE_INFINITY });
  assert.equal(r.factors.reliability, 1);
  assert.ok(Number.isFinite(r.value));
});

test('reliability below 1 lowers an otherwise-perfect pair', () => {
  const r = base({ reliability: 0.6 });
  assert.equal(r.value, 0.6);
});

test('explanation names each non-neutral factor', () => {
  const r = base({
    gapMs: 3 * HOUR,
    distanceKm: 300,
    sharedEntityCount: 1,
    reliability: 0.8,
    regimeFactor: 1.15,
  });
  assert.match(r.explanation, /temporal 0\.50/);
  assert.match(r.explanation, /spatial 0\.\d\d \(300km apart\)/);
  assert.match(r.explanation, /entity ×1\.15 \(1 shared\)/);
  assert.match(r.explanation, /reliability ×0\.80/);
  assert.match(r.explanation, /regime ×1\.15/);
});

test('explanation for a tight neutral pair says so instead of being empty', () => {
  const r = base();
  assert.equal(r.explanation, 'no decay factors (tight pair)');
});

test('explanation for a conviction rule mentions the base factor', () => {
  const r = base({ baseConfidence: 0.85 });
  assert.match(r.explanation, /base 0\.85 \(rule conviction/);
});

test('sharedEntityCount counts distinct intersection only', () => {
  assert.equal(sharedEntityCount(['x', 'y'], ['y', 'y', 'z']), 1);
  assert.equal(sharedEntityCount([], ['a']), 0);
  assert.equal(sharedEntityCount(['a', 'b'], ['b', 'a']), 2);
});

test('pairDistanceKm: haversine when both located, undefined otherwise', () => {
  const at = (lat: number, lon: number): ObservationEvent => ({
    id: 'o', sourceId: 's', domain: 'd', timestamp: 0,
    location: { lat, lon }, severity: 'LOW', title: 't', raw: null,
    entityIds: [], tags: [],
  });
  const noLoc: ObservationEvent = { ...at(0, 0), location: undefined };
  const d = pairDistanceKm(at(41.6, -86.7), at(41.6, -87.7));
  assert.ok(d !== undefined && d > 70 && d < 95, `expected ~83km, got ${d}`);
  assert.equal(pairDistanceKm(noLoc, at(0, 0)), undefined);
  assert.equal(pairDistanceKm(at(0, 0), noLoc), undefined);
});

test('deterministic: identical inputs produce identical outputs', () => {
  const input = { gapMs: HOUR, timeWindowMs: 6 * HOUR, sharedEntityCount: 1, distanceKm: 120 };
  assert.deepEqual(computeEdgeConfidence(input), computeEdgeConfidence(input));
});
