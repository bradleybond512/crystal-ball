import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmergencyPackCoordinator } from '../emergency-pack-coordinator.ts';
import { NOW } from './test-support.mts';

interface Place {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusKm: number;
}

interface Scope {
  placeId: string;
  profileFingerprint: string;
}

interface State {
  status: 'ready' | 'partial' | 'expired' | 'not-saved';
  packId: string | null;
  profileFingerprint: string;
}

interface RuntimeApi {
  createEmergencyPackRuntime?: (dependencies: Record<string, unknown>) => {
    hydrate: () => Promise<void>;
    getState: (place: Place) => State;
    capture: (place: Place, contactConsent: boolean) => Promise<State>;
    subscribe: (listener: (state: State) => void) => () => void;
    destroy: () => void;
  };
  getEmergencyPackState?: (place: Place) => State;
  captureEmergencyPack?: (place: Place, contactConsent: boolean) => Promise<State>;
  subscribeEmergencyPack?: (listener: () => void) => () => void;
  readLegacyLifelinePackManifestV1?: (
    storage: { getItem(key: string): string | null },
    placeId: string,
  ) => unknown | null;
}

const api = await import('../emergency-pack-runtime.ts').catch(() => ({} as RuntimeApi)) as RuntimeApi;

function requireFunction<K extends keyof RuntimeApi>(name: K): NonNullable<RuntimeApi[K]> {
  const value = api[name];
  assert.equal(typeof value, 'function', `${String(name)} should be exported`);
  return value as NonNullable<RuntimeApi[K]>;
}

