/**
 * Fail-closed guards for /api/space-weather-feeds and its two sibling
 * space-weather caches.
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
const {
  normalizeSwpcFeed,
  swpcFeedIsUsable,
  buildSwpcEnvelope,
  fetchSpaceweatherStatusSidecar,
  fetchSpaceweatherAlertsSidecar,
} = await import('../local-api-server.mjs');

/** A minimally valid row for each product, per that product's real shape. */
const GOOD = {
  kp: [{ time_tag: '2026-05-06T10:00:00', Kp: 4 }],
  wind: [['time_tag', 'speed', 'density', 'bz'], ['2026-05-06 10:00:00.000', '480', '5.2', '-3.1']],
  xray: [{ max_class: 'M2.4', current_class: 'C1.1' }],
  alerts: [{ product_id: 'ALTK07', issue_datetime: '2026-05-06 10:00:00.000', message: 'ALERT: Kp 7' }],
};

const __dir = path.dirname(fileURLToPath(import.meta.url));
const serverSrc = readFileSync(path.join(__dir, '..', 'local-api-server.mjs'), 'utf8');

/** Function source with `//` comments dropped — these guards explain themselves
 *  in prose that would otherwise match the very patterns they forbid. */
// Indent is [ \t] rather than \s: under /m, \s also matches the newline, so \s*
// could span lines and backtrack super-linearly on a long non-matching run.
const codeOf = (fn) => fn.toString().replace(/^[ \t]*\/\/.*$/gm, '');

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

test('swpcFeedIsUsable accepts a real row of each product', () => {
  for (const [key, value] of Object.entries(GOOD)) {
    assert.equal(swpcFeedIsUsable(key, value), true, `a real ${key} payload is usable`);
  }
});

test('swpcFeedIsUsable rejects every non-array shape, per product', () => {
  for (const key of Object.keys(GOOD)) {
    // The whole point: an empty array is well-shaped but contributed nothing,
    // so it must not count toward the route reporting a healthy fetch.
    assert.equal(swpcFeedIsUsable(key, []), false, `HTTP 200 + [] is not a ${key} observation`);
    for (const wrong of [{}, false, 0, '', null, undefined]) {
      assert.equal(swpcFeedIsUsable(key, wrong), false, `${JSON.stringify(wrong) ?? 'undefined'} is not a usable ${key}`);
    }
  }
});

test('swpcFeedIsUsable rejects rows every downstream parser would discard', () => {
  // Each of these is a NON-EMPTY array — the row-presence check counted all
  // four as healthy votes while the panel stayed blank, which is the same
  // fail-open shape as the empty array, one layer in.
  assert.equal(swpcFeedIsUsable('kp', [{ Kp: 4 }]), false, 'a Kp row with no time_tag parses to nothing');
  assert.equal(swpcFeedIsUsable('kp', [{ time_tag: '2026-05-06T10:00:00', Kp: null }]), false, 'Number(null) is 0, not a quiet sky');
  // Same trap, different falsy value. Listing the absent values by identity
  // caught null/undefined/'' and missed these, each of which coerces to a
  // perfectly plausible Kp 0 — which is why the check is on TYPE now.
  assert.equal(swpcFeedIsUsable('kp', [{ time_tag: '2026-05-06T10:00:00', Kp: false }]), false, 'Number(false) is 0 too');
  assert.equal(swpcFeedIsUsable('kp', [{ time_tag: '2026-05-06T10:00:00', Kp: [] }]), false, 'Number([]) is 0 as well');
  assert.equal(swpcFeedIsUsable('kp', [{ time_tag: '2026-05-06T10:00:00', Kp: '   ' }]), false, 'and whitespace coerces to 0');
  // Kp is a 0-9 index. A bogus extreme is corrupt data, and it would trip the
  // Kp>=5 storm alerting downstream if it were vouched for here.
  assert.equal(swpcFeedIsUsable('kp', [{ time_tag: '2026-05-06T10:00:00', Kp: 47 }]), false, 'Kp 47 is not a measurement');
  assert.equal(swpcFeedIsUsable('kp', [{ time_tag: '2026-05-06T10:00:00', Kp: -1 }]), false, 'nor is a negative index');
  assert.equal(swpcFeedIsUsable('xray', [{}]), false, 'an object with no class field is not a flare');
  assert.equal(swpcFeedIsUsable('xray', ['maintenance']), false, 'a status string is not a flare');
  assert.equal(swpcFeedIsUsable('xray', [{ max_class: 'maintenance' }]), false, 'only A/B/C/M/X grammar counts as a class');
  assert.equal(swpcFeedIsUsable('wind', [['time_tag', 'speed', 'density', 'bz']]), false, 'a lone header row carries no measurement');
  // The wind slot is header-row + array-of-arrays. Handing it the array-of-OBJECTS
  // shape is the exact confusion behind the original bug, and the parser reads
  // nothing out of it — so it must not count as a vote either.
  assert.equal(
    swpcFeedIsUsable('wind', [{ time_tag: '2026-05-06T10:00:00', speed: 480 }, { time_tag: '2026-05-06T10:01:00', speed: 481 }]),
    false,
    'the array-of-objects shape is not a wind series',
  );
  // Row 0 is the only thing the header check constrains — the slice(1) scan never
  // looks at it. A garbled body that leads with a non-row and happens to carry a
  // well-formed array later would otherwise be indexed off by one and vouched for.
  assert.equal(
    swpcFeedIsUsable('wind', ['error: upstream unavailable', ['2026-05-06 10:00:00.000', '480', '5.2', '-3.1']]),
    false,
    'a body whose first element is not a header row is not a wind series',
  );
  assert.equal(swpcFeedIsUsable('alerts', [{ message: 'ALERT: Kp 7' }]), false, 'an alert with no issue_datetime is dropped');
});

