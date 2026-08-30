import assert from 'node:assert/strict';
import test from 'node:test';

import type { EvacRoute } from '../../evacuation-router.ts';
import type { WeatherAlert, WeatherFeedState } from '../../weather.ts';
import {
  canonicalEvacRouteFingerprint,
  createEvacuationHazardExposureStore,
  evaluateEvacuationHazardExposure,
  type EndpointZoneResolution,
} from '../evacuation-hazard-exposure.ts';

const NOW = Date.parse('2026-08-30T02:00:00Z');
const CURRENT_FEED: WeatherFeedState = { mode: 'live', timestamp: NOW - 60_000 };
const COVERED: EndpointZoneResolution = {
  status: 'covered',
  zones: ['INC091', 'INZ103'],
  fields: { forecastZone: 'INZ103', county: 'INC091', fireWeatherZone: 'INZ103' },
  source: 'nws-points',
  retrievedAt: NOW - 30_000,
  validUntil: NOW + 29 * 60_000,
};

function route(coordinates: [number, number][], overrides: Partial<EvacRoute> = {}): EvacRoute {
  return {
    id: 'route-1',
    from: { lat: coordinates[0]![1], lon: coordinates[0]![0], label: 'A', placeRef: null },
    to: { lat: coordinates.at(-1)![1], lon: coordinates.at(-1)![0], label: 'B', placeRef: null },
    distanceKm: 10,
    durationMinutes: 12,
    geometry: { type: 'LineString', coordinates },
    steps: [],
    cachedAt: NOW - 120_000,
    ...overrides,
  };
}

function alert(overrides: Partial<WeatherAlert> = {}): WeatherAlert {
  return {
    id: 'alert-1',
    event: 'Tornado Warning',
    severity: 'Extreme',
    headline: 'Tornado warning',
    description: 'A tornado warning is in effect.',
    areaDesc: 'Test County',
    sent: new Date(NOW - 20 * 60_000),
    effective: new Date(NOW - 15 * 60_000),
    reportedOnset: new Date(NOW - 10 * 60_000),
    onset: new Date(NOW - 10 * 60_000),
    expires: new Date(NOW + 30 * 60_000),
    status: 'Actual',
    messageType: 'Alert',
    coordinates: [],
    geometryStatus: 'absent',
    ugcZones: [],
    ugcStatus: 'complete',
    ...overrides,
  };
}

function square(west: number, south: number, east: number, north: number): [number, number][] {
  return [[west, south], [east, south], [east, north], [west, north], [west, south]];
}

function polygonAlert(
  outer: [number, number][],
  holes: [number, number][][] = [],
  overrides: Partial<WeatherAlert> = {},
): WeatherAlert {
  return alert({
    coordinates: outer,
    polygonAreas: [{ rings: [outer, ...holes] }],
    geometryStatus: 'complete',
    ...overrides,
  });
}

function evaluate(
  evacRoute: EvacRoute,
  alerts: WeatherAlert[],
  endpoints: { from: EndpointZoneResolution; to: EndpointZoneResolution } = { from: COVERED, to: COVERED },
  feedState: WeatherFeedState = CURRENT_FEED,
) {
  return evaluateEvacuationHazardExposure({
    route: evacRoute,
    weather: { alerts, feedState },
    endpoints,
    now: NOW,
  });
}

test('reports polygon exposure when a route segment crosses an alert without a vertex inside', () => {
  const result = evaluate(route([[-2, 0], [2, 0]]), [polygonAlert(square(-1, -1, 1, 1))]);
  assert.equal(result.route.status, 'reported_intersection');
  assert.equal(result.route.evidence?.basis, 'polygon');
  assert.equal(result.route.evidence?.source, 'National Weather Service active alerts');
  assert.equal(result.endpoints.from.status, 'no_reported_intersection');
});

test('counts boundary contact and valid zero longitude/latitude as reported exposure', () => {
  const result = evaluate(route([[-1, 0], [0, 0]]), [polygonAlert(square(0, 0, 1, 1))]);
  assert.equal(result.route.status, 'reported_intersection');
  assert.equal(result.endpoints.to.status, 'reported_intersection');
});

test('subtracts holes while reporting a segment that crosses from a hole into the alert area', () => {
  const warning = polygonAlert(square(-4, -4, 4, 4), [square(-1, -1, 1, 1)]);
  const insideHole = evaluate(route([[-0.5, 0], [0.5, 0]]), [warning]);
  assert.equal(insideHole.route.status, 'unknown');
  assert.equal(insideHole.endpoints.from.status, 'no_reported_intersection');

  const leavesHole = evaluate(route([[0, 0], [2, 0]]), [warning]);
  assert.equal(leavesHole.route.status, 'reported_intersection');
});

