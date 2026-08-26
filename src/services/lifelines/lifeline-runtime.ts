import {
  LOCAL_LOGISTICS_CATEGORIES,
  buildLifelinePrewarmFingerprint,
  buildLocalLogisticsFingerprint,
  deserializeLocalLogisticsSnapshot,
  getLocalLogisticsOfflineCacheServiceId,
  validateLocalLogisticsSnapshotEvent,
  type LocalLogisticsRadiusChoiceKm,
} from '../local-logistics';
import type { LocalLogisticsSnapshot } from '../local-logistics-types';
import { readOfflineCacheEntry } from '../offline-alert-cache';
import type { SavedPlace } from '../saved-places';
import { deriveLifelineChanges, type LifelineChange } from './lifeline-changes';
import { deriveLifelineSituation } from './lifeline-domain';
import type { LifelineSituation } from './lifeline-types';
import {
  applyOdinOutageUpdate,
  deriveOdinOutageState,
  emptyOdinOutageHistory,
  type OdinOutageHistory,
  type OdinOutageState,
} from './odin-outage-history';
import {
  buildLifelineOfflinePackManifest,
  deriveLifelineOfflinePackReadiness,
  type LifelineOfflinePackManifest,
  type LifelineOfflinePackReadiness,
} from './offline-pack';

const PACK_PREFIX = 'wm_lifeline_pack_manifest_v1';
const CHANGE_PREFIX = 'wm_lifeline_change_shadow_v1';
const OUTAGE_PREFIX = 'wm_lifeline_odin_history_v1';
const PACK_TTL_MS = 24 * 60 * 60_000;
const MAX_CHANGE_LOG = 100;
const DEFAULT_RADIUS_KM = 25;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface LifelineRuntimeUpdate {
  situation: LifelineSituation;
  changes: LifelineChange[];
  pack: LifelineOfflinePackReadiness;
  outage: OdinOutageState | null;
}

export interface VerifiedLifelinesReceipt {
  placeId: string;
  capturedAt: Date;
  expiresAt: Date | null;
  isExpired: boolean;
}

interface CurrentSituation {
  snapshotAt: number;
  situation: LifelineSituation;
}

type LifelineSavedPlace = Pick<SavedPlace, 'id' | 'lat' | 'lon' | 'radiusKm'>;

interface StoredPackV1 {
  schemaVersion: 1;
  placeId: string;
  queryFingerprint: string;
  requiredKinds: string[];
  artifacts: {
    kind: string;
    queryFingerprint: string;
    cachedAt: string;
    expiresAt: string | null;
  }[];
  createdAt: string;
  updatedAt: string;
}

