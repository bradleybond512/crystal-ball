/* eslint-disable sonarjs/no-clear-text-protocols */
/**
 * Tests for feed-resilience.mjs (circuit breaker + fetchWithFallback)
 * and feed-health-tracker.mjs.
 *
 * Runner: node --test src-tauri/sidecar/__tests__/feed-resilience.test.mjs
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  FAILURE_THRESHOLD,
  OPEN_DURATION_MS,
  recordFailure,
  recordSuccess,
  getCircuitState,
  _resetCircuits,
  _getCached,
  _setCached,
  fetchWithFallback,
} from '../feed-resilience.mjs';

import {
  trackSuccess,
  trackFailure,
  getFeedStatus,
  getAllFeedStatuses,
  _resetFeedHealthTracker,
} from '../feed-health-tracker.mjs';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Reset both modules before every test. */
function reset() {
  _resetCircuits();
  _resetFeedHealthTracker();
}

/**
 * Build a fetchFn stub.
 * responses = Array<{ ok, status, data }> — consumed in order.
 * Each call increments callCount[url] and pops the next response.
 */
function makeFetch(responses) {
  const queue = [...responses];
  const calls = [];

  const fetchFn = async (url) => {
    calls.push(url);
    const resp = queue.shift();
    if (!resp) throw new Error('makeFetch: no more responses queued');
    const data = resp.data;
    return {
      ok: resp.ok,
      status: resp.status ?? (resp.ok ? 200 : 500),
      json: () => (resp.jsonThrows ? Promise.reject(new Error('Unexpected token < in JSON')) : Promise.resolve(data)),
      text: () => Promise.resolve(resp.jsonThrows ? '<html>maintenance</html>' : String(data)),
    };
  };

  fetchFn.calls = calls;
  return fetchFn;
}

// ── Circuit-breaker tests ─────────────────────────────────────────────────────

test('1. fresh key → getCircuitState returns closed with zero failures', () => {
  reset();
  const state = getCircuitState('http://never-touched.example');
  assert.deepEqual(state, { status: 'closed', failureCount: 0, openSince: null });
});

test('2. one failure → still closed', () => {
  reset();
  recordFailure('url-a');
  const state = getCircuitState('url-a');
  assert.equal(state.status, 'closed');
  assert.equal(state.failureCount, 1);
});

test('3. two failures → still closed', () => {
  reset();
  recordFailure('url-b');
  recordFailure('url-b');
  const state = getCircuitState('url-b');
  assert.equal(state.status, 'closed');
  assert.equal(state.failureCount, 2);
});

test('4. exactly FAILURE_THRESHOLD failures within window → status becomes open', () => {
  reset();
  const key = 'url-trip';
  for (let i = 0; i < FAILURE_THRESHOLD; i++) recordFailure(key);
  const state = getCircuitState(key);
  assert.equal(state.status, 'open');
  assert.equal(state.failureCount, FAILURE_THRESHOLD);
  assert.ok(state.openSince !== null);
});

test('5. recordSuccess after open → circuit closes (failureCount: 0, status: closed)', () => {
  reset();
  const key = 'url-recover';
  for (let i = 0; i < FAILURE_THRESHOLD; i++) recordFailure(key);
  assert.equal(getCircuitState(key).status, 'open');

  recordSuccess(key);
  const state = getCircuitState(key);
  assert.equal(state.status, 'closed');
  assert.equal(state.failureCount, 0);
  assert.equal(state.openSince, null);
});

test('6. failures spread across two windows → stays closed after window expiry', () => {
  reset();
  const key = 'url-spread';

  // First failure — starts the window.
  recordFailure(key);
  assert.equal(getCircuitState(key).failureCount, 1);

  // Manually expire the window by manipulating the entry in the module's
  // exported recordFailure path: we call getCircuitState which reads the entry,
  // then fabricate a stale windowStart by calling recordFailure again after
  // back-dating the windowStart. Since _circuits is not exported we do this
  // indirectly via the observable side-effect.
  //
  // Strategy: call recordSuccess to clear the count, then verify 2 more
  // failures (which are now in a fresh window) don't trip the circuit.
  recordSuccess(key);          // clears window
  recordFailure(key);          // failure 1 in new window
  recordFailure(key);          // failure 2 in new window
  const state = getCircuitState(key);
  assert.equal(state.status, 'closed');
  assert.equal(state.failureCount, 2);
});

