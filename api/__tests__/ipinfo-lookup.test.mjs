/**
 * Route-level coverage for api/ipinfo-lookup.js
 *
 * IPinfo is a key-spending oracle: arbitrary IP → server IPinfo token.
 * Tests prove the auth gate fails closed in cloud mode, the IP shape
 * validator refuses junk, and missing tokens degrade.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invokeHandler } from './_test-utils.mjs';

const handler = (await import('../ipinfo-lookup.js')).default;

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

test('ipinfo: OPTIONS returns 204', async () => {
  const { res } = await invokeHandler(handler, { method: 'OPTIONS' });
  assert.equal(res.statusCode, 204);
});

test('ipinfo: rejects unsupported methods', async () => {
  const { res } = await invokeHandler(handler, { method: 'POST' });
  assert.equal(res.statusCode, 405);
});

test('ipinfo: cloud mode without CRYSTALBALL_APP_KEY refuses', withCloudMode(async () => {
  const original = process.env.CRYSTALBALL_APP_KEY;
  delete process.env.CRYSTALBALL_APP_KEY;
  try {
    const { res } = await invokeHandler(handler, { query: { ip: '8.8.8.8' } });
    assert.equal(res.statusCode, 403);
  } finally {
    if (original !== undefined) process.env.CRYSTALBALL_APP_KEY = original;
  }
}));

test('ipinfo: missing ip returns 400', withSidecarMode(async () => {
  const original = process.env.IPINFO_TOKEN;
  process.env.IPINFO_TOKEN = 'test-token';
  try {
    const { res } = await invokeHandler(handler, { query: {} });
    assert.equal(res.statusCode, 400);
  } finally {
    if (original === undefined) delete process.env.IPINFO_TOKEN;
    else process.env.IPINFO_TOKEN = original;
  }
}));

test('ipinfo: malformed ip returns 400', withSidecarMode(async () => {
  const original = process.env.IPINFO_TOKEN;
  process.env.IPINFO_TOKEN = 'test-token';
  try {
    const { res } = await invokeHandler(handler, { query: { ip: 'not-an-ip; rm -rf /' } });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /Invalid IP/);
  } finally {
    if (original === undefined) delete process.env.IPINFO_TOKEN;
    else process.env.IPINFO_TOKEN = original;
  }
}));

test('ipinfo: missing IPINFO_TOKEN returns degraded 200', withSidecarMode(async () => {
  const original = process.env.IPINFO_TOKEN;
  delete process.env.IPINFO_TOKEN;
  try {
    const { res } = await invokeHandler(handler, { query: { ip: '8.8.8.8' } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.degraded, true);
  } finally {
    if (original !== undefined) process.env.IPINFO_TOKEN = original;
  }
}));

test('ipinfo: accepts valid IPv4', withSidecarMode(async () => {
  const original = process.env.IPINFO_TOKEN;
  process.env.IPINFO_TOKEN = 'test-token';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"ip":"8.8.8.8","org":"Google"}', { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const { res } = await invokeHandler(handler, { query: { ip: '8.8.8.8' } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ip, '8.8.8.8');
  } finally {
    globalThis.fetch = originalFetch;
    if (original === undefined) delete process.env.IPINFO_TOKEN;
    else process.env.IPINFO_TOKEN = original;
  }
}));
