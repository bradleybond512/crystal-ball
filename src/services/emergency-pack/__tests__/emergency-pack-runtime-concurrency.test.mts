import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createEmergencyPackCaptureOrchestrator,
  type EmergencyPackCapturedArtifact,
  type EmergencyPackCaptureScope,
} from '../emergency-pack-capture.ts';
import { createEmergencyPackCoordinator } from '../emergency-pack-coordinator.ts';
import {
  createEmergencyPackOfflineMapLifecycle,
  createEmergencyPackRuntime,
} from '../emergency-pack-runtime.ts';
import {
  createExactOfflineMapCleanupCoordinator,
  type ExactOfflineMapCache,
} from '../../offline-map-cache.ts';
import { NOW } from './test-support.mts';

const REQUIRED_KINDS = [
  'lifelines',
  'alerts',
  'route-primary',
  'offline-map',
  'comms-plan',
  'contacts',
] as const;

interface Place {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusKm: number;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => undefined;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function within<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('concurrent capture deadlocked')), 1_000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function createConcurrentCaptureHarness(input: {
  holdMapFor?: string;
  failContactsFor?: string;
  concurrentCaptureCount?: number;
  initiallyReady?: string[];
  holdPrune?: boolean;
  pruneMapFor?: string;
}) {
  const places: Place[] = [
    { id: 'home', name: 'Home', lat: 41.6, lon: -86.7, radiusKm: 25 },
    { id: 'work', name: 'Work', lat: 41.7, lon: -86.8, radiusKm: 25 },
  ];
  const profile = (candidate: Place) => `profile-${candidate.id}`;
  const states = new Map<string, {
    status: 'ready' | 'not-saved';
    packId: string | null;
    profileFingerprint: string;
  }>();
  const activeMapBodies = new Map<string, string>();
  const events: string[] = [];
  const mapFailures: string[] = [];
  const pruneFailures: string[] = [];
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
  const lifecycle = createEmergencyPackOfflineMapLifecycle({
    async open() { return cache; },
  }, {
    async verify({ generationId }) {
      events.push(`${generationId.slice('generation-'.length)}:verify`);
      return { ok: true };
    },
    async release({ generationId, tiles }) {
      const placeId = generationId.slice('generation-'.length);
      events.push(`${placeId}:release`);
      return cleanup.releaseGeneration({
        generationId,
        cacheKeys: tiles.map(({ cacheKey }) => cacheKey),
        cache,
      });
    },
  }, cleanup);
  const allNonMapStarted = deferred();
  const heldMapStaged = deferred();
  const releaseHeldMap = deferred();
  const pruneStarted = deferred();
  const releasePrune = deferred();
  const nonMapPlaces = new Set<string>();

  function mapBody(scope: EmergencyPackCaptureScope, generationId: string): string {
    const cacheKey = `https://offline-map.crystalball.invalid/exact/${generationId}/0`;
    return JSON.stringify({
      kind: 'offline-map',
      placeId: scope.placeId,
      profileFingerprint: scope.profileFingerprint,
      capturedAt: NOW,
      generationId,
      tiles: [{
        url: 'https://a.basemaps.cartocdn.com/dark_all/4/1/2@2x.png',
        cacheKey,
        sha256: 'a'.repeat(64),
        generationId,
        byteLength: 4,
        verified: true,
      }],
      totalBytes: 4,
    });
  }

  function artifact(kind: string, scope: EmergencyPackCaptureScope): EmergencyPackCapturedArtifact {
    const sourceRevision = 'a'.repeat(64);
    const body = JSON.stringify({
      kind,
      placeId: scope.placeId,
      profileFingerprint: scope.profileFingerprint,
      capturedAt: NOW,
      ...(kind === 'alerts' ? { sourceRevision } : {}),
    });
    return {
      kind,
      body,
      capturedAt: NOW,
      expiresAt: NOW + 60_000,
      semanticState: 'verified',
      summary: `${kind} verified`,
      itemCount: 1,
      ...(kind === 'alerts' ? { sourceRevision } : {}),
    };
  }

  async function offlineMapArtifact(scope: EmergencyPackCaptureScope): Promise<EmergencyPackCapturedArtifact> {
    const generationId = `generation-${scope.placeId}`;
    const cacheKey = `https://offline-map.crystalball.invalid/exact/${generationId}/0`;
    events.push(`${scope.placeId}:map-start`);
    const prepared = await cleanup.prepareCapture(cache);
    if (!prepared.ok) {
      const reason = prepared.reason ?? 'cleanup-prepare-failed';
      mapFailures.push(`${scope.placeId}:${reason}`);
      throw new Error(reason);
    }
    try {
      cleanup.stageGeneration(generationId, [cacheKey]);
    } catch {
      mapFailures.push(`${scope.placeId}:cleanup-tombstone-write-failed`);
      throw new Error('cleanup-tombstone-write-failed');
    }
    events.push(`${scope.placeId}:map-staged`);
    if (input.holdMapFor === scope.placeId) {
      heldMapStaged.resolve();
      await releaseHeldMap.promise;
    }
    const body = mapBody(scope, generationId);
    return {
      kind: 'offline-map',
      body,
      capturedAt: NOW,
      expiresAt: NOW + 60_000,
      semanticState: 'verified',
      summary: '1 offline map tile verified',
      itemCount: 1,
    };
  }

  for (const placeId of input.initiallyReady ?? []) {
    const candidate = places.find(({ id }) => id === placeId);
    assert.ok(candidate);
    const profileFingerprint = profile(candidate);
    states.set(profileFingerprint, {
      status: 'ready',
      packId: `existing-${placeId}`,
      profileFingerprint,
    });
    activeMapBodies.set(profileFingerprint, mapBody({
      placeId,
      profileFingerprint,
      contactConsent: true,
    }, `existing-${placeId}`));
  }
  const prunedMapBody = input.pruneMapFor
    ? mapBody({
        placeId: input.pruneMapFor,
        profileFingerprint: `profile-${input.pruneMapFor}`,
        contactConsent: true,
      }, `pruned-${input.pruneMapFor}`)
    : null;

  const store = {
    async readActive(scope: EmergencyPackCaptureScope) {
      const state = states.get(scope.profileFingerprint);
      const mapBody = activeMapBodies.get(scope.profileFingerprint);
      if (state && mapBody && !await lifecycle.verifyArtifactBody('offline-map', mapBody)) {
        return {
          status: 'not-saved' as const,
          packId: null,
          profileFingerprint: scope.profileFingerprint,
        };
      }
      return state ?? {
        status: 'not-saved' as const,
        packId: null,
        profileFingerprint: scope.profileFingerprint,
      };
    },
    async recoverActive(scope: EmergencyPackCaptureScope) {
      return this.readActive(scope);
    },
    async commitGeneration(commit: {
      placeId: string;
      profileFingerprint: string;
      artifacts: EmergencyPackCapturedArtifact[];
    }) {
      const map = commit.artifacts.find(({ kind }) => kind === 'offline-map');
      if (!map || !await lifecycle.verifyArtifactBody('offline-map', map.body)) {
        return { ok: false, reason: 'offline-map-verification-failed' };
      }
      events.push(`${commit.placeId}:adopted`);
      const state = {
        status: 'ready' as const,
        packId: `pack-${commit.placeId}`,
        profileFingerprint: commit.profileFingerprint,
      };
      states.set(commit.profileFingerprint, state);
      activeMapBodies.set(commit.profileFingerprint, map.body);
      return { ok: true, packId: state.packId };
    },
    async invalidateArtifacts() { return { ok: true }; },
    async prune() {
      events.push('prune:start');
      pruneStarted.resolve();
      if (input.holdPrune) await releasePrune.promise;
      if (prunedMapBody) {
        try {
          await lifecycle.releaseArtifactBody('offline-map', prunedMapBody);
        } catch (error) {
          pruneFailures.push(error instanceof Error ? error.message : 'prune-release-failed');
          throw error;
        }
      }
      events.push('prune:end');
    },
  };

  const runtime = createEmergencyPackRuntime({
    now: () => NOW,
    buildProfileFingerprint: profile,
    getSavedPlaces: () => places,
    createBrowserAdapters: () => ({}),
    createStore: () => store,
    createCoordinator: createEmergencyPackCoordinator,
    createSources: () => Object.fromEntries(REQUIRED_KINDS.map((kind) => [kind, async (scope: EmergencyPackCaptureScope) => {
      if (kind === 'lifelines') {
        events.push(`${scope.placeId}:non-map-start`);
        nonMapPlaces.add(scope.placeId);
        if (nonMapPlaces.size === (input.concurrentCaptureCount ?? places.length)) allNonMapStarted.resolve();
        await allNonMapStarted.promise;
      }
      if (kind === 'offline-map') return offlineMapArtifact(scope);
      if (kind === 'contacts' && input.failContactsFor === scope.placeId) return null;
      return artifact(kind, scope);
    }])),
    getLegacyLifelinePackManifest: () => null,
    createCaptureOrchestrator: createEmergencyPackCaptureOrchestrator,
    releaseArtifact: lifecycle.releaseArtifact,
    subscribeSavedPlaces: () => () => undefined,
    subscribeRoutes: () => () => undefined,
    subscribeComms: () => () => undefined,
    subscribeLifelines: () => () => undefined,
    subscribeAlerts: () => () => undefined,
  });

  return {
    places,
    runtime,
    events,
    mapFailures,
    pruneFailures,
    allNonMapStarted: allNonMapStarted.promise,
    heldMapStaged: heldMapStaged.promise,
    releaseHeldMap: releaseHeldMap.resolve,
    pruneStarted: pruneStarted.promise,
    releasePrune: releasePrune.resolve,
  };
}

