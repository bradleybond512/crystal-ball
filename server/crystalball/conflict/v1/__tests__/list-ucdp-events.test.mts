import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import {
  __getUcdpStateForTests,
  __resetUcdpStateForTests,
  __setUcdpTestRuntime,
  listUcdpEvents,
} from '../list-ucdp-events.ts';
import { conflictHandler } from '../handler.ts';
import { createConflictServiceRoutes } from '../../../../../src/generated/server/crystalball/conflict/v1/service_server.ts';
import { mapErrorToResponse } from '../../../../error-mapper.ts';

const originalFetch = globalThis.fetch;
const originalToken = process.env.UCDP_API_TOKEN;
const localContext = {
  request: new Request('http://127.0.0.1:46123/api/conflict/v1/list-ucdp-events'),
  pathParams: {},
  headers: {},
};

function request(overrides: Partial<{ start: number; end: number; country: string; pageSize: number; cursor: string }> = {}) {
  return { start: 0, end: 0, pageSize: 0, cursor: '', country: '', ...overrides };
}

function row(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    date_start: '2025-10-01',
    date_end: '2025-10-02',
    latitude: 0,
    longitude: 0,
    country: 'Ukraine',
    side_a: 'Side A',
    side_b: 'Side B',
    best: 2,
    low: 1,
    high: 3,
    type_of_violence: 1,
    source_original: null,
    ...overrides,
  };
}

function page(result: unknown[], totalCount = result.length, totalPages = 1) {
  return { Result: result, TotalCount: totalCount, TotalPages: totalPages, NextPageUrl: null, PreviousPageUrl: null };
}

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

const ucdpRoute = createConflictServiceRoutes(conflictHandler, { onError: mapErrorToResponse })
  .find((route) => route.path === '/api/conflict/v1/list-ucdp-events')!;

function routeRequest(query = '', host = '127.0.0.1:46123'): Promise<Response> {
  return ucdpRoute.handler(new Request(`http://${host}/api/conflict/v1/list-ucdp-events${query}`));
}

beforeEach(() => {
  process.env.UCDP_API_TOKEN = 'test-token-a';
  __resetUcdpStateForTests();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.UCDP_API_TOKEN;
  else process.env.UCDP_API_TOKEN = originalToken;
});

test('rejects non-loopback execution before reading credentials or fetching', async () => {
  delete process.env.UCDP_API_TOKEN;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return jsonResponse(page([row(1)])); };
  const response = await routeRequest('', 'crystalball.app');
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { message: 'Internal server error' });
  assert.equal(calls, 0);
});

test('fetches complete fixed window with exact auth and returns at most 100 newest events', async () => {
  const rows = Array.from({ length: 1001 }, (_, index) => row(index + 1, {
    date_start: index === 1000 ? '2025-12-31' : '2025-10-01',
    date_end: index === 1000 ? '2025-12-31' : '2025-10-02',
  }));
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const index = Number(url.searchParams.get('page'));
    return jsonResponse(index === 0 ? page(rows.slice(0, 1000), 1001, 2) : page(rows.slice(1000), 1001, 2));
  };
  const result = await listUcdpEvents(localContext, request());
  assert.equal(result.events.length, 100);
  assert.equal(result.events[0]?.id, '1001');
  assert.equal(result.pagination?.totalCount, 1001);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.url.pathname, '/api/gedevents/26.1');
    assert.equal(call.url.searchParams.get('StartDate'), '2025-09-02');
    assert.equal(call.url.searchParams.get('EndDate'), '2025-12-31');
    const headers = new Headers(call.init?.headers);
    assert.equal(headers.get('x-ucdp-access-token'), 'test-token-a');
    assert.equal(headers.has('authorization'), false);
    assert.equal(call.init?.redirect, 'error');
    assert.equal(call.url.toString().includes('test-token-a'), false);
  }
  await listUcdpEvents(localContext, request());
  assert.equal(calls.length, 2);
});

test('rejects country filters and invalid display limits with 400', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return jsonResponse(page([row(1)])); };
  for (const query of ['?country=UA', '?page_size=101', '?page_size=-1']) {
    const response = await routeRequest(query);
    assert.equal(response.status, 400, query);
  }
  assert.equal(calls, 0);
});

test('coalesces concurrent cold starts and credential rotations into one refresh per generation', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return jsonResponse(page([row(calls)]));
  };
  const cold = await Promise.all([
    listUcdpEvents(localContext, request({ pageSize: 1 })),
    listUcdpEvents(localContext, request({ pageSize: 1 })),
  ]);
  assert.equal(cold[0].events.length, 1);
  assert.equal(cold[1].events.length, 1);
  assert.equal(calls, 1);

  process.env.UCDP_API_TOKEN = 'test-token-b';
  const rotated = await Promise.all([
    listUcdpEvents(localContext, request({ pageSize: 1 })),
    listUcdpEvents(localContext, request({ pageSize: 1 })),
  ]);
  assert.equal(rotated[0].events.length, 1);
  assert.equal(rotated[1].events.length, 1);
  assert.equal(calls, 2);
});

