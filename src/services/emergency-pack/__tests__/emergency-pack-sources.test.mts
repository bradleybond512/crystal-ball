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
  capturedAt: number;
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
    matchAlertToPlace: (alert: unknown, place: Place, options: { now: number }) => unknown;
    getRoutes: () => unknown[];
    getCommsPlan: (placeId: string) => unknown | null;
    getSelectedContactIds: (placeId: string) => string[];
    captureOfflineMap: (place: Place, scope: Scope) => Promise<Artifact | null>;
    releaseArtifact?: (artifact: Artifact) => Promise<void>;
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

function offlineMapArtifact(scope: Scope, capturedAt: number, expiresAt: number): Artifact {
  const generationId = 'generation-review-clock';
  return {
    kind: 'offline-map',
    body: JSON.stringify({
      kind: 'offline-map',
      placeId: scope.placeId,
      profileFingerprint: scope.profileFingerprint,
      generationId,
      tiles: [{
        url: 'https://tiles.example/10/301/402.png',
        cacheKey: `https://offline-map.crystalball.invalid/exact/${generationId}/0`,
        sha256: 'a'.repeat(64),
        generationId,
        byteLength: 4,
        verified: true,
      }],
      totalBytes: 4,
    }),
    capturedAt,
    expiresAt,
    semanticState: 'verified',
    summary: '1 exact offline tile verified',
    itemCount: 1,
  };
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
      msUntilExpires: 60 * 60_000,
      isCancellation: false,
      threatLevel: (alert as { matched?: boolean }).matched === false ? 'none' : 'warning',
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
  assert.equal(artifact?.capturedAt, NOW - 60_000, 'receipt time is the evidence capture time');
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
    {
      getLifelinesSnapshot: () => ({
        schemaVersion: 2,
        placeId: PLACE_ID,
        queryFingerprint: 'lifelines-exact-v2',
        fetchedAt: new Date(NOW + 1).toISOString(),
        sites: [],
        observations: [],
        providers: [],
      }),
      getVerifiedLifelinesReceipt: () => ({
        placeId: PLACE_ID,
        capturedAt: new Date(NOW + 1),
        expiresAt: new Date(NOW + 60_000),
        isExpired: false,
      }),
    },
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
      return {
        matchKind: item.matched ? 'inside_polygon' : 'no_match',
        msUntilExpires: 60 * 60_000,
        isCancellation: false,
        threatLevel: item.matched ? 'warning' : 'none',
      };
    },
  });
  const artifact = await candidate.sources.alerts?.(candidate.scope);
  const payload = jsonBody(artifact ?? null);
  assert.equal((payload.alerts as unknown[]).length, 100);
  assert.equal(artifact?.itemCount, 100);
  assert.equal(artifact?.capturedAt, NOW - 60_000, 'feed fetch time is the evidence capture time');
  assert.equal(matchedIds.length, alerts.length, 'every candidate is scoped with the canonical matcher');

  const emptyCurrent = createSources({ getAlertFeed: () => ({ alerts: [], capturedAt: NOW - 60_000 }) });
  assert.equal((await emptyCurrent.sources.alerts?.(emptyCurrent.scope))?.semanticState, 'verified-empty');

  const emptyStale = createSources({
    getAlertFeed: () => ({ alerts: [], capturedAt: NOW - 15 * 60_000 }),
  });
  assert.equal(await emptyStale.sources.alerts?.(emptyStale.scope), null);
  const missingTimestamp = createSources({ getAlertFeed: () => ({ alerts: [], capturedAt: Number.NaN }) });
  assert.equal(await missingTimestamp.sources.alerts?.(missingTimestamp.scope), null);
});

