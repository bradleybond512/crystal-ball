import assert from 'node:assert/strict';
import test from 'node:test';

import { NOW, PLACE_ID, requireFunction } from './test-support.mts';

interface Place {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusKm: number;
  updatedAt?: number;
}

interface Scope {
  placeId: string;
  profileFingerprint: string;
  contactConsent: boolean;
}

interface Artifact {
  kind: string;
  body: string;
  expiresAt: number;
  semanticState: string;
  summary: string;
  itemCount: number;
}

interface SourcesApi {
  buildEmergencyPackProfileFingerprint?: (place: Place) => string;
  buildEmergencyPackRoutePlaceFingerprint?: (place: Place) => string;
  createEmergencyPackSources?: (place: Place, dependencies: {
    now: () => number;
    buildLifelinesQueryFingerprint: (place: Place) => string;
    getLifelinesSnapshot: (place: Place, queryFingerprint: string) => unknown | null;
    getVerifiedLifelinesReceipt: (place: Place) => {
      placeId: string;
      capturedAt: Date;
      expiresAt: Date | null;
      isExpired: boolean;
    } | null;
    getAlertFeed: () => { alerts: unknown[]; capturedAt: number } | null;
    matchAlertToPlace: (alert: unknown, place: Place, options: { now: number }) => { matchKind: string };
    getRoutes: () => unknown[];
    getCommsPlan: (placeId: string) => unknown | null;
    getSelectedContactIds: (placeId: string) => string[];
    captureOfflineMap: (place: Place, scope: Scope) => Promise<Artifact | null>;
  }) => Record<string, (scope: Scope) => Promise<Artifact | null>>;
}

const api = await import('../emergency-pack-sources.ts').catch(() => ({} as SourcesApi)) as SourcesApi;

const place: Place = {
  id: PLACE_ID,
  name: 'Home',
  lat: 41.6111,
  lon: -86.7225,
  radiusKm: 25,
  updatedAt: NOW - 60_000,
};

function jsonBody(artifact: Artifact | null): Record<string, unknown> {
  assert.ok(artifact);
  return JSON.parse(artifact.body) as Record<string, unknown>;
}

function baseDependencies(overrides: Record<string, unknown> = {}) {
  return {
    now: () => NOW,
    buildLifelinesQueryFingerprint: () => 'lifelines-exact-v2',
    getLifelinesSnapshot: () => ({
      schemaVersion: 2,
      placeId: PLACE_ID,
      queryFingerprint: 'lifelines-exact-v2',
      fetchedAt: new Date(NOW - 60_000).toISOString(),
      sites: [],
      observations: [],
      providers: [],
    }),
    getVerifiedLifelinesReceipt: () => ({
      placeId: PLACE_ID,
      capturedAt: new Date(NOW - 60_000),
      expiresAt: new Date(NOW + 24 * 60 * 60_000),
      isExpired: false,
    }),
    getAlertFeed: () => ({ alerts: [], capturedAt: NOW - 60_000 }),
    matchAlertToPlace: (alert: unknown) => ({
      matchKind: (alert as { matched?: boolean }).matched === false ? 'no_match' : 'inside_polygon',
    }),
    getRoutes: () => [],
    getCommsPlan: () => null,
    getSelectedContactIds: () => [],
    captureOfflineMap: async () => null,
    ...overrides,
  };
}

function createSources(overrides: Record<string, unknown> = {}, target = place) {
  const fingerprint = requireFunction(api, 'buildEmergencyPackProfileFingerprint')(target);
  const create = requireFunction(api, 'createEmergencyPackSources');
  return {
    fingerprint,
    scope: { placeId: target.id, profileFingerprint: fingerprint, contactConsent: true },
    sources: create(target, baseDependencies(overrides) as Parameters<typeof create>[1]),
  };
}

test('profile fingerprints are stable and bind exact place identity, coordinates, and radius only', () => {
  const fingerprint = requireFunction(api, 'buildEmergencyPackProfileFingerprint');
  const first = fingerprint(place);
  assert.equal(first, fingerprint({ ...place }));
  assert.equal(first, fingerprint({ ...place, name: 'Renamed', updatedAt: NOW }));
  assert.notEqual(first, fingerprint({ ...place, id: 'other' }));
  assert.notEqual(first, fingerprint({ ...place, lat: 41.6112 }));
  assert.notEqual(first, fingerprint({ ...place, lon: -86.7224 }));
  assert.notEqual(first, fingerprint({ ...place, radiusKm: 26 }));
});