interface StoredOdinHistoryV1 {
  schemaVersion: 1;
  countyFips: string;
  samples: {
    countyFips: string;
    customersOut: number;
    customersRestored?: number;
    observedAt: string;
    expiresAt: string;
  }[];
  watermarkAt: string | null;
  latestOutcome: OdinOutageHistory['latestOutcome'];
  trendBaselineAt: string | null;
  rejectedOutOfOrder: number;
  rejectedInvalid: number;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function packKey(placeId: string): string {
  return `${PACK_PREFIX}:${placeId}`;
}

function changeKey(placeId: string, queryFingerprint: string): string {
  return `${CHANGE_PREFIX}:${placeId}:${queryFingerprint}`;
}

function outageKey(placeId: string, countyFips: string): string {
  return `${OUTAGE_PREFIX}:${placeId}:${countyFips}`;
}

function exactFingerprint(place: Pick<SavedPlace, 'lat' | 'lon' | 'radiusKm'>): string {
  return buildLocalLogisticsFingerprint(
    place,
    Math.max(1, Math.min(place.radiusKm, DEFAULT_RADIUS_KM)),
    [...LOCAL_LOGISTICS_CATEGORIES],
  );
}

function safeWrite(storage: StorageLike | null, key: string, value: unknown): boolean {
  if (!storage) return false;
  try {
    const serialized = JSON.stringify(value);
    storage.setItem(key, serialized);
    return storage.getItem(key) === serialized;
  } catch {
    return false;
  }
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function validChangeValue(candidate: unknown): boolean {
  return candidate === null
    || (typeof candidate === 'number' && Number.isFinite(candidate))
    || (typeof candidate === 'string' && candidate.length <= 120);
}

function readPack(storage: StorageLike | null, placeId: string): LifelineOfflinePackManifest | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(packKey(placeId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPackV1;
    if (parsed.schemaVersion !== 1 || parsed.placeId !== placeId) return null;
    const createdAt = parseDate(parsed.createdAt);
    const updatedAt = parseDate(parsed.updatedAt);
    if (!createdAt || !updatedAt || !Array.isArray(parsed.requiredKinds) || !Array.isArray(parsed.artifacts)) return null;
    const allowedKinds = new Set(['lifelines', 'alerts', 'route-primary', 'route-alternate', 'offline-map', 'contacts', 'comms-plan']);
    if (!parsed.requiredKinds.every((kind) => allowedKinds.has(kind))) return null;
    const artifacts = parsed.artifacts.map((artifact) => ({
      kind: artifact.kind,
      queryFingerprint: artifact.queryFingerprint,
      cachedAt: parseDate(artifact.cachedAt),
      expiresAt: artifact.expiresAt === null ? null : parseDate(artifact.expiresAt),
    }));
    if (artifacts.some((artifact) => !allowedKinds.has(artifact.kind)
      || !artifact.cachedAt || (artifact.expiresAt !== null && !artifact.expiresAt))) return null;
    return buildLifelineOfflinePackManifest({
      placeId,
      queryFingerprint: parsed.queryFingerprint,
      requiredKinds: parsed.requiredKinds as LifelineOfflinePackManifest['requiredKinds'],
      artifacts: artifacts as LifelineOfflinePackManifest['artifacts'],
      createdAt,
      updatedAt,
    });
  } catch {
    return null;
  }
}

interface ExactLifelinesArtifactExpectation {
  placeId: string;
  queryFingerprint: string;
  lat?: number;
  lon?: number;
  fetchedAt?: number;
}

/** Reparse the actual exact offline artifact; a manifest alone is never evidence. */
function readExactLifelinesArtifact(
  storage: StorageLike | null,
  expected: ExactLifelinesArtifactExpectation,
  now: number,
): LocalLogisticsSnapshot | null {
  if (!storage) return null;
  const entry = readOfflineCacheEntry<unknown>(
    getLocalLogisticsOfflineCacheServiceId(expected.placeId, expected.queryFingerprint),
    storage,
  );
  if (!entry) return null;
  const identity = expected.lat !== undefined && expected.lon !== undefined
    ? {
      placeId: expected.placeId,
      queryFingerprint: expected.queryFingerprint,
      lat: expected.lat,
      lon: expected.lon,
    }
    : undefined;
  const parsed = deserializeLocalLogisticsSnapshot(entry.data, now, identity);
  if (parsed?.placeId !== expected.placeId
    || parsed.queryFingerprint !== expected.queryFingerprint
    || (expected.fetchedAt !== undefined && parsed.fetchedAt.getTime() !== expected.fetchedAt)) return null;
  return parsed;
}

function verifiedPackManifest(
  storage: StorageLike | null,
  manifest: LifelineOfflinePackManifest | null,
  expected: ExactLifelinesArtifactExpectation,
  now: number,
): LifelineOfflinePackManifest | null {
  if (!manifest) return null;
  const lifelines = manifest.artifacts.find((artifact) => (
    artifact.kind === 'lifelines' && artifact.queryFingerprint === expected.queryFingerprint
  ));
  if (!lifelines) return manifest;
  const persisted = readExactLifelinesArtifact(storage, expected, now);
  if (persisted?.fetchedAt.getTime() === lifelines.cachedAt.getTime()) return manifest;
  return {
    ...manifest,
    artifacts: manifest.artifacts.filter((artifact) => artifact !== lifelines),
  };
}

function serializePack(manifest: LifelineOfflinePackManifest): StoredPackV1 {
  return {
    schemaVersion: 1,
    placeId: manifest.placeId,
    queryFingerprint: manifest.queryFingerprint,
    requiredKinds: [...manifest.requiredKinds],
    artifacts: manifest.artifacts.map((artifact) => ({
      kind: artifact.kind,
      queryFingerprint: artifact.queryFingerprint,
      cachedAt: artifact.cachedAt.toISOString(),
      expiresAt: artifact.expiresAt?.toISOString() ?? null,
    })),
    createdAt: manifest.createdAt.toISOString(),
    updatedAt: manifest.updatedAt.toISOString(),
  };
}

function parseChangeLog(
  storage: StorageLike | null,
  placeId: string,
  queryFingerprint: string,
): LifelineChange[] {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(changeKey(placeId, queryFingerprint)) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    const kinds = new Set([
      'site-status-reported', 'site-status-changed', 'site-evidence-became-unknown',
      'site-coverage-lost', 'area-outage-reported', 'area-outage-changed', 'area-coverage-lost',
    ]);
    const attributes = new Set([
      'identity', 'operational', 'inventory', 'power', 'access', 'evacuation-capacity',
      'post-impact-capacity', 'reported-population', 'county-customers-out', 'county-customers-restored',
    ]);
    return parsed.slice(-MAX_CHANGE_LOG).flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const item = value as Record<string, unknown>;
      const observedAt = parseDate(item.observedAt);
      if (!observedAt || item.shadowOnly !== true || typeof item.id !== 'string' || item.id.length > 500
        || typeof item.kind !== 'string' || !kinds.has(item.kind)
        || (item.scope !== 'site' && item.scope !== 'area')
        || typeof item.subjectId !== 'string' || item.subjectId.length > 240
        || typeof item.attribute !== 'string' || !attributes.has(item.attribute)
        || !validChangeValue(item.from) || !validChangeValue(item.to)
        || !Array.isArray(item.evidenceIds) || item.evidenceIds.length > 20
        || !item.evidenceIds.every((id) => typeof id === 'string' && id.length <= 500)) return [];
      return [{ ...item, observedAt } as unknown as LifelineChange];
    });
  } catch {
    return [];
  }
}

