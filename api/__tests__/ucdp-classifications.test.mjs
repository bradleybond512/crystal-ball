import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

const mod = await import('../ucdp-classifications.js');
const handler = mod.default;
const originalFetch = globalThis.fetch;
const originalToken = process.env.UCDP_API_TOKEN;

function row(country, countryId, overrides = {}) {
  return { country, country_id: countryId, year: 2025, sb_exist: 1, ns_exist: 0, os_exist: 0, ...overrides };
}
function page(result, totalCount = result.length, totalPages = 1) {
  return { Result: result, TotalCount: totalCount, TotalPages: totalPages, NextPageUrl: null, PreviousPageUrl: null };
}

beforeEach(() => {
  process.env.UCDP_API_TOKEN = 'classification-secret';
  mod.__resetUcdpClassificationsForTests();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.UCDP_API_TOKEN;
  else process.env.UCDP_API_TOKEN = originalToken;
});

test('is loopback-only and does no credential or upstream work at the Edge', async () => {
  delete process.env.UCDP_API_TOKEN;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json(page([row('Ukraine', 369)])); };
  const response = await handler(new Request('https://crystalball.app/api/ucdp-classifications'));
  assert.equal(response.status, 503);
  assert.equal(calls, 0);
});

test('fetches one exact 26.1 page with exact auth and returns compact presence classifications', async () => {
  let captured;
  globalThis.fetch = async (input, init) => {
    captured = { url: new URL(String(input)), init };
    return Response.json(page([
      row('Ukraine', 369),
      row('Ghana', 452, { sb_exist: 0, ns_exist: 0, os_exist: 0 }),
    ]));
  };
  const response = await handler(new Request('http://127.0.0.1:46123/api/ucdp-classifications'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    classifications: [
      { country: 'Ukraine', countryId: 369, year: 2025, stateBased: true, nonState: false, oneSided: false },
      { country: 'Ghana', countryId: 452, year: 2025, stateBased: false, nonState: false, oneSided: false },
    ],
    totalCount: 2,
    version: '26.1',
    dataset: { kind: 'annual_classification', version: '26.1', year: 2025 },
  });
  assert.equal(captured.url.pathname, '/api/organizedviolencecy/26.1');
  assert.equal(captured.url.search, '?Year=2025&pagesize=1000&page=0');
  const headers = new Headers(captured.init.headers);
  assert.equal(headers.get('x-ucdp-access-token'), 'classification-secret');
  assert.equal(headers.has('authorization'), false);
  assert.equal(captured.init.redirect, 'error');
  assert.equal(captured.url.toString().includes('classification-secret'), false);
});

test('coalesces concurrent cold starts and rotations into one request per credential generation', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return Response.json(page([row('Ukraine', 369)]));
  };
  const cold = await Promise.all([
    handler(new Request('http://127.0.0.1:46123/api/ucdp-classifications')),
    handler(new Request('http://127.0.0.1:46123/api/ucdp-classifications')),
  ]);
  assert.deepEqual(cold.map((response) => response.status), [200, 200]);
  assert.equal(calls, 1);

  process.env.UCDP_API_TOKEN = 'replacement-secret';
  const rotated = await Promise.all([
    handler(new Request('http://127.0.0.1:46123/api/ucdp-classifications')),
    handler(new Request('http://127.0.0.1:46123/api/ucdp-classifications')),
  ]);
  assert.deepEqual(rotated.map((response) => response.status), [200, 200]);
  assert.equal(calls, 2);
});

test('cancels a chunked response as soon as it crosses the byte limit', async () => {
  let cancelled = false;
  globalThis.fetch = async () => {
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(2 * 1024 * 1024));
        controller.enqueue(new Uint8Array(2 * 1024 * 1024));
      },
      cancel() { cancelled = true; },
    }), { headers: { 'Content-Type': 'application/json' } });
  };
  const response = await handler(new Request('http://127.0.0.1:46123/api/ucdp-classifications'));
  assert.equal(response.status, 502);
  assert.equal(cancelled, true);
});

