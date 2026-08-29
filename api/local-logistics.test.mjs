import test from 'node:test';
import assert from 'node:assert/strict';

import handler from './local-logistics.js';

const request = (query = '', init = {}) => new Request(
  `https://crystalball.app/api/local-logistics${query}`,
  { headers: { origin: 'https://crystalball.app' }, ...init },
);

const sessionRequest = (body, init = {}) => request('', {
  method: 'POST',
  headers: { origin: 'https://crystalball.app', 'content-type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
  ...init,
});

const validSessionBody = (overrides = {}) => ({
  schemaVersion: 1,
  purpose: 'session-lifelines',
  latitude: 41.881832,
  longitude: -87.623177,
  radiusKm: 10,
  categories: ['fuel'],
  limitPerCategory: 3,
  ...overrides,
});

function osmResponse(elements = []) {
  return new Response(JSON.stringify({ elements }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function femaResponse(features = []) {
  return new Response(JSON.stringify({ features }), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('local logistics accepts GET, strict session POST, and OPTIONS only', async () => {
  const put = await handler(request('', { method: 'PUT' }));
  assert.equal(put.status, 405);
  assert.equal(put.headers.get('allow'), 'GET, POST, OPTIONS');
  assert.equal(put.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await put.json(), { error: 'method_not_allowed' });
  assert.equal((await handler(request('', { method: 'OPTIONS' }))).status, 204);
});

test('session POST keeps coordinates in its bounded body and returns no-store facility plus outage evidence', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const value = String(url);
    calls.push({ value, body: String(options?.body ?? '') });
    if (value.includes('overpass-api.de')) return osmResponse([
      { type: 'node', id: 77, lat: 41.88, lon: -87.62, tags: { amenity: 'fuel', name: 'Session Fuel' } },
    ]);
    if (value.includes('geocoding.geo.census.gov')) return Response.json({
      result: { geographies: { Counties: [{ GEOID: '17031' }] } },
    });
    if (value.includes('openenergyhub.ornl.gov')) return Response.json({
      total_count: 1,
      results: [{ communitydescriptor: '17031', county: 'Cook', state: 'Illinois', metersaffected: 12, name: 'ComEd' }],
    });
    throw new Error(`unexpected URL ${url}`);
  };
  try {
    const response = await handler(sessionRequest(validSessionBody()));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const body = await response.json();
    assert.deepEqual(body.query, { radiusKm: 10, categories: ['fuel'] });
    assert.equal(JSON.stringify(body).includes('41.881832'), false);
    assert.equal(JSON.stringify(body).includes('-87.623177'), false);
    assert.equal(body.sites[0].name, 'Session Fuel');
    assert.equal(body.areaConditions.length, 1);
    assert.equal(body.areaConditions[0].countyFips, '17031');
    const odin = body.providers.find((provider) => provider.id === 'ornl-odin');
    assert.deepEqual([odin.state, odin.acceptedRows, odin.droppedRows], ['ok', 1, 0]);
    assert.ok(calls.every((call) => !call.value.includes('41.881832') || call.value.includes('geocoding.geo.census.gov')));
  } finally { globalThis.fetch = originalFetch; }
});

test('session POST gives ODIN rows without utility IDs deterministic unique bounded IDs and truthful counts', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.includes('overpass-api.de')) return osmResponse([
      { type: 'node', id: 78, lat: 41.88, lon: -87.62, tags: { amenity: 'fuel', name: 'Session Fuel' } },
    ]);
    if (value.includes('geocoding.geo.census.gov')) return Response.json({
      result: { geographies: { Counties: [{ GEOID: '17033' }] } },
    });
    if (value.includes('openenergyhub.ornl.gov')) return Response.json({
      total_count: 2,
      results: [
        { communitydescriptor: '17033', county: 'Crawford', state: 'Illinois', metersaffected: 12, name: 'Utility North' },
        { communitydescriptor: '17033', county: 'Crawford', state: 'Illinois', metersaffected: 18, name: 'Utility South' },
      ],
    });
    throw new Error(`unexpected URL ${url}`);
  };
  try {
    const response = await handler(sessionRequest(validSessionBody()));
    assert.equal(response.status, 200);
    const body = await response.json();
    const ids = body.areaConditions.map((condition) => condition.id);
    assert.deepEqual(ids, ['ornl-odin:17033:row-1', 'ornl-odin:17033:row-2']);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.every((id) => id.length <= 120));
    const odin = body.providers.find((provider) => provider.id === 'ornl-odin');
    assert.deepEqual([odin.state, odin.acceptedRows, odin.droppedRows], ['ok', 2, 0]);
    assert.equal(odin.acceptedRows, body.areaConditions.length);
  } finally { globalThis.fetch = originalFetch; }
});

