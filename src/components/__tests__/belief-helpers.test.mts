import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBelief,
  noisyOr,
  logOddsUpdate,
  applyStalenessDegradation,
  getProbabilityLabel,
  fromLegacySeverity,
  propagateConfidence,
  formatBelief,
  isStale,
  intervalWidth,
  ensureFresh,
} from '../belief-helpers.ts';
import type { BeliefValue } from '../../types/belief.ts';

const approx = (actual: number, expected: number, eps = 1e-9): void => {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `expected ${actual} ≈ ${expected} (±${eps})`,
  );
};

const inUnit = (b: BeliefValue): void => {
  assert.ok(b.point >= 0 && b.point <= 1, `point ${b.point} in [0,1]`);
  assert.ok(b.lower >= 0 && b.lower <= 1, `lower ${b.lower} in [0,1]`);
  assert.ok(b.upper >= 0 && b.upper <= 1, `upper ${b.upper} in [0,1]`);
  assert.ok(b.lower <= b.upper, `lower ${b.lower} <= upper ${b.upper}`);
};

// ── createBelief ───────────────────────────────────────────────────────────

test('createBelief sets point and a default symmetric interval', () => {
  const b = createBelief(0.7);
  approx(b.point, 0.7);
  approx(b.lower, 0.6);
  approx(b.upper, 0.8);
});

test('createBelief defaults provenance, assumptions, staleness, and rule', () => {
  const b = createBelief(0.5);
  assert.deepEqual(b.provenance, []);
  assert.deepEqual(b.assumptionIds, []);
  approx(b.stalenessFactor, 0);
  assert.equal(b.combiningRule, 'average');
  assert.equal(typeof b.updatedAt, 'string');
  assert.ok(!Number.isNaN(Date.parse(b.updatedAt)));
});

test('createBelief clamps the default interval into [0,1] near the top', () => {
  const b = createBelief(0.95);
  approx(b.lower, 0.85);
  approx(b.upper, 1);
  inUnit(b);
});

test('createBelief clamps the default interval into [0,1] near the bottom', () => {
  const b = createBelief(0.05);
  approx(b.lower, 0);
  approx(b.upper, 0.15);
  inUnit(b);
});

test('createBelief clamps an out-of-range point to [0,1]', () => {
  approx(createBelief(1.5).point, 1);
  approx(createBelief(-0.3).point, 0);
});

test('createBelief honours explicit bounds', () => {
  const b = createBelief(0.6, { lower: 0.2, upper: 0.95 });
  approx(b.lower, 0.2);
  approx(b.upper, 0.95);
});

test('createBelief clamps explicit out-of-range bounds', () => {
  const b = createBelief(0.6, { lower: -0.5, upper: 1.4 });
  approx(b.lower, 0);
  approx(b.upper, 1);
});

test('createBelief carries provenance and assumptionIds', () => {
  const b = createBelief(0.4, { provenance: ['e1', 'e2'], assumptionIds: ['a1'] });
  assert.deepEqual(b.provenance, ['e1', 'e2']);
  assert.deepEqual(b.assumptionIds, ['a1']);
});

test('createBelief carries staleAt', () => {
  const b = createBelief(0.4, { staleAt: '2026-06-10T00:00:00.000Z' });
  assert.equal(b.staleAt, '2026-06-10T00:00:00.000Z');
});

// ── noisyOr ──────────────────────────────────────────────────────────────

test('noisyOr of an empty list is a zero belief', () => {
  const b = noisyOr([]);
  approx(b.point, 0);
  inUnit(b);
});

test('noisyOr of a single belief returns it unchanged', () => {
  const only = createBelief(0.42, { provenance: ['x'] });
  const b = noisyOr([only]);
  assert.deepEqual(b, only);
});

test('noisyOr of two independent beliefs raises the point above either input', () => {
  const b = noisyOr([createBelief(0.5), createBelief(0.5)]);
  approx(b.point, 0.75);
  assert.ok(b.point > 0.5);
  inUnit(b);
});

test('noisyOr of three 0.5 beliefs compounds toward certainty', () => {
  const b = noisyOr([createBelief(0.5), createBelief(0.5), createBelief(0.5)]);
  approx(b.point, 0.875);
  inUnit(b);
});

test('noisyOr of five beliefs stays in range and keeps climbing', () => {
  const b = noisyOr(Array.from({ length: 5 }, () => createBelief(0.3)));
  approx(b.point, 1 - 0.7 ** 5);
  inUnit(b);
});

