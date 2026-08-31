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

function healthyProbePayload(route) {
  if (route === '/api/acled-events') {
    return { events: [{ event_id_cnty: 'ACLED-1', latitude: 0, longitude: 0 }] };
  }
  if (route === '/api/threatfox-iocs') {
    return [{
      id: 'threatfox-1',
      source: 'threatfox',
      indicator: '198.51.100.1',
      indicatorType: 'ip',
      severity: 'high',
    }];
  }
  if (route === '/api/ais-snapshot') {
    return {
      sequence: 1,
      timestamp: '2026-08-30T00:00:00.000Z',
      status: { connected: true, vessels: 1, messages: 1 },
      disruptions: [],
      density: [],
      candidateReports: [],
    };
  }
  return [{ id: 'validated-row' }];
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
    reasonCode: 'schema',
    action: 'Inspect the local adapter response schema before retrying.',
  });
  assert.deepEqual(result.data.feeds[1], {
    route: '/api/market-quotes',
    status: 'error',
    reasonCode: 'schema',
    action: 'Inspect the local adapter response schema before retrying.',
  });
});

test('check_feed_health classifies explicit missing optional credentials without probing or exposing diagnostics', async () => {
  const probed = [];
  const client = {
    get: async (route) => {
      if (route === '/api/health') {
        return { ok: true, pid: 123, keys_configured: 3, keys_total: 38, keys_missing_count: 35 };
      }
      if (route === '/api/service-status') return { ok: true };
      if (route === '/api/diag') {
        return {
          missing_keys: [
            'ACLED_ACCESS_TOKEN',
            'ACLED_EMAIL',
            'THREATFOX_API_KEY',
            'AISSTREAM_API_KEY',
          ],
          host_stats: { provider: { lastError: 'must-not-leak-sensitive-diagnostic' } },
        };
      }
      return {};
    },
    getAll: async (routes) => {
      probed.push(...routes);
      return new Map(routes.map((route) => [route, []]));
    },
  };

  const result = await makeGranularTools(client).check_feed_health();

  assert.equal(probed.includes('/api/acled-events'), false);
  assert.equal(probed.includes('/api/threatfox-iocs'), false);
  assert.equal(probed.includes('/api/ais-snapshot'), false);
  assert.deepEqual(result.data.feeds.filter((feed) => feed.status === 'not_configured'), [
    {
      route: '/api/acled-events',
      status: 'not_configured',
      reasonCode: 'credential_missing',
      action: 'Configure ACLED_ACCESS_TOKEN and ACLED_EMAIL in Crystal Ball Settings.',
    },
    {
      route: '/api/threatfox-iocs',
      status: 'not_configured',
      reasonCode: 'credential_missing',
      action: 'Configure THREATFOX_API_KEY in Crystal Ball Settings.',
    },
    {
      route: '/api/ais-snapshot',
      status: 'not_configured',
      reasonCode: 'credential_missing',
      action: 'Configure AISSTREAM_API_KEY in Crystal Ball Settings.',
    },
  ]);
  assert.match(result.summary, /3 not configured/);
  assert.equal(result.healthy, false);
  assert.equal(JSON.stringify(result).includes('must-not-leak-sensitive-diagnostic'), false);
});

test('check_feed_health requires every ACLED credential and still probes configured optional feeds', async () => {
  const probed = [];
  const client = {
    get: async (route) => {
      if (route === '/api/health') return { ok: true, pid: 123 };
      if (route === '/api/service-status') return { ok: true };
      if (route === '/api/diag') return { missing_keys: ['ACLED_EMAIL'] };
      return {};
    },
    getAll: async (routes) => {
      probed.push(...routes);
      return new Map(routes.map((route) => [route, healthyProbePayload(route)]));
    },
  };

  const result = await makeGranularTools(client).check_feed_health();

  assert.equal(probed.includes('/api/acled-events'), false);
  assert.equal(probed.includes('/api/threatfox-iocs'), true);
  assert.equal(probed.includes('/api/ais-snapshot'), true);
  assert.equal(result.data.feeds.find((feed) => feed.route === '/api/acled-events').status, 'not_configured');
  assert.equal(result.data.feeds.find((feed) => feed.route === '/api/threatfox-iocs').status, 'ok');
});

test('check_feed_health never guesses configuration state when authenticated diagnostics are malformed', async () => {
  const probed = [];
  const client = {
    get: async (route) => {
      if (route === '/api/health') return { ok: true, pid: 123 };
      if (route === '/api/service-status') return { ok: true };
      if (route === '/api/diag') return { missing_keys: 'ACLED_ACCESS_TOKEN' };
      return {};
    },
    getAll: async (routes) => {
      probed.push(...routes);
      return new Map(routes.map((route) => [route, route === '/api/acled-events'
        ? { status: 503, error: 'must-not-leak-upstream-body' }
        : healthyProbePayload(route)]));
    },
  };

  const result = await makeGranularTools(client).check_feed_health();
  const acled = result.data.feeds.find((feed) => feed.route === '/api/acled-events');

  assert.equal(probed.includes('/api/acled-events'), true);
  assert.deepEqual(acled, {
    route: '/api/acled-events',
    status: 'error',
    reasonCode: 'upstream',
    action: 'Check provider availability and retry after the provider recovers.',
  });
  assert.equal(JSON.stringify(result).includes('must-not-leak-upstream-body'), false);
});

