import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  createEmergencyPackOfflineMapLifecycle?: (
    cacheStorage: { open(name: string): Promise<object> },
    operations?: {
      verify(input: { generationId: string; tiles: unknown[]; cache: object }): Promise<{ ok: boolean }>;
      release(input: { generationId: string; tiles: unknown[]; cache: object }): Promise<{ ok: boolean }>;
    },
  ) => {
    verifyArtifactBody(kind: string, body: string): Promise<boolean>;
    releaseArtifactBody(kind: string, body: string): Promise<void>;
    releaseArtifact(artifact: { kind: string; body: string }): Promise<void>;
  };
  captureEmergencyPackOfflineMap?: (
    place: Place,
    scope: Scope & { contactConsent: boolean },
    dependencies: Record<string, unknown>,
  ) => Promise<{ kind: string; body: string; itemCount: number } | null>;
}

const api = await import('../emergency-pack-runtime.ts').catch(() => ({} as RuntimeApi)) as RuntimeApi;
const runtimeSource = readFileSync(new URL('../emergency-pack-runtime.ts', import.meta.url), 'utf8');

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
  const releasedArtifacts: unknown[] = [];
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
  const releaseArtifact = async (artifact: unknown): Promise<void> => {
    releasedArtifacts.push(artifact);
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
      releaseArtifact?: typeof releaseArtifact;
    }) => {
      compositions.push('orchestrator');
      assert.ok(dependencies.sources);
      assert.equal(dependencies.releaseArtifact, releaseArtifact);
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
    releaseArtifact,
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
    releasedArtifacts,
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

test('offline map lifecycle verifies and releases only strict immutable generation evidence', async () => {
  const create = requireFunction('createEmergencyPackOfflineMapLifecycle');
  const cache = { id: 'wm-offline-maps' };
  const opened: string[] = [];
  const verified: unknown[] = [];
  const released: unknown[] = [];
  const lifecycle = create({
    async open(name: string): Promise<object> {
      opened.push(name);
      return cache;
    },
  }, {
    async verify(input) { verified.push(input); return { ok: true }; },
    async release(input) { released.push(input); return { ok: true }; },
  });
  const generationId = 'emergency-pack-generation-1';
  const tile = {
    url: 'https://a.basemaps.cartocdn.com/dark_all/4/1/2@2x.png',
    cacheKey: `https://offline-map.crystalball.invalid/exact/${generationId}/0`,
    sha256: 'a'.repeat(64),
    generationId,
    byteLength: 4,
    verified: true,
  };
  const body = JSON.stringify({
    kind: 'offline-map',
    placeId: 'home',
    profileFingerprint: 'profile-home',
    generationId,
    tiles: [tile],
    totalBytes: 4,
  });

  assert.equal(await lifecycle.verifyArtifactBody('offline-map', body), true);
  await lifecycle.releaseArtifact({ kind: 'offline-map', body });
  assert.deepEqual(opened, ['wm-offline-maps', 'wm-offline-maps']);
  assert.deepEqual(verified, [{ generationId, tiles: [tile], cache }]);
  assert.deepEqual(released, [{ generationId, tiles: [tile], cache }]);

  assert.equal(await lifecycle.verifyArtifactBody('alerts', '{not-json'), true);
  await lifecycle.releaseArtifactBody('contacts', '{not-json');
  assert.equal(opened.length, 2, 'non-map bodies must not open or mutate the map cache');

  for (const malformed of [
    '{',
    JSON.stringify({ kind: 'offline-map', generationId, tiles: [tile], totalBytes: 4 }),
    JSON.stringify({
      kind: 'offline-map', placeId: 'home', profileFingerprint: 'profile-home', generationId,
      tiles: [{ ...tile, sha256: undefined }], totalBytes: 4,
    }),
    JSON.stringify({
      kind: 'offline-map', placeId: 'home', profileFingerprint: 'profile-home', generationId,
      tiles: [tile], totalBytes: 4, unexpected: true,
    }),
  ]) {
    assert.equal(await lifecycle.verifyArtifactBody('offline-map', malformed), false);
    await assert.rejects(() => lifecycle.releaseArtifactBody('offline-map', malformed));
  }

  const unavailable = create({ open: async () => { throw new Error('cache unavailable'); } });
  assert.equal(await unavailable.verifyArtifactBody('offline-map', body), false);
  await assert.rejects(() => unavailable.releaseArtifactBody('offline-map', body));
});

test('default runtime wires immutable map verification and cleanup through store and orchestrator boundaries', () => {
  assert.match(runtimeSource, /verifyArtifactBody:\s*offlineMapLifecycle\.verifyArtifactBody/);
  assert.match(runtimeSource, /releaseArtifactBody:\s*offlineMapLifecycle\.releaseArtifactBody/);
  assert.match(runtimeSource, /releaseArtifact:\s*offlineMapLifecycle\.releaseArtifact/);
  assert.match(runtimeSource, /captureTiles\(\{\s*generationId,/);
});

test('default offline map capture supplies unique bounded ids and serializes exact tile evidence', async () => {
  const capture = requireFunction('captureEmergencyPackOfflineMap');
  const generationIds = ['generation-one', 'generation-two'];
  const captureInputs: Array<{ generationId: string }> = [];
  const dependencies = {
    now: () => NOW,
    randomUUID: () => generationIds.shift(),
    planTileUrls: () => ({ ok: true, tileUrls: ['https://a.basemaps.cartocdn.com/tile.png'] }),
    openCache: async () => ({ id: 'wm-offline-maps' }),
    fetchTile: async () => new Response(),
    captureTiles: async (input: { generationId: string }) => {
      captureInputs.push(input);
      const tile = {
        url: 'https://a.basemaps.cartocdn.com/tile.png',
        cacheKey: `https://offline-map.crystalball.invalid/exact/${encodeURIComponent(input.generationId)}/0`,
        sha256: 'b'.repeat(64),
        generationId: input.generationId,
        byteLength: 8,
        verified: true,
      };
      return { ok: true, total: 1, downloaded: 1, totalBytes: 8, tiles: [tile] };
    },
  };
  const home = place('home');
  const scope = { placeId: home.id, profileFingerprint: 'profile-home', contactConsent: false };
  const first = await capture(home, scope, dependencies);
  const second = await capture(home, scope, dependencies);

  assert.equal(captureInputs.length, 2);
  assert.notEqual(captureInputs[0]?.generationId, captureInputs[1]?.generationId);
  assert.ok(captureInputs.every(({ generationId }) => generationId.length > 0 && generationId.length <= 180));
  for (const artifact of [first, second]) {
    assert.ok(artifact);
    const payload = JSON.parse(artifact.body) as Record<string, unknown>;
    assert.equal(payload.generationId, (payload.tiles as Array<Record<string, unknown>>)[0]?.generationId);
    assert.equal(typeof (payload.tiles as Array<Record<string, unknown>>)[0]?.cacheKey, 'string');
    assert.match(String((payload.tiles as Array<Record<string, unknown>>)[0]?.sha256), /^[a-f0-9]{64}$/);
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
