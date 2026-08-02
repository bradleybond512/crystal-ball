/**
 * Fail-closed guards for /api/space-weather-feeds.
 *
 * The route fans out to four SWPC products and returns them in one envelope.
 * Its first version reported success whenever the handler reached the end, so a
 * four-way upstream outage was cached as a healthy fetch for five minutes and
 * the space-weather panel sat blank with nothing flagging it. The second
 * version counted any non-null JSON as usable, which still passed `{}`, `false`
 * and four HTTP-200 empty arrays.
 *
 * Route ordering assertions are source-scoped (same convention and rationale as
 * fusion-route-fail-closed.test.mjs): fetchWithTimeout goes through node:https
 * directly, so there is no cheap upstream mock seam to drive these branches
 * behaviorally.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

process.env.LOCAL_API_TOKEN ??= 'test-token-for-sidecar-tests';
const { normalizeSwpcFeed, swpcFeedIsUsable } = await import('../local-api-server.mjs');

const __dir = path.dirname(fileURLToPath(import.meta.url));
const serverSrc = readFileSync(path.join(__dir, '..', 'local-api-server.mjs'), 'utf8');

function routeBody(pathname) {
  const start = serverSrc.indexOf(`requestUrl.pathname === '${pathname}'`);
  assert.notEqual(start, -1, `route ${pathname} must exist`);
  const next = serverSrc.indexOf('requestUrl.pathname ===', start + pathname.length);
  const end = next === -1 ? Math.min(serverSrc.length, start + 3000) : next;
  return serverSrc.slice(start, end);
}

// ── Shape normalization ─────────────────────────────────────────────────────

test('normalizeSwpcFeed keeps arrays and rejects every other JSON shape', () => {
  const rows = [{ time_tag: '2026-05-06T10:00:00', Kp: 4 }];
  assert.equal(normalizeSwpcFeed(rows), rows, 'a real product passes through by reference');
  assert.deepEqual(normalizeSwpcFeed([]), [], 'an empty array is still the right SHAPE');

  // Each of these arrived from a 200 response and would previously have been
  // forwarded to the renderer, whose parsers reject them silently.
  for (const wrong of [{}, { error: 'maintenance' }, false, 0, '', 'maintenance', null, undefined]) {
    assert.equal(normalizeSwpcFeed(wrong), null, `${JSON.stringify(wrong) ?? 'undefined'} is not a SWPC product`);
  }
});

test('swpcFeedIsUsable counts only arrays that actually carry rows', () => {
  assert.equal(swpcFeedIsUsable([{ Kp: 4 }]), true);

  // The whole point: an empty array is well-shaped but contributed nothing, so
  // it must not count toward the route reporting a healthy fetch.
  assert.equal(swpcFeedIsUsable([]), false, 'HTTP 200 + [] is not an observation');
  for (const wrong of [{}, false, 0, '', null, undefined]) {
    assert.equal(swpcFeedIsUsable(wrong), false, `${JSON.stringify(wrong) ?? 'undefined'} is not usable`);
  }
});

test('an all-empty fan-out yields zero usable feeds', () => {
  // Four HTTP 200s, four empty arrays — indistinguishable from success to the
  // previous `value !== null` check, and the exact signature of an upstream
  // outage. SWPC never returns four simultaneously empty products.
  const settled = { kp: [], wind: [], xray: [], alerts: [] };
  const usable = Object.values(settled).filter((value) => swpcFeedIsUsable(value)).length;
  assert.equal(usable, 0, 'this must reach the 502 branch, not trackSuccess');
});

// ── Route ordering ──────────────────────────────────────────────────────────

test('space-weather-feeds fails closed before recording success or caching', () => {
  const body = routeBody('/api/space-weather-feeds');
  const guardAt = body.indexOf('if (usable === 0)');
  assert.notEqual(guardAt, -1, 'the route must have a zero-yield guard');

  const successAt = body.indexOf('trackSuccess(');
  const cacheAt = body.indexOf('setCached(');
  assert.notEqual(successAt, -1, 'the route is expected to report health');
  assert.notEqual(cacheAt, -1, 'the route is expected to cache');
  assert.ok(guardAt < successAt, 'a four-way outage must never be recorded as a healthy fetch');
  assert.ok(guardAt < cacheAt, 'an all-null envelope must never be cached');

  assert.ok(body.includes('trackFailure('), 'a zero-yield fan-out must be recorded as a failure');
  assert.ok(body.includes('502'), 'and answered with an error status, not 200-with-nulls');
});

test('space-weather-feeds reads its cache without overriding the stored TTL', () => {
  const body = routeBody('/api/space-weather-feeds');

  // getCached prefers a supplied ttlMs over the entry's own. Passing one here
  // would silently defeat the shorter TTL a PARTIAL result is written with,
  // pinning a hole in the panel for the full five minutes.
  assert.ok(
    /getCached\('space-weather-feeds'\)/.test(body),
    'read the cache with no TTL argument so the per-write TTL governs',
  );
  assert.ok(
    /setCached\('space-weather-feeds', result, usable === entries\.length \? 5 \* 60 \* 1000 : 60 \* 1000\)/.test(body),
    'a partial result must be written with a shorter TTL than a complete one',
  );
});
