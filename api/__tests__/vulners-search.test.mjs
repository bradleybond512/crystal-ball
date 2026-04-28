/**
 * Route-level coverage for api/vulners-search.js
 *
 * Vulners is a key-spending oracle: arbitrary lucene query → server
 * Vulners key. Tests prove the auth gate fails closed in cloud mode,
 * input is clamped, and missing keys degrade.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invokeHandler, mockFetch } from './_test-utils.mjs';

const handler = (await import('../vulners-search.js')).default;

function withSidecarMode(fn) {
  return async (...args) => {
    const original = process.env.LOCAL_API_PORT;
    process.env.LOCAL_API_PORT = '46123';
    try { return await fn(...args); } finally {
      if (original === undefined) delete process.env.LOCAL_API_PORT;
      else process.env.LOCAL_API_PORT = original;
    }
  };
}

function withCloudMode(fn) {
  return async (...args) => {
    const originalPort = process.env.LOCAL_API_PORT;
    delete process.env.LOCAL_API_PORT;
    try { return await fn(...args); } finally {
      if (originalPort !== undefined) process.env.LOCAL_API_PORT = originalPort;
    }
  };
}

test('vulners: OPTIONS returns 204', async () => {
  const { res } = await invokeHandler(handler, { method: 'OPTIONS' });
  assert.equal(res.statusCode, 204);
});

test('vulners: rejects unsupported methods', async () => {
  const { res } = await invokeHandler(handler, { method: 'POST' });
  assert.equal(res.statusCode, 405);
});

test('vulners: cloud mode without CRYSTALBALL_APP_KEY refuses', withCloudMode(async () => {
  const original = process.env.CRYSTALBALL_APP_KEY;
  delete process.env.CRYSTALBALL_APP_KEY;
  try {
    const { res } = await invokeHandler(handler, { query: { query: 'apache 2.4' } });
    assert.equal(res.statusCode, 403);
  } finally {
    if (original !== undefined) process.env.CRYSTALBALL_APP_KEY = original;
  }
}));

test('vulners: missing VULNERS_API_KEY returns degraded 200', withSidecarMode(async () => {
  const original = process.env.VULNERS_API_KEY;
  delete process.env.VULNERS_API_KEY;
  try {
    const { res } = await invokeHandler(handler, { query: {} });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.degraded, true);
  } finally {
    if (original !== undefined) process.env.VULNERS_API_KEY = original;
  }
}));

test('vulners: out-of-range size clamps to [1..50]', withSidecarMode(async () => {
  const original = process.env.VULNERS_API_KEY;
  process.env.VULNERS_API_KEY = 'test-key';
  let capturedBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    capturedBody = init?.body ? JSON.parse(init.body) : null;
    return new Response('{"data":{"search":[]}}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await invokeHandler(handler, { query: { size: '99999' } });
    assert.equal(capturedBody?.size, 50, 'oversized size should clamp to 50');
    await invokeHandler(handler, { query: { size: '0' } });
    assert.equal(capturedBody?.size, 1, 'zero size should clamp to 1');
    await invokeHandler(handler, { query: { size: 'abc' } });
    assert.equal(capturedBody?.size, 25, 'non-numeric size should default to 25');
  } finally {
    globalThis.fetch = originalFetch;
    if (original === undefined) delete process.env.VULNERS_API_KEY;
    else process.env.VULNERS_API_KEY = original;
  }
}));

test('vulners: 403 from upstream degrades gracefully', withSidecarMode(async () => {
  const original = process.env.VULNERS_API_KEY;
  process.env.VULNERS_API_KEY = 'test-key';
  const restore = mockFetch(new Map([['vulners.com', { status: 403, json: {} }]]));
  try {
    const { res } = await invokeHandler(handler, { query: { query: 'apache 2.4' } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.degraded, true);
    assert.deepEqual(res.body.items, []);
  } finally {
    restore();
    if (original === undefined) delete process.env.VULNERS_API_KEY;
    else process.env.VULNERS_API_KEY = original;
  }
}));
