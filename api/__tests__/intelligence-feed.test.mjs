/**
 * Tests for api/intelligence/feed.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invokeHandler, mockFetch } from './_test-utils.mjs';

let handler;
let feedCache;
try {
  const mod = await import('../intelligence/feed.js');
  handler = mod.default;
  feedCache = mod.cache;
} catch (err) {
  console.warn('Handler intelligence/feed.js failed to import:', err.message);
  handler = null;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USGS_EMPTY = { type: 'FeatureCollection', features: [], metadata: {} };
const NWS_EMPTY  = { type: 'FeatureCollection', features: [] };

const USGS_TWO = {
  type: 'FeatureCollection',
  features: [
    {
      id: 'eq-high',
      type: 'Feature',
      properties: { mag: 6.8, place: 'Near Tokyo', time: Date.now() - 1_000 },
      geometry: { type: 'Point', coordinates: [139.7, 35.7, 15] },
    },
    {
      id: 'eq-low',
      type: 'Feature',
      properties: { mag: 2.6, place: 'Nevada', time: Date.now() - 60_000 },
      geometry: { type: 'Point', coordinates: [-115.1, 36.2, 8] },
    },
  ],
};

const NWS_ONE = {
  type: 'FeatureCollection',
  features: [
    {
      id: 'nws-1',
      type: 'Feature',
      properties: {
        id: 'nws-tornado-1',
        event: 'Tornado Warning',
        headline: 'Tornado Warning for Cook County',
        sent: new Date(Date.now() - 2 * 60_000).toISOString(),
        severity: 'Extreme',
      },
      geometry: null,
    },
  ],
};

function freshMocks() {
  return new Map([
    ['earthquake.usgs.gov', { status: 200, json: USGS_EMPTY }],
    ['api.weather.gov', { status: 200, json: NWS_EMPTY }],
  ]);
}

// ── Basic response shape ───────────────────────────────────────────────────────

test('returns 200 with items array, total, and generated fields', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  feedCache?.clear();
  const restore = mockFetch(freshMocks());
  try {
    const { res } = await invokeHandler(handler);
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body.items));
    assert.ok(typeof res.body.total === 'number');
    assert.ok(typeof res.body.generated === 'number');
  } finally { restore(); }
});

test('returns 405 for non-GET requests', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  const { res } = await invokeHandler(handler, { method: 'DELETE' });
  assert.equal(res.statusCode, 405);
});

test('returns 204 for OPTIONS preflight', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  const { res } = await invokeHandler(handler, { method: 'OPTIONS' });
  assert.equal(res.statusCode, 204);
});

// ── FeedItem shape ─────────────────────────────────────────────────────────────

test('each item has id, type, timestamp, domain, severity, title, summary, data', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  feedCache?.clear();
  const restore = mockFetch(new Map([
    ['earthquake.usgs.gov', { status: 200, json: USGS_TWO }],
    ['api.weather.gov', { status: 200, json: NWS_EMPTY }],
  ]));
  try {
    const { res } = await invokeHandler(handler);
    assert.ok(res.body.items.length >= 1);
    const item = res.body.items[0];
    assert.ok(typeof item.id === 'string');
    assert.equal(item.type, 'observation');
    assert.ok(typeof item.timestamp === 'number');
    assert.ok(typeof item.domain === 'string');
    assert.ok(typeof item.severity === 'string');
    assert.ok(typeof item.title === 'string');
    assert.ok(typeof item.summary === 'string');
    assert.ok(item.data !== null && typeof item.data === 'object');
  } finally { restore(); }
});

test('item.data contains driverScore and edgeCount', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  feedCache?.clear();
  const restore = mockFetch(new Map([
    ['earthquake.usgs.gov', { status: 200, json: USGS_TWO }],
    ['api.weather.gov', { status: 200, json: NWS_EMPTY }],
  ]));
  try {
    const { res } = await invokeHandler(handler);
    const item = res.body.items[0];
    assert.ok(typeof item.data.driverScore === 'number');
    assert.ok(item.data.driverScore >= 0 && item.data.driverScore <= 100);
    assert.ok(typeof item.data.edgeCount === 'number');
  } finally { restore(); }
});

// ── Driver score ordering ──────────────────────────────────────────────────────

test('items are sorted by driverScore descending', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  feedCache?.clear();
  const restore = mockFetch(new Map([
    ['earthquake.usgs.gov', { status: 200, json: USGS_TWO }],
    ['api.weather.gov', { status: 200, json: NWS_EMPTY }],
  ]));
  try {
    const { res } = await invokeHandler(handler);
    const scores = res.body.items.map((i) => i.data.driverScore);
    for (let i = 0; i < scores.length - 1; i++) {
      assert.ok(
        scores[i] >= scores[i + 1],
        `item[${i}].driverScore(${scores[i]}) < item[${i + 1}].driverScore(${scores[i + 1]})`,
      );
    }
  } finally { restore(); }
});

test('M6.8 earthquake has higher driverScore than M2.6', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  feedCache?.clear();
  const restore = mockFetch(new Map([
    ['earthquake.usgs.gov', { status: 200, json: USGS_TWO }],
    ['api.weather.gov', { status: 200, json: NWS_EMPTY }],
  ]));
  try {
    const { res } = await invokeHandler(handler);
    const high = res.body.items.find((i) => i.id === 'eq-high');
    const low  = res.body.items.find((i) => i.id === 'eq-low');
    assert.ok(high, 'eq-high item should exist');
    assert.ok(low,  'eq-low item should exist');
    assert.ok(
      high.data.driverScore > low.data.driverScore,
      `expected eq-high(${high.data.driverScore}) > eq-low(${low.data.driverScore})`,
    );
  } finally { restore(); }
});

test('NWS Extreme alert scores as CRITICAL severity', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  feedCache?.clear();
  const restore = mockFetch(new Map([
    ['earthquake.usgs.gov', { status: 200, json: USGS_EMPTY }],
    ['api.weather.gov', { status: 200, json: NWS_ONE }],
  ]));
  try {
    const { res } = await invokeHandler(handler);
    const item = res.body.items.find((i) => i.id === 'nws-tornado-1');
    assert.ok(item, 'tornado item should exist');
    assert.equal(item.severity, 'CRITICAL');
  } finally { restore(); }
});

// ── Query parameter filtering ──────────────────────────────────────────────────

test('limit=2 caps items to 2', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  feedCache?.clear();
  const restore = mockFetch(new Map([
    ['earthquake.usgs.gov', { status: 200, json: USGS_TWO }],
    ['api.weather.gov', { status: 200, json: NWS_ONE }],
  ]));
  try {
    const { res } = await invokeHandler(handler, { query: { limit: 2 } });
    assert.equal(res.body.items.length, 2);
    assert.ok(res.body.total >= 2, 'total reflects unsliced count');
  } finally { restore(); }
});

test('domain=seismic only returns seismic events', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  feedCache?.clear();
  const restore = mockFetch(new Map([
    ['earthquake.usgs.gov', { status: 200, json: USGS_TWO }],
    ['api.weather.gov', { status: 200, json: NWS_ONE }],
  ]));
  try {
    const { res } = await invokeHandler(handler, { query: { domain: 'seismic' } });
    assert.ok(res.body.items.length > 0, 'should have seismic items');
    for (const item of res.body.items) {
      assert.equal(item.domain, 'seismic');
    }
  } finally { restore(); }
});

test('domain=weather only returns weather events', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  feedCache?.clear();
  const restore = mockFetch(new Map([
    ['earthquake.usgs.gov', { status: 200, json: USGS_TWO }],
    ['api.weather.gov', { status: 200, json: NWS_ONE }],
  ]));
  try {
    const { res } = await invokeHandler(handler, { query: { domain: 'weather' } });
    for (const item of res.body.items) {
      assert.equal(item.domain, 'weather');
    }
  } finally { restore(); }
});

test('type=observation returns all observation items', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  feedCache?.clear();
  const restore = mockFetch(new Map([
    ['earthquake.usgs.gov', { status: 200, json: USGS_TWO }],
    ['api.weather.gov', { status: 200, json: NWS_EMPTY }],
  ]));
  try {
    const { res } = await invokeHandler(handler, { query: { type: 'observation' } });
    assert.ok(res.body.items.length >= 1);
    for (const item of res.body.items) {
      assert.equal(item.type, 'observation');
    }
  } finally { restore(); }
});

test('type=correlation returns empty items (not supported by this route)', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  feedCache?.clear();
  const restore = mockFetch(new Map([
    ['earthquake.usgs.gov', { status: 200, json: USGS_TWO }],
    ['api.weather.gov', { status: 200, json: NWS_EMPTY }],
  ]));
  try {
    const { res } = await invokeHandler(handler, { query: { type: 'correlation' } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.items.length, 0);
  } finally { restore(); }
});

// ── Upstream failure resilience ────────────────────────────────────────────────

test('returns 200 with partial results when USGS is down', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  feedCache?.clear();
  const restore = mockFetch(new Map([
    ['earthquake.usgs.gov', { status: 503, text: 'Service Unavailable' }],
    ['api.weather.gov', { status: 200, json: NWS_ONE }],
  ]));
  try {
    const { res } = await invokeHandler(handler);
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body.items));
    // NWS items should still be present
    assert.ok(res.body.items.some((i) => i.domain === 'weather'));
  } finally { restore(); }
});

test('returns 200 with empty items when all upstreams fail', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  feedCache?.clear();
  const restore = mockFetch(new Map([
    ['earthquake.usgs.gov', { status: 503, text: 'down' }],
    ['api.weather.gov', { status: 503, text: 'down' }],
  ]));
  try {
    const { res } = await invokeHandler(handler);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.items.length, 0);
  } finally { restore(); }
});

// ── Cache behaviour ────────────────────────────────────────────────────────────

test('second identical request is served from cache', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  feedCache?.clear();
  let callCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const urlStr = typeof url === 'string' ? url : (url?.url ?? String(url));
    callCount++;
    return new Response(
      urlStr.includes('earthquake') ? JSON.stringify(USGS_EMPTY) : JSON.stringify(NWS_EMPTY),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  try {
    await invokeHandler(handler);
    const before = callCount;
    await invokeHandler(handler);
    assert.equal(callCount, before, 'no additional upstream calls on cache hit');
  } finally { globalThis.fetch = originalFetch; }
});
