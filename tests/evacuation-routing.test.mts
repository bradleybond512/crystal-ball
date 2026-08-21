import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getEvacRouteDisclosure,
  getSavedRoutes,
  isEvacRoute,
  parseEvacRouteEventDetail,
  parseOsrmResponse,
  planRoute,
} from '../src/services/evacuation-router.ts';
import { dataFreshness } from '../src/services/data-freshness.ts';
import { addSavedPlace, removeSavedPlace, updateSavedPlace } from '../src/services/saved-places.ts';

const NOW = Date.parse('2026-08-14T14:00:00.000Z');

function route(overrides: Record<string, unknown> = {}) {
  return {
    id: 'route-1',
    from: { lat: 41.6, lon: -86.7, label: 'Home', placeRef: null },
    to: { lat: 41.7, lon: -86.8, label: 'Shelter', placeRef: null },
    distanceKm: 15.2,
    durationMinutes: 21,
    geometry: {
      type: 'LineString',
      coordinates: [[-86.7, 41.6], [-86.8, 41.7]],
    },
    steps: [{ instruction: 'Depart on Main St', distanceKm: 1, durationMinutes: 2 }],
    cachedAt: NOW,
    ...overrides,
  };
}

test('evacuation route event validation rejects malformed coordinates and geometry', () => {
  assert.equal(isEvacRoute(route(), NOW), true);
  assert.equal(isEvacRoute(route({ from: { lat: 91, lon: -86.7, label: 'Home', placeRef: null } }), NOW), false);
  assert.equal(isEvacRoute(route({ geometry: { type: 'Point', coordinates: [-86.7, 41.6] } }), NOW), false);
  assert.equal(isEvacRoute(route({ geometry: { type: 'LineString', coordinates: [[-181, 41.6]] } }), NOW), false);
  assert.equal(isEvacRoute(route({ distanceKm: -1 }), NOW), false);
  assert.equal(isEvacRoute(route({ distanceKm: 50_001 }), NOW), false);
  assert.equal(isEvacRoute(route({ durationMinutes: 525_601 }), NOW), false);
  assert.equal(isEvacRoute(route({ cachedAt: 8_640_000_000_000_001 }), NOW), false);
  assert.equal(isEvacRoute(route({ cachedAt: NOW + 5 * 60 * 1000 + 1 }), NOW), false);
  assert.equal(isEvacRoute(route({ unexpected: true }), NOW), false);
  assert.equal(isEvacRoute(route({ steps: [{ instruction: 'Turn', distanceKm: 1, durationMinutes: 2, unsafe: true }] }), NOW), false);
  assert.equal(isEvacRoute(Object.assign(Object.create({ inherited: true }), route()), NOW), false);
  assert.equal(isEvacRoute(route({
    geometry: { type: 'LineString', coordinates: [[10, 10], [11, 11]] },
  }), NOW), false);
});

test('evacuation map event accepts only an exact validated route envelope', () => {
  const valid = route();
  const envelope = { route: valid };
  const parsed = parseEvacRouteEventDetail(envelope, NOW);
  assert.equal(parsed?.id, 'route-1');
  valid.from.label = 'Mutated after dispatch';
  (valid.geometry.coordinates[0] as number[])[0] = 10;
  assert.equal(parsed?.from.label, 'Home');
  assert.equal(parsed?.geometry.coordinates[0]?.[0], -86.7);
  assert.equal(parseEvacRouteEventDetail({ route: valid, extra: true }, NOW), null);
  assert.equal(parseEvacRouteEventDetail({ route: route({ cachedAt: 0 }) }, NOW), null);
  assert.equal(parseEvacRouteEventDetail(valid, NOW), null);
});

test('validated routes persist and load without Array.filter index corrupting the time bound', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  const originalDocument = globalThis.document;
  const entries = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); },
    clear: () => { entries.clear(); },
    key: (index: number) => [...entries.keys()][index] ?? null,
    get length() { return entries.size; },
  } as Storage;
  globalThis.document = { dispatchEvent: () => true } as unknown as Document;
  globalThis.fetch = async () => Response.json({
    code: 'Ok',
    routes: [{
      distance: 1_000,
      duration: 120,
      geometry: { type: 'LineString', coordinates: [[-86.7, 41.6], [-86.8, 41.7]] },
      legs: [{
        distance: 1_000,
        duration: 120,
        steps: [{ maneuver: { type: 'depart' }, name: 'Main St', distance: 1_000, duration: 120 }],
      }],
    }],
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.localStorage = originalStorage;
    globalThis.document = originalDocument;
  });

  const planned = await planRoute({ lat: 41.6, lon: -86.7 }, { lat: 41.7, lon: -86.8 });
  const loaded = getSavedRoutes();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0]?.id, planned.id);
});