test('session POST strips anchor-derived distances from the wire while saved-place GET preserves them', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.includes('overpass-api.de')) return osmResponse([
      { type: 'node', id: 89, lat: 35.01, lon: -90.01, tags: { amenity: 'fuel', name: 'Nearby Fuel' } },
    ]);
    if (value.includes('geocoding.geo.census.gov')) return Response.json({
      result: { geographies: { Counties: [] } },
    });
    throw new Error(`unexpected URL ${url}`);
  };
  try {
    const sessionResponse = await handler(sessionRequest(validSessionBody({ latitude: 35, longitude: -90 })));
    assert.equal(sessionResponse.status, 200);
    const sessionBody = await sessionResponse.json();
    assert.equal(sessionBody.sites.length, 1);
    assert.equal(sessionBody.nodes.length, 1);
    assert.equal(JSON.stringify(sessionBody).includes('"distanceKm"'), false,
      'session wire body must contain no anchor-derived distance field');

    const savedResponse = await handler(request('?lat=35&lon=-90&radiusKm=10&categories=fuel&limitPerCategory=3'));
    assert.equal(savedResponse.status, 200);
    const savedBody = await savedResponse.json();
    assert.equal(typeof savedBody.sites[0].distanceKm, 'number');
    assert.equal(savedBody.nodes[0].distanceKm, savedBody.sites[0].distanceKm);
  } finally { globalThis.fetch = originalFetch; }
});

test('session POST rejects a disallowed origin with the exact private error envelope', async () => {
  const response = await handler(new Request('https://crystalball.app/api/local-logistics', {
    method: 'POST',
    headers: { origin: 'https://attacker.example', 'content-type': 'application/json' },
    body: JSON.stringify(validSessionBody()),
  }));
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), { error: 'origin_not_allowed' });
});

test('session POST reports ODIN failure as a partial otherwise-usable result', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.includes('overpass-api.de')) return osmResponse([
      { type: 'node', id: 79, lat: 41.88, lon: -87.62, tags: { amenity: 'fuel', name: 'Available Fuel' } },
    ]);
    if (value.includes('geocoding.geo.census.gov')) return Response.json({
      result: { geographies: { Counties: [{ GEOID: '01001' }] } },
    });
    if (value.includes('openenergyhub.ornl.gov')) return Response.json({ error: 'unavailable' }, { status: 503 });
    throw new Error(`unexpected URL ${url}`);
  };
  try {
    const response = await handler(sessionRequest(validSessionBody()));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.sites.length, 1);
    assert.equal(body.partial, true);
    const odin = body.providers.find((provider) => provider.id === 'ornl-odin');
    assert.deepEqual([odin.state, odin.acceptedRows, odin.droppedRows], ['error', 0, 0]);
  } finally { globalThis.fetch = originalFetch; }
});

test('session POST rejects malformed schemas, duplicate categories, wrong media, and bodies above 2048 bytes without fetching', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('must not fetch'); };
  try {
    const invalidBodies = [
      '{',
      JSON.stringify(validSessionBody({ categories: [] })),
      JSON.stringify(validSessionBody({ categories: ['fuel', 'fuel'] })),
      JSON.stringify(validSessionBody({ extra: true })),
      JSON.stringify(validSessionBody({ latitude: '41.8' })),
      JSON.stringify(validSessionBody({ radiusKm: 7 })),
    ];
    for (const body of invalidBodies) {
      const response = await handler(sessionRequest(body));
      assert.equal(response.status, 400, body);
      assert.deepEqual(await response.json(), { error: 'invalid_request' });
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
    }
    const wrongMedia = await handler(sessionRequest(validSessionBody(), {
      headers: { origin: 'https://crystalball.app', 'content-type': 'text/plain' },
    }));
    assert.equal(wrongMedia.status, 415);
    assert.deepEqual(await wrongMedia.json(), { error: 'unsupported_media_type' });
    assert.equal(wrongMedia.headers.get('cache-control'), 'private, no-store');

    const oversized = await handler(sessionRequest('x'.repeat(2049)));
    assert.equal(oversized.status, 413);
    assert.deepEqual(await oversized.json(), { error: 'body_too_large' });
    assert.equal(oversized.headers.get('cache-control'), 'private, no-store');
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('session POST maps total facility failure to a coordinate-free no-store error', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('provider unavailable at 41.881832'); };
  try {
    const response = await handler(sessionRequest(validSessionBody()));
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await response.json(), { error: 'upstream_failed' });
  } finally { globalThis.fetch = originalFetch; }
});

