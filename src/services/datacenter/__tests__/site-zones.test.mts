import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSiteZonesBestEffort } from '../site-zones.ts';

// R3-BUG-002: a failed NWS /points lookup must degrade, not throw, and must
// never be cached.

const SITE = { lat: 41.6, lon: -86.7 };

test('a thrown lookup degrades to no zones and is not cached', async () => {
  const cache = new Map<string, string[]>();
  for (const failure of [new Error('HTTP 503'), new Error('HTTP 429'), new DOMException('timeout', 'TimeoutError'), new Error('NWS /points returned malformed properties')]) {
    const result = await resolveSiteZonesBestEffort(SITE, cache, async () => { throw failure; });
    assert.deepEqual(result, { zones: [], degraded: true });
  }
  assert.equal(cache.size, 0, 'failures are never cached');
});

test('the next successful lookup is used and cached', async () => {
  const cache = new Map<string, string[]>();
  await resolveSiteZonesBestEffort(SITE, cache, async () => { throw new Error('HTTP 500'); });
  let calls = 0;
  const fetchZones = async () => { calls += 1; return ['INZ003', 'INC091']; };
  assert.deepEqual(await resolveSiteZonesBestEffort(SITE, cache, fetchZones), { zones: ['INZ003', 'INC091'], degraded: false });
  assert.deepEqual(await resolveSiteZonesBestEffort(SITE, cache, fetchZones), { zones: ['INZ003', 'INC091'], degraded: false });
  assert.equal(calls, 1, 'cache hit does not refetch');
});

test('outside NWS jurisdiction ([] from a 404) is a real answer: cached, not degraded', async () => {
  const cache = new Map<string, string[]>();
  let calls = 0;
  const fetchZones = async () => { calls += 1; return []; };
  assert.deepEqual(await resolveSiteZonesBestEffort(SITE, cache, fetchZones), { zones: [], degraded: false });
  assert.deepEqual(await resolveSiteZonesBestEffort(SITE, cache, fetchZones), { zones: [], degraded: false });
  assert.equal(calls, 1);
});

test('a site that already carries its zones never fetches', async () => {
  const result = await resolveSiteZonesBestEffort({ ...SITE, ugcZones: ['INZ003'] }, new Map(), async () => { throw new Error('must not fetch'); });
  assert.deepEqual(result, { zones: ['INZ003'], degraded: false });
});
