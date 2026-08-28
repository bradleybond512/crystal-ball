import {
  EMERGENCY_PACK_ARTIFACT_BYTE_CAPS,
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
const MAX_TIMESTAMP = 8_640_000_000_000_000;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const ARTIFACT_KINDS = new Set<EmergencyPackArtifactKind>([
  ...EMERGENCY_PACK_REQUIRED_KINDS,
  ...EMERGENCY_PACK_OPTIONAL_KINDS,
]);
const INVALIDATION_SCHEMA_VERSION = 2;
const STAGING_SCHEMA_VERSION = 1;
const MAX_STAGING_JOURNALS = 16;

export interface EmergencyPackMetadataBoundary {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(): string[];
}

export interface EmergencyPackBodiesBoundary {
  put(key: string, body: string): Promise<void>;
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<boolean>;
}

export interface EmergencyPackScope {
  placeId: string;
  profileFingerprint: string;
  now: number;
}

export interface EmergencyPackVerifiedOfflineMapArtifact {
  body: string;
  revision: string;
  expiresAt: number;
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
  capturedAt: number;
  sourceRevision?: string;
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
  adoptArtifactBody?(
    kind: EmergencyPackArtifactKind,
    body: string,
  ): void | Promise<void>;
  reconcileRecoveredArtifactBody?(
    kind: EmergencyPackArtifactKind,
    body: string,
  ): void | Promise<void>;
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

interface EmergencyPackStagingArtifact {
  kind: EmergencyPackArtifactKind;
  cacheKey: string;
  sha256: string;
}

interface EmergencyPackStagingJournal {
  schemaVersion: 1;
  packId: string;
  placeId: string;
  profileFingerprint: string;
  manifestKey: string;
  artifacts: EmergencyPackStagingArtifact[];
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

interface EmergencyPackInvalidationRecord {
  schemaVersion: 2;
  placeId: string;
  profileFingerprint: string;
  cutoffs: Partial<Record<EmergencyPackArtifactKind, number>>;
  sourceRevision: string | null;
  alertSequence: number;
}

interface AlertPublicationBinding {
  sourceRevision: string;
  alertSequence: number;
}

interface EmergencyPackInvalidationInput {
  placeId: string;
  profileFingerprint: string;
  kinds: readonly EmergencyPackArtifactKind[];
  capturedAt: number;
  sourceRevision?: string;
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

function stagingKey(packId: string): string {
  return `${KEY_PREFIX}:staging:${encodeURIComponent(packId)}`;
}

function invalidationKey(placeId: string, profileFingerprint: string): string {
  return `${KEY_PREFIX}:invalidation:${encodeURIComponent(placeId)}:${encodeURIComponent(profileFingerprint)}`;
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

function parseStagingJournal(value: string | null, key: string): EmergencyPackStagingJournal {
  if (value === null) throw new Error('missing staging journal');
  const raw: unknown = JSON.parse(value);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid staging journal');
  const journal = raw as Record<string, unknown>;
  const allowed = new Set([
    'schemaVersion',
    'packId',
    'placeId',
    'profileFingerprint',
    'manifestKey',
    'artifacts',
  ]);
  if (Object.keys(journal).length !== allowed.size
    || Object.keys(journal).some((field) => !allowed.has(field))
    || journal.schemaVersion !== STAGING_SCHEMA_VERSION
    || !isNonEmptyString(journal.packId)
    || journal.packId.length > 512
    || stagingKey(journal.packId) !== key
    || !isNonEmptyString(journal.placeId)
    || journal.placeId.length > 512
    || !isNonEmptyString(journal.profileFingerprint)
    || journal.profileFingerprint.length > 1024
    || journal.manifestKey !== manifestKey(journal.placeId, journal.packId)
    || !Array.isArray(journal.artifacts)
    || journal.artifacts.length === 0
    || journal.artifacts.length > ARTIFACT_KINDS.size) {
    throw new Error('invalid staging journal');
  }
  const artifacts: EmergencyPackStagingArtifact[] = [];
  for (const rawArtifact of journal.artifacts) {
    if (!rawArtifact || typeof rawArtifact !== 'object' || Array.isArray(rawArtifact)) {
      throw new Error('invalid staging artifact');
    }
    const artifact = rawArtifact as Record<string, unknown>;
    if (Object.keys(artifact).length !== 3
      || !ARTIFACT_KINDS.has(artifact.kind as EmergencyPackArtifactKind)
      || artifact.cacheKey !== bodyKey(journal.packId, String(artifact.kind))
      || typeof artifact.sha256 !== 'string'
      || !SHA256_HEX_PATTERN.test(artifact.sha256)) {
      throw new Error('invalid staging artifact');
    }
    artifacts.push({
      kind: artifact.kind as EmergencyPackArtifactKind,
      cacheKey: artifact.cacheKey as string,
      sha256: artifact.sha256,
    });
  }
  if (new Set(artifacts.map(({ kind }) => kind)).size !== artifacts.length) {
    throw new Error('duplicate staging artifact');
  }
  return {
    schemaVersion: STAGING_SCHEMA_VERSION,
    packId: journal.packId,
    placeId: journal.placeId,
    profileFingerprint: journal.profileFingerprint,
    manifestKey: journal.manifestKey as string,
    artifacts,
  };
}

function parseInvalidationRecord(value: string | null): EmergencyPackInvalidationRecord | null {
  if (value === null) return null;
  const raw: unknown = JSON.parse(value);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid invalidation record');
  const record = raw as Record<string, unknown>;
  if (Object.keys(record).length !== 6
    || record.schemaVersion !== INVALIDATION_SCHEMA_VERSION
    || !isNonEmptyString(record.placeId)
    || !isNonEmptyString(record.profileFingerprint)
    || !record.cutoffs
    || typeof record.cutoffs !== 'object'
    || Array.isArray(record.cutoffs)
    || !(record.sourceRevision === null
      || (typeof record.sourceRevision === 'string' && SHA256_HEX_PATTERN.test(record.sourceRevision)))) {
    throw new Error('invalid invalidation record');
  }
  if (!Number.isSafeInteger(record.alertSequence)
    || (record.alertSequence as number) < 0
    || (record.sourceRevision === null) !== (record.alertSequence === 0)) {
    throw new Error('invalid alert invalidation sequence');
  }
  const cutoffs = record.cutoffs as Record<string, unknown>;
  for (const [kind, cutoff] of Object.entries(cutoffs)) {
    if (!ARTIFACT_KINDS.has(kind as EmergencyPackArtifactKind)
      || kind === 'alerts'
      || !Number.isSafeInteger(cutoff)
      || (cutoff as number) <= 0
      || (cutoff as number) > 8_640_000_000_000_000) throw new Error('invalid invalidation cutoff');
  }
  return {
    schemaVersion: INVALIDATION_SCHEMA_VERSION,
    placeId: record.placeId,
    profileFingerprint: record.profileFingerprint,
    cutoffs: { ...cutoffs } as Partial<Record<EmergencyPackArtifactKind, number>>,
    sourceRevision: record.sourceRevision,
    alertSequence: record.alertSequence as number,
  };
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value > 0
    && value <= MAX_TIMESTAMP;
}

function bodyCapturedAt(body: string): number | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const capturedAt = (parsed as Record<string, unknown>).capturedAt;
    return isTimestamp(capturedAt) ? capturedAt : null;
  } catch {
    return null;
  }
}

function bodySourceRevision(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const sourceRevision = (parsed as Record<string, unknown>).sourceRevision;
    return typeof sourceRevision === 'string' && SHA256_HEX_PATTERN.test(sourceRevision)
      ? sourceRevision
      : null;
  } catch {
    return null;
  }
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
      || typeof head.manifestSha256 !== 'string'
      || !SHA256_HEX_PATTERN.test(head.manifestSha256)
      || !(head.previousPackId === null || isNonEmptyString(head.previousPackId))
      || !isNonEmptyString(head.committedAt)
      || !Number.isFinite(Date.parse(head.committedAt))
    ) return null;
    return head as unknown as PackHead;
  } catch {
    return null;
  }
}