test('session POST reports county_fips_unknown without querying ODIN outside US coverage', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('overpass-api.de')) return osmResponse([
      { type: 'node', id: 88, lat: 0, lon: 0, tags: { amenity: 'fuel', name: 'Zero Fuel' } },
    ]);
    throw new Error(`unexpected URL ${url}`);
  };
  try {
    const response = await handler(sessionRequest(validSessionBody({ latitude: 0, longitude: 0 })));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.areaConditions, []);
    const odin = body.providers.find((provider) => provider.id === 'ornl-odin');
    assert.deepEqual(
      [odin.state, odin.acceptedRows, odin.droppedRows, odin.reasonCode],
      ['error', 0, 0, 'county_fips_unknown'],
    );
    assert.equal(calls.some((url) => url.includes('openenergyhub.ornl.gov')), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('local logistics validates coordinates, ranges, integer limits, categories, and rejects caller county FIPS', async () => {
  for (const query of ['', '?lat=91&lon=0', '?lat=0&lon=-181', '?lat=1x&lon=2', '?lat=0&lon=0&radiusKm=0', '?lat=0&lon=0&radiusKm=2x', '?lat=0&lon=0&limitPerCategory=1.5', '?lat=0&lon=0&categories=', '?lat=0&lon=0&categories=fuel,evil', '?lat=0&lon=0&extra=x', '?lat=0&lat=1&lon=0']) {
    assert.equal((await handler(request(query))).status, 400, query);
  }
});

test('local logistics rejects caller county FIPS before any provider request', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('must not fetch'); };
  try {
    const response = await handler(request('?lat=41.6&lon=-86.72&categories=fuel&countyFips=06037'));
    assert.equal(response.status, 400);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('schema v2 uses one combined Overpass request, keeps directory state unknown, and strips arbitrary OSM websites', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), method: options?.method, body: String(options?.body || ''), maxResponseBytes: options?.maxResponseBytes });
    if (String(url).includes('overpass')) return osmResponse([
      { type: 'node', id: 42, lat: 0, lon: 0, tags: { tourism: 'hotel', name: 'Hotel Zero', opening_hours: '24/7', website: 'javascript:alert(1)', phone: '+1 555 0100', 'addr:housenumber': '1', 'addr:street': 'Prime Meridian' } },
      { type: 'way', id: 43, center: { lat: 0.01, lon: 0.01 }, tags: { amenity: 'fuel', name: 'Fuel Stop', emergency: 'yes' } },
    ]);
    throw new Error(`unexpected URL ${url}`);
  };
  try {
    const response = await handler(request('?lat=0&lon=0&categories=hotel,fuel&limitPerCategory=5'));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.schemaVersion, 2);
    assert.deepEqual(body.query, { lat: 0, lon: 0, radiusKm: 25, categories: ['hotel', 'fuel'] });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^https:\/\/overpass-api\.de\/api\/interpreter$/);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].maxResponseBytes, 8 * 1024 * 1024);
    assert.match(calls[0].body, /tourism"="hotel/);
    assert.match(calls[0].body, /amenity"="fuel/);
    assert.match(calls[0].body, /\[maxsize:67108864\]/);
    assert.equal(body.sites.length, 2);
    assert.equal(body.observations.length, 2);
    const hotel = body.sites.find((site) => site.kind === 'hotel');
    assert.equal(hotel.lat, 0);
    assert.equal(hotel.capabilities.directoryHours, '24/7');
    assert.equal(hotel.publicPhone, '+1 555 0100');
    assert.equal(hotel.directoryUrl, 'https://www.openstreetmap.org/node/42');
    assert.doesNotMatch(JSON.stringify(hotel), /javascript:/);
    const hotelObs = body.observations.find((obs) => obs.siteId === hotel.id);
    assert.deepEqual([hotelObs.operational, hotelObs.inventory, hotelObs.power, hotelObs.access], ['unknown', 'unknown', 'unknown', 'unknown']);
    assert.equal(hotelObs.verification, 'directory');
    assert.ok(body.nodes.every((node) => node.status === 'unknown'));
    assert.deepEqual(body.providers.map((p) => [p.id, p.state, p.acceptedRows]), [['osm', 'ok', 2]]);
    assert.equal(body.partial, false);
  } finally { globalThis.fetch = originalFetch; }
});

