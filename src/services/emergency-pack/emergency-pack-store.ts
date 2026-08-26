import {
  EMERGENCY_PACK_OPTIONAL_KINDS,
  EMERGENCY_PACK_REQUIRED_KINDS,
  deriveEmergencyPackReadiness,
  migrateLifelinePackV1,
  parseEmergencyPackManifest,
} from './emergency-pack-schema';
import type {
  EmergencyPackArtifactKind,
  EmergencyPackManifest,
  EmergencyPackOptionalKind,
  EmergencyPackReceipt,
  EmergencyPackRequiredKind,
  EmergencyPackSemanticState,
} from './emergency-pack-schema';

const KEY_PREFIX = 'wm-emergency-pack-v2';
const MAX_RECOVERY_MANIFESTS = 3;
const ARTIFACT_BYTE_CAPS: Readonly<Record<EmergencyPackArtifactKind, number>> = {
  lifelines: 1024 * 1024,
  alerts: 256 * 1024,
  'route-primary': 512 * 1024,
  'route-alternate': 512 * 1024,
  'offline-map': 50 * 1024 * 1024,
  'comms-plan': 128 * 1024,
  contacts: 128 * 1024,
};
const ARTIFACT_KINDS = new Set<EmergencyPackArtifactKind>([
  ...EMERGENCY_PACK_REQUIRED_KINDS,
  ...EMERGENCY_PACK_OPTIONAL_KINDS,
]);

export interface EmergencyPackMetadataBoundary {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(): string[];
}

export interface EmergencyPackBodiesBoundary {
  put(key: string, body: string): Promise<void>;
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
}

export interface EmergencyPackScope {
  placeId: string;
  profileFingerprint: string;
  now: number;
}

export interface EmergencyPackStoreState {
  status: string;
  packId: string | null;
  reason?: string;
}

export interface EmergencyPackDetailedReadiness extends EmergencyPackStoreState {
  profileFingerprint: string;
  requiredKinds: EmergencyPackRequiredKind[];
  optionalKinds: EmergencyPackOptionalKind[];
  receipts: EmergencyPackReceipt[];
  missingKinds: EmergencyPackRequiredKind[];
  expiredKinds: EmergencyPackRequiredKind[];
}

export interface EmergencyPackArtifactInput {
  kind: EmergencyPackArtifactKind;
  body: string;
  expiresAt: number;
  semanticState: EmergencyPackSemanticState;
  summary: string;
  itemCount: number;
}

export interface EmergencyPackGenerationInput {
  placeId: string;
  profileFingerprint: string;
  requiredKinds: readonly EmergencyPackRequiredKind[];
  optionalKinds: readonly EmergencyPackOptionalKind[];
  artifacts: EmergencyPackArtifactInput[];
}

export interface EmergencyPackLifelineMigrationInput {
  placeId: string;
  profileFingerprint: string;
  legacyQueryFingerprint: string;
  legacyManifest: unknown;
  artifact: EmergencyPackArtifactInput & { kind: 'lifelines' };
}

interface EmergencyPackStoreDependencies {
  metadata: EmergencyPackMetadataBoundary;
  bodies: EmergencyPackBodiesBoundary;
  digest(body: string): Promise<string>;
  now(): number;
  createPackId(): string;
  verifyArtifactBody?(
    kind: EmergencyPackArtifactKind,
    body: string,
  ): boolean | Promise<boolean>;
  releaseArtifactBody?(
    kind: EmergencyPackArtifactKind,
    body: string,
  ): void | Promise<void>;
}

interface StoredArtifactBody {
  kind: EmergencyPackArtifactKind;
  cacheKey: string;
  body?: string;
  sha256?: string;
}

interface PackHead {
  schemaVersion: 2;
  packId: string;
  placeId: string;
  profileFingerprint: string;
  manifestKey: string;
  manifestSha256: string;
  previousPackId: string | null;
  committedAt: string;
}

interface EmergencyPackPruneInput {
  placeIds: string[];
  maxPlaces: number;
  generationsPerPlace: number;
}