test('pages only within the positive cache using bounded opaque cursors', async () => {
  let now = 1_000;
  __setUcdpTestRuntime({ now: () => now });
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return jsonResponse(page([
      row(1, { date_start: '2025-10-01' }),
      row(2, { date_start: '2025-11-01', date_end: '2025-11-02' }),
      row(3, { date_start: '2025-12-01', date_end: '2025-12-02' }),
    ]));
  };
  const first = await listUcdpEvents(localContext, request({ pageSize: 1 }));
  assert.equal(first.events[0]?.id, '3');
  assert.ok(first.pagination?.nextCursor);
  const second = await listUcdpEvents(localContext, request({ pageSize: 1, cursor: first.pagination?.nextCursor }));
  assert.equal(second.events[0]?.id, '2');
  assert.ok(second.pagination?.nextCursor);
  const third = await listUcdpEvents(localContext, request({ pageSize: 1, cursor: second.pagination?.nextCursor }));
  assert.equal(third.events[0]?.id, '1');
  assert.equal(third.pagination?.nextCursor, '');
  assert.equal(calls, 1);

  const foreignCursor = btoa(`${crypto.randomUUID()}:1`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
  await assert.rejects(
    () => listUcdpEvents(localContext, request({ pageSize: 1, cursor: foreignCursor })),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 400,
  );
  assert.equal(calls, 1);

  now += 6 * 60 * 60 * 1000 + 1;
  await assert.rejects(
    () => listUcdpEvents(localContext, request({ pageSize: 1, cursor: second.pagination?.nextCursor })),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 400,
  );
  assert.equal(calls, 1);
});

test('defaults event pages to 100 cached rows', async () => {
  globalThis.fetch = async () => jsonResponse(page(Array.from({ length: 101 }, (_, index) => row(index + 1))));
  const result = await listUcdpEvents(localContext, request());
  assert.equal(result.events.length, 100);
  assert.ok(result.pagination?.nextCursor);
});

test('rejects pagination beyond 8 pages before claiming more pages', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return jsonResponse(page(Array.from({ length: 1000 }, (_, i) => row(i + 1)), 8001, 9));
  };
  await assert.rejects(() => listUcdpEvents(localContext, request()), /pagination metadata/);
  assert.equal(calls, 1);
  assert.deepEqual(__getUcdpStateForTests(), { cache: 0, inflight: 0, cooldown: 0 });
});

test('fails closed without caching malformed, duplicate, count-mismatched, or zero-output bodies', async (t) => {
  const cases: Array<[string, unknown, RegExp]> = [
    ['malformed', { Result: 'bad', TotalCount: 1, TotalPages: 1 }, /malformed response/],
    ['duplicate', page([row(1), row(1)]), /duplicate event ID/],
    ['count', page([row(1)], 2, 1), /row count mismatch|pagination metadata|incomplete page/],
    ['zero-output', page([row(1, { type_of_violence: 99 })]), /zero usable observations/],
  ];
  for (const [name, body, pattern] of cases) {
    await t.test(name, async () => {
      __resetUcdpStateForTests();
      globalThis.fetch = async () => jsonResponse(body);
      await assert.rejects(() => listUcdpEvents(localContext, request()), pattern);
      assert.deepEqual(__getUcdpStateForTests(), { cache: 0, inflight: 0, cooldown: 0 });
    });
  }
});

test('enforces full non-final pages and aggregate byte cap', async (t) => {
  await t.test('short non-final page', async () => {
    globalThis.fetch = async (input) => {
      const index = Number(new URL(String(input)).searchParams.get('page'));
      return jsonResponse(index === 0 ? page([row(1)], 1001, 2) : page([row(2)], 1001, 2));
    };
    await assert.rejects(() => listUcdpEvents(localContext, request()), /incomplete page/);
  });
  await t.test('aggregate cap', async () => {
    __resetUcdpStateForTests();
    __setUcdpTestRuntime({ maxAggregateBytes: 100 });
    globalThis.fetch = async () => jsonResponse(page([row(1)]));
    await assert.rejects(() => listUcdpEvents(localContext, request()), /aggregate byte limit/);
  });
});

