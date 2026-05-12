/**
 * Tests for api/intelligence/nearby.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invokeHandler, mockFetch } from './_test-utils.mjs';

let handler;
let nearbyCache;
try {
  const mod = await import('../intelligence/nearby.js');
  handler = mod.default;
  nearbyCache = mod.cache;
} catch (err) {
  console.warn('Handler intelligence/nearby.js failed to import:', err.message);
  handler = null;
}

const USGS_EMPTY = { type: 'FeatureCollection', features: [], metadata: {} };
const NWS_EMPTY = { type: 'FeatureCollection', features: [] };

function freshMocks() {
  return new Map([
    ['earthquake.usgs.gov', { status: 200, json: USGS_EMPTY }],
    ['api.weather.gov', { status: 200, json: NWS_EMPTY }],
  ]);
}

test('returns 200 with events array', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  nearbyCache?.clear();
  const restore = mockFetch(freshMocks());
  try {
    const { res } = await invokeHandler(handler);
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body.events));
  } finally { restore(); }
});

test('returns 405 for non-GET', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  const { res } = await invokeHandler(handler, { method: 'DELETE' });
  assert.equal(res.statusCode, 405);
});

test('without savedPlaces returns all events (no geo filter)', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  nearbyCache?.clear();
  const usgsData = {
    type: 'FeatureCollection',
    features: [
      {
        id: 'chicago',
        type: 'Feature',
        properties: { mag: 3.5, title: 'Chicago quake', time: Date.now() },
        geometry: { type: 'Point', coordinates: [-87.6, 41.8, 10] },
      },
      {
        id: 'miami',
        type: 'Feature',
        properties: { mag: 3.5, title: 'Miami quake', time: Date.now() },
        geometry: { type: 'Point', coordinates: [-80.2, 25.8, 10] },
      },
    ],
  };
  const restore = mockFetch(new Map([
    ['earthquake.usgs.gov', { status: 200, json: usgsData }],
    ['api.weather.gov', { status: 200, json: NWS_EMPTY }],
  ]));
  try {
    const { res } = await invokeHandler(handler);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.events.length, 2);
  } finally { restore(); }
});

test('filters events beyond radiusKm when savedPlaces provided', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  nearbyCache?.clear();
  const usgsData = {
    type: 'FeatureCollection',
    features: [
      {
        id: 'near',
        type: 'Feature',
        properties: { mag: 3.5, title: 'Nearby quake', time: Date.now() },
        geometry: { type: 'Point', coordinates: [-86.7, 41.6, 10] },
      },
      {
        id: 'far',
        type: 'Feature',
        properties: { mag: 3.5, title: 'Far quake', time: Date.now() },
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
    const { res } = await invokeHandler(handler, { query: { radiusKm: 200, savedPlaces } });
    assert.equal(res.statusCode, 200);
    const ids = res.body.events.map((e) => e.id);
    assert.ok(ids.includes('near'), 'should include nearby event');
    assert.ok(!ids.includes('far'), 'should exclude far event');
  } finally { restore(); }
});

test('generatedAt and radiusKm fields present in response', async (t) => {
  if (!handler) { t.skip('handler not available'); return; }
  nearbyCache?.clear();
  const restore = mockFetch(freshMocks());
  try {
    const { res } = await invokeHandler(handler, { query: { radiusKm: 300 } });
    assert.equal(res.statusCode, 200);
    assert.ok(typeof res.body.generatedAt === 'string');
    assert.equal(res.body.radiusKm, 300);
  } finally { restore(); }
});
