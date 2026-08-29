import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLocalLogisticsBriefItems,
  buildLocalLogisticsFingerprint,
  buildLocalLogisticsSnapshot,
  deserializeLocalLogisticsSnapshot,
  fetchLocalLogistics,
  getCachedLocalLogistics,
  getLocalLogisticsOfflineCacheServiceId,
  LOCAL_LOGISTICS_CATEGORIES,
  parseLocalLogisticsApiResponse,
  rankLocalLogisticsNodes,
  validateLocalLogisticsSnapshotEvent,
} from '../src/services/local-logistics.ts';
import { createLifelineRuntime } from '../src/services/lifelines/lifeline-runtime.ts';
import { readOfflineCacheEntry } from '../src/services/offline-alert-cache.ts';
import * as localLogisticsModule from '../src/services/local-logistics.ts';
import type {
  LifelineCategoryCoverage,
  LifelineCoverageState,
  LifelineProviderCoverage,
  LocalLogisticsRadiusChoiceKm,
} from '../src/services/local-logistics.ts';
import type { AreaCondition, LogisticsNode } from '../src/services/local-logistics-types.ts';
import type { LocalLogisticsSnapshot, ProviderStatus } from '../src/services/local-logistics-types.ts';
import type { SavedPlace } from '../src/services/saved-places.ts';

const NOW = new Date('2026-03-29T19:00:00.000Z');
const feature = localLogisticsModule as Record<string, unknown>;

function requireFeature<T>(name: string): T {
  assert.equal(typeof feature[name], 'function', `${name} must be exported`);
  return feature[name] as T;
}

function makePlace(overrides: Partial<SavedPlace> = {}): SavedPlace {
  return {
 id: 'place-home',
 name: 'Home',
 lat: 35.994,
 lon: -78.8986,
 radiusKm: 40,
 tags: ['home'],
 priority: 10,
 notes: '',
 offlinePinned: true,
 primary: true,
 source: 'manual',
 sortIndex: 1,
 createdAt: NOW.getTime(),
 updatedAt: NOW.getTime(),
 ...overrides,
  };
}

function makeNode(overrides: Partial<LogisticsNode> = {}): LogisticsNode {
  const category = overrides.category ?? 'fuel';
  return {
 id: 'fuel-1',
 kind: category,
 category,
 name: 'Fuel Stop',
 lat: 35.99,
 lon: -78.9,
 distanceKm: 5,
 source: 'OpenStreetMap',
 sourceRefs: [{ provider: 'osm', recordId: 'node/1' }],
 capabilities: {},
 sourceUrl: 'https://www.openstreetmap.org/node/1',
 freshness: 'fresh',
 operational: 'unknown',
 inventory: 'unknown',
 power: 'unknown',
 access: 'unknown',
 verification: 'directory',
 observedAt: NOW,
 expiresAt: new Date(NOW.getTime() + 60_000),
 confidence: 'low',
 directoryOnly: true,
 hazardCompatibility: 'general',
 fetchedAt: NOW,
 ...overrides,
  };
}

function makeOutageCondition(overrides: Partial<AreaCondition> = {}): AreaCondition {
  return {
    id: 'ornl-odin:37183:utility-1',
    type: 'power_outage',
    coverage: 'reported',
    countyFips: '37183',
    county: 'Wake',
    state: 'North Carolina',
    customersOut: 17,
    utilityName: 'Example Electric',
    utilityId: 'utility-1',
    observedAt: NOW,
    retrievedAt: NOW,
    sourceObservedAt: new Date(NOW.getTime() - 5 * 60_000),
    expiresAt: new Date(NOW.getTime() + 30 * 60_000),
    source: 'ornl-odin',
    ...overrides,
  };
}

interface DeferredResponse {
  promise: Promise<Response>;
  resolve(response: Response): void;
}