test('Overpass responses above the explicit row cap fail closed and are not reported healthy', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('overpass')) return osmResponse(Array.from({ length: 5_001 }, (_, id) => ({
      type: 'node', id, lat: 41.6, lon: -86.72, tags: { amenity: 'fuel' },
    })));
    throw new Error(`unexpected URL ${url}`);
  };
  try {
    const response = await handler(request('?lat=41.6&lon=-86.72&categories=fuel'));
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.deepEqual(body.providers.map((provider) => [provider.id, provider.state, provider.acceptedRows]), [
      ['osm', 'error', 0],
    ]);
  } finally { globalThis.fetch = originalFetch; }
});

test('Overpass timeout remains armed while a response body stalls', async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = AbortSignal.timeout;
  AbortSignal.timeout = () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 1);
    return controller.signal;
  };
  globalThis.fetch = async (url, options) => {
    if (!String(url).includes('overpass')) throw new Error(`unexpected URL ${url}`);
    return new Response(new ReadableStream({
      start(controller) {
        options.signal.addEventListener('abort', () => controller.error(new Error('aborted body')), { once: true });
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const response = await handler(request('?lat=41.6&lon=-86.72&categories=fuel'));
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally {
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = originalTimeout;
  }
});

test('FEMA open shelter fields are allowlisted, live, bounded, and deduplicate nearby OSM shelter', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('overpass')) return osmResponse([{ type: 'node', id: 7, lat: 41.6, lon: -86.72, tags: { amenity: 'shelter', name: 'Civic Center Shelter', website: 'https://untrusted.invalid' } }]);
    if (String(url).includes('gis.fema.gov')) {
      assert.equal(options.maxResponseBytes, 2 * 1024 * 1024);
      return femaResponse([{ attributes: { objectid: 99, shelter_id: 1001, shelter_name: 'Civic Center Shelter', address: '101 Main St', city: 'La Porte', state: 'IN', zip: '46350', shelter_status: 'Open', evacuation_capacity: 250, post_impact_capacity: 150, total_population: 42, hours_open: '08:00', hours_close: '22:00', org_name: 'County EMA', ada_compliant: 'Yes', wheelchair_accessible: 'Yes', pet_accommodations_code: 'Yes', latitude: 41.6001, longitude: -86.7201, poc_name: 'PRIVATE PERSON', poc_email: 'private@example.com', generator_onsite: 'Yes' }, geometry: { x: -86.7201, y: 41.6001 } }]);
    }
    throw new Error(`unexpected URL ${url}`);
  };
  try {
    const response = await handler(request('?lat=41.6&lon=-86.72&radiusKm=10&categories=shelter'));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.sites.length, 1);
    assert.equal(new Set(body.sites.map((candidate) => candidate.id)).size, body.sites.length);
    const [site] = body.sites;
    assert.equal(site.sourceRefs[0].provider, 'fema');
    assert.equal(site.capabilities.evacuationCapacity, 250);
    assert.equal(site.capabilities.reportedPopulation, 42);
    assert.equal(site.capabilities.ada, true);
    assert.equal(site.capabilities.wheelchairAccessible, true);
    assert.equal(site.capabilities.pets, true);
    assert.equal(site.capabilities.generatorOnsite, undefined);
    assert.doesNotMatch(JSON.stringify(site), /PRIVATE PERSON|private@example\.com/);
    const [observation] = body.observations;
    assert.equal(observation.operational, 'open');
    assert.equal(observation.inventory, 'unknown');
    assert.equal(observation.verification, 'official');
    assert.equal(observation.provider, 'fema');
    assert.equal(body.providers.length, 2);
    assert.deepEqual(
      body.providers.map((provider) => [provider.id, provider.state, provider.acceptedRows, provider.reasonCode]),
      [
        ['osm', 'error', 0, 'no_contributed_rows'],
        ['fema-open-shelters', 'ok', 1, undefined],
      ],
      'a normalized row removed by downstream dedupe must not cast a healthy provider vote',
    );
  } finally { globalThis.fetch = originalFetch; }
});

