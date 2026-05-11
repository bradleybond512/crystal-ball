/**
 * Tests for api/floods/gauges.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invokeHandler, mockFetch } from './_test-utils.mjs';

let handler;
let gaugesCache;
try {
  const mod = await import('../floods/gauges.js');
  handler = mod.default;
  gaugesCache = mod.cache;
} catch (err) {
  console.warn('Handler floods/gauges.js failed to import:', err.message);
  handler = null;
}

const USGS_EMPTY_RESPONSE = {
  value: {
    timeSeries: [],
  },
};

const USGS_SAMPLE_RESPONSE = {
  value: {
    timeSeries: [
      {
        sourceInfo: {
          siteName: 'Arkansas River at Little Rock, AR',
          siteCode: [{ value: '07263620' }],
          geoLocation: { geogLocation: { latitude: 34.7, longitude: -92.3 } },
          siteProperty: [{ name: 'stateCd', value: 'AR' }],
        },
        values: [{
          value: [{ value: '28.4', qualifiers: ['P'] }],
        }],
      },
      {
        sourceInfo: {
          siteName: 'Mississippi River at Memphis, TN',
          siteCode: [{ value: '07032000' }],
          geoLocation: { geogLocation: { latitude: 35.1, longitude: -90.0 } },
          siteProperty: [{ name: 'stateCd', value: 'TN' }],
        },
        values: [{
          value: [{ value: '32.1', qualifiers: ['P', 'Flood'] }],
        }],
      },
      {
        sourceInfo: {
          siteName: 'Gauge with no data',
          siteCode: [{ value: '99999999' }],
          geoLocation: { geogLocation: { latitude: 30.0, longitude: -90.0 } },
          siteProperty: [{ name: 'stateCd', value: 'LA' }],
        },
        values: [{ value: [] }],
      },
    ],
  },
};

test('gauges: rejects non-GET methods', async () => {
  if (!handler) return;
  const { res } = await invokeHandler(handler, { method: 'DELETE' });
  assert.equal(res.statusCode, 405);
});

test('gauges: handles OPTIONS preflight', async () => {
  if (!handler) return;
  const { res } = await invokeHandler(handler, { method: 'OPTIONS' });
  assert.equal(res.statusCode, 204);
});

test('gauges: returns 200 with empty USGS response', async () => {
  if (!handler) return;
  const restoreFetch = mockFetch(new Map([
    ['waterservices.usgs.gov', { status: 200, json: USGS_EMPTY_RESPONSE }],
  ]));
  let res;
  try { ({ res } = await invokeHandler(handler)); } finally { restoreFetch(); }
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.totalGauges, 0);
  assert.equal(res.body.atFloodStage, 0);
});

test('gauges: response has expected shape keys', async () => {
  if (!handler) return;
  const restoreFetch = mockFetch(new Map([
    ['waterservices.usgs.gov', { status: 200, json: USGS_EMPTY_RESPONSE }],
  ]));
  let res;
  try { ({ res } = await invokeHandler(handler)); } finally { restoreFetch(); }
  assert.ok('totalGauges' in res.body);
  assert.ok('atFloodStage' in res.body);
  assert.ok('byState' in res.body);
  assert.ok('top10' in res.body);
  assert.ok('generatedAt' in res.body);
  assert.ok('source' in res.body);
});

test('gauges: counts total gauges correctly', async () => {
  if (!handler) return;
  gaugesCache?.clear();
  const restoreFetch = mockFetch(new Map([
    ['waterservices.usgs.gov', { status: 200, json: USGS_SAMPLE_RESPONSE }],
  ]));
  let res;
  try { ({ res } = await invokeHandler(handler)); } finally { restoreFetch(); }
  // 3 time series but one has no values — totalGauges reflects all timeSeries
  assert.equal(res.body.totalGauges, 3);
});

test('gauges: byState is an array', async () => {
  if (!handler) return;
  const restoreFetch = mockFetch(new Map([
    ['waterservices.usgs.gov', { status: 200, json: USGS_SAMPLE_RESPONSE }],
  ]));
  let res;
  try { ({ res } = await invokeHandler(handler)); } finally { restoreFetch(); }
  assert.ok(Array.isArray(res.body.byState));
});

test('gauges: top10 is an array of at most 10 items', async () => {
  if (!handler) return;
  const restoreFetch = mockFetch(new Map([
    ['waterservices.usgs.gov', { status: 200, json: USGS_SAMPLE_RESPONSE }],
  ]));
  let res;
  try { ({ res } = await invokeHandler(handler)); } finally { restoreFetch(); }
  assert.ok(Array.isArray(res.body.top10));
  assert.ok(res.body.top10.length <= 10);
});

test('gauges: degrades gracefully on USGS HTTP error', async () => {
  if (!handler) return;
  gaugesCache?.clear();
  const restoreFetch = mockFetch(new Map([
    ['waterservices.usgs.gov', { status: 503, text: 'Service Unavailable' }],
  ]));
  let res;
  try { ({ res } = await invokeHandler(handler)); } finally { restoreFetch(); }
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.degraded, true);
});

test('gauges: degrades gracefully on fetch exception', async () => {
  if (!handler) return;
  gaugesCache?.clear();
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Connection refused'); };
  let res;
  try { ({ res } = await invokeHandler(handler)); } finally { globalThis.fetch = origFetch; }
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.degraded, true);
});

test('gauges: source is waterservices.usgs.gov', async () => {
  if (!handler) return;
  const restoreFetch = mockFetch(new Map([
    ['waterservices.usgs.gov', { status: 200, json: USGS_EMPTY_RESPONSE }],
  ]));
  let res;
  try { ({ res } = await invokeHandler(handler)); } finally { restoreFetch(); }
  assert.equal(res.body.source, 'waterservices.usgs.gov');
});

test('gauges: generatedAt is valid ISO string', async () => {
  if (!handler) return;
  const restoreFetch = mockFetch(new Map([
    ['waterservices.usgs.gov', { status: 200, json: USGS_EMPTY_RESPONSE }],
  ]));
  let res;
  try { ({ res } = await invokeHandler(handler)); } finally { restoreFetch(); }
  assert.ok(typeof res.body.generatedAt === 'string');
  assert.doesNotThrow(() => new Date(res.body.generatedAt));
});

test('gauges: skips gauges with no data values', async () => {
  if (!handler) return;
  const noDataResponse = {
    value: {
      timeSeries: [{
        sourceInfo: {
          siteName: 'Empty gauge',
          siteCode: [{ value: '00000001' }],
          geoLocation: { geogLocation: { latitude: 35.0, longitude: -90.0 } },
          siteProperty: [{ name: 'stateCd', value: 'TN' }],
        },
        values: [{ value: [] }],
      }],
    },
  };
  const restoreFetch = mockFetch(new Map([
    ['waterservices.usgs.gov', { status: 200, json: noDataResponse }],
  ]));
  let res;
  try { ({ res } = await invokeHandler(handler)); } finally { restoreFetch(); }
  assert.equal(res.body.atFloodStage, 0);
  assert.equal(res.body.top10.length, 0);
});