interface RetainedGenerations {
  verifiedPlaceIds: Set<string>;
  manifestKeys: Set<string>;
  bodyKeys: Set<string>;
}

function headKey(placeId: string): string {
  return `${KEY_PREFIX}:head:${encodeURIComponent(placeId)}`;
}

function manifestKey(placeId: string, packId: string): string {
  return `${KEY_PREFIX}:manifest:${encodeURIComponent(placeId)}:${encodeURIComponent(packId)}`;
}

function bodyKey(packId: string, kind: string): string {
  return `${KEY_PREFIX}:body:${encodeURIComponent(packId)}:${kind}`;
}

function placeIdFromKey(key: string, kind: 'head' | 'manifest'): string | null {
  const prefix = `${KEY_PREFIX}:${kind}:`;
  if (!key.startsWith(prefix)) return null;
  const encodedPlaceId = key.slice(prefix.length).split(':', 1)[0];
  if (!encodedPlaceId) return null;
  try {
    const placeId = decodeURIComponent(encodedPlaceId);
    return isNonEmptyString(placeId) ? placeId : null;
  } catch {
    return null;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function parseHead(value: string | null): PackHead | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const head = parsed as Record<string, unknown>;
    const allowed = new Set([
      'schemaVersion',
      'packId',
      'placeId',
      'profileFingerprint',
      'manifestKey',
      'manifestSha256',
      'previousPackId',
      'committedAt',
    ]);
    if (Object.keys(head).some((key) => !allowed.has(key))) return null;
    if (
      head.schemaVersion !== 2
      || !isNonEmptyString(head.packId)
      || !isNonEmptyString(head.placeId)
      || !isNonEmptyString(head.profileFingerprint)
      || !isNonEmptyString(head.manifestKey)
      || !isNonEmptyString(head.manifestSha256)
      || !(head.previousPackId === null || isNonEmptyString(head.previousPackId))
      || !isNonEmptyString(head.committedAt)
      || !Number.isFinite(Date.parse(head.committedAt))
    ) return null;
    return head as unknown as PackHead;
  } catch {
    return null;
  }
}

function safeReason(error: unknown): string {
  if (error instanceof Error && /quota/i.test(error.message)) return 'storage-quota';
  return 'storage-failure';
}

function uniqueStrings(values: readonly string[]): boolean {
  return values.length > 0
    && values.every((value) => isNonEmptyString(value))
    && new Set(values).size === values.length;
}

function validPruneInput(input: EmergencyPackPruneInput): boolean {
  return Array.isArray(input.placeIds)
    && input.maxPlaces === 5
    && input.generationsPerPlace === 2
    && input.placeIds.every((placeId) => isNonEmptyString(placeId) && placeId.length <= 512);
}

function validateGenerationInput(input: EmergencyPackGenerationInput): boolean {
  if (!isNonEmptyString(input.placeId) || input.placeId.length > 512) return false;
  if (!isNonEmptyString(input.profileFingerprint) || input.profileFingerprint.length > 1024) return false;
  if (!uniqueStrings(input.requiredKinds)
    || input.requiredKinds.length !== EMERGENCY_PACK_REQUIRED_KINDS.length
    || EMERGENCY_PACK_REQUIRED_KINDS.some((kind) => !input.requiredKinds.includes(kind))) return false;
  if (new Set([...input.requiredKinds, ...input.optionalKinds]).size !== input.requiredKinds.length + input.optionalKinds.length) {
    return false;
  }
  if (!input.optionalKinds.every((kind) => EMERGENCY_PACK_OPTIONAL_KINDS.includes(kind))) return false;
  if (input.artifacts.length === 0 || new Set(input.artifacts.map(({ kind }) => kind)).size !== input.artifacts.length) {
    return false;
  }
  const suppliedKinds = new Set(input.artifacts.map(({ kind }) => kind));
  if (input.requiredKinds.some((kind) => !suppliedKinds.has(kind))) return false;
  const allowedKinds = new Set([...input.requiredKinds, ...input.optionalKinds]);
  return input.artifacts.every((artifact) => (
    allowedKinds.has(artifact.kind)
    && ARTIFACT_KINDS.has(artifact.kind)
    && isNonEmptyString(artifact.body)
    && new TextEncoder().encode(artifact.body).byteLength <= ARTIFACT_BYTE_CAPS[artifact.kind]
    && Number.isFinite(artifact.expiresAt)
    && (artifact.semanticState === 'verified' || artifact.semanticState === 'verified-empty')
    && isNonEmptyString(artifact.summary)
    && artifact.summary.length <= 512
    && Number.isSafeInteger(artifact.itemCount)
    && artifact.itemCount >= 0
  ));
}

