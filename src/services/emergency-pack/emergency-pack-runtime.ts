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
  deleteOfflineMapGenerationExact,
  EXACT_OFFLINE_MAP_MAX_TILE_BYTES,
  EXACT_OFFLINE_MAP_MAX_TILES,
  EXACT_OFFLINE_MAP_MAX_TOTAL_BYTES,
  planOfflineMapTileUrls,
  readOfflineMapTileExact,
  verifyOfflineMapGenerationExact,
  type ExactOfflineMapCache,
  type ExactOfflineMapCaptureResult,
  type ExactOfflineMapTile,
} from '@/services/offline-map-cache';
import { getSavedPlaces, subscribeSavedPlaces, type SavedPlace } from '@/services/saved-places';
import { getStormSnapshot, subscribeStormPosture } from '@/services/survival/storm-posture-state';
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
  type EmergencyPackArtifactKind,
  type EmergencyPackReceipt,
  type EmergencyPackStatus,
} from './emergency-pack-schema';
import {
  buildEmergencyPackProfileFingerprint,
  createEmergencyPackSources,
  type EmergencyPackArtifactSource,
} from './emergency-pack-sources';
import { createEmergencyPackStore } from './emergency-pack-store';
import {
  emergencyPackMapSourceUrls,
  type EmergencyPackMapTileData,
} from './emergency-pack-map-protocol';

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
  readVerifiedOfflineMapArtifact?(scope: EmergencyPackCaptureScope & { now: number }): Promise<string | null>;
  recoverActive(scope: EmergencyPackCaptureScope & { now: number }): Promise<{
    status: string;
    packId: string | null;
    profileFingerprint?: string;
    reason?: string;
  }>;
  recoverReadiness?(scope: EmergencyPackCaptureScope & { now: number }): Promise<{
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
  invalidateArtifacts(input: {
    placeId: string;
    profileFingerprint: string;
    kinds: readonly EmergencyPackArtifactKind[];
    capturedAt: number;
  }): Promise<{ ok: boolean; reason?: string }>;
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
    releaseArtifact?: (artifact: EmergencyPackCapturedArtifact) => Promise<void>;
  }): { capture(scope: EmergencyPackCaptureScope): Promise<EmergencyPackCaptureResult> };
  releaseArtifact: (artifact: EmergencyPackCapturedArtifact) => Promise<void>;
  getLegacyLifelinePackManifest(placeId: string): unknown;
  subscribeSavedPlaces(callback: () => void): () => void;
  subscribeRoutes(callback: () => void): () => void;
  subscribeComms(callback: () => void): () => void;
  subscribeLifelines(callback: () => void): () => void;
  subscribeAlerts(callback: () => void): () => void;
  openOfflineMapCache?(name: string): Promise<ExactOfflineMapCache>;
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
): unknown {
  try {
    const encoded = storage.getItem(`wm_lifeline_pack_manifest_v1:${placeId}`);
    if (encoded === null) return null;
    return strictJsonRecord(JSON.parse(encoded));
  } catch {
    return null;
  }
}

const OFFLINE_MAP_BODY_KEYS = [
  'kind',
  'placeId',
  'profileFingerprint',
  'generationId',
  'tiles',
  'totalBytes',
] as const;
const OFFLINE_MAP_TILE_KEYS = [
  'url',
  'cacheKey',
  'sha256',
  'generationId',
  'byteLength',
  'verified',
] as const;
const OFFLINE_MAP_GENERATION_ID_MAX_LENGTH = 180;

interface OfflineMapGenerationEvidence {
  generationId: string;
  tiles: ExactOfflineMapTile[];
}