function place(id: string, index = 0): Place {
  return {
    id,
    name: `Place ${id}`,
    lat: 41.6 + index / 100,
    lon: -86.7 - index / 100,
    radiusKm: 25 + index,
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface HarnessOptions {
  legacyManifest?: unknown;
  lifelinesArtifact?: {
    kind: 'lifelines';
    body: string;
    expiresAt: number;
    semanticState: 'verified';
    summary: string;
    itemCount: number;
  };
  recoveryGate?: Promise<void>;
}

function createHarness(initialPlaces = [place('home')], options: HarnessOptions = {}) {
  let places = initialPlaces;
  const callbacks = new Map<string, () => void>();
  const unsubscribed: string[] = [];
  const authoritative = new Map<string, State>();
  const profile = (candidate: Place) => JSON.stringify([2, candidate.id, candidate.lat, candidate.lon, candidate.radiusKm]);
  const adapters = { metadata: { id: 'metadata' }, bodies: { id: 'bodies' }, digest: async () => 'digest' };
  const compositions: string[] = [];
  const sourcePlaces: string[] = [];
  const pruneCalls: Array<{ placeIds: string[]; maxPlaces: number; generationsPerPlace: number }> = [];
  const migrationCalls: unknown[] = [];
  let commitCalls = 0;

  const store = {
    async readActive(scope: Scope): Promise<State> {
      return authoritative.get(scope.profileFingerprint) ?? {
        status: 'not-saved', packId: null, profileFingerprint: scope.profileFingerprint,
      };
    },
    async recoverActive(scope: Scope): Promise<State> {
      await options.recoveryGate;
      return this.readActive(scope);
    },
    async commitGeneration(input: { placeId: string; profileFingerprint: string }): Promise<{ ok: boolean; packId: string }> {
      commitCalls += 1;
      const state: State = {
        status: 'ready', packId: `pack-${input.placeId}`, profileFingerprint: input.profileFingerprint,
      };
      authoritative.set(input.profileFingerprint, state);
      return { ok: true, packId: state.packId! };
    },
    async migrateLifelineGeneration(input: {
      placeId: string;
      profileFingerprint: string;
      legacyQueryFingerprint: string;
      legacyManifest: unknown;
      artifact: { kind: string };
    }): Promise<{ ok: boolean; packId: string }> {
      migrationCalls.push(input);
      const state: State = {
        status: 'partial', packId: `migrated-${input.placeId}`, profileFingerprint: input.profileFingerprint,
      };
      authoritative.set(input.profileFingerprint, state);
      return { ok: true, packId: state.packId! };
    },
    async prune(input: { placeIds: string[]; maxPlaces: number; generationsPerPlace: number }): Promise<void> {
      pruneCalls.push({ ...input, placeIds: [...input.placeIds] });
    },
  };

  const runtime = requireFunction('createEmergencyPackRuntime')({
    now: () => NOW,
    buildProfileFingerprint: profile,
    getSavedPlaces: () => places,
    createBrowserAdapters: () => { compositions.push('adapters'); return adapters; },
    createStore: (received: unknown) => {
      assert.equal(received, adapters);
      compositions.push('store');
      return store;
    },
    createCoordinator: (dependencies: Parameters<typeof createEmergencyPackCoordinator>[0]) => {
      compositions.push('coordinator');
      return createEmergencyPackCoordinator(dependencies);
    },
    createSources: (candidate: Place) => {
      sourcePlaces.push(candidate.id);
      return { lifelines: async () => options.lifelinesArtifact ?? null };
    },
    getLegacyLifelinePackManifest: () => options.legacyManifest ?? null,
    createCaptureOrchestrator: (dependencies: {
      sources: unknown;
      commitGeneration: typeof store.commitGeneration;
    }) => {
      compositions.push('orchestrator');
      assert.ok(dependencies.sources);
      return {
        capture: async (scope: Scope & { contactConsent: boolean }) => {
          const committed = await dependencies.commitGeneration({
            placeId: scope.placeId,
            profileFingerprint: scope.profileFingerprint,
          });
          return { ok: committed.ok, packId: committed.packId };
        },
      };
    },
    subscribeSavedPlaces: (callback: () => void) => {
      callbacks.set('saved-places', callback);
      return () => { unsubscribed.push('saved-places'); };
    },
    subscribeRoutes: (callback: () => void) => {
      callbacks.set('routes', callback);
      return () => { unsubscribed.push('routes'); };
    },
    subscribeComms: (callback: () => void) => {
      callbacks.set('comms', callback);
      return () => { unsubscribed.push('comms'); };
    },
    subscribeLifelines: (callback: () => void) => {
      callbacks.set('lifelines', callback);
      return () => { unsubscribed.push('lifelines'); };
    },
  });

  return {
    runtime,
    callbacks,
    compositions,
    sourcePlaces,
    pruneCalls,
    migrationCalls,
    unsubscribed,
    authoritative,
    profile,
    get commitCalls() { return commitCalls; },
    setPlaces(value: Place[]) { places = value; },
  };
}

test('runtime exports the exact default facade consumed by Emergency Readiness', () => {
  requireFunction('getEmergencyPackState');
  requireFunction('captureEmergencyPack');
  requireFunction('subscribeEmergencyPack');
});

test('legacy migration reads only the exact v1 key and accepts only a JSON record', () => {
  const read = requireFunction('readLegacyLifelinePackManifestV1');
  const reads: string[] = [];
  const manifest = { schemaVersion: 1, placeId: 'home' };
  const storage = {
    getItem(key: string): string | null {
      reads.push(key);
      return key === 'wm_lifeline_pack_manifest_v1:home' ? JSON.stringify(manifest) : null;
    },
  };

  assert.deepEqual(read(storage, 'home'), manifest);
  assert.deepEqual(reads, ['wm_lifeline_pack_manifest_v1:home']);
  for (const malformed of ['null', '[]', '"text"', '{']) {
    assert.equal(read({ getItem: () => malformed }, 'home'), null);
  }
});

test('runtime composes browser adapters, store, coordinator, sources, and orchestrator for a real capture', async () => {
  const harness = createHarness();
  await harness.runtime.hydrate();
  const captured = await harness.runtime.capture(place('home'), true);

  assert.deepEqual(captured, {
    status: 'ready', packId: 'pack-home', profileFingerprint: harness.profile(place('home')),
  });
  assert.deepEqual(harness.compositions.slice(0, 3), ['adapters', 'store', 'coordinator']);
  assert.ok(harness.compositions.includes('orchestrator'));
  assert.deepEqual(harness.sourcePlaces, ['home']);
  assert.deepEqual(harness.runtime.getState(place('home')), captured);
  harness.runtime.destroy();
});

test('saved-place, route, comms, and Lifelines invalidations re-read authoritative state and ignore payloads', async () => {
  const home = place('home');
  const harness = createHarness([home]);
  const fingerprint = harness.profile(home);
  harness.authoritative.set(fingerprint, { status: 'ready', packId: 'pack-1', profileFingerprint: fingerprint });
  const emitted: State[] = [];
  harness.runtime.subscribe((state) => emitted.push(state));
  await harness.runtime.hydrate();
  assert.equal(harness.runtime.getState(home).status, 'ready');

  for (const event of ['routes', 'comms', 'lifelines'] as const) {
    harness.authoritative.set(fingerprint, {
      status: 'not-saved', packId: null, profileFingerprint: fingerprint,
    });
    (harness.callbacks.get(event) as ((payload?: unknown) => void) | undefined)?.({
      status: 'ready', packId: 'forged-event-payload',
    });
    await flush();
    assert.equal(harness.runtime.getState(home).status, 'not-saved', event);
  }

  const moved = { ...home, lat: home.lat + 0.1 };
  harness.setPlaces([moved]);
  harness.callbacks.get('saved-places')?.();
  await flush();
  assert.equal(harness.runtime.getState(moved).status, 'not-saved');
  assert.ok(emitted.some((state) => state.status === 'not-saved'));

  harness.runtime.destroy();
  assert.deepEqual(harness.unsubscribed.sort(), ['comms', 'lifelines', 'routes', 'saved-places']);
});

test('runtime keeps at most five place heads and requests only active plus previous generations', async () => {
  const places = Array.from({ length: 7 }, (_, index) => place(`place-${index}`, index));
  const harness = createHarness(places);
  await harness.runtime.hydrate();

  assert.deepEqual(harness.pruneCalls.at(-1), {
    placeIds: places.slice(0, 5).map(({ id }) => id),
    maxPlaces: 5,
    generationsPerPlace: 2,
  });
  harness.runtime.destroy();
});

test('hydrate migrates one exact legacy Lifelines pack to partial v2 without mutating the legacy value', async () => {
  const home = place('home');
  const legacyQueryFingerprint = 'lifelines-exact-v1';
  const legacyManifest = {
    schemaVersion: 1,
    placeId: home.id,
    queryFingerprint: legacyQueryFingerprint,
    requiredKinds: ['lifelines'],
    artifacts: [{
      kind: 'lifelines',
      queryFingerprint: legacyQueryFingerprint,
      cachedAt: new Date(NOW - 60_000).toISOString(),
      expiresAt: new Date(NOW + 60 * 60_000).toISOString(),
    }],
    createdAt: new Date(NOW - 60_000).toISOString(),
    updatedAt: new Date(NOW - 30_000).toISOString(),
  };
  const encodedBefore = JSON.stringify(legacyManifest);
  const artifact = {
    kind: 'lifelines' as const,
    body: JSON.stringify({
      kind: 'lifelines',
      placeId: home.id,
      profileFingerprint: JSON.stringify([2, home.id, home.lat, home.lon, home.radiusKm]),
      snapshot: { queryFingerprint: legacyQueryFingerprint },
    }),
    expiresAt: NOW + 60 * 60_000,
    semanticState: 'verified' as const,
    summary: 'Exact legacy Lifelines snapshot verified',
    itemCount: 1,
  };
  const harness = createHarness([home], { legacyManifest, lifelinesArtifact: artifact });

  await harness.runtime.hydrate();

  assert.equal(harness.runtime.getState(home).status, 'partial');
  assert.equal(harness.migrationCalls.length, 1);
  assert.deepEqual(harness.migrationCalls[0], {
    placeId: home.id,
    profileFingerprint: harness.profile(home),
    legacyQueryFingerprint,
    legacyManifest,
    artifact,
  });
  assert.equal(JSON.stringify(legacyManifest), encodedBefore, 'legacy v1 data must remain untouched');
  await harness.runtime.hydrate();
  assert.equal(harness.migrationCalls.length, 1, 'a valid v2 head suppresses repeated migration');
  harness.runtime.destroy();
});

test('capture refuses a saved place outside the retained first five', async () => {
  const places = Array.from({ length: 6 }, (_, index) => place(`place-${index}`, index));
  const harness = createHarness(places);

  const state = await harness.runtime.capture(places[5]!, true);

  assert.deepEqual(state, {
    status: 'not-saved',
    packId: null,
    profileFingerprint: harness.profile(places[5]!),
    requiredKinds: ['lifelines', 'alerts', 'route-primary', 'offline-map', 'comms-plan', 'contacts'],
    optionalKinds: ['route-alternate'],
    receipts: [],
    missingKinds: ['lifelines', 'alerts', 'route-primary', 'offline-map', 'comms-plan', 'contacts'],
    expiredKinds: [],
    reason: 'place-not-retained',
  });
  assert.equal(harness.commitCalls, 0);
  harness.runtime.destroy();
});

test('hydrate recovery and capture are serialized so recovery cannot republish an older head', async () => {
  let releaseRecovery = () => undefined;
  const recoveryGate = new Promise<void>((resolve) => { releaseRecovery = resolve; });
  const home = place('home');
  const harness = createHarness([home], { recoveryGate });
  const hydration = harness.runtime.hydrate();
  await flush();

  const capture = harness.runtime.capture(home, true);
  await flush();
  assert.equal(harness.commitCalls, 0, 'capture must wait for the head-mutating recovery operation');

  releaseRecovery();
  await hydration;
  const captured = await capture;
  assert.equal(captured.packId, 'pack-home');
  assert.equal(harness.authoritative.get(harness.profile(home))?.packId, 'pack-home');
  harness.runtime.destroy();
});
