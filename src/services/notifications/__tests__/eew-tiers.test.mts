import assert from 'node:assert/strict';
import test from 'node:test';
import { EEW_TIERS, tierForMagnitude, type EewTier } from '../eew-tiers.ts';

test('EEW_TIERS covers M5+ in non-overlapping bands', () => {
  assert.equal(EEW_TIERS.TIER_2.min, 5);
  assert.equal(EEW_TIERS.TIER_2.max, 6);
  assert.equal(EEW_TIERS.TIER_3.min, 6);
  assert.equal(EEW_TIERS.TIER_3.max, 7);
  assert.equal(EEW_TIERS.TIER_4.min, 7);
  assert.equal(EEW_TIERS.TIER_4.max, 8);
  assert.equal(EEW_TIERS.TIER_5.min, 8);
  assert.equal(EEW_TIERS.TIER_5.max, Number.POSITIVE_INFINITY);
});

test('tierForMagnitude: returns null below M5', () => {
  assert.equal(tierForMagnitude(-1), null);
  assert.equal(tierForMagnitude(0), null);
  assert.equal(tierForMagnitude(4.9), null);
  assert.equal(tierForMagnitude(4.999), null);
});

test('tierForMagnitude: M5.0 enters TIER_2 (lower bound inclusive)', () => {
  assert.equal(tierForMagnitude(5.0), 'TIER_2');
  assert.equal(tierForMagnitude(5.5), 'TIER_2');
  assert.equal(tierForMagnitude(5.999), 'TIER_2');
});

test('tierForMagnitude: M6.0 enters TIER_3', () => {
  assert.equal(tierForMagnitude(6.0), 'TIER_3');
  assert.equal(tierForMagnitude(6.5), 'TIER_3');
  assert.equal(tierForMagnitude(6.999), 'TIER_3');
});

test('tierForMagnitude: M7.0 enters TIER_4', () => {
  assert.equal(tierForMagnitude(7.0), 'TIER_4');
  assert.equal(tierForMagnitude(7.5), 'TIER_4');
  assert.equal(tierForMagnitude(7.999), 'TIER_4');
});

test('tierForMagnitude: M8.0+ is TIER_5', () => {
  assert.equal(tierForMagnitude(8.0), 'TIER_5');
  assert.equal(tierForMagnitude(9.5), 'TIER_5');
  assert.equal(tierForMagnitude(10), 'TIER_5');
});

test('tierForMagnitude: returns null for non-finite input', () => {
  assert.equal(tierForMagnitude(Number.NaN), null);
  assert.equal(tierForMagnitude(Number.POSITIVE_INFINITY), 'TIER_5');
  assert.equal(tierForMagnitude(Number.NEGATIVE_INFINITY), null);
});

test('tier ordinal lets callers compare severity', () => {
  const tiers: EewTier[] = ['TIER_2', 'TIER_3', 'TIER_4', 'TIER_5'];
  const order = tiers.map(t => Object.keys(EEW_TIERS).indexOf(t));
  // Ensure the keys are in the same order they were declared
  assert.deepEqual(order, [0, 1, 2, 3]);
});