interface EmergencyPackOfflineMapOperations {
  verify(input: {
    generationId: string;
    tiles: ExactOfflineMapTile[];
    cache: ExactOfflineMapCache;
  }): Promise<{ ok: boolean }>;
  release(input: {
    generationId: string;
    tiles: ExactOfflineMapTile[];
    cache: ExactOfflineMapCache;
  }): Promise<{ ok: boolean }>;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function parseOfflineMapGenerationEvidence(body: string): OfflineMapGenerationEvidence | null {
  if (typeof body !== 'string' || body.length === 0 || body.length > EXACT_OFFLINE_MAP_MAX_TOTAL_BYTES) return null;
  let payload: Record<string, unknown> | null;
  try {
    payload = strictJsonRecord(JSON.parse(body));
  } catch {
    return null;
  }
  if (!payload
    || !hasExactKeys(payload, OFFLINE_MAP_BODY_KEYS)
    || payload.kind !== 'offline-map'
    || !isBoundedText(payload.placeId, 180)
    || !isBoundedText(payload.profileFingerprint, 800)
    || !isBoundedText(payload.generationId, OFFLINE_MAP_GENERATION_ID_MAX_LENGTH)
    || !Array.isArray(payload.tiles)
    || payload.tiles.length === 0
    || payload.tiles.length > EXACT_OFFLINE_MAP_MAX_TILES
    || !Number.isSafeInteger(payload.totalBytes)
    || (payload.totalBytes as number) <= 0
    || (payload.totalBytes as number) > EXACT_OFFLINE_MAP_MAX_TOTAL_BYTES) return null;

  const generationId = payload.generationId;
  const urls = new Set<string>();
  const cacheKeys = new Set<string>();
  const tiles: ExactOfflineMapTile[] = [];
  let totalBytes = 0;
  for (const candidate of payload.tiles) {
    const tile = strictJsonRecord(candidate);
    if (!tile
      || !hasExactKeys(tile, OFFLINE_MAP_TILE_KEYS)
      || !isBoundedText(tile.url, 2048)
      || !isHttpsUrl(tile.url)
      || !isBoundedText(tile.cacheKey, 4096)
      || !isBoundedText(tile.sha256, 64)
      || !/^[a-f0-9]{64}$/.test(tile.sha256)
      || tile.generationId !== generationId
      || !Number.isSafeInteger(tile.byteLength)
      || (tile.byteLength as number) <= 0
      || (tile.byteLength as number) > EXACT_OFFLINE_MAP_MAX_TILE_BYTES
      || tile.verified !== true
      || urls.has(tile.url)
      || cacheKeys.has(tile.cacheKey)) return null;
    urls.add(tile.url);
    cacheKeys.add(tile.cacheKey);
    totalBytes += tile.byteLength as number;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > EXACT_OFFLINE_MAP_MAX_TOTAL_BYTES) return null;
    tiles.push({
      url: tile.url,
      cacheKey: tile.cacheKey,
      sha256: tile.sha256,
      generationId,
      byteLength: tile.byteLength as number,
      verified: true,
    });
  }
  return totalBytes === payload.totalBytes ? { generationId, tiles } : null;
}

const DEFAULT_OFFLINE_MAP_OPERATIONS: EmergencyPackOfflineMapOperations = {
  verify: verifyOfflineMapGenerationExact,
  release: deleteOfflineMapGenerationExact,
};

