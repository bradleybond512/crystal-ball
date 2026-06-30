import assert from 'node:assert/strict';
import test from 'node:test';

import { nextProbeDelay } from '../probe-backoff.ts';

test('zero failures with the midpoint jitter returns the base delay', () => {
  assert.equal(nextProbeDelay(0, 1000, 60_000, 0.5), 1000);
});

test('defaults to a 60s base delay at zero failures', () => {
  assert.equal(nextProbeDelay(0), 60_000);
});

test('doubles roughly every consecutive failure', () => {
  assert.equal(nextProbeDelay(1, 1000, 60_000, 0.5), 2000);
  assert.equal(nextProbeDelay(2, 1000, 60_000, 0.5), 4000);
  assert.equal(nextProbeDelay(3, 1000, 60_000, 0.5), 8000);
});

test('never exceeds the cap no matter how many failures', () => {
  assert.equal(nextProbeDelay(20, 1000, 5000, 0.5), 5000);
  assert.equal(nextProbeDelay(50, 60_000, 15 * 60_000, 0.5), 15 * 60_000);
});

test('jitter spans 0.8x (rand=0) to ~1.2x (rand→1) of the raw delay', () => {
  assert.equal(nextProbeDelay(0, 1000, 60_000, 0), 800);
  assert.equal(nextProbeDelay(0, 1000, 60_000, 0.999), 1200);
});

test('negative failure counts are clamped to zero', () => {
  assert.equal(nextProbeDelay(-5, 1000, 60_000, 0.5), 1000);
});