function serializeOdinHistory(history: OdinOutageHistory): StoredOdinHistoryV1 {
  return {
    schemaVersion: 1,
    countyFips: history.countyFips,
    samples: history.samples.map((sample) => ({
      ...sample,
      observedAt: sample.observedAt.toISOString(),
      expiresAt: sample.expiresAt.toISOString(),
    })),
    watermarkAt: history.watermarkAt?.toISOString() ?? null,
    latestOutcome: history.latestOutcome,
    trendBaselineAt: history.trendBaselineAt?.toISOString() ?? null,
    rejectedOutOfOrder: history.rejectedOutOfOrder,
    rejectedInvalid: history.rejectedInvalid,
  };
}

function readOdinHistory(storage: StorageLike | null, placeId: string, countyFips: string): OdinOutageHistory {
  const empty = emptyOdinOutageHistory(countyFips);
  if (!storage) return empty;
  try {
    const parsed = JSON.parse(storage.getItem(outageKey(placeId, countyFips)) ?? 'null') as StoredOdinHistoryV1 | null;
    if (parsed?.schemaVersion !== 1 || parsed.countyFips !== countyFips
      || !Array.isArray(parsed.samples) || parsed.samples.length > 288) return empty;
    const outcomes = new Set<OdinOutageHistory['latestOutcome']>(['none', 'reported', 'empty-unknown', 'unavailable-unknown']);
    if (!outcomes.has(parsed.latestOutcome)) return empty;
    const samples = parsed.samples.map((sample) => ({
      countyFips: sample.countyFips,
      customersOut: sample.customersOut,
      ...(sample.customersRestored === undefined ? {} : { customersRestored: sample.customersRestored }),
      observedAt: parseDate(sample.observedAt),
      expiresAt: parseDate(sample.expiresAt),
    }));
    if (samples.some((sample) => sample.countyFips !== countyFips || !Number.isInteger(sample.customersOut)
      || sample.customersOut < 0
      || (sample.customersRestored !== undefined
        && (!Number.isInteger(sample.customersRestored) || sample.customersRestored < 0))
      || !sample.observedAt || !sample.expiresAt)) return empty;
    const watermarkAt = parsed.watermarkAt === null ? null : parseDate(parsed.watermarkAt);
    const trendBaselineAt = parsed.trendBaselineAt === null ? null : parseDate(parsed.trendBaselineAt);
    if ((parsed.watermarkAt !== null && !watermarkAt) || (parsed.trendBaselineAt !== null && !trendBaselineAt)) return empty;
    return {
      countyFips,
      samples: samples as OdinOutageHistory['samples'],
      watermarkAt,
      latestOutcome: parsed.latestOutcome,
      trendBaselineAt,
      rejectedOutOfOrder: Number.isInteger(parsed.rejectedOutOfOrder) && parsed.rejectedOutOfOrder >= 0
        ? parsed.rejectedOutOfOrder : 0,
      rejectedInvalid: Number.isInteger(parsed.rejectedInvalid) && parsed.rejectedInvalid >= 0
        ? parsed.rejectedInvalid : 0,
    };
  } catch {
    return empty;
  }
}

