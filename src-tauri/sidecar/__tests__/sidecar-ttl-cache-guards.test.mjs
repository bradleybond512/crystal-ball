/**
 * Regression guards for the three sidecar TTL-cache correctness fixes
 * (merged as "cache-key + failure-caching bugs in 3 TTL-cached endpoints").
 * That fix shipped without unit tests because the cache-failure paths need a
 * live server + mocked upstream to exercise behaviorally; these are source-
 * scoped assertions (same convention as tests/ttl-acled-ais-guards.test.mjs)
 * so a match in an unrelated handler can't satisfy them.
 *
 * The three bugs:
 *   1. /api/internet-outages — cache key ignored `limit`, so a limit=50 payload
 *      was served for every later limit=N request in the same window.
 *   2. /api/spaceweather-extra — a total upstream failure was cached, serving an
 *      empty result for the full TTL after SWPC recovered.
 *   3. /api/aviation-hazards — `degraded` was hardcoded false and a total
 *      failure was cached for the full TTL after AviationWeather recovered.
 *
 * The merged fix distinguishes PARTIAL degradation (flagged `degraded`, still
 * cacheable) from a TOTAL failure (`allFailed`, never cached) — these tests pin
 * exactly that distinction so a future edit can't quietly re-break it.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  _getSidecarCachedForTests,
  _getSidecarCachedStaleForTests,
  _resetSidecarCacheForTests,
  _setSidecarCachedForTests,
  _sweepSidecarCacheForTests,
} from '../local-api-server.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const serverSrc = readFileSync(path.join(__dir, '..', 'local-api-server.mjs'), 'utf8');

/**
 * Slice exactly one route handler's body: from its `pathname ===` guard up to
 * the NEXT route's guard (or a generous cap). Bounding to the route prevents a
 * short handler's assertions from false-passing on a sibling route's code.
 */
function routeBody(pathname) {
  const start = serverSrc.indexOf(`requestUrl.pathname === '${pathname}'`);
  assert.notEqual(start, -1, `route ${pathname} must exist`);
  const afterStart = start + pathname.length;
  const next = serverSrc.indexOf('requestUrl.pathname ===', afterStart);
  const end = next === -1 ? Math.min(serverSrc.length, start + 2000) : next;
  return serverSrc.slice(start, end);
}

/** Count non-overlapping occurrences of a literal substring. */
function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

/**
 * True when every `setCached('<key>'` call in `body` is preceded (within the
 * same statement) by `<guard>` — tolerant of `if (g) setCached`, `if (g) {\n
 * setCached`, etc. Guards against an unconditional cache write on total failure
 * without pinning one exact formatting.
 */
function everyCacheWriteGuarded(body, key, guard) {
  const marker = `setCached('${key}'`;
  const segments = body.split(marker);
  const callCount = segments.length - 1;
  if (callCount < 1) return false;
  for (let i = 0; i < callCount; i++) {
    if (!segments[i].slice(-80).includes(guard)) return false;
  }
  return true;
}

// ── Bug 1: internet-outages cache key must include limit ──────────────────────

test('internet-outages: cache key includes from, until AND limit', () => {
  const body = routeBody('/api/internet-outages');
  assert.match(body, /ioda-outages:\$\{from\}:\$\{until\}:\$\{limit\}/);
});