test('noisyOr widens the interval as more low-probability sources combine', () => {
  // Bounds are propagated through the same noisy-OR formula as the point, so
  // away from the saturation ceiling more sources mean a wider band.
  const two = noisyOr([createBelief(0.2), createBelief(0.2)]);
  const five = noisyOr(Array.from({ length: 5 }, () => createBelief(0.2)));
  assert.ok(five.point > two.point, 'more sources → higher point');
  assert.ok(intervalWidth(five) > intervalWidth(two), 'more sources → wider band');
  inUnit(two);
  inUnit(five);
});

test('noisyOr labels its combining rule', () => {
  const b = noisyOr([createBelief(0.5), createBelief(0.5)]);
  assert.equal(b.combiningRule, 'noisy-or');
});

test('noisyOr merges provenance from all inputs', () => {
  const b = noisyOr([
    createBelief(0.5, { provenance: ['a', 'b'] }),
    createBelief(0.5, { provenance: ['b', 'c'] }),
  ]);
  assert.deepEqual([...b.provenance].sort(), ['a', 'b', 'c']);
});

test('noisyOr merges assumptionIds from all inputs', () => {
  const b = noisyOr([
    createBelief(0.5, { assumptionIds: ['a1'] }),
    createBelief(0.5, { assumptionIds: ['a2', 'a1'] }),
  ]);
  assert.deepEqual([...b.assumptionIds].sort(), ['a1', 'a2']);
});

// ── logOddsUpdate ──────────────────────────────────────────────────────────

test('logOddsUpdate with lr>1 raises the point', () => {
  const b = logOddsUpdate(createBelief(0.5), 3, 'ev1');
  approx(b.point, 0.75, 1e-9);
  assert.ok(b.point > 0.5);
});

test('logOddsUpdate with lr<1 lowers the point', () => {
  const b = logOddsUpdate(createBelief(0.5), 1 / 3, 'ev1');
  approx(b.point, 0.25, 1e-9);
  assert.ok(b.point < 0.5);
});

test('logOddsUpdate with lr=1 leaves the point unchanged', () => {
  const b = logOddsUpdate(createBelief(0.6), 1, 'ev1');
  approx(b.point, 0.6, 1e-9);
});

test('logOddsUpdate appends the evidence id to provenance', () => {
  const b = logOddsUpdate(createBelief(0.5, { provenance: ['e0'] }), 2, 'ev1');
  assert.deepEqual(b.provenance, ['e0', 'ev1']);
});

test('logOddsUpdate does not duplicate an evidence id already present', () => {
  const b = logOddsUpdate(createBelief(0.5, { provenance: ['ev1'] }), 2, 'ev1');
  assert.deepEqual(b.provenance, ['ev1']);
});

test('logOddsUpdate labels its combining rule', () => {
  const b = logOddsUpdate(createBelief(0.5), 2, 'ev1');
  assert.equal(b.combiningRule, 'log-odds');
});

test('logOddsUpdate keeps bounds in [0,1] for extreme priors and ratios', () => {
  inUnit(logOddsUpdate(createBelief(0.999), 50, 'ev'));
  inUnit(logOddsUpdate(createBelief(0.001), 0.02, 'ev'));
  inUnit(logOddsUpdate(createBelief(0), 100, 'ev'));
  inUnit(logOddsUpdate(createBelief(1), 0.01, 'ev'));
});

test('logOddsUpdate shifts both interval bounds in the same direction', () => {
  const prior = createBelief(0.5, { lower: 0.4, upper: 0.6 });
  const up = logOddsUpdate(prior, 4, 'ev');
  assert.ok(up.lower > prior.lower);
  assert.ok(up.upper > prior.upper);
});

// ── applyStalenessDegradation ──────────────────────────────────────────────

test('applyStalenessDegradation leaves a fresh belief unchanged', () => {
  const fresh = createBelief(0.7);
  const out = applyStalenessDegradation(fresh);
  approx(out.lower, fresh.lower);
  approx(out.upper, fresh.upper);
  approx(out.point, fresh.point);
});

test('applyStalenessDegradation with full staleness widens toward [0,1]', () => {
  const b: BeliefValue = { ...createBelief(0.7), stalenessFactor: 1 };
  const out = applyStalenessDegradation(b);
  approx(out.lower, 0);
  approx(out.upper, 1);
  approx(out.point, 0.7);
});

test('applyStalenessDegradation with partial staleness widens proportionally', () => {
  const b: BeliefValue = { ...createBelief(0.7, { lower: 0.6, upper: 0.8 }), stalenessFactor: 0.5 };
  const out = applyStalenessDegradation(b);
  approx(out.lower, 0.3);
  approx(out.upper, 0.9);
  assert.ok(intervalWidth(out) > 0.2);
});

