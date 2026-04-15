import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extrapolatePath,
  scoreDestinations,
  KNOWN_WAYPOINTS,
} from '../strike-package-prediction.ts';

test('extrapolatePath generates 12 waypoints along heading', () => {
  const path = extrapolatePath(36.0, -75.0, 180, 15, 24);
  assert.equal(path.length, 12);
  for (const [lat] of path) {
    assert.ok(lat < 36.0, `expected lat ${lat} < 36.0`);
  }
  for (let i = 1; i < path.length; i++) {
    assert.ok(path[i]![0] < path[i - 1]![0], `point ${i} should be further south`);
  }
});

test('extrapolatePath handles zero speed', () => {
  const path = extrapolatePath(36.0, -75.0, 90, 0, 24);
  assert.equal(path.length, 12);
  for (const [lat, lon] of path) {
    assert.ok(Math.abs(lat - 36.0) < 0.001);
    assert.ok(Math.abs(lon - (-75.0)) < 0.001);
  }
});

test('scoreDestinations ranks bearing-aligned destinations higher', () => {
  const destinations = scoreDestinations(30.0, -40.0, 90, 20);
  const suez = destinations.find(d => d.name.includes('Suez'));
  const norfolk = destinations.find(d => d.name.includes('Norfolk'));
  if (suez && norfolk) {
    assert.ok(suez.probability > norfolk.probability,
      `Suez (${suez.probability}) should rank higher than Norfolk (${norfolk.probability})`);
  }
});

test('scoreDestinations returns probabilities summing to ~100', () => {
  const destinations = scoreDestinations(36.0, -75.0, 180, 15);
  const total = destinations.reduce((sum, d) => sum + d.probability, 0);
  assert.ok(Math.abs(total - 100) < 1, `total probability ${total} should be ~100`);
});

test('KNOWN_WAYPOINTS has required categories', () => {
  const types = new Set(KNOWN_WAYPOINTS.map(w => w.type));
  assert.ok(types.has('base'), 'should have base waypoints');
  assert.ok(types.has('chokepoint'), 'should have chokepoint waypoints');
});