export function createEmergencyPackOfflineMapLifecycle(
  cacheStorage: { open(name: string): Promise<ExactOfflineMapCache> },
  operations: EmergencyPackOfflineMapOperations = DEFAULT_OFFLINE_MAP_OPERATIONS,
): {
  verifyArtifactBody: (kind: EmergencyPackArtifactKind, body: string) => Promise<boolean>;
  releaseArtifactBody: (kind: EmergencyPackArtifactKind, body: string) => Promise<void>;
  releaseArtifact: (artifact: EmergencyPackCapturedArtifact) => Promise<void>;
} {
  const verifyArtifactBody = async (kind: EmergencyPackArtifactKind, body: string): Promise<boolean> => {
    if (kind !== 'offline-map') return true;
    const evidence = parseOfflineMapGenerationEvidence(body);
    if (!evidence) return false;
    try {
      const cache = await cacheStorage.open(MAP_CACHE_NAME);
      const result = await operations.verify({ ...evidence, cache });
      return result.ok;
    } catch {
      return false;
    }
  };
  const releaseArtifactBody = async (kind: EmergencyPackArtifactKind, body: string): Promise<void> => {
    if (kind !== 'offline-map') return;
    const evidence = parseOfflineMapGenerationEvidence(body);
    if (!evidence) throw new Error('invalid offline map artifact evidence');
    try {
      const cache = await cacheStorage.open(MAP_CACHE_NAME);
      const released = await operations.release({ ...evidence, cache });
      if (!released.ok) throw new Error('offline map generation release failed');
    } catch {
      throw new Error('offline map generation release failed');
    }
  };
  return {
    verifyArtifactBody,
    releaseArtifactBody,
    async releaseArtifact(artifact): Promise<void> {
      if (artifact.kind !== 'offline-map') return;
      await releaseArtifactBody('offline-map', artifact.body);
    },
  };
}

interface EmergencyPackOfflineMapScope {
  placeId: string;
  profileFingerprint: string;
  now: number;
}

interface EmergencyPackOfflineMapTileResolverDependencies {
  getScopes(): EmergencyPackOfflineMapScope[];
  readVerifiedOfflineMapArtifact(scope: {
    placeId: string;
    profileFingerprint: string;
    now: number;
  }): Promise<string | null>;
  openCache(name: string): Promise<ExactOfflineMapCache>;
}

async function readScopedOfflineMapEvidence(
  dependencies: EmergencyPackOfflineMapTileResolverDependencies,
  scope: EmergencyPackOfflineMapScope,
): Promise<ReturnType<typeof parseOfflineMapGenerationEvidence>> {
  try {
    const body = await dependencies.readVerifiedOfflineMapArtifact(scope);
    if (body === null) return null;
    const evidence = parseOfflineMapGenerationEvidence(body);
    const parsed = strictJsonRecord(JSON.parse(body));
    return evidence
      && parsed?.placeId === scope.placeId
      && parsed.profileFingerprint === scope.profileFingerprint
      ? evidence
      : null;
  } catch {
    return null;
  }
}

export function createEmergencyPackOfflineMapTileResolver(
  dependencies: EmergencyPackOfflineMapTileResolverDependencies,
) {
  return async (requestUrl: string): Promise<EmergencyPackMapTileData | null> => {
    const sourceUrls = emergencyPackMapSourceUrls(requestUrl);
    if (sourceUrls.length === 0) return null;
    let cache: ExactOfflineMapCache | null = null;
    for (const scope of dependencies.getScopes().slice(0, MAX_PLACES)) {
      const evidence = await readScopedOfflineMapEvidence(dependencies, scope);
      if (!evidence) continue;
      try {
        cache ??= await dependencies.openCache(MAP_CACHE_NAME);
        const tile = await readOfflineMapTileExact({ ...evidence, sourceUrls, cache });
        if (tile) return tile;
      } catch {
        return null;
      }
    }
    return null;
  };
}

