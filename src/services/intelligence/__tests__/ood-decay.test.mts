import assert from 'node:assert/strict';
import test from 'node:test';

import { fitDistribution, oodDecay, oodDecayScalar, type DistributionStats } from '../ood-decay.ts';

function stats(mean: number, stdDev: number, n = 50): DistributionStats {
  return { mean, stdDev, n };
}

test('fitDistribution computes mean, population std-dev, and n', () => {
  const d = fitDistribution([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.equal(d.n, 8);
  assert.ok(Math.abs(d.mean - 5) < 1e-9);
  assert.ok(Math.abs(d.stdDev - 2) < 1e-9);
});

test('in-distribution value keeps full confidence (multiplier 1)', () => {
  const r = oodDecayScalar(5.2, stats(5, 1, 50));
  assert.equal(r.decayMultiplier, 1);
  assert.equal(r.inDistribution, true);
});

test('far out-of-distribution value decays toward the floor', () => {
  const r = oodDecayScalar(12, stats(5, 1, 50), { softZ: 2, hardZ: 5, floor: 0.4 });
  assert.ok(r.distance >= 5);
  assert.ok(Math.abs(r.decayMultiplier - 0.4) < 1e-9, `mult ${r.decayMultiplier}`);
  assert.equal(r.inDistribution, false);
});

test('decay is monotonic — farther is never more confident', () => {
  const near = oodDecayScalar(7, stats(5, 1, 50)).decayMultiplier;   // z=2
  const mid = oodDecayScalar(8.5, stats(5, 1, 50)).decayMultiplier;  // z=3.5
  const far = oodDecayScalar(10, stats(5, 1, 50)).decayMultiplier;   // z=5
  assert.ok(near >= mid && mid >= far, `${near} >= ${mid} >= ${far}`);
});

test('worst feature dominates the distance (conservative)', () => {
  const r = oodDecay([5, 100], [stats(5, 1), stats(0, 1)], { softZ: 2, hardZ: 5, floor: 0.4 });
  assert.ok(r.distance >= 5, 'the 100-vs-mean-0 feature drives distance');
  assert.ok(r.decayMultiplier <= 0.4 + 1e-9);
});

test('sparse training adds extra decay via coverage', () => {
  const wellCovered = oodDecayScalar(5, stats(5, 1, 50), { fullCoverageN: 30 });
  const sparse = oodDecayScalar(5, stats(5, 1, 3), { fullCoverageN: 30, coverageFloor: 0.5 });
  assert.equal(wellCovered.decayMultiplier, 1);
  assert.ok(sparse.decayMultiplier < 1, 'sparse training is penalized even when in-distribution');
  assert.ok(sparse.coverage < 1);
});

test('a feature with no matching training stats is not silently dropped (fail-closed)', () => {
  // 2 features, only 1 ref. The uncovered 2nd feature must drag confidence down
  // even though the matched 1st feature is perfectly in-distribution.
  const r = oodDecay([5, 999], [stats(5, 1, 50)], { coverageFloor: 0.5, hardZ: 5, floor: 0.4 });
  assert.ok(r.distance >= 5, 'uncovered feature reads as maximally far');
  assert.equal(r.coverage, 0, 'an uncovered feature zeroes coverage');
  assert.ok(r.decayMultiplier < 1, `must decay, got ${r.decayMultiplier}`);
  assert.equal(r.inDistribution, false);
});

test('non-finite feature value fails closed (finite multiplier, treated as far)', () => {
  const r = oodDecayScalar(Number.NaN, stats(5, 1, 50), { hardZ: 5, floor: 0.4 });
  assert.ok(Number.isFinite(r.decayMultiplier), 'multiplier must stay finite');
  assert.ok(r.decayMultiplier >= 0 && r.decayMultiplier <= 1);
  assert.ok(r.distance >= 5, 'NaN feature reads as maximally far');
  assert.equal(r.inDistribution, false);
});

test('missing runtime feature (refs longer than features) also fails closed', () => {
  // 2 trained dimensions, only 1 runtime feature supplied → the missing 2nd
  // dimension must be treated as uncovered, not silently full-confidence.
  const r = oodDecay([5], [stats(5, 1, 50), stats(0, 1, 50)], { coverageFloor: 0.5, hardZ: 5, floor: 0.4 });
  assert.ok(r.distance >= 5, 'the missing dimension reads as maximally far');
  assert.equal(r.coverage, 0);
  assert.ok(r.decayMultiplier < 1);
  assert.equal(r.inDistribution, false);
});

test('empty distribution caps confidence to the coverage floor', () => {
  const r = oodDecay([5], [], { coverageFloor: 0.5 });
  assert.equal(r.decayMultiplier, 0.5);
  assert.equal(r.inDistribution, false);
});

test('zero-stdDev feature: exact match is in-dist, any deviation is far', () => {
  const exact = oodDecayScalar(5, stats(5, 0, 50));
  assert.equal(exact.distance, 0);
  const off = oodDecayScalar(6, stats(5, 0, 50), { hardZ: 5, floor: 0.4 });
  assert.ok(off.distance >= 5);
});