function journalOwnsManifest(
  journal: EmergencyPackStagingJournal,
  manifest: EmergencyPackManifest,
): boolean {
  if (manifest.packId !== journal.packId
    || manifest.placeId !== journal.placeId
    || manifest.profileFingerprint !== journal.profileFingerprint
    || manifestKey(manifest.placeId, manifest.packId) !== journal.manifestKey
    || manifest.receipts.length !== journal.artifacts.length) return false;
  const journalArtifacts = new Map(journal.artifacts.map((artifact) => [artifact.kind, artifact]));
  return manifest.receipts.every((receipt) => {
    const artifact = journalArtifacts.get(receipt.kind);
    return artifact?.cacheKey === receipt.cacheKey && artifact.sha256 === receipt.sha256;
  });
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

function validInvalidationInput(input: EmergencyPackInvalidationInput): boolean {
  const includesAlerts = input.kinds.includes('alerts');
  return isNonEmptyString(input.placeId)
    && input.placeId.length <= 512
    && isNonEmptyString(input.profileFingerprint)
    && input.profileFingerprint.length <= 1024
    && input.kinds.length > 0
    && input.kinds.length <= ARTIFACT_KINDS.size
    && new Set(input.kinds).size === input.kinds.length
    && input.kinds.every((kind) => ARTIFACT_KINDS.has(kind))
    && isTimestamp(input.capturedAt)
    && (includesAlerts
      ? typeof input.sourceRevision === 'string' && SHA256_HEX_PATTERN.test(input.sourceRevision)
      : input.sourceRevision === undefined);
}

function nextAlertSequence(
  existing: EmergencyPackInvalidationRecord | null,
  activeSequenceFloor: number,
  requestedSourceRevision: string | null,
): number {
  if (requestedSourceRevision === null) return existing?.alertSequence ?? 0;
  if (existing?.sourceRevision === requestedSourceRevision) return existing.alertSequence;
  return Math.max(existing?.alertSequence ?? 0, activeSequenceFloor) + 1;
}

function nextInvalidationRecord(
  input: EmergencyPackInvalidationInput,
  existing: EmergencyPackInvalidationRecord | null,
  activeSequenceFloor: number,
): EmergencyPackInvalidationRecord {
  const matchingExisting = existing?.placeId === input.placeId
    && existing.profileFingerprint === input.profileFingerprint
    ? existing
    : null;
  const cutoffs: Partial<Record<EmergencyPackArtifactKind, number>> = { ...matchingExisting?.cutoffs };
  for (const kind of input.kinds) {
    if (kind !== 'alerts') cutoffs[kind] = Math.max(cutoffs[kind] ?? 0, input.capturedAt);
  }
  const requestedSourceRevision = input.kinds.includes('alerts') && typeof input.sourceRevision === 'string'
    ? input.sourceRevision
    : null;
  return {
    schemaVersion: INVALIDATION_SCHEMA_VERSION,
    placeId: input.placeId,
    profileFingerprint: input.profileFingerprint,
    cutoffs,
    sourceRevision: requestedSourceRevision ?? matchingExisting?.sourceRevision ?? null,
    alertSequence: nextAlertSequence(matchingExisting, activeSequenceFloor, requestedSourceRevision),
  };
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
    && new TextEncoder().encode(artifact.body).byteLength <= EMERGENCY_PACK_ARTIFACT_BYTE_CAPS[artifact.kind]
    && isTimestamp(artifact.capturedAt)
    && bodyCapturedAt(artifact.body) === artifact.capturedAt
    && (artifact.kind === 'alerts'
      ? typeof artifact.sourceRevision === 'string'
        && SHA256_HEX_PATTERN.test(artifact.sourceRevision)
        && bodySourceRevision(artifact.body) === artifact.sourceRevision
      : artifact.sourceRevision === undefined)
    && isTimestamp(artifact.expiresAt)
    && artifact.capturedAt < artifact.expiresAt
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
    && new TextEncoder().encode(artifact.body).byteLength <= EMERGENCY_PACK_ARTIFACT_BYTE_CAPS.lifelines
    && isTimestamp(artifact.capturedAt)
    && bodyCapturedAt(artifact.body) === artifact.capturedAt
    && isTimestamp(artifact.expiresAt)
    && artifact.capturedAt < artifact.expiresAt
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

function detailedStateForManifest(
  manifest: EmergencyPackManifest,
  scope: EmergencyPackScope,
): EmergencyPackDetailedReadiness {
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

  async function releaseBody(kind: EmergencyPackArtifactKind, body: string): Promise<boolean> {
    if (kind !== 'offline-map') return true;
    try {
      await dependencies.releaseArtifactBody?.(kind, body);
      return true;
    } catch {
      return false;
    }
  }

  async function verifyReceiptBody(packId: string, receipt: EmergencyPackReceipt): Promise<boolean> {
    if (receipt.cacheKey !== bodyKey(packId, receipt.kind)) return false;
    const body = await bodies.get(receipt.cacheKey);
    if (body === null) return false;
    if (new TextEncoder().encode(body).byteLength !== receipt.byteLength) return false;
    if (bodyCapturedAt(body) !== Date.parse(receipt.capturedAt)) return false;
    if (receipt.kind === 'alerts'
      && (typeof receipt.sourceRevision !== 'string'
        || bodySourceRevision(body) !== receipt.sourceRevision)) return false;
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

  function removeJournal(key: string): void {
    metadata.removeItem(key);
    if (metadata.getItem(key) !== null) throw new Error('staging journal removal failed');
  }

  async function isCommittedJournal(journal: EmergencyPackStagingJournal): Promise<boolean> {
    const encodedHead = metadata.getItem(headKey(journal.placeId));
    if (encodedHead === null) return false;
    const head = parseHead(encodedHead);
    if (!head) throw new Error('invalid head while reconciling staging journal');
    const namesJournal = head.packId === journal.packId || head.previousPackId === journal.packId;
    if (!namesJournal) return false;
    const active = await loadVerifiedManifest(head.manifestKey, head.manifestSha256);
    if (active?.packId !== head.packId
      || active.placeId !== head.placeId
      || active.profileFingerprint !== head.profileFingerprint) {
      throw new Error('invalid committed head while reconciling staging journal');
    }
    const owned = head.packId === journal.packId
      ? active
      : await loadVerifiedManifest(journal.manifestKey);
    if (!owned || !journalOwnsManifest(journal, owned)) {
      throw new Error('staging journal ownership mismatch');
    }
    return true;
  }

  async function cleanupUncommittedJournal(
    key: string,
    journal: EmergencyPackStagingJournal,
  ): Promise<void> {
    const stored = await Promise.all(journal.artifacts.map(async (artifact) => {
      const body = await bodies.get(artifact.cacheKey);
      if (body !== null && await digest(body) !== artifact.sha256) {
        throw new Error('staged body digest mismatch');
      }
      return { ...artifact, body };
    }));
    for (const artifact of stored) {
      if (artifact.kind === 'offline-map'
        && artifact.body !== null
        && !await releaseBody(artifact.kind, artifact.body)) {
        throw new Error('staged offline generation release failed');
      }
    }
    for (const artifact of stored) {
      if (await bodies.delete(artifact.cacheKey) !== true) {
        throw new Error('staged body deletion unconfirmed');
      }
    }
    metadata.removeItem(journal.manifestKey);
    if (metadata.getItem(journal.manifestKey) !== null) {
      throw new Error('unpublished manifest removal failed');
    }
    removeJournal(key);
  }

  async function reconcileStagingJournals(): Promise<void> {
    const keys = metadata.keys()
      .filter((key) => key.startsWith(`${KEY_PREFIX}:staging:`))
      .sort((left, right) => left.localeCompare(right));
    if (keys.length > MAX_STAGING_JOURNALS) throw new Error('too many staging journals');
    for (const key of keys) {
      const journal = parseStagingJournal(metadata.getItem(key), key);
      if (await isCommittedJournal(journal)) removeJournal(key);
      else await cleanupUncommittedJournal(key, journal);
    }
  }

  async function writeStagingJournal(
    input: EmergencyPackGenerationInput,
    packId: string,
  ): Promise<string> {
    const key = stagingKey(packId);
    if (metadata.getItem(key) !== null) throw new Error('staging journal collision');
    const journal: EmergencyPackStagingJournal = {
      schemaVersion: STAGING_SCHEMA_VERSION,
      packId,
      placeId: input.placeId,
      profileFingerprint: input.profileFingerprint,
      manifestKey: manifestKey(input.placeId, packId),
      artifacts: await Promise.all(input.artifacts.map(async ({ kind, body }) => ({
        kind,
        cacheKey: bodyKey(packId, kind),
        sha256: await digest(body),
      }))),
    };
    const encoded = JSON.stringify(journal);
    metadata.setItem(key, encoded);
    const persisted = metadata.getItem(key);
    if (persisted !== encoded) throw new Error('staging journal readback mismatch');
    parseStagingJournal(persisted, key);
    return key;
  }

  async function stagingReconciliationFailure(): Promise<string | null> {
    try {
      await reconcileStagingJournals();
      return null;
    } catch (error) {
      return safeReason(error);
    }
  }

  async function retryStagingReconciliation(): Promise<void> {
    try {
      await reconcileStagingJournals();
    } catch {
      // Durable journal ownership is retained for a later fail-closed retry.
    }
  }

  function readAlertInvalidationBinding(
    placeId: string,
    profileFingerprint: string,
  ): { sourceRevision: string | null; alertSequence: number } {
    const record = parseInvalidationRecord(metadata.getItem(invalidationKey(placeId, profileFingerprint)));
    return record?.placeId === placeId && record.profileFingerprint === profileFingerprint
      ? { sourceRevision: record.sourceRevision, alertSequence: record.alertSequence }
      : { sourceRevision: null, alertSequence: 0 };
  }

  function bindAlertReceipt(
    input: EmergencyPackGenerationInput,
    receipts: EmergencyPackReceipt[],
  ): AlertPublicationBinding | null {
    const artifact = input.artifacts.find(({ kind }) => kind === 'alerts');
    const receipt = receipts.find(({ kind }) => kind === 'alerts');
    if (!artifact || !receipt || typeof artifact.sourceRevision !== 'string') return null;
    const current = readAlertInvalidationBinding(input.placeId, input.profileFingerprint);
    if (current.sourceRevision !== null && current.sourceRevision !== artifact.sourceRevision) {
      throw new Error('alert source revision stale');
    }
    const binding = {
      sourceRevision: artifact.sourceRevision,
      alertSequence: current.sourceRevision === null ? 0 : current.alertSequence,
    };
    receipt.alertSequence = binding.alertSequence;
    return binding;
  }

  function alertBindingIsCurrent(
    placeId: string,
    profileFingerprint: string,
    binding: AlertPublicationBinding | null,
  ): boolean {
    if (binding === null) return true;
    const current = readAlertInvalidationBinding(placeId, profileFingerprint);
    return current.sourceRevision === null
      ? binding.alertSequence === 0
      : current.sourceRevision === binding.sourceRevision
        && current.alertSequence === binding.alertSequence;
  }

  async function activeAlertSequenceFloor(placeId: string, profileFingerprint: string): Promise<number> {
    const head = parseHead(metadata.getItem(headKey(placeId)));
    if (head?.placeId !== placeId || head.profileFingerprint !== profileFingerprint) return 0;
    const manifest = await loadVerifiedManifest(head.manifestKey, head.manifestSha256);
    const alertSequence = manifest?.packId === head.packId
      ? manifest.receipts.find(({ kind }) => kind === 'alerts')?.alertSequence
      : null;
    return typeof alertSequence === 'number' ? alertSequence : 0;
  }

  function applyInvalidations(manifest: EmergencyPackManifest): EmergencyPackManifest {
    const record = parseInvalidationRecord(metadata.getItem(
      invalidationKey(manifest.placeId, manifest.profileFingerprint),
    ));
    if (record?.profileFingerprint !== manifest.profileFingerprint) return manifest;
    return {
      ...manifest,
      receipts: manifest.receipts.filter((receipt) => {
        if (receipt.kind === 'alerts' && record.sourceRevision !== null) {
          return receipt.sourceRevision === record.sourceRevision
            && receipt.alertSequence === record.alertSequence;
        }
        const cutoff = record.cutoffs[receipt.kind];
        return cutoff === undefined || Date.parse(receipt.capturedAt) > cutoff;
      }),
    };
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
      const verified = await loadVerifiedManifest(head.manifestKey, head.manifestSha256);
      const manifest = verified ? applyInvalidations(verified) : null;
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
      const verified = await loadVerifiedManifest(head.manifestKey, head.manifestSha256);
      const manifest = verified ? applyInvalidations(verified) : null;
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

  function readOfflineMapRevision(scope: EmergencyPackScope): string | null {
    try {
      const head = parseHead(metadata.getItem(headKey(scope.placeId)));
      if (head?.placeId !== scope.placeId || head?.profileFingerprint !== scope.profileFingerprint) return null;
      const invalidation = parseInvalidationRecord(metadata.getItem(
        invalidationKey(scope.placeId, scope.profileFingerprint),
      ));
      const cutoff = invalidation?.profileFingerprint === scope.profileFingerprint
        ? invalidation.cutoffs['offline-map'] ?? 0
        : 0;
      return `${head.manifestKey}:${head.manifestSha256}:${cutoff}`;
    } catch {
      return null;
    }
  }

  async function readVerifiedOfflineMapArtifact(
    scope: EmergencyPackScope,
  ): Promise<EmergencyPackVerifiedOfflineMapArtifact | null> {
    try {
      if (!Number.isFinite(scope.now)) return null;
      const revision = readOfflineMapRevision(scope);
      if (revision === null) return null;
      const head = parseHead(metadata.getItem(headKey(scope.placeId)));
      if (head?.placeId !== scope.placeId || head?.profileFingerprint !== scope.profileFingerprint) return null;
      const encoded = metadata.getItem(head.manifestKey);
      if (encoded === null || await digest(encoded) !== head.manifestSha256) return null;
      const parsed = parseEmergencyPackManifest(JSON.parse(encoded));
      const manifest = parsed ? applyInvalidations(parsed) : null;
      if (manifest?.packId !== head.packId
        || manifest.placeId !== scope.placeId
        || manifest.profileFingerprint !== scope.profileFingerprint
        || manifestKey(manifest.placeId, manifest.packId) !== head.manifestKey) return null;
      const receipt = manifest.receipts.find(({ kind }) => kind === 'offline-map');
      if (receipt?.profileFingerprint !== scope.profileFingerprint
        || receipt.cacheKey !== bodyKey(manifest.packId, 'offline-map')
        || Date.parse(receipt.expiresAt) <= scope.now) return null;
      const body = await bodies.get(receipt.cacheKey);
      if (body === null
        || new TextEncoder().encode(body).byteLength !== receipt.byteLength
        || await digest(body) !== receipt.sha256) return null;
      if (readOfflineMapRevision(scope) !== revision) return null;
      return { body, revision, expiresAt: Date.parse(receipt.expiresAt) };
    } catch {
      return null;
    }
  }

  function publishRecovered(manifest: EmergencyPackManifest, recoveredHead: PackHead): boolean {
    const activeHeadKey = headKey(manifest.placeId);
    const encodedExistingHead = metadata.getItem(activeHeadKey);
    const encodedRecoveredHead = JSON.stringify(recoveredHead);
    const alertReceipt = manifest.receipts.find(({ kind }) => kind === 'alerts');
    const alertBinding = typeof alertReceipt?.sourceRevision === 'string'
      && typeof alertReceipt.alertSequence === 'number'
      ? { sourceRevision: alertReceipt.sourceRevision, alertSequence: alertReceipt.alertSequence }
      : null;
    try {
      if (!alertBindingIsCurrent(manifest.placeId, manifest.profileFingerprint, alertBinding)) return false;
      metadata.setItem(activeHeadKey, encodedRecoveredHead);
      if (metadata.getItem(activeHeadKey) !== encodedRecoveredHead) {
        throw new Error('recovered head readback mismatch');
      }
      return true;
    } catch {
      try {
        if (encodedExistingHead === null) metadata.removeItem(activeHeadKey);
        else metadata.setItem(activeHeadKey, encodedExistingHead);
      } catch {
        // Failed recovery publication must never be reported as persisted.
      }
      return false;
    }
  }

  async function reconcileRecoveredManifest(
    manifest: EmergencyPackManifest,
  ): Promise<EmergencyPackManifest | null> {
    const receipt = manifest.receipts.find(({ kind }) => kind === 'offline-map');
    if (receipt) {
      const body = await bodies.get(receipt.cacheKey);
      if (body === null
        || new TextEncoder().encode(body).byteLength !== receipt.byteLength
        || bodyCapturedAt(body) !== Date.parse(receipt.capturedAt)
        || await digest(body) !== receipt.sha256
        || !await verifyBody('offline-map', body)) return null;
      await dependencies.reconcileRecoveredArtifactBody?.('offline-map', body);
    }
    const current = applyInvalidations(manifest);
    const alertReceipt = current.receipts.find(({ kind }) => kind === 'alerts');
    const alertBinding = typeof alertReceipt?.sourceRevision === 'string'
      && typeof alertReceipt.alertSequence === 'number'
      ? { sourceRevision: alertReceipt.sourceRevision, alertSequence: alertReceipt.alertSequence }
      : null;
    return alertBindingIsCurrent(current.placeId, current.profileFingerprint, alertBinding)
      ? current
      : { ...current, receipts: current.receipts.filter(({ kind }) => kind !== 'alerts') };
  }

  async function readVerifiedActiveManifest(
    scope: EmergencyPackScope,
    head: PackHead | null,
  ): Promise<EmergencyPackManifest | null> {
    if (!head) return null;
    const verified = await loadVerifiedManifest(head.manifestKey, head.manifestSha256);
    return verified?.packId === head.packId
      && verified.placeId === scope.placeId
      && verified.profileFingerprint === scope.profileFingerprint
      ? verified
      : null;
  }

  async function recoverFallbackManifest(
    key: string,
    scope: EmergencyPackScope,
  ): Promise<EmergencyPackManifest | null> {
    const verified = await loadVerifiedManifest(key);
    if (verified?.profileFingerprint !== scope.profileFingerprint) return null;
    if (stateForManifest(applyInvalidations(verified), scope).status !== 'ready') return null;
    const encoded = metadata.getItem(key);
    if (encoded === null) return null;
    const recoveredHead: PackHead = {
      schemaVersion: 2,
      packId: verified.packId,
      placeId: verified.placeId,
      profileFingerprint: verified.profileFingerprint,
      manifestKey: key,
      manifestSha256: await digest(encoded),
      previousPackId: verified.previousPackId,
      committedAt: verified.committedAt,
    };
    const manifest = await reconcileRecoveredManifest(verified);
    if (!manifest || stateForManifest(manifest, scope).status !== 'ready') return null;
    if (metadata.getItem(key) !== encoded) return null;
    return publishRecovered(manifest, recoveredHead) ? manifest : null;
  }

  async function recoverVerifiedManifest(scope: EmergencyPackScope): Promise<EmergencyPackManifest | null> {
    const head = parseHead(metadata.getItem(headKey(scope.placeId)));
    if (head?.profileFingerprint && head.profileFingerprint !== scope.profileFingerprint) return null;
    const active = await readVerifiedActiveManifest(scope, head);
    if (active) return reconcileRecoveredManifest(active);
    for (const key of recoveryKeys(metadata, scope, head)) {
      const recovered = await recoverFallbackManifest(key, scope);
      if (recovered) return recovered;
    }
    return null;
  }

  async function recoverActive(scope: EmergencyPackScope): Promise<EmergencyPackStoreState> {
    try {
      await reconcileStagingJournals();
      const head = parseHead(metadata.getItem(headKey(scope.placeId)));
      if (head && head.placeId !== scope.placeId) {
        return { status: 'not-saved', packId: null, reason: 'place-id-mismatch' };
      }
      if (head?.profileFingerprint && head.profileFingerprint !== scope.profileFingerprint) {
        return { status: 'not-saved', packId: null, reason: 'profile-fingerprint-mismatch' };
      }
      const manifest = await recoverVerifiedManifest(scope);
      return manifest ? stateForManifest(manifest, scope) : { status: 'not-saved', packId: null };
    } catch {
      return { status: 'unavailable', packId: null, reason: 'storage-failure' };
    }
  }

  async function recoverReadiness(scope: EmergencyPackScope): Promise<EmergencyPackDetailedReadiness> {
    try {
      await reconcileStagingJournals();
      const manifest = await recoverVerifiedManifest(scope);
      return manifest
        ? detailedStateForManifest(manifest, scope)
        : emptyReadiness(scope.profileFingerprint);
    } catch {
      return emptyReadiness(scope.profileFingerprint, 'storage-failure');
    }
  }

  async function prepareStoredBodyRelease(artifact: StoredArtifactBody): Promise<boolean> {
    if (artifact.kind !== 'offline-map') return true;
    try {
      const body = artifact.body ?? await bodies.get(artifact.cacheKey);
      if (body === null) return true;
      if (artifact.sha256 !== undefined && await digest(body) !== artifact.sha256) return false;
      return releaseBody(artifact.kind, body);
    } catch {
      return false;
    }
  }

  async function deleteStoredBody(artifact: StoredArtifactBody): Promise<boolean> {
    try {
      return await bodies.delete(artifact.cacheKey) === true;
    } catch {
      return false;
    }
  }

  async function cleanupGeneration(key: string, artifacts: readonly StoredArtifactBody[]): Promise<void> {
    for (const artifact of artifacts) {
      if (!await prepareStoredBodyRelease(artifact)) return;
    }
    for (const artifact of artifacts) {
      if (!await deleteStoredBody(artifact)) return;
    }
    try {
      metadata.removeItem(key);
    } catch {
      // Retaining metadata is safe and permits a later cleanup retry.
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
    const verifiedAt = new Date(timestamp).toISOString();
    const receipts: EmergencyPackReceipt[] = [];
    for (const artifact of input.artifacts) {
      if (artifact.capturedAt > timestamp || timestamp >= artifact.expiresAt) {
        throw new Error('artifact chronology invalid');
      }
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
        capturedAt: new Date(artifact.capturedAt).toISOString(),
        expiresAt: new Date(artifact.expiresAt).toISOString(),
        verifiedAt,
        semanticState: artifact.semanticState,
        summary: artifact.summary,
        ...(artifact.kind === 'alerts' ? { sourceRevision: artifact.sourceRevision, alertSequence: 0 } : {}),
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

  async function adoptStagedBodies(stagedBodies: readonly StoredArtifactBody[]): Promise<void> {
    for (const artifact of stagedBodies) {
      if (artifact.body !== undefined) {
        await dependencies.adoptArtifactBody?.(artifact.kind, artifact.body);
      }
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

    const reconciliationFailure = await stagingReconciliationFailure();
    if (reconciliationFailure !== null) return { ok: false, reason: reconciliationFailure };

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
      if (!isTimestamp(timestamp)) return { ok: false, reason: 'invalid-time' };
      const committedAt = new Date(timestamp).toISOString();
      await writeStagingJournal(input, packId);
      const stagedReceipts = await stageArtifacts(input, packId, timestamp, stagedBodies);
      const alertBinding = bindAlertReceipt(input, stagedReceipts);

      const manifestCandidate = {
        schemaVersion: 2,
        packId,
        placeId: input.placeId,
        profileFingerprint: input.profileFingerprint,
        requiredKinds: [...input.requiredKinds],
        optionalKinds: [...input.optionalKinds],
        receipts: stagedReceipts,
        previousPackId,
        createdAt: committedAt,
        committedAt,
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
        committedAt,
      };
      if (!alertBindingIsCurrent(input.placeId, input.profileFingerprint, alertBinding)) {
        throw new Error('alert invalidation changed during publication');
      }
      await adoptStagedBodies(stagedBodies);
      writeHead(activeHeadKey, head, encodedExistingHead);
      await retryStagingReconciliation();
      try {
        await cleanupOldGenerations(manifest);
      } catch {
        // Publication already succeeded; cleanup must never revoke the new head.
      }
      return { ok: true, packId };
    } catch (error) {
      await retryStagingReconciliation();
      return { ok: false, reason: safeReason(error) };
    }
  }

  async function invalidateArtifacts(
    input: EmergencyPackInvalidationInput,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const includesAlerts = input.kinds.includes('alerts');
    if (!validInvalidationInput(input)) return { ok: false, reason: 'invalid-input' };
    const key = invalidationKey(input.placeId, input.profileFingerprint);
    let previous: string | null | undefined;
    try {
      const activeSequenceFloor = includesAlerts
        ? await activeAlertSequenceFloor(input.placeId, input.profileFingerprint)
        : 0;
      previous = metadata.getItem(key);
      const existing = parseInvalidationRecord(previous);
      const nextRecord = nextInvalidationRecord(input, existing, activeSequenceFloor);
      if (!Number.isSafeInteger(nextRecord.alertSequence)) throw new Error('alert invalidation sequence exhausted');
      const encoded = JSON.stringify(nextRecord);
      metadata.setItem(key, encoded);
      if (metadata.getItem(key) !== encoded) throw new Error('invalidation readback mismatch');
      return { ok: true };
    } catch (error) {
      try {
        if (previous === null) metadata.removeItem(key);
        else if (previous !== undefined) metadata.setItem(key, previous);
      } catch {
        // Failed persistence stays fail-closed at the runtime boundary.
      }
      return { ok: false, reason: safeReason(error) };
    }
  }

  async function activeAlertRevisionMatches(
    placeId: string,
    profileFingerprint: string,
    sourceRevision: string,
  ): Promise<boolean> {
    const head = parseHead(metadata.getItem(headKey(placeId)));
    if (head?.placeId !== placeId || head.profileFingerprint !== profileFingerprint) return false;
    const verified = await loadVerifiedManifest(head.manifestKey, head.manifestSha256);
    if (verified?.packId !== head.packId) return false;
    return verified.receipts.find(({ kind }) => kind === 'alerts')?.sourceRevision === sourceRevision;
  }

  async function reconcileAlertRevision(input: {
    placeId: string;
    profileFingerprint: string;
    capturedAt: number;
    sourceRevision: string;
  }): Promise<{ ok: true } | { ok: false; reason: string }> {
    const invalidation = { ...input, kinds: ['alerts'] as const };
    if (!validInvalidationInput(invalidation)) return { ok: false, reason: 'invalid-input' };
    try {
      const encoded = metadata.getItem(invalidationKey(input.placeId, input.profileFingerprint));
      const existing = parseInvalidationRecord(encoded);
      if (encoded !== null && existing === null) return { ok: false, reason: 'invalid-invalidation-record' };
      if (existing?.placeId === input.placeId
        && existing.profileFingerprint === input.profileFingerprint
        && existing.sourceRevision === input.sourceRevision) return { ok: true };

      if (existing === null && await activeAlertRevisionMatches(
        input.placeId,
        input.profileFingerprint,
        input.sourceRevision,
      )) return { ok: true };
      return invalidateArtifacts(invalidation);
    } catch (error) {
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

    const reconciliationFailure = await stagingReconciliationFailure();
    if (reconciliationFailure !== null) return { ok: false, reason: reconciliationFailure };

    let key: string | null = null;
    const stagedBodies: StoredArtifactBody[] = [];
    try {
      if (await hasValidActiveHead(input.placeId)) return { ok: false, reason: 'active-v2-exists' };
      const packId = createPackId();
      if (!isNonEmptyString(packId) || packId.length > 512) return { ok: false, reason: 'invalid-pack-id' };
      key = manifestKey(input.placeId, packId);
      if (metadata.getItem(key) !== null) return { ok: false, reason: 'pack-id-collision' };

      const timestamp = now();
      if (!isTimestamp(timestamp)
        || input.artifact.capturedAt > timestamp
        || timestamp >= input.artifact.expiresAt) {
        return { ok: false, reason: 'invalid-input' };
      }
      const verifiedAt = new Date(timestamp).toISOString();
      const cacheKey = bodyKey(packId, 'lifelines');
      const provisionalReceipt: EmergencyPackReceipt = {
        kind: 'lifelines',
        profileFingerprint: input.profileFingerprint,
        cacheKey,
        sha256: await digest(input.artifact.body),
        byteLength: new TextEncoder().encode(input.artifact.body).byteLength,
        itemCount: input.artifact.itemCount,
        capturedAt: new Date(input.artifact.capturedAt).toISOString(),
        expiresAt: new Date(input.artifact.expiresAt).toISOString(),
        verifiedAt,
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

      const generationInput: EmergencyPackGenerationInput = {
        placeId: input.placeId,
        profileFingerprint: input.profileFingerprint,
        requiredKinds: EMERGENCY_PACK_REQUIRED_KINDS,
        optionalKinds: EMERGENCY_PACK_OPTIONAL_KINDS,
        artifacts: [input.artifact],
      };
      await writeStagingJournal(generationInput, packId);
      const stagedReceipts = await stageArtifacts(generationInput, packId, timestamp, stagedBodies);
      const receipt = stagedReceipts[0];
      if (receipt?.cacheKey !== cacheKey) throw new Error('migration receipt mismatch');
      const manifest = migrateLifelinePackV1(input.legacyManifest, migrationScope, receipt);
      if (!manifest) throw new Error('migration validation failed');

      if (await hasValidActiveHead(input.placeId)) {
        await reconcileStagingJournals();
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
      await retryStagingReconciliation();
      return { ok: true, packId };
    } catch (error) {
      await retryStagingReconciliation();
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
    } catch {
      return;
    }
    const artifacts = parsed.receipts
      .filter(({ cacheKey }) => !retainedBodyKeys.has(cacheKey))
      .map(({ kind, cacheKey, sha256 }) => ({ kind, cacheKey, sha256 }));
    await cleanupGeneration(key, artifacts);
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
    try {
      await reconcileStagingJournals();
    } catch {
      return;
    }
    const allowedPlaceIds = new Set(input.placeIds.slice(0, input.maxPlaces));
    const retained = await collectRetainedGenerations(allowedPlaceIds);
    removeUnretainedHeads(allowedPlaceIds);
    await removeUnretainedManifests(allowedPlaceIds, retained);
  }

  return {
    commitGeneration,
    invalidateArtifacts,
    reconcileAlertRevision,
    migrateLifelineGeneration,
    readActive,
    readReadiness,
    readOfflineMapRevision,
    readVerifiedOfflineMapArtifact,
    recoverActive,
    recoverReadiness,
    prune,
  };
}