test('matches polygons across the antimeridian without treating the long way around as inside', () => {
  const dateline = polygonAlert([[179, -2], [-179, -2], [-179, 2], [179, 2], [179, -2]]);
  assert.equal(evaluate(route([[178, 0], [-178, 0]]), [dateline]).route.status, 'reported_intersection');
  assert.equal(evaluate(route([[-10, 0], [10, 0]]), [dateline]).route.status, 'unknown');
});

test('a current matching UGC zone reports endpoint exposure but never route exposure', () => {
  const warning = alert({ ugcZones: ['INC091'], geometryStatus: 'absent', ugcStatus: 'complete' });
  const result = evaluate(route([[-86.7, 41.6], [-86.6, 41.7]]), [warning]);
  assert.equal(result.route.status, 'unknown');
  assert.equal(result.route.reason, 'route_coverage_unproven');
  assert.equal(result.endpoints.from.status, 'reported_intersection');
  assert.equal(result.endpoints.from.evidence?.basis, 'ugc');
  assert.equal(result.endpoints.from.evidence?.ugcZone, 'INC091');
});

test('only a current feed plus covered point jurisdiction and complete evidence proves an endpoint miss', () => {
  const noAlerts = evaluate(route([[-86.7, 41.6], [-86.6, 41.7]]), []);
  assert.deepEqual(noAlerts.endpoints.from, {
    status: 'no_reported_intersection',
    retrievedAt: COVERED.retrievedAt,
  });

  const stale = evaluate(
    route([[-86.7, 41.6], [-86.6, 41.7]]),
    [],
    { from: COVERED, to: COVERED },
    { mode: 'cached', timestamp: NOW - 31 * 60_000 },
  );
  assert.deepEqual(stale.endpoints.from, { status: 'unknown', reason: 'feed_not_current' });

  const outside = evaluate(route([[-86.7, 41.6], [-86.6, 41.7]]), [], {
    from: {
      status: 'outside_jurisdiction', source: 'nws-points',
      retrievedAt: NOW - 30_000, validUntil: NOW + 29 * 60_000,
    },
    to: COVERED,
  });
  assert.deepEqual(outside.endpoints.from, { status: 'unknown', reason: 'outside_jurisdiction' });
});

test('stale point-jurisdiction evidence cannot authorize UGC matches or endpoint negatives', () => {
  const stale: EndpointZoneResolution = {
    status: 'covered',
    zones: ['INC091', 'INZ103'],
    fields: { forecastZone: 'INZ103', county: 'INC091', fireWeatherZone: 'INZ103' },
    source: 'nws-points',
    retrievedAt: NOW - 31 * 60_000,
    validUntil: NOW - 60_000,
  };
  const result = evaluate(
    route([[-86.7, 41.6], [-86.6, 41.7]]),
    [alert({ ugcZones: ['INC091'] })],
    { from: stale, to: COVERED },
  );
  assert.deepEqual(result.endpoints.from, { status: 'unknown', reason: 'jurisdiction_unknown' });
});

test('future, expired, malformed, or incomplete evidence fails endpoint misses closed', () => {
  const cases: WeatherAlert[] = [
    alert({ effective: new Date(NOW + 1) }),
    alert({ reportedOnset: new Date(NOW + 1), onset: new Date(NOW + 1) }),
    alert({ expires: new Date(NOW) }),
    alert({ status: undefined }),
    alert({ geometryStatus: 'invalid', ugcStatus: 'absent' }),
  ];
  for (const warning of cases) {
    assert.deepEqual(evaluate(route([[-10, -10], [-9, -9]]), [warning]).endpoints.from, {
      status: 'unknown',
      reason: 'alert_unevaluable',
    });
  }
});

test('an invalid claimed covered-zone resolution cannot authorize an endpoint miss', () => {
  const result = evaluate(route([[0, 0], [1, 1]]), [], {
    from: {
      status: 'covered', zones: [], source: 'nws-points', retrievedAt: NOW, validUntil: NOW + 60_000,
      fields: { forecastZone: 'INZ103', county: 'INC091', fireWeatherZone: 'INZ103' },
    },
    to: {
      status: 'covered', zones: ['not-a-zone'], source: 'nws-points', retrievedAt: NOW, validUntil: NOW + 60_000,
      fields: { forecastZone: 'INZ103', county: 'INC091', fireWeatherZone: 'INZ103' },
    },
  });
  assert.deepEqual(result.endpoints.from, { status: 'unknown', reason: 'jurisdiction_unknown' });
  assert.deepEqual(result.endpoints.to, { status: 'unknown', reason: 'jurisdiction_unknown' });
});

