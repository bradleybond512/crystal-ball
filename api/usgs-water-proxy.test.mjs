import test from 'node:test';
import assert from 'node:assert/strict';

import handler, { normalizeUsgsLatestContinuous } from './usgs-water-proxy.js';

const request = (query = '', init = {}) => new Request(`https://crystalball.app/api/usgs-water-proxy${query}`, {
  headers: { origin: 'https://crystalball.app' }, ...init,
});

test('USGS water proxy validates a bounded bbox and allows only GET', async () => {
  assert.equal((await handler(request('', { method: 'POST' }))).status, 405);
  for (const query of ['', '?bbox=x', '?bbox=-87,41,-86,42&extra=x', '?bbox=-87,41,-85,42', '?bbox=-86,42,-87,41']) {
    assert.equal((await handler(request(query))).status, 400, query);
  }
});

test('USGS water proxy uses a fixed modern endpoint and emits safe allowlisted fields', async () => {
  const originalFetch = globalThis.fetch;
  const recentTime = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(String(url));
    assert.equal(options.maxResponseBytes, 2 * 1024 * 1024);
    if (String(url).includes('/monitoring-locations/items')) {
      return new Response(JSON.stringify({ type: 'FeatureCollection', features: [{
        type: 'Feature', id: 'USGS-04095300', geometry: { type: 'Point', coordinates: [-86.72, 41.6] },
        properties: { id: 'USGS-04095300', monitoring_location_name: 'Trail Creek', agency_code: 'USGS', site_type_code: 'ST' },
      }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ type: 'FeatureCollection', features: [{
      type: 'Feature', id: 'row-1', geometry: { type: 'Point', coordinates: [-86.72, 41.6] },
      properties: {
        monitoring_location_id: 'USGS-04095300', parameter_code: '00400', value: '7.2',
        time: recentTime, unit_of_measure: 'std units', secret: 'drop me',
      },
    }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const response = await handler(request('?bbox=-86.9,41.4,-86.5,41.8'));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(calls.length, 2);
    const locations = new URL(calls[0]);
    assert.equal(locations.pathname, '/ogcapi/v0/collections/monitoring-locations/items');
    assert.equal(locations.searchParams.get('agency_code'), 'USGS');
    assert.equal(locations.searchParams.get('site_type_code'), 'ST');
    const upstream = new URL(calls[1]);
    assert.equal(upstream.hostname, 'api.waterdata.usgs.gov');
    assert.equal(upstream.pathname, '/ogcapi/v0/collections/latest-continuous/items');
    assert.equal(upstream.searchParams.get('bbox'), null);
    assert.equal(upstream.searchParams.get('monitoring_location_id'), 'USGS-04095300');
    assert.equal(upstream.searchParams.get('limit'), '200');
    assert.deepEqual(body.features[0].properties, {
      monitoring_location_id: 'USGS-04095300', monitoring_location_name: 'Trail Creek',
      parameter_code: '00400', value: 7.2,
      time: recentTime, unit_of_measure: 'std units',
    });
  } finally { globalThis.fetch = originalFetch; }
});

test('USGS parser fails closed on result-limit saturation and all-dropped rows', () => {
  const now = Date.parse('2026-08-14T21:00:00Z');
  assert.equal(normalizeUsgsLatestContinuous({
    type: 'FeatureCollection', features: Array.from({ length: 200 }, () => ({})),
  }, '-87.000000,41.000000,-86.000000,42.000000', undefined, now), null);
  assert.equal(normalizeUsgsLatestContinuous({ type: 'FeatureCollection', features: [{
    geometry: { type: 'Point', coordinates: [-100, 41.5] },
    properties: { monitoring_location_id: 'USGS-X', parameter_code: '00010', value: 20, time: '2026-08-14T20:30:00Z' },
  }] }, '-87.000000,41.000000,-86.000000,42.000000', undefined, now), null);
  for (const time of [undefined, 'not-a-date', '2026-08-14T20:30:00', '2026-08-14', '2026-08-12T20:30:00Z', '2026-08-15T20:30:00Z']) {
    assert.equal(normalizeUsgsLatestContinuous({ type: 'FeatureCollection', features: [{
      geometry: { type: 'Point', coordinates: [-86.5, 41.5] },
      properties: { monitoring_location_id: 'USGS-X', parameter_code: '00010', value: 20, ...(time ? { time } : {}) },
    }] }, '-87.000000,41.000000,-86.000000,42.000000', undefined, now), null);
  }
  assert.equal(normalizeUsgsLatestContinuous({ type: 'FeatureCollection', features: [{
    geometry: { type: 'Point', coordinates: [-86.5, 41.5] },
    properties: {
      monitoring_location_id: 'USGS-X', parameter_code: '00010', value: 20,
      time: '2026-02-30T12:45:00Z',
    },
  }] }, '-87.000000,41.000000,-86.000000,42.000000', undefined,
  Date.parse('2026-03-02T13:00:00Z')), null, 'calendar-invalid civil time must fail closed');
});

test('USGS water proxy rejects oversized location and measurement bodies before parsing', async () => {
  const originalFetch = globalThis.fetch;
  const validLocations = () => Response.json({ type: 'FeatureCollection', features: [{
    type: 'Feature', id: 'USGS-X', geometry: { type: 'Point', coordinates: [-86.5, 41.5] },
    properties: { id: 'USGS-X', monitoring_location_name: 'Example', agency_code: 'USGS', site_type_code: 'ST' },
  }] });
  try {
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.maxResponseBytes, 2 * 1024 * 1024);
      return new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), {
        status: 200, headers: { 'content-length': String(2 * 1024 * 1024 + 1) },
      });
    };
    assert.equal((await handler(request('?bbox=-87,41,-86,42'))).status, 502);

    let calls = 0;
    globalThis.fetch = async (_url, options) => {
      calls += 1;
      assert.equal(options.maxResponseBytes, 2 * 1024 * 1024);
      if (calls === 1) return validLocations();
      const bytes = new TextEncoder().encode(JSON.stringify({
        type: 'FeatureCollection', features: [], padding: 'x'.repeat(2 * 1024 * 1024),
      }));
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }), { status: 200 });
    };
    assert.equal((await handler(request('?bbox=-87,41,-86,42'))).status, 502);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = originalFetch; }
});