test('two places serialize the complete offline-map lifecycle without blocking earlier source work', async () => {
  const harness = createConcurrentCaptureHarness({ holdMapFor: 'home' });
  const captures = harness.places.map((candidate) => harness.runtime.capture(candidate, true));

  await within(harness.allNonMapStarted);
  await within(harness.heldMapStaged);
  harness.releaseHeldMap();
  const states = await within(Promise.all(captures));

  assert.deepEqual(states.map(({ status }) => status), ['ready', 'ready']);
  assert.deepEqual(harness.mapFailures, []);
  assert.deepEqual(harness.events.filter((event) => !event.endsWith('non-map-start')), [
    'home:map-start',
    'home:map-staged',
    'home:verify',
    'home:adopted',
    'home:verify',
    'work:map-start',
    'work:map-staged',
    'work:verify',
    'work:adopted',
    'work:verify',
  ]);
  harness.runtime.destroy();
});

test('failed capture releases the offline-map lifecycle before the next place without deadlock', async () => {
  const harness = createConcurrentCaptureHarness({ failContactsFor: 'home' });

  const states = await within(Promise.all(
    harness.places.map((candidate) => harness.runtime.capture(candidate, true)),
  ));

  assert.deepEqual(states.map(({ status }) => status), ['not-saved', 'ready']);
  assert.deepEqual(harness.mapFailures, []);
  assert.deepEqual(harness.events.filter((event) => !event.endsWith('non-map-start')), [
    'home:map-start',
    'home:map-staged',
    'home:release',
    'work:map-start',
    'work:map-staged',
    'work:verify',
    'work:adopted',
    'work:verify',
  ]);
  harness.runtime.destroy();
});