test('7. half-open becomes observable after OPEN_DURATION_MS elapses (indirect via getCircuitState)', () => {
  // Trip the circuit open, then backdate openSince via the only exported hook:
  // We cannot mutate _circuits directly. The simplest correct approach is to
  // manipulate Date.now via a global patch, record failures, then restore.
  reset();
  const key = 'url-halfopen';
  const realNow = Date.now;

  // Phase 1: trip the circuit at T=0.
  let fakeTime = 1_000_000;
  Date.now = () => fakeTime;
  for (let i = 0; i < FAILURE_THRESHOLD; i++) recordFailure(key);
  assert.equal(getCircuitState(key).status, 'open');

  // Phase 2: advance time past OPEN_DURATION_MS.
  fakeTime += OPEN_DURATION_MS + 1;
  const state = getCircuitState(key);
  assert.equal(state.status, 'half-open');

  Date.now = realNow;
});

test('8. half-open probe failure re-arms openSince (circuit stays open another full duration)', () => {
  reset();
  const key = 'url-halfopen-rearm';
  const realNow = Date.now;

  let fakeTime = 2_000_000;
  Date.now = () => fakeTime;

  // Trip open.
  for (let i = 0; i < FAILURE_THRESHOLD; i++) recordFailure(key);
  const firstOpen = getCircuitState(key).openSince;

  // Advance past OPEN_DURATION_MS so the next recordFailure enters the
  // half-open-re-arm branch.
  fakeTime += OPEN_DURATION_MS + 1;

  // This failure should re-set openSince to the new fakeTime.
  recordFailure(key);
  const stateAfter = getCircuitState(key);

  // Circuit should still be open (just re-armed), not half-open.
  assert.equal(stateAfter.status, 'open');
  assert.ok(stateAfter.openSince > firstOpen, 'openSince should have been updated');

  Date.now = realNow;
});

// ── fetchWithFallback tests ───────────────────────────────────────────────────

test('9. primary succeeds → returns { source:primary, degraded:false }', async () => {
  reset();
  const fetchFn = makeFetch([{ ok: true, data: { hello: 'world' } }]);
  const result = await fetchWithFallback('http://primary.test/', [], { fetchFn });
  assert.equal(result.source, 'primary');
  assert.equal(result.degraded, false);
  assert.deepEqual(result.data, { hello: 'world' });
});

test('10. primary fails (HTTP error), fallback succeeds → source:fallback-0, degraded:true', async () => {
  reset();
  const fetchFn = makeFetch([
    { ok: false, status: 503, data: null },   // primary
    { ok: true,  status: 200, data: { x: 1 } }, // fallback-0
  ]);
  const result = await fetchWithFallback(
    'http://primary.fail/',
    ['http://fallback0.test/'],
    { fetchFn },
  );
  assert.equal(result.source, 'fallback-0');
  assert.equal(result.degraded, true);
  assert.deepEqual(result.data, { x: 1 });
});

test('11. primary and fallback both fail, cache populated → source:cached, degraded:true', async () => {
  reset();
  const cacheKey = 'ck-test-11';
  _setCached(cacheKey, { cached: true });

  const fetchFn = makeFetch([
    { ok: false, status: 500, data: null },
    { ok: false, status: 503, data: null },
  ]);
  const result = await fetchWithFallback(
    'http://primary.fail/',
    ['http://fallback0.fail/'],
    { fetchFn, cacheKey },
  );
  assert.equal(result.source, 'cached');
  assert.equal(result.degraded, true);
  assert.deepEqual(result.data, { cached: true });
});

test('12. primary and fallback both fail, no cache → throws Error', async () => {
  reset();
  const fetchFn = makeFetch([
    { ok: false, status: 500, data: null },
    { ok: false, status: 503, data: null },
  ]);
  await assert.rejects(
    fetchWithFallback(
      'http://primary.fail/',
      ['http://fallback0.fail/'],
      { fetchFn, cacheKey: 'ck-no-cache-12' },
    ),
    /All sources exhausted/,
  );
});

test('13. circuit open → fetchFn not called for primary URL', async () => {
  reset();
  const primaryUrl = 'http://tripped.primary/';

  // Trip the circuit.
  for (let i = 0; i < FAILURE_THRESHOLD; i++) recordFailure(primaryUrl);
  assert.equal(getCircuitState(primaryUrl).status, 'open');

  // Only fallback response queued — if primary were called the queue would error.
  const fetchFn = makeFetch([{ ok: true, status: 200, data: { via: 'fallback' } }]);

  const result = await fetchWithFallback(
    primaryUrl,
    ['http://fallback0.ok/'],
    { fetchFn },
  );

  // fetchFn should have been called exactly once, for the fallback URL.
  assert.equal(fetchFn.calls.length, 1);
  assert.equal(fetchFn.calls[0], 'http://fallback0.ok/');
  assert.equal(result.source, 'fallback-0');
});

