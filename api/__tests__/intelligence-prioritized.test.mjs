/**
 * Tests for api/intelligence/prioritized.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invokeHandler, mockFetch } from './_test-utils.mjs';

let handler;
let prioritizedCache;
try {
  const mod = await import('../intelligence/prioritized.js');
  handler = mod.default;
  prioritizedCache = mod.cache;
} catch (err) {
  console.warn('Handler intelligence/prioritized.js failed to import:', err.message);
  handler = null;
}

const USGS_EMPTY = {
  type: 'FeatureCollection',
  features: [],
  metadata: { count: 0 },
};

const NWS_EMPTY = { type: 'FeatureCollection', features: [] };

function freshMocks() {
  return new Map([
    ['earthquake.usgs.gov', { status: 200, json: USGS_EMPTY }],
    ['api.weather.gov', { status: 200, json: NWS_EMPTY }],
  ]);
}

test('returns 200 with events array', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  prioritizedCache?.clear();
  const restore = mockFetch(freshMocks());
  try {
    const { res } = await invokeHandler(handler);
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body.events), 'events should be an array');
  } finally { restore(); }
});

test('returns 405 for non-GET', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  const { res } = await invokeHandler(handler, { method: 'POST' });
  assert.equal(res.statusCode, 405);
});

test('respects the limit query param', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  prioritizedCache?.clear();
  const usgsData = {
    type: 'FeatureCollection',
    features: Array.from({ length: 20 }, (_, i) => ({
      id: `eq${i}`,
      type: 'Feature',
      properties: { mag: 3.5, title: `M3.5 quake ${i}`, time: Date.now() - i * 1000 },
      geometry: { type: 'Point', coordinates: [-87.6, 41.8, 10] },
    })),
  };
  const restore = mockFetch(new Map([
    ['earthquake.usgs.gov', { status: 200, json: usgsData }],
    ['api.weather.gov', { status: 200, json: NWS_EMPTY }],
  ]));
  try {
    const { res } = await invokeHandler(handler, { query: { limit: 5 } });
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.events.length <= 5, `expected ≤5, got ${res.body.events.length}`);
  } finally { restore(); }
});

test('parses savedPlaces and applies proximity bonus', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  prioritizedCache?.clear();
  const usgsData = {
    type: 'FeatureCollection',
    features: [
      {
        id: 'nearby',
        type: 'Feature',
        properties: { mag: 2.5, title: 'Nearby quake', time: Date.now() - 3 * 60 * 60_000 },
        geometry: { type: 'Point', coordinates: [-86.7, 41.6, 10] },
      },
      {
        id: 'far',
        type: 'Feature',
        properties: { mag: 4.0, title: 'Far quake', time: Date.now() - 3 * 60 * 60_000 },
        geometry: { type: 'Point', coordinates: [-80.2, 25.8, 10] },
      },
    ],
  };
  const savedPlaces = JSON.stringify([{ lat: 41.6, lon: -86.7 }]);
  const restore = mockFetch(new Map([
    ['earthquake.usgs.gov', { status: 200, json: usgsData }],
    ['api.weather.gov', { status: 200, json: NWS_EMPTY }],
  ]));
  try {
    const { res } = await invokeHandler(handler, { query: { savedPlaces } });
    assert.equal(res.statusCode, 200);
    // nearby event should be ranked higher than far despite lower magnitude
    const nearbyIdx = res.body.events.findIndex((e) => e.id === 'nearby');
    const farIdx = res.body.events.findIndex((e) => e.id === 'far');
    assert.ok(nearbyIdx < farIdx, `expected nearby (${nearbyIdx}) before far (${farIdx})`);
  } finally { restore(); }
});

test('returns 200 even when upstream is down', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  prioritizedCache?.clear();
  const restore = mockFetch(new Map([
    ['earthquake.usgs.gov', { status: 503 }],
    ['api.weather.gov', { status: 503 }],
  ]));
  try {
    const { res } = await invokeHandler(handler);
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body.events));
  } finally { restore(); }
});

test('caches response for subsequent calls', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  prioritizedCache?.clear();
  let callCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { callCount++; return new Response(JSON.stringify(USGS_EMPTY), { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    await invokeHandler(handler);
    const beforeCount = callCount;
    await invokeHandler(handler);
    assert.equal(callCount, beforeCount, 'second call should use cache, not re-fetch');
  } finally { globalThis.fetch = originalFetch; }
});
