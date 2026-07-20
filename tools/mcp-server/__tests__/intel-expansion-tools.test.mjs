import assert from 'node:assert/strict';
import test from 'node:test';
import { makeIntelExpansionTools } from '../tools/intel-expansion.mjs';

function mockClient(overrides = {}) {
  return {
    checkHealth: async () => true,
    get: async (route) => {
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

// ---- get_cyber_threats ----

test('get_cyber_threats fetches all three feeds by default', async () => {
  let fetchedRoutes = [];
  const client = {
    ...mockClient(),
    getAll: async (routes) => {
      fetchedRoutes = routes;
      const map = new Map();
      map.set('/api/cyber-c2', { servers: [{ ip: '1.2.3.4' }, { ip: '5.6.7.8' }] });
      map.set('/api/cyber-iocs', { iocs: [{ indicator: 'evil.com' }] });
      map.set('/api/malware-urls', { urls: [{ url: 'http://bad.example' }] });
      return map;
    },
  };
  const tools = makeIntelExpansionTools(client);
  const result = await tools.get_cyber_threats({});
  assert.ok(fetchedRoutes.includes('/api/cyber-c2'));
  assert.ok(fetchedRoutes.includes('/api/cyber-iocs'));
  assert.ok(fetchedRoutes.includes('/api/malware-urls'));
  assert.ok(result.summary.includes('C2'));
  assert.ok(result.summary.includes('IOC'));
  assert.ok(result.data.c2_servers.length > 0);
  assert.ok(result.data.iocs.length > 0);
  assert.ok(result.data.malware_urls.length > 0);
});

test('get_cyber_threats kind=c2 only fetches c2 route', async () => {
  let fetchedRoutes = [];
  const client = {
    ...mockClient(),
    getAll: async (routes) => {
      fetchedRoutes = routes;
      const map = new Map();
      map.set('/api/cyber-c2', { servers: [{ ip: '9.9.9.9' }] });
      return map;
    },
  };
  const tools = makeIntelExpansionTools(client);
  const result = await tools.get_cyber_threats({ kind: 'c2' });
  assert.deepEqual(fetchedRoutes, ['/api/cyber-c2']);
  assert.equal(result.data.c2_servers.length, 1);
  assert.equal(result.data.iocs.length, 0);
});

test('get_cyber_threats caps arrays at 20', async () => {
  const bigList = Array.from({ length: 50 }, (_, i) => ({ ip: `10.0.0.${i}` }));
  const client = {
    ...mockClient(),
    getAll: async (routes) => {
      const map = new Map();
      map.set('/api/cyber-c2', { servers: bigList });
      map.set('/api/cyber-iocs', { data: [], _mock: true });
      map.set('/api/malware-urls', { data: [], _mock: true });
      return map;
    },
  };
  const tools = makeIntelExpansionTools(client);
  const result = await tools.get_cyber_threats({});
  assert.equal(result.data.c2_servers.length, 20);
});

// ---- get_chokepoint_status ----

test('get_chokepoint_status returns transit list', async () => {
  const client = mockClient({
    '/api/chokepoint-transits': {
      transits: [
        { name: 'Strait of Hormuz', trade_tons: 1000000 },
        { name: 'Suez Canal', trade_tons: 800000 },
      ],
    },
  });
  const tools = makeIntelExpansionTools(client);
  const result = await tools.get_chokepoint_status();
  assert.ok(result.summary.includes('2 chokepoint'));
  assert.ok(result.summary.includes('Hormuz'));
  assert.equal(result.data.transits.length, 2);
  assert.deepEqual(result.sources, ['/api/chokepoint-transits']);
});

test('get_chokepoint_status handles error', async () => {
  const client = mockClient({
    '/api/chokepoint-transits': { error: 'service unavailable' },
  });
  const tools = makeIntelExpansionTools(client);
  const result = await tools.get_chokepoint_status();
  assert.ok(result.warnings.length > 0);
  assert.equal(result.data.transits.length, 0);
});

// ---- get_internet_outages ----

test('get_internet_outages uses default hours=24', async () => {
  let capturedParams;
  const client = {
    ...mockClient(),
    get: async (route, params) => {
      capturedParams = params;
      return { alerts: [{ id: 'out-1', country: 'US' }] };
    },
  };
  const tools = makeIntelExpansionTools(client);
  const result = await tools.get_internet_outages({});
  assert.equal(capturedParams.hours, 24);
  assert.ok(result.summary.includes('1 internet outage'));
});

test('get_internet_outages accepts custom hours', async () => {
  let capturedParams;
  const client = {
    ...mockClient(),
    get: async (route, params) => { capturedParams = params; return { alerts: [] }; },
  };
  const tools = makeIntelExpansionTools(client);
  await tools.get_internet_outages({ hours: 48 });
  assert.equal(capturedParams.hours, 48);
});

// ---- get_space_weather_extra ----

test('get_space_weather_extra surfaces aurora and flare data', async () => {
  const client = mockClient({
    '/api/spaceweather-extra': {
      aurora_max_pct: 72,
      high_lat_flag: true,
      flare_probability_regions: [{ region: 'AR3456', probability: 0.45 }],
    },
  });
  const tools = makeIntelExpansionTools(client);
  const result = await tools.get_space_weather_extra();
  assert.ok(result.summary.includes('72%'));
  assert.ok(result.summary.includes('high-latitude'));
  assert.equal(result.data.aurora_max_pct, 72);
  assert.equal(result.data.high_lat_flag, true);
  assert.equal(result.data.flare_probability_regions.length, 1);
});

test('get_space_weather_extra handles empty response', async () => {
  const client = mockClient({ '/api/spaceweather-extra': {} });
  const tools = makeIntelExpansionTools(client);
  const result = await tools.get_space_weather_extra();
  assert.ok(result.summary.includes('No extended space weather'));
});

// ---- get_pharma_supply ----

test('get_pharma_supply combines shortages and recalls', async () => {
  let routes = [];
  const client = {
    ...mockClient(),
    get: async (route, params) => {
      routes.push(route);
      if (route === '/api/pharma-shortages') return { shortages: [{ drug: 'Amoxicillin' }, { drug: 'Lidocaine' }] };
      if (route === '/api/recalls') return { recalls: [{ product: 'Metformin lot X' }] };
      return {};
    },
  };
  const tools = makeIntelExpansionTools(client);
  const result = await tools.get_pharma_supply();
  assert.ok(routes.includes('/api/pharma-shortages'));
  assert.ok(routes.includes('/api/recalls'));
  assert.ok(result.summary.includes('2 shortage'));
  assert.ok(result.summary.includes('1 drug recall'));
  assert.equal(result.data.shortages.length, 2);
  assert.equal(result.data.recalls.length, 1);
});

// ---- get_grid_outages ----

test('get_grid_outages sorts by metersAffected descending', async () => {
  const client = mockClient({
    '/api/grid-outages': {
      counties: [
        { county: 'Wayne', metersAffected: 500 },
        { county: 'Lake', metersAffected: 12000 },
        { county: 'Cook', metersAffected: 3000 },
      ],
    },
  });
  const tools = makeIntelExpansionTools(client);
  const result = await tools.get_grid_outages();
  assert.equal(result.data.counties[0].county, 'Lake');
  assert.ok(result.summary.includes('3 county'));
  assert.ok(result.summary.includes('15,500'));
});

// ---- get_disaster_activations ----

test('get_disaster_activations returns activations', async () => {
  const client = mockClient({
    '/api/ems-activations': {
      activations: [
        { id: 'EMSN001', event: 'Flood', country: 'Pakistan' },
        { id: 'EMSN002', event: 'Earthquake', country: 'Turkey' },
      ],
    },
  });
  const tools = makeIntelExpansionTools(client);
  const result = await tools.get_disaster_activations();
  assert.ok(result.summary.includes('2 disaster activation'));
  assert.equal(result.data.activations.length, 2);
  assert.deepEqual(result.sources, ['/api/ems-activations']);
});

// ---- lookup_entity ----

test('lookup_entity passes name param and returns results', async () => {
  let capturedParams;
  const client = {
    ...mockClient(),
    get: async (route, params) => {
      capturedParams = params;
      return {
        data: [
          { lei: '549300TRUWO2CD2G5692', name: 'Apple Inc.', jurisdiction: 'US-DE' },
        ],
      };
    },
  };
  const tools = makeIntelExpansionTools(client);
  const result = await tools.lookup_entity({ name: 'Apple Inc' });
  assert.equal(capturedParams.name, 'Apple Inc');
  assert.ok(result.summary.includes('"Apple Inc"'));
  assert.ok(result.summary.includes('1 result'));
  assert.equal(result.data.results[0].lei, '549300TRUWO2CD2G5692');
});

// ---- get_aviation_hazards ----

test('get_aviation_hazards combines sigmets and ground stops', async () => {
  let routes = [];
  const client = {
    ...mockClient(),
    get: async (route) => {
      routes.push(route);
      if (route === '/api/aviation-hazards') return { sigmets: [{ id: 'WSUS31', type: 'TS' }] };
      if (route === '/api/faa-nas-status') return { ground_stops: [{ airport: 'KJFK', reason: 'WX' }] };
      return {};
    },
  };
  const tools = makeIntelExpansionTools(client);
  const result = await tools.get_aviation_hazards();
  assert.ok(routes.includes('/api/aviation-hazards'));
  assert.ok(routes.includes('/api/faa-nas-status'));
  assert.ok(result.summary.includes('1 SIGMET'));
  assert.ok(result.summary.includes('1 FAA NAS'));
  assert.equal(result.data.sigmets.length, 1);
  assert.equal(result.data.ground_stops.length, 1);
});

// ---- get_fx_rates ----

test('get_fx_rates defaults base to USD', async () => {
  let capturedParams;
  const client = {
    ...mockClient(),
    get: async (route, params) => {
      capturedParams = params;
      return { base: 'USD', date: '2026-07-01', rates: { EUR: 0.92, GBP: 0.79 } };
    },
  };
  const tools = makeIntelExpansionTools(client);
  const result = await tools.get_fx_rates({});
  assert.equal(capturedParams.base, 'USD');
  assert.ok(result.summary.includes('USD'));
  assert.ok(result.summary.includes('2 currency pair'));
  assert.equal(result.data.rates.EUR, 0.92);
});

test('get_fx_rates passes custom base and symbols', async () => {
  let capturedParams;
  const client = {
    ...mockClient(),
    get: async (route, params) => {
      capturedParams = params;
      return { base: 'EUR', rates: { USD: 1.09 } };
    },
  };
  const tools = makeIntelExpansionTools(client);
  await tools.get_fx_rates({ base: 'EUR', symbols: 'USD' });
  assert.equal(capturedParams.base, 'EUR');
  assert.equal(capturedParams.symbols, 'USD');
});

// ---- get_geo_events ----

test('get_geo_events passes query and timespan params', async () => {
  let capturedParams;
  const client = {
    ...mockClient(),
    get: async (route, params) => {
      capturedParams = params;
      return { events: [{ id: 1, lat: 25.0, lon: 55.0 }, { id: 2, lat: 26.0, lon: 56.0 }] };
    },
  };
  const tools = makeIntelExpansionTools(client);
  const result = await tools.get_geo_events({ query: 'Taiwan strait', timespan: 120 });
  assert.equal(capturedParams.query, 'Taiwan strait');
  assert.equal(capturedParams.timespan, 120);
  assert.ok(result.summary.includes('"Taiwan strait"'));
  assert.ok(result.summary.includes('2 result'));
});

test('get_geo_events uses default timespan of 60', async () => {
  let capturedParams;
  const client = {
    ...mockClient(),
    get: async (route, params) => { capturedParams = params; return { events: [] }; },
  };
  const tools = makeIntelExpansionTools(client);
  await tools.get_geo_events({ query: 'oil spill' });
  assert.equal(capturedParams.timespan, 60);
});

// ---- get_radiation ----

test('get_radiation returns station list with max dose', async () => {
  const client = mockClient({
    '/api/radiation-grid': {
      stations: [
        { name: 'Berlin', gamma_dose: 110 },
        { name: 'Munich', gamma_dose: 95 },
        { name: 'Hamburg', gamma_dose: 120 },
      ],
    },
  });
  const tools = makeIntelExpansionTools(client);
  const result = await tools.get_radiation();
  assert.ok(result.summary.includes('3 station'));
  assert.ok(result.summary.includes('120 nSv/h'));
  assert.equal(result.data.stations.length, 3);
  assert.deepEqual(result.sources, ['/api/radiation-grid']);
});

test('get_radiation handles error gracefully', async () => {
  const client = mockClient({ '/api/radiation-grid': { error: 'timeout' } });
  const tools = makeIntelExpansionTools(client);
  const result = await tools.get_radiation();
  assert.ok(result.warnings.includes('timeout'));
  assert.equal(result.data.stations.length, 0);
});
