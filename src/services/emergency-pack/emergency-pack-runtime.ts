import { getCommsPlan, subscribeCommsPlans } from '@/services/comms-plan';
import { getSavedRoutes, subscribeEvacRoutes } from '@/services/evacuation-router';
import {
  buildLocalLogisticsFingerprint,
  getCachedLocalLogistics,
  LOCAL_LOGISTICS_CATEGORIES,
} from '@/services/local-logistics';
import { getVerifiedLifelinesReceiptForPlace } from '@/services/lifelines/lifeline-runtime';
import {
  captureOfflineMapTilesExact,
  planOfflineMapTileUrls,
} from '@/services/offline-map-cache';
import { getSavedPlaces, subscribeSavedPlaces, type SavedPlace } from '@/services/saved-places';
import { getStormSnapshot } from '@/services/survival/storm-posture-state';
import { matchAlertToPlace } from '@/services/weather/nws-polygon-match';
import type {
  NwsAlertMinimal,
  SavedPlace as WeatherSavedPlace,
} from '@/services/weather/weather-threat-types';
import { createEmergencyPackBrowserAdapters } from './emergency-pack-browser';
import {
  createEmergencyPackCaptureOrchestrator,
  type EmergencyPackCaptureResult,
  type EmergencyPackCapturedArtifact,
  type EmergencyPackCaptureScope,
} from './emergency-pack-capture';
import {
  createEmergencyPackCoordinator,
  type EmergencyPackCoordinatorDependencies,
  type EmergencyPackCoordinatorState,
} from './emergency-pack-coordinator';
import {
  EMERGENCY_PACK_OPTIONAL_KINDS,
  EMERGENCY_PACK_REQUIRED_KINDS,
  type EmergencyPackReceipt,
  type EmergencyPackStatus,
} from './emergency-pack-schema';
import {
  buildEmergencyPackProfileFingerprint,
  createEmergencyPackSources,
  type EmergencyPackArtifactSource,
} from './emergency-pack-sources';
import { createEmergencyPackStore } from './emergency-pack-store';

const MAX_PLACES = 5;
const GENERATIONS_PER_PLACE = 2;
const LIFELINES_RADIUS_KM = 25;
const MAP_CACHE_NAME = 'wm-offline-maps';
const MAP_EXPIRY_MS = 30 * 24 * 60 * 60_000;
const MAP_CAPTURE_TIMEOUT_MS = 60_000;

type RuntimePlace = Pick<SavedPlace, 'id' | 'name' | 'lat' | 'lon' | 'radiusKm'>;

export interface EmergencyPackRuntimeState {
  status: EmergencyPackStatus;
  packId: string | null;
  profileFingerprint: string;
  requiredKinds?: readonly string[];
  optionalKinds?: readonly string[];
  receipts?: readonly EmergencyPackReceipt[];
  missingKinds?: readonly string[];
  expiredKinds?: readonly string[];
  reason?: string;
}

interface EmergencyPackRuntimeStore {
  readActive(scope: EmergencyPackCaptureScope & { now: number }): Promise<{
    status: string;
    packId: string | null;
    profileFingerprint?: string;
    reason?: string;
  }>;
  readReadiness?(scope: EmergencyPackCaptureScope & { now: number }): Promise<{
    status: string;
    packId: string | null;
    profileFingerprint: string;
    requiredKinds?: readonly string[];
    optionalKinds?: readonly string[];
    receipts?: readonly EmergencyPackReceipt[];
    missingKinds?: readonly string[];
    expiredKinds?: readonly string[];
    reason?: string;
  }>;
  recoverActive(scope: EmergencyPackCaptureScope & { now: number }): Promise<{
    status: string;
    packId: string | null;
    profileFingerprint?: string;
    reason?: string;
  }>;
  commitGeneration(input: Parameters<ReturnType<typeof createEmergencyPackStore>['commitGeneration']>[0]): Promise<{
    ok: boolean;
    packId?: string;
    reason?: string;
  }>;
  migrateLifelineGeneration?(input: {
    placeId: string;
    profileFingerprint: string;
    legacyQueryFingerprint: string;
    legacyManifest: unknown;
    artifact: EmergencyPackCapturedArtifact;
  }): Promise<{ ok: boolean; packId?: string; reason?: string }>;
  prune?(input: { placeIds: string[]; maxPlaces: number; generationsPerPlace: number }): Promise<void>;
}