test('Lifelines capture requires the exact cached snapshot and its current verified receipt', async () => {
  const ready = createSources();
  const artifact = await ready.sources.lifelines?.(ready.scope);
  const payload = jsonBody(artifact ?? null);
  assert.equal(artifact?.kind, 'lifelines');
  assert.equal((payload.snapshot as { queryFingerprint?: string }).queryFingerprint, 'lifelines-exact-v2');

  for (const overrides of [
    { getLifelinesSnapshot: () => null },
    { getVerifiedLifelinesReceipt: () => null },
    { getLifelinesSnapshot: () => ({ placeId: PLACE_ID, queryFingerprint: 'stale-query' }) },
    { getVerifiedLifelinesReceipt: () => ({
      placeId: PLACE_ID,
      capturedAt: new Date(NOW - 30_000),
      expiresAt: new Date(NOW + 60 * 60_000),
      isExpired: false,
    }) },
    { getVerifiedLifelinesReceipt: () => ({
      placeId: 'other', capturedAt: new Date(NOW), expiresAt: new Date(NOW + 1), isExpired: false,
    }) },
    { getVerifiedLifelinesReceipt: () => ({
      placeId: PLACE_ID, capturedAt: new Date(NOW - 1), expiresAt: new Date(NOW), isExpired: true,
    }) },
  ]) {
    const candidate = createSources(overrides);
    assert.equal(await candidate.sources.lifelines?.(candidate.scope), null);
  }
});

test('alerts use exact place matching, cap at 100, and fail closed on stale verified-empty feeds', async () => {
  const alerts = Array.from({ length: 140 }, (_, index) => ({
    id: `alert-${index}`,
    event: 'Warning',
    severity: 'severe',
    expires: new Date(NOW + 60 * 60_000).toISOString(),
    timestamp: NOW - index,
    matched: index % 5 !== 0,
  }));
  const matchedIds: string[] = [];
  const candidate = createSources({
    getAlertFeed: () => ({ alerts, capturedAt: NOW - 60_000 }),
    matchAlertToPlace: (alert: unknown, target: Place, options: { now: number }) => {
      assert.equal(target, place);
      assert.equal(options.now, NOW);
      const item = alert as { id: string; matched: boolean };
      matchedIds.push(item.id);
      return { matchKind: item.matched ? 'inside_polygon' : 'no_match' };
    },
  });
  const artifact = await candidate.sources.alerts?.(candidate.scope);
  const payload = jsonBody(artifact ?? null);
  assert.equal((payload.alerts as unknown[]).length, 100);
  assert.equal(artifact?.itemCount, 100);
  assert.equal(matchedIds.length, alerts.length, 'every candidate is scoped with the canonical matcher');

  const emptyCurrent = createSources({ getAlertFeed: () => ({ alerts: [], capturedAt: NOW - 60_000 }) });
  assert.equal((await emptyCurrent.sources.alerts?.(emptyCurrent.scope))?.semanticState, 'verified-empty');

  const emptyStale = createSources({
    getAlertFeed: () => ({ alerts: [], capturedAt: NOW - 4 * 60 * 60_000 }),
  });
  assert.equal(await emptyStale.sources.alerts?.(emptyStale.scope), null);
  const missingTimestamp = createSources({ getAlertFeed: () => ({ alerts: [], capturedAt: Number.NaN }) });
  assert.equal(await missingTimestamp.sources.alerts?.(missingTimestamp.scope), null);
});

function route(
  id: string,
  routeFingerprint: string,
  cachedAt: number,
  coordinateCount = 2,
  stepCount = 1,
) {
  const coordinates = Array.from({ length: coordinateCount }, (_, index) => [
    -86.7225 - (0.0775 * index / Math.max(1, coordinateCount - 1)),
    41.6111 + (0.0889 * index / Math.max(1, coordinateCount - 1)),
  ]);
  return {
    id,
    from: { lat: 41.6111, lon: -86.7225, label: place.name, placeRef: { id: place.id, fingerprint: routeFingerprint } },
    to: { lat: 41.7, lon: -86.8, label: 'Shelter', placeRef: null },
    distanceKm: 12,
    durationMinutes: 20,
    geometry: { type: 'LineString', coordinates },
    steps: Array.from({ length: stepCount }, (_, index) => ({
      instruction: `Step ${index}`, distanceKm: 0.1, durationMinutes: 0.1,
    })),
    cachedAt,
  };
}

