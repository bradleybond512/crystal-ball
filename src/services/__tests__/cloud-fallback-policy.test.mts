import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  COORDINATE_LIST_PARAMS,
  COORDINATE_PARAMS,
  NEUTRAL_PARAMS,
  PERSONAL_PARAMS,
  mayFallBack,
  prepareCloudTarget,
  roundCoordinate,
} from '../cloud-fallback-policy.ts';

test('falls back only on a connection failure or a 5xx', () => {
  assert.equal(mayFallBack({ kind: 'connection' }), true);
  for (const status of [500, 502, 503, 504, 599]) assert.equal(mayFallBack({ kind: 'http', status }), true, `${status}`);
  for (const status of [200, 204, 301, 304, 400, 401, 403, 404, 409, 422, 429, 499, 600]) {
    assert.equal(mayFallBack({ kind: 'http', status }), false, `${status}`);
  }
  assert.equal(mayFallBack({ kind: 'caller-abort' }), false);
});

test('coordinates are rounded to 2 decimals (about 1 km)', () => {
  assert.equal(roundCoordinate('41.61234567'), '41.61');
  assert.equal(roundCoordinate('-86.72891'), '-86.73');
  assert.equal(roundCoordinate('-0.001'), '0.00');
  assert.equal(roundCoordinate('+12'), '12.00');
  assert.equal(roundCoordinate('.5'), '0.50');
  for (const bad of ['', 'abc', '1e3', '41.6,86.7', 'NaN', 'Infinity', '181', '-180.5', '0x10']) {
    assert.equal(roundCoordinate(bad), null, bad);
  }
  const decision = prepareCloudTarget('/api/weather/local-forecast?lat=41.6123456&lon=-86.7289&days=3');
  assert.deepEqual(decision, { ok: true, target: '/api/weather/local-forecast?lat=41.61&lon=-86.73&days=3' });
  assert.deepEqual(
    prepareCloudTarget('/api/sat/v1/list?sw_lat=41.1111&sw_lon=-87.2222&ne_lat=42.3333&ne_lon=-86.4444&bbox=-87.123,41.456,-86.789,42.012'),
    { ok: true, target: '/api/sat/v1/list?sw_lat=41.11&sw_lon=-87.22&ne_lat=42.33&ne_lon=-86.44&bbox=-87.12%2C41.46%2C-86.79%2C42.01' },
  );
  assert.equal(prepareCloudTarget('/api/x?Latitude=41.6123').ok, true, 'case-insensitive coordinate names');
  assert.deepEqual(prepareCloudTarget('/api/x?lat=near-home'), { ok: false, reason: 'coordinate:lat' });
  assert.deepEqual(prepareCloudTarget('/api/x?bbox=1,2,x,4'), { ok: false, reason: 'coordinate:bbox' });
});

test('saved-place names, watchlist terms, routes and lookups never leave the machine', () => {
  const personal = [
    '/api/geonames-search?q=Mom%27s%20house',
    '/api/signal-watch?q=my%20watchlist%20term',
    '/api/entity-lei?name=Acme',
    '/api/gdelt-geo?query=La%20Porte',
    '/api/directions/json?origin=home&destination=work',
    '/api/osrm-route?coords=-86.7,41.6;-87.6,41.8',
    '/api/security/breaches?q=me%40example.com',
    '/api/ipinfo-lookup?ip=203.0.113.9',
    '/api/little-snitch-enrich?value=example.com',
    '/api/geonames?city=La%20Porte',
    '/api/x?limit=5&Q=term',
  ];
  for (const target of personal) {
    const decision = prepareCloudTarget(target);
    assert.equal(decision.ok, false, target);
    assert.match((decision as { reason: string }).reason, /^personal:/, target);
  }
});

test('unknown parameters, request bodies and non-GET methods stay local (fail-closed)', () => {
  assert.deepEqual(prepareCloudTarget('/api/new-feed?home_label=Mom'), { ok: false, reason: 'unclassified:home_label' });
  assert.deepEqual(prepareCloudTarget('/api/x?LIMIT=5'), { ok: false, reason: 'unclassified:LIMIT' }, 'neutral names are exact');
  assert.deepEqual(prepareCloudTarget('/api/x', 'POST'), { ok: false, reason: 'request-body' });
  assert.deepEqual(prepareCloudTarget('/api/x', 'GET', true), { ok: false, reason: 'request-body' });
  assert.deepEqual(prepareCloudTarget('/api/x', 'delete'), { ok: false, reason: 'request-body' });
  assert.deepEqual(prepareCloudTarget('/api/points/41.6123,-86.7289'), { ok: false, reason: 'path-coordinates' });
  assert.deepEqual(prepareCloudTarget('/api/points/41.6123%2C-86.7289'), { ok: false, reason: 'path-coordinates' });
  assert.deepEqual(prepareCloudTarget('https://evil.example/api/x'), { ok: false, reason: 'not-an-api-path' });
});

test('neutral requests pass unchanged and HEAD is allowed', () => {
  assert.deepEqual(prepareCloudTarget('/api/rss-proxy?url=https%3A%2F%2Ffeeds.bbci.co.uk%2Fnews%2Frss.xml'), {
    ok: true,
    target: '/api/rss-proxy?url=https%3A%2F%2Ffeeds.bbci.co.uk%2Fnews%2Frss.xml',
  });
  assert.deepEqual(prepareCloudTarget('/api/gdacs', 'HEAD'), { ok: true, target: '/api/gdacs' });
  assert.deepEqual(prepareCloudTarget('/api/gdacs#frag'), { ok: true, target: '/api/gdacs' });
});

test('the classification sets are disjoint', () => {
  const lower = (set: ReadonlySet<string>) => new Set([...set].map((name) => name.toLowerCase()));
  const personal = lower(PERSONAL_PARAMS);
  const coordinates = new Set([...lower(COORDINATE_PARAMS), ...lower(COORDINATE_LIST_PARAMS)]);
  for (const name of NEUTRAL_PARAMS) {
    assert.equal(personal.has(name.toLowerCase()), false, `${name} is both neutral and personal`);
    assert.equal(coordinates.has(name.toLowerCase()), false, `${name} is both neutral and a coordinate`);
  }
  for (const name of coordinates) assert.equal(personal.has(name), false, `${name} is both coordinate and personal`);
});