interface EmergencyPackRuntimeDependencies {
  now(): number;
  buildProfileFingerprint(place: RuntimePlace): string;
  getSavedPlaces(): RuntimePlace[];
  createBrowserAdapters(): unknown;
  createStore(adapters: unknown): EmergencyPackRuntimeStore;
  createCoordinator(dependencies: EmergencyPackCoordinatorDependencies): ReturnType<typeof createEmergencyPackCoordinator>;
  createSources(place: RuntimePlace): Partial<Record<string, EmergencyPackArtifactSource>>;
  createCaptureOrchestrator(dependencies: {
    sources: Partial<Record<string, EmergencyPackArtifactSource>>;
    commitGeneration: EmergencyPackRuntimeStore['commitGeneration'];
  }): { capture(scope: EmergencyPackCaptureScope): Promise<EmergencyPackCaptureResult> };
  getLegacyLifelinePackManifest(placeId: string): unknown | null;
  subscribeSavedPlaces(callback: () => void): () => void;
  subscribeRoutes(callback: () => void): () => void;
  subscribeComms(callback: () => void): () => void;
  subscribeLifelines(callback: () => void): () => void;
}

interface EmergencyPackRuntimeCaptureResult extends EmergencyPackCaptureResult {
  state: EmergencyPackRuntimeState;
}

function notSaved(profileFingerprint: string, reason?: string): EmergencyPackRuntimeState {
  return {
    status: 'not-saved',
    packId: null,
    profileFingerprint,
    requiredKinds: [...EMERGENCY_PACK_REQUIRED_KINDS],
    optionalKinds: [...EMERGENCY_PACK_OPTIONAL_KINDS],
    receipts: [],
    missingKinds: [...EMERGENCY_PACK_REQUIRED_KINDS],
    expiredKinds: [],
    ...(reason ? { reason } : {}),
  };
}

function coordinatorState(state: EmergencyPackRuntimeState): EmergencyPackCoordinatorState {
  return {
    status: state.status,
    packId: state.packId,
    profileFingerprint: state.profileFingerprint,
  };
}

function validState(value: unknown, profileFingerprint: string): value is EmergencyPackRuntimeState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<EmergencyPackRuntimeState>;
  return state.profileFingerprint === profileFingerprint
    && ['ready', 'partial', 'expired', 'not-saved'].includes(state.status ?? '')
    && (state.packId === null || (typeof state.packId === 'string' && state.packId.length > 0));
}