test('internet-outages: stale (limit-less) cache key is gone', () => {
  const body = routeBody('/api/internet-outages');
  assert.doesNotMatch(body, /ioda-outages:\$\{from\}:\$\{until\}`/);
});

test('internet-outages: reads a limit query param', () => {
  const body = routeBody('/api/internet-outages');
  assert.match(body, /const limit = requestUrl\.searchParams\.get\('limit'\)/);
});

// ── Bug 2: spaceweather-extra caches partials but never a total failure ───────

test('spaceweather-extra: degraded flags any missing source (partial included)', () => {
  const body = routeBody('/api/spaceweather-extra');
  assert.match(body, /const degraded = !auroraRaw \|\| !solarRaw/);
});

test('spaceweather-extra: allFailed is the both-down (total failure) case', () => {
  const body = routeBody('/api/spaceweather-extra');
  assert.match(body, /const allFailed = !auroraRaw && !solarRaw/);
});

test('spaceweather-extra: every cache write is guarded by !allFailed (total failure not cached)', () => {
  const body = routeBody('/api/spaceweather-extra');
  assert.ok(count(body, "setCached('spaceweather-extra'") >= 1, 'route must write to the cache');
  assert.ok(
    everyCacheWriteGuarded(body, 'spaceweather-extra', '!allFailed'),
    'every setCached call must be gated on !allFailed',
  );
});

// ── Bug 3: aviation-hazards reports honest degraded + never caches a total fail ─

test('aviation-hazards: per-upstream ok flags are computed', () => {
  const body = routeBody('/api/aviation-hazards');
  assert.match(body, /const isigmetOk = /);
  assert.match(body, /const airsigmetOk = /);
  assert.match(body, /const gairmetOk = /);
});

test('aviation-hazards: degraded flags any failed source (not hardcoded false)', () => {
  const body = routeBody('/api/aviation-hazards');
  assert.match(body, /const degraded = !isigmetOk \|\| !airsigmetOk \|\| !gairmetOk/);
  assert.doesNotMatch(body, /degraded: false/);
});

test('aviation-hazards: allFailed is the all-down case and every cache write is gated on it', () => {
  const body = routeBody('/api/aviation-hazards');
  assert.match(body, /const allFailed = !isigmetOk && !airsigmetOk && !gairmetOk/);
  assert.ok(count(body, "setCached('aviation-hazards'") >= 1, 'route must write to the cache');
  assert.ok(
    everyCacheWriteGuarded(body, 'aviation-hazards', '!allFailed'),
    'every setCached call must be gated on !allFailed',
  );
});

// ── Regression guards: sibling routes that already keyed on limit stay correct ─

test('regression: pharma-shortages cache key still includes limit', () => {
  const body = routeBody('/api/pharma-shortages');
  assert.match(body, /openfda-shortages:\$\{limit\}/);
});

test('regression: grid-outages cache key includes validated limit and exact FIPS', () => {
  const body = routeBody('/api/grid-outages');
  assert.match(body, /ornl-odin:\$\{query\.limit\}:\$\{query\.fips\}/);
  assert.doesNotMatch(body, /\?\? 'all'/);
});

test('USGS surface-water sidecar uses the bounded two-step API and caches only contributed rows', () => {
  const body = routeBody('/api/usgs-water-proxy');
  assert.match(body, /collections\/monitoring-locations\/items/);
  assert.match(body, /collections\/latest-continuous\/items/);
  assert.match(body, /monitoring_location_id: \[\.\.\.locations\.keys\(\)\]\.join\(','\)/);
  assert.doesNotMatch(body, /waterservices\.usgs\.gov/);
  assert.match(body,
    /if \(result\.features\.length > 0\) \{[\s\S]{0,100}setCached\(cacheKey, result\)[\s\S]{0,100}recordFeedSuccess\('usgs-surface-water'\)/);
  assert.equal(count(body, /maxResponseBytes: USGS_WATER_MAX_RESPONSE_BYTES/g), 2);
  assert.match(body, /recordFeedSuccess\('usgs-surface-water'\)/);
  assert.match(body, /recordFeedFailure\('usgs-surface-water'/);
});

test('cache sweep preserves expired last-known-good data for upstream failure fallback', () => {
  const realNow = Date.now;
  let now = Date.parse('2026-08-21T20:00:00Z');
  const lastKnownGood = { events: ['REAL LAST-KNOWN-GOOD'] };
  try {
    Date.now = () => now;
    _resetSidecarCacheForTests();
    _setSidecarCachedForTests('fallback-regression', lastKnownGood, 1);
    now += 2;
    _sweepSidecarCacheForTests();

    assert.equal(_getSidecarCachedForTests('fallback-regression', 1), null);
    assert.deepEqual(_getSidecarCachedStaleForTests('fallback-regression'), lastKnownGood);
  } finally {
    Date.now = realNow;
    _resetSidecarCacheForTests();
  }
});

test('cache sweep still evicts the oldest entry above the hard cap', () => {
  const realNow = Date.now;
  let now = Date.parse('2026-08-21T20:00:00Z');
  try {
    Date.now = () => now;
    _resetSidecarCacheForTests();
    for (let index = 0; index <= 500; index += 1) {
      _setSidecarCachedForTests(`cap-${index}`, { index }, 1);
      now += 1;
    }

    assert.equal(_getSidecarCachedStaleForTests('cap-0'), null);
    assert.deepEqual(_getSidecarCachedStaleForTests('cap-500'), { index: 500 });
  } finally {
    Date.now = realNow;
    _resetSidecarCacheForTests();
  }
});

test('grid-outages records feed success only after ODIN contributes a usable row', () => {
  const route = routeBody('/api/grid-outages');
  assert.match(route, /odinRequestCanStart\(_odinInFlight, cacheKey\)/);
  assert.match(route, /maxResponseBytes: ODIN_MAX_RESPONSE_BYTES/);
  assert.match(route, /odinPageIsCompleteSidecar\(raw, query\.limit\)/);
  assert.match(route, /setOdinCached\(cacheKey, result, ODIN_TTL\)/);
  assert.match(route, /if \(parsed\.acceptedRows > 0\) recordFeedSuccess\('ornl-odin'\)/);
  assert.match(route, /else recordFeedFailure\('ornl-odin', 'no_contributed_rows'\)/);
});