function updateOdinHistory(
  storage: StorageLike | null,
  snapshot: LocalLogisticsSnapshot,
  now: number,
): OdinOutageState | null {
  if (!snapshot.countyFips) return null;
  let history = readOdinHistory(storage, snapshot.placeId, snapshot.countyFips);
  const provider = snapshot.providers.find((item) => item.id === 'ornl-odin');
  const reported = snapshot.areaConditions.filter((condition) => (
    condition.countyFips === snapshot.countyFips && condition.coverage === 'reported'
  ));
  if (reported.length > 0) {
    const expiry = Math.min(...reported.map((condition) => condition.expiresAt.getTime()));
    const restored = reported.every((condition) => typeof condition.customersRestored === 'number')
      ? reported.reduce((sum, condition) => sum + (condition.customersRestored ?? 0), 0)
      : undefined;
    history = applyOdinOutageUpdate(history, {
      kind: 'reported',
      sample: {
        countyFips: snapshot.countyFips,
        customersOut: reported.reduce((sum, condition) => sum + condition.customersOut, 0),
        ...(restored === undefined ? {} : { customersRestored: restored }),
        observedAt: snapshot.fetchedAt,
        expiresAt: new Date(expiry),
      },
    }).history;
  } else {
    const kind = provider?.state === 'empty' || (provider?.acceptedRows === 0 && provider.state !== 'error')
      ? 'empty'
      : 'unavailable';
    history = applyOdinOutageUpdate(history, {
      kind, countyFips: snapshot.countyFips, observedAt: snapshot.fetchedAt,
    }).history;
  }
  safeWrite(storage, outageKey(snapshot.placeId, snapshot.countyFips), serializeOdinHistory(history));
  return deriveOdinOutageState(history, now);
}

