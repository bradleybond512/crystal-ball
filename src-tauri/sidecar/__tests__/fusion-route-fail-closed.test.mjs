/**
 * Fail-closed guards for three fusion-domain routes.
 *
 * The invariant: a provider that returned nothing usable must be recorded as
 * DOWN. A route that answers 200-with-empty-payload for a malformed upstream
 * body hands the renderer a phantom healthy vote — the provider counts toward
 * "verified by N independent sources" having contributed nothing — and, worse,
 * caches that verdict for the route's whole TTL so every retry inside the
 * window reads the poisoned entry.
 *
 *   1. /api/internet-outages     — a non-array `data` is a broken envelope, not
 *                                  a quiet internet.
 *   2. /api/internet-outages-cf  — annotations present but NONE structurally
 *                                  usable is a shape mismatch, not a quiet
 *                                  internet. (Zero annotations still succeeds:
 *                                  that is the domain's deliberate inversion.)
 *   3. /api/fx-rates-erapi       — `result: "success"` alone does not make a
 *                                  payload cacheable for six hours.
 *
 * Route ordering assertions are source-scoped (same convention and rationale as
 * purpleair-route-guards.test.mjs and sidecar-ttl-cache-guards.test.mjs):
 * fetchWithTimeout goes through node:https directly, so there is no cheap
 * upstream mock seam to drive these branches behaviorally.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

process.env.LOCAL_API_TOKEN ??= 'test-token-for-sidecar-tests';
const {
  iodaEnvelopeIsWellFormed,
  parseIodaAlerts,
  countUsableCfAnnotations,
  parseCloudflareRadarOutages,
  erApiRejectReason,
} = await import('../local-api-server.mjs');

const __dir = path.dirname(fileURLToPath(import.meta.url));
const serverSrc = readFileSync(path.join(__dir, '..', 'local-api-server.mjs'), 'utf8');

function routeBody(pathname) {
  const start = serverSrc.indexOf(`requestUrl.pathname === '${pathname}'`);
  assert.notEqual(start, -1, `route ${pathname} must exist`);
  const next = serverSrc.indexOf('requestUrl.pathname ===', start + pathname.length);
  const end = next === -1 ? Math.min(serverSrc.length, start + 3000) : next;
  return serverSrc.slice(start, end);
}

/** Assert `guard` appears in the route AND runs before anything is cached. */
function assertGuardsBeforeCaching(pathname, guard) {
  const body = routeBody(pathname);
  const guardAt = body.indexOf(guard);
  assert.notEqual(guardAt, -1, `${pathname} must call ${guard}`);
  const cacheAt = body.indexOf('setCached(');
  assert.notEqual(cacheAt, -1, `${pathname} is expected to cache`);
  assert.ok(guardAt < cacheAt, `${pathname} must run ${guard} BEFORE setCached — a malformed body must never be cached`);
}

// ── /api/internet-outages: malformed envelope ≠ quiet internet ───────────────

test('parseIodaAlerts cannot tell a broken envelope from a quiet internet — so the route must', () => {
  // Both collapse onto []. That is fine for the parser, and fatal for the
  // route: one is a real zero-outage observation, the other is upstream
  // returning maintenance HTML/JSON behind a 200.
  assert.deepEqual(parseIodaAlerts({ data: [] }), [], 'quiet internet');
  assert.deepEqual(parseIodaAlerts({ error: 'maintenance' }), [], 'broken envelope');

  assert.equal(iodaEnvelopeIsWellFormed({ data: [] }), true, 'an empty data ARRAY is a real observation');
  assert.equal(iodaEnvelopeIsWellFormed({ error: 'maintenance' }), false, 'no data key at all');
  assert.equal(iodaEnvelopeIsWellFormed({ data: null }), false, 'data present but null');
  assert.equal(iodaEnvelopeIsWellFormed({ data: {} }), false, 'data present but an object');
  assert.equal(iodaEnvelopeIsWellFormed({ data: 'maintenance' }), false, 'data present but a string');
  assert.equal(iodaEnvelopeIsWellFormed(null), false, 'body did not parse as JSON at all');
  assert.equal(iodaEnvelopeIsWellFormed(undefined), false);
});

