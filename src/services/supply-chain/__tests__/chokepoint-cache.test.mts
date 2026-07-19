import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCachedChokepointInfo, rememberChokepoints } from '../chokepoint-cache.ts';
import type { ChokepointInfo } from '@/generated/client/crystalball/supply_chain/v1/service_client';

function info(over: Partial<ChokepointInfo> = {}): ChokepointInfo {
  return {
    id: '0', name: 'Hormuz', lat: 0, lon: 0, disruptionScore: 80, status: 'Disrupted',
    activeWarnings: 0, congestionLevel: '', affectedRoutes: [], description: '', ...over,
  };
}

const T0 = 1_700_000_000_000;

test('cold: returns [] before anything is remembered', () => {
  assert.deepEqual(getCachedChokepointInfo(T0), []);
});

test('warm: returns the remembered payload within the TTL', () => {
  rememberChokepoints([info({ name: 'Suez' })], T0);
  const got = getCachedChokepointInfo(T0 + 60_000);
  assert.equal(got.length, 1);
  assert.equal(got[0]!.name, 'Suez');
});

test('stale: returns [] once past the 15-min TTL (fail-safe)', () => {
  rememberChokepoints([info()], T0);
  assert.deepEqual(getCachedChokepointInfo(T0 + 16 * 60_000), []);
  // Just inside the window still returns data.
  assert.equal(getCachedChokepointInfo(T0 + 14 * 60_000).length, 1);
});
