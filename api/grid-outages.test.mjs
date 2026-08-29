import test from 'node:test';
import assert from 'node:assert/strict';

import handler, * as gridOutages from './grid-outages.js';

const { parseOdinOutagesV1 } = gridOutages;

const request = (query = '', init = {}) => new Request(`https://crystalball.app/api/grid-outages${query}`, {
  headers: { origin: 'https://crystalball.app' }, ...init,
});

test('ODIN parser accepts real zero outages and drops malformed or nonmatching FIPS rows', () => {
  const { outages, droppedRows } = parseOdinOutagesV1({ results: [
    { communitydescriptor: '18091', county: 'LaPorte', state: 'Indiana', metersaffected: 0, customersrestored: 7, name: 'NIPSCO', utility_id: '42', reportedstarttime: '2026-08-14T00:00:00Z' },
    { communitydescriptor: '18093', county: 'Other', state: 'Indiana', metersaffected: 12 },
    { communitydescriptor: 'bad', metersaffected: 2 },
    { communitydescriptor: '18091', metersaffected: -1 },
  ] }, { fips: '18091', nowMs: 1_786_665_600_000 });
  assert.equal(outages.length, 1);
  assert.equal(outages[0].customersOut, 0);
  assert.equal(outages[0].customersRestored, 7);
  assert.equal(outages[0].fips, '18091');
  assert.equal(outages[0].retrievedAt, outages[0].observedAt);
  assert.equal(outages[0].sourceObservedAt, undefined,
    'reportedstarttime is the outage event start, not an observation timestamp');
  assert.match(outages[0].expiresAt, /Z$/);
  assert.equal(droppedRows, 3);
});

test('grid outages exports the same bounded operation used by its GET handler', () => {
  assert.equal(typeof gridOutages.getGridOutagesForFips, 'function');
});

test('grid outages supports only GET/OPTIONS and strictly validates exact FIPS and limit', async () => {
  assert.equal((await handler(request('', { method: 'POST' }))).status, 405);
  assert.equal((await handler(request('', { method: 'OPTIONS' }))).status, 204);
  for (const query of ['', '?fips=1809', '?fips=180910', '?fips=abcde', '?limit=0', '?limit=1.5', '?limit=101', '?extra=x']) {
    assert.equal((await handler(request(query))).status, 400, query);
  }
});

test('grid outages filters exact FIPS upstream and reports missing coverage as unknown', async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = '';
  globalThis.fetch = async (url, options) => {
    calledUrl = String(url);
    assert.equal(options.maxResponseBytes, 512 * 1024);
    return new Response(JSON.stringify({ total_count: 0, results: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const response = await handler(request('?fips=18091&limit=10'));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.schemaVersion, 1);
    assert.equal(body.coverage, 'unknown');
    assert.deepEqual(body.outages, []);
    assert.equal(body.provider.id, 'ornl-odin');
    assert.equal(body.provider.state, 'empty');
    assert.equal(body.provider.acceptedRows, 0);
    assert.equal(body.retrievedAt, body.fetchedAt);
    assert.equal(body.provider.retrievedAt, body.retrievedAt);
    assert.equal(body.degraded, false);
    assert.match(calledUrl, /^https:\/\/openenergyhub\.ornl\.gov\/api\/explore\/v2\.1\/catalog\/datasets\/odin-real-time-outages-county\/records\?/);
    const upstream = new URL(calledUrl);
    assert.equal(upstream.searchParams.get('limit'), '10');
    assert.equal(upstream.searchParams.get('where'), 'communitydescriptor="18091"');
  } finally { globalThis.fetch = originalFetch; }
});

test('grid outages rejects incomplete ODIN pages instead of reporting a partial sum', async () => {
  const originalFetch = globalThis.fetch;
  const row = (fips) => ({
    communitydescriptor: fips, county: 'Example', state: 'Alaska', metersaffected: 12,
  });
  const payloads = [
    { total_count: 2, results: [row('02013')] },
    { results: [row('02016')] },
    { total_count: 1, results: [row('02020')] },
  ];
  globalThis.fetch = async () => Response.json(payloads.shift());
  try {
    const truncatedByCount = await handler(request('?fips=02013&limit=10'));
    assert.equal(truncatedByCount.status, 502);
    assert.equal((await truncatedByCount.json()).provider.reasonCode, 'truncated_page');

    const saturatedWithoutProof = await handler(request('?fips=02016&limit=1'));
    assert.equal(saturatedWithoutProof.status, 502);
    assert.equal((await saturatedWithoutProof.json()).coverage, 'unknown');

    const completeAtLimit = await handler(request('?fips=02020&limit=1'));
    assert.equal(completeAtLimit.status, 200);
    assert.equal((await completeAtLimit.json()).coverage, 'reported');
  } finally { globalThis.fetch = originalFetch; }
});

test('grid outages rejects an upstream page larger than the requested limit even with total_count proof', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    total_count: 2,
    results: [
      { communitydescriptor: '02230', county: 'Example', state: 'Alaska', metersaffected: 12 },
      { communitydescriptor: '02230', county: 'Example', state: 'Alaska', metersaffected: 18 },
    ],
  });
  try {
    const response = await handler(request('?fips=02230&limit=1'));
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.provider.reasonCode, 'truncated_page');
    assert.equal(body.provider.acceptedRows, 0);
    assert.deepEqual(body.outages, []);
  } finally { globalThis.fetch = originalFetch; }
});