test('alerts exclude expired and cancelled matches and fail closed on invalid matcher metadata', async () => {
  const alert = { id: 'weather-1', event: 'Tornado Warning' };
  const artifactFor = async (match: unknown) => {
    const candidate = createSources({
      getAlertFeed: () => ({ alerts: [alert], capturedAt: NOW - 60_000 }),
      matchAlertToPlace: () => match,
    });
    return await candidate.sources.alerts?.(candidate.scope) ?? null;
  };

  for (const match of [
    { matchKind: 'inside_polygon', msUntilExpires: 0, isCancellation: false, threatLevel: 'warning' },
    { matchKind: 'inside_polygon', msUntilExpires: -1, isCancellation: false, threatLevel: 'warning' },
    { matchKind: 'inside_polygon', msUntilExpires: 60_000, isCancellation: true, threatLevel: 'none' },
    { matchKind: 'inside_polygon', msUntilExpires: 60_000, isCancellation: true, threatLevel: 'warning' },
    { matchKind: 'inside_polygon', msUntilExpires: 60_000, isCancellation: false, threatLevel: 'none' },
  ]) {
    const artifact = await artifactFor(match);
    assert.equal(artifact?.itemCount, 0);
    assert.equal(artifact?.semanticState, 'verified-empty');
    assert.equal(artifact?.summary, 'No current matched alerts; coverage not inferred');
    assert.deepEqual(jsonBody(artifact).alerts, []);
  }

  for (const malformed of [
    { matchKind: 'inside_polygon', isCancellation: false, threatLevel: 'warning' },
    { matchKind: 'inside_polygon', msUntilExpires: Number.NaN, isCancellation: false, threatLevel: 'warning' },
    { matchKind: 'inside_polygon', msUntilExpires: Number.POSITIVE_INFINITY, isCancellation: false, threatLevel: 'warning' },
    { matchKind: 'inside_polygon', msUntilExpires: 60_000, threatLevel: 'warning' },
    { matchKind: 'inside_polygon', msUntilExpires: 60_000, isCancellation: false },
    { matchKind: 'inside_polygon', msUntilExpires: 60_000, isCancellation: false, threatLevel: 'critical' },
    { matchKind: 'renamed_match', msUntilExpires: 60_000, isCancellation: false, threatLevel: 'warning' },
  ]) {
    assert.equal(await artifactFor(malformed), null);
  }
});

test('alerts expire at the 15-minute feed deadline or earliest included alert expiry', async () => {
  const feedCapturedAt = NOW - 60_000;
  const candidate = createSources({
    getAlertFeed: () => ({ alerts: [{ id: 'soon' }, { id: 'later' }], capturedAt: feedCapturedAt }),
    matchAlertToPlace: (alert: unknown) => ({
      matchKind: 'inside_polygon',
      msUntilExpires: (alert as { id: string }).id === 'soon' ? 2 * 60_000 : 30 * 60_000,
      isCancellation: false,
      threatLevel: 'warning',
    }),
  });
  const earliest = await candidate.sources.alerts?.(candidate.scope) ?? null;
  assert.equal(earliest?.capturedAt, feedCapturedAt);
  assert.equal(earliest?.expiresAt, NOW + 2 * 60_000);

  const feedLimited = createSources({
    getAlertFeed: () => ({ alerts: [{ id: 'later' }], capturedAt: feedCapturedAt }),
    matchAlertToPlace: () => ({
      matchKind: 'inside_polygon',
      msUntilExpires: 30 * 60_000,
      isCancellation: false,
      threatLevel: 'warning',
    }),
  });
  assert.equal(
    (await feedLimited.sources.alerts?.(feedLimited.scope))?.expiresAt,
    feedCapturedAt + 15 * 60_000,
  );
});

