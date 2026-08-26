export const EMERGENCY_PACK_SCHEMA_VERSION = 2 as const;

export const EMERGENCY_PACK_REQUIRED_KINDS = [
  'lifelines',
  'alerts',
  'route-primary',
  'offline-map',
  'comms-plan',
  'contacts',
] as const;

export const EMERGENCY_PACK_OPTIONAL_KINDS = ['route-alternate'] as const;

export type EmergencyPackRequiredKind = typeof EMERGENCY_PACK_REQUIRED_KINDS[number];
export type EmergencyPackOptionalKind = typeof EMERGENCY_PACK_OPTIONAL_KINDS[number];
export type EmergencyPackArtifactKind = EmergencyPackRequiredKind | EmergencyPackOptionalKind;
export type EmergencyPackStatus = 'ready' | 'partial' | 'expired' | 'not-saved';
export type EmergencyPackSemanticState = 'verified' | 'verified-empty';

export const EMERGENCY_PACK_ARTIFACT_BYTE_CAPS: Readonly<Record<EmergencyPackArtifactKind, number>> = {
  lifelines: 1024 * 1024,
  alerts: 256 * 1024,
  'route-primary': 512 * 1024,
  'route-alternate': 512 * 1024,
  'offline-map': 50 * 1024 * 1024,
  'comms-plan': 128 * 1024,
  contacts: 128 * 1024,
};

export interface EmergencyPackReceipt {
  kind: EmergencyPackArtifactKind;
  profileFingerprint: string;
  cacheKey: string;
  sha256: string;
  byteLength: number;
  itemCount: number;
  capturedAt: string;
  expiresAt: string;
  verifiedAt: string;
  semanticState: EmergencyPackSemanticState;
  summary: string;
}

export interface EmergencyPackManifest {
  schemaVersion: typeof EMERGENCY_PACK_SCHEMA_VERSION;
  packId: string;
  placeId: string;
  profileFingerprint: string;
  requiredKinds: EmergencyPackRequiredKind[];
  optionalKinds: EmergencyPackOptionalKind[];
  receipts: EmergencyPackReceipt[];
  previousPackId: string | null;
  createdAt: string;
  committedAt: string;
  migration: null | {
    source: 'lifeline-pack-v1';
    migratedAt: string;
  };
}

export interface EmergencyPackScope {
  placeId: string;
  profileFingerprint: string;
  now: number;
}

export interface LifelinePackV1MigrationScope extends EmergencyPackScope {
  legacyQueryFingerprint: string;
  packId?: string;
}

export interface EmergencyPackReadiness {
  status: EmergencyPackStatus;
  missingKinds: EmergencyPackRequiredKind[];
  expiredKinds: EmergencyPackRequiredKind[];
  reasons: string[];
}

const MANIFEST_KEYS = [
  'schemaVersion',
  'packId',
  'placeId',
  'profileFingerprint',
  'requiredKinds',
  'optionalKinds',
  'receipts',
  'previousPackId',
  'createdAt',
  'committedAt',
  'migration',
] as const;

const RECEIPT_KEYS = [
  'kind',
  'profileFingerprint',
  'cacheKey',
  'sha256',
  'byteLength',
  'itemCount',
  'capturedAt',
  'expiresAt',
  'verifiedAt',
  'semanticState',
  'summary',
] as const;

const V1_MANIFEST_KEYS = [
  'schemaVersion',
  'placeId',
  'queryFingerprint',
  'requiredKinds',
  'artifacts',
  'createdAt',
  'updatedAt',
] as const;