test('a valid positive survives an unrelated unevaluable alert and evidence is deterministically deduplicated', () => {
  const matching = polygonAlert(square(-1, -1, 1, 1));
  const result = evaluate(route([[0, 0], [2, 0]]), [
    alert({ id: 'broken', geometryStatus: 'invalid', ugcStatus: 'invalid' }),
    matching,
    { ...matching },
  ]);
  assert.equal(result.route.status, 'reported_intersection');
  assert.equal(result.route.evidence?.alertId, 'alert-1');
  assert.equal(result.endpoints.from.status, 'reported_intersection');
});

test('conflicting duplicate alert IDs fail closed independent of feed order', () => {
  const matching = polygonAlert(square(-1, -1, 1, 1));
  const conflicting = polygonAlert(square(10, 10, 11, 11), [], { id: matching.id });
  const evacRoute = route([[0, 0], [2, 0]]);
  for (const alerts of [[matching, conflicting], [conflicting, matching]]) {
    const result = evaluate(evacRoute, alerts);
    assert.equal(result.route.status, 'unknown');
    assert.deepEqual(result.endpoints.from, { status: 'unknown', reason: 'alert_unevaluable' });
  }
});

test('exact duplicate alerts deduplicate without serializing full provider geometry', () => {
  const matching = polygonAlert(square(-1, -1, 1, 1));
  const duplicate = { ...matching, polygonAreas: matching.polygonAreas?.map((area) => ({
    rings: area.rings.map((ring) => ring.map(([lon, lat]) => [lon, lat] as [number, number])),
  })) };
  Object.defineProperty(matching.polygonAreas, 'toJSON', {
    value: () => { throw new Error('full geometry serialization is forbidden'); },
  });
  Object.defineProperty(duplicate.polygonAreas, 'toJSON', {
    value: () => { throw new Error('full geometry serialization is forbidden'); },
  });
  const result = evaluate(route([[0, 0], [2, 0]]), [matching, duplicate]);
  assert.equal(result.route.status, 'reported_intersection');
  assert.equal(result.route.evidence?.alertId, matching.id);
});

test('zero-area identical and collinear rings are independently unevaluable in the evaluator', () => {
  const degenerateRings: [number, number][][] = [
    [[1, 1], [1, 1], [1, 1], [1, 1]],
    [[0, 0], [1, 1], [2, 2], [0, 0]],
  ];
  for (const ring of degenerateRings) {
    const result = evaluate(route([[10, 10], [11, 11]]), [polygonAlert(ring)]);
    assert.deepEqual(result.route, { status: 'unknown', reason: 'route_coverage_unproven' });
    assert.deepEqual(result.endpoints.from, { status: 'unknown', reason: 'alert_unevaluable' });
  }
});

test('moderate, minor, non-Actual, and non-Alert/Update products cannot become exposure evidence', () => {
  const geometry = { polygonAreas: [{ rings: [square(-1, -1, 1, 1)] }], geometryStatus: 'complete' } as const;
  const ignored = [
    alert({ ...geometry, severity: 'Moderate' }),
    alert({ ...geometry, severity: 'Minor' }),
    alert({ ...geometry, status: undefined }),
    alert({ ...geometry, messageType: undefined }),
  ];
  const result = evaluate(route([[0, 0], [2, 0]]), ignored);
  assert.equal(result.route.status, 'unknown');
  assert.equal(result.endpoints.from.status, 'unknown');
  assert.equal(result.endpoints.from.reason, 'alert_unevaluable');
});

test('deterministic input and geometry limits return unknown instead of truncating to a miss', () => {
  const tooLong = route(Array.from({ length: 100_001 }, (_, index) => [index % 2, 0] as [number, number]));
  const routeLimit = evaluate(tooLong, []);
  assert.deepEqual(routeLimit.route, { status: 'unknown', reason: 'evaluation_limit' });
  assert.deepEqual(routeLimit.endpoints.from, { status: 'unknown', reason: 'evaluation_limit' });

  const tooManyAlerts = Array.from({ length: 501 }, (_, index) => alert({ id: `alert-${index}` }));
  const alertLimit = evaluate(route([[0, 0], [2, 0]]), tooManyAlerts);
  assert.deepEqual(alertLimit.endpoints.from, { status: 'unknown', reason: 'evaluation_limit' });

  const irrelevantAlerts = Array.from({ length: 501 }, (_, index) => alert({
    id: `moderate-${index}`,
    severity: 'Moderate',
  }));
  assert.equal(evaluate(route([[0, 0], [2, 0]]), irrelevantAlerts).endpoints.from.status, 'no_reported_intersection');
});