test('check_feed_health classifies structured rate limits and local request failures without parsing error text', async () => {
  const client = {
    get: async (route) => {
      if (route === '/api/health') return { ok: true, pid: 123 };
      if (route === '/api/service-status') return { ok: true };
      if (route === '/api/diag') return { error: 'diagnostics unavailable' };
      return {};
    },
    getAll: async (routes) => new Map(routes.map((route) => {
      if (route === '/api/threatfox-iocs') return [route, { status: 429, error: 'opaque-one' }];
      if (route === '/api/ais-snapshot') return [route, { error: 'opaque-two' }];
      return [route, healthyProbePayload(route)];
    })),
  };

  const result = await makeGranularTools(client).check_feed_health();
  assert.deepEqual(result.data.feeds.find((feed) => feed.route === '/api/threatfox-iocs'), {
    route: '/api/threatfox-iocs',
    status: 'error',
    reasonCode: 'rate_limited',
    action: 'Wait for the provider cooldown before retrying.',
  });
  assert.deepEqual(result.data.feeds.find((feed) => feed.route === '/api/ais-snapshot'), {
    route: '/api/ais-snapshot',
    status: 'error',
    reasonCode: 'local_adapter',
    action: 'Inspect the authenticated local sidecar and retry the feed probe.',
  });
});

test('check_feed_health fails closed when configured ThreatFox contributes zero observations', async () => {
  const client = {
    get: async (route) => {
      if (route === '/api/health') return { ok: true, pid: 123 };
      if (route === '/api/service-status') return { ok: true };
      if (route === '/api/diag') return { missing_keys: [] };
      return {};
    },
    getAll: async (routes) => new Map(routes.map((route) => [
      route,
      route === '/api/threatfox-iocs' ? [] : healthyProbePayload(route),
    ])),
  };

  const result = await makeGranularTools(client).check_feed_health();

  assert.deepEqual(result.data.feeds.find((feed) => feed.route === '/api/threatfox-iocs'), {
    route: '/api/threatfox-iocs',
    status: 'error',
    reasonCode: 'no_observations',
    action: 'Check provider availability and retry after fresh observations are available.',
  });
  assert.equal(result.healthy, false);
});

test('check_feed_health fails closed when configured AIS is disconnected', async () => {
  const client = {
    get: async (route) => {
      if (route === '/api/health') return { ok: true, pid: 123 };
      if (route === '/api/service-status') return { ok: true };
      if (route === '/api/diag') return { missing_keys: [] };
      return {};
    },
    getAll: async (routes) => new Map(routes.map((route) => [
      route,
      route === '/api/ais-snapshot'
        ? { ...healthyProbePayload(route), status: { connected: false, vessels: 0, messages: 0 } }
        : healthyProbePayload(route),
    ])),
  };

  const result = await makeGranularTools(client).check_feed_health();

  assert.deepEqual(result.data.feeds.find((feed) => feed.route === '/api/ais-snapshot'), {
    route: '/api/ais-snapshot',
    status: 'error',
    reasonCode: 'upstream',
    action: 'Check provider availability and retry after the provider recovers.',
  });
});

test('check_feed_health requires optional-provider rows that survive downstream validation', async () => {
  for (const [targetRoute, payload] of [
    ['/api/acled-events', { events: [{ event_id_cnty: 'ACLED-1' }] }],
    ['/api/threatfox-iocs', [{ id: 'threatfox-1', indicator: '' }]],
    [
      '/api/ais-snapshot',
      {
        ...healthyProbePayload('/api/ais-snapshot'),
        status: { connected: true, vessels: 0, messages: 0 },
      },
    ],
  ]) {
    const client = {
      get: async (route) => {
        if (route === '/api/health') return { ok: true, pid: 123 };
        if (route === '/api/service-status') return { ok: true };
        if (route === '/api/diag') return { missing_keys: [] };
        return {};
      },
      getAll: async (routes) => new Map(routes.map((route) => [
        route,
        route === targetRoute ? payload : healthyProbePayload(route),
      ])),
    };

    const result = await makeGranularTools(client).check_feed_health();
    assert.deepEqual(result.data.feeds.find((feed) => feed.route === targetRoute), {
      route: targetRoute,
      status: 'error',
      reasonCode: 'no_observations',
      action: 'Check provider availability and retry after fresh observations are available.',
    });
  }
});

test('check_feed_health maps configured ACLED adapter failures to bounded upstream and rate-limit reasons', async () => {
  async function check(acled) {
    const client = {
      get: async (route) => {
        if (route === '/api/health') return { ok: true, pid: 123 };
        if (route === '/api/service-status') return { ok: true };
        if (route === '/api/diag') return { missing_keys: [] };
        return {};
      },
      getAll: async (routes) => new Map(routes.map((route) => [
        route,
        route === '/api/acled-events' ? acled : healthyProbePayload(route),
      ])),
    };
    const result = await makeGranularTools(client).check_feed_health();
    return result.data.feeds.find((feed) => feed.route === '/api/acled-events');
  }

  assert.deepEqual(await check({ events: [], error: 'sensitive upstream body' }), {
    route: '/api/acled-events',
    status: 'error',
    reasonCode: 'upstream',
    action: 'Check provider availability and retry after the provider recovers.',
  });
  assert.deepEqual(await check({ status: 429, error: 'sensitive rate body' }), {
    route: '/api/acled-events',
    status: 'error',
    reasonCode: 'rate_limited',
    action: 'Wait for the provider cooldown before retrying.',
  });
});