test('cached routes are isolated from a same-ID saved-place coordinate edit', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  const originalDocument = globalThis.document;
  const entries = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); },
    clear: () => { entries.clear(); },
    key: (index: number) => [...entries.keys()][index] ?? null,
    get length() { return entries.size; },
  } as Storage;
  globalThis.document = { dispatchEvent: () => true } as unknown as Document;
  const savedPlace = addSavedPlace({
    name: 'Home', lat: 41.6, lon: -86.7, radiusKm: 25,
    tags: ['home'], offlinePinned: true, source: 'manual',
  });
  globalThis.fetch = async () => Response.json({
    code: 'Ok',
    routes: [{
      distance: 1_000,
      duration: 120,
      geometry: { type: 'LineString', coordinates: [[-86.7, 41.6], [-86.8, 41.7]] },
      legs: [{
        distance: 1_000,
        duration: 120,
        steps: [{ maneuver: { type: 'depart' }, name: 'Main St', distance: 1_000, duration: 120 }],
      }],
    }],
  });
  t.after(() => {
    removeSavedPlace(savedPlace.id);
    globalThis.fetch = originalFetch;
    globalThis.localStorage = originalStorage;
    globalThis.document = originalDocument;
  });

  const planned = await planRoute({ lat: 41.6, lon: -86.7 }, { lat: 41.7, lon: -86.8 });
  assert.equal(planned.from.placeRef?.id, savedPlace.id);
  assert.equal(getSavedRoutes().length, 1);
  assert.ok(parseEvacRouteEventDetail({ route: planned }, Date.now()));

  updateSavedPlace(savedPlace.id, { lat: 42.1, lon: -87.2 });
  assert.equal(getSavedRoutes().length, 0);
  assert.equal(parseEvacRouteEventDetail({ route: planned }, Date.now()), null);
});

test('a saved-place move while OSRM is pending cannot persist anonymous old coordinates', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  const originalDocument = globalThis.document;
  const entries = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); },
    clear: () => { entries.clear(); },
    key: (index: number) => [...entries.keys()][index] ?? null,
    get length() { return entries.size; },
  } as Storage;
  globalThis.document = { dispatchEvent: () => true } as unknown as Document;
  const savedPlace = addSavedPlace({
    name: 'Home pending', lat: 40.6, lon: -85.7, radiusKm: 25,
    tags: ['home'], offlinePinned: true, source: 'manual',
  });
  let resolveFetch: ((response: Response) => void) | null = null;
  globalThis.fetch = (() => new Promise<Response>((resolve) => { resolveFetch = resolve; })) as typeof fetch;
  t.after(() => {
    removeSavedPlace(savedPlace.id);
    globalThis.fetch = originalFetch;
    globalThis.localStorage = originalStorage;
    globalThis.document = originalDocument;
  });

  const pendingRoute = planRoute({ lat: 40.6, lon: -85.7 }, { lat: 40.7, lon: -85.8 });
  await Promise.resolve();
  updateSavedPlace(savedPlace.id, { lat: 40.9, lon: -85.4 });
  assert.ok(resolveFetch);
  resolveFetch(Response.json({
    code: 'Ok',
    routes: [{
      distance: 1_000,
      duration: 120,
      geometry: { type: 'LineString', coordinates: [[-85.7, 40.6], [-85.8, 40.7]] },
      legs: [{
        distance: 1_000,
        duration: 120,
        steps: [{ maneuver: { type: 'depart' }, name: 'Main St', distance: 1_000, duration: 120 }],
      }],
    }],
  }));
  await assert.rejects(pendingRoute, /endpoint changed while route was being planned/i);
  assert.equal(getSavedRoutes().length, 0);
});

test('route planning rejects malformed or sparse waypoints before any provider request', async () => {
  const sparse = new Array(1) as Array<{ lat: number; lon: number }>;
  await assert.rejects(
    planRoute({ lat: 41.6, lon: -86.7 }, { lat: 41.7, lon: -86.8 }, sparse),
    /Invalid evacuation route coordinates/,
  );
  await assert.rejects(
    planRoute({ lat: 41.6, lon: -86.7 }, { lat: 41.7, lon: -86.8 }, null as unknown as []),
    /Invalid evacuation route coordinates/,
  );
});

test('route disclosure describes graph provenance without a safety or reachability claim', () => {
  const disclosure = getEvacRouteDisclosure();
  assert.equal(disclosure, 'OSRM route graph · Current road conditions unverified');
  assert.doesNotMatch(disclosure, /safe|reachable|clear route/i);
});