test('the exact-operation budget returns unknown rather than completing an over-budget miss', () => {
  const repeatedCoordinates = Array.from({ length: 100_000 }, () => [2, 0] as [number, number]);
  const result = evaluate(route(repeatedCoordinates), [polygonAlert(square(-1, -1, 1, 1))]);
  assert.deepEqual(result.route, { status: 'unknown', reason: 'evaluation_limit' });
});

test('alert preprocessing consumes the shared bounded work budget before any route scan', () => {
  const totalBudget = { count: 1_999_997 };
  const result = evaluateEvacuationHazardExposure({
    route: route([[10, 10], [11, 11]]),
    weather: { alerts: [polygonAlert(square(-1, -1, 1, 1))], feedState: CURRENT_FEED },
    endpoints: { from: COVERED, to: COVERED },
    now: NOW,
    totalBudget,
  });
  assert.deepEqual(result.route, { status: 'unknown', reason: 'evaluation_limit' });
  assert.ok(totalBudget.count > 2_000_000);
});

test('closure evidence is always unknown and carries no inferred road condition', () => {
  const result = evaluate(route([[0, 0], [2, 0]]), [polygonAlert(square(-1, -1, 1, 1))]);
  assert.deepEqual(result.closure, { status: 'unknown', reason: 'no_closure_feed' });
});

test('canonical fingerprints change for same-ID geometry or endpoint-coordinate changes', () => {
  const original = route([[0, 0], [1, 1]]);
  assert.equal(canonicalEvacRouteFingerprint(original), canonicalEvacRouteFingerprint({ ...original }));
  assert.notEqual(canonicalEvacRouteFingerprint(original), canonicalEvacRouteFingerprint(route([[0, 0], [2, 2]])));
  assert.notEqual(
    canonicalEvacRouteFingerprint(original),
    canonicalEvacRouteFingerprint({ ...original, from: { ...original.from, lon: 0.1 } }),
  );
});

test('store publishes immutable snapshots and maps explicit outside jurisdiction while throws stay unknown', async () => {
  const waiters = new Map<string, (resolution: unknown) => void>();
  const store = createEvacuationHazardExposureStore({
    resolveZones: (lat, lon) => new Promise((resolve, reject) => {
      if (lat === 1) reject(new Error('network'));
      else waiters.set(`${lat},${lon}`, resolve);
    }),
    now: () => NOW,
  });
  const seen: number[] = [];
  const unsubscribe = store.subscribe((snapshot) => { seen.push(snapshot.generation); });
  store.publishWeatherSnapshot({ alerts: [], feedState: CURRENT_FEED });
  store.setRoutes([route([[0, 0], [1, 1]])]);
  await new Promise((resolve) => setImmediate(resolve));
  waiters.get('0,0')?.({
    status: 'outside-jurisdiction', zones: [], source: 'nws-points', retrievedAt: NOW, validUntil: NOW + 60_000,
  });
  await new Promise((resolve) => setImmediate(resolve));

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.results[0]?.endpoints.from.reason, 'outside_jurisdiction');
  assert.equal(snapshot.results[0]?.endpoints.to.reason, 'jurisdiction_unknown');
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.results));
  assert.ok(seen.length >= 2);
  unsubscribe();
  store.destroy();
});