test('applyStalenessDegradation never narrows the interval', () => {
  const b: BeliefValue = { ...createBelief(0.5, { lower: 0.45, upper: 0.55 }), stalenessFactor: 0.3 };
  const out = applyStalenessDegradation(b);
  assert.ok(out.lower <= b.lower);
  assert.ok(out.upper >= b.upper);
});

test('applyStalenessDegradation recomputes staleness from staleAt and now', () => {
  const b = createBelief(0.7, { staleAt: '2026-06-10T00:00:00.000Z' });
  const out = applyStalenessDegradation(b, '2026-06-11T00:00:00.000Z');
  assert.ok(out.stalenessFactor > 0, 'past staleAt should register staleness');
  assert.ok(intervalWidth(out) > intervalWidth(b));
});

// ── getProbabilityLabel ────────────────────────────────────────────────────

test('getProbabilityLabel covers the low tail', () => {
  assert.equal(getProbabilityLabel(0), 'almost-certainly-not');
  assert.equal(getProbabilityLabel(0.05), 'almost-certainly-not');
  assert.equal(getProbabilityLabel(0.09), 'almost-certainly-not');
});

test('getProbabilityLabel covers very-unlikely', () => {
  assert.equal(getProbabilityLabel(0.10), 'very-unlikely');
  assert.equal(getProbabilityLabel(0.29), 'very-unlikely');
});

test('getProbabilityLabel covers unlikely', () => {
  assert.equal(getProbabilityLabel(0.30), 'unlikely');
  assert.equal(getProbabilityLabel(0.44), 'unlikely');
});

test('getProbabilityLabel covers roughly-even', () => {
  assert.equal(getProbabilityLabel(0.45), 'roughly-even');
  assert.equal(getProbabilityLabel(0.50), 'roughly-even');
  assert.equal(getProbabilityLabel(0.54), 'roughly-even');
});

test('getProbabilityLabel covers likely', () => {
  assert.equal(getProbabilityLabel(0.55), 'likely');
  assert.equal(getProbabilityLabel(0.72), 'likely');
  assert.equal(getProbabilityLabel(0.84), 'likely');
});

test('getProbabilityLabel covers very-likely', () => {
  assert.equal(getProbabilityLabel(0.85), 'very-likely');
  assert.equal(getProbabilityLabel(0.94), 'very-likely');
});

test('getProbabilityLabel covers the high tail', () => {
  assert.equal(getProbabilityLabel(0.95), 'almost-certainly');
  assert.equal(getProbabilityLabel(1), 'almost-certainly');
});

// ── fromLegacySeverity ─────────────────────────────────────────────────────

test('fromLegacySeverity maps the 0-10 scale onto [0,1]', () => {
  approx(fromLegacySeverity(0).point, 0);
  approx(fromLegacySeverity(5).point, 0.5);
  approx(fromLegacySeverity(10).point, 1);
});

test('fromLegacySeverity clamps out-of-range severities', () => {
  approx(fromLegacySeverity(15).point, 1);
  approx(fromLegacySeverity(-3).point, 0);
});

test('fromLegacySeverity records the source id as provenance', () => {
  assert.deepEqual(fromLegacySeverity(5, 'nws').provenance, ['nws']);
  assert.deepEqual(fromLegacySeverity(5).provenance, []);
});

test('fromLegacySeverity gives a wider-than-default interval and stays in range', () => {
  const b = fromLegacySeverity(5);
  approx(b.lower, 0.35);
  approx(b.upper, 0.65);
  inUnit(fromLegacySeverity(0));
  inUnit(fromLegacySeverity(10));
});

// ── propagateConfidence ────────────────────────────────────────────────────

test('propagateConfidence of a single belief returns it unchanged', () => {
  const only = createBelief(0.42, { provenance: ['x'] });
  assert.deepEqual(propagateConfidence([only], 'average'), only);
});

test('propagateConfidence with noisy-or matches noisyOr', () => {
  const beliefs = [createBelief(0.5), createBelief(0.5)];
  approx(propagateConfidence(beliefs, 'noisy-or').point, noisyOr(beliefs).point);
});

test('propagateConfidence with min takes the lowest point', () => {
  const b = propagateConfidence([createBelief(0.3), createBelief(0.7)], 'min');
  approx(b.point, 0.3);
  assert.equal(b.combiningRule, 'min');
  inUnit(b);
});

test('propagateConfidence with max takes the highest point', () => {
  const b = propagateConfidence([createBelief(0.3), createBelief(0.7)], 'max');
  approx(b.point, 0.7);
  assert.equal(b.combiningRule, 'max');
});

