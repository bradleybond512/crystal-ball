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
  const events: string[] = [];
  const mapFailures: string[] = [];
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
  const nonMapPlaces = new Set<string>();

  function artifact(kind: string, scope: EmergencyPackCaptureScope): EmergencyPackCapturedArtifact {
    const body = JSON.stringify({
      kind,
      placeId: scope.placeId,
      profileFingerprint: scope.profileFingerprint,
      capturedAt: NOW,
    });
    return {
      kind,
      body,
      capturedAt: NOW,
      expiresAt: NOW + 60_000,
      semanticState: 'verified',
      summary: `${kind} verified`,
      itemCount: 1,
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
    const body = JSON.stringify({
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

  const store = {
    async readActive(scope: EmergencyPackCaptureScope) {
      return states.get(scope.profileFingerprint) ?? {
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
      return { ok: true, packId: state.packId };
    },
    async invalidateArtifacts() { return { ok: true }; },
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
        if (nonMapPlaces.size === places.length) allNonMapStarted.resolve();
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
    allNonMapStarted: allNonMapStarted.promise,
    heldMapStaged: heldMapStaged.promise,
    releaseHeldMap: releaseHeldMap.resolve,
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
    'work:map-start',
    'work:map-staged',
    'work:verify',
    'work:adopted',
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
  ]);
  harness.runtime.destroy();
});