test('offline map validates TTL against the post-download clock and releases every rejected capture', async () => {
  const later = NOW + 10 * 60_000;
  const thirtyDays = 30 * 24 * 60 * 60_000;
  const makeCandidate = (expiresAt: number, overrides: Record<string, unknown> = {}) => {
    let clockReads = 0;
    let captured: Artifact | null = null;
    const released: Artifact[] = [];
    const candidate = createSources({
      now: () => [NOW, later][Math.min(clockReads++, 1)]!,
      captureOfflineMap: async (_place: Place, scope: Scope) => {
        captured = offlineMapArtifact(scope, later, expiresAt);
        return captured;
      },
      releaseArtifact: async (artifact: Artifact) => { released.push(artifact); },
      ...overrides,
    });
    return { candidate, released, captured: () => captured };
  };

  const accepted = makeCandidate(later + thirtyDays);
  assert.equal(
    (await accepted.candidate.sources['offline-map']?.(accepted.candidate.scope))?.capturedAt,
    later,
    'an exact 30-day TTL from the post-download timestamp remains valid',
  );
  assert.deepEqual(accepted.released, [], 'ownership transfers to the successful pack capture');

  for (const expiresAt of [later, later + thirtyDays + 1]) {
    const rejected = makeCandidate(expiresAt);
    assert.equal(await rejected.candidate.sources['offline-map']?.(rejected.candidate.scope), null);
    assert.deepEqual(rejected.released, [rejected.captured()]);
  }

  let releaseAttempts = 0;
  const invalidBody = makeCandidate(later + thirtyDays, {
    captureOfflineMap: async (_place: Place, scope: Scope) => ({
      ...offlineMapArtifact(scope, later, later + thirtyDays),
      body: '{not-json',
    }),
    releaseArtifact: async () => {
      releaseAttempts += 1;
      throw new Error('cache deletion unavailable');
    },
  });
  assert.equal(await invalidBody.candidate.sources['offline-map']?.(invalidBody.candidate.scope), null);
  assert.equal(releaseAttempts, 1, 'release failure cannot turn a rejected artifact into success');

  let clockReads = 0;
  const releasedAfterClockFailure: Artifact[] = [];
  const postClockFailure = createSources({
    now: () => {
      if (clockReads++ === 0) return NOW;
      throw new Error('clock unavailable after download');
    },
    captureOfflineMap: async (_place: Place, scope: Scope) => (
      offlineMapArtifact(scope, later, later + thirtyDays)
    ),
    releaseArtifact: async (artifact: Artifact) => { releasedAfterClockFailure.push(artifact); },
  });
  assert.equal(await postClockFailure.sources['offline-map']?.(postClockFailure.scope), null);
  assert.equal(releasedAfterClockFailure.length, 1, 'post-capture clock failure must release staged bytes');
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
  assert.equal((await candidate.sources['route-primary']?.(candidate.scope))?.capturedAt, NOW - 2_000);
  assert.equal((await candidate.sources['route-alternate']?.(candidate.scope))?.capturedAt, NOW - 3_000);

  const onlyBoundaryStale = createSources({
    getRoutes: () => [route('boundary-stale', routeFingerprint, NOW - 24 * 60 * 60_000)],
  });
  assert.equal(
    await onlyBoundaryStale.sources['route-primary']?.(onlyBoundaryStale.scope),
    null,
    'a route exactly 24 hours old is expired and cannot be selected',
  );
  const future = createSources({
    getRoutes: () => [route('future', routeFingerprint, NOW + 1)],
  });
  assert.equal(await future.sources['route-primary']?.(future.scope), null);
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
  assert.equal(commsArtifact?.capturedAt, NOW);
  assert.equal(contactsArtifact?.capturedAt, commsArtifact?.capturedAt);
  assert.deepEqual((contacts.contacts as Array<{ id: string }>).map(({ id }) => id), ['c2']);
  assert.equal(contactsArtifact?.body.includes('+15550000001'), false);
  assert.equal(contactsArtifact?.body.includes('three@example.com'), false);
  assert.equal(selectionReads, 1, 'one capture must read one contact selection snapshot');

  selectionReads = 0;
  const deniedScope = { ...candidate.scope, contactConsent: false };
  assert.equal(await candidate.sources['comms-plan']?.(deniedScope), null);
  assert.equal(await candidate.sources.contacts?.(deniedScope), null);
  assert.equal(selectionReads, 0, 'denied consent must stop before reading private selections');
});

test('comms and contacts use one immutable snapshot when backing state changes between source calls', async () => {
  let clockReads = 0;
  let planReads = 0;
  let selectionReads = 0;
  const plans = [
    {
      placeId: PLACE_ID,
      contacts: [
        { id: 'first', label: 'First', value: '+15550000001', role: 'family' },
        { id: 'second', label: 'Second', value: '+15550000002', role: 'pickup' },
      ],
      fallbackSteps: [{ id: 'sms', label: 'SMS', kind: 'sms', instruction: 'Send first status', priority: 1 }],
      checkInWindows: [{ id: 'hourly', label: 'Hourly', cadenceMinutes: 60, note: '' }],
      notes: 'First plan',
    },
    {
      placeId: PLACE_ID,
      contacts: [
        { id: 'first', label: 'First changed', value: '+15559999999', role: 'changed' },
        { id: 'second', label: 'Second changed', value: '+15558888888', role: 'changed' },
      ],
      fallbackSteps: [{ id: 'call', label: 'Call', kind: 'call', instruction: 'Use changed plan', priority: 1 }],
      checkInWindows: [{ id: 'daily', label: 'Daily', cadenceMinutes: 1440, note: 'Changed' }],
      notes: 'Changed plan',
    },
  ];
  const selections = [['first'], ['second']];
  const candidate = createSources({
    now: () => NOW + clockReads++ * 60_000,
    getCommsPlan: () => plans[Math.min(planReads++, plans.length - 1)],
    getSelectedContactIds: () => selections[Math.min(selectionReads++, selections.length - 1)]!,
  });

  const commsArtifact = await candidate.sources['comms-plan']?.(candidate.scope) ?? null;
  const contactsArtifact = await candidate.sources.contacts?.(candidate.scope) ?? null;
  const comms = jsonBody(commsArtifact);
  const contacts = jsonBody(contactsArtifact);

  assert.deepEqual(comms.selectedContactIds, ['first']);
  assert.deepEqual(contacts.selectedContactIds, comms.selectedContactIds);
  assert.deepEqual(contacts.contacts, [{
    id: 'first', label: 'First', value: '+15550000001', role: 'family',
  }]);
  assert.equal(planReads, 1, 'one capture must validate one comms plan snapshot');
  assert.equal(selectionReads, 1, 'one capture must validate one contact selection snapshot');
  assert.equal(commsArtifact?.capturedAt, NOW);
  assert.equal(contactsArtifact?.capturedAt, NOW, 'both private artifacts bind one capture instant');
});