function deferredResponse(): DeferredResponse {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

function emptyLogisticsResponse(place: SavedPlace, input: string | URL | Request, fetchedAt: string): Response {
  const url = new URL(String(input), 'http://localhost');
  const radiusKm = Number(url.searchParams.get('radiusKm'));
  const categories = url.searchParams.get('categories')?.split(',') ?? [];
  return new Response(JSON.stringify({
    schemaVersion: 2,
    query: { lat: place.lat, lon: place.lon, radiusKm, categories },
    sites: [],
    observations: [],
    providers: [
      { id: 'osm', state: 'empty', acceptedRows: 0, droppedRows: 0, observedAt: fetchedAt },
      { id: 'fema-open-shelters', state: 'empty', acceptedRows: 0, droppedRows: 0, observedAt: fetchedAt },
      { id: 'fema-recovery-centers', state: 'empty', acceptedRows: 0, droppedRows: 0, observedAt: fetchedAt },
    ],
    fetchedAt,
    retrievedAt: fetchedAt,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function installCommitRaceHarness(options: { failExactWrites?: number } = {}): {
  pending: Array<{ input: string | URL | Request; response: DeferredResponse }>;
  persisted: Map<string, string>;
  events: Array<{ detail?: LocalLogisticsSnapshot }>;
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };
  observeEvents(listener: (snapshot: LocalLogisticsSnapshot) => void): void;
  restore(): void;
} {
  const originalFetch = globalThis.fetch;
  const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const priorCustomEvent = Object.getOwnPropertyDescriptor(globalThis, 'CustomEvent');
  const pending: Array<{ input: string | URL | Request; response: DeferredResponse }> = [];
  const persisted = new Map<string, string>();
  const events: Array<{ detail?: LocalLogisticsSnapshot }> = [];
  let failedExactWrites = 0;
  let eventObserver: ((snapshot: LocalLogisticsSnapshot) => void) | null = null;
  const storage = {
    getItem: (key: string) => persisted.get(key) ?? null,
    setItem: (key: string, value: string) => {
      const isExactArtifact = key.startsWith('wm_offline_local-logistics:v2:')
        && !key.startsWith('wm_offline_local-logistics:v2:latest:');
      if (isExactArtifact && failedExactWrites < (options.failExactWrites ?? 0)) {
        failedExactWrites += 1;
        return;
      }
      persisted.set(key, value);
    },
    removeItem: (key: string) => { persisted.delete(key); },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      dispatchEvent: (event: { detail?: LocalLogisticsSnapshot }) => {
        events.push(event);
        if (event.detail) eventObserver?.(event.detail);
      },
    },
  });
  Object.defineProperty(globalThis, 'CustomEvent', {
    configurable: true,
    value: class {
      readonly detail?: LocalLogisticsSnapshot;
      constructor(_type: string, init?: { detail?: LocalLogisticsSnapshot }) { this.detail = init?.detail; }
    },
  });
  globalThis.fetch = async (input) => {
    const response = deferredResponse();
    pending.push({ input, response });
    return response.promise;
  };
  return {
    pending,
    persisted,
    events,
    storage,
    observeEvents: (listener) => { eventObserver = listener; },
    restore: () => {
      globalThis.fetch = originalFetch;
      if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage);
      else Reflect.deleteProperty(globalThis, 'localStorage');
      if (priorDocument) Object.defineProperty(globalThis, 'document', priorDocument);
      else Reflect.deleteProperty(globalThis, 'document');
      if (priorCustomEvent) Object.defineProperty(globalThis, 'CustomEvent', priorCustomEvent);
      else Reflect.deleteProperty(globalThis, 'CustomEvent');
    },
  };
}

test('saved radii initialize to the next supported Lifelines radius', () => {
  const initialLocalLogisticsRadiusKm = requireFeature<(radiusKm: number) => LocalLogisticsRadiusChoiceKm>(
    'initialLocalLogisticsRadiusKm',
  );
  const LOCAL_LOGISTICS_RADIUS_CHOICES_KM = feature.LOCAL_LOGISTICS_RADIUS_CHOICES_KM as readonly number[];
  assert.deepEqual(LOCAL_LOGISTICS_RADIUS_CHOICES_KM, [5, 10, 25, 50]);
  assert.equal(initialLocalLogisticsRadiusKm(1), 5);
  assert.equal(initialLocalLogisticsRadiusKm(5), 5);
  assert.equal(initialLocalLogisticsRadiusKm(6), 10);
  assert.equal(initialLocalLogisticsRadiusKm(24), 25);
  assert.equal(initialLocalLogisticsRadiusKm(26), 50);
  assert.equal(initialLocalLogisticsRadiusKm(75), 50);
});

test('explicit fetch radii override the saved preference and clamp independently to 1..50 km', async () => {
  const originalFetch = globalThis.fetch;
  const requestedRadii: number[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), 'http://localhost');
    const radiusKm = Number(url.searchParams.get('radiusKm'));
    const categories = url.searchParams.get('categories')?.split(',') ?? [];
    requestedRadii.push(radiusKm);
    const providers = [
      ...(categories.some((category) => category !== 'recovery') ? ['osm'] : []),
      ...(categories.includes('shelter') ? ['fema-open-shelters'] : []),
      ...(categories.includes('recovery') ? ['fema-recovery-centers'] : []),
    ].map((id) => ({
      id, state: 'empty', acceptedRows: 0, droppedRows: 0, observedAt: NOW.toISOString(),
    }));
    return new Response(JSON.stringify({
      schemaVersion: 2,
      query: { lat: 35.994, lon: -78.8986, radiusKm, categories },
      sites: [], observations: [], providers,
      fetchedAt: NOW.toISOString(), retrievedAt: NOW.toISOString(),
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const place = makePlace({ radiusKm: 6 });
    await fetchLocalLogistics(place, { radiusKm: 50 });
    await fetchLocalLogistics(place, { radiusKm: 75 });
    await fetchLocalLogistics(place, { radiusKm: 0 });
    await fetchLocalLogistics(place);
    assert.deepEqual(requestedRadii, [50, 50, 1, 6]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a false internal commit guard blocks cache, persistence, latest pointer, and events', async () => {
  const place = makePlace({ id: 'guarded-fetch', radiusKm: 10 });
  const originalFetch = globalThis.fetch;
  const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const priorCustomEvent = Object.getOwnPropertyDescriptor(globalThis, 'CustomEvent');
  const persisted = new Map<string, string>();
  let events = 0;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => persisted.get(key) ?? null,
      setItem: (key: string, value: string) => { persisted.set(key, value); },
      removeItem: (key: string) => { persisted.delete(key); },
    },
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { dispatchEvent: () => { events += 1; } },
  });
  Object.defineProperty(globalThis, 'CustomEvent', {
    configurable: true,
    value: class { constructor(_type: string, _init: unknown) {} },
  });
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), 'http://localhost');
    const radiusKm = Number(url.searchParams.get('radiusKm'));
    const categories = url.searchParams.get('categories')?.split(',') ?? [];
    const now = new Date().toISOString();
    return new Response(JSON.stringify({
      schemaVersion: 2,
      query: { lat: place.lat, lon: place.lon, radiusKm, categories },
      sites: [],
      observations: [],
      providers: [
        { id: 'osm', state: 'empty', acceptedRows: 0, droppedRows: 0, observedAt: now },
        { id: 'fema-open-shelters', state: 'empty', acceptedRows: 0, droppedRows: 0, observedAt: now },
        { id: 'fema-recovery-centers', state: 'empty', acceptedRows: 0, droppedRows: 0, observedAt: now },
      ],
      fetchedAt: now,
      retrievedAt: now,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const result = await fetchLocalLogistics(place, {
      radiusKm: 10,
      shouldCommit: () => false,
    } as never);
    assert.equal(result.effectiveRadiusKm, 10);
    assert.equal(getCachedLocalLogistics(place.id), null);
    assert.equal(persisted.size, 0);
    assert.equal(events, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
    if (priorDocument) Object.defineProperty(globalThis, 'document', priorDocument);
    else Reflect.deleteProperty(globalThis, 'document');
    if (priorCustomEvent) Object.defineProperty(globalThis, 'CustomEvent', priorCustomEvent);
    else Reflect.deleteProperty(globalThis, 'CustomEvent');
  }
});

test('ordinary-first and superseded guarded requests keep independent commit ownership', async () => {
  const place = makePlace({ id: 'ordinary-first-race', radiusKm: 10 });
  const harness = installCommitRaceHarness();
  let guardedCurrent = true;
  const ordinaryAt = new Date(Date.now() - 2_000).toISOString();
  const guardedAt = new Date(Date.now() - 1_000).toISOString();
  try {
    const ordinary = fetchLocalLogistics(place, { radiusKm: 10 });
    const guarded = fetchLocalLogistics(place, {
      radiusKm: 10,
      shouldCommit: () => guardedCurrent,
    } as never);
    guardedCurrent = false;
    harness.pending[0]?.response.resolve(emptyLogisticsResponse(place, harness.pending[0].input, ordinaryAt));
    harness.pending[1]?.response.resolve(emptyLogisticsResponse(place, harness.pending[1].input, guardedAt));

    const [foregroundResult, guardedResult] = await Promise.all([ordinary, guarded]);
    assert.equal(harness.pending.length, 2, 'foreground and guarded requests must not share one policy');
    assert.equal(foregroundResult.fetchedAt.toISOString(), ordinaryAt);
    assert.equal(guardedResult.fetchedAt.toISOString(), guardedAt);
    assert.equal(getCachedLocalLogistics(place.id)?.fetchedAt.toISOString(), ordinaryAt);
    assert.equal(harness.events.length, 1);
    assert.equal(harness.events[0]?.detail?.fetchedAt.toISOString(), ordinaryAt);
    assert.ok([...harness.persisted.keys()].some((key) => key.includes(`latest:${place.id}`)));
  } finally {
    harness.restore();
  }
});

test('guarded-first and ordinary requests keep foreground persistence after supersession', async () => {
  const place = makePlace({ id: 'guarded-first-race', radiusKm: 10 });
  const harness = installCommitRaceHarness();
  let guardedCurrent = true;
  const guardedAt = new Date(Date.now() - 2_000).toISOString();
  const ordinaryAt = new Date(Date.now() - 1_000).toISOString();
  try {
    const guarded = fetchLocalLogistics(place, {
      radiusKm: 10,
      shouldCommit: () => guardedCurrent,
    } as never);
    const ordinary = fetchLocalLogistics(place, { radiusKm: 10 });
    guardedCurrent = false;
    harness.pending[0]?.response.resolve(emptyLogisticsResponse(place, harness.pending[0].input, guardedAt));
    harness.pending[1]?.response.resolve(emptyLogisticsResponse(place, harness.pending[1].input, ordinaryAt));

    const [guardedResult, foregroundResult] = await Promise.all([guarded, ordinary]);
    assert.equal(harness.pending.length, 2, 'guarded and foreground requests must not share one policy');
    assert.equal(guardedResult.fetchedAt.toISOString(), guardedAt);
    assert.equal(foregroundResult.fetchedAt.toISOString(), ordinaryAt);
    assert.equal(getCachedLocalLogistics(place.id)?.fetchedAt.toISOString(), ordinaryAt);
    assert.equal(harness.events.length, 1);
    assert.equal(harness.events[0]?.detail?.fetchedAt.toISOString(), ordinaryAt);
    assert.ok([...harness.persisted.keys()].some((key) => key.includes(`latest:${place.id}`)));
  } finally {
    harness.restore();
  }
});

for (const requestOrder of [
  ['ordinary', 'guarded'],
  ['guarded', 'ordinary'],
] as const) {
  for (const completionOrder of [
    ['older', 'newer'],
    ['newer', 'older'],
  ] as const) {
    test(`same-fingerprint ${requestOrder.join('-first-')} requests completing ${completionOrder.join('-first-')} commit monotonically`, async () => {
      const place = makePlace({ id: `monotonic-${requestOrder[0]}-${completionOrder[0]}`, radiusKm: 10 });
      const harness = installCommitRaceHarness();
      const runtime = createLifelineRuntime(harness.storage, () => Date.now());
      harness.observeEvents((snapshot) => { runtime.processSnapshot(snapshot); });
      const olderAt = new Date(Date.now() - 2_000).toISOString();
      const newerAt = new Date(Date.now() - 1_000).toISOString();
      const promises = {} as Record<'ordinary' | 'guarded', Promise<LocalLogisticsSnapshot>>;
      const pendingByCaller = {} as Record<'ordinary' | 'guarded', number>;

      try {
        for (const caller of requestOrder) {
          pendingByCaller[caller] = harness.pending.length;
          promises[caller] = caller === 'ordinary'
            ? fetchLocalLogistics(place, { radiusKm: 10 })
            : fetchLocalLogistics(place, { radiusKm: 10, shouldCommit: () => true } as never);
        }
        assert.equal(harness.pending.length, 2);

        const callerForAge = { older: 'ordinary', newer: 'guarded' } as const;
        const timestampForAge = { older: olderAt, newer: newerAt } as const;
        for (const age of completionOrder) {
          const caller = callerForAge[age];
          const pending = harness.pending[pendingByCaller[caller]];
          pending?.response.resolve(emptyLogisticsResponse(place, pending.input, timestampForAge[age]));
          await promises[caller];
        }

        const [foregroundResult, coordinatorResult] = await Promise.all([promises.ordinary, promises.guarded]);
        const fingerprint = buildLocalLogisticsFingerprint(place, 10, [...LOCAL_LOGISTICS_CATEGORIES]);
        const artifact = readOfflineCacheEntry<{ fetchedAt: string }>(
          getLocalLogisticsOfflineCacheServiceId(place.id, fingerprint),
          harness.storage,
        );
        const latest = readOfflineCacheEntry<{ schemaVersion: 2; fingerprint: string }>(
          `local-logistics:v2:latest:${place.id}`,
          harness.storage,
        );
        const manifest = JSON.parse(harness.storage.getItem(`wm_lifeline_pack_manifest_v1:${place.id}`) ?? 'null') as {
          queryFingerprint?: string;
          artifacts?: Array<{ kind?: string; cachedAt?: string }>;
        } | null;

        assert.equal(foregroundResult.fetchedAt.toISOString(), olderAt);
        assert.equal(coordinatorResult.fetchedAt.toISOString(), newerAt);
        assert.equal(artifact?.data.fetchedAt, newerAt);
        assert.equal(getCachedLocalLogistics(place.id)?.fetchedAt.toISOString(), newerAt);
        assert.equal(latest?.data.fingerprint, fingerprint);
        assert.equal(manifest?.queryFingerprint, fingerprint);
        assert.equal(manifest?.artifacts?.find((item) => item.kind === 'lifelines')?.cachedAt, newerAt);
        assert.equal(runtime.getExactPackReadiness(place, 10).status, 'ready');
        assert.deepEqual(runtime.verifyExactSnapshot(place, 10, coordinatorResult), { status: 'ready', exact: true });
        assert.equal(runtime.verifyExactSnapshot(place, 10, foregroundResult), null);
        assert.deepEqual(
          harness.events.map((event) => event.detail?.fetchedAt.toISOString()),
          completionOrder[0] === 'older' ? [olderAt, newerAt] : [newerAt],
        );
      } finally {
        harness.restore();
      }
    });
  }
}

test('equal same-fingerprint completions are one committed duplicate', async () => {
  const place = makePlace({ id: 'monotonic-equal', radiusKm: 10 });
  const harness = installCommitRaceHarness();
  const runtime = createLifelineRuntime(harness.storage, () => Date.now());
  harness.observeEvents((snapshot) => { runtime.processSnapshot(snapshot); });
  const fetchedAt = new Date(Date.now() - 1_000).toISOString();
  try {
    const ordinary = fetchLocalLogistics(place, { radiusKm: 10 });
    const guarded = fetchLocalLogistics(place, { radiusKm: 10, shouldCommit: () => true } as never);
    const fingerprint = buildLocalLogisticsFingerprint(place, 10, [...LOCAL_LOGISTICS_CATEGORIES]);
    const exactStorageKey = `wm_offline_${getLocalLogisticsOfflineCacheServiceId(place.id, fingerprint)}`;

    harness.pending[0]?.response.resolve(emptyLogisticsResponse(place, harness.pending[0].input, fetchedAt));
    const foregroundResult = await ordinary;
    const firstArtifact = harness.storage.getItem(exactStorageKey);
    assert.ok(firstArtifact);

    harness.pending[1]?.response.resolve(emptyLogisticsResponse(place, harness.pending[1].input, fetchedAt));
    const coordinatorResult = await guarded;

    assert.equal(foregroundResult.fetchedAt.toISOString(), fetchedAt);
    assert.equal(coordinatorResult.fetchedAt.toISOString(), fetchedAt);
    assert.equal(harness.storage.getItem(exactStorageKey), firstArtifact);
    assert.equal(harness.events.length, 1);
    assert.equal(runtime.getExactPackReadiness(place, 10).status, 'ready');
    assert.deepEqual(runtime.verifyExactSnapshot(place, 10, coordinatorResult), { status: 'ready', exact: true });
  } finally {
    harness.restore();
  }
});

for (const recoveryAge of ['older', 'equal'] as const) {
  test(`a successful ${recoveryAge} exact completion reconciles readiness after the newer write failed`, async () => {
    const place = makePlace({ id: `write-recovery-${recoveryAge}`, radiusKm: 10 });
    const harness = installCommitRaceHarness({ failExactWrites: 1 });
    const runtime = createLifelineRuntime(harness.storage, () => Date.now());
    harness.observeEvents((snapshot) => { runtime.processSnapshot(snapshot); });
    const newerAt = new Date(Date.now() - 1_000).toISOString();
    const recoveryAt = recoveryAge === 'older'
      ? new Date(Date.now() - 2_000).toISOString()
      : newerAt;
    try {
      const coordinator = fetchLocalLogistics(place, {
        radiusKm: 10,
        shouldCommit: () => true,
      } as never);
      const foreground = fetchLocalLogistics(place, { radiusKm: 10 });
      const fingerprint = buildLocalLogisticsFingerprint(place, 10, [...LOCAL_LOGISTICS_CATEGORIES]);

      harness.pending[0]?.response.resolve(emptyLogisticsResponse(place, harness.pending[0].input, newerAt));
      const coordinatorResult = await coordinator;
      const initialUpdate = runtime.getLatestUpdate(place.id, fingerprint);
      assert.equal(initialUpdate?.pack.status, 'not-saved');
      assert.equal(runtime.verifyExactSnapshot(place, 10, coordinatorResult), null);
      assert.equal(readOfflineCacheEntry(
        getLocalLogisticsOfflineCacheServiceId(place.id, fingerprint),
        harness.storage,
      ), null);

      harness.pending[1]?.response.resolve(emptyLogisticsResponse(place, harness.pending[1].input, recoveryAt));
      const foregroundResult = await foreground;
      const artifact = readOfflineCacheEntry<{ fetchedAt: string }>(
        getLocalLogisticsOfflineCacheServiceId(place.id, fingerprint),
        harness.storage,
      );
      const latest = readOfflineCacheEntry<{ schemaVersion: 2; fingerprint: string }>(
        `local-logistics:v2:latest:${place.id}`,
        harness.storage,
      );
      const manifest = JSON.parse(harness.storage.getItem(`wm_lifeline_pack_manifest_v1:${place.id}`) ?? 'null') as {
        queryFingerprint?: string;
        artifacts?: Array<{ kind?: string; cachedAt?: string }>;
      } | null;
      const recoveredUpdate = runtime.getLatestUpdate(place.id, fingerprint);

      assert.equal(coordinatorResult.fetchedAt.toISOString(), newerAt);
      assert.equal(foregroundResult.fetchedAt.toISOString(), recoveryAt);
      assert.equal(artifact?.data.fetchedAt, recoveryAt);
      assert.equal(getCachedLocalLogistics(place.id)?.fetchedAt.toISOString(), recoveryAt);
      assert.equal(latest?.data.fingerprint, fingerprint);
      assert.equal(manifest?.queryFingerprint, fingerprint);
      assert.equal(manifest?.artifacts?.find((item) => item.kind === 'lifelines')?.cachedAt, recoveryAt);
      assert.equal(recoveredUpdate?.pack.status, 'ready');
      assert.equal(recoveredUpdate?.situation, initialUpdate?.situation);
      assert.equal(recoveredUpdate?.outage, initialUpdate?.outage);
      assert.deepEqual(recoveredUpdate?.changes, initialUpdate?.changes);
      assert.deepEqual(runtime.verifyExactSnapshot(place, 10, foregroundResult), { status: 'ready', exact: true });
      assert.deepEqual(
        runtime.verifyExactSnapshot(place, 10, coordinatorResult),
        recoveryAge === 'equal' ? { status: 'ready', exact: true } : null,
      );
      assert.deepEqual(
        harness.events.map((event) => event.detail?.fetchedAt.toISOString()),
        [newerAt, recoveryAt],
      );
    } finally {
      harness.restore();
    }
  });
}

for (const damagedNewerArtifact of ['evicted', 'malformed'] as const) {
  test(`an older completion replaces a newer exact artifact that was ${damagedNewerArtifact}`, async () => {
    const place = makePlace({ id: `manifest-recovery-${damagedNewerArtifact}`, radiusKm: 10 });
    const harness = installCommitRaceHarness();
    const runtime = createLifelineRuntime(harness.storage, () => Date.now());
    harness.observeEvents((snapshot) => { runtime.processSnapshot(snapshot); });
    const newerAt = new Date(Date.now() - 1_000).toISOString();
    const olderAt = new Date(Date.now() - 2_000).toISOString();
    try {
      const coordinator = fetchLocalLogistics(place, {
        radiusKm: 10,
        shouldCommit: () => true,
      } as never);
      const foreground = fetchLocalLogistics(place, { radiusKm: 10 });
      const fingerprint = buildLocalLogisticsFingerprint(place, 10, [...LOCAL_LOGISTICS_CATEGORIES]);
      const exactServiceId = getLocalLogisticsOfflineCacheServiceId(place.id, fingerprint);
      const exactStorageKey = `wm_offline_${exactServiceId}`;
      const manifestKey = `wm_lifeline_pack_manifest_v1:${place.id}`;

      harness.pending[0]?.response.resolve(emptyLogisticsResponse(place, harness.pending[0].input, newerAt));
      const coordinatorResult = await coordinator;
      const initialUpdate = runtime.getLatestUpdate(place.id, fingerprint);
      assert.equal(initialUpdate?.pack.status, 'ready');
      assert.deepEqual(runtime.verifyExactSnapshot(place, 10, coordinatorResult), { status: 'ready', exact: true });

      if (damagedNewerArtifact === 'evicted') harness.storage.removeItem(exactStorageKey);
      else harness.storage.setItem(exactStorageKey, JSON.stringify({ version: 1, cachedAt: Date.now(), data: { malformed: true } }));
      assert.equal(runtime.getExactPackReadiness(place, 10).status, 'not-saved');

      harness.pending[1]?.response.resolve(emptyLogisticsResponse(place, harness.pending[1].input, olderAt));
      let foregroundResult: LocalLogisticsSnapshot | undefined;
      await assert.doesNotReject(async () => { foregroundResult = await foreground; });

      const artifact = readOfflineCacheEntry<{ fetchedAt: string }>(exactServiceId, harness.storage);
      const latest = readOfflineCacheEntry<{ schemaVersion: 2; fingerprint: string }>(
        `local-logistics:v2:latest:${place.id}`,
        harness.storage,
      );
      const manifest = JSON.parse(harness.storage.getItem(manifestKey) ?? 'null') as {
        createdAt?: string;
        updatedAt?: string;
        artifacts?: Array<{ kind?: string; cachedAt?: string }>;
      } | null;
      const recoveredUpdate = runtime.getLatestUpdate(place.id, fingerprint);

      assert.equal(foregroundResult?.fetchedAt.toISOString(), olderAt);
      assert.equal(artifact?.data.fetchedAt, olderAt);
      assert.equal(latest?.data.fingerprint, fingerprint);
      assert.equal(manifest?.artifacts?.find((item) => item.kind === 'lifelines')?.cachedAt, olderAt);
      assert.equal(manifest?.createdAt, olderAt);
      assert.equal(manifest?.updatedAt, olderAt);
      assert.ok(Date.parse(manifest?.createdAt ?? '') <= Date.parse(manifest?.updatedAt ?? ''));
      assert.equal(recoveredUpdate?.pack.status, 'ready');
      assert.equal(recoveredUpdate?.situation, initialUpdate?.situation);
      assert.equal(recoveredUpdate?.outage, initialUpdate?.outage);
      assert.deepEqual(recoveredUpdate?.changes, initialUpdate?.changes);
      assert.deepEqual(runtime.verifyExactSnapshot(place, 10, foregroundResult as LocalLogisticsSnapshot), {
        status: 'ready',
        exact: true,
      });
      assert.equal(runtime.verifyExactSnapshot(place, 10, coordinatorResult), null);
      assert.deepEqual(
        harness.events.map((event) => event.detail?.fetchedAt.toISOString()),
        [newerAt, olderAt],
      );
    } finally {
      harness.restore();
    }
  });
}

test('representative selection includes one ranked result per category before filling remaining slots', () => {
  const selectRepresentativeLocalLogisticsNodes = requireFeature<(
    snapshot: LocalLogisticsSnapshot,
    category?: LogisticsNode['category'] | 'all',
    limit?: number,
  ) => LogisticsNode[]>('selectRepresentativeLocalLogisticsNodes');
  const snapshot = buildLocalLogisticsSnapshot(makePlace(), [
    makeNode({ id: 'fuel-best', category: 'fuel', distanceKm: 1, operational: 'open', verification: 'official', directoryOnly: false }),
    makeNode({ id: 'fuel-second', category: 'fuel', distanceKm: 2, operational: 'open', verification: 'official', directoryOnly: false }),
    makeNode({ id: 'hospital', category: 'hospital', distanceKm: 4 }),
    makeNode({ id: 'water', category: 'water', distanceKm: 5 }),
  ], { fetchedAt: NOW });

  assert.deepEqual(
    selectRepresentativeLocalLogisticsNodes(snapshot, 'all', 3).map((node) => node.id),
    ['fuel-best', 'hospital', 'water'],
  );
  assert.deepEqual(
    selectRepresentativeLocalLogisticsNodes(snapshot, 'all', 4).map((node) => node.id),
    ['fuel-best', 'hospital', 'water', 'fuel-second'],
  );
  assert.deepEqual(
    selectRepresentativeLocalLogisticsNodes(snapshot, 'fuel', 1).map((node) => node.id),
    ['fuel-best'],
  );
});

test('coverage projection exposes provider scope, TTL, and fail-closed completeness', () => {
  const projectLocalLogisticsCoverage = requireFeature<(
    snapshot: LocalLogisticsSnapshot,
    now?: number,
  ) => { providers: LifelineProviderCoverage[]; categories: LifelineCategoryCoverage[] }>(
    'projectLocalLogisticsCoverage',
  );
  const providers: ProviderStatus[] = [
    { id: 'osm', state: 'empty', acceptedRows: 0, droppedRows: 0, observedAt: NOW, retrievedAt: NOW },
    { id: 'fema-open-shelters', state: 'ok', acceptedRows: 1, droppedRows: 0, observedAt: NOW, retrievedAt: NOW },
    { id: 'fema-recovery-centers', state: 'partial', acceptedRows: 1, droppedRows: 3, observedAt: NOW, retrievedAt: NOW },
    { id: 'ornl-odin', state: 'empty', acceptedRows: 0, droppedRows: 0, observedAt: NOW, retrievedAt: NOW },
  ];
  const snapshot = buildLocalLogisticsSnapshot(makePlace(), [], {
    fetchedAt: NOW,
    categories: ['fuel', 'shelter', 'recovery'],
    providers,
  });

  const coverage = projectLocalLogisticsCoverage(snapshot, NOW.getTime());
  const providerById = new Map(coverage.providers.map((provider) => [provider.providerId, provider]));
  const categoryById = new Map(coverage.categories.map((category) => [category.category, category]));
  assert.deepEqual(providerById.get('osm'), {
    providerId: 'osm',
    state: 'current-complete',
    facilityCategories: ['fuel', 'shelter'],
    retrievedAt: NOW,
    projectedExpiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
    acceptedRows: 0,
    droppedRows: 0,
    scope: 'facilities',
  });
  assert.deepEqual(providerById.get('fema-open-shelters'), {
    providerId: 'fema-open-shelters',
    state: 'current-complete',
    facilityCategories: ['shelter'],
    retrievedAt: NOW,
    projectedExpiresAt: new Date(NOW.getTime() + 30 * 60 * 1000),
    acceptedRows: 1,
    droppedRows: 0,
    scope: 'facilities',
  });
  assert.deepEqual(providerById.get('fema-recovery-centers'), {
    providerId: 'fema-recovery-centers',
    state: 'current-partial',
    facilityCategories: ['recovery'],
    retrievedAt: NOW,
    projectedExpiresAt: new Date(NOW.getTime() + 30 * 60 * 1000),
    acceptedRows: 1,
    droppedRows: 3,
    scope: 'facilities',
  });
  assert.deepEqual(providerById.get('ornl-odin'), {
    providerId: 'ornl-odin',
    state: 'unavailable',
    facilityCategories: [],
    retrievedAt: NOW,
    projectedExpiresAt: new Date(NOW.getTime() + 30 * 60 * 1000),
    acceptedRows: 0,
    droppedRows: 0,
    scope: 'county-outage-context',
  });

  assert.deepEqual(categoryById.get('fuel'), {
    category: 'fuel', state: 'proven-current', requiredProviders: ['osm'],
    expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
  });
  assert.deepEqual(categoryById.get('shelter'), {
    category: 'shelter', state: 'proven-current', requiredProviders: ['osm', 'fema-open-shelters'],
    expiresAt: new Date(NOW.getTime() + 30 * 60 * 1000),
  });
  assert.deepEqual(categoryById.get('recovery'), {
    category: 'recovery', state: 'not-proven', requiredProviders: ['fema-recovery-centers'], expiresAt: null,
  });
});

test('coverage expires at the exact boundary and unavailable providers never prove categories', () => {
  const projectLocalLogisticsCoverage = requireFeature<(
    snapshot: LocalLogisticsSnapshot,
    now?: number,
  ) => { providers: LifelineProviderCoverage[]; categories: LifelineCategoryCoverage[] }>(
    'projectLocalLogisticsCoverage',
  );
  const femaRetrievedAt = new Date(NOW.getTime() - 30 * 60 * 1000);
  const providers: ProviderStatus[] = [
    { id: 'osm', state: 'error', acceptedRows: 0, droppedRows: 0, observedAt: null },
    {
      id: 'fema-open-shelters', state: 'empty', acceptedRows: 0, droppedRows: 0,
      observedAt: femaRetrievedAt, retrievedAt: femaRetrievedAt,
    },
  ];
  const snapshot = buildLocalLogisticsSnapshot(makePlace(), [], {
    fetchedAt: NOW,
    categories: ['fuel', 'shelter'],
    providers,
  });
  const coverage = projectLocalLogisticsCoverage(snapshot, NOW.getTime());
  const providerStates = Object.fromEntries(coverage.providers.map((provider) => [provider.providerId, provider.state]));
  const categoryStates = Object.fromEntries(coverage.categories.map((category) => [category.category, category.state]));
  const exactStates: Record<string, LifelineCoverageState> = {
    osm: 'unavailable',
    'fema-open-shelters': 'expired',
  };

  assert.deepEqual(providerStates, exactStates);
  assert.deepEqual(categoryStates, { fuel: 'not-proven', shelter: 'not-proven' });
  assert.equal(coverage.providers.find((provider) => provider.providerId === 'fema-open-shelters')?.projectedExpiresAt?.getTime(), NOW.getTime());
  assert.ok(coverage.categories.every((category) => category.expiresAt === null));
});

test('dropped provider rows downgrade nominally complete coverage and cannot prove none reported', () => {
  const projectLocalLogisticsCoverage = requireFeature<(
    snapshot: LocalLogisticsSnapshot,
    now?: number,
  ) => { providers: LifelineProviderCoverage[]; categories: LifelineCategoryCoverage[] }>(
    'projectLocalLogisticsCoverage',
  );
  const snapshot = buildLocalLogisticsSnapshot(makePlace(), [], {
    fetchedAt: NOW,
    categories: ['fuel'],
    providers: [{
      id: 'osm', state: 'empty', acceptedRows: 0, droppedRows: 1, observedAt: NOW, retrievedAt: NOW,
    }],
  });

  const coverage = projectLocalLogisticsCoverage(snapshot, NOW.getTime());
  assert.equal(coverage.providers[0]?.state, 'current-partial');
  assert.deepEqual(coverage.categories[0], {
    category: 'fuel', state: 'not-proven', requiredProviders: ['osm'], expiresAt: null,
  });
});

test('outage coverage projects exact independent reports and post-reconciliation telemetry without summing', () => {
  const projectLocalLogisticsOutageCoverage = requireFeature<(
    snapshot: LocalLogisticsSnapshot,
    now?: number,
  ) => Record<string, unknown>>('projectLocalLogisticsOutageCoverage');
  const earlierRetrieval = new Date(NOW.getTime() - 10 * 60_000);
  const snapshot = buildLocalLogisticsSnapshot(makePlace(), [], {
    fetchedAt: NOW,
    countyFips: '37183',
    areaConditions: [
      makeOutageCondition(),
      makeOutageCondition({
        id: 'ornl-odin:37183:utility-2',
        customersOut: 23,
        utilityName: undefined,
        utilityId: undefined,
        retrievedAt: earlierRetrieval,
        observedAt: earlierRetrieval,
        sourceObservedAt: undefined,
        expiresAt: new Date(NOW.getTime() + 20 * 60_000),
      }),
    ],
    providers: [{
      id: 'ornl-odin', state: 'partial', acceptedRows: 2, droppedRows: 3,
      observedAt: NOW, retrievedAt: NOW, sourceObservedAt: new Date(NOW.getTime() - 60_000),
    }],
  });

  assert.deepEqual(projectLocalLogisticsOutageCoverage(snapshot, NOW.getTime()), {
    sourceId: 'ornl-odin',
    sourceLabel: 'ORNL ODIN',
    state: 'reported-current-partial',
    queryCountyFips: '37183',
    acceptedRowsBeforeReconciliation: null,
    acceptedRowsAvailability: 'not-retained',
    droppedRows: 3,
    contributedRows: 2,
    currentContributedRows: 2,
    providerRetrievedAt: NOW,
    providerSourceObservedAt: new Date(NOW.getTime() - 60_000),
    providerFreshnessExpiresAt: new Date(NOW.getTime() + 30 * 60_000),
    independentlyCorroborated: false,
    claims: [
      {
        sourceId: 'ornl-odin', sourceLabel: 'ORNL ODIN', countyFips: '37183',
        county: 'Wake', state: 'North Carolina', utilityName: 'Example Electric',
        utilityId: 'utility-1', customersOut: 17, retrievedAt: NOW,
        sourceObservedAt: new Date(NOW.getTime() - 5 * 60_000),
        expiresAt: new Date(NOW.getTime() + 30 * 60_000), freshness: 'current',
      },
      {
        sourceId: 'ornl-odin', sourceLabel: 'ORNL ODIN', countyFips: '37183',
        county: 'Wake', state: 'North Carolina', utilityName: null,
        utilityId: null, customersOut: 23, retrievedAt: earlierRetrieval,
        sourceObservedAt: null, expiresAt: new Date(NOW.getTime() + 20 * 60_000),
        freshness: 'current',
      },
    ],
  });
});

test('outage coverage reports exact current, expired, geography, availability, and no-contribution states', () => {
  const projectLocalLogisticsOutageCoverage = requireFeature<(
    snapshot: LocalLogisticsSnapshot,
    now?: number,
  ) => { state: string; claims: Array<{ freshness: string }>; currentContributedRows: number }>(
    'projectLocalLogisticsOutageCoverage',
  );
  const snapshot = (overrides: Partial<LocalLogisticsSnapshot>): LocalLogisticsSnapshot =>
    buildLocalLogisticsSnapshot(makePlace(), [], {
      fetchedAt: NOW,
      countyFips: '37183',
      areaConditions: [makeOutageCondition()],
      providers: [{
        id: 'ornl-odin', state: 'ok', acceptedRows: 1, droppedRows: 0,
        observedAt: NOW, retrievedAt: NOW,
      }],
      ...overrides,
    });

  assert.equal(projectLocalLogisticsOutageCoverage(snapshot({}), NOW.getTime()).state, 'reported-current');
  assert.equal(projectLocalLogisticsOutageCoverage(snapshot({ countyFips: undefined }), NOW.getTime()).state, 'unknown-geography');
  assert.equal(projectLocalLogisticsOutageCoverage(snapshot({ providers: [] }), NOW.getTime()).state, 'unknown-unavailable');
  assert.equal(projectLocalLogisticsOutageCoverage(snapshot({
    providers: [{ id: 'ornl-odin', state: 'error', acceptedRows: 0, droppedRows: 4, observedAt: null }],
  }), NOW.getTime()).state, 'unknown-unavailable');
  assert.equal(projectLocalLogisticsOutageCoverage(snapshot({
    areaConditions: [],
    providers: [{ id: 'ornl-odin', state: 'empty', acceptedRows: 0, droppedRows: 0, observedAt: NOW, retrievedAt: NOW }],
  }), NOW.getTime()).state, 'unknown-no-contributions');

  const expired = projectLocalLogisticsOutageCoverage(snapshot({
    areaConditions: [makeOutageCondition({ expiresAt: NOW })],
  }), NOW.getTime());
  assert.equal(expired.state, 'unknown-expired');
  assert.equal(expired.currentContributedRows, 0);
  assert.deepEqual(expired.claims.map((claim) => claim.freshness), ['expired']);
});

test('fresh empty ODIN is unavailable for coverage while bounded empty facility providers remain complete', () => {
  const projectLocalLogisticsCoverage = requireFeature<(
    snapshot: LocalLogisticsSnapshot,
    now?: number,
  ) => { providers: LifelineProviderCoverage[] }>('projectLocalLogisticsCoverage');
  const snapshot = buildLocalLogisticsSnapshot(makePlace(), [], {
    fetchedAt: NOW,
    countyFips: '37183',
    categories: ['fuel', 'shelter', 'recovery'],
    providers: [
      { id: 'osm', state: 'empty', acceptedRows: 0, droppedRows: 0, observedAt: NOW, retrievedAt: NOW },
      { id: 'fema-open-shelters', state: 'empty', acceptedRows: 0, droppedRows: 0, observedAt: NOW, retrievedAt: NOW },
      { id: 'fema-recovery-centers', state: 'empty', acceptedRows: 0, droppedRows: 0, observedAt: NOW, retrievedAt: NOW },
      { id: 'ornl-odin', state: 'empty', acceptedRows: 0, droppedRows: 0, observedAt: NOW, retrievedAt: NOW },
    ],
  });
  const states = Object.fromEntries(
    projectLocalLogisticsCoverage(snapshot, NOW.getTime()).providers
      .map((provider) => [provider.providerId, provider.state]),
  );

  assert.deepEqual(states, {
    osm: 'current-complete',
    'fema-open-shelters': 'current-complete',
    'fema-recovery-centers': 'current-complete',
    'ornl-odin': 'unavailable',
  });
});

test('rankLocalLogisticsNodes prioritizes viable nodes before nearer unknown nodes', () => {
  const ranked = rankLocalLogisticsNodes([
 makeNode({ id: 'fuel-unknown', category: 'fuel', distanceKm: 2 }),
 makeNode({ id: 'hospital-open', category: 'hospital', distanceKm: 6, operational: 'open', directoryOnly: false, verification: 'official' }),
 makeNode({ id: 'water-limited', category: 'water', distanceKm: 4, inventory: 'limited', directoryOnly: false, verification: 'official' }),
  ], NOW.getTime());

  assert.deepEqual(
 ranked.map((node) => node.id),
 ['hospital-open', 'water-limited', 'fuel-unknown'],
  );
});

test('buildLocalLogisticsSnapshot preserves place identity and derives category coverage', () => {
  const snapshot = buildLocalLogisticsSnapshot(
 makePlace(),
 [
 makeNode({ id: 'hospital-1', category: 'hospital' }),
 makeNode({ id: 'fuel-1', category: 'fuel' }),
 makeNode({ id: 'water-1', category: 'water' }),
 ],
 { fetchedAt: NOW, source: 'network' },
  );

  assert.equal(snapshot.placeId, 'place-home');
  assert.equal(snapshot.placeName, 'Home');
  assert.deepEqual(snapshot.categories, ['fuel', 'hospital', 'water']);
  assert.equal(snapshot.nodes.length, 3);
  assert.equal(snapshot.isStale, false);
});

test('buildLocalLogisticsBriefItems yields concise place-brief entries', () => {
  const snapshot = buildLocalLogisticsSnapshot(
 makePlace(),
 [
 makeNode({ id: 'hospital-1', category: 'hospital', name: 'Duke Hospital', distanceKm: 3.2, operational: 'open', verification: 'official', directoryOnly: false }),
 makeNode({ id: 'pharmacy-1', category: 'pharmacy', name: '24h Pharmacy', distanceKm: 1.4, inventory: 'limited', verification: 'official', directoryOnly: false }),
 makeNode({ id: 'fuel-1', category: 'fuel', name: 'Fuel Depot', distanceKm: 5.8 }),
 ],
 { fetchedAt: NOW, source: 'network' },
  );

  const items = buildLocalLogisticsBriefItems(snapshot, 2);

  assert.equal(items.length, 2);
  assert.match(items[0]?.label ?? '', /Hospital|Pharmacy|Fuel/);
  assert.match(items[0]?.value ?? '', /km/);
});

test('strict v2 parsing keeps only valid sites and observations and adds hotels', () => {
  const parsed = parseLocalLogisticsApiResponse(makePlace(), {
 schemaVersion: 2,
 query: { lat: 35.994, lon: -78.8986, radiusKm: 25, categories: ['hotel'], countyFips: '37183' },
 sites: [{
 id: 'hotel:1', kind: 'hotel', name: 'Safe Hotel', lat: 35.99, lon: -78.9,
 sourceRefs: [{ provider: 'osm', recordId: '1' }], capabilities: { lodgingType: 'hotel' },
 }],
 observations: [{
 id: 'obs:1', siteId: 'hotel:1', provider: 'osm', verification: 'directory',
 operational: 'unknown', inventory: 'unknown', power: 'unknown', access: 'unknown',
 observedAt: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
 confidence: 'low', sourceUrl: 'https://www.openstreetmap.org/node/1',
 }, {
 id: 'obs:bad', siteId: 'hotel:1', provider: 'osm', verification: 'directory',
 operational: 'probably-open', inventory: 'unknown', power: 'unknown', access: 'unknown',
 observedAt: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
 confidence: 'certain', sourceUrl: 'https://example.com',
 }],
 providers: [{ id: 'osm', state: 'ok', acceptedRows: 1, droppedRows: 0, observedAt: NOW.toISOString() }],
 fetchedAt: NOW.toISOString(), partial: false,
  }, NOW.getTime());

  assert.equal(parsed.nodes.length, 1);
  assert.equal(parsed.nodes[0]?.category, 'hotel');
  assert.equal(parsed.nodes[0]?.operational, 'unknown');
  assert.equal(parsed.providers[0]?.id, 'osm');
  assert.equal(parsed.countyFips, '37183');
  assert.equal(parsed.effectiveRadiusKm, 25);
});

test('strict v2 parsing separates retrieval time from an upstream report timestamp', () => {
  const retrievedAt = '2026-03-29T19:00:00.000Z';
  const sourceObservedAt = '2026-03-29T18:30:00.000Z';
  const parsed = parseLocalLogisticsApiResponse(makePlace(), {
    schemaVersion: 2,
    query: { lat: 35.994, lon: -78.8986, radiusKm: 25, categories: ['recovery'] },
    sites: [{
      id: 'fema:recovery:1', kind: 'recovery', name: 'FEMA Recovery Center',
      lat: 35.99, lon: -78.9,
      sourceRefs: [{ provider: 'fema', recordId: '1' }], capabilities: {},
    }],
    observations: [{
      id: 'fema:recovery:1:retrieval', siteId: 'fema:recovery:1', provider: 'fema',
      verification: 'official', operational: 'open', inventory: 'unknown', power: 'unknown', access: 'unknown',
      observedAt: retrievedAt, retrievedAt, sourceObservedAt,
      expiresAt: '2026-03-29T19:30:00.000Z', confidence: 'high',
      sourceUrl: 'https://gis.fema.gov/arcgis/rest/services/FEMA/DRC_Services_Relate/FeatureServer/0',
    }],
    providers: [{
      id: 'fema-recovery-centers', state: 'ok', acceptedRows: 1, droppedRows: 0,
      observedAt: retrievedAt, retrievedAt,
    }],
    fetchedAt: retrievedAt,
    retrievedAt,
  }, NOW.getTime());

  assert.equal(parsed.nodes[0]?.category, 'recovery');
  assert.equal(parsed.nodes[0]?.source, 'FEMA Disaster Recovery Centers');
  assert.equal(parsed.observations[0]?.retrievedAt?.toISOString(), retrievedAt);
  assert.equal(parsed.observations[0]?.sourceObservedAt?.toISOString(), sourceObservedAt);
  assert.equal(parsed.providers[0]?.retrievedAt?.toISOString(), retrievedAt);
  assert.equal(parsed.retrievedAt.toISOString(), retrievedAt);
});

test('strict v2 parsing rejects fabricated or malformed upstream timestamps', () => {
  assert.throws(() => parseLocalLogisticsApiResponse(makePlace(), {
    schemaVersion: 2,
    query: { lat: 35.994, lon: -78.8986, radiusKm: 25, categories: ['recovery'] },
    sites: [{
      id: 'fema:recovery:1', kind: 'recovery', name: 'FEMA Recovery Center', lat: 35.99, lon: -78.9,
      sourceRefs: [{ provider: 'fema', recordId: '1' }], capabilities: {},
    }],
    observations: [{
      id: 'bad-time', siteId: 'fema:recovery:1', provider: 'fema', verification: 'official',
      operational: 'open', inventory: 'unknown', power: 'unknown', access: 'unknown',
      observedAt: NOW.toISOString(), retrievedAt: NOW.toISOString(), sourceObservedAt: 'not-a-date',
      expiresAt: new Date(NOW.getTime() + 60_000).toISOString(), confidence: 'high',
      sourceUrl: 'https://gis.fema.gov/arcgis/rest/services/FEMA/DRC_Services_Relate/FeatureServer/0',
    }],
    providers: [{
      id: 'fema-recovery-centers', state: 'ok', acceptedRows: 1, droppedRows: 0,
      observedAt: NOW.toISOString(), retrievedAt: NOW.toISOString(),
    }],
    fetchedAt: NOW.toISOString(),
  }, NOW.getTime()), /observations failed validation/);
  for (const timestamp of ['2026-03-29T19:00:00', '03/29/2026', '2026-02-30T19:00:00Z']) {
    assert.throws(() => parseLocalLogisticsApiResponse(makePlace(), {
      schemaVersion: 2,
      query: { lat: 35.994, lon: -78.8986, radiusKm: 25, categories: ['recovery'] },
      sites: [], observations: [],
      providers: [{ id: 'fema-recovery-centers', state: 'empty', acceptedRows: 0, droppedRows: 0, observedAt: timestamp }],
      fetchedAt: timestamp,
    }, NOW.getTime()), /timestamp|providers failed validation/);
  }
});

test('strict v2 parsing rejects directory availability claims and mismatched site provenance', () => {
  const site = {
    id: 'osm:fuel:1', kind: 'fuel', name: 'Directory Fuel', lat: 35.99, lon: -78.9,
    sourceRefs: [{ provider: 'osm', recordId: '1' }], capabilities: {},
  };
  const baseObservation = {
    id: 'obs:1', siteId: site.id, provider: 'osm', verification: 'directory',
    operational: 'unknown', inventory: 'unknown', power: 'unknown', access: 'unknown',
    observedAt: NOW.toISOString(), retrievedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 60_000).toISOString(), confidence: 'low',
    sourceUrl: 'https://www.openstreetmap.org/node/1',
  };
  const payload = (observation: Record<string, unknown>) => ({
    schemaVersion: 2,
    query: { lat: 35.994, lon: -78.8986, radiusKm: 25, categories: ['fuel'] },
    sites: [site], observations: [observation],
    providers: [{ id: 'osm', state: 'ok', acceptedRows: 1, droppedRows: 0, observedAt: NOW.toISOString() }],
    fetchedAt: NOW.toISOString(),
  });

  assert.throws(() => parseLocalLogisticsApiResponse(makePlace(), payload({
    ...baseObservation, operational: 'open', inventory: 'available', confidence: 'high',
  }), NOW.getTime()), /observations failed validation/);
  assert.throws(() => parseLocalLogisticsApiResponse(makePlace(), payload({
    ...baseObservation, provider: 'fema', verification: 'official', operational: 'open', confidence: 'high',
    sourceUrl: 'https://gis.fema.gov/arcgis/rest/services/NSS/OpenShelters/FeatureServer',
  }), NOW.getTime()), /observations failed validation/);
});

test('strict v2 parsing rejects mismatched queries, phantom provider health, future retrievals, and overlong TTLs', () => {
  const base = {
    schemaVersion: 2,
    query: { lat: 35.994, lon: -78.8986, radiusKm: 25, categories: ['hotel'] },
    sites: [{
      id: 'osm:hotel:1', kind: 'hotel', name: 'Directory Hotel', lat: 35.99, lon: -78.9,
      distanceKm: 0, sourceRefs: [{ provider: 'osm', recordId: '1' }], capabilities: {},
    }],
    observations: [{
      id: 'obs:1', siteId: 'osm:hotel:1', provider: 'osm', verification: 'directory',
      operational: 'unknown', inventory: 'unknown', power: 'unknown', access: 'unknown',
      observedAt: NOW.toISOString(), retrievedAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString(), confidence: 'low',
      sourceUrl: 'https://www.openstreetmap.org/node/1',
    }],
    providers: [{ id: 'osm', state: 'ok', acceptedRows: 1, droppedRows: 0, observedAt: NOW.toISOString() }],
    fetchedAt: NOW.toISOString(), retrievedAt: NOW.toISOString(),
  };
  assert.throws(() => parseLocalLogisticsApiResponse(makePlace(), {
    ...base, query: { ...base.query, lat: 36 },
  }, NOW.getTime()), /location mismatch/);
  assert.throws(() => parseLocalLogisticsApiResponse(makePlace(), {
    ...base, query: { ...base.query, categories: ['hotel', 'evil'] },
  }, NOW.getTime()), /categories/);
  assert.throws(() => parseLocalLogisticsApiResponse(makePlace(), {
    ...base, providers: [{ ...base.providers[0], id: 'fema-open-shelters' }],
  }, NOW.getTime()), /provider coverage mismatch/);
  assert.throws(() => parseLocalLogisticsApiResponse(makePlace(), {
    ...base,
    fetchedAt: new Date(NOW.getTime() + 10 * 60 * 1000).toISOString(),
    retrievedAt: new Date(NOW.getTime() + 10 * 60 * 1000).toISOString(),
  }, NOW.getTime()), /retrieval timestamp/);
  assert.throws(() => parseLocalLogisticsApiResponse(makePlace(), {
    ...base,
    observations: [{ ...base.observations[0], expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000 + 1).toISOString() }],
  }, NOW.getTime()), /observations failed validation/);
  assert.throws(() => parseLocalLogisticsApiResponse(makePlace(), {
    ...base, sites: Array.from({ length: 36 }, () => base.sites[0]),
  }, NOW.getTime()), /oversized/);
  assert.throws(() => parseLocalLogisticsApiResponse(makePlace(), {
    ...base, providers: [{ ...base.providers[0], acceptedRows: 1e20 }],
  }, NOW.getTime()), /providers failed validation/);

  const parsed = parseLocalLogisticsApiResponse(makePlace(), base, NOW.getTime());
  assert.notEqual(parsed.sites[0]?.distanceKm, 0, 'client recomputes distance instead of trusting the server');
});