test('cancels every rejected upstream body before returning safe failures', async (t) => {
  const cases = [
    ['authentication', 401, { 'Content-Type': 'application/json' }, 401],
    ['authorization', 403, { 'Content-Type': 'application/json' }, 403],
    ['rate limit', 429, { 'Content-Type': 'application/json', 'Retry-After': '120' }, 429],
    ['non-ok', 500, { 'Content-Type': 'application/json' }, 502],
    ['wrong content type', 200, { 'Content-Type': 'text/html' }, 502],
    ['oversized content length', 200, { 'Content-Type': 'application/json', 'Content-Length': String(4 * 1024 * 1024) }, 502],
  ];
  for (const [name, status, headers, expectedStatus] of cases) {
    await t.test(name, async () => {
      mod.__resetUcdpClassificationsForTests();
      let cancelled = false;
      globalThis.fetch = async () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('{}')); },
        cancel() { cancelled = true; },
      }), { status, headers });
      const response = await handler(new Request('http://127.0.0.1:46123/api/ucdp-classifications'));
      assert.equal(response.status, expectedStatus);
      assert.equal(cancelled, true);
    });
  }
});

test('rejects duplicates, unknown sentinels, and incomplete metadata without caching', async () => {
  for (const body of [
    page([row('Ukraine', 369), row('Ukraine', 369)]),
    page([row('Ukraine', 369, { sb_exist: 2 })]),
    page([row('Ukraine', 369)], 2, 1),
    page([row('Ukraine', 369)], 1, 2),
  ]) {
    mod.__resetUcdpClassificationsForTests();
    let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json(body); };
    const first = await handler(new Request('http://127.0.0.1:46123/api/ucdp-classifications'));
    const second = await handler(new Request('http://127.0.0.1:46123/api/ucdp-classifications'));
    assert.equal(first.status, 502);
    assert.equal(second.status, 502);
    assert.equal(calls, 2);
  }
});

test('never echoes credentials or upstream URLs in error bodies', async () => {
  globalThis.fetch = async () => new Response('classification-secret https://ucdpapi.pcr.uu.se', { status: 500 });
  const response = await handler(new Request('http://[::1]:46123/api/ucdp-classifications'));
  assert.equal(response.status, 502);
  const text = await response.text();
  assert.equal(text.includes('classification-secret'), false);
  assert.equal(text.includes('ucdpapi.pcr.uu.se'), false);
});

test('accepts only numeric Retry-After and suppresses quota calls for exactly 30 minutes', async () => {
  let now = 1_000;
  mod.__setUcdpClassificationsRuntimeForTests({ now: () => now });
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response('{}', { status: 429, headers: { 'Retry-After': '120' } });
  };
  let response = await handler(new Request('http://127.0.0.1:46123/api/ucdp-classifications'));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '120');
  response = await handler(new Request('http://127.0.0.1:46123/api/ucdp-classifications'));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '1800');
  assert.equal(calls, 1);
  now += 30 * 60 * 1000;
  response = await handler(new Request('http://127.0.0.1:46123/api/ucdp-classifications'));
  assert.equal(response.status, 429);
  assert.equal(calls, 2);

  mod.__resetUcdpClassificationsForTests();
  globalThis.fetch = async () => new Response('{}', { status: 429, headers: { 'Retry-After': 'Wed, 21 Oct 2030 07:28:00 GMT' } });
  response = await handler(new Request('http://127.0.0.1:46123/api/ucdp-classifications'));
  assert.equal(response.headers.get('retry-after'), null);
});

test('classifies shared-deadline aborts as 503 and does not retry', async () => {
  mod.__setUcdpClassificationsRuntimeForTests({ deadlineMs: 20 });
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls++;
    await new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
  };
  const response = await handler(new Request('http://127.0.0.1:46123/api/ucdp-classifications'));
  assert.equal(response.status, 503);
  assert.equal(calls, 1);
});

test('deletion purges cached classifications and a replacement credential starts a new generation', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json(page([row('Ukraine', 369)]));
  };
  let response = await handler(new Request('http://127.0.0.1:46123/api/ucdp-classifications'));
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  delete process.env.UCDP_API_TOKEN;
  response = await handler(new Request('http://127.0.0.1:46123/api/ucdp-classifications'));
  assert.equal(response.status, 503);
  assert.equal(calls, 1);
  process.env.UCDP_API_TOKEN = 'replacement-secret';
  response = await handler(new Request('http://127.0.0.1:46123/api/ucdp-classifications'));
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});