test('the X-ray class grammar matches the renderer letter for letter', () => {
  // Both halves gate on this: the sidecar decides whether the product counts as
  // a healthy vote, the renderer decides whether it is displayed. If they drift,
  // one reports a good fetch of a class the other refuses to show.
  const tsSrc = readFileSync(path.join(__dir, '..', '..', '..', 'src', 'services', 'space-weather-parse.ts'), 'utf8');
  const ts = tsSrc.match(/^const XRAY_CLASS_RE = (.+);$/m);
  const js = serverSrc.match(/^const SWPC_XRAY_CLASS_RE = (.+);$/m);
  assert.ok(ts, 'XRAY_CLASS_RE must exist in space-weather-parse.ts');
  assert.ok(js, 'SWPC_XRAY_CLASS_RE must exist in the sidecar');
  assert.equal(js[1], ts[1], 'the two flare-class patterns must stay identical');
});

test('swpcFeedIsUsable will not vouch for a product it does not know', () => {
  // Allowlist, never denylist. If a future feed is added to the fan-out and
  // nobody writes its predicate, it must not silently count as a healthy vote.
  assert.equal(swpcFeedIsUsable('solar-flux', [{ anything: 1 }]), false, 'an unrecognized product is not assumed good');
});

test('no Object.prototype key can act as a predicate', () => {
  // On a plain object literal these all resolve to real inherited functions.
  // `constructor` returns the boxed value (truthy); the other eight THROW when
  // invoked bare, because `this` is undefined under ESM strict mode — and
  // swpcFeedIsUsable has no try/catch, so that is a 500 on the route rather than
  // an honest "not usable". The dispatch table is null-prototype to prevent both.
  for (const key of Object.getOwnPropertyNames(Object.prototype)) {
    assert.equal(swpcFeedIsUsable(key, GOOD.kp), false, `${key} must not be treated as a product predicate`);
  }
});

test('buildSwpcEnvelope normalizes shape and counts usability independently', () => {
  const { feeds, usable, total } = buildSwpcEnvelope([
    ['kp', GOOD.kp],
    ['wind', GOOD.wind],
    ['xray', GOOD.xray],
    ['alerts', GOOD.alerts],
  ]);
  assert.deepEqual(Object.keys(feeds), ['kp', 'wind', 'xray', 'alerts']);
  assert.equal(usable, 4);
  assert.equal(total, 4);
});

test('buildSwpcEnvelope forwards well-shaped-but-empty products without counting them', () => {
  // Four HTTP 200s, four empty arrays — indistinguishable from success to the
  // original `value !== null` check, and the exact signature of an upstream
  // outage. SWPC never returns four simultaneously empty products.
  const { feeds, usable, total } = buildSwpcEnvelope([
    ['kp', []],
    ['wind', []],
    ['xray', []],
    ['alerts', []],
  ]);
  assert.deepEqual(feeds, { kp: [], wind: [], xray: [], alerts: [] }, 'shape is preserved for the renderer');
  assert.equal(usable, 0, 'but this must reach the 502 branch, not trackSuccess');
  assert.equal(total, 4);
});