function validateMigrationInput(input: EmergencyPackLifelineMigrationInput): boolean {
  const { artifact } = input;
  return isNonEmptyString(input.placeId)
    && input.placeId.length <= 512
    && isNonEmptyString(input.profileFingerprint)
    && input.profileFingerprint.length <= 1024
    && isNonEmptyString(input.legacyQueryFingerprint)
    && input.legacyQueryFingerprint.length <= 1024
    && artifact?.kind === 'lifelines'
    && isNonEmptyString(artifact.body)
    && new TextEncoder().encode(artifact.body).byteLength <= ARTIFACT_BYTE_CAPS.lifelines
    && Number.isFinite(artifact.expiresAt)
    && artifact.semanticState === 'verified'
    && isNonEmptyString(artifact.summary)
    && artifact.summary.length <= 512
    && Number.isSafeInteger(artifact.itemCount)
    && artifact.itemCount > 0;
}

function stateForManifest(
  manifest: EmergencyPackManifest,
  scope: EmergencyPackScope,
): EmergencyPackStoreState {
  if (manifest.placeId !== scope.placeId) {
    return { status: 'not-saved', packId: null, reason: 'place-id-mismatch' };
  }
  if (manifest.profileFingerprint !== scope.profileFingerprint) {
    return { status: 'not-saved', packId: null, reason: 'profile-fingerprint-mismatch' };
  }
  const readiness = deriveEmergencyPackReadiness(manifest, scope);
  return { status: readiness.status, packId: manifest.packId };
}