test('offline snapshot validation binds identity, distance, county, provenance, and timestamps', () => {
  const fingerprint = buildLocalLogisticsFingerprint(makePlace(), 25, ['recovery'], 3);
  const sourceObservedAt = '2026-03-29T18:30:00.000Z';
  const cached = {
    schemaVersion: 2,
    queryFingerprint: fingerprint,
    placeId: 'place-home', placeName: 'Home', effectiveRadiusKm: 25, countyFips: '37183',
    categories: ['recovery'],
    sites: [{
      id: 'fema:recovery:1', kind: 'recovery', name: 'Recovery Center', lat: 35.99, lon: -78.9,
      distanceKm: 0, sourceRefs: [{ provider: 'fema', recordId: '1' }], capabilities: {},
    }],
    observations: [{
      id: 'obs:1', siteId: 'fema:recovery:1', provider: 'fema', verification: 'official',
      operational: 'open', inventory: 'unknown', power: 'unknown', access: 'unknown',
      observedAt: NOW.toISOString(), retrievedAt: NOW.toISOString(), sourceObservedAt,
      expiresAt: new Date(NOW.getTime() + 30 * 60 * 1000).toISOString(), confidence: 'high',
      sourceUrl: 'https://gis.fema.gov/arcgis/rest/services/FEMA/DRC_Services_Relate/FeatureServer/0',
    }],
    nodes: [],
    areaConditions: [{
      id: 'ornl-odin:37183:utility', type: 'power_outage', coverage: 'reported', countyFips: '37183',
      county: 'Wake', state: 'North Carolina', customersOut: 12,
      observedAt: NOW.toISOString(), retrievedAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 30 * 60 * 1000).toISOString(), source: 'ornl-odin',
    }],
    providers: [
      { id: 'fema-recovery-centers', state: 'ok', acceptedRows: 1, droppedRows: 0, observedAt: NOW.toISOString(), retrievedAt: NOW.toISOString() },
      { id: 'ornl-odin', state: 'ok', acceptedRows: 1, droppedRows: 0, observedAt: NOW.toISOString(), retrievedAt: NOW.toISOString() },
    ],
    fetchedAt: NOW.toISOString(),
  };
  const expected = { placeId: 'place-home', queryFingerprint: fingerprint, lat: 35.994, lon: -78.8986 };
  const parsed = deserializeLocalLogisticsSnapshot(cached, NOW.getTime(), expected);
  assert.ok(parsed);
  assert.ok((parsed.nodes[0]?.distanceKm ?? 0) > 0, 'forged cached distance is recomputed');
  assert.equal(parsed.observations[0]?.sourceObservedAt?.toISOString(), sourceObservedAt);
  assert.equal(parsed.areaConditions[0]?.retrievedAt?.toISOString(), NOW.toISOString());
  assert.equal(deserializeLocalLogisticsSnapshot({ ...cached, placeId: 'other' }, NOW.getTime(), expected), null);
  assert.equal(deserializeLocalLogisticsSnapshot({ ...cached, queryFingerprint: fingerprint.replace('35.99400', '36.00000') }, NOW.getTime(), expected), null);
  assert.equal(deserializeLocalLogisticsSnapshot({
    ...cached,
    areaConditions: [{ ...cached.areaConditions[0], countyFips: '37181' }],
  }, NOW.getTime(), expected), null);
  assert.equal(deserializeLocalLogisticsSnapshot({
    ...cached,
    observations: [{ ...cached.observations[0], inventory: 'available' }],
  }, NOW.getTime(), expected), null);
  assert.equal(deserializeLocalLogisticsSnapshot({
    ...cached, nodes: Array.from({ length: 36 }, () => ({})),
  }, NOW.getTime(), expected), null);
  assert.equal(deserializeLocalLogisticsSnapshot({
    ...cached,
    areaConditions: [{ ...cached.areaConditions[0], customersOut: 1e20 }],
  }, NOW.getTime(), expected), null);

  const eventSnapshot = {
    ...parsed,
    source: 'network' as const,
    isStale: false,
    isExpired: false,
    staleAgeMs: 0,
  };
  const validatedEvent = validateLocalLogisticsSnapshotEvent(eventSnapshot, NOW.getTime());
  assert.ok(validatedEvent, 'a genuine Date-backed renderer snapshot passes the event boundary');
  assert.equal(validatedEvent.source, 'network');
  assert.equal(validatedEvent.nodes[0]?.id, 'fema:recovery:1');
  assert.equal(validateLocalLogisticsSnapshotEvent({ ...eventSnapshot, fetchedAt: {} }, NOW.getTime()), null);
  assert.equal(validateLocalLogisticsSnapshotEvent({
    ...eventSnapshot,
    providers: [null, ...eventSnapshot.providers.slice(1)],
  }, NOW.getTime()), null);
  assert.equal(validateLocalLogisticsSnapshotEvent({
    ...eventSnapshot,
    fetchedAt: new Date(NOW.getTime() + 10 * 60_000),
  }, NOW.getTime()), null);
  assert.equal(validateLocalLogisticsSnapshotEvent({ ...eventSnapshot, source: 'script' }, NOW.getTime()), null);
});

