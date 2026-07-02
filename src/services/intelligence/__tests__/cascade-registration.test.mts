import assert from 'node:assert/strict';
import test from 'node:test';
import { computeCascadeKeys } from '../cascade-registration.ts';

const HOUR_MS = 3_600_000;

test('computeCascadeKeys yields the expected pair key for a lagged cause→effect history', () => {
  const base = 1_000_000_000;
  const history = [
    { domain: 'weather', at: base },
    { domain: 'infra', at: base + 2 * HOUR_MS },
    { domain: 'weather', at: base + 30 * HOUR_MS },
    { domain: 'infra', at: base + 32 * HOUR_MS },
    { domain: 'weather', at: base + 60 * HOUR_MS },
    { domain: 'infra', at: base + 62 * HOUR_MS },
  ];

  const keys = computeCascadeKeys(history);

  assert.ok(keys.includes('weather|infra'), `expected weather|infra in ${JSON.stringify(keys)}`);
});

test('computeCascadeKeys yields no pairs for sparse unrelated history', () => {
  const base = 1_000_000_000;
  const history = [
    { domain: 'markets', at: base },
    { domain: 'cyber', at: base + 500 * HOUR_MS },
  ];

  const keys = computeCascadeKeys(history);

  assert.deepEqual(keys, []);
});