test('renderer independently rejects malformed OSRM bodies used by the direct-web path', () => {
  const valid = {
    code: 'Ok',
    routes: [{
      distance: 1_000,
      duration: 120,
      geometry: { type: 'LineString', coordinates: [[-86.7, 41.6], [-86.8, 41.7]] },
      legs: [{
        distance: 1_000,
        duration: 120,
        steps: [{ maneuver: { type: 'depart' }, name: '', distance: 1_000, duration: 120 }],
      }],
    }],
  };
  assert.equal(parseOsrmResponse(valid)?.routes?.length, 1);
  assert.equal(parseOsrmResponse({ ...valid, routes: [{ ...valid.routes[0], geometry: { type: 'LineString', coordinates: [[-181, 41.6]] } }] }), null);
  assert.equal(parseOsrmResponse({ ...valid, routes: [{ ...valid.routes[0], duration: 31_536_001 }] }), null);
  assert.equal(parseOsrmResponse({ ...valid, routes: [{ ...valid.routes[0], legs: [{ ...valid.routes[0].legs[0], steps: [{ name: '', distance: 1, duration: 1 }] }] }] }), null);
  assert.deepEqual(parseOsrmResponse({ code: 'NoRoute', routes: [] }), { code: 'NoRoute', routes: [] });
  assert.deepEqual(parseOsrmResponse({ code: 'NoSegment', message: 'not exposed' }), { code: 'NoSegment', routes: [] });
  assert.equal(parseOsrmResponse({ code: 'NoSegment', routes: [valid.routes[0]] }), null);
  const step = valid.routes[0].legs[0].steps[0];
  assert.equal(parseOsrmResponse({
    code: 'Ok',
    routes: [{
      ...valid.routes[0],
      legs: [
        { ...valid.routes[0].legs[0], steps: Array.from({ length: 2_501 }, () => step) },
        { ...valid.routes[0].legs[0], steps: Array.from({ length: 2_500 }, () => step) },
      ],
    }],
  }), null);
});

test('graph no-route outcome cannot mark evacuation-router freshness as successful', async (t) => {
  const originalFetch = globalThis.fetch;
  const previousUpdate = dataFreshness.getSource('evacuation-router')?.lastUpdate?.getTime() ?? null;
  globalThis.fetch = async () => Response.json({ code: 'NoRoute', routes: [] });
  t.after(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(
    planRoute({ lat: 41.6, lon: -86.7 }, { lat: 41.7, lon: -86.8 }),
    /returned no routes/,
  );
  const source = dataFreshness.getSource('evacuation-router');
  assert.equal(source?.status, 'error');
  assert.equal(source?.lastUpdate?.getTime() ?? null, previousUpdate);
  assert.match(source?.lastError ?? '', /no contributing route/);
});

test('endpoint-mismatched graph data cannot mark routing health successful', async (t) => {
  const originalFetch = globalThis.fetch;
  const previousUpdate = dataFreshness.getSource('evacuation-router')?.lastUpdate?.getTime() ?? null;
  globalThis.fetch = async () => Response.json({
    code: 'Ok',
    routes: [{
      distance: 1_000,
      duration: 120,
      geometry: { type: 'LineString', coordinates: [[10, 10], [11, 11]] },
      legs: [{
        distance: 1_000,
        duration: 120,
        steps: [{ maneuver: { type: 'depart' }, name: '', distance: 1_000, duration: 120 }],
      }],
    }],
  });
  t.after(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(
    planRoute({ lat: 41.6, lon: -86.7 }, { lat: 41.7, lon: -86.8 }),
    /failed local validation/,
  );
  const source = dataFreshness.getSource('evacuation-router');
  assert.equal(source?.status, 'error');
  assert.equal(source?.lastUpdate?.getTime() ?? null, previousUpdate);
  assert.match(source?.lastError ?? '', /endpoint or saved-route validation/);
});

test('direct-web routing rejects a streamed body that exceeds its byte budget', async (t) => {
  const originalFetch = globalThis.fetch;
  const chunk = new Uint8Array(1024 * 1024);
  let reads = 0;
  const reader = {
    read: async () => {
      reads += 1;
      return reads <= 33 ? { done: false, value: chunk } : { done: true, value: undefined };
    },
    cancel: async () => undefined,
    releaseLock: () => undefined,
  };
  globalThis.fetch = async () => ({
    ok: true,
    headers: new Headers(),
    body: { getReader: () => reader },
  } as unknown as Response);
  t.after(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(
    planRoute({ lat: 41.6, lon: -86.7 }, { lat: 41.7, lon: -86.8 }),
    /response failed validation/,
  );
  assert.equal(reads, 33);
  assert.equal(dataFreshness.getSource('evacuation-router')?.status, 'error');
});
