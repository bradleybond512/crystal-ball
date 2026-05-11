/**
 * Route-level coverage for api/otx/pulses.js
 *
 * Verifies env-var gate, rolling-cache merge (newest-first by `modified`,
 * dedupe by id, cap at 200), modified_since delta on subsequent fetches,
 * stale-cache fallback on upstream failure, OPTIONS / wrong-method, and
 * cache TTL behavior.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invokeHandler, mockFetch } from './_test-utils.mjs';

const mod = await import('../otx/pulses.js');
const handler = mod.default;
const { mergePulses, __resetStateForTests } = mod;

const pulse = (id, modifiedIso, name = 'p') => ({
  id, modified: modifiedIso, name, adversary: 'APT99',
  tags: ['APT99'], indicators: [{ indicator: '1.2.3.4', type: 'IPv4' }],
});

// ── pure merge ────────────────────────────────────────────────────────

test('mergePulses: dedupes by id (fresh wins)', () => {
  const state = { pulses: [pulse('a', '2026-05-01T00:00:00Z', 'old')], lastPolledAt: 0, lastModifiedIso: '' };
  const fresh = [pulse('a', '2026-05-02T00:00:00Z', 'new')];
  const out = mergePulses(state, fresh);
  assert.equal(out.pulses.length, 1);
  assert.equal(out.pulses[0].name, 'new');
});

test('mergePulses: sorts newest-first by modified', () => {
  const state = { pulses: [pulse('a', '2026-01-01T00:00:00Z'), pulse('b', '2026-03-01T00:00:00Z')], lastPolledAt: 0, lastModifiedIso: '' };
  const fresh = [pulse('c', '2026-02-01T00:00:00Z')];
  const out = mergePulses(state, fresh);
  assert.deepEqual(out.pulses.map((p) => p.id), ['b', 'c', 'a']);
});

test('mergePulses: caps at 200 dropping oldest', () => {
  const existing = Array.from({ length: 250 }, (_, i) =>
    pulse(`e${i}`, new Date(2020, 0, 1, 0, i).toISOString()));
  const out = mergePulses({ pulses: existing, lastPolledAt: 0, lastModifiedIso: '' }, []);
  assert.equal(out.pulses.length, 200);
});

test('mergePulses: lastModifiedIso tracks newest pulse for next delta', () => {
  const state = { pulses: [], lastPolledAt: 0, lastModifiedIso: '' };
  const fresh = [pulse('a', '2026-04-01T00:00:00Z'), pulse('b', '2026-04-15T00:00:00Z')];
  const out = mergePulses(state, fresh);
  assert.equal(out.lastModifiedIso, '2026-04-15T00:00:00Z');
});

test('mergePulses: empty fresh keeps existing modified anchor', () => {
  const state = { pulses: [pulse('a', '2026-04-01T00:00:00Z')], lastPolledAt: 0, lastModifiedIso: '2026-04-01T00:00:00Z' };
  const out = mergePulses(state, []);
  assert.equal(out.lastModifiedIso, '2026-04-01T00:00:00Z');
});

test('mergePulses: drops items missing id', () => {
  const out = mergePulses({ pulses: [], lastPolledAt: 0, lastModifiedIso: '' }, [{ modified: '2026-01-01T00:00:00Z' }]);
  assert.equal(out.pulses.length, 0);
});

// ── HTTP contract ─────────────────────────────────────────────────────

test('handler: OPTIONS returns 204', async () => {
  const { res } = await invokeHandler(handler, { method: 'OPTIONS' });
  assert.equal(res.statusCode, 204);
});

test('handler: rejects non-GET methods', async () => {
  const { res } = await invokeHandler(handler, { method: 'POST' });
  assert.equal(res.statusCode, 405);
});

test('handler: missing OTX_API_KEY → degraded', async () => {
  __resetStateForTests();
  const prev = process.env.OTX_API_KEY;
  delete process.env.OTX_API_KEY;
  try {
    const { res } = await invokeHandler(handler, {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.degraded, true);
    assert.match(res.body.reason, /OTX_API_KEY not set/);
  } finally { if (prev) process.env.OTX_API_KEY = prev; }
});

test('handler: cold-start happy path → fetches with no modified_since', async () => {
  __resetStateForTests();
  process.env.OTX_API_KEY = 'fake';
  const seenUrls = [];
  const restore = mockFetch(new Map([[
    'otx.alienvault.com',
    { status: 200, json: { results: [pulse('p1', '2026-04-15T00:00:00Z'), pulse('p2', '2026-04-14T00:00:00Z')] } },
  ]]));
  const origFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => { seenUrls.push(typeof url === 'string' ? url : url?.url); return origFetch(url, init); };
  try {
    const { res } = await invokeHandler(handler, {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.pulses.length, 2);
    assert.equal(res.body.lastModifiedIso, '2026-04-15T00:00:00Z');
    assert.ok(!seenUrls[0].includes('modified_since'), 'cold start must not send modified_since');
  } finally {
    globalThis.fetch = origFetch;
    restore();
    delete process.env.OTX_API_KEY;
  }
});

test('handler: warm-cache request within TTL skips upstream', async () => {
  __resetStateForTests();
  process.env.OTX_API_KEY = 'fake';
  let upstreamCalls = 0;
  const restore = mockFetch(new Map([['otx.alienvault.com', { status: 200, json: { results: [pulse('p1', '2026-04-15T00:00:00Z')] } }]]));
  const origFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => { upstreamCalls++; return origFetch(url, init); };
  try {
    await invokeHandler(handler, {});         // cold → 1 upstream call
    await invokeHandler(handler, {});         // warm → no upstream call
    assert.equal(upstreamCalls, 1);
  } finally {
    globalThis.fetch = origFetch;
    restore();
    delete process.env.OTX_API_KEY;
  }
});

test('handler: upstream failure with empty cache → degraded', async () => {
  __resetStateForTests();
  process.env.OTX_API_KEY = 'fake';
  const restore = mockFetch(new Map([['otx.alienvault.com', { status: 500, json: {} }]]));
  try {
    const { res } = await invokeHandler(handler, {});
    assert.equal(res.body.degraded, true);
    assert.match(res.body.reason, /HTTP 500/);
  } finally {
    restore();
    delete process.env.OTX_API_KEY;
  }
});
