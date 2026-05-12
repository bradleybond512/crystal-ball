import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeMissionState,
  classifyDomain,
  classifyGlobal,
  classifyFeedHealth,
  GLOBAL_DEGRADED_THRESHOLD,
  FRESH_MULT,
  STALE_MULT,
  type FeedHealthInput,
  type Domain,
} from '../mission-state-mapper.ts';
import type { FeedDefinition } from '../feed-catalog.ts';

function feed(
  id: string,
  category: Domain,
  status: FeedHealthInput['status'],
  opts: Partial<FeedHealthInput> = {},
): FeedHealthInput {
  return { id, name: `Feed ${id}`, category, status, ...opts };
}

test('classifyDomain: empty input returns NOMINAL (cannot be worse than nothing observed)', () => {
  assert.equal(classifyDomain([]), 'NOMINAL');
});

test('classifyDomain: all fresh + at least one enhanced → ENHANCED', () => {
  assert.equal(
    classifyDomain([feed('a', 'natural', 'fresh'), feed('b', 'natural', 'fresh', { enhanced: true })]),
    'ENHANCED',
  );
});

test('classifyDomain: all fresh and no enhanced flag → NOMINAL', () => {
  assert.equal(
    classifyDomain([feed('a', 'natural', 'fresh'), feed('b', 'natural', 'fresh')]),
    'NOMINAL',
  );
});

test('classifyDomain: one stale + one fresh → LIMITED', () => {
  assert.equal(
    classifyDomain([feed('a', 'natural', 'fresh'), feed('b', 'natural', 'stale')]),
    'LIMITED',
  );
});

test('classifyDomain: every feed unhealthy → DEGRADED', () => {
  assert.equal(
    classifyDomain([feed('a', 'natural', 'stale'), feed('b', 'natural', 'error')]),
    'DEGRADED',
  );
});

test('classifyDomain: enhanced flag on a stale feed does NOT promote', () => {
  // Enhanced is only meaningful when the feed itself is fresh.
  assert.equal(
    classifyDomain([feed('a', 'natural', 'fresh'), feed('b', 'natural', 'stale', { enhanced: true })]),
    'LIMITED',
  );
});

test('classifyGlobal: too many degraded feeds collapses global to DEGRADED', () => {
  const domains: Partial<Record<Domain, ReturnType<typeof classifyDomain>>> = {
    natural: 'NOMINAL',
    cyber: 'NOMINAL',
  };
  assert.equal(classifyGlobal(domains, GLOBAL_DEGRADED_THRESHOLD + 1), 'DEGRADED');
});

test('classifyGlobal: any DEGRADED domain pulls the global to DEGRADED', () => {
  const domains: Partial<Record<Domain, ReturnType<typeof classifyDomain>>> = {
    natural: 'NOMINAL',
    cyber: 'DEGRADED',
    aviation: 'NOMINAL',
  };
  assert.equal(classifyGlobal(domains, 1), 'DEGRADED');
});

test('classifyGlobal: any LIMITED domain (no DEGRADED) makes global LIMITED', () => {
  const domains: Partial<Record<Domain, ReturnType<typeof classifyDomain>>> = {
    natural: 'NOMINAL',
    cyber: 'LIMITED',
  };
  assert.equal(classifyGlobal(domains, 1), 'LIMITED');
});

test('classifyGlobal: ALL domains ENHANCED → global ENHANCED', () => {
  const domains: Partial<Record<Domain, ReturnType<typeof classifyDomain>>> = {
    natural: 'ENHANCED',
    cyber: 'ENHANCED',
  };
  assert.equal(classifyGlobal(domains, 0), 'ENHANCED');
});

test('classifyGlobal: mix of ENHANCED + NOMINAL → NOMINAL (not enhanced)', () => {
  const domains: Partial<Record<Domain, ReturnType<typeof classifyDomain>>> = {
    natural: 'ENHANCED',
    cyber: 'NOMINAL',
  };
  assert.equal(classifyGlobal(domains, 0), 'NOMINAL');
});

test('computeMissionState: end-to-end shape with lastUpdated stamping', () => {
  const ms = computeMissionState(
    [
      feed('usgs', 'natural', 'fresh'),
      feed('nws', 'natural', 'stale'),
      feed('opensky', 'aviation', 'fresh'),
    ],
    1_700_000_000_000,
  );
  assert.equal(ms.global, 'LIMITED');
  assert.equal(ms.domains.natural, 'LIMITED');
  assert.equal(ms.domains.aviation, 'NOMINAL');
  assert.deepEqual(ms.degradedFeeds, ['Feed nws']);
  assert.equal(ms.lastUpdated, 1_700_000_000_000);
});

test('computeMissionState: degradedFeeds preserves input order', () => {
  const ms = computeMissionState([
    feed('a', 'natural', 'stale'),
    feed('b', 'cyber', 'fresh'),
    feed('c', 'aviation', 'error'),
    feed('d', 'maritime', 'fresh'),
    feed('e', 'fire', 'stale'),
  ]);
  assert.deepEqual(ms.degradedFeeds, ['Feed a', 'Feed c', 'Feed e']);
});

test('computeMissionState: >threshold degraded triggers global DEGRADED even if domains look OK individually', () => {
  // Four stale feeds, each in its own domain → each domain is DEGRADED on
  // its own; but more importantly the global threshold fires.
  const ms = computeMissionState([
    feed('a', 'natural', 'stale'),
    feed('b', 'cyber', 'stale'),
    feed('c', 'aviation', 'stale'),
    feed('d', 'maritime', 'stale'),
  ]);
  assert.equal(ms.global, 'DEGRADED');
});

test('classifyFeedHealth: fresh within FRESH_MULT × pollInterval', () => {
  const def: FeedDefinition = {
    id: 'x', name: 'X', category: 'natural',
    endpoint: 'http://x', pollIntervalMs: 60_000,
  };
  assert.equal(classifyFeedHealth(def, 1_000_000, false, 1_060_000 + 1), 'fresh');
});

test('classifyFeedHealth: stale beyond FRESH_MULT × pollInterval', () => {
  const def: FeedDefinition = {
    id: 'x', name: 'X', category: 'natural',
    endpoint: 'http://x', pollIntervalMs: 60_000,
  };
  // 3× the poll interval → outside fresh window → stale.
  assert.equal(classifyFeedHealth(def, 1_000_000, false, 1_000_000 + 60_000 * 3), 'stale');
});

test('classifyFeedHealth: explicit error wins over freshness', () => {
  const def: FeedDefinition = {
    id: 'x', name: 'X', category: 'natural',
    endpoint: 'http://x', pollIntervalMs: 60_000,
  };
  assert.equal(classifyFeedHealth(def, Date.now(), true), 'error');
});

test('classifyFeedHealth: null lastUpdate is "never"', () => {
  const def: FeedDefinition = {
    id: 'x', name: 'X', category: 'natural',
    endpoint: 'http://x', pollIntervalMs: 60_000,
  };
  assert.equal(classifyFeedHealth(def, null, false), 'never');
});

test('FRESH_MULT and STALE_MULT are sane defaults (fresh < stale)', () => {
  assert.ok(FRESH_MULT > 0);
  assert.ok(STALE_MULT > FRESH_MULT);
});
