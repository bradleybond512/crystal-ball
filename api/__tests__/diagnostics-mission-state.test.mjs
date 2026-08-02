/**
 * Tests for api/diagnostics/mission-state.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invokeHandler, mockFetch } from './_test-utils.mjs';

let handler;
let missionStateCache;
let isReachableProbeStatus;
try {
  const mod = await import('../diagnostics/mission-state.js');
  handler = mod.default;
  missionStateCache = mod.cache;
  isReachableProbeStatus = mod.isReachableProbeStatus;
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

/** Installs mockFetch, then records every URL the handler asks for. */
function recordingFetch(responses) {
  const restoreMock = mockFetch(responses);
  const mocked = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url, ...args) => {
    urls.push(typeof url === 'string' ? url : (url?.url ?? String(url)));
    return mocked(url, ...args);
  };
  return { urls, restore: () => { globalThis.fetch = mocked; restoreMock(); } };
}

function swpcStatus(status) {
  const m = allReachable();
  m.set('services.swpc.noaa.gov', { status });
  return m;
}

// A retired upstream product answers 404 forever. Because the probe counted any
// sub-500 status as reachable, the dead solar-wind URL reported NOMINAL for as
// long as it had been gone — the health surface asserted the opposite of the
// truth, which is worse than having no health surface.
for (const status of [404, 410]) {
  test(`treats HTTP ${status} as a DOWN feed, not a reachable one`, async (t) => {
    if (!handler) { t.skip('handler not available'); return; }
    missionStateCache?.clear();
    const restore = mockFetch(swpcStatus(status));
    try {
      const { res } = await invokeHandler(handler);
      const swpc = res.body.feeds.find((f) => f.id === 'spaceweather-noaa');
      assert.ok(swpc, 'the SWPC feed must still be probed');
      assert.equal(swpc.reachable, false, `${status} means the resource is gone`);
      assert.equal(res.body.downCount, 1);
    } finally { restore(); }
  });
}

// The complement, and the reason the guard is narrow: several of these hosts
// refuse HEAD or want a key while being perfectly healthy. Widening the check to
// "any 4xx is down" would turn those into permanent false alarms.
for (const status of [401, 403, 405, 429]) {
  test(`still counts HTTP ${status} as reachable`, async (t) => {
    if (!handler) { t.skip('handler not available'); return; }
    missionStateCache?.clear();
    const restore = mockFetch(swpcStatus(status));
    try {
      const { res } = await invokeHandler(handler);
      const swpc = res.body.feeds.find((f) => f.id === 'spaceweather-noaa');
      assert.equal(swpc.reachable, true, `${status} is a live host refusing this request`);
      assert.equal(res.body.downCount, 0);
    } finally { restore(); }
  });
}

// The flip that matters: reachability is now an ALLOWLIST. The previous version
// enumerated what was broken (404/410) and let everything else through, so every
// status nobody thought of read as healthy — the same fail-open shape that hid
// the retired solar-wind URL, just narrower.
for (const status of [400, 408, 418, 422, 451, 500, 502, 503, 504]) {
  test(`treats HTTP ${status} as a DOWN feed — unlisted statuses are not assumed healthy`, async (t) => {
    if (!handler) { t.skip('handler not available'); return; }
    missionStateCache?.clear();
    const restore = mockFetch(swpcStatus(status));
    try {
      const { res } = await invokeHandler(handler);
      const swpc = res.body.feeds.find((f) => f.id === 'spaceweather-noaa');
      assert.equal(swpc.reachable, false, `${status} is not a recognized sign of life`);
      assert.equal(res.body.downCount, 1);
    } finally { restore(); }
  });
}

test('isReachableProbeStatus admits 2xx/3xx and exactly four tolerated refusals', async (t) => {
  if (!isReachableProbeStatus) { t.skip('handler not available'); return; }
  for (const ok of [200, 204, 206, 301, 302, 304, 399, 401, 403, 405, 429]) {
    assert.equal(isReachableProbeStatus(ok), true, String(ok));
  }
  // 402/404/406/407/409… are all deliberately absent. Adding one is a decision,
  // not a default — which is the whole point of an allowlist.
  for (const down of [100, 402, 404, 406, 407, 409, 410, 428, 430, 500, 599]) {
    assert.equal(isReachableProbeStatus(down), false, String(down));
  }
});

test('probes a SWPC product that still exists', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  missionStateCache?.clear();
  const { urls, restore } = recordingFetch(allReachable());
  try {
    await invokeHandler(handler);
    const swpcUrl = urls.find((u) => u.includes('services.swpc.noaa.gov'));
    assert.ok(swpcUrl, 'the handler must probe SWPC');
    // solar-wind/mag-5-minute.json and plasma-5-minute.json were both retired
    // upstream. Probing either one can only ever report a false negative.
    assert.ok(!swpcUrl.includes('mag-5-minute'), 'mag-5-minute.json is retired');
    assert.ok(!swpcUrl.includes('plasma-5-minute'), 'plasma-5-minute.json is retired');
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