test('FEMA capacity arithmetic never becomes an availability or full claim', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('overpass')) return osmResponse([]);
    if (String(url).includes('gis.fema.gov')) return femaResponse([
      { attributes: {
        objectid: 100, shelter_name: 'Below Capacity Shelter', shelter_status: 'Open',
        post_impact_capacity: 100, total_population: 10, latitude: 41.6, longitude: -86.72,
      } },
      { attributes: {
        objectid: 101, shelter_name: 'At Capacity Shelter', shelter_status: 'Open',
        post_impact_capacity: 100, total_population: 100, latitude: 41.61, longitude: -86.73,
      } },
    ]);
    throw new Error(`unexpected URL ${url}`);
  };
  try {
    const response = await handler(request('?lat=41.6&lon=-86.72&radiusKm=10&categories=shelter'));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.observations.length, 2);
    assert.ok(body.observations.every((observation) => observation.inventory === 'unknown'));
  } finally { globalThis.fetch = originalFetch; }
});

test('FEMA recovery centers stay distinct from shelters and expose only allowlisted official fields', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/FEMA/DRC_Services_Relate/FeatureServer/0/query')) {
      return femaResponse([
        { attributes: {
          objectid: 3289203,
          drc_id: 51464,
          drc_name: 'County Assistance Center',
          drc_num: '1',
          street_1: '101 Main St',
          street_2: 'Room 2',
          city: 'La Porte',
          state: 'IN',
          zip: '46350',
          days_open: 'Mon-Sat',
          hours: '08:00-18:00',
          status: 'Open',
          latitude: 41.6001,
          longitude: -86.7201,
          last_report_date: Date.parse('2026-08-14T12:30:00.000Z'),
          notes: 'PRIVATE CASE DETAILS',
          email: 'private@example.com',
        }, geometry: { x: -86.7201, y: 41.6001 } },
        { attributes: {
          objectid: 3289204,
          drc_id: 51465,
          drc_name: 'Closed Center',
          status: 'Closed',
          latitude: 41.61,
          longitude: -86.73,
        } },
      ]);
    }
    throw new Error(`unexpected URL ${url}`);
  };
  try {
    const response = await handler(request('?lat=41.6&lon=-86.72&radiusKm=10&categories=recovery'));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(calls.some((url) => url.includes('overpass')), false,
      'recovery-only lookup must not send an empty query to Overpass');
    const femaUrl = new URL(calls.find((url) => url.includes('gis.fema.gov')));
    assert.equal(femaUrl.hostname, 'gis.fema.gov');
    assert.equal(femaUrl.pathname, '/arcgis/rest/services/FEMA/DRC_Services_Relate/FeatureServer/0/query');
    assert.equal(femaUrl.searchParams.get('geometry'), '-86.72,41.6');
    assert.equal(femaUrl.searchParams.get('distance'), '10');
    assert.equal(femaUrl.searchParams.get('where'), "status = 'Open'");
    assert.doesNotMatch(femaUrl.searchParams.get('outFields') ?? '', /notes|email/i);
    assert.equal(body.query.categories[0], 'recovery');
    assert.equal(body.sites.length, 1);
    assert.equal(body.sites[0].kind, 'recovery');
    assert.equal(body.sites[0].name, 'County Assistance Center');
    assert.equal(body.sites[0].capabilities.directoryHours, 'Mon-Sat · 08:00-18:00');
    assert.doesNotMatch(JSON.stringify(body.sites[0]), /PRIVATE CASE DETAILS|private@example\.com/);
    assert.deepEqual(
      [body.observations[0].operational, body.observations[0].inventory, body.observations[0].power, body.observations[0].access],
      ['open', 'unknown', 'unknown', 'unknown'],
    );
    assert.equal(body.observations[0].retrievedAt, body.fetchedAt);
    assert.equal(body.retrievedAt, body.fetchedAt);
    assert.equal(body.observations[0].observedAt, body.fetchedAt, 'legacy field remains retrieval time for compatibility');
    assert.equal(body.observations[0].sourceObservedAt, '2026-08-14T12:30:00.000Z');
    assert.deepEqual(
      body.providers.map((provider) => [provider.id, provider.state, provider.acceptedRows, provider.droppedRows]),
      [['fema-recovery-centers', 'ok', 1, 0]],
    );
  } finally { globalThis.fetch = originalFetch; }
});