const V1_ARTIFACT_KEYS = ['kind', 'queryFingerprint', 'cachedAt', 'expiresAt'] as const;
const MIGRATION_KEYS = ['source', 'migratedAt'] as const;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const ALL_KINDS = new Set<string>([
  ...EMERGENCY_PACK_REQUIRED_KINDS,
  ...EMERGENCY_PACK_OPTIONAL_KINDS,
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isBoundedString(value: unknown, maxLength = 512): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isUniqueArray<T extends string>(value: unknown, allowed: ReadonlySet<string>): value is T[] {
  return Array.isArray(value)
    && value.every((item): item is T => typeof item === 'string' && allowed.has(item))
    && new Set(value).size === value.length;
}

function hasExactRequiredKinds(value: unknown): value is EmergencyPackRequiredKind[] {
  if (!isUniqueArray<EmergencyPackRequiredKind>(value, ALL_KINDS)) return false;
  return value.length === EMERGENCY_PACK_REQUIRED_KINDS.length
    && EMERGENCY_PACK_REQUIRED_KINDS.every((kind) => value.includes(kind));
}

function hasValidOptionalKinds(value: unknown): value is EmergencyPackOptionalKind[] {
  return isUniqueArray<EmergencyPackOptionalKind>(value, new Set(EMERGENCY_PACK_OPTIONAL_KINDS));
}

function parseReceipt(value: unknown, profileFingerprint?: string): EmergencyPackReceipt | null {
  if (!isRecord(value) || !hasExactKeys(value, RECEIPT_KEYS)) return null;
  if (typeof value.kind !== 'string' || !ALL_KINDS.has(value.kind)) return null;
  const kind = value.kind as EmergencyPackArtifactKind;
  if (!isBoundedString(value.profileFingerprint) || value.profileFingerprint !== profileFingerprint) return null;
  if (!isBoundedString(value.cacheKey, 1024)
    || typeof value.sha256 !== 'string'
    || !SHA256_HEX_PATTERN.test(value.sha256)) return null;
  if (!Number.isSafeInteger(value.byteLength)
    || (value.byteLength as number) <= 0
    || (value.byteLength as number) > EMERGENCY_PACK_ARTIFACT_BYTE_CAPS[kind]) return null;
  if (!Number.isSafeInteger(value.itemCount) || (value.itemCount as number) < 0) return null;
  if (!isIsoDate(value.capturedAt) || !isIsoDate(value.expiresAt) || !isIsoDate(value.verifiedAt)) return null;
  const capturedAt = Date.parse(value.capturedAt);
  const verifiedAt = Date.parse(value.verifiedAt);
  const expiresAt = Date.parse(value.expiresAt);
  if (capturedAt > verifiedAt || verifiedAt >= expiresAt) return null;
  if (value.semanticState !== 'verified' && value.semanticState !== 'verified-empty') return null;
  if (!isBoundedString(value.summary, 512)) return null;
  return {
    kind,
    profileFingerprint: value.profileFingerprint,
    cacheKey: value.cacheKey,
    sha256: value.sha256,
    byteLength: value.byteLength as number,
    itemCount: value.itemCount as number,
    capturedAt: value.capturedAt,
    expiresAt: value.expiresAt,
    verifiedAt: value.verifiedAt,
    semanticState: value.semanticState,
    summary: value.summary,
  };
}

function parseMigration(value: unknown): EmergencyPackManifest['migration'] | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !hasExactKeys(value, MIGRATION_KEYS)) return undefined;
  if (value.source !== 'lifeline-pack-v1' || !isIsoDate(value.migratedAt)) return undefined;
  return { source: value.source, migratedAt: value.migratedAt };
}

export function parseEmergencyPackManifest(value: unknown): EmergencyPackManifest | null {
  if (!isRecord(value) || !hasExactKeys(value, MANIFEST_KEYS)) return null;
  if (value.schemaVersion !== EMERGENCY_PACK_SCHEMA_VERSION) return null;
  if (!isBoundedString(value.packId) || !isBoundedString(value.placeId)) return null;
  if (!isBoundedString(value.profileFingerprint, 1024)) return null;
  const profileFingerprint = value.profileFingerprint;
  if (!hasExactRequiredKinds(value.requiredKinds) || !hasValidOptionalKinds(value.optionalKinds)) return null;
  if (!Array.isArray(value.receipts) || value.receipts.length > ALL_KINDS.size) return null;
  const receipts = value.receipts.map((receipt) => parseReceipt(receipt, profileFingerprint));
  if (receipts.includes(null)) return null;
  const validReceipts = receipts as EmergencyPackReceipt[];
  if (new Set(validReceipts.map((receipt) => receipt.kind)).size !== validReceipts.length) return null;
  const declaredKinds = new Set<string>([...value.requiredKinds, ...value.optionalKinds]);
  if (validReceipts.some((receipt) => !declaredKinds.has(receipt.kind))) return null;
  if (value.previousPackId !== null && !isBoundedString(value.previousPackId)) return null;
  if (!isIsoDate(value.createdAt) || !isIsoDate(value.committedAt)) return null;
  if (Date.parse(value.committedAt) < Date.parse(value.createdAt)) return null;
  if (validReceipts.some((receipt) => receipt.verifiedAt !== value.committedAt)) return null;
  const migration = parseMigration(value.migration);
  if (migration === undefined) return null;
  return {
    schemaVersion: EMERGENCY_PACK_SCHEMA_VERSION,
    packId: value.packId,
    placeId: value.placeId,
    profileFingerprint,
    requiredKinds: [...value.requiredKinds],
    optionalKinds: [...value.optionalKinds],
    receipts: validReceipts,
    previousPackId: value.previousPackId,
    createdAt: value.createdAt,
    committedAt: value.committedAt,
    migration,
  };
}

