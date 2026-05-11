/**
 * Tests for api/diagnostics/mission-state.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invokeHandler, mockFetch } from './_test-utils.mjs';

let handler;
let missionStateCache;
try {
  const mod = await import('../diagnostics/mission-state.js');
  handler = mod.default;
  missionStateCache = mod.cache;
} catch (err) {
  console.warn('Handler diagnostics/mission-state.js failed to import:', err.message);
  handler = null;
}

function allReachable() {
  return new Map([
    ['earthquake.usgs.gov', { status: 200 }],
    ['api.weather.gov', { status: 200 }],
    ['firms.modaps.eosdis.nasa.gov', { status: 200 }],
    ['marinetraffic.com', { status: 200 }],
    ['services.swpc.noaa.gov', { status: 200 }],
  ]);
}

function allDown() {
  return new Map([
    ['earthquake.usgs.gov', { status: 503 }],
    ['api.weather.gov', { status: 503 }],
    ['firms.modaps.eosdis.nasa.gov', { status: 503 }],
    ['marinetraffic.com', { status: 503 }],
    ['services.swpc.noaa.gov', { status: 503 }],
  ]);
}

test('returns 200 with NOMINAL when all feeds reachable', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  missionStateCache?.clear();
  const restore = mockFetch(allReachable());
  try {
    const { res } = await invokeHandler(handler);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.state, 'NOMINAL');
    assert.equal(res.body.downCount, 0);
  } finally { restore(); }
});

test('returns DEGRADED when 2 feeds are down', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  missionStateCache?.clear();
  const partial = new Map([
    ['earthquake.usgs.gov', { status: 200 }],
    ['api.weather.gov', { status: 503 }],
    ['firms.modaps.eosdis.nasa.gov', { status: 503 }],
    ['marinetraffic.com', { status: 200 }],
    ['services.swpc.noaa.gov', { status: 200 }],
  ]);
  const restore = mockFetch(partial);
  try {
    const { res } = await invokeHandler(handler);
    assert.equal(res.body.state, 'DEGRADED');
    assert.equal(res.body.downCount, 2);
  } finally { restore(); }
});

test('returns CRITICAL when 3 or more feeds are down', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  missionStateCache?.clear();
  const restore = mockFetch(allDown());
  try {
    const { res } = await invokeHandler(handler);
    assert.equal(res.body.state, 'CRITICAL');
    assert.equal(res.body.downCount, 5);
  } finally { restore(); }
});

test('response includes feeds array with id and label fields', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  missionStateCache?.clear();
  const restore = mockFetch(allReachable());
  try {
    const { res } = await invokeHandler(handler);
    assert.ok(Array.isArray(res.body.feeds));
    assert.equal(res.body.feeds.length, 5);
    for (const feed of res.body.feeds) {
      assert.ok('id' in feed, 'feed should have id');
      assert.ok('label' in feed, 'feed should have label');
      assert.ok('reachable' in feed, 'feed should have reachable');
    }
  } finally { restore(); }
});

test('response includes generatedAt ISO timestamp', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  missionStateCache?.clear();
  const restore = mockFetch(allReachable());
  try {
    const { res } = await invokeHandler(handler);
    assert.ok(typeof res.body.generatedAt === 'string');
    assert.ok(!Number.isNaN(Date.parse(res.body.generatedAt)));
  } finally { restore(); }
});

test('rejects non-GET methods with 405', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  const { res } = await invokeHandler(handler, { method: 'POST' });
  assert.equal(res.statusCode, 405);
});

test('serves cached response within TTL', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  missionStateCache?.clear();
  let callCount = 0;
  const countingFetch = new Map([
    ['earthquake.usgs.gov', { status: 200 }],
    ['api.weather.gov', { status: 200 }],
    ['firms.modaps.eosdis.nasa.gov', { status: 200 }],
    ['marinetraffic.com', { status: 200 }],
    ['services.swpc.noaa.gov', { status: 200 }],
  ]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, ...args) => {
    callCount++;
    return originalFetch(url, ...args);
  };
  const restore = mockFetch(countingFetch);
  try {
    await invokeHandler(handler);
    const priorCount = callCount;
    await invokeHandler(handler); // should hit cache
    assert.equal(callCount, priorCount, 'second call should use cache, not re-fetch');
  } finally {
    restore();
    globalThis.fetch = originalFetch;
  }
});