test('expired observations rank as unknown and never ahead of current official availability', () => {
  const ranked = rankLocalLogisticsNodes([
 makeNode({ id: 'expired', operational: 'open', verification: 'official', directoryOnly: false, expiresAt: new Date(NOW.getTime() - 1) }),
 makeNode({ id: 'current', operational: 'open', verification: 'official', directoryOnly: false, expiresAt: new Date(NOW.getTime() + 60_000), distanceKm: 9 }),
  ], NOW.getTime());
  assert.deepEqual(ranked.map((node) => node.id), ['current', 'expired']);
});

test('fingerprint isolates coordinate, radius, category, and schema changes', () => {
  const base = buildLocalLogisticsFingerprint(makePlace(), 25, ['fuel']);
  assert.notEqual(base, buildLocalLogisticsFingerprint(makePlace({ lat: 36 }), 25, ['fuel']));
  assert.notEqual(base, buildLocalLogisticsFingerprint(makePlace(), 30, ['fuel']));
  assert.notEqual(base, buildLocalLogisticsFingerprint(makePlace(), 25, ['hotel']));
  assert.notEqual(base, buildLocalLogisticsFingerprint(makePlace(), 25, ['fuel'], 5));
  assert.match(base, /^v2\|/);
});

test('edited saved-place coordinates cannot share the old default cache fingerprint', () => {
  const oldLocation = makePlace({ lat: 41.61, lon: -86.72, radiusKm: 50 });
  const editedLocation = makePlace({ lat: 41.72, lon: -86.90, radiusKm: 50 });
  const oldFingerprint = buildLocalLogisticsFingerprint(oldLocation, 25, [...LOCAL_LOGISTICS_CATEGORIES]);
  const currentFingerprint = buildLocalLogisticsFingerprint(editedLocation, 25, [...LOCAL_LOGISTICS_CATEGORIES]);
  assert.notEqual(oldFingerprint, currentFingerprint);
});