test('store rejects stale zone completions after route, weather, fingerprint, or coordinate changes', async (context) => {
  const pending: Array<{ key: string; resolve: (resolution: unknown) => void }> = [];
  const store = createEvacuationHazardExposureStore({
    resolveZones: (lat, lon) => new Promise((resolve) => pending.push({ key: `${lat},${lon}`, resolve })),
    now: () => NOW,
  });
  context.after(() => store.destroy());
  store.publishWeatherSnapshot({ alerts: [alert({ ugcZones: ['INC091'] })], feedState: CURRENT_FEED });
  const first = route([[0, 0], [1, 1]]);
  store.setRoutes([first]);
  store.setRoutes([route([[0, 0], [2, 2]])]);
  store.publishWeatherSnapshot({ alerts: [], feedState: CURRENT_FEED });

  await new Promise((resolve) => setImmediate(resolve));
  for (const lookup of pending.filter((item) => item.key === '0,0' || item.key === '1,1')) {
    lookup.resolve({
      status: 'covered',
      zones: ['INC091'],
      fields: { forecastZone: 'INZ103', county: 'INC091', fireWeatherZone: 'INZ103' },
      source: 'nws-points',
      retrievedAt: NOW,
      validUntil: NOW + 60_000,
    });
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(store.getSnapshot().results, [], 'an older route evaluation must not publish after either input changes');

  for (const lookup of pending) lookup.resolve({
    status: 'outside-jurisdiction', zones: [], source: 'nws-points', retrievedAt: NOW, validUntil: NOW + 60_000,
  });
});

test('store prepares one weather generation once and reuses it across every route', async (context) => {
  let polygonAreaReads = 0;
  const warning = polygonAlert(square(-1, -1, 1, 1));
  const polygonAreas = warning.polygonAreas;
  Object.defineProperty(warning, 'polygonAreas', {
    configurable: true,
    get: () => {
      polygonAreaReads += 1;
      return polygonAreas;
    },
  });
  const store = createEvacuationHazardExposureStore({
    resolveZones: async () => ({
      status: 'covered',
      zones: ['INC091', 'INZ103'],
      fields: { forecastZone: 'INZ103', county: 'INC091', fireWeatherZone: 'INZ103' },
      source: 'nws-points',
      retrievedAt: NOW,
      validUntil: NOW + 60_000,
    }),
    now: () => NOW,
  });
  context.after(() => store.destroy());
  store.publishWeatherSnapshot({ alerts: [warning], feedState: CURRENT_FEED });
  store.setRoutes([
    route([[10, 10], [11, 11]], { id: 'route-a' }),
    route([[12, 12], [13, 13]], { id: 'route-b' }),
  ]);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.getSnapshot().results.length, 2);
  assert.equal(polygonAreaReads, 1, 'weather geometry must be prepared once, not once per route');

  store.setRoutes([route([[14, 14], [15, 15]], { id: 'route-c' })]);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(polygonAreaReads, 1, 'route-only changes reuse the prepared weather generation');
});

test('store never caches failures and expires successful point-jurisdiction evidence', async (context) => {
  let currentTime = NOW;
  let calls = 0;
  const store = createEvacuationHazardExposureStore({
    resolveZones: async () => {
      calls += 1;
      if (calls === 1) throw new Error('transient network failure');
      return {
        status: 'covered' as const,
        zones: ['INC091', 'INZ103'],
        fields: { forecastZone: 'INZ103', county: 'INC091', fireWeatherZone: 'INZ103' },
        source: 'nws-points' as const,
        retrievedAt: currentTime,
        validUntil: currentTime + 100,
      };
    },
    now: () => currentTime,
  });
  context.after(() => store.destroy());
  const sameEndpointRoute = route([[0, 0], [0, 0]]);
  store.publishWeatherSnapshot({ alerts: [], feedState: CURRENT_FEED });
  store.setRoutes([sameEndpointRoute]);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.deepEqual(store.getSnapshot().results[0]?.endpoints.from, {
    status: 'unknown', reason: 'jurisdiction_unknown',
  });

  store.publishWeatherSnapshot({ alerts: [], feedState: { ...CURRENT_FEED } });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2, 'a transient failure must not be cached');
  assert.deepEqual(store.getSnapshot().results[0]?.endpoints.from, {
    status: 'no_reported_intersection', retrievedAt: NOW,
  });

  currentTime += 101;
  store.publishWeatherSnapshot({ alerts: [], feedState: { ...CURRENT_FEED } });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 3, 'expired jurisdiction evidence must be fetched again');
});

test('destroy invalidates in-flight work and subscription ownership', async () => {
  let resolve!: (resolution: unknown) => void;
  const store = createEvacuationHazardExposureStore({
    resolveZones: () => new Promise((done) => { resolve = done; }),
    now: () => NOW,
  });
  let notifications = 0;
  store.subscribe(() => { notifications += 1; });
  store.publishWeatherSnapshot({ alerts: [], feedState: CURRENT_FEED });
  store.setRoutes([route([[0, 0], [1, 1]])]);
  await new Promise((done) => setImmediate(done));
  const beforeDestroy = notifications;
  store.destroy();
  resolve({ status: 'outside-jurisdiction', zones: [], source: 'nws-points', retrievedAt: NOW, validUntil: NOW + 60_000 });
  await new Promise((done) => setImmediate(done));
  assert.equal(notifications, beforeDestroy);
});
