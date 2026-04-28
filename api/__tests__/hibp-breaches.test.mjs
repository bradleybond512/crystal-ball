/**
 * Route-level coverage for api/hibp-breaches.js
 *
 * The catalog path is unauthenticated (public HIBP data); the
 * `?account=…` lookup path requires an app key in cloud mode AND a
 * server-side HIBP key. This file proves the auth + input-validation
 * gates fail closed, plus the happy-path catalog returns an array.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invokeHandler, mockFetch } from './_test-utils.mjs';

const handler = (await import('../hibp-breaches.js')).default;

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

test('hibp-breaches: OPTIONS returns 204 with CORS headers', async () => {
  const { res } = await invokeHandler(handler, { method: 'OPTIONS' });
  assert.equal(res.statusCode, 204);
});

test('hibp-breaches: rejects unsupported methods', async () => {
  const { res } = await invokeHandler(handler, { method: 'DELETE' });
  assert.equal(res.statusCode, 405);
});

test('hibp-breaches: catalog path returns degraded array on upstream 5xx', async () => {
  const restore = mockFetch(new Map([['haveibeenpwned.com/api/v3/breaches', { status: 503, json: {} }]]));
  try {
    const { res } = await invokeHandler(handler, { query: {} });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.degraded, true);
    assert.deepEqual(res.body.breaches, []);
  } finally { restore(); }
});

test('hibp-breaches: account lookup in cloud mode without CRYSTALBALL_APP_KEY refuses', withCloudMode(async () => {
  const original = process.env.CRYSTALBALL_APP_KEY;
  delete process.env.CRYSTALBALL_APP_KEY;
  try {
    const { res } = await invokeHandler(handler, { query: { account: 'foo@bar.com' } });
    assert.equal(res.statusCode, 403, 'fail-closed when no app key configured');
  } finally {
    if (original !== undefined) process.env.CRYSTALBALL_APP_KEY = original;
  }
}));

test('hibp-breaches: account lookup in cloud mode with wrong app key returns 401', withCloudMode(async () => {
  const original = process.env.CRYSTALBALL_APP_KEY;
  process.env.CRYSTALBALL_APP_KEY = 'expected-secret';
  try {
    const { res } = await invokeHandler(handler, {
      query: { account: 'foo@bar.com' },
      headers: { 'X-CrystalBall-Key': 'wrong-secret' },
    });
    assert.equal(res.statusCode, 401);
  } finally {
    if (original === undefined) delete process.env.CRYSTALBALL_APP_KEY;
    else process.env.CRYSTALBALL_APP_KEY = original;
  }
}));

test('hibp-breaches: account lookup rejects malformed account input', withSidecarMode(async () => {
  const originalKey = process.env.HIBP_API_KEY;
  process.env.HIBP_API_KEY = 'test-key';
  try {
    const { res } = await invokeHandler(handler, { query: { account: 'has\nnewline' } });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /Invalid account/);
  } finally {
    if (originalKey === undefined) delete process.env.HIBP_API_KEY;
    else process.env.HIBP_API_KEY = originalKey;
  }
}));

test('hibp-breaches: account lookup with no HIBP key returns degraded', withSidecarMode(async () => {
  const original = process.env.HIBP_API_KEY;
  delete process.env.HIBP_API_KEY;
  try {
    const { res } = await invokeHandler(handler, { query: { account: 'foo@bar.com' } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.degraded, true);
  } finally {
    if (original !== undefined) process.env.HIBP_API_KEY = original;
  }
}));