export function createLifelineRuntime(
  storage: StorageLike | null = defaultStorage(),
  clock: () => number = Date.now,
) {
  const current = new Map<string, CurrentSituation>();
  const updates = new Map<string, LifelineRuntimeUpdate>();

  function getPackReadiness(place: LifelineSavedPlace): LifelineOfflinePackReadiness {
    const fingerprint = exactFingerprint(place);
    const now = clock();
    const manifest = verifiedPackManifest(storage, readPack(storage, place.id), {
      placeId: place.id,
      queryFingerprint: fingerprint,
      lat: place.lat,
      lon: place.lon,
    }, now);
    return deriveLifelineOfflinePackReadiness(fingerprint, manifest, now);
  }

  function getExactPackReadiness(
    place: LifelineSavedPlace,
    radiusKm: LocalLogisticsRadiusChoiceKm,
  ): LifelineOfflinePackReadiness {
    const queryFingerprint = buildLifelinePrewarmFingerprint(place, radiusKm);
    const now = clock();
    const manifest = verifiedPackManifest(storage, readPack(storage, place.id), {
      placeId: place.id,
      queryFingerprint,
      lat: place.lat,
      lon: place.lon,
    }, now);
    return deriveLifelineOfflinePackReadiness(queryFingerprint, manifest, now);
  }

  function verifyExactSnapshot(
    place: LifelineSavedPlace,
    radiusKm: LocalLogisticsRadiusChoiceKm,
    snapshot: LocalLogisticsSnapshot,
  ): { status: 'ready' | 'partial'; exact: true } | null {
    const queryFingerprint = buildLifelinePrewarmFingerprint(place, radiusKm);
    if (snapshot.source !== 'network'
      || snapshot.isExpired
      || snapshot.placeId !== place.id
      || snapshot.queryFingerprint !== queryFingerprint
      || snapshot.effectiveRadiusKm !== radiusKm) return null;
    const now = clock();
    const exactArtifact = readExactLifelinesArtifact(storage, {
      placeId: place.id,
      queryFingerprint,
      lat: place.lat,
      lon: place.lon,
      fetchedAt: snapshot.fetchedAt.getTime(),
    }, now);
    if (!exactArtifact) return null;
    const readiness = getExactPackReadiness(place, radiusKm);
    return readiness.status === 'ready' || readiness.status === 'partial'
      ? { status: readiness.status, exact: true }
      : null;
  }

  function getVerifiedLifelinesReceipt(place: LifelineSavedPlace): VerifiedLifelinesReceipt | null {
    const queryFingerprint = exactFingerprint(place);
    const now = clock();
    const manifest = verifiedPackManifest(storage, readPack(storage, place.id), {
      placeId: place.id,
      queryFingerprint,
      lat: place.lat,
      lon: place.lon,
    }, now);
    if (manifest?.queryFingerprint !== queryFingerprint) return null;
    const artifact = manifest.artifacts.find((candidate) => (
      candidate.kind === 'lifelines' && candidate.queryFingerprint === queryFingerprint
    ));
    if (!artifact) return null;
    const expiresAt = artifact.expiresAt ? new Date(artifact.expiresAt) : null;
    return {
      placeId: place.id,
      capturedAt: new Date(artifact.cachedAt),
      expiresAt,
      isExpired: expiresAt !== null && expiresAt.getTime() <= now,
    };
  }

  function processSnapshot(snapshot: LocalLogisticsSnapshot): LifelineRuntimeUpdate | null {
    const snapshotAt = snapshot.fetchedAt.getTime();
    if (!Number.isFinite(snapshotAt)) return null;
    const runtimeKey = `${snapshot.placeId}|${snapshot.queryFingerprint}`;
    const previous = current.get(runtimeKey);
    if (previous && snapshotAt <= previous.snapshotAt) return updates.get(runtimeKey) ?? null;

    // Evaluate evidence expiry against the real clock, but use the accepted
    // snapshot retrieval watermark for ordering. Re-renders must not invent a
    // newer baseline merely because presentation happened later.
    const situation = {
      ...deriveLifelineSituation(snapshot, clock()),
      derivedAt: new Date(snapshotAt),
    };
    const changes = deriveLifelineChanges(previous?.situation ?? null, situation);
    current.set(runtimeKey, { snapshotAt, situation });

    if (changes.length > 0) {
      const retained = [
        ...parseChangeLog(storage, snapshot.placeId, snapshot.queryFingerprint),
        ...changes,
      ]
        .sort((left, right) => left.observedAt.getTime() - right.observedAt.getTime())
        .slice(-MAX_CHANGE_LOG);
      safeWrite(storage, changeKey(snapshot.placeId, snapshot.queryFingerprint), retained);
    }

    const exactArtifact = snapshot.source === 'network' && !snapshot.isExpired
      ? readExactLifelinesArtifact(storage, {
        placeId: snapshot.placeId,
        queryFingerprint: snapshot.queryFingerprint,
        fetchedAt: snapshotAt,
      }, clock())
      : null;
    if (exactArtifact) {
      const existing = readPack(storage, snapshot.placeId);
      const manifest = buildLifelineOfflinePackManifest({
        placeId: snapshot.placeId,
        queryFingerprint: snapshot.queryFingerprint,
        requiredKinds: ['lifelines'],
        artifacts: [{
          kind: 'lifelines',
          queryFingerprint: snapshot.queryFingerprint,
          cachedAt: snapshot.fetchedAt,
          expiresAt: new Date(snapshotAt + PACK_TTL_MS),
        }],
        createdAt: existing?.queryFingerprint === snapshot.queryFingerprint ? existing.createdAt : snapshot.fetchedAt,
        updatedAt: snapshot.fetchedAt,
      });
      safeWrite(storage, packKey(snapshot.placeId), serializePack(manifest));
    }

    const outage = updateOdinHistory(storage, snapshot, clock());

    const packNow = clock();
    const pack = deriveLifelineOfflinePackReadiness(snapshot.queryFingerprint, verifiedPackManifest(
      storage,
      readPack(storage, snapshot.placeId),
      { placeId: snapshot.placeId, queryFingerprint: snapshot.queryFingerprint },
      packNow,
    ), packNow);
    const update = { situation, changes, pack, outage };
    updates.set(runtimeKey, update);
    return update;
  }

  return {
    processSnapshot,
    getPackReadiness,
    getExactPackReadiness,
    verifyExactSnapshot,
    getVerifiedLifelinesReceipt,
    getRecentChanges(placeId: string, queryFingerprint: string): LifelineChange[] {
      return parseChangeLog(storage, placeId, queryFingerprint)
        .sort((left, right) => right.observedAt.getTime() - left.observedAt.getTime());
    },
    getLatestUpdate(placeId: string, queryFingerprint: string): LifelineRuntimeUpdate | null {
      const update = updates.get(`${placeId}|${queryFingerprint}`);
      if (!update) return null;
      const now = clock();
      const pack = deriveLifelineOfflinePackReadiness(queryFingerprint, verifiedPackManifest(
        storage,
        readPack(storage, placeId),
        { placeId, queryFingerprint },
        now,
      ), now);
      return { ...update, pack };
    },
  };
}