test('routes select two current exact place-bound candidates, expire at 24h, and adapt safely to caps', async () => {
  const routeFingerprint = requireFunction(api, 'buildEmergencyPackRoutePlaceFingerprint')(place);
  const routes = [
    route('stale', routeFingerprint, NOW - 24 * 60 * 60_000),
    route('moved', `${routeFingerprint}:old`, NOW - 1_000),
    route('primary', routeFingerprint, NOW - 2_000, 5_600, 1_200),
    route('alternate', routeFingerprint, NOW - 3_000),
    route('third', routeFingerprint, NOW - 4_000),
  ];
  const candidate = createSources({ getRoutes: () => routes });
  const primary = jsonBody(await candidate.sources['route-primary']?.(candidate.scope) ?? null);
  const alternate = jsonBody(await candidate.sources['route-alternate']?.(candidate.scope) ?? null);

  assert.equal(primary.routeId, 'primary');
  assert.equal(alternate.routeId, 'alternate');
  const geometry = primary.geometry as { coordinates: number[][] };
  assert.equal(geometry.coordinates.length, 5_000);
  assert.deepEqual(geometry.coordinates[0], routes[2]?.geometry.coordinates[0]);
  assert.deepEqual(geometry.coordinates.at(-1), routes[2]?.geometry.coordinates.at(-1));
  assert.equal((primary.steps as unknown[]).length, 1_000);

  const onlyBoundaryStale = createSources({
    getRoutes: () => [route('boundary-stale', routeFingerprint, NOW - 24 * 60 * 60_000)],
  });
  assert.equal(
    await onlyBoundaryStale.sources['route-primary']?.(onlyBoundaryStale.scope),
    null,
    'a route exactly 24 hours old is expired and cannot be selected',
  );
});

test('comms and contacts require consent and persist only selected contacts in a separate private body', async () => {
  let selectionReads = 0;
  const plan = {
    placeId: PLACE_ID,
    contacts: [
      { id: 'c1', label: 'One', value: '+15550000001', role: 'family' },
      { id: 'c2', label: 'Two', value: '+15550000002', role: 'pickup' },
      { id: 'c3', label: 'Three', value: 'three@example.com', role: 'work' },
    ],
    fallbackSteps: [{ id: 'sms', label: 'SMS', kind: 'sms', instruction: 'Send status', priority: 1 }],
    checkInWindows: [{ id: 'hourly', label: 'Hourly', cadenceMinutes: 60, note: '' }],
    notes: 'Meet at home',
    templateOverrides: {},
    updatedAt: NOW - 60_000,
  };
  const candidate = createSources({
    getCommsPlan: () => plan,
    getSelectedContactIds: () => { selectionReads += 1; return ['c2']; },
  });
  const commsArtifact = await candidate.sources['comms-plan']?.(candidate.scope) ?? null;
  const contactsArtifact = await candidate.sources.contacts?.(candidate.scope) ?? null;
  const comms = jsonBody(commsArtifact);
  const contacts = jsonBody(contactsArtifact);

  assert.equal(Object.hasOwn(comms, 'contacts'), false, 'comms body must not duplicate private contacts');
  assert.equal(commsArtifact?.body.includes('+15550000002'), false);
  assert.deepEqual((contacts.contacts as Array<{ id: string }>).map(({ id }) => id), ['c2']);
  assert.equal(contactsArtifact?.body.includes('+15550000001'), false);
  assert.equal(contactsArtifact?.body.includes('three@example.com'), false);
  assert.equal(selectionReads, 2);

  selectionReads = 0;
  const deniedScope = { ...candidate.scope, contactConsent: false };
  assert.equal(await candidate.sources['comms-plan']?.(deniedScope), null);
  assert.equal(await candidate.sources.contacts?.(deniedScope), null);
  assert.equal(selectionReads, 0, 'denied consent must stop before reading private selections');
});