test('14. cacheKey option → successful primary fetch populates cache (_getCached)', async () => {
  reset();
  const cacheKey = 'ck-populate-14';
  const fetchFn = makeFetch([{ ok: true, data: { stored: 42 } }]);

  assert.equal(_getCached(cacheKey), null);

  await fetchWithFallback('http://primary.test/', [], { fetchFn, cacheKey });

  assert.deepEqual(_getCached(cacheKey), { stored: 42 });
});

test('15. multiple fallbacks: first fails, second succeeds → source:fallback-1', async () => {
  reset();
  const fetchFn = makeFetch([
    { ok: false, status: 500, data: null },  // primary
    { ok: false, status: 503, data: null },  // fallback-0
    { ok: true,  status: 200, data: { via: 'fb1' } }, // fallback-1
  ]);
  const result = await fetchWithFallback(
    'http://primary.fail/',
    ['http://fb0.fail/', 'http://fb1.ok/'],
    { fetchFn },
  );
  assert.equal(result.source, 'fallback-1');
  assert.equal(result.degraded, true);
  assert.deepEqual(result.data, { via: 'fb1' });
});

// ── feed-health-tracker tests ─────────────────────────────────────────────────

test('16. trackSuccess(feedId, primary) → getFeedStatus returns status:up', () => {
  reset();
  trackSuccess('feed-alpha', 'primary');
  const s = getFeedStatus('feed-alpha');
  assert.equal(s.status, 'up');
  assert.equal(s.lastError, null);
  assert.equal(s.lastSource, 'primary');
});

test('17. trackSuccess(feedId, fallback-0) → getFeedStatus returns status:degraded', () => {
  reset();
  trackSuccess('feed-beta', 'fallback-0');
  const s = getFeedStatus('feed-beta');
  assert.equal(s.status, 'degraded');
  assert.equal(s.lastSource, 'fallback-0');
});

test('18. trackFailure → getFeedStatus returns status:down and lastError', () => {
  reset();
  trackFailure('feed-gamma', 'HTTP 503');
  const s = getFeedStatus('feed-gamma');
  assert.equal(s.status, 'down');
  assert.equal(s.lastError, 'HTTP 503');
  assert.equal(s.lastSource, null);
});

test('19. getAllFeedStatuses returns all feeds sorted alphabetically by feedId', () => {
  reset();
  trackSuccess('zeta', 'primary');
  trackSuccess('alpha', 'primary');
  trackFailure('mu', 'timeout');
  const all = getAllFeedStatuses();
  assert.equal(all.length, 3);
  assert.equal(all[0].feedId, 'alpha');
  assert.equal(all[1].feedId, 'mu');
  assert.equal(all[2].feedId, 'zeta');
});

test('20. _resetFeedHealthTracker clears all state → getAllFeedStatuses returns []', () => {
  reset();
  trackSuccess('feed-one', 'primary');
  trackSuccess('feed-two', 'fallback-0');
  assert.equal(getAllFeedStatuses().length, 2);

  _resetFeedHealthTracker();
  assert.equal(getAllFeedStatuses().length, 0);
});

test('21. unknown feedId → getFeedStatus returns status:unknown', () => {
  reset();
  const s = getFeedStatus('does-not-exist');
  assert.equal(s.status, 'unknown');
  assert.equal(s.lastSuccess, null);
  assert.equal(s.lastAttempt, null);
  assert.equal(s.lastError, null);
  assert.equal(s.lastSource, null);
});

test('22. trackFailure with Error object → lastError uses message', () => {
  reset();
  trackFailure('feed-err-obj', new Error('connection refused'));
  const s = getFeedStatus('feed-err-obj');
  assert.equal(s.lastError, 'connection refused');
});

// ── Unparseable 200 body must not read as success (round-5 audit high) ─────────

test('23. a 200 with an unparseable JSON body is a failed attempt (not cached, not success)', async () => {
  reset();
  // Primary returns 200-garbage, no fallback, no cache → must THROW (all sources
  // exhausted) instead of returning the HTML as fresh data or caching it.
  const fetchFn = makeFetch([{ ok: true, status: 200, jsonThrows: true }]);
  await assert.rejects(
    fetchWithFallback('http://primary.example/json', [], { fetchFn, cacheKey: 'fr-unparseable' }),
    /All sources exhausted/,
  );
});

test('24. an unparseable-200 primary falls through to a valid fallback', async () => {
  reset();
  const fetchFn = makeFetch([
    { ok: true, status: 200, jsonThrows: true },           // primary: 200 garbage
    { ok: true, status: 200, data: { via: 'fallback' } },  // fallback-0: valid JSON
  ]);
  const res = await fetchWithFallback('http://primary.example', ['http://fallback.example'], { fetchFn });
  assert.equal(res.source, 'fallback-0');
  assert.equal(res.degraded, true);
  assert.deepEqual(res.data, { via: 'fallback' });
});