test('/api/internet-outages rejects a malformed envelope with an uncached 502', () => {
  assertGuardsBeforeCaching('/api/internet-outages', 'iodaEnvelopeIsWellFormed');
  const body = routeBody('/api/internet-outages');
  assert.match(body, /iodaEnvelopeIsWellFormed\(raw\)[\s\S]{0,220}?degraded: true[\s\S]{0,120}?\}, 502\)/, 'the guard must return 502 degraded, not a 200 with an empty list');
});

// ── /api/internet-outages-cf: no usable rows ≠ quiet internet ────────────────

test('countUsableCfAnnotations counts only structurally complete annotations', () => {
  const usableRow = { locations: ['BF'], startDate: '2026-07-29T00:00:00Z' };
  assert.equal(countUsableCfAnnotations({ result: { annotations: [usableRow] } }), 1);
  assert.equal(countUsableCfAnnotations({ result: { annotations: [] } }), 0, 'quiet internet — the route treats this case separately');

  // Every individual defect drops the row.
  assert.equal(countUsableCfAnnotations({ result: { annotations: [{ startDate: '2026-07-29T00:00:00Z' }] } }), 0, 'no locations');
  assert.equal(countUsableCfAnnotations({ result: { annotations: [{ locations: 'BF', startDate: '2026-07-29T00:00:00Z' }] } }), 0, 'locations is a bare string');
  assert.equal(countUsableCfAnnotations({ result: { annotations: [{ locations: ['BF'] }] } }), 0, 'no startDate');
  assert.equal(countUsableCfAnnotations({ result: { annotations: [{ locations: ['BF'], startDate: 'not-a-date' }] } }), 0, 'unparseable startDate');
  assert.equal(countUsableCfAnnotations({ result: { annotations: [{ locations: ['BF'], startDate: 1_753_747_200_000 }] } }), 0, 'startDate must be a string');
  assert.equal(countUsableCfAnnotations({ result: {} }), 0);
  assert.equal(countUsableCfAnnotations(null), 0);
});

test('countUsableCfAnnotations keeps the tick alive when SOME rows parse', () => {
  // One bad row among many must not kill the tick: the route only rejects when
  // upstream announced annotations and we could extract nothing at all.
  const raw = { result: { annotations: [
    { locations: ['BF'], startDate: '2026-07-29T00:00:00Z' },
    { startDate: '2026-07-29T01:00:00Z' },
    { locations: ['IR'], startDate: 'garbage' },
  ] } };
  assert.equal(countUsableCfAnnotations(raw), 1, 'the one good row is enough for the route to proceed');
  assert.deepEqual(parseCloudflareRadarOutages(raw), [{ country: 'BF', startedAt: Date.parse('2026-07-29T00:00:00Z') }]);

  // The rejected case: annotations announced, none usable.
  const allBad = { result: { annotations: [{ startDate: '2026-07-29T00:00:00Z' }, { locations: ['IR'] }] } };
  assert.equal(countUsableCfAnnotations(allBad), 0);
  assert.deepEqual(parseCloudflareRadarOutages(allBad), [], 'the parser reports the same [] as a genuinely quiet internet');
});

test('/api/internet-outages-cf rejects an all-unusable annotation list with an uncached 502', () => {
  assertGuardsBeforeCaching('/api/internet-outages-cf', 'countUsableCfAnnotations');
  const body = routeBody('/api/internet-outages-cf');
  assert.match(body, /annotations\.length > 0 && countUsableCfAnnotations\(raw\) === 0/, 'the guard must be conditional on annotations being present — an empty list stays a success');
  assert.match(body, /countUsableCfAnnotations\(raw\) === 0\)[\s\S]{0,220}?degraded: true[\s\S]{0,120}?\}, 502\)/);
});

// ── /api/fx-rates-erapi: "success" is not enough to earn a 6-hour cache ──────

test('erApiRejectReason accepts a genuinely usable payload', () => {
  assert.equal(erApiRejectReason({ result: 'success', rates: { EUR: 0.92 }, time_last_update_unix: 1_753_747_200 }), null);
});

