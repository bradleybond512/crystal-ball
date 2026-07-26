/**
 * Route-level coverage for api/economic/stress.js
 *
 * Verifies bundled FRED + OFR fetch, per-indicator degradation isolation
 * (one broken upstream doesn't poison the rest), 90-day window cutoff in
 * the OFR timeseries parser, OPTIONS / wrong-method, and cache TTL.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invokeHandler, mockFetch } from './_test-utils.mjs';

const mod = await import('../economic/stress.js');
const handler = mod.default;
const { parseOfrTimeseries, __resetCacheForTests } = mod;

// ── parseOfrTimeseries ──────────────────────────────────────────────

test('parseOfrTimeseries: handles raw array shape', () => {
  const payload = [
    [Date.parse('2026-04-01T00:00:00Z'), 1.5],
    [Date.parse('2026-04-15T00:00:00Z'), 2.0],
  ];
  const out = parseOfrTimeseries(payload, '2026-01-01');
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { date: '2026-04-01', value: 1.5 });
});

test('parseOfrTimeseries: handles { data: [...] } shape', () => {
  const payload = { data: [[Date.parse('2026-04-01T00:00:00Z'), 1.5]] };
  const out = parseOfrTimeseries(payload, '2026-01-01');
  assert.equal(out.length, 1);
});

test('parseOfrTimeseries: filters by since cutoff', () => {
  const payload = [
    [Date.parse('2025-01-01T00:00:00Z'), 1.0],     // outside window
    [Date.parse('2026-04-01T00:00:00Z'), 2.0],
  ];
  const out = parseOfrTimeseries(payload, '2026-01-01');
  assert.equal(out.length, 1);
  assert.equal(out[0].value, 2.0);
});

test('parseOfrTimeseries: sorts ascending by date', () => {
  const payload = [
    [Date.parse('2026-04-15T00:00:00Z'), 2.0],
    [Date.parse('2026-04-01T00:00:00Z'), 1.5],
  ];
  const out = parseOfrTimeseries(payload, '2026-01-01');
  assert.deepEqual(out.map((o) => o.date), ['2026-04-01', '2026-04-15']);
});

test('parseOfrTimeseries: drops malformed rows safely', () => {
  const payload = [
    [Date.parse('2026-04-01T00:00:00Z'), 1.5],
    null,
    'not an array',
    [Date.parse('2026-04-15T00:00:00Z'), 'NaN-string'],
    [Date.parse('2026-05-01T00:00:00Z'), 3.0],
  ];
  const out = parseOfrTimeseries(payload, '2026-01-01');
  assert.equal(out.length, 2);
});

test('parseOfrTimeseries: empty/non-array payload returns []', () => {
  assert.deepEqual(parseOfrTimeseries(null, '2026-01-01'), []);
  assert.deepEqual(parseOfrTimeseries({}, '2026-01-01'), []);
  assert.deepEqual(parseOfrTimeseries('garbage', '2026-01-01'), []);
});

// ── HTTP contract ────────────────────────────────────────────────────

test('handler: OPTIONS returns 204', async () => {
  const { res } = await invokeHandler(handler, { method: 'OPTIONS' });
  assert.equal(res.statusCode, 204);
});

test('handler: rejects non-GET methods', async () => {
  const { res } = await invokeHandler(handler, { method: 'POST' });
  assert.equal(res.statusCode, 405);
});

test('handler: missing FRED_API_KEY → FRED indicators degraded, OFR still attempted', async () => {
  __resetCacheForTests();
  const prevKey = process.env.FRED_API_KEY;
  delete process.env.FRED_API_KEY;
  const restore = mockFetch(new Map([
    ['financialresearch.gov', { status: 200, json: [[Date.now(), 0.5]] }],
  ]));
  try {
    const { res } = await invokeHandler(handler, {});
    assert.equal(res.statusCode, 200);
    const fredIndicators = res.body.indicators.filter((i) => i.source === 'fred');
    assert.equal(fredIndicators.length, 4);
    for (const ind of fredIndicators) {
      assert.equal(ind.degraded, true);
      assert.match(ind.reason, /FRED_API_KEY not set/);
    }
    const ofr = res.body.indicators.find((i) => i.source === 'ofr');
    assert.ok(ofr);
    assert.notEqual(ofr.degraded, true);     // OFR still succeeded
  } finally {
    if (prevKey) process.env.FRED_API_KEY = prevKey;
    restore();
  }
});

test('handler: happy path bundles 4 FRED + 1 OFR indicators', async () => {
  __resetCacheForTests();
  process.env.FRED_API_KEY = 'fake-key';
  const recentDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const previousDate = new Date(recentDate.getTime() - 14 * 24 * 60 * 60 * 1000);
  const recentDay = recentDate.toISOString().slice(0, 10);
  const previousDay = previousDate.toISOString().slice(0, 10);
  const fredPayload = {
    observations: [
      { date: previousDay, value: '100.0' },
      { date: recentDay, value: '102.5' },
    ],
  };
  const restore = mockFetch(new Map([
    ['stlouisfed.org', { status: 200, json: fredPayload }],
    ['financialresearch.gov', { status: 200, json: [[recentDate.getTime(), 0.5]] }],
  ]));
  try {
    const { res } = await invokeHandler(handler, {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.indicators.length, 5);
    assert.equal(res.body.degraded, false);
    const brent = res.body.indicators.find((i) => i.id === 'DCOILBRENTEU');
    assert.ok(brent);
    assert.equal(brent.latest.value, 102.5);
    assert.equal(brent.history.length, 2);
    const ofr = res.body.indicators.find((i) => i.id === 'OFRFSI');
    assert.ok(ofr);
    assert.equal(ofr.latest.value, 0.5);
  } finally {
    delete process.env.FRED_API_KEY;
    restore();
  }
});

test('handler: degraded:true on bundle ONLY if every indicator is degraded', async () => {
  __resetCacheForTests();
  process.env.FRED_API_KEY = 'fake-key';
  const restore = mockFetch(new Map([
    ['stlouisfed.org', { status: 503, json: {} }],
    ['financialresearch.gov', { status: 503, json: {} }],
  ]));
  try {
    const { res } = await invokeHandler(handler, {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.degraded, true);
    for (const ind of res.body.indicators) assert.equal(ind.degraded, true);
  } finally {
    delete process.env.FRED_API_KEY;
    restore();
  }
});

test('handler: warm cache skips upstream within TTL', async () => {
  __resetCacheForTests();
  process.env.FRED_API_KEY = 'fake-key';
  let upstreamCalls = 0;
  const restore = mockFetch(new Map([
    ['stlouisfed.org', { status: 200, json: { observations: [{ date: '2026-04-01', value: '1' }] } }],
    ['financialresearch.gov', { status: 200, json: [] }],
  ]));
  const origFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => { upstreamCalls++; return origFetch(url, init); };
  try {
    await invokeHandler(handler, {});       // cold → 5 calls (4 FRED + 1 OFR)
    const coldCalls = upstreamCalls;
    await invokeHandler(handler, {});       // warm → no calls
    assert.equal(upstreamCalls, coldCalls);
    assert.ok(coldCalls >= 5, `expected at least 5 cold-start fetches, got ${coldCalls}`);
  } finally {
    globalThis.fetch = origFetch;
    delete process.env.FRED_API_KEY;
    restore();
  }
});
