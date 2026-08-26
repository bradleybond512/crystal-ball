import {
  EMERGENCY_PACK_OPTIONAL_KINDS,
  EMERGENCY_PACK_REQUIRED_KINDS,
  deriveEmergencyPackReadiness,
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

interface EmergencyPackStoreDependencies {
  metadata: EmergencyPackMetadataBoundary;
  bodies: EmergencyPackBodiesBoundary;
  digest(body: string): Promise<string>;
  now(): number;
  createPackId(): string;
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

function headKey(placeId: string): string {
  return `${KEY_PREFIX}:head:${encodeURIComponent(placeId)}`;
}

function manifestKey(placeId: string, packId: string): string {
  return `${KEY_PREFIX}:manifest:${encodeURIComponent(placeId)}:${encodeURIComponent(packId)}`;
}

function bodyKey(packId: string, kind: string): string {
  return `${KEY_PREFIX}:body:${encodeURIComponent(packId)}:${kind}`;
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

function recoveryKeys(
  metadata: EmergencyPackMetadataBoundary,
  scope: EmergencyPackScope,
  head: PackHead | null,
): string[] {
  const candidates: string[] = [];
  if (head?.previousPackId) candidates.push(manifestKey(scope.placeId, head.previousPackId));
  const prefix = `${KEY_PREFIX}:manifest:${encodeURIComponent(scope.placeId)}:`;
  for (const key of metadata.keys().filter((item) => item.startsWith(prefix)).reverse()) {
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
      if (receipt.cacheKey !== bodyKey(parsed.packId, receipt.kind)) return null;
      const body = await bodies.get(receipt.cacheKey);
      if (body === null) return null;
      if (new TextEncoder().encode(body).byteLength !== receipt.byteLength) return null;
      if (await digest(body) !== receipt.sha256) return null;
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
      if (head?.profileFingerprint && head.profileFingerprint !== scope.profileFingerprint) {
        return { status: 'not-saved', packId: null, reason: 'profile-fingerprint-mismatch' };
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

  async function cleanupGeneration(key: string, bodyKeys: readonly string[]): Promise<void> {
    try {
      metadata.removeItem(key);
    } catch {
      // Best effort: an unpublished generation is never selected by the head.
    }
    for (const cacheKey of bodyKeys) {
      try {
        await bodies.delete(cacheKey);
      } catch {
        // Best effort: orphaned immutable bodies are safe and may be removed later.
      }
    }
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
      let bodyKeys: string[] = [];
      try {
        const encoded = metadata.getItem(key);
        const parsed = encoded === null ? null : parseEmergencyPackManifest(JSON.parse(encoded));
        if (parsed && manifestKey(parsed.placeId, parsed.packId) === key) {
          bodyKeys = parsed.receipts
            .filter((receipt) => receipt.cacheKey === bodyKey(parsed.packId, receipt.kind))
            .map(({ cacheKey }) => cacheKey);
        }
      } catch {
        bodyKeys = [];
      }
      await cleanupGeneration(key, bodyKeys);
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

  async function stageArtifacts(
    input: EmergencyPackGenerationInput,
    packId: string,
    timestamp: number,
    stagedBodyKeys: string[],
  ): Promise<EmergencyPackReceipt[]> {
    const capturedAt = new Date(timestamp).toISOString();
    const receipts: EmergencyPackReceipt[] = [];
    for (const artifact of input.artifacts) {
      if (artifact.expiresAt <= timestamp) throw new Error('artifact expired');
      const cacheKey = bodyKey(packId, artifact.kind);
      await bodies.put(cacheKey, artifact.body);
      stagedBodyKeys.push(cacheKey);
      const readback = await bodies.get(cacheKey);
      if (readback === null || readback !== artifact.body) throw new Error('body readback mismatch');
      const expectedDigest = await digest(artifact.body);
      if (await digest(readback) !== expectedDigest) throw new Error('body digest mismatch');
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
    const stagedBodyKeys: string[] = [];

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
      const stagedReceipts = await stageArtifacts(input, packId, timestamp, stagedBodyKeys);

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
      if (key !== null) await cleanupGeneration(key, stagedBodyKeys);
      return { ok: false, reason: safeReason(error) };
    }
  }

  return { commitGeneration, readActive, recoverActive };
}
