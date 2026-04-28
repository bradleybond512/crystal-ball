/**
 * Route-level coverage for api/ucdp.js
 *
 * Tests prove the param validation rejects/sanitizes Country / Region
 * / Date / pagesize, and that token-missing / upstream-error paths
 * degrade rather than 500.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invokeHandler, mockFetch } from './_test-utils.mjs';

const ucdpModule = await import('../ucdp.js');
const handler = ucdpModule.default;
const resetCache = ucdpModule.__resetCacheForTests;

test('ucdp: OPTIONS returns 204', async () => {
  const { res } = await invokeHandler(handler, { method: 'OPTIONS' });
  assert.equal(res.statusCode, 204);
});

test('ucdp: rejects unsupported methods', async () => {
  const { res } = await invokeHandler(handler, { method: 'POST' });
  assert.equal(res.statusCode, 405);
});

test('ucdp: missing UCDP_API_TOKEN degrades to empty events', async () => {
  const original = process.env.UCDP_API_TOKEN;
  delete process.env.UCDP_API_TOKEN;
  try {
    const { res } = await invokeHandler(handler, { query: {} });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.degraded, true);
    assert.deepEqual(res.body.events, []);
  } finally {
    if (original !== undefined) process.env.UCDP_API_TOKEN = original;
  }
});

test('ucdp: invalid date is dropped before forwarding', async () => {
  resetCache();
  const original = process.env.UCDP_API_TOKEN;
  process.env.UCDP_API_TOKEN = 'test-token';
  let capturedUrl = '';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    capturedUrl = typeof url === 'string' ? url : url.url;
    return new Response('{"Result":[],"TotalCount":0}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await invokeHandler(handler, { query: { StartDate: 'not-a-date; rm', EndDate: '2026-01-01' } });
    assert.ok(!capturedUrl.includes('StartDate'), 'invalid StartDate must not reach upstream');
    assert.ok(capturedUrl.includes('EndDate=2026-01-01'), 'valid EndDate forwarded');
  } finally {
    globalThis.fetch = originalFetch;
    if (original === undefined) delete process.env.UCDP_API_TOKEN;
    else process.env.UCDP_API_TOKEN = original;
  }
});

test('ucdp: country with shell metacharacters is rejected', async () => {
  resetCache();
  const original = process.env.UCDP_API_TOKEN;
  process.env.UCDP_API_TOKEN = 'test-token';
  let capturedUrl = '';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    capturedUrl = typeof url === 'string' ? url : url.url;
    return new Response('{"Result":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await invokeHandler(handler, { query: { Country: '$(id)' } });
    assert.ok(!capturedUrl.includes('Country'), 'Country with metachars must not reach upstream');
  } finally {
    globalThis.fetch = originalFetch;
    if (original === undefined) delete process.env.UCDP_API_TOKEN;
    else process.env.UCDP_API_TOKEN = original;
  }
});

test('ucdp: pagesize over upstream cap is clamped', async () => {
  resetCache();
  const original = process.env.UCDP_API_TOKEN;
  process.env.UCDP_API_TOKEN = 'test-token';
  let capturedUrl = '';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    capturedUrl = typeof url === 'string' ? url : url.url;
    return new Response('{"Result":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await invokeHandler(handler, { query: { pagesize: '99999' } });
    assert.ok(capturedUrl.includes('pagesize=1000'), 'pagesize clamps to upstream max 1000');
    resetCache();
    await invokeHandler(handler, { query: { pagesize: 'abc' } });
    assert.ok(capturedUrl.includes('pagesize=200'), 'non-numeric pagesize defaults to 200');
  } finally {
    globalThis.fetch = originalFetch;
    if (original === undefined) delete process.env.UCDP_API_TOKEN;
    else process.env.UCDP_API_TOKEN = original;
  }
});

test('ucdp: upstream 5xx degrades to empty array', async () => {
  resetCache();
  const original = process.env.UCDP_API_TOKEN;
  process.env.UCDP_API_TOKEN = 'test-token';
  const restore = mockFetch(new Map([['ucdpapi.pcr.uu.se', { status: 502, json: {} }]]));
  try {
    const { res } = await invokeHandler(handler, { query: {} });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.degraded, true);
    assert.deepEqual(res.body.events, []);
  } finally {
    restore();
    if (original === undefined) delete process.env.UCDP_API_TOKEN;
    else process.env.UCDP_API_TOKEN = original;
  }
});