test('grid outages rejects oversized declared and streamed bodies before parsing', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    assert.equal(options.maxResponseBytes, 512 * 1024);
    if (calls === 1) {
      return new Response(JSON.stringify({ total_count: 0, results: [] }), {
        status: 200, headers: { 'content-length': String(512 * 1024 + 1) },
      });
    }
    const bytes = new TextEncoder().encode(JSON.stringify({
      total_count: 0, results: [], padding: 'x'.repeat(512 * 1024),
    }));
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }), { status: 200 });
  };
  try {
    assert.equal((await handler(request('?fips=02100&limit=9'))).status, 502);
    assert.equal((await handler(request('?fips=02105&limit=9'))).status, 502);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test('grid outages rejects malformed and all-dropped HTTP 200 bodies instead of caching them', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const body = calls === 1 ? { maintenance: true } : { results: [{ communitydescriptor: 'bad', metersaffected: 'lots' }] };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    assert.equal((await handler(request('?fips=01001&limit=9'))).status, 502);
    assert.equal((await handler(request('?fips=01001&limit=9'))).status, 502);
    assert.equal(calls, 2, 'failures must not poison the cache');
  } finally { globalThis.fetch = originalFetch; }
});

test('grid outages single-flights identical concurrent requests', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async () => {
    calls += 1;
    await gate;
    return new Response(JSON.stringify({ results: [{ communitydescriptor: '06037', county: 'Los Angeles', state: 'California', metersaffected: 20, name: 'Utility' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const a = handler(request('?fips=06037&limit=8'));
    const b = handler(request('?fips=06037&limit=8'));
    release();
    const responses = await Promise.all([a, b]);
    assert.deepEqual(responses.map((response) => response.status), [200, 200]);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('grid outages bounds successful cache entries and evicts the oldest key', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    for (let value = 90_000; value <= 90_128; value += 1) {
      assert.equal((await handler(request(`?fips=${value}&limit=7`))).status, 200);
    }
    assert.equal(calls, 129);
    assert.equal((await handler(request('?fips=90000&limit=7'))).status, 200);
    assert.equal(calls, 130, 'oldest cache entry must be evicted after the fixed bound');
  } finally { globalThis.fetch = originalFetch; }
});

test('grid outages bounds distinct in-flight keys while preserving same-key single-flight', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async () => {
    calls += 1;
    await gate;
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const pending = [];
    for (let value = 91_000; value < 91_064; value += 1) {
      pending.push(handler(request(`?fips=${value}&limit=6`)));
    }
    const duplicate = handler(request('?fips=91000&limit=6'));
    const overflowPromise = handler(request('?fips=91064&limit=6'));
    const overflow = await Promise.race([
      overflowPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), 50)),
    ]);
    if (!overflow) {
      release();
      await Promise.all([...pending, duplicate, overflowPromise]);
      assert.fail('a distinct key above the in-flight bound must fail fast');
    }
    assert.equal(overflow.status, 503);
    assert.equal((await overflow.json()).provider.reasonCode, 'capacity_exceeded');
    assert.equal(calls, 64);
    release();
    const completed = await Promise.all([...pending, duplicate]);
    assert.ok(completed.every((response) => response.status === 200));
    assert.equal(calls, 64, 'same-key request must share the existing promise');
    assert.equal((await handler(request('?fips=91064&limit=6'))).status, 200);
    assert.equal(calls, 65, 'rejected key becomes eligible after in-flight work drains');
  } finally { globalThis.fetch = originalFetch; }
});
