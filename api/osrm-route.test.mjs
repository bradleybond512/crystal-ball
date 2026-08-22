import assert from 'node:assert/strict';
import test from 'node:test';
import handler from './osrm-route.js';

function request(query, method = 'GET') {
  return new Request(`http://localhost/api/osrm-route?${query}`, {
    method,
    headers: { origin: 'http://localhost' },
  });
}

const VALID_UPSTREAM = {
  code: 'Ok',
  routes: [{
    distance: 15200,
    duration: 1260,
    geometry: { type: 'LineString', coordinates: [[-86.7, 41.6], [-86.8, 41.7]] },
    legs: [{
      distance: 15200,
      duration: 1260,
      steps: [{
        maneuver: { type: 'depart', modifier: 'right' },
        name: 'Main St',
        distance: 1000,
        duration: 120,
      }],
    }],
  }],
};

test('OSRM proxy validates coordinates, pins request options, and normalizes the response', async (t) => {
  let calledUrl = '';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calledUrl = String(url);
    return Response.json(VALID_UPSTREAM);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await handler(request(`coords=${encodeURIComponent('-86.7,41.6;-86.8,41.7')}`));
  assert.equal(response.status, 200);
  assert.equal(
    calledUrl,
    'https://router.project-osrm.org/route/v1/driving/-86.7,41.6;-86.8,41.7?overview=full&geometries=geojson&steps=true',
  );
  assert.deepEqual(await response.json(), VALID_UPSTREAM);
});

test('OSRM proxy rejects malformed, duplicate, unknown, or excessive coordinates without fetching', async (t) => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls += 1; return Response.json(VALID_UPSTREAM); };
  t.after(() => { globalThis.fetch = originalFetch; });

  const queries = [
    `coords=${encodeURIComponent('-181,41.6;-86.8,41.7')}`,
    `coords=${encodeURIComponent('-86.7,41.6')}`,
    `coords=${encodeURIComponent('-86.7,41.6;-86.8,41.7')}&coords=x`,
    `coords=${encodeURIComponent('-86.7,41.6;-86.8,41.7')}&profile=walking`,
    `coords=${encodeURIComponent(Array.from({ length: 14 }, (_, i) => `-86.${i},41.6`).join(';'))}`,
  ];
  for (const query of queries) {
    const response = await handler(request(query));
    assert.equal(response.status, 400, query);
  }
  assert.equal(calls, 0);
});

test('OSRM proxy fails closed on unusable upstream route data', async (t) => {
  const originalFetch = globalThis.fetch;
  const step = VALID_UPSTREAM.routes[0].legs[0].steps[0];
  const unusable = [
    { code: 'Ok', routes: [{ geometry: { type: 'LineString', coordinates: [['x', 41.6]] } }] },
    { ...VALID_UPSTREAM, routes: [{ ...VALID_UPSTREAM.routes[0], distance: 50_000_001 }] },
    {
      ...VALID_UPSTREAM,
      routes: [{
        ...VALID_UPSTREAM.routes[0],
        legs: [
          { ...VALID_UPSTREAM.routes[0].legs[0], steps: Array.from({ length: 2_501 }, () => step) },
          { ...VALID_UPSTREAM.routes[0].legs[0], steps: Array.from({ length: 2_500 }, () => step) },
        ],
      }],
    },
  ];
  globalThis.fetch = async () => Response.json(unusable.shift());
  t.after(() => { globalThis.fetch = originalFetch; });

  for (let index = 0; index < 3; index += 1) {
    const response = await handler(request(`coords=${encodeURIComponent('-86.7,41.6;-86.8,41.7')}`));
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'Routing provider returned unusable data' });
  }
});

test('OSRM proxy preserves graph no-route outcomes without treating them as provider failures', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ code: 'NoSegment', message: 'Could not find a matching segment' });
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await handler(request(`coords=${encodeURIComponent('-86.7,41.6;-86.8,41.7')}`));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { code: 'NoSegment', routes: [] });
});

test('OSRM proxy rejects an oversized response before JSON parsing', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json(VALID_UPSTREAM, {
    headers: { 'content-length': String(32 * 1024 * 1024 + 1) },
  });
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await handler(request(`coords=${encodeURIComponent('-86.7,41.6;-86.8,41.7')}`));
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'Routing provider returned unusable data' });
});

test('OSRM proxy exposes no upstream internals when the request fails', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('secret upstream detail'); };
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await handler(request(`coords=${encodeURIComponent('-86.7,41.6;-86.8,41.7')}`));
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'Routing provider unavailable' });
});