function emptyReadiness(
  profileFingerprint: string,
  reason?: string,
): EmergencyPackDetailedReadiness {
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

function recoveryKeys(
  metadata: EmergencyPackMetadataBoundary,
  scope: EmergencyPackScope,
  head: PackHead | null,
): string[] {
  const candidates: string[] = [];
  if (head?.previousPackId) candidates.push(manifestKey(scope.placeId, head.previousPackId));
  const prefix = `${KEY_PREFIX}:manifest:${encodeURIComponent(scope.placeId)}:`;
  for (const key of metadata.keys().filter((item) => item.startsWith(prefix)).reverse()) {
    if (key === head?.manifestKey) continue;
    if (!candidates.includes(key)) candidates.push(key);
    if (candidates.length >= MAX_RECOVERY_MANIFESTS) break;
  }
  return candidates.slice(0, MAX_RECOVERY_MANIFESTS);
}

export function createEmergencyPackStore(dependencies: EmergencyPackStoreDependencies) {
  const { metadata, bodies } = dependencies;
  const digest = (body: string) => dependencies.digest(body);
  const now = () => dependencies.now();
  const createPackId = () => dependencies.createPackId();

  async function verifyBody(kind: EmergencyPackArtifactKind, body: string): Promise<boolean> {
    try {
      return await (dependencies.verifyArtifactBody?.(kind, body) ?? true) === true;
    } catch {
      return false;
    }
  }

  async function releaseBody(kind: EmergencyPackArtifactKind, body: string): Promise<void> {
    if (kind !== 'offline-map') return;
    try {
      await dependencies.releaseArtifactBody?.(kind, body);
    } catch {
      // External cleanup is best effort and cannot change publication state.
    }
  }

  async function verifyReceiptBody(packId: string, receipt: EmergencyPackReceipt): Promise<boolean> {
    if (receipt.cacheKey !== bodyKey(packId, receipt.kind)) return false;
    const body = await bodies.get(receipt.cacheKey);
    if (body === null) return false;
    if (new TextEncoder().encode(body).byteLength !== receipt.byteLength) return false;
    if (await digest(body) !== receipt.sha256) return false;
    return verifyBody(receipt.kind, body);
  }

  async function loadVerifiedManifest(key: string, expectedDigest?: string): Promise<EmergencyPackManifest | null> {
    const encoded = metadata.getItem(key);
    if (encoded === null) return null;
    if (expectedDigest !== undefined && await digest(encoded) !== expectedDigest) return null;
    let raw: unknown;
    try {
      raw = JSON.parse(encoded);
    } catch {
      return null;
    }
    const parsed = parseEmergencyPackManifest(raw);
    if (!parsed || manifestKey(parsed.placeId, parsed.packId) !== key) return null;

    for (const receipt of parsed.receipts) {
      if (!await verifyReceiptBody(parsed.packId, receipt)) return null;
    }
    return parsed;
  }

  async function readActive(scope: EmergencyPackScope): Promise<EmergencyPackStoreState> {
    try {
      const head = parseHead(metadata.getItem(headKey(scope.placeId)));
      if (!head) return { status: 'not-saved', packId: null };
      if (head.placeId !== scope.placeId) {
        return { status: 'not-saved', packId: null, reason: 'place-id-mismatch' };
      }
      if (head.profileFingerprint !== scope.profileFingerprint) {
        return { status: 'not-saved', packId: null, reason: 'profile-fingerprint-mismatch' };
      }
      const manifest = await loadVerifiedManifest(head.manifestKey, head.manifestSha256);
      if (manifest?.packId !== head.packId) {
        return { status: 'corrupt', packId: null, reason: 'verification-failed' };
      }
      return stateForManifest(manifest, scope);
    } catch {
      return { status: 'unavailable', packId: null, reason: 'storage-failure' };
    }
  }

  async function readReadiness(scope: EmergencyPackScope): Promise<EmergencyPackDetailedReadiness> {
    try {
      const head = parseHead(metadata.getItem(headKey(scope.placeId)));
      if (!head) return emptyReadiness(scope.profileFingerprint);
      if (head.placeId !== scope.placeId) {
        return emptyReadiness(scope.profileFingerprint, 'place-id-mismatch');
      }
      if (head.profileFingerprint !== scope.profileFingerprint) {
        return emptyReadiness(scope.profileFingerprint, 'profile-fingerprint-mismatch');
      }
      const manifest = await loadVerifiedManifest(head.manifestKey, head.manifestSha256);
      if (manifest?.packId !== head.packId) {
        return emptyReadiness(scope.profileFingerprint, 'verification-failed');
      }
      const readiness = deriveEmergencyPackReadiness(manifest, scope);
      return {
        status: readiness.status,
        packId: manifest.packId,
        profileFingerprint: manifest.profileFingerprint,
        requiredKinds: [...manifest.requiredKinds],
        optionalKinds: [...manifest.optionalKinds],
        receipts: manifest.receipts.map((receipt) => ({ ...receipt })),
        missingKinds: [...readiness.missingKinds],
        expiredKinds: [...readiness.expiredKinds],
        ...(readiness.reasons[0] ? { reason: readiness.reasons[0] } : {}),
      };
    } catch {
      return emptyReadiness(scope.profileFingerprint, 'storage-failure');
    }
  }

  async function publishRecovered(manifest: EmergencyPackManifest): Promise<boolean> {
    const key = manifestKey(manifest.placeId, manifest.packId);
    const encoded = metadata.getItem(key);
    if (encoded === null) return false;
    const recoveredHead: PackHead = {
      schemaVersion: 2,
      packId: manifest.packId,
      placeId: manifest.placeId,
      profileFingerprint: manifest.profileFingerprint,
      manifestKey: key,
      manifestSha256: await digest(encoded),
      previousPackId: manifest.previousPackId,
      committedAt: manifest.committedAt,
    };
    metadata.setItem(headKey(manifest.placeId), JSON.stringify(recoveredHead));
    return true;
  }

  async function recoverActive(scope: EmergencyPackScope): Promise<EmergencyPackStoreState> {
    try {
      const head = parseHead(metadata.getItem(headKey(scope.placeId)));
      if (head && head.placeId !== scope.placeId) {
        return { status: 'not-saved', packId: null, reason: 'place-id-mismatch' };
      }
      if (head?.profileFingerprint && head.profileFingerprint !== scope.profileFingerprint) {
        return { status: 'not-saved', packId: null, reason: 'profile-fingerprint-mismatch' };
      }
      if (head) {
        const active = await loadVerifiedManifest(head.manifestKey, head.manifestSha256);
        if (active?.packId === head.packId) return stateForManifest(active, scope);
      }

      for (const key of recoveryKeys(metadata, scope, head)) {
        const manifest = await loadVerifiedManifest(key);
        if (manifest?.profileFingerprint !== scope.profileFingerprint) continue;
        const state = stateForManifest(manifest, scope);
        if (state.status !== 'ready') continue;
        if (!await publishRecovered(manifest)) continue;
        return state;
      }
      return { status: 'not-saved', packId: null };
    } catch {
      return { status: 'unavailable', packId: null, reason: 'storage-failure' };
    }
  }

  async function cleanupStoredBody(artifact: StoredArtifactBody): Promise<void> {
    try {
      const body = artifact.body ?? await bodies.get(artifact.cacheKey);
      if (body !== null && (artifact.sha256 === undefined || await digest(body) === artifact.sha256)) {
        await releaseBody(artifact.kind, body);
      }
    } catch {
      // A failed release or read cannot make an unpublished body active.
    }
    try {
      await bodies.delete(artifact.cacheKey);
    } catch {
      // Orphaned immutable bodies are safe and may be removed later.
    }
  }

  async function cleanupGeneration(key: string, artifacts: readonly StoredArtifactBody[]): Promise<void> {
    try {
      metadata.removeItem(key);
    } catch {
      // Best effort: an unpublished generation is never selected by the head.
    }
    for (const artifact of artifacts) await cleanupStoredBody(artifact);
  }

  async function cleanupOldGenerations(active: EmergencyPackManifest): Promise<void> {
    const retained = new Set(
      [active.packId, active.previousPackId]
        .filter((packId) => isNonEmptyString(packId))
        .map((packId) => manifestKey(active.placeId, packId)),
    );
    const prefix = `${KEY_PREFIX}:manifest:${encodeURIComponent(active.placeId)}:`;
    for (const key of metadata.keys().filter((item) => item.startsWith(prefix))) {
      if (retained.has(key)) continue;
      let artifacts: StoredArtifactBody[] = [];
      try {
        const encoded = metadata.getItem(key);
        const parsed = encoded === null ? null : parseEmergencyPackManifest(JSON.parse(encoded));
        if (parsed && manifestKey(parsed.placeId, parsed.packId) === key) {
          artifacts = parsed.receipts
            .filter((receipt) => receipt.cacheKey === bodyKey(parsed.packId, receipt.kind))
            .map(({ kind, cacheKey, sha256 }) => ({ kind, cacheKey, sha256 }));
        }
      } catch {
        artifacts = [];
      }
      await cleanupGeneration(key, artifacts);
    }
  }

  async function findPreviousPackId(
    encodedHead: string | null,
    profileFingerprint: string,
  ): Promise<string | null> {
    const head = parseHead(encodedHead);
    if (head?.profileFingerprint !== profileFingerprint) return null;
    const previous = await loadVerifiedManifest(head.manifestKey, head.manifestSha256);
    return previous?.packId === head.packId ? previous.packId : null;
  }

  async function hasValidActiveHead(placeId: string): Promise<boolean> {
    const head = parseHead(metadata.getItem(headKey(placeId)));
    if (head?.placeId !== placeId) return false;
    const manifest = await loadVerifiedManifest(head.manifestKey, head.manifestSha256);
    return manifest?.packId === head.packId && manifest.placeId === placeId;
  }

  async function stageArtifacts(
    input: EmergencyPackGenerationInput,
    packId: string,
    timestamp: number,
    stagedBodies: StoredArtifactBody[],
  ): Promise<EmergencyPackReceipt[]> {
    const capturedAt = new Date(timestamp).toISOString();
    const receipts: EmergencyPackReceipt[] = [];
    for (const artifact of input.artifacts) {
      if (artifact.expiresAt <= timestamp) throw new Error('artifact expired');
      const cacheKey = bodyKey(packId, artifact.kind);
      await bodies.put(cacheKey, artifact.body);
      stagedBodies.push({ kind: artifact.kind, cacheKey, body: artifact.body });
      const readback = await bodies.get(cacheKey);
      if (readback === null || readback !== artifact.body) throw new Error('body readback mismatch');
      const expectedDigest = await digest(artifact.body);
      if (await digest(readback) !== expectedDigest) throw new Error('body digest mismatch');
      if (!await verifyBody(artifact.kind, readback)) throw new Error('external artifact verification failed');
      receipts.push({
        kind: artifact.kind,
        profileFingerprint: input.profileFingerprint,
        cacheKey,
        sha256: expectedDigest,
        byteLength: new TextEncoder().encode(readback).byteLength,
        itemCount: artifact.itemCount,
        capturedAt,
        expiresAt: new Date(artifact.expiresAt).toISOString(),
        verifiedAt: capturedAt,
        semanticState: artifact.semanticState,
        summary: artifact.summary,
      });
    }
    return receipts;
  }

  async function writeManifest(key: string, manifest: EmergencyPackManifest): Promise<string> {
    const encoded = JSON.stringify(manifest);
    metadata.setItem(key, encoded);
    const persisted = metadata.getItem(key);
    if (persisted !== encoded) throw new Error('manifest readback mismatch');
    const sha256 = await digest(encoded);
    if (await digest(persisted) !== sha256) throw new Error('manifest digest mismatch');
    return sha256;
  }

  function writeHead(
    key: string,
    head: PackHead,
    encodedPreviousHead: string | null,
  ): void {
    const encoded = JSON.stringify(head);
    try {
      metadata.setItem(key, encoded);
      if (metadata.getItem(key) !== encoded) throw new Error('head readback mismatch');
    } catch (error) {
      try {
        if (encodedPreviousHead === null) metadata.removeItem(key);
        else metadata.setItem(key, encodedPreviousHead);
      } catch {
        // The storage boundary remains failed; no new generation is reported ready.
      }
      throw error;
    }
  }

  async function commitGeneration(input: EmergencyPackGenerationInput): Promise<
    { ok: true; packId: string } | { ok: false; reason: string }
  > {
    try {
      if (!validateGenerationInput(input)) return { ok: false, reason: 'invalid-input' };
    } catch {
      return { ok: false, reason: 'invalid-input' };
    }

    let key: string | null = null;
    const stagedBodies: StoredArtifactBody[] = [];

    try {
      const packId = createPackId();
      if (!isNonEmptyString(packId) || packId.length > 512) return { ok: false, reason: 'invalid-pack-id' };
      key = manifestKey(input.placeId, packId);
      if (metadata.getItem(key) !== null) return { ok: false, reason: 'pack-id-collision' };
      const activeHeadKey = headKey(input.placeId);
      const encodedExistingHead = metadata.getItem(activeHeadKey);
      const previousPackId = await findPreviousPackId(encodedExistingHead, input.profileFingerprint);

      const timestamp = now();
      if (!Number.isFinite(timestamp)) return { ok: false, reason: 'invalid-time' };
      const capturedAt = new Date(timestamp).toISOString();
      const stagedReceipts = await stageArtifacts(input, packId, timestamp, stagedBodies);

      const manifestCandidate = {
        schemaVersion: 2,
        packId,
        placeId: input.placeId,
        profileFingerprint: input.profileFingerprint,
        requiredKinds: [...input.requiredKinds],
        optionalKinds: [...input.optionalKinds],
        receipts: stagedReceipts,
        previousPackId,
        createdAt: capturedAt,
        committedAt: capturedAt,
        migration: null,
      };
      const manifest = parseEmergencyPackManifest(manifestCandidate);
      if (!manifest) throw new Error('manifest validation failed');

      const manifestSha256 = await writeManifest(key, manifest);

      const head: PackHead = {
        schemaVersion: 2,
        packId,
        placeId: input.placeId,
        profileFingerprint: input.profileFingerprint,
        manifestKey: key,
        manifestSha256,
        previousPackId,
        committedAt: capturedAt,
      };
      writeHead(activeHeadKey, head, encodedExistingHead);
      try {
        await cleanupOldGenerations(manifest);
      } catch {
        // Publication already succeeded; cleanup must never revoke the new head.
      }
      return { ok: true, packId };
    } catch (error) {
      if (key !== null) await cleanupGeneration(key, stagedBodies);
      return { ok: false, reason: safeReason(error) };
    }
  }

  async function migrateLifelineGeneration(input: EmergencyPackLifelineMigrationInput): Promise<
    { ok: true; packId: string } | { ok: false; reason: string }
  > {
    try {
      if (!validateMigrationInput(input)) return { ok: false, reason: 'invalid-input' };
    } catch {
      return { ok: false, reason: 'invalid-input' };
    }

    let key: string | null = null;
    const stagedBodies: StoredArtifactBody[] = [];
    try {
      if (await hasValidActiveHead(input.placeId)) return { ok: false, reason: 'active-v2-exists' };
      const packId = createPackId();
      if (!isNonEmptyString(packId) || packId.length > 512) return { ok: false, reason: 'invalid-pack-id' };
      key = manifestKey(input.placeId, packId);
      if (metadata.getItem(key) !== null) return { ok: false, reason: 'pack-id-collision' };

      const timestamp = now();
      if (!Number.isFinite(timestamp) || input.artifact.expiresAt <= timestamp) {
        return { ok: false, reason: 'invalid-input' };
      }
      const capturedAt = new Date(timestamp).toISOString();
      const cacheKey = bodyKey(packId, 'lifelines');
      const provisionalReceipt: EmergencyPackReceipt = {
        kind: 'lifelines',
        profileFingerprint: input.profileFingerprint,
        cacheKey,
        sha256: await digest(input.artifact.body),
        byteLength: new TextEncoder().encode(input.artifact.body).byteLength,
        itemCount: input.artifact.itemCount,
        capturedAt,
        expiresAt: new Date(input.artifact.expiresAt).toISOString(),
        verifiedAt: capturedAt,
        semanticState: input.artifact.semanticState,
        summary: input.artifact.summary,
      };
      const migrationScope = {
        placeId: input.placeId,
        profileFingerprint: input.profileFingerprint,
        legacyQueryFingerprint: input.legacyQueryFingerprint,
        packId,
        now: timestamp,
      };
      if (!migrateLifelinePackV1(input.legacyManifest, migrationScope, provisionalReceipt)) {
        return { ok: false, reason: 'invalid-legacy-pack' };
      }

      const stagedReceipts = await stageArtifacts({
        placeId: input.placeId,
        profileFingerprint: input.profileFingerprint,
        requiredKinds: EMERGENCY_PACK_REQUIRED_KINDS,
        optionalKinds: EMERGENCY_PACK_OPTIONAL_KINDS,
        artifacts: [input.artifact],
      }, packId, timestamp, stagedBodies);
      const receipt = stagedReceipts[0];
      if (receipt?.cacheKey !== cacheKey) throw new Error('migration receipt mismatch');
      const manifest = migrateLifelinePackV1(input.legacyManifest, migrationScope, receipt);
      if (!manifest) throw new Error('migration validation failed');

      if (await hasValidActiveHead(input.placeId)) {
        await cleanupGeneration(key, stagedBodies);
        return { ok: false, reason: 'active-v2-exists' };
      }
      const activeHeadKey = headKey(input.placeId);
      const encodedExistingHead = metadata.getItem(activeHeadKey);
      const manifestSha256 = await writeManifest(key, manifest);
      const head: PackHead = {
        schemaVersion: 2,
        packId,
        placeId: input.placeId,
        profileFingerprint: input.profileFingerprint,
        manifestKey: key,
        manifestSha256,
        previousPackId: null,
        committedAt: manifest.committedAt,
      };
      writeHead(activeHeadKey, head, encodedExistingHead);
      return { ok: true, packId };
    } catch (error) {
      if (key !== null) await cleanupGeneration(key, stagedBodies);
      return { ok: false, reason: safeReason(error) };
    }
  }

  async function collectRetainedGenerations(allowedPlaceIds: Set<string>): Promise<RetainedGenerations> {
    const retained: RetainedGenerations = {
      verifiedPlaceIds: new Set<string>(),
      manifestKeys: new Set<string>(),
      bodyKeys: new Set<string>(),
    };
    for (const placeId of allowedPlaceIds) {
      try {
        const head = parseHead(metadata.getItem(headKey(placeId)));
        if (head?.placeId !== placeId) continue;
        const active = await loadVerifiedManifest(head.manifestKey, head.manifestSha256);
        if (active?.packId !== head.packId || active.placeId !== placeId) continue;
        retained.verifiedPlaceIds.add(placeId);
        retained.manifestKeys.add(head.manifestKey);
        for (const receipt of active.receipts) retained.bodyKeys.add(receipt.cacheKey);

        if (!active.previousPackId) continue;
        const previousKey = manifestKey(placeId, active.previousPackId);
        const previous = await loadVerifiedManifest(previousKey);
        if (previous?.placeId !== placeId || previous.packId !== active.previousPackId) continue;
        retained.manifestKeys.add(previousKey);
        for (const receipt of previous.receipts) retained.bodyKeys.add(receipt.cacheKey);
      } catch {
        // Preserve an allowed place when its active chain cannot be verified.
      }
    }
    return retained;
  }

  function removeUnretainedHeads(allowedPlaceIds: Set<string>): void {
    for (const key of metadata.keys()) {
      const placeId = placeIdFromKey(key, 'head');
      if (placeId === null || allowedPlaceIds.has(placeId)) continue;
      try {
        metadata.removeItem(key);
      } catch {
        // Pruning is best effort and never changes retained readiness.
      }
    }
  }

  async function removeUnretainedManifest(
    key: string,
    placeId: string,
    retainedBodyKeys: Set<string>,
  ): Promise<void> {
    let parsed: EmergencyPackManifest | null = null;
    try {
      const encoded = metadata.getItem(key);
      parsed = encoded === null ? null : parseEmergencyPackManifest(JSON.parse(encoded));
      if (parsed?.placeId !== placeId || manifestKey(parsed.placeId, parsed.packId) !== key) return;
      metadata.removeItem(key);
    } catch {
      return;
    }
    for (const { kind, cacheKey, sha256 } of parsed.receipts) {
      if (retainedBodyKeys.has(cacheKey)) continue;
      await cleanupStoredBody({ kind, cacheKey, sha256 });
    }
  }

  async function removeUnretainedManifests(
    allowedPlaceIds: Set<string>,
    retained: RetainedGenerations,
  ): Promise<void> {
    for (const key of metadata.keys()) {
      const placeId = placeIdFromKey(key, 'manifest');
      if (placeId === null || retained.manifestKeys.has(key)) continue;
      if (allowedPlaceIds.has(placeId) && !retained.verifiedPlaceIds.has(placeId)) continue;
      await removeUnretainedManifest(key, placeId, retained.bodyKeys);
    }
  }

  async function prune(input: EmergencyPackPruneInput): Promise<void> {
    if (!validPruneInput(input)) return;
    const allowedPlaceIds = new Set(input.placeIds.slice(0, input.maxPlaces));
    const retained = await collectRetainedGenerations(allowedPlaceIds);
    removeUnretainedHeads(allowedPlaceIds);
    await removeUnretainedManifests(allowedPlaceIds, retained);
  }

  return {
    commitGeneration,
    migrateLifelineGeneration,
    readActive,
    readReadiness,
    recoverActive,
    prune,
  };
}
