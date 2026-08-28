import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createEmergencyPackCoordinator } from '../emergency-pack-coordinator.ts';
import {
  captureOfflineMapTilesExact,
  createExactOfflineMapCleanupCoordinator,
  type ExactOfflineMapCache,
} from '../../offline-map-cache.ts';
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
    resolveOfflineMapTile: (url: string) => Promise<{ data: ArrayBuffer; contentType: string } | null>;
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
    cleanup?: {
      adoptGeneration(generationId: string, cacheKeys: string[]): void;
      reconcileRecoveredGeneration?(input: { generationId: string; cacheKeys: string[] }):
        | { ok: true; disposition: string }
        | { ok: false; reason: string };
    },
  ) => {
    verifyArtifactBody(kind: string, body: string): Promise<boolean>;
    adoptArtifactBody(kind: string, body: string): Promise<void>;
    reconcileRecoveredArtifactBody(kind: string, body: string): Promise<void>;
    releaseArtifactBody(kind: string, body: string): Promise<void>;
    releaseArtifact(artifact: { kind: string; body: string }): Promise<void>;
  };
  captureEmergencyPackOfflineMap?: (
    place: Place,
    scope: Scope & { contactConsent: boolean },
    dependencies: Record<string, unknown>,
  ) => Promise<{ kind: string; body: string; capturedAt: number; itemCount: number } | null>;
  createEmergencyPackOfflineMapTileResolver?: (dependencies: Record<string, unknown>) => (
    url: string,
  ) => Promise<{ data: ArrayBuffer; contentType: string } | null>;
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

function exactMapRequestKey(request: RequestInfo | URL): string {
  if (typeof request === 'string') return request;
  if (request instanceof URL) return request.href;
  return request.url;
}

class RuntimeExactMapCache implements ExactOfflineMapCache {
  readonly values = new Map<string, Uint8Array>();

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    this.values.set(exactMapRequestKey(request), new Uint8Array(await response.arrayBuffer()));
  }

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    const bytes = this.values.get(exactMapRequestKey(request));
    return bytes
      ? new Response(bytes, { status: 200, headers: { 'content-type': 'image/png' } })
      : undefined;
  }

  async delete(request: RequestInfo | URL): Promise<boolean> {
    return this.values.delete(exactMapRequestKey(request));
  }
}

interface HarnessOptions {
  legacyManifest?: unknown;
  lifelinesArtifact?: {
    kind: 'lifelines';
    body: string;
    capturedAt: number;
    expiresAt: number;
    semanticState: 'verified';
    summary: string;
    itemCount: number;
  };
  recoveryGate?: Promise<void>;
  currentAlertRevision?: string | null;
  failAlertReconciliation?: boolean;
  offlineMap?: {
    body: string;
    expiresAt: number;
    cache: object;
  };
}