function notSaved(reason: string): EmergencyPackReadiness {
  return { status: 'not-saved', missingKinds: [], expiredKinds: [], reasons: [reason] };
}

export function deriveEmergencyPackReadiness(
  manifest: EmergencyPackManifest | null,
  scope: EmergencyPackScope,
): EmergencyPackReadiness {
  if (!manifest) return notSaved('manifest-missing');
  if (manifest.placeId !== scope.placeId) return notSaved('place-id-mismatch');
  if (manifest.profileFingerprint !== scope.profileFingerprint) return notSaved('profile-fingerprint-mismatch');
  const receipts = new Map(manifest.receipts.map((receipt) => [receipt.kind, receipt]));
  const missingKinds = EMERGENCY_PACK_REQUIRED_KINDS.filter((kind) => !receipts.has(kind));
  const expiredKinds = EMERGENCY_PACK_REQUIRED_KINDS.filter((kind) => {
    const receipt = receipts.get(kind);
    return receipt ? Date.parse(receipt.expiresAt) <= scope.now : false;
  });
  const reasons = [
    ...missingKinds.map((kind) => `missing:${kind}`),
    ...expiredKinds.map((kind) => `expired:${kind}`),
  ];
  if (expiredKinds.length > 0) return { status: 'expired', missingKinds, expiredKinds, reasons };
  if (missingKinds.length > 0) return { status: 'partial', missingKinds, expiredKinds, reasons };
  return { status: 'ready', missingKinds, expiredKinds, reasons };
}

function parseV1LifelinesArtifact(value: unknown, queryFingerprint: string, now: number): boolean {
  if (!isRecord(value) || !hasExactKeys(value, V1_ARTIFACT_KEYS)) return false;
  if (value.kind !== 'lifelines' || value.queryFingerprint !== queryFingerprint) return false;
  if (!isIsoDate(value.cachedAt) || !isIsoDate(value.expiresAt)) return false;
  return Date.parse(value.expiresAt) > Math.max(Date.parse(value.cachedAt), now);
}

export function migrateLifelinePackV1(
  value: unknown,
  scope: LifelinePackV1MigrationScope,
  verifiedLifelinesReceipt: EmergencyPackReceipt,
): EmergencyPackManifest | null {
  if (!isBoundedString(scope.placeId)
    || !isBoundedString(scope.profileFingerprint, 1024)
    || !isBoundedString(scope.legacyQueryFingerprint, 1024)
    || !Number.isFinite(scope.now)) return null;
  if (scope.packId !== undefined && !isBoundedString(scope.packId)) return null;
  if (!isRecord(value) || !hasExactKeys(value, V1_MANIFEST_KEYS)) return null;
  if (value.schemaVersion !== 1
    || value.placeId !== scope.placeId
    || value.queryFingerprint !== scope.legacyQueryFingerprint) {
    return null;
  }
  if (!Array.isArray(value.requiredKinds)
    || value.requiredKinds.length !== 1
    || value.requiredKinds[0] !== 'lifelines'
    || !Array.isArray(value.artifacts)
    || value.artifacts.length !== 1) return null;
  if (!isIsoDate(value.createdAt) || !isIsoDate(value.updatedAt)) return null;
  if (Date.parse(value.updatedAt) < Date.parse(value.createdAt) || Date.parse(value.updatedAt) > scope.now) return null;
  if (!parseV1LifelinesArtifact(value.artifacts[0], scope.legacyQueryFingerprint, scope.now)) {
    return null;
  }
  const receipt = parseReceipt(verifiedLifelinesReceipt, scope.profileFingerprint);
  if (receipt?.kind !== 'lifelines'
    || Date.parse(receipt.verifiedAt) !== scope.now
    || Date.parse(receipt.expiresAt) <= scope.now) return null;
  const migratedAt = new Date(scope.now).toISOString();
  return {
    schemaVersion: EMERGENCY_PACK_SCHEMA_VERSION,
    packId: scope.packId ?? `migrated-v1:${scope.placeId}`,
    placeId: scope.placeId,
    profileFingerprint: scope.profileFingerprint,
    requiredKinds: [...EMERGENCY_PACK_REQUIRED_KINDS],
    optionalKinds: [...EMERGENCY_PACK_OPTIONAL_KINDS],
    receipts: [receipt],
    previousPackId: null,
    createdAt: value.createdAt,
    committedAt: migratedAt,
    migration: { source: 'lifeline-pack-v1', migratedAt },
  };
}