test('propagateConfidence with average means the points', () => {
  const b = propagateConfidence([createBelief(0.3), createBelief(0.7)], 'average');
  approx(b.point, 0.5);
  assert.equal(b.combiningRule, 'average');
});

test('propagateConfidence with average means the interval bounds', () => {
  const b = propagateConfidence(
    [createBelief(0.4, { lower: 0.3, upper: 0.5 }), createBelief(0.6, { lower: 0.5, upper: 0.7 })],
    'average',
  );
  approx(b.lower, 0.4);
  approx(b.upper, 0.6);
});

test('propagateConfidence with log-odds pushes agreeing beliefs toward the extreme', () => {
  const b = propagateConfidence([createBelief(0.7), createBelief(0.7)], 'log-odds');
  assert.ok(b.point > 0.7, 'two 0.7 beliefs reinforce past 0.7');
  inUnit(b);
});

test('propagateConfidence merges provenance across inputs', () => {
  const b = propagateConfidence(
    [createBelief(0.3, { provenance: ['a'] }), createBelief(0.7, { provenance: ['b'] })],
    'average',
  );
  assert.deepEqual([...b.provenance].sort(), ['a', 'b']);
});

test('propagateConfidence of an empty list is a zero belief', () => {
  inUnit(propagateConfidence([], 'average'));
  approx(propagateConfidence([], 'average').point, 0);
});

// ── formatBelief ───────────────────────────────────────────────────────────

test('formatBelief produces a readable label + percent + interval', () => {
  const b = createBelief(0.72, { lower: 0.58, upper: 0.84 });
  assert.equal(formatBelief(b), 'likely (72%, CI 58–84%)');
});

test('formatBelief rounds percentages', () => {
  const b = createBelief(0.333, { lower: 0.2, upper: 0.466 });
  assert.equal(formatBelief(b), 'unlikely (33%, CI 20–47%)');
});

// ── isStale ────────────────────────────────────────────────────────────────

test('isStale is false when there is no staleAt', () => {
  assert.equal(isStale(createBelief(0.5)), false);
});

test('isStale is false before the staleAt instant', () => {
  const b = createBelief(0.5, { staleAt: '2026-06-10T12:00:00.000Z' });
  assert.equal(isStale(b, '2026-06-10T11:59:59.000Z'), false);
});

test('isStale is true at or after the staleAt instant', () => {
  const b = createBelief(0.5, { staleAt: '2026-06-10T12:00:00.000Z' });
  assert.equal(isStale(b, '2026-06-10T12:00:00.000Z'), true);
  assert.equal(isStale(b, '2026-06-10T13:00:00.000Z'), true);
});

// ── intervalWidth ──────────────────────────────────────────────────────────

test('intervalWidth is upper minus lower', () => {
  approx(intervalWidth(createBelief(0.5, { lower: 0.4, upper: 0.9 })), 0.5);
  approx(intervalWidth(createBelief(0.5, { lower: 0.5, upper: 0.5 })), 0);
});

// ── ensureFresh ────────────────────────────────────────────────────────────

test('ensureFresh leaves a belief with no staleAt untouched', () => {
  const b = createBelief(0.7);
  assert.deepEqual(ensureFresh(b), b);
});

test('ensureFresh leaves a not-yet-stale belief untouched', () => {
  const b = createBelief(0.7, { staleAt: '2026-06-10T12:00:00.000Z' });
  assert.deepEqual(ensureFresh(b, '2026-06-10T11:00:00.000Z'), b);
});

test('ensureFresh degrades a belief once staleAt has passed', () => {
  const b = createBelief(0.7, { staleAt: '2026-06-10T12:00:00.000Z' });
  const out = ensureFresh(b, '2026-06-11T12:00:00.000Z');
  assert.ok(intervalWidth(out) > intervalWidth(b), 'past staleAt → widened');
  approx(out.point, b.point);
});

// ── cross-cutting invariants ───────────────────────────────────────────────

test('all combining and update paths keep bounds in [0,1]', () => {
  const a = createBelief(0.8, { lower: 0.7, upper: 0.95 });
  const b = createBelief(0.2, { lower: 0.05, upper: 0.4 });
  inUnit(noisyOr([a, b]));
  inUnit(logOddsUpdate(a, 7, 'e'));
  inUnit(applyStalenessDegradation({ ...a, stalenessFactor: 0.9 }));
  for (const rule of ['noisy-or', 'min', 'max', 'average', 'log-odds'] as const) {
    inUnit(propagateConfidence([a, b], rule));
  }
});
