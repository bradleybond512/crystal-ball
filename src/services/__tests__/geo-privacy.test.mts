import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coarsenCoord, coarseCoordPair, COARSE_COORD_DECIMALS } from '../geo-privacy.ts';

test('coarsenCoord rounds to ~city precision (1 decimal by default)', () => {
  assert.equal(COARSE_COORD_DECIMALS, 1);
  // La Porte IN-ish home coords get stripped from ~11 m to ~11 km precision.
  assert.equal(coarsenCoord(41.6105), 41.6);
  assert.equal(coarsenCoord(-86.7228), -86.7);
});

test('coarsenCoord drops sub-decimal household-level precision', () => {
  // Two homes 200 m apart collapse to the same coarse value — no pinpointing.
  assert.equal(coarsenCoord(41.6105), coarsenCoord(41.6133));
});

test('coarsenCoord honors an explicit precision', () => {
  assert.equal(coarsenCoord(41.6105, 2), 41.61);
  assert.equal(coarsenCoord(41.6105, 0), 42);
});

test('coarsenCoord never emits NaN or a raw value for bad input', () => {
  assert.equal(coarsenCoord(Number.NaN), 0);
  assert.equal(coarsenCoord(Number.POSITIVE_INFINITY), 0);
});

test('coarseCoordPair marks values as approximate', () => {
  assert.equal(coarseCoordPair(41.6105, -86.7228), '~41.6, ~-86.7');
});