function strictJsonRecord(value: unknown): Record<string, unknown> | null {
  try {
    const encoded = JSON.stringify(value);
    if (typeof encoded !== 'string') return null;
    const parsed = JSON.parse(encoded) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const prototype: unknown = Object.getPrototypeOf(parsed);
    return prototype === Object.prototype || prototype === null
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function readLegacyLifelinePackManifestV1(
  storage: Pick<Storage, 'getItem'>,
  placeId: string,
): unknown | null {
  try {
    const encoded = storage.getItem(`wm_lifeline_pack_manifest_v1:${placeId}`);
    if (encoded === null) return null;
    return strictJsonRecord(JSON.parse(encoded));
  } catch {
    return null;
  }
}

export function createEmergencyPackRuntime(dependencies: EmergencyPackRuntimeDependencies) {
  const adapters = dependencies.createBrowserAdapters();
  const store = dependencies.createStore(adapters);
  const listeners = new Set<(state: EmergencyPackRuntimeState) => void>();
  const states = new Map<string, EmergencyPackRuntimeState>();
  const placeGenerations = new Map<string, number>();
  const captureContexts = new Map<string, { place: RuntimePlace; contactConsent: boolean }>();
  const captureResults = new Map<string, EmergencyPackCaptureResult>();
  const operationQueues = new Map<string, Promise<void>>();
  let active = true;

  const readDetailed = async (scope: EmergencyPackCaptureScope): Promise<EmergencyPackRuntimeState> => {
    const operation = store.readReadiness?.bind(store) ?? store.readActive.bind(store);
    try {
      const state = await operation({ ...scope, now: dependencies.now() });
      const scopedState = { ...state, profileFingerprint: state.profileFingerprint ?? scope.profileFingerprint };
      return validState(scopedState, scope.profileFingerprint)
        ? scopedState
        : notSaved(scope.profileFingerprint, 'invalid-state');
    } catch {
      return notSaved(scope.profileFingerprint, 'storage-failure');
    }
  };

  const coordinator = dependencies.createCoordinator({
    readActive: async (scope) => coordinatorState(await readDetailed({ ...scope, contactConsent: false })),
    recoverActive: async (scope) => {
      try {
        await store.recoverActive({ ...scope, contactConsent: false, now: dependencies.now() });
      } catch {
        return coordinatorState(notSaved(scope.profileFingerprint, 'storage-failure'));
      }
      return coordinatorState(await readDetailed({ ...scope, contactConsent: false }));
    },
    captureAndCommit: async (scope) => {
      const context = captureContexts.get(scope.placeId);
      if (!context || dependencies.buildProfileFingerprint(context.place) !== scope.profileFingerprint) {
        captureResults.set(scope.placeId, { ok: false, reason: 'scope-changed' });
        return coordinatorState(notSaved(scope.profileFingerprint, 'scope-changed'));
      }
      const orchestrator = dependencies.createCaptureOrchestrator({
        sources: dependencies.createSources(context.place),
        commitGeneration: store.commitGeneration.bind(store),
      });
      captureResults.set(scope.placeId, await orchestrator.capture({
        ...scope,
        contactConsent: context.contactConsent,
      }));
      return coordinatorState(await readDetailed({ ...scope, contactConsent: context.contactConsent }));
    },
  });

  function scopeFor(place: RuntimePlace): EmergencyPackCaptureScope | null {
    try {
      const profileFingerprint = dependencies.buildProfileFingerprint(place);
      if (typeof profileFingerprint !== 'string' || profileFingerprint.length === 0) return null;
      return { placeId: place.id, profileFingerprint, contactConsent: false };
    } catch {
      return null;
    }
  }

  function begin(placeId: string): number {
    const generation = (placeGenerations.get(placeId) ?? 0) + 1;
    placeGenerations.set(placeId, generation);
    return generation;
  }

  function publish(placeId: string, generation: number, state: EmergencyPackRuntimeState): void {
    if (!active || placeGenerations.get(placeId) !== generation) return;
    states.set(placeId, state);
    for (const listener of listeners) listener({ ...state });
  }

  async function enqueuePlaceOperation<T>(placeId: string, operation: () => Promise<T>): Promise<T> {
    const prior = operationQueues.get(placeId) ?? Promise.resolve();
    const current = prior.catch(() => undefined).then(operation);
    const tail = current.then(() => undefined, () => undefined);
    operationQueues.set(placeId, tail);
    try {
      return await current;
    } finally {
      if (operationQueues.get(placeId) === tail) operationQueues.delete(placeId);
    }
  }

  async function recoverAndMigrate(
    place: RuntimePlace,
    scope: EmergencyPackCaptureScope,
  ): Promise<EmergencyPackRuntimeState> {
    await coordinator.recover(scope);
    const recovered = await readDetailed(scope);
    if (recovered.status !== 'not-saved' || !store.migrateLifelineGeneration) return recovered;

    const legacyManifest = strictJsonRecord(dependencies.getLegacyLifelinePackManifest(place.id));
    const legacyQueryFingerprint = legacyManifest?.queryFingerprint;
    if (typeof legacyQueryFingerprint !== 'string' || legacyQueryFingerprint.length === 0) return recovered;

    const lifelines = dependencies.createSources(place).lifelines;
    if (!lifelines) return recovered;
    const artifact = await lifelines(scope);
    if (!artifact || artifact.kind !== 'lifelines') return recovered;

    const migrated = await store.migrateLifelineGeneration({
      placeId: scope.placeId,
      profileFingerprint: scope.profileFingerprint,
      legacyQueryFingerprint,
      legacyManifest,
      artifact,
    });
    return migrated.ok ? readDetailed(scope) : recovered;
  }

  async function refreshPlace(place: RuntimePlace, recover: boolean): Promise<EmergencyPackRuntimeState> {
    const scope = scopeFor(place);
    if (!scope) return notSaved('', 'scope-invalid');
    return enqueuePlaceOperation(place.id, async () => {
      const generation = begin(place.id);
      try {
        let state: EmergencyPackRuntimeState;
        if (recover) {
          state = await recoverAndMigrate(place, scope);
        } else {
          await coordinator.refresh(scope);
          state = await readDetailed(scope);
        }
        publish(place.id, generation, state);
        return state;
      } catch {
        const state = notSaved(scope.profileFingerprint, 'storage-failure');
        publish(place.id, generation, state);
        return state;
      }
    });
  }

  function retainedPlaces(): RuntimePlace[] {
    return dependencies.getSavedPlaces().slice(0, MAX_PLACES);
  }

  function isRetainedPlace(place: RuntimePlace, scope: EmergencyPackCaptureScope): boolean {
    return retainedPlaces().some((candidate) => {
      if (candidate.id !== place.id) return false;
      return scopeFor(candidate)?.profileFingerprint === scope.profileFingerprint;
    });
  }

  async function refreshAll(recover: boolean): Promise<void> {
    if (!active) return;
    const places = retainedPlaces();
    await Promise.all(places.map((place) => refreshPlace(place, recover)));
    try {
      await store.prune?.({
        placeIds: places.map(({ id }) => id),
        maxPlaces: MAX_PLACES,
        generationsPerPlace: GENERATIONS_PER_PLACE,
      });
    } catch {
      // Pruning is best effort and never changes the verified readiness map.
    }
  }

  const invalidate = () => { void refreshAll(false); };
  const unsubscribers = [
    dependencies.subscribeSavedPlaces(invalidate),
    dependencies.subscribeRoutes(invalidate),
    dependencies.subscribeComms(invalidate),
    dependencies.subscribeLifelines(invalidate),
  ];

  async function executeCapture(
    place: RuntimePlace,
    contactConsent: boolean,
  ): Promise<EmergencyPackRuntimeCaptureResult> {
    if (!active) {
      const state = notSaved('', 'runtime-destroyed');
      return { ok: false, reason: 'runtime-destroyed', state };
    }
    const scope = scopeFor(place);
    if (!scope) {
      const state = notSaved('', 'scope-invalid');
      return { ok: false, reason: 'scope-invalid', state };
    }
    if (!isRetainedPlace(place, scope)) {
      const state = notSaved(scope.profileFingerprint, 'place-not-retained');
      return { ok: false, reason: 'place-not-retained', state };
    }
    captureContexts.set(place.id, { place, contactConsent });
    captureResults.set(place.id, { ok: false, reason: 'capture-failed' });
    try {
      await coordinator.capture(scope);
    } catch {
      captureResults.set(place.id, { ok: false, reason: 'capture-failed' });
    } finally {
      captureContexts.delete(place.id);
    }
    const state = await readDetailed({ ...scope, contactConsent });
    const generation = begin(place.id);
    publish(place.id, generation, state);
    const result = captureResults.get(place.id) ?? { ok: false, reason: 'capture-failed' };
    captureResults.delete(place.id);
    const exactCommitReady = result.ok
      && state.status === 'ready'
      && (result.packId === undefined || result.packId === state.packId);
    return {
      ...(exactCommitReady ? result : { ...result, ok: false }),
      state,
    };
  }

  async function capturePlace(
    place: RuntimePlace,
    contactConsent: boolean,
  ): Promise<EmergencyPackRuntimeCaptureResult> {
    return enqueuePlaceOperation(place.id, () => executeCapture(place, contactConsent));
  }

  return {
    hydrate(): Promise<void> {
      return refreshAll(true);
    },

    getState(place: RuntimePlace): EmergencyPackRuntimeState {
      const scope = scopeFor(place);
      if (!scope) return notSaved('', 'scope-invalid');
      const state = states.get(place.id);
      return state?.profileFingerprint === scope.profileFingerprint
        ? { ...state }
        : notSaved(scope.profileFingerprint);
    },

    async capture(place: RuntimePlace, contactConsent: boolean): Promise<EmergencyPackRuntimeState> {
      const result = await capturePlace(place, contactConsent);
      return result.state;
    },

    async captureResult(place: RuntimePlace, contactConsent: boolean): Promise<EmergencyPackRuntimeCaptureResult> {
      return capturePlace(place, contactConsent);
    },

    subscribe(listener: (state: EmergencyPackRuntimeState) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    destroy(): void {
      if (!active) return;
      active = false;
      for (const unsubscribe of unsubscribers) unsubscribe();
      listeners.clear();
      placeGenerations.clear();
      captureContexts.clear();
      captureResults.clear();
      operationQueues.clear();
    },
  };
}

function subscribeLifelines(callback: () => void): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const listener = () => callback();
  document.addEventListener('wm:lifeline-situation-updated', listener);
  return () => document.removeEventListener('wm:lifeline-situation-updated', listener);
}

function fetchDefaultMapTile(url: string, signal: AbortSignal): Promise<Response> {
  return fetch(url, {
    mode: 'cors',
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    signal,
  });
}

async function captureDefaultOfflineMap(
  place: RuntimePlace,
  scope: EmergencyPackCaptureScope,
): Promise<EmergencyPackCapturedArtifact | null> {
  if (typeof caches === 'undefined' || typeof fetch !== 'function') return null;
  const plan = planOfflineMapTileUrls(place.lat, place.lon, Math.min(place.radiusKm, 100));
  if (!plan.ok) return null;
  const cache = await caches.open(MAP_CACHE_NAME);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAP_CAPTURE_TIMEOUT_MS);
  const captured = await captureOfflineMapTilesExact({
    tileUrls: plan.tileUrls,
    cache,
    fetchTile: (url) => fetchDefaultMapTile(url, controller.signal),
    concurrency: 4,
  }).finally(() => clearTimeout(timeout));
  if (!captured.ok) return null;
  const body = JSON.stringify({
    kind: 'offline-map',
    placeId: scope.placeId,
    profileFingerprint: scope.profileFingerprint,
    tiles: captured.tiles,
    totalBytes: captured.totalBytes,
  });
  return {
    kind: 'offline-map',
    body,
    expiresAt: Date.now() + MAP_EXPIRY_MS,
    semanticState: 'verified',
    summary: `${captured.tiles.length} offline map tiles verified`,
    itemCount: captured.tiles.length,
  };
}

function createDefaultBrowserAdapters(): ReturnType<typeof createEmergencyPackBrowserAdapters> {
  return createEmergencyPackBrowserAdapters({
    cacheStorage: caches,
    metadataStorage: localStorage,
  });
}

function createDefaultRuntime(): ReturnType<typeof createEmergencyPackRuntime> | null {
  if (
    typeof localStorage === 'undefined'
    || typeof caches === 'undefined'
  ) return null;
  return createEmergencyPackRuntime({
    now: Date.now,
    buildProfileFingerprint: buildEmergencyPackProfileFingerprint,
    getSavedPlaces,
    createBrowserAdapters: createDefaultBrowserAdapters,
    createStore: (boundaries) => createEmergencyPackStore({
      ...(boundaries as ReturnType<typeof createDefaultBrowserAdapters>),
      now: Date.now,
      createPackId: () => crypto.randomUUID(),
    }),
    createCoordinator: createEmergencyPackCoordinator,
    createSources: (place) => createEmergencyPackSources(place, {
      now: Date.now,
      buildLifelinesQueryFingerprint: (target) => buildLocalLogisticsFingerprint(
        target,
        Math.max(1, Math.min(target.radiusKm, LIFELINES_RADIUS_KM)),
        [...LOCAL_LOGISTICS_CATEGORIES],
      ),
      getLifelinesSnapshot: (target) => {
        const authoritative = getSavedPlaces().find((candidate) => (
          candidate.id === target.id
          && candidate.lat === target.lat
          && candidate.lon === target.lon
          && candidate.radiusKm === target.radiusKm
        ));
        return authoritative ? getCachedLocalLogistics(authoritative) : null;
      },
      getVerifiedLifelinesReceipt: getVerifiedLifelinesReceiptForPlace,
      getAlertFeed: () => {
        const snapshot = getStormSnapshot();
        const weather = snapshot?.freshness.find(({ domain }) => domain === 'weather');
        return snapshot && weather?.ok
          ? { alerts: snapshot.weatherAlerts, capturedAt: weather.fetchedAtMs }
          : null;
      },
      matchAlertToPlace: (alert, place, options) => matchAlertToPlace(
        alert as NwsAlertMinimal,
        place as unknown as WeatherSavedPlace,
        options,
      ),
      getRoutes: getSavedRoutes,
      getCommsPlan,
      getSelectedContactIds: (placeId) => getCommsPlan(placeId)?.contacts.map(({ id }) => id) ?? [],
      captureOfflineMap: captureDefaultOfflineMap,
    }),
    createCaptureOrchestrator: createEmergencyPackCaptureOrchestrator,
    getLegacyLifelinePackManifest: (placeId) => readLegacyLifelinePackManifestV1(localStorage, placeId),
    subscribeSavedPlaces: (callback) => subscribeSavedPlaces(() => callback()),
    subscribeRoutes: subscribeEvacRoutes,
    subscribeComms: (callback) => subscribeCommsPlans(() => callback()),
    subscribeLifelines,
  });
}

let singleton: ReturnType<typeof createEmergencyPackRuntime> | null | undefined;

function getSingleton(): ReturnType<typeof createEmergencyPackRuntime> | null {
  if (singleton !== undefined) return singleton;
  try {
    singleton = createDefaultRuntime();
  } catch {
    singleton = null;
  }
  return singleton;
}

export function hydrateEmergencyPacks(): Promise<void> {
  return getSingleton()?.hydrate() ?? Promise.resolve();
}

export function getEmergencyPackState(place: RuntimePlace): EmergencyPackRuntimeState {
  try {
    return getSingleton()?.getState(place) ?? notSaved(buildEmergencyPackProfileFingerprint(place), 'unavailable');
  } catch {
    return notSaved('', 'scope-invalid');
  }
}

export async function captureEmergencyPack(
  place: RuntimePlace,
  contactConsent: boolean,
): Promise<EmergencyPackCaptureResult> {
  const runtime = getSingleton();
  if (!runtime) return { ok: false, failedKind: 'unavailable' };
  const captured = await runtime.captureResult(place, contactConsent);
  return {
    ok: captured.ok,
    ...(captured.packId === undefined ? {} : { packId: captured.packId }),
    ...(captured.failedKind === undefined ? {} : { failedKind: captured.failedKind }),
    ...(captured.reason === undefined ? {} : { reason: captured.reason }),
  };
}

export function subscribeEmergencyPack(listener: () => void): () => void {
  return getSingleton()?.subscribe(() => listener()) ?? (() => undefined);
}