function createHarness(initialPlaces = [place('home')], options: HarnessOptions = {}) {
  let places = initialPlaces;
  const callbacks = new Map<string, (payload?: unknown) => void>();
  const unsubscribed: string[] = [];
  const authoritative = new Map<string, State>();
  const profile = (candidate: Place) => JSON.stringify([2, candidate.id, candidate.lat, candidate.lon, candidate.radiusKm]);
  const adapters = { metadata: { id: 'metadata' }, bodies: { id: 'bodies' }, digest: async () => 'digest' };
  const compositions: string[] = [];
  const sourcePlaces: string[] = [];
  const pruneCalls: Array<{ placeIds: string[]; maxPlaces: number; generationsPerPlace: number }> = [];
  const migrationCalls: unknown[] = [];
  const invalidationCalls: unknown[] = [];
  const releasedArtifacts: unknown[] = [];
  let commitCalls = 0;
  let readCalls = 0;
  let offlineMapReads = 0;
  const offlineMapRevision = () => `map-${commitCalls}`;

  const store = {
    async readActive(scope: Scope): Promise<State> {
      readCalls += 1;
      return authoritative.get(scope.profileFingerprint) ?? {
        status: 'not-saved', packId: null, profileFingerprint: scope.profileFingerprint,
      };
    },
    async recoverActive(scope: Scope): Promise<State> {
      await options.recoveryGate;
      return this.readActive(scope);
    },
    async recoverReadiness(scope: Scope): Promise<State> {
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
    async invalidateArtifacts(input: {
      placeId: string;
      profileFingerprint: string;
      kinds: readonly string[];
      capturedAt: number;
      sourceRevision?: string;
    }): Promise<{ ok: boolean }> {
      invalidationCalls.push({ ...input, kinds: [...input.kinds] });
      if (options.failAlertReconciliation && input.kinds.includes('alerts')) {
        return { ok: false, reason: 'storage-failure' };
      }
      if (input.kinds.includes('alerts') && input.sourceRevision) {
        authoritative.set(input.profileFingerprint, {
          status: 'not-saved', packId: null, profileFingerprint: input.profileFingerprint,
        });
      }
      return { ok: true };
    },
    async reconcileAlertRevision(input: {
      placeId: string;
      profileFingerprint: string;
      sourceRevision: string;
      capturedAt: number;
    }): Promise<{ ok: boolean; reason?: string }> {
      return this.invalidateArtifacts({ ...input, kinds: ['alerts'] });
    },
    readOfflineMapRevision(): string | null {
      return options.offlineMap ? offlineMapRevision() : null;
    },
    async readVerifiedOfflineMapArtifact(): Promise<{
      body: string;
      revision: string;
      expiresAt: number;
    } | null> {
      offlineMapReads += 1;
      return options.offlineMap ? {
        body: options.offlineMap.body,
        revision: offlineMapRevision(),
        expiresAt: options.offlineMap.expiresAt,
      } : null;
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
    subscribeAlerts: (callback: (event: { sourceRevision: string }) => void) => {
      callbacks.set('alerts', (payload) => callback(payload as { sourceRevision: string }));
      return () => { unsubscribed.push('alerts'); };
    },
    getCurrentAlertSourceRevision: () => options.currentAlertRevision ?? null,
    openOfflineMapCache: async () => options.offlineMap?.cache ?? Promise.reject(new Error('cache unavailable')),
  });

  return {
    runtime,
    callbacks,
    compositions,
    sourcePlaces,
    pruneCalls,
    migrationCalls,
    invalidationCalls,
    releasedArtifacts,
    unsubscribed,
    authoritative,
    profile,
    get commitCalls() { return commitCalls; },
    get readCalls() { return readCalls; },
    get offlineMapReads() { return offlineMapReads; },
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
    capturedAt: NOW,
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
      kind: 'offline-map', placeId: 'home', profileFingerprint: 'profile-home', capturedAt: NOW, generationId,
      tiles: [{ ...tile, sha256: undefined }], totalBytes: 4,
    }),
    JSON.stringify({
      kind: 'offline-map', placeId: 'home', profileFingerprint: 'profile-home', capturedAt: NOW, generationId,
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

test('offline map lifecycle keeps verification pure and adopts only at the explicit publication boundary', async () => {
  const create = requireFunction('createEmergencyPackOfflineMapLifecycle');
  const cache = { id: 'wm-offline-maps' };
  const adopted: unknown[] = [];
  const reconciled: unknown[] = [];
  const cleanup = {
    adoptGeneration(generationId: string, cacheKeys: string[]) {
      adopted.push({ generationId, cacheKeys });
    },
    reconcileRecoveredGeneration(input: { generationId: string; cacheKeys: string[] }) {
      reconciled.push(input);
      return { ok: true as const, disposition: 'claimed-provisional' as const };
    },
  };
  const generationId = 'generation-lifecycle-owner';
  const tile = {
    url: 'https://a.basemaps.cartocdn.com/dark_all/4/1/2@2x.png',
    cacheKey: `https://offline-map.crystalball.invalid/exact/${generationId}/0`,
    sha256: 'c'.repeat(64),
    generationId,
    byteLength: 4,
    verified: true,
  };
  const body = JSON.stringify({
    kind: 'offline-map', placeId: 'home', profileFingerprint: 'profile-home',
    capturedAt: NOW, generationId, tiles: [tile], totalBytes: 4,
  });
  const durable = create({ open: async () => cache }, {
    verify: async () => ({ ok: true }),
    release: async (input: unknown) => {
      assert.equal((input as { cleanup: unknown }).cleanup, cleanup);
      return { ok: false, durableCleanup: true };
    },
  }, cleanup);

  assert.equal(await durable.verifyArtifactBody('offline-map', body), true);
  assert.deepEqual(adopted, [], 'verified reads must not mutate cleanup ownership');
  await durable.adoptArtifactBody('offline-map', body);
  assert.deepEqual(adopted, [{ generationId, cacheKeys: [tile.cacheKey] }]);
  await durable.reconcileRecoveredArtifactBody('offline-map', body);
  assert.deepEqual(reconciled, [{ generationId, cacheKeys: [tile.cacheKey] }]);
  await assert.doesNotReject(() => durable.reconcileRecoveredArtifactBody('alerts', '{not-json'));
  await assert.doesNotReject(() => durable.releaseArtifactBody('offline-map', body));

  const rejected = create({ open: async () => cache }, {
    verify: async () => ({ ok: false }),
    release: async () => ({ ok: false }),
  }, {
    ...cleanup,
    reconcileRecoveredGeneration: () => ({
      ok: false as const,
      reason: 'cleanup-tombstone-invalid' as const,
    }),
  });
  assert.equal(await rejected.verifyArtifactBody('offline-map', body), false);
  assert.equal(adopted.length, 1, 'failed tile verification must not adopt generation ownership');
  await assert.rejects(() => rejected.releaseArtifactBody('offline-map', body));
  await assert.rejects(
    () => rejected.reconcileRecoveredArtifactBody('offline-map', body),
    /offline map recovered generation reconciliation failed/,
  );
  await assert.rejects(() => durable.reconcileRecoveredArtifactBody('offline-map', '{not-json'));
});

test('verified active map A remains readable while unrelated crash-staged B owns the cleanup tombstone', async () => {
  const create = requireFunction('createEmergencyPackOfflineMapLifecycle');
  const metadata = new Map<string, string>();
  const cache: ExactOfflineMapCache = {
    async put() { return undefined; },
    async match() { return undefined; },
    async delete() { return true; },
  };
  const cleanup = createExactOfflineMapCleanupCoordinator({
    metadata: {
      getItem: (key) => metadata.get(key) ?? null,
      setItem: (key, value) => { metadata.set(key, value); },
      removeItem: (key) => { metadata.delete(key); },
    },
  });
  const generationA = 'generation-active-a';
  const generationB = 'generation-crash-staged-b';
  const cacheKeyA = `https://offline-map.crystalball.invalid/exact/${generationA}/0`;
  const cacheKeyB = `https://offline-map.crystalball.invalid/exact/${generationB}/0`;
  cleanup.stageGeneration(generationB, [cacheKeyB]);
  const bodyA = JSON.stringify({
    kind: 'offline-map',
    placeId: 'home',
    profileFingerprint: 'profile-home',
    capturedAt: NOW,
    generationId: generationA,
    tiles: [{
      url: 'https://a.basemaps.cartocdn.com/dark_all/4/1/2@2x.png',
      cacheKey: cacheKeyA,
      sha256: 'd'.repeat(64),
      generationId: generationA,
      byteLength: 4,
      verified: true,
    }],
    totalBytes: 4,
  });
  const lifecycle = create({ open: async () => cache }, {
    verify: async () => ({ ok: true }),
    release: async () => ({ ok: true }),
  }, cleanup);

  assert.equal(await lifecycle.verifyArtifactBody('offline-map', bodyA), true);
  assert.ok(
    [...metadata.values()].some((value) => value.includes(generationB)),
    'pure A verification must leave the unrelated B cleanup evidence intact',
  );
});

test('default runtime wires immutable map verification and cleanup through store and orchestrator boundaries', () => {
  assert.match(runtimeSource, /verifyArtifactBody:\s*offlineMapLifecycle\.verifyArtifactBody/);
  assert.match(runtimeSource, /adoptArtifactBody:\s*offlineMapLifecycle\.adoptArtifactBody/);
  assert.match(
    runtimeSource,
    /reconcileRecoveredArtifactBody:\s*offlineMapLifecycle\.reconcileRecoveredArtifactBody/,
  );
  assert.match(runtimeSource, /releaseArtifactBody:\s*offlineMapLifecycle\.releaseArtifactBody/);
  assert.match(runtimeSource, /releaseArtifact:\s*offlineMapLifecycle\.releaseArtifact/);
  assert.match(runtimeSource, /captureTiles\(\{\s*generationId,/);
  assert.match(runtimeSource, /createExactOfflineMapCleanupCoordinator\(\{\s*metadata:\s*localStorage/);
  assert.match(runtimeSource, /captureDefaultOfflineMap\(place,\s*scope,\s*offlineMapCleanup\)/);
  assert.match(runtimeSource, /createEmergencyPackOfflineMapLifecycle\(caches,\s*undefined,\s*offlineMapCleanup\)/);
  assert.match(runtimeSource, /subscribeAlerts:\s*subscribeStormAlerts/);
  assert.match(runtimeSource, /getCurrentAlertSourceRevision:\s*getStormAlertSourceRevision/);
  assert.doesNotMatch(runtimeSource, /subscribeAlerts:\s*subscribeStormPosture/);
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
    cleanup: { id: 'shared-cleanup-coordinator' },
    fetchTile: async () => new Response(),
    captureTiles: async (input: { generationId: string; cleanup: unknown }) => {
      assert.equal(input.cleanup, dependencies.cleanup);
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
    assert.equal(payload.capturedAt, artifact.capturedAt);
    assert.equal(payload.generationId, (payload.tiles as Array<Record<string, unknown>>)[0]?.generationId);
    assert.equal(typeof (payload.tiles as Array<Record<string, unknown>>)[0]?.cacheKey, 'string');
    assert.match(String((payload.tiles as Array<Record<string, unknown>>)[0]?.sha256), /^[a-f0-9]{64}$/);
  }
});

type CapturedMapMutation = (result: {
  tiles: Array<Record<string, unknown>>;
}) => void;

async function assertPostCaptureMapFailureReleasesForRetry(input: {
  now: () => number;
  mutateFirstCapture?: CapturedMapMutation;
}): Promise<void> {
  const capture = requireFunction('captureEmergencyPackOfflineMap');
  const cache = new RuntimeExactMapCache();
  const metadataValues = new Map<string, string>();
  const cleanup = createExactOfflineMapCleanupCoordinator({
    metadata: {
      getItem: (key) => metadataValues.get(key) ?? null,
      setItem: (key, value) => { metadataValues.set(key, value); },
      removeItem: (key) => { metadataValues.delete(key); },
    },
  });
  const releaseGeneration = cleanup.releaseGeneration.bind(cleanup);
  let releases = 0;
  cleanup.releaseGeneration = async (releaseInput) => {
    releases += 1;
    return releaseGeneration(releaseInput);
  };
  let captureAttempts = 0;
  const uuids = ['failed-owner', 'retry-owner'];
  const dependencies = {
    now: input.now,
    randomUUID: () => uuids.shift(),
    planTileUrls: () => ({
      ok: true,
      tileUrls: ['https://a.basemaps.cartocdn.com/dark_all/12/1/95@2x.png'],
    }),
    openCache: async () => cache,
    cleanup,
    fetchTile: async (url: string) => new Response(`tile:${url}`, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }),
    captureTiles: async (captureInput: Parameters<typeof captureOfflineMapTilesExact>[0]) => {
      const result = await captureOfflineMapTilesExact(captureInput);
      captureAttempts += 1;
      if (result.ok && captureAttempts === 1) {
        input.mutateFirstCapture?.(result as unknown as { tiles: Array<Record<string, unknown>> });
      }
      return result;
    },
  };
  const home = place('home');
  const scope = { placeId: home.id, profileFingerprint: 'profile-home', contactConsent: false };

  assert.equal(await capture(home, scope, dependencies), null);
  assert.equal(releases, 1, 'the failed artifact construction must release exactly once');
  const retry = await capture(home, scope, dependencies);
  assert.ok(retry, 'the same cleanup coordinator must permit an immediate retry');
  assert.equal(releases, 1, 'ownership transfers with the successful retry');
}

const postCaptureMapFailureCases: Array<{
  name: string;
  now: () => number;
  mutateFirstCapture?: CapturedMapMutation;
}> = [
  {
    name: 'clock throw',
    now: (() => {
      let calls = 0;
      return () => {
        calls += 1;
        if (calls === 1) throw new Error('clock unavailable');
        return NOW;
      };
    })(),
  },
  {
    name: 'invalid timestamp',
    now: (() => {
      let calls = 0;
      return () => ++calls === 1 ? 0 : NOW;
    })(),
  },
  {
    name: 'expiry overflow',
    now: (() => {
      let calls = 0;
      return () => ++calls === 1
        ? 8_640_000_000_000_000 - (30 * 24 * 60 * 60_000) + 1
        : NOW;
    })(),
  },
  {
    name: 'serialization rejection',
    now: () => NOW,
    mutateFirstCapture: ({ tiles }) => { tiles[0]!.unsupported = 1n; },
  },
  {
    name: 'evidence rejection',
    now: () => NOW,
    mutateFirstCapture: ({ tiles }) => { tiles[0]!.sha256 = 'invalid'; },
  },
];

for (const failureCase of postCaptureMapFailureCases) {
  test(`offline map ${failureCase.name} releases staged ownership before retry`, async () => {
    await assertPostCaptureMapFailureReleasesForRetry(failureCase);
  });
}

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

test('hydrate reconciles a silently seeded authoritative alert revision before publishing readiness', async () => {
  const home = place('home');
  const revisionB = 'b'.repeat(64);
  const harness = createHarness([home], { currentAlertRevision: revisionB });
  const fingerprint = harness.profile(home);
  harness.authoritative.set(fingerprint, {
    status: 'ready', packId: 'pack-alert-a', profileFingerprint: fingerprint,
  });
  const emitted: State[] = [];
  harness.runtime.subscribe((state) => emitted.push(state));

  await harness.runtime.hydrate();

  assert.deepEqual(harness.invalidationCalls, [{
    placeId: home.id,
    profileFingerprint: fingerprint,
    kinds: ['alerts'],
    capturedAt: NOW,
    sourceRevision: revisionB,
  }]);
  assert.equal(harness.runtime.getState(home).status, 'not-saved');
  assert.equal(emitted.some(({ status }) => status === 'ready'), false);
  harness.runtime.destroy();
});

test('failed startup alert reconciliation prevents stale ready publication', async () => {
  const home = place('home');
  const harness = createHarness([home], {
    currentAlertRevision: 'b'.repeat(64),
    failAlertReconciliation: true,
  });
  const fingerprint = harness.profile(home);
  harness.authoritative.set(fingerprint, {
    status: 'ready', packId: 'pack-alert-a', profileFingerprint: fingerprint,
  });
  const emitted: State[] = [];
  harness.runtime.subscribe((state) => emitted.push(state));

  await harness.runtime.hydrate();

  assert.equal(harness.runtime.getState(home).status, 'not-saved');
  assert.equal(emitted.some(({ status }) => status === 'ready'), false);
  harness.runtime.destroy();
});

test('hydrate and capture consume one detailed verification read per lifecycle operation', async () => {
  const harness = createHarness();
  await harness.runtime.hydrate();
  assert.equal(harness.readCalls, 1, 'recovery result must be reused by hydrate');
  await harness.runtime.capture(place('home'), true);
  assert.equal(harness.readCalls, 2, 'commit verification result must be reused by capture');
  harness.runtime.destroy();
});

test('saved-place, route, comms, Lifelines, and alert invalidations re-read authoritative state and ignore payloads', async () => {
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
  harness.authoritative.set(fingerprint, {
    status: 'not-saved', packId: null, profileFingerprint: fingerprint,
  });
  harness.callbacks.get('alerts')?.({ sourceRevision: 'f'.repeat(64) });
  await flush();
  assert.equal(harness.runtime.getState(home).status, 'not-saved', 'alerts');

  assert.deepEqual(
    harness.invalidationCalls.map((value) => (value as { kinds: string[] }).kinds),
    [
      ['route-primary', 'route-alternate'],
      ['comms-plan', 'contacts'],
      ['lifelines'],
      ['alerts'],
    ],
  );
  assert.equal(
    (harness.invalidationCalls.at(-1) as { sourceRevision?: string }).sourceRevision,
    'f'.repeat(64),
  );

  const invalidationCount = harness.invalidationCalls.length;
  for (const malformed of [undefined, {}, { sourceRevision: 'F'.repeat(64) }, { sourceRevision: 'a'.repeat(63) }]) {
    harness.callbacks.get('alerts')?.(malformed);
  }
  await flush();
  assert.equal(harness.invalidationCalls.length, invalidationCount, 'malformed alert revisions fail closed');

  const renamed = { ...home, name: 'Renamed Home' };
  harness.setPlaces([renamed]);
  harness.callbacks.get('saved-places')?.();
  await flush();
  assert.deepEqual(
    (harness.invalidationCalls.at(-1) as { kinds: string[] }).kinds,
    ['route-primary', 'route-alternate'],
    'a same-profile saved-place rename invalidates route labels and instructions',
  );

  const moved = { ...home, lat: home.lat + 0.1 };
  harness.setPlaces([moved]);
  harness.callbacks.get('saved-places')?.();
  await flush();
  assert.equal(harness.runtime.getState(moved).status, 'not-saved');
  assert.ok(emitted.some((state) => state.status === 'not-saved'));

  harness.runtime.destroy();
  assert.deepEqual(harness.unsubscribed.sort(), ['alerts', 'comms', 'lifelines', 'routes', 'saved-places']);
});

test('same-profile rename invalidation is scoped to only the changed place', async () => {
  const home = place('home');
  const work = place('work', 1);
  const harness = createHarness([home, work]);
  await harness.runtime.hydrate();
  harness.invalidationCalls.length = 0;
  harness.setPlaces([{ ...home, name: 'Renamed Home' }, work]);

  harness.callbacks.get('saved-places')?.();
  await flush();

  assert.deepEqual(harness.invalidationCalls, [{
    placeId: home.id,
    profileFingerprint: harness.profile(home),
    kinds: ['route-primary', 'route-alternate'],
    capturedAt: NOW,
  }]);
  harness.runtime.destroy();
});

test('offline tile resolver re-reads one exact generation tile and rejects corrupt bytes', async () => {
  const create = requireFunction('createEmergencyPackOfflineMapTileResolver');
  const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
  const sha256 = await crypto.subtle.digest('SHA-256', bytes);
  const digest = [...new Uint8Array(sha256)].map((value) => value.toString(16).padStart(2, '0')).join('');
  const generationId = 'emergency-pack-offline-consumer';
  const sourceUrl = 'https://d.basemaps.cartocdn.com/dark_all/4/1/2@2x.png';
  const cacheKey = `https://offline-map.crystalball.invalid/exact/${generationId}/0`;
  const artifact = JSON.stringify({
    kind: 'offline-map',
    placeId: 'home',
    profileFingerprint: 'profile-home',
    capturedAt: NOW,
    generationId,
    tiles: [{
      url: sourceUrl, cacheKey, sha256: digest, generationId, byteLength: bytes.byteLength, verified: true,
    }],
    totalBytes: bytes.byteLength,
  });
  let cachedBytes = bytes;
  const cache = {
    put: async () => undefined,
    delete: async () => true,
    match: async (key: RequestInfo | URL) => String(key) === cacheKey
      ? new Response(cachedBytes.slice(), { status: 200, headers: { 'content-type': 'image/png' } })
      : undefined,
  };
  const reads: unknown[] = [];
  let revision = 'head-1';
  let verifiedArtifact: unknown = {
    body: artifact,
    revision,
    expiresAt: NOW + 60_000,
  };
  let scopes = [{ placeId: 'home', profileFingerprint: 'profile-home', now: NOW }];
  const resolver = create({
    getScopes: () => scopes,
    getScopeRevision: () => revision,
    readVerifiedOfflineMapArtifact: async (scope: unknown) => { reads.push(scope); return verifiedArtifact; },
    openCache: async (name: string) => {
      assert.equal(name, 'wm-offline-maps');
      return cache;
    },
  });

  const resolved = await resolver('https://a.basemaps.cartocdn.com/rastertiles/dark_nolabels/4/1/2.png');
  assert.deepEqual(new Uint8Array(resolved?.data ?? new ArrayBuffer(0)), bytes);
  assert.equal(resolved?.contentType, 'image/png');
  assert.deepEqual(reads, [{ placeId: 'home', profileFingerprint: 'profile-home', now: NOW }]);

  cachedBytes = new Uint8Array([137, 80, 78, 71, 9, 9, 9, 9]);
  assert.equal(await resolver(sourceUrl), null, 'same-length corrupt cached bytes fail closed');
  assert.equal(reads.length, 1, 'warm tile reads reuse the verified source URL index');

  cachedBytes = bytes;
  scopes = [{ placeId: 'home', profileFingerprint: 'profile-home', now: NOW + 60_001 }];
  assert.equal(await resolver(sourceUrl), null, 'expired indexed evidence fails closed without a body re-read');
  assert.equal(reads.length, 1);
  scopes = [];
  assert.equal(await resolver(sourceUrl), null, 'pruned scopes cannot retain indexed tiles');
  scopes = [{ placeId: 'home', profileFingerprint: 'moved', now: NOW }];
  assert.equal(await resolver(sourceUrl), null, 'moved profiles cannot retain indexed tiles');
  assert.equal(reads.length, 2);

  scopes = [{ placeId: 'home', profileFingerprint: 'profile-home', now: NOW }];
  revision = 'head-2';
  verifiedArtifact = null;
  assert.equal(await resolver(sourceUrl), null, 'an active head revision change drops the prior index');
  assert.equal(reads.length, 3, 'a new head revision rebuilds verified index evidence');

  const unavailable = create({
    getScopes: () => [{ placeId: 'home', profileFingerprint: 'moved', now: NOW }],
    getScopeRevision: () => null,
    readVerifiedOfflineMapArtifact: async () => null,
    openCache: async () => cache,
  });
  assert.equal(await unavailable(sourceUrl), null, 'missing, moved, expired, or pruned evidence fails closed');
});

test('offline tile resolver continues across corrupt and throwing overlapping candidates', async () => {
  const create = requireFunction('createEmergencyPackOfflineMapTileResolver');
  const sourceUrl = 'https://a.basemaps.cartocdn.com/dark_all/4/7/6@2x.png';
  const validBytes = new Uint8Array([137, 80, 78, 71, 1, 3, 3, 7]);
  const validDigest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', validBytes))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  const invalidBytes = new Uint8Array([137, 80, 78, 71, 9, 9, 9, 9]);
  const scopes = ['first', 'second'].map((placeId) => ({
    placeId,
    profileFingerprint: `profile-${placeId}`,
    now: NOW,
  }));
  const artifactFor = (placeId: string) => {
    const generationId = `generation-${placeId}`;
    const cacheKey = `https://offline-map.crystalball.invalid/exact/${generationId}/0`;
    return {
      body: JSON.stringify({
        kind: 'offline-map', placeId, profileFingerprint: `profile-${placeId}`, capturedAt: NOW,
        generationId,
        tiles: [{
          url: sourceUrl, cacheKey, sha256: validDigest, generationId,
          byteLength: validBytes.byteLength, verified: true,
        }],
        totalBytes: validBytes.byteLength,
      }),
      revision: `revision-${placeId}`,
      expiresAt: NOW + 60_000,
      cacheKey,
    };
  };
  const artifacts = new Map(scopes.map(({ placeId }) => [placeId, artifactFor(placeId)]));
  let firstBehavior: 'corrupt' | 'throw' = 'corrupt';
  let secondValid = true;
  const resolver = create({
    getScopes: () => scopes,
    getScopeRevision: (scope: { placeId: string }) => `revision-${scope.placeId}`,
    readVerifiedOfflineMapArtifact: async (scope: { placeId: string }) => artifacts.get(scope.placeId),
    openCache: async () => ({
      put: async () => undefined,
      delete: async () => true,
      match: async (key: RequestInfo | URL) => {
        if (String(key) === artifacts.get('first')?.cacheKey) {
          if (firstBehavior === 'throw') throw new Error('candidate-local cache read failure');
          return new Response(invalidBytes.slice(), { status: 200, headers: { 'content-type': 'image/png' } });
        }
        if (String(key) === artifacts.get('second')?.cacheKey && secondValid) {
          return new Response(validBytes.slice(), { status: 200, headers: { 'content-type': 'image/png' } });
        }
        return undefined;
      },
    }),
  });

  assert.deepEqual(new Uint8Array((await resolver(sourceUrl))?.data ?? new ArrayBuffer(0)), validBytes);
  firstBehavior = 'throw';
  assert.deepEqual(new Uint8Array((await resolver(sourceUrl))?.data ?? new ArrayBuffer(0)), validBytes);
  secondValid = false;
  assert.equal(await resolver(sourceUrl), null, 'resolver returns null only after every candidate fails');
});

test('runtime invalidates the verified tile index on source cutoffs and pack lifecycle changes', async () => {
  const home = place('home');
  const profile = JSON.stringify([2, home.id, home.lat, home.lon, home.radiusKm]);
  const bytes = new Uint8Array([137, 80, 78, 71, 5, 6, 7, 8]);
  const digestBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = [...new Uint8Array(digestBuffer)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  const generationId = 'runtime-index-invalidation';
  const sourceUrl = 'https://a.basemaps.cartocdn.com/dark_all/4/3/2@2x.png';
  const cacheKey = `https://offline-map.crystalball.invalid/exact/${generationId}/0`;
  const body = JSON.stringify({
    kind: 'offline-map',
    placeId: home.id,
    profileFingerprint: profile,
    capturedAt: NOW,
    generationId,
    tiles: [{
      url: sourceUrl,
      cacheKey,
      sha256,
      generationId,
      byteLength: bytes.byteLength,
      verified: true,
    }],
    totalBytes: bytes.byteLength,
  });
  const cache = {
    put: async () => undefined,
    delete: async () => true,
    match: async (key: RequestInfo | URL) => String(key) === cacheKey
      ? new Response(bytes.slice(), { status: 200, headers: { 'content-type': 'image/png' } })
      : undefined,
  };
  const harness = createHarness([home], { offlineMap: { body, expiresAt: NOW + 60_000, cache } });
  await harness.runtime.hydrate();

  assert.ok(await harness.runtime.resolveOfflineMapTile(sourceUrl));
  assert.ok(await harness.runtime.resolveOfflineMapTile(sourceUrl));
  assert.equal(harness.offlineMapReads, 1, 'warm requests share the verified index');

  harness.callbacks.get('routes')?.();
  await flush();
  assert.ok(await harness.runtime.resolveOfflineMapTile(sourceUrl));
  assert.equal(harness.offlineMapReads, 2, 'source cutoff invalidates the index');

  await harness.runtime.capture(home, false);
  assert.ok(await harness.runtime.resolveOfflineMapTile(sourceUrl));
  assert.equal(harness.offlineMapReads, 3, 'pack commit lifecycle invalidates the index');
  harness.runtime.destroy();
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
    capturedAt: NOW - 60_000,
    body: JSON.stringify({
      kind: 'lifelines',
      placeId: home.id,
      profileFingerprint: JSON.stringify([2, home.id, home.lat, home.lon, home.radiusKm]),
      capturedAt: NOW - 60_000,
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