test('current-place cache lookup rejects a prior-location snapshot with the same place id', async () => {
  const oldLocation = makePlace({ id: 'moved-place', lat: 41.61, lon: -86.72, radiusKm: 50 });
  const editedLocation = makePlace({ id: 'moved-place', lat: 41.72, lon: -86.90, radiusKm: 50 });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
 schemaVersion: 2,
 query: { lat: oldLocation.lat, lon: oldLocation.lon, radiusKm: 25, categories: [...LOCAL_LOGISTICS_CATEGORIES] },
 sites: [], observations: [], providers: [
   { id: 'osm', state: 'empty', acceptedRows: 0, droppedRows: 0, observedAt: new Date().toISOString() },
   { id: 'fema-open-shelters', state: 'empty', acceptedRows: 0, droppedRows: 0, observedAt: new Date().toISOString() },
   { id: 'fema-recovery-centers', state: 'empty', acceptedRows: 0, droppedRows: 0, observedAt: new Date().toISOString() },
 ], fetchedAt: new Date().toISOString(), partial: false,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  try {
 await fetchLocalLogistics(oldLocation);
 assert.ok(getCachedLocalLogistics(oldLocation));
 assert.equal(getCachedLocalLogistics(editedLocation), null);
  } finally {
 globalThis.fetch = originalFetch;
  }
});