test('buildSwpcEnvelope nulls wrong-shape bodies and reports a partial fan-out', () => {
  const { feeds, usable, total } = buildSwpcEnvelope([
    ['kp', GOOD.kp],
    ['wind', { error: 'maintenance' }],
    ['xray', [{}]],
    ['alerts', GOOD.alerts],
  ]);
  assert.deepEqual(feeds.kp, GOOD.kp);
  assert.equal(feeds.wind, null, 'an error envelope behind a 200 is not a product');
  assert.deepEqual(feeds.xray, [{}], 'shape is array, so it is forwarded — but it parses to nothing');
  assert.equal(usable, 2, 'only the two parseable products count');
  assert.equal(total, 4, 'total stays the fan-out size, so usable < total means PARTIAL');
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
    /setCached\('space-weather-feeds', result, usable === total \? 5 \* 60 \* 1000 : 60 \* 1000\)/.test(body),
    'a partial result must be written with a shorter TTL than a complete one',
  );
});

test('space-weather-feeds derives its envelope from buildSwpcEnvelope', () => {
  // This is the assertion the previous version was missing. Its guards all
  // targeted helper BODIES, so replacing the route's own reduction with
  // `value !== null` left every sidecar test green — the helpers were correct
  // and simply unused. Pinning the call site is what makes the behavioural
  // buildSwpcEnvelope tests above actually cover this route.
  const body = routeBody('/api/space-weather-feeds');
  assert.ok(body.includes('buildSwpcEnvelope('), 'the route must reduce through the tested helper, not re-derive inline');
  assert.ok(
    /const \{ feeds: result, usable, total \} = buildSwpcEnvelope\(decoded\)/.test(body),
    'and take shape, usable count and total from it',
  );
  assert.ok(
    !/value !== null/.test(body),
    'and must not re-derive usability from mere non-nullness — the exact mutation that went undetected',
  );
});

// ── Sibling space-weather caches ────────────────────────────────────────────
//
// /api/spaceweather/status and /api/spaceweather/alerts hold their own
// module-level caches. Neither goes through getCached, so the guards above
// don't reach them, and both had the same fail-open bug: an outage produced a
// reassuring reading ("Nominal" / "No active alerts") that was then pinned for
// the full TTL. These read the LIVE exported function source rather than the
// file, so an assertion can't drift away from what actually runs.

test('the status cache is written from adapter output, not from a non-null body', () => {
  const src = codeOf(fetchSpaceweatherStatusSidecar);
  const guardAt = src.search(/if \(xrayFlux\.length > 0 \|\| kpIndex\.length > 0\)/);
  assert.notEqual(guardAt, -1, 'cacheability must be decided on what the normalizers produced');
  assert.ok(guardAt < src.indexOf('spacewxStatusCache ='), 'and decided before the write');

  // `xrayRaw`/`kpRaw` are non-null for an HTTP 200 carrying `[]`, so testing
  // them caches a status with no flux and no Kp — which renders identically to
  // a genuinely quiet sun for the whole TTL.
  assert.ok(
    !/if \([^)]*(xrayRaw|kpRaw)[^)]*\)\s*\{[^}]*spacewxStatusCache/.test(src),
    'the raw bodies must not gate the cache write',
  );
});

test('the alerts cache is written only for a well-shaped body', () => {
  const src = codeOf(fetchSpaceweatherAlertsSidecar);
  const guardAt = src.indexOf('if (Array.isArray(raw))');
  assert.notEqual(guardAt, -1, 'only a real array may be cached');
  assert.ok(guardAt < src.indexOf('spacewxAlertsCache ='), 'and the check must precede the write');

  // The two mutations this replaced. `raw !== null` caches `{}` behind a 200;
  // `alerts.length` refuses to cache a genuinely quiet window, which is a
  // legitimate empty result and would re-fetch on every single call.
  assert.ok(!/raw !== null/.test(src), 'a non-null wrong-shape body is not an observation');
  assert.ok(!/alerts\.length/.test(src), 'but a genuinely quiet window IS, and must still be cached');
});
