import { strict as assert } from 'node:assert';
import test from 'node:test';
import { ipawsOutageDisposition, promedResultIsDegraded, gdacsResultShouldCache } from '../local-api-server.mjs';

// The /api/alerts/active route's safeJson() + Promise.allSettled swallow upstream
// errors, so the route's catch is unreachable for a NWS/FEMA outage. This pure
// helper carries the safety rule the route relies on: a TOTAL outage of the
// federal emergency-alert feed must be marked failed + degraded (and NOT cached
// as a fresh all-clear), never silently delivered as "no active alerts".

test('both upstreams down → total outage, degraded, must fail (not a fresh all-clear)', () => {
  const d = ipawsOutageDisposition(null, null);
  assert.equal(d.totalOutage, true);
  assert.equal(d.partialOutage, true);
  assert.equal(d.degraded, true);
  assert.match(d.reason, /both/i);
});

test('one upstream down → partial outage, degraded, but still serviceable', () => {
  const a = ipawsOutageDisposition({ features: [] }, null);
  assert.equal(a.totalOutage, false);
  assert.equal(a.partialOutage, true);
  assert.equal(a.degraded, true);
  assert.match(a.reason, /one/i);

  const b = ipawsOutageDisposition(null, { DisasterDeclarationsSummaries: [] });
  assert.equal(b.totalOutage, false);
  assert.equal(b.degraded, true);
});

test('both upstreams up → healthy, not degraded', () => {
  const d = ipawsOutageDisposition({ features: [] }, { DisasterDeclarationsSummaries: [] });
  assert.equal(d.totalOutage, false);
  assert.equal(d.partialOutage, false);
  assert.equal(d.degraded, false);
  assert.equal(d.reason, null);
});

test('undefined is treated the same as null (defensive)', () => {
  assert.equal(ipawsOutageDisposition(undefined, undefined).totalOutage, true);
});

// ProMED: a 200 that parses to zero alerts is a break signal (non-RSS body /
// schema change), not a quiet feed — must be treated as degraded + uncached so
// the route can't serve a fresh 15-min "zero disease outbreaks".
test('promedResultIsDegraded: 0 parsed alerts → degraded', () => {
  assert.equal(promedResultIsDegraded([]), true);
  assert.equal(promedResultIsDegraded(null), true);
  assert.equal(promedResultIsDegraded(undefined), true);
  assert.equal(promedResultIsDegraded('not-an-array'), true);
});
test('promedResultIsDegraded: real alerts → not degraded', () => {
  assert.equal(promedResultIsDegraded([{ id: 'a' }]), false);
  assert.equal(promedResultIsDegraded([{ id: 'a' }, { id: 'b' }]), false);
});

// GDACS: a degraded EMPTY result (the ERCC fallback discards its response →
// events=[]) must NOT be cached for the full 30-min TTL — that would serve "zero
// global disasters" as a fresh all-clear. Real results (or non-degraded primary)
// cache normally.
test('gdacsResultShouldCache: degraded + empty → do NOT cache', () => {
  assert.equal(gdacsResultShouldCache(true, 0), false);
});
test('gdacsResultShouldCache: degraded fallback WITH events → cache', () => {
  assert.equal(gdacsResultShouldCache(true, 5), true);
});
test('gdacsResultShouldCache: healthy primary (any count) → cache', () => {
  assert.equal(gdacsResultShouldCache(false, 0), true);
  assert.equal(gdacsResultShouldCache(false, 12), true);
});
