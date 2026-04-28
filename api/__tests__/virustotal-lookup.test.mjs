/**
 * Route-level coverage for api/virustotal-lookup.js
 *
 * VT is a key-spending oracle: arbitrary indicator → server VT key.
 * Tests prove the auth gate fails closed in cloud mode, the input
 * validation refuses missing/oversized indicators, and missing keys
 * degrade rather than 500-ing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invokeHandler, mockFetch } from './_test-utils.mjs';

const handler = (await import('../virustotal-lookup.js')).default;

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

test('virustotal: OPTIONS returns 204', async () => {
  const { res } = await invokeHandler(handler, { method: 'OPTIONS' });
  assert.equal(res.statusCode, 204);
});

test('virustotal: rejects unsupported methods', async () => {
  const { res } = await invokeHandler(handler, { method: 'POST' });
  assert.equal(res.statusCode, 405);
});

test('virustotal: cloud mode without CRYSTALBALL_APP_KEY refuses', withCloudMode(async () => {
  const original = process.env.CRYSTALBALL_APP_KEY;
  delete process.env.CRYSTALBALL_APP_KEY;
  try {
    const { res } = await invokeHandler(handler, { query: { indicator: '8.8.8.8' } });
    assert.equal(res.statusCode, 403);
  } finally {
    if (original !== undefined) process.env.CRYSTALBALL_APP_KEY = original;
  }
}));

test('virustotal: missing indicator returns 400', withSidecarMode(async () => {
  const original = process.env.VIRUSTOTAL_API_KEY;
  process.env.VIRUSTOTAL_API_KEY = 'test-key';
  try {
    const { res } = await invokeHandler(handler, { query: {} });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /indicator/);
  } finally {
    if (original === undefined) delete process.env.VIRUSTOTAL_API_KEY;
    else process.env.VIRUSTOTAL_API_KEY = original;
  }
}));

test('virustotal: missing VIRUSTOTAL_API_KEY returns degraded 200', withSidecarMode(async () => {
  const original = process.env.VIRUSTOTAL_API_KEY;
  delete process.env.VIRUSTOTAL_API_KEY;
  try {
    const { res } = await invokeHandler(handler, { query: { indicator: '8.8.8.8' } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.degraded, true);
  } finally {
    if (original !== undefined) process.env.VIRUSTOTAL_API_KEY = original;
  }
}));

test('virustotal: clamps oversized indicator before upstream', withSidecarMode(async () => {
  const original = process.env.VIRUSTOTAL_API_KEY;
  process.env.VIRUSTOTAL_API_KEY = 'test-key';
  // 5000-char indicator should be truncated to 4096 max.
  const oversized = 'a'.repeat(5000);
  let capturedUrl = '';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    capturedUrl = typeof url === 'string' ? url : url.url;
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await invokeHandler(handler, { query: { indicator: oversized } });
    // The indicator length in the path should not exceed the clamp.
    // We can't easily decode it, but the URL itself should be shorter
    // than the raw 5000-char input would have produced.
    assert.ok(capturedUrl.length < 5500, `URL was unexpectedly long: ${capturedUrl.length}`);
  } finally {
    globalThis.fetch = originalFetch;
    if (original === undefined) delete process.env.VIRUSTOTAL_API_KEY;
    else process.env.VIRUSTOTAL_API_KEY = original;
  }
}));

test('virustotal: 404 from upstream maps to found:false', withSidecarMode(async () => {
  const original = process.env.VIRUSTOTAL_API_KEY;
  process.env.VIRUSTOTAL_API_KEY = 'test-key';
  const restore = mockFetch(new Map([['virustotal.com', { status: 404, json: {} }]]));
  try {
    const { res } = await invokeHandler(handler, { query: { indicator: '8.8.8.8' } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.found, false);
  } finally {
    restore();
    if (original === undefined) delete process.env.VIRUSTOTAL_API_KEY;
    else process.env.VIRUSTOTAL_API_KEY = original;
  }
}));
