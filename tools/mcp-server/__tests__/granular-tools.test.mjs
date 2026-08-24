import assert from 'node:assert/strict';
import test from 'node:test';
import { makeGranularTools } from '../tools/granular.mjs';

function mockClient(overrides = {}) {
  return {
    checkHealth: async () => true,
    get: async (route, params) => {
      if (overrides[route]) return overrides[route];
      return { data: [], _mock: true };
    },
    getAll: async (routes) => {
      const map = new Map();
      for (const r of routes) map.set(r, overrides[r] || { data: [], _mock: true });
      return map;
    },
  };
}

test('search_conflicts passes params to acled-events', async () => {
  let capturedRoute;
  const client = {
    ...mockClient(),
    get: async (route, params) => { capturedRoute = route; return { events: [] }; },
  };
  const tools = makeGranularTools(client);
  await tools.search_conflicts({ country: 'Ukraine' });
  assert.equal(capturedRoute, '/api/acled-events');
});

test('lookup_ip combines multiple sources', async () => {
  const client = {
    ...mockClient(),
    get: async (route) => {
      if (route === '/api/greynoise-lookup') return { ip: '1.2.3.4', classification: 'malicious' };
      if (route === '/api/abuseipdb-reports') return { data: { abuseConfidenceScore: 90 } };
      if (route === '/api/ipinfo-lookup') return { city: 'Moscow', country: 'RU' };
      return {};
    },
    getAll: async () => new Map(),
  };
  const tools = makeGranularTools(client);
  const result = await tools.lookup_ip({ ip: '1.2.3.4' });
  assert.ok(result.summary);
  assert.ok(result.data.greynoise);
  assert.ok(result.data.abuseipdb);
  assert.ok(result.data.ipinfo);
});

test('get_region_brief combines geo + conflicts + weather', async () => {
  const tools = makeGranularTools(mockClient({
    '/api/geonames-search': { geonames: [{ name: 'Kyiv', lat: '50.45', lng: '30.52' }] },
    '/api/acled-events': { events: [{ country: 'Ukraine' }] },
    '/api/nws-alerts': [],
    '/api/owm-current': { cities: [] },
  }));
  const result = await tools.get_region_brief({ place_name: 'Kyiv' });
  assert.ok(result.summary);
  assert.ok(result.data.location);
});

test('get_economic_data passes series IDs', async () => {
  let capturedParams;
  const client = {
    ...mockClient(),
    get: async (route, params) => { capturedParams = params; return { observations: [] }; },
  };
  const tools = makeGranularTools(client);
  await tools.get_economic_data({ series_ids: 'FEDFUNDS,WALCL' });
  assert.ok(capturedParams);
  assert.equal(capturedParams.ids, 'FEDFUNDS,WALCL');
});

test('get_earthquakes accepts the live sidecar events response shape', async () => {
  const earthquakes = [{ id: 'us7000-test', magnitude: 6.2, place: 'Test region' }];
  const tools = makeGranularTools(mockClient({
    '/api/usgs-earthquakes': { events: earthquakes },
  }));

  const result = await tools.get_earthquakes({});

  assert.match(result.summary, /Found 1 earthquake/);
  assert.deepEqual(result.data.earthquakes, earthquakes);
});

test('check_feed_health fails closed on malformed health and feed payloads', async () => {
  const tools = makeGranularTools(mockClient({
    '/api/health': {},
    '/api/service-status': {},
    '/api/acled-events': {},
    '/api/market-quotes': { ok: false },
  }));

  const result = await tools.check_feed_health();

  assert.equal(result.healthy, false);
  assert.deepEqual(result.data.sidecar, { error: 'invalid health response' });
  assert.deepEqual(result.data.feeds[0], {
    route: '/api/acled-events',
    status: 'error',
    error: 'invalid response',
  });
  assert.deepEqual(result.data.feeds[1], {
    route: '/api/market-quotes',
    status: 'error',
    error: 'invalid response',
  });
});