export function createEmergencyPackRuntime(dependencies: EmergencyPackRuntimeDependencies) {
  const adapters = dependencies.createBrowserAdapters();
  const store = dependencies.createStore(adapters);
  const listeners = new Set<(state: EmergencyPackRuntimeState) => void>();
  const states = new Map<string, EmergencyPackRuntimeState>();
  const placeGenerations = new Map<string, number>();
  const captureContexts = new Map<string, { place: RuntimePlace; contactConsent: boolean }>();
  const captureResults = new Map<string, EmergencyPackCaptureResult>();
  const detailedOperationStates = new Map<string, EmergencyPackRuntimeState>();
  const operationQueues = new Map<string, Promise<void>>();
  let active = true;

  const resolveOfflineMapTile = createEmergencyPackOfflineMapTileResolver({
    getScopes: () => retainedPlaces().flatMap((place) => {
      const scope = scopeFor(place);
      return scope ? [{
        placeId: scope.placeId,
        profileFingerprint: scope.profileFingerprint,
        now: dependencies.now(),
      }] : [];
    }),
    readVerifiedOfflineMapArtifact: (scope) => store.readVerifiedOfflineMapArtifact?.({
      ...scope,
      contactConsent: false,
    }) ?? Promise.resolve(null),
    openCache: (name) => dependencies.openOfflineMapCache?.(name) ?? Promise.reject(new Error('cache unavailable')),
  });

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
    readActive: async (scope) => {
      const detailed = await readDetailed({ ...scope, contactConsent: false });
      detailedOperationStates.set(scope.placeId, detailed);
      return coordinatorState(detailed);
    },
    recoverActive: async (scope) => {
      try {
        const operation = store.recoverReadiness?.bind(store);
        if (operation) {
          const recovered = await operation({ ...scope, contactConsent: false, now: dependencies.now() });
          const scoped = { ...recovered, profileFingerprint: recovered.profileFingerprint ?? scope.profileFingerprint };
          const detailed = validState(scoped, scope.profileFingerprint)
            ? scoped
            : notSaved(scope.profileFingerprint, 'invalid-state');
          detailedOperationStates.set(scope.placeId, detailed);
          return coordinatorState(detailed);
        }
        await store.recoverActive({ ...scope, contactConsent: false, now: dependencies.now() });
      } catch {
        return coordinatorState(notSaved(scope.profileFingerprint, 'storage-failure'));
      }
      const detailed = await readDetailed({ ...scope, contactConsent: false });
      detailedOperationStates.set(scope.placeId, detailed);
      return coordinatorState(detailed);
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
        releaseArtifact: dependencies.releaseArtifact,
      });
      captureResults.set(scope.placeId, await orchestrator.capture({
        ...scope,
        contactConsent: context.contactConsent,
      }));
      const detailed = await readDetailed({ ...scope, contactConsent: context.contactConsent });
      detailedOperationStates.set(scope.placeId, detailed);
      return coordinatorState(detailed);
    },
  });

  function takeDetailedState(scope: EmergencyPackCaptureScope): EmergencyPackRuntimeState | null {
    const detailed = detailedOperationStates.get(scope.placeId);
    detailedOperationStates.delete(scope.placeId);
    return detailed?.profileFingerprint === scope.profileFingerprint ? detailed : null;
  }

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
    const recovered = takeDetailedState(scope) ?? await readDetailed(scope);
    if (recovered.status !== 'not-saved' || !store.migrateLifelineGeneration) return recovered;

    const legacyManifest = strictJsonRecord(dependencies.getLegacyLifelinePackManifest(place.id));
    const legacyQueryFingerprint = legacyManifest?.queryFingerprint;
    if (typeof legacyQueryFingerprint !== 'string' || legacyQueryFingerprint.length === 0) return recovered;

    const lifelines = dependencies.createSources(place).lifelines;
    if (!lifelines) return recovered;
    const artifact = await lifelines(scope);
    if (artifact?.kind !== 'lifelines') return recovered;

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
          state = takeDetailedState(scope) ?? await readDetailed(scope);
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

  async function invalidateKinds(
    kinds: readonly EmergencyPackArtifactKind[],
    affectedPlaceIds?: ReadonlySet<string>,
  ): Promise<void> {
    const places = retainedPlaces().filter((place) => !affectedPlaceIds || affectedPlaceIds.has(place.id));
    await Promise.all(places.map((place) => enqueuePlaceOperation(place.id, async () => {
      const scope = scopeFor(place);
      if (!scope) return;
      const generation = begin(place.id);
      let state: EmergencyPackRuntimeState;
      try {
        const invalidated = await store.invalidateArtifacts({
          placeId: scope.placeId,
          profileFingerprint: scope.profileFingerprint,
          kinds,
          capturedAt: dependencies.now(),
        });
        if (invalidated.ok) {
          await coordinator.refresh(scope);
          state = takeDetailedState(scope) ?? await readDetailed(scope);
        } else {
          state = notSaved(scope.profileFingerprint, invalidated.reason ?? 'storage-failure');
        }
      } catch {
        state = notSaved(scope.profileFingerprint, 'storage-failure');
      }
      publish(place.id, generation, state);
    })));
  }

  let savedPlaceNames = new Map(retainedPlaces().map((place) => [place.id, {
    profileFingerprint: scopeFor(place)?.profileFingerprint ?? '',
    name: place.name,
  }]));
  const savedPlacesChanged = () => {
    const nextPlaces = retainedPlaces();
    const renamedPlaceIds = new Set(nextPlaces.filter((place) => {
      const previous = savedPlaceNames.get(place.id);
      const profileFingerprint = scopeFor(place)?.profileFingerprint ?? '';
      return previous?.profileFingerprint === profileFingerprint && previous.name !== place.name;
    }).map(({ id }) => id));
    savedPlaceNames = new Map(nextPlaces.map((place) => [place.id, {
      profileFingerprint: scopeFor(place)?.profileFingerprint ?? '',
      name: place.name,
    }]));
    if (renamedPlaceIds.size > 0) {
      void invalidateKinds(['route-primary', 'route-alternate'], renamedPlaceIds);
    }
    else void refreshAll(false);
  };
  const unsubscribers = [
    dependencies.subscribeSavedPlaces(savedPlacesChanged),
    dependencies.subscribeRoutes(() => { void invalidateKinds(['route-primary', 'route-alternate']); }),
    dependencies.subscribeComms(() => { void invalidateKinds(['comms-plan', 'contacts']); }),
    dependencies.subscribeLifelines(() => { void invalidateKinds(['lifelines']); }),
    dependencies.subscribeAlerts(() => { void invalidateKinds(['alerts']); }),
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
    const state = takeDetailedState(scope) ?? await readDetailed({ ...scope, contactConsent });
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

    resolveOfflineMapTile,

    destroy(): void {
      if (!active) return;
      active = false;
      for (const unsubscribe of unsubscribers) unsubscribe();
      listeners.clear();
      placeGenerations.clear();
      captureContexts.clear();
      captureResults.clear();
      detailedOperationStates.clear();
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

interface EmergencyPackOfflineMapCaptureDependencies {
  now(): number;
  randomUUID: () => string | undefined;
  planTileUrls(lat: number, lon: number, radiusKm: number): {
    ok: boolean;
    tileUrls: string[];
  };
  openCache(name: string): Promise<ExactOfflineMapCache>;
  fetchTile(url: string, signal: AbortSignal): Promise<Response>;
  captureTiles(input: {
    generationId: string;
    tileUrls: string[];
    cache: ExactOfflineMapCache;
    fetchTile: (url: string) => Promise<Response>;
    concurrency: number;
  }): Promise<ExactOfflineMapCaptureResult>;
}

function createOfflineMapGenerationId(randomUUID: () => string | undefined): string | null {
  try {
    const uniqueId = randomUUID();
    if (!isBoundedText(uniqueId, 160) || !/^[a-zA-Z0-9._-]+$/.test(uniqueId)) return null;
    const generationId = `emergency-pack-${uniqueId}`;
    return generationId.length <= OFFLINE_MAP_GENERATION_ID_MAX_LENGTH ? generationId : null;
  } catch {
    return null;
  }
}

export async function captureEmergencyPackOfflineMap(
  place: RuntimePlace,
  scope: EmergencyPackCaptureScope,
  dependencies: EmergencyPackOfflineMapCaptureDependencies,
): Promise<EmergencyPackCapturedArtifact | null> {
  const generationId = createOfflineMapGenerationId(dependencies.randomUUID);
  if (!generationId) return null;
  let plan: { ok: boolean; tileUrls: string[] };
  try {
    plan = dependencies.planTileUrls(place.lat, place.lon, Math.min(place.radiusKm, 100));
  } catch {
    return null;
  }
  if (!plan.ok) return null;
  let cache: ExactOfflineMapCache;
  try {
    cache = await dependencies.openCache(MAP_CACHE_NAME);
  } catch {
    return null;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAP_CAPTURE_TIMEOUT_MS);
  let captured: ExactOfflineMapCaptureResult;
  try {
    captured = await dependencies.captureTiles({
      generationId,
      tileUrls: plan.tileUrls,
      cache,
      fetchTile: (url) => dependencies.fetchTile(url, controller.signal),
      concurrency: 4,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
  if (!captured.ok) return null;
  let body: string;
  try {
    body = JSON.stringify({
      kind: 'offline-map',
      placeId: scope.placeId,
      profileFingerprint: scope.profileFingerprint,
      generationId,
      tiles: captured.tiles,
      totalBytes: captured.totalBytes,
    });
  } catch {
    return null;
  }
  if (!parseOfflineMapGenerationEvidence(body)) return null;
  let now: number;
  try {
    now = dependencies.now();
  } catch {
    return null;
  }
  if (!Number.isSafeInteger(now) || now <= 0 || now + MAP_EXPIRY_MS > 8_640_000_000_000_000) return null;
  return {
    kind: 'offline-map',
    body,
    expiresAt: now + MAP_EXPIRY_MS,
    semanticState: 'verified',
    summary: `${captured.tiles.length} offline map tiles verified`,
    itemCount: captured.tiles.length,
  };
}

async function captureDefaultOfflineMap(
  place: RuntimePlace,
  scope: EmergencyPackCaptureScope,
): Promise<EmergencyPackCapturedArtifact | null> {
  if (typeof caches === 'undefined' || typeof fetch !== 'function') return null;
  return captureEmergencyPackOfflineMap(place, scope, {
    now: Date.now,
    randomUUID: () => globalThis.crypto?.randomUUID(),
    planTileUrls: planOfflineMapTileUrls,
    openCache: (name) => caches.open(name),
    fetchTile: fetchDefaultMapTile,
    captureTiles: captureOfflineMapTilesExact,
  });
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
  const offlineMapLifecycle = createEmergencyPackOfflineMapLifecycle(caches);
  return createEmergencyPackRuntime({
    now: Date.now,
    buildProfileFingerprint: buildEmergencyPackProfileFingerprint,
    getSavedPlaces,
    createBrowserAdapters: createDefaultBrowserAdapters,
    createStore: (boundaries) => {
      const storeDependencies = {
        ...(boundaries as ReturnType<typeof createDefaultBrowserAdapters>),
        now: Date.now,
        createPackId: () => crypto.randomUUID(),
        verifyArtifactBody: offlineMapLifecycle.verifyArtifactBody,
        releaseArtifactBody: offlineMapLifecycle.releaseArtifactBody,
      };
      return createEmergencyPackStore(storeDependencies);
    },
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
    releaseArtifact: offlineMapLifecycle.releaseArtifact,
    getLegacyLifelinePackManifest: (placeId) => readLegacyLifelinePackManifestV1(localStorage, placeId),
    subscribeSavedPlaces: (callback) => subscribeSavedPlaces(() => callback()),
    subscribeRoutes: subscribeEvacRoutes,
    subscribeComms: (callback) => subscribeCommsPlans(() => callback()),
    subscribeLifelines,
    subscribeAlerts: subscribeStormPosture,
    openOfflineMapCache: (name) => caches.open(name),
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

export function resolveEmergencyPackOfflineMapTile(url: string): Promise<EmergencyPackMapTileData | null> {
  return getSingleton()?.resolveOfflineMapTile(url) ?? Promise.resolve(null);
}
