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

function createHarness(initialPlaces = [place('home')]) {
  let places = initialPlaces;
  const callbacks = new Map<string, () => void>();
  const unsubscribed: string[] = [];
  const authoritative = new Map<string, State>();
  const profile = (candidate: Place) => JSON.stringify([2, candidate.id, candidate.lat, candidate.lon, candidate.radiusKm]);
  const adapters = { metadata: { id: 'metadata' }, bodies: { id: 'bodies' }, digest: async () => 'digest' };
  const compositions: string[] = [];
  const sourcePlaces: string[] = [];
  const pruneCalls: Array<{ placeIds: string[]; maxPlaces: number; generationsPerPlace: number }> = [];

  const store = {
    async readActive(scope: Scope): Promise<State> {
      return authoritative.get(scope.profileFingerprint) ?? {
        status: 'not-saved', packId: null, profileFingerprint: scope.profileFingerprint,
      };
    },
    async recoverActive(scope: Scope): Promise<State> {
      return this.readActive(scope);
    },
    async commitGeneration(input: { placeId: string; profileFingerprint: string }): Promise<{ ok: boolean; packId: string }> {
      const state: State = {
        status: 'ready', packId: `pack-${input.placeId}`, profileFingerprint: input.profileFingerprint,
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
      return { lifelines: async () => null };
    },
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
    unsubscribed,
    authoritative,
    profile,
    setPlaces(value: Place[]) { places = value; },
  };
}

test('runtime exports the exact default facade consumed by Emergency Readiness', () => {
  requireFunction('getEmergencyPackState');
  requireFunction('captureEmergencyPack');
  requireFunction('subscribeEmergencyPack');
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