test('erApiRejectReason rejects a "success" payload with no usable observation time', () => {
  // The shape that motivated this gate: result "success", so a result-only
  // check caches it for six hours — with a null timestamp the renderer's own
  // fx-fusion-fetch correctly fails closed on, forever, against a cache the
  // next poll cannot displace.
  const noTime = { result: 'success', rates: { EUR: 0.92 }, time_last_update_unix: null };
  assert.match(erApiRejectReason(noTime) ?? '', /time_last_update_unix/, 'the reason must name what was wrong');

  for (const bad of [undefined, 0, -1, Number.NaN, '1753747200']) {
    const reason = erApiRejectReason({ result: 'success', rates: { EUR: 0.92 }, time_last_update_unix: bad });
    assert.match(reason ?? '', /time_last_update_unix/, `time_last_update_unix ${String(bad)} must be rejected`);
  }
});

test('erApiRejectReason rejects a "success" payload carrying no rates', () => {
  assert.match(erApiRejectReason({ result: 'success', rates: {}, time_last_update_unix: 1_753_747_200 }) ?? '', /rates/);
  assert.match(erApiRejectReason({ result: 'success', time_last_update_unix: 1_753_747_200 }) ?? '', /result|rates/);
  assert.match(erApiRejectReason({ result: 'error' }) ?? '', /result/);
  assert.match(erApiRejectReason(null) ?? '', /unparseable/);
});

test('/api/fx-rates-erapi runs the payload gate before its 6-hour cache write', () => {
  assertGuardsBeforeCaching('/api/fx-rates-erapi', 'erApiRejectReason');
  const body = routeBody('/api/fx-rates-erapi');
  assert.match(body, /erApiReject\)[\s\S]{0,240}?degraded: true[\s\S]{0,120}?\}, 502\)/, 'a rejected payload returns 502 degraded and is never cached');
});

test('/api/earthquakes freezes generatedAt into the cache instead of re-stamping on a hit', () => {
  // The fusion fetcher's whole replay defence rests on this. `source` stays
  // 'primary' on a cache hit, so age is the only signal separating a live
  // fetch from a 59-second-old replay — and age is only meaningful if the hit
  // carries the ORIGINAL fetch instant. Stamping generatedAt on the way out
  // (or rebuilding the envelope on the hit path) would make every replay read
  // as zero seconds old and re-stamp lastSuccessAt onto stale rows.
  //
  // Source-scoped for the reason at the top of this file: fetchWithTimeout
  // goes straight to node:https, so there is no seam to drive a real
  // miss-then-hit through. What is checkable is that only one code path
  // stamps the field and the hit path returns the stored object untouched.
  const body = routeBody('/api/earthquakes');

  const stamps = [...body.matchAll(/generatedAt:/g)];
  assert.equal(stamps.length, 1, 'generatedAt must be stamped in exactly one place — a second stamp is a re-stamp');

  // Bound to the identifier, not just to ordering: caching `events` instead of
  // `payload` leaves the single stamp and every ordering assertion intact while
  // each hit replays a bare array with no timestamp at all.
  const stamped = body.match(/const (\w+) = \{[^}]*generatedAt:[^}]*\}/);
  assert.ok(stamped, 'generatedAt must be stamped into a named envelope the cache can hold');
  const cached = body.match(/setCached\('usgs-earthquakes',\s*(\w+),/);
  assert.ok(cached, 'the earthquakes route must cache its envelope');
  assert.equal(
    cached[1],
    stamped[1],
    `the cached value must BE the stamped envelope — caching ${cached[1]} instead of ${stamped[1]} ` +
    'serves hits with no generatedAt, and the fusion fetcher then rejects every one of them',
  );
  assert.ok(body.indexOf('generatedAt:') < body.indexOf('setCached('),
    'generatedAt must be stamped BEFORE the cache write so the hit replays it');
  assert.match(
    body,
    new RegExp(String.raw`return json\(${stamped[1]}\)`),
    'the miss must answer with the same envelope it cached, so a hit and a miss agree',
  );

  const hit = body.match(/const cached = getCached\('usgs-earthquakes'\);\s*if \(cached\) return json\(cached\);/);
  assert.ok(hit, 'the hit path must return the cached envelope verbatim, with no rebuild or re-stamp');
  assert.ok(body.indexOf('const cached =') < body.indexOf('generatedAt:'),
    'the cache read must short-circuit before the upstream fetch');
});