test('uses concurrency at most 4, aborts siblings, and waits for settlement', async () => {
  const firstRows = Array.from({ length: 1000 }, (_, i) => row(i + 1));
  let active = 0;
  let maxActive = 0;
  let settled = 0;
  globalThis.fetch = async (input, init) => {
    const pageIndex = Number(new URL(String(input)).searchParams.get('page'));
    if (pageIndex === 0) return jsonResponse(page(firstRows, 5000, 5));
    active++;
    maxActive = Math.max(maxActive, active);
    try {
      if (pageIndex === 1) return jsonResponse({ error: 'bad' }, 500);
      await new Promise<void>((resolve) => init?.signal?.addEventListener('abort', () => resolve(), { once: true }));
      throw new DOMException('aborted', 'AbortError');
    } finally {
      active--;
      settled++;
    }
  };
  await assert.rejects(() => listUcdpEvents(localContext, request()), /upstream unavailable/);
  assert.ok(maxActive <= 4);
  assert.equal(settled, 4);
  assert.equal(__getUcdpStateForTests().inflight, 0);
});

test('classifies streamed-body deadline as sanitized timeout with no retry', async () => {
  __setUcdpTestRuntime({ deadlineMs: 20 });
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls++;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true });
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'application/json' } });
  };
  await assert.rejects(() => listUcdpEvents(localContext, request()), (error: unknown) => {
    const candidate = error as { statusCode?: number; message?: string };
    return candidate.statusCode === 503 && candidate.message === 'UCDP request timed out';
  });
  assert.equal(calls, 1);
});

test('cancels rejected upstream bodies before returning safe failures', async (t) => {
  const cases: Array<[string, number, HeadersInit, number]> = [
    ['authentication', 401, { 'Content-Type': 'application/json' }, 401],
    ['authorization', 403, { 'Content-Type': 'application/json' }, 403],
    ['rate limit', 429, { 'Content-Type': 'application/json', 'Retry-After': '120' }, 429],
    ['non-ok', 500, { 'Content-Type': 'application/json' }, 502],
    ['wrong content type', 200, { 'Content-Type': 'text/html' }, 502],
    ['oversized content length', 200, { 'Content-Type': 'application/json', 'Content-Length': String(4 * 1024 * 1024) }, 502],
  ];
  for (const [name, status, headers, expectedStatus] of cases) {
    await t.test(name, async () => {
      __resetUcdpStateForTests();
      let cancelled = false;
      globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new TextEncoder().encode('{}')); },
        cancel() { cancelled = true; },
      }), { status, headers });
      await assert.rejects(() => listUcdpEvents(localContext, request()), (error: unknown) => {
        return (error as { statusCode?: number }).statusCode === expectedStatus;
      });
      assert.equal(cancelled, true);
    });
  }
});

test('accepts only numeric Retry-After and reports bounded quota cooldown remaining', async () => {
  let now = 1_000;
  __setUcdpTestRuntime({ now: () => now });
  for (const value of ['Wed, 21 Oct 2030 07:28:00 GMT', 'garbage']) {
    __resetUcdpStateForTests();
    __setUcdpTestRuntime({ now: () => now });
    globalThis.fetch = async () => jsonResponse({}, 429, { 'Retry-After': value });
    await assert.rejects(() => listUcdpEvents(localContext, request()), (error: unknown) => (error as { retryAfter?: number }).retryAfter === undefined);
  }
  __resetUcdpStateForTests();
  __setUcdpTestRuntime({ now: () => now });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return jsonResponse({}, 429, { 'Retry-After': '120' }); };
  await assert.rejects(() => listUcdpEvents(localContext, request()), (error: unknown) => (error as { retryAfter?: number }).retryAfter === 120);
  now += 1_001;
  await assert.rejects(() => listUcdpEvents(localContext, request()), (error: unknown) => (error as { retryAfter?: number }).retryAfter === 1799);
  assert.equal(calls, 1);
});

test('credential rotation aborts old generation and cannot publish or suppress new one', async () => {
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => { started = resolve; });
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls++;
    if (calls === 1) {
      started();
      await new Promise<void>((resolve) => init?.signal?.addEventListener('abort', () => resolve(), { once: true }));
      throw new DOMException('aborted', 'AbortError');
    }
    return jsonResponse(page([row(calls)]));
  };
  const old = listUcdpEvents(localContext, request());
  await startedPromise;
  process.env.UCDP_API_TOKEN = 'test-token-b';
  const fresh = listUcdpEvents(localContext, request());
  await assert.rejects(old, /credential changed/);
  assert.equal((await fresh).events.length, 1);
  assert.deepEqual(__getUcdpStateForTests(), { cache: 1, inflight: 0, cooldown: 0 });
});

test('missing credential is sanitized through generated error mapping', async () => {
  delete process.env.UCDP_API_TOKEN;
  const response = await routeRequest();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { message: 'Internal server error' });
});