export const lifelineRuntime = createLifelineRuntime();

export function getLifelinePackReadinessForPlace(
  place: LifelineSavedPlace,
): LifelineOfflinePackReadiness {
  return lifelineRuntime.getPackReadiness(place);
}

export function getExactLifelinePackReadinessForPlace(
  place: LifelineSavedPlace,
  radiusKm: LocalLogisticsRadiusChoiceKm,
): LifelineOfflinePackReadiness {
  return lifelineRuntime.getExactPackReadiness(place, radiusKm);
}

export function verifyExactLifelinesSnapshot(
  place: LifelineSavedPlace,
  radiusKm: LocalLogisticsRadiusChoiceKm,
  snapshot: LocalLogisticsSnapshot,
): { status: 'ready' | 'partial'; exact: true } | null {
  return lifelineRuntime.verifyExactSnapshot(place, radiusKm, snapshot);
}

export function getVerifiedLifelinesReceiptForPlace(
  place: LifelineSavedPlace,
): VerifiedLifelinesReceipt | null {
  return lifelineRuntime.getVerifiedLifelinesReceipt(place);
}

export function getRecentLifelineChangesForPlace(
  place: LifelineSavedPlace,
): LifelineChange[] {
  return lifelineRuntime.getRecentChanges(place.id, exactFingerprint(place));
}

let runtimeListener: ((event: Event) => void) | null = null;

/** Install the renderer-only derivation bridge once. It never dispatches notifications. */
export function startLifelineRuntime(): () => void {
  if (runtimeListener || typeof document === 'undefined') return () => undefined;
  runtimeListener = (event: Event) => {
    const snapshot = validateLocalLogisticsSnapshotEvent(
      (event as CustomEvent<unknown>).detail,
      Date.now(),
    );
    if (!snapshot) return;
    const update = lifelineRuntime.processSnapshot(snapshot);
    if (!update) return;
    document.dispatchEvent(new CustomEvent('wm:lifeline-situation-updated', {
      detail: { placeId: snapshot.placeId, queryFingerprint: snapshot.queryFingerprint, update },
    }));
  };
  document.addEventListener('wm:local-logistics-updated', runtimeListener);
  return () => {
    if (runtimeListener) document.removeEventListener('wm:local-logistics-updated', runtimeListener);
    runtimeListener = null;
  };
}
