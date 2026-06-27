import assert from 'node:assert/strict';
import test from 'node:test';

import { feedFreshnessFromSnapshot, type CachedSnapshot } from '../offline-alert-cache.ts';

function snap<T>(over: Partial<CachedSnapshot<T>> & { data: T }): CachedSnapshot<T> {
  return { cachedAt: 1000, expiresAt: 2000, isStale: false, staleDurationMs: 0, source: 'network', ...over };
}

// Round-1 #9 / round-5 #4: a feed served from the offline cache (the live fetch
// failed) must NOT be recorded as a fresh update — otherwise a stale safety
// snapshot renders as a fresh all-clear and the StalenessBanner stays green.

test('feedFreshnessFromSnapshot: a live network fetch is fresh', () => {
  const d = feedFreshnessFromSnapshot(snap({ data: [], isStale: false, source: 'network' }));
  assert.equal(d.fresh, true);
  assert.equal(d.staleReason, null);
  assert.equal(d.staleTimestamp, null);
});

test('feedFreshnessFromSnapshot: an offline-cache hit is NOT fresh (no fresh-update record)', () => {
  const d = feedFreshnessFromSnapshot(
    snap({ data: [], isStale: true, source: 'offline-cache', staleDurationMs: 9 * 60_000, cachedAt: 1234 }),
  );
  assert.equal(d.fresh, false);
  assert.match(d.staleReason ?? '', /offline cache/);
  // staleTimestamp is the REAL last-live-fetch (cachedAt), never advanced to now.
  assert.equal(d.staleTimestamp, 1234);
});