test('provider failure is partial when another provider succeeds, but total failure is 502 and malformed success is not healthy', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (String(url).includes('overpass')) return osmResponse([]);
      throw new Error('fema unavailable');
    };
    const partialResponse = await handler(request('?lat=41.6&lon=-86.72&categories=shelter'));
    assert.equal(partialResponse.status, 200);
    const partial = await partialResponse.json();
    assert.equal(partial.partial, true);
    assert.deepEqual(partial.providers.map((p) => p.state), ['empty', 'error']);

    globalThis.fetch = async () => new Response(JSON.stringify({ nope: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    const failedResponse = await handler(request('?lat=41.6&lon=-86.72&categories=shelter'));
    assert.equal(failedResponse.status, 502);
    const failed = await failedResponse.json();
    assert.equal(failed.partial, false);
    assert.ok(failed.providers.every((provider) => provider.state === 'error'));
  } finally { globalThis.fetch = originalFetch; }
});

test('a truncated FEMA recovery response fails closed instead of reporting incomplete coverage as healthy', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/FEMA/DRC_Services_Relate/FeatureServer/0/query')) {
      return new Response(JSON.stringify({ features: [], exceededTransferLimit: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  try {
    const response = await handler(request('?lat=41.6&lon=-86.72&categories=recovery'));
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.providers[0].id, 'fema-recovery-centers');
    assert.equal(body.providers[0].state, 'error');
    assert.equal(body.providers[0].acceptedRows, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('FEMA queries request open records and valid closed rows are an honest empty result', async () => {
  const originalFetch = globalThis.fetch;
  let femaUrl = '';
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.includes('overpass')) return osmResponse([]);
    if (value.includes('OpenShelters')) {
      femaUrl = value;
      return femaResponse([{ attributes: {
        objectid: 9, shelter_status: 'Closed', latitude: 41.6, longitude: -86.72,
      } }]);
    }
    if (value.includes('geocoding.geo.census.gov')) return Response.json({
      result: { geographies: { Counties: [{ GEOID: '18091' }] } },
    });
    throw new Error(`unexpected URL ${url}`);
  };
  try {
    const response = await handler(request('?lat=41.6&lon=-86.72&categories=shelter'));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.providers.find((provider) => provider.id === 'fema-open-shelters')?.state, 'empty');
    assert.equal(body.partial, false);
    assert.equal(new URL(femaUrl).searchParams.get('where'), "shelter_status = 'Open'");
  } finally { globalThis.fetch = originalFetch; }
});

test('FEMA and Census JSON bodies enforce source-specific declared and streamed byte caps', async () => {
  const originalFetch = globalThis.fetch;
  const censusOk = () => Response.json({ result: { geographies: { Counties: [{ GEOID: '18091' }] } } });
  try {
    globalThis.fetch = async (url, options) => {
      const value = String(url);
      if (value.includes('overpass')) throw new Error('overpass unavailable');
      if (value.includes('OpenShelters')) {
        assert.equal(options.maxResponseBytes, 2 * 1024 * 1024);
        return new Response(JSON.stringify({ features: [] }), {
          status: 200, headers: { 'content-length': String(2 * 1024 * 1024 + 1) },
        });
      }
      if (value.includes('geocoding.geo.census.gov')) return censusOk();
      throw new Error(`unexpected URL ${url}`);
    };
    assert.equal((await handler(request('?lat=41.6&lon=-86.72&categories=shelter'))).status, 502);

    globalThis.fetch = async (url, options) => {
      const value = String(url);
      if (value.includes('DRC_Services_Relate')) {
        assert.equal(options.maxResponseBytes, 2 * 1024 * 1024);
        return new Response(JSON.stringify({ features: [] }), {
          status: 200, headers: { 'content-length': String(2 * 1024 * 1024 + 1) },
        });
      }
      if (value.includes('geocoding.geo.census.gov')) return censusOk();
      throw new Error(`unexpected URL ${url}`);
    };
    assert.equal((await handler(request('?lat=41.6&lon=-86.72&categories=recovery'))).status, 502);

    globalThis.fetch = async (url, options) => {
      const value = String(url);
      if (value.includes('DRC_Services_Relate')) {
        assert.equal(options.maxResponseBytes, 2 * 1024 * 1024);
        const bytes = new TextEncoder().encode(JSON.stringify({
          features: [], padding: 'x'.repeat(2 * 1024 * 1024),
        }));
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }), { status: 200 });
      }
      if (value.includes('geocoding.geo.census.gov')) return censusOk();
      throw new Error(`unexpected URL ${url}`);
    };
    assert.equal((await handler(request('?lat=41.6&lon=-86.72&categories=recovery'))).status, 502);

    globalThis.fetch = async (url, options) => {
      const value = String(url);
      if (value.includes('overpass')) return osmResponse([]);
      if (value.includes('geocoding.geo.census.gov')) {
        assert.equal(options.maxResponseBytes, 256 * 1024);
        const bytes = new TextEncoder().encode(JSON.stringify({
          result: { geographies: { Counties: [{ GEOID: '18091' }] } },
          padding: 'x'.repeat(256 * 1024),
        }));
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }), { status: 200 });
      }
      throw new Error(`unexpected URL ${url}`);
    };
    const censusBounded = await handler(request('?lat=41.6&lon=-86.72&categories=fuel'));
    assert.equal(censusBounded.status, 200);
    assert.equal((await censusBounded.json()).query.countyFips, undefined);
  } finally { globalThis.fetch = originalFetch; }
});