test('refresh verification waits for another place map lifecycle without hiding its saved pack', async () => {
  const harness = createConcurrentCaptureHarness({
    concurrentCaptureCount: 1,
    holdMapFor: 'home',
    initiallyReady: ['work'],
  });
  const capture = harness.runtime.capture(harness.places[0]!, true);
  await within(harness.heldMapStaged);

  const hydration = harness.runtime.hydrate();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const verifiedWorkBeforeRelease = harness.events.includes('work:verify');
  harness.releaseHeldMap();
  await within(Promise.all([capture, hydration]));

  assert.equal(verifiedWorkBeforeRelease, false);
  assert.equal(harness.runtime.getState(harness.places[1]!).status, 'ready');
  harness.runtime.destroy();
});

test('prune release finishes before a new place can stage an offline-map generation', async () => {
  const harness = createConcurrentCaptureHarness({
    concurrentCaptureCount: 1,
    holdMapFor: 'home',
    holdPrune: true,
    pruneMapFor: 'stale',
  });
  const hydration = harness.runtime.hydrate();
  await within(harness.pruneStarted);

  const capture = harness.runtime.capture(harness.places[0]!, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const mapStartedBeforePruneFinished = harness.events.includes('home:map-start');
  harness.releasePrune();
  await within(hydration);
  await within(harness.heldMapStaged);
  harness.releaseHeldMap();
  const state = await within(capture);

  assert.equal(mapStartedBeforePruneFinished, false);
  assert.deepEqual(harness.pruneFailures, []);
  assert.equal(state.status, 'ready');
  assert.ok(harness.events.indexOf('prune:end') < harness.events.indexOf('home:map-start'));
  harness.runtime.destroy();
});

function createAlertRevisionRaceHarness(options: { initiallyReady?: boolean; failFirstRevisionB?: boolean } = {}) {
  const place: Place = { id: 'home', name: 'Home', lat: 41.6, lon: -86.7, radiusKm: 25 };
  const profileFingerprint = 'profile-home';
  const revisionA = 'a'.repeat(64);
  let currentRevision = revisionA;
  let alertSequence = 0;
  let alertSubscriber: ((event: { sourceRevision: string }) => void) | null = null;
  let state = {
    status: (options.initiallyReady ? 'ready' : 'not-saved') as 'ready' | 'not-saved',
    packId: options.initiallyReady ? 'pack-old-a' : null as string | null,
    profileFingerprint,
  };
  const alertCaptured = deferred();
  const continueCapture = deferred();
  const invalidations: string[] = [];
  let failedRevisionB = false;

  function artifact(kind: string, scope: EmergencyPackCaptureScope): EmergencyPackCapturedArtifact {
    const body = JSON.stringify({
      kind,
      placeId: scope.placeId,
      profileFingerprint: scope.profileFingerprint,
      capturedAt: NOW,
      ...(kind === 'alerts' ? { sourceRevision: revisionA } : {}),
    });
    return {
      kind,
      body,
      capturedAt: NOW,
      expiresAt: NOW + 60_000,
      semanticState: 'verified',
      summary: `${kind} verified`,
      itemCount: 1,
      ...(kind === 'alerts' ? { sourceRevision: revisionA } : {}),
    };
  }

  const runtime = createEmergencyPackRuntime({
    now: () => NOW,
    buildProfileFingerprint: () => profileFingerprint,
    getSavedPlaces: () => [place],
    createBrowserAdapters: () => ({}),
    createStore: () => ({
      async readActive() { return state; },
      async recoverActive() { return state; },
      async commitGeneration(input: { artifacts: EmergencyPackCapturedArtifact[] }) {
        const capturedRevision = input.artifacts.find(({ kind }) => kind === 'alerts')?.sourceRevision;
        const boundSequence = alertSequence;
        if (capturedRevision !== currentRevision || boundSequence !== alertSequence) {
          return { ok: false, reason: 'alert-source-changed' };
        }
        state = { status: 'ready', packId: 'pack-home', profileFingerprint };
        return { ok: true, packId: 'pack-home' };
      },
      async invalidateArtifacts(input: { kinds: readonly string[]; sourceRevision?: string }) {
        if (input.kinds.includes('alerts') && input.sourceRevision) {
          invalidations.push(input.sourceRevision);
          if (options.failFirstRevisionB && input.sourceRevision === 'b'.repeat(64) && !failedRevisionB) {
            failedRevisionB = true;
            return { ok: false, reason: 'storage-failure' };
          }
          if (currentRevision !== input.sourceRevision) {
            alertSequence += 1;
            currentRevision = input.sourceRevision;
            state = { status: 'not-saved', packId: null, profileFingerprint };
          }
        }
        return { ok: true };
      },
    }),
    createCoordinator: createEmergencyPackCoordinator,
    createSources: () => Object.fromEntries(REQUIRED_KINDS.map((kind) => [kind, async (scope: EmergencyPackCaptureScope) => {
      if (kind === 'route-primary') {
        alertCaptured.resolve();
        await continueCapture.promise;
      }
      return artifact(kind, scope);
    }])),
    createCaptureOrchestrator: createEmergencyPackCaptureOrchestrator,
    releaseArtifact: async () => undefined,
    getLegacyLifelinePackManifest: () => null,
    subscribeSavedPlaces: () => () => undefined,
    subscribeRoutes: () => () => undefined,
    subscribeComms: () => () => undefined,
    subscribeLifelines: () => () => undefined,
    subscribeAlerts: (callback) => {
      alertSubscriber = callback;
      return () => { alertSubscriber = null; };
    },
  });

  return {
    place,
    runtime,
    revisionA,
    revisionB: 'b'.repeat(64),
    alertCaptured: alertCaptured.promise,
    continueCapture: continueCapture.resolve,
    emitAlertRevision(sourceRevision: string): void { alertSubscriber?.({ sourceRevision }); },
    invalidations,
  };
}

test('capture cannot publish alert revision A after authoritative subscription advances to B', async () => {
  const harness = createAlertRevisionRaceHarness();
  const emitted: string[] = [];
  harness.runtime.subscribe(({ status }) => { emitted.push(status); });
  const capture = harness.runtime.capture(harness.place, true);

  await within(harness.alertCaptured);
  harness.emitAlertRevision(harness.revisionB);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const invalidatedBeforeCommitFinished = harness.invalidations.includes(harness.revisionB);
  harness.continueCapture();
  const captured = await within(capture);

  assert.equal(invalidatedBeforeCommitFinished, true, 'authoritative B must persist outside the blocked place queue');
  assert.notEqual(captured.status, 'ready', 'capture must fail closed when its captured alert revision is stale');
  assert.equal(emitted.includes('ready'), false, 'stale readiness must never be published to subscribers');
  harness.runtime.destroy();
});

test('capture does not rebind an old alert A artifact after authoritative A to B to A transitions', async () => {
  const harness = createAlertRevisionRaceHarness();
  const emitted: string[] = [];
  harness.runtime.subscribe(({ status }) => { emitted.push(status); });
  const capture = harness.runtime.capture(harness.place, true);

  await within(harness.alertCaptured);
  harness.emitAlertRevision(harness.revisionB);
  harness.emitAlertRevision(harness.revisionA);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const persistedSequence = [...harness.invalidations];
  harness.continueCapture();
  const captured = await within(capture);

  assert.deepEqual(persistedSequence, [harness.revisionB, harness.revisionA]);
  assert.notEqual(captured.status, 'ready', 'the old A artifact must not bind to the later A sequence');
  assert.equal(emitted.includes('ready'), false);
  harness.runtime.destroy();
});

test('failed B persistence is replayed before A can clear the fail-closed alert barrier', async () => {
  const harness = createAlertRevisionRaceHarness({ initiallyReady: true, failFirstRevisionB: true });
  const emitted: string[] = [];
  harness.runtime.subscribe(({ status }) => { emitted.push(status); });
  const capture = harness.runtime.capture(harness.place, true);

  await within(harness.alertCaptured);
  harness.emitAlertRevision(harness.revisionB);
  harness.emitAlertRevision(harness.revisionA);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const persistenceAttempts = [...harness.invalidations];
  harness.continueCapture();
  const captured = await within(capture);

  assert.deepEqual(persistenceAttempts, [harness.revisionB, harness.revisionB, harness.revisionA]);
  assert.notEqual(captured.status, 'ready', 'the old A pack must stay revoked after a failed B transition');
  assert.equal(emitted.includes('ready'), false);
  harness.runtime.destroy();
});

test('verified offline-map tile resolution holds the lifecycle lease until its cache digest read completes', async () => {
  const place: Place = { id: 'home', name: 'Home', lat: 41.6, lon: -86.7, radiusKm: 25 };
  const profileFingerprint = 'profile-home';
  const sourceUrl = 'https://a.basemaps.cartocdn.com/dark_all/4/1/2@2x.png';
  const generationId = 'resolver-prune-race';
  const cacheKey = `https://offline-map.crystalball.invalid/exact/${generationId}/0`;
  const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  const body = JSON.stringify({
    kind: 'offline-map',
    placeId: place.id,
    profileFingerprint,
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
  const tileReadStarted = deferred();
  const releaseTileRead = deferred();
  const failingTileReadStarted = deferred();
  const releaseFailingTileRead = deferred();
  const secondPruneStarted = deferred();
  const thirdPruneStarted = deferred();
  let savedPlacesSubscriber: (() => void) | null = null;
  let pruneCalls = 0;
  let rejectTileRead = false;
  const ready = { status: 'ready' as const, packId: 'pack-home', profileFingerprint };
  const cache: ExactOfflineMapCache = {
    async put() { return undefined; },
    async delete() { return true; },
    async match(key) {
      if (String(key) !== cacheKey) return undefined;
      if (rejectTileRead) {
        failingTileReadStarted.resolve();
        await releaseFailingTileRead.promise;
        throw new Error('cache read failed');
      }
      tileReadStarted.resolve();
      await releaseTileRead.promise;
      return new Response(bytes.slice(), { status: 200, headers: { 'content-type': 'image/png' } });
    },
  };
  const runtime = createEmergencyPackRuntime({
    now: () => NOW,
    buildProfileFingerprint: () => profileFingerprint,
    getSavedPlaces: () => [place],
    createBrowserAdapters: () => ({}),
    createStore: () => ({
      async readActive() { return ready; },
      async recoverActive() { return ready; },
      async commitGeneration() { return { ok: false, reason: 'not-used' }; },
      async invalidateArtifacts() { return { ok: true }; },
      readOfflineMapRevision: () => 'head-1',
      async readVerifiedOfflineMapArtifact() {
        return { body, revision: 'head-1', expiresAt: NOW + 60_000 };
      },
      async prune() {
        pruneCalls += 1;
        if (pruneCalls === 2) secondPruneStarted.resolve();
        if (pruneCalls === 3) thirdPruneStarted.resolve();
      },
    }),
    createCoordinator: createEmergencyPackCoordinator,
    createSources: () => ({}),
    createCaptureOrchestrator: createEmergencyPackCaptureOrchestrator,
    releaseArtifact: async () => undefined,
    getLegacyLifelinePackManifest: () => null,
    subscribeSavedPlaces: (callback) => {
      savedPlacesSubscriber = callback;
      return () => { savedPlacesSubscriber = null; };
    },
    subscribeRoutes: () => () => undefined,
    subscribeComms: () => () => undefined,
    subscribeLifelines: () => () => undefined,
    subscribeAlerts: () => () => undefined,
    openOfflineMapCache: async () => cache,
  });
  await runtime.hydrate();
  assert.equal(pruneCalls, 1);

  const resolution = runtime.resolveOfflineMapTile(sourceUrl);
  await within(tileReadStarted.promise);
  savedPlacesSubscriber?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const pruneStartedBeforeTileReadFinished = pruneCalls > 1;
  releaseTileRead.resolve();
  const tile = await within(resolution);
  await within(secondPruneStarted.promise);

  assert.equal(pruneStartedBeforeTileReadFinished, false, 'prune must wait for the exact cache read and digest');
  assert.deepEqual(new Uint8Array(tile?.data ?? new ArrayBuffer(0)), bytes);

  rejectTileRead = true;
  const failedResolution = runtime.resolveOfflineMapTile(sourceUrl);
  await within(failingTileReadStarted.promise);
  savedPlacesSubscriber?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const pruneStartedBeforeFailedReadFinished = pruneCalls > 2;
  releaseFailingTileRead.resolve();
  assert.equal(await within(failedResolution), null);
  await within(thirdPruneStarted.promise);
  assert.equal(pruneStartedBeforeFailedReadFinished, false, 'a failed cache read must hold then release the lease');
  runtime.destroy();
});