test('US coordinates resolve county FIPS using the fixed Census coordinate endpoint without sending a place name', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(String(url));
    if (String(url).includes('overpass')) return osmResponse([]);
    if (String(url).includes('geocoding.geo.census.gov')) {
      assert.equal(options.maxResponseBytes, 256 * 1024);
      return new Response(JSON.stringify({
        result: { geographies: { Counties: [{ GEOID: '18091', NAME: 'LaPorte County' }] } },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  try {
    const response = await handler(request('?lat=41.6&lon=-86.72&categories=fuel'));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.query.countyFips, '18091');
    const censusUrl = new URL(calls.find((url) => url.includes('geocoding.geo.census.gov')));
    assert.equal(censusUrl.hostname, 'geocoding.geo.census.gov');
    assert.equal(censusUrl.searchParams.get('x'), '-86.72');
    assert.equal(censusUrl.searchParams.get('y'), '41.6');
    assert.equal(censusUrl.searchParams.has('name'), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('an aborted Overpass primary falls back within the desktop client budget', async () => {
  const originalFetch = globalThis.fetch;
  const delays = [];
  const calls = [];
  const originalTimeout = AbortSignal.timeout;
  AbortSignal.timeout = (delay) => {
    delays.push(delay);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 0);
    return controller.signal;
  };
  globalThis.fetch = async (url, options) => {
    calls.push(String(url));
    if (String(url).startsWith('https://overpass-api.de/')) {
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      });
    }
    if (String(url).startsWith('https://lz4.overpass-api.de/')) return osmResponse([]);
    throw new Error(`unexpected URL ${url}`);
  };
  try {
    const startedAt = Date.now();
    const response = await handler(request('?lat=0&lon=0&categories=fuel'));
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [
      'https://overpass-api.de/api/interpreter',
      'https://lz4.overpass-api.de/api/interpreter',
    ]);
    assert.equal(delays[0], 6_000, 'each attempt must leave time for fallback under the 15s client budget');
    assert.ok(Date.now() - startedAt < 1_000);
  } finally {
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = originalTimeout;
  }
});
