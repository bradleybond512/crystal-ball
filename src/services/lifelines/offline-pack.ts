export const LIFELINE_OFFLINE_PACK_SCHEMA_VERSION = 1 as const;

export const LIFELINE_OFFLINE_PACK_ARTIFACT_KINDS = [
  'lifelines',
  'alerts',
  'route-primary',
  'route-alternate',
  'offline-map',
  'contacts',
  'comms-plan',
] as const;

export type LifelineOfflinePackArtifactKind = typeof LIFELINE_OFFLINE_PACK_ARTIFACT_KINDS[number];

export interface LifelineOfflinePackArtifact {
  kind: LifelineOfflinePackArtifactKind;
  queryFingerprint: string;
  cachedAt: Date;
  expiresAt: Date | null;
}

export interface LifelineOfflinePackManifest {
  schemaVersion: 1;
  placeId: string;
  queryFingerprint: string;
  requiredKinds: LifelineOfflinePackArtifactKind[];
  artifacts: LifelineOfflinePackArtifact[];
  createdAt: Date;
  updatedAt: Date;
}

export interface BuildLifelineOfflinePackManifestInput {
  placeId: string;
  queryFingerprint: string;
  requiredKinds: LifelineOfflinePackArtifactKind[];
  artifacts: LifelineOfflinePackArtifact[];
  createdAt: Date;
  updatedAt: Date;
}

export type LifelineOfflinePackStatus = 'ready' | 'partial' | 'expired' | 'not-saved';

export interface LifelineOfflinePackReadiness {
  status: LifelineOfflinePackStatus;
  queryFingerprint: string;
  compatibleArtifactCount: number;
  missingKinds: LifelineOfflinePackArtifactKind[];
  expiredKinds: LifelineOfflinePackArtifactKind[];
  incompatibleKinds: LifelineOfflinePackArtifactKind[];
  reasons: string[];
}

function validDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function requireNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function rejectDuplicates(kinds: readonly LifelineOfflinePackArtifactKind[], label: string): void {
  if (new Set(kinds).size !== kinds.length) throw new Error(`duplicate ${label} kind`);
}

/** Build a validated manifest. Storage and serialization deliberately live elsewhere. */
export function buildLifelineOfflinePackManifest(
  input: BuildLifelineOfflinePackManifestInput,
): LifelineOfflinePackManifest {
  const placeId = requireNonEmpty(input.placeId, 'placeId');
  const queryFingerprint = requireNonEmpty(input.queryFingerprint, 'queryFingerprint');
  if (!validDate(input.createdAt) || !validDate(input.updatedAt)) throw new Error('manifest timestamps must be valid');
  if (input.updatedAt.getTime() < input.createdAt.getTime()) throw new Error('updatedAt cannot precede createdAt');
  rejectDuplicates(input.requiredKinds, 'required artifact');
  rejectDuplicates(input.artifacts.map((artifact) => artifact.kind), 'artifact');
  for (const artifact of input.artifacts) {
    requireNonEmpty(artifact.queryFingerprint, 'artifact queryFingerprint');
    if (!validDate(artifact.cachedAt) || (artifact.expiresAt !== null && !validDate(artifact.expiresAt))) {
      throw new Error('artifact timestamps must be valid');
    }
    if (artifact.expiresAt && artifact.expiresAt.getTime() < artifact.cachedAt.getTime()) {
      throw new Error('artifact expiry cannot precede cache time');
    }
  }
  return {
    schemaVersion: LIFELINE_OFFLINE_PACK_SCHEMA_VERSION,
    placeId,
    queryFingerprint,
    requiredKinds: [...input.requiredKinds],
    artifacts: input.artifacts.map((artifact) => ({
      ...artifact,
      cachedAt: new Date(artifact.cachedAt),
      expiresAt: artifact.expiresAt ? new Date(artifact.expiresAt) : null,
    })),
    createdAt: new Date(input.createdAt),
    updatedAt: new Date(input.updatedAt),
  };
}

function notSaved(queryFingerprint: string, reason: string): LifelineOfflinePackReadiness {
  return {
    status: 'not-saved',
    queryFingerprint,
    compatibleArtifactCount: 0,
    missingKinds: [],
    expiredKinds: [],
    incompatibleKinds: [],
    reasons: [reason],
  };
}

/**
 * Evaluate only an exact query fingerprint. A pack from the same place ID but
 * different coordinates, radius, categories, or limits earns no readiness.
 */
export function deriveLifelineOfflinePackReadiness(
  queryFingerprint: string,
  manifest: LifelineOfflinePackManifest | null,
  now = Date.now(),
): LifelineOfflinePackReadiness {
  if (!manifest) return notSaved(queryFingerprint, 'manifest-missing');
  if (manifest.schemaVersion !== LIFELINE_OFFLINE_PACK_SCHEMA_VERSION) {
    return notSaved(queryFingerprint, 'manifest-schema-mismatch');
  }
  if (manifest.queryFingerprint !== queryFingerprint) {
    return notSaved(queryFingerprint, 'manifest-fingerprint-mismatch');
  }

  const compatible = manifest.artifacts.filter((artifact) => artifact.queryFingerprint === queryFingerprint);
  const incompatibleKinds = manifest.artifacts
    .filter((artifact) => artifact.queryFingerprint !== queryFingerprint)
    .map((artifact) => artifact.kind)
    .sort();
  const byKind = new Map(compatible.map((artifact) => [artifact.kind, artifact]));
  const missingKinds = manifest.requiredKinds.filter((kind) => !byKind.has(kind)).sort();
  const expiredKinds = manifest.requiredKinds.filter((kind) => {
    const artifact = byKind.get(kind);
    return artifact?.expiresAt ? artifact.expiresAt.getTime() <= now : false;
  }).sort();
  const reasons = [
    ...missingKinds.map((kind) => `missing:${kind}`),
    ...expiredKinds.map((kind) => `expired:${kind}`),
    ...incompatibleKinds.map((kind) => `fingerprint-mismatch:${kind}`),
  ];
  let status: LifelineOfflinePackStatus = 'ready';
  if (compatible.length === 0) status = 'not-saved';
  else if (expiredKinds.length > 0) status = 'expired';
  else if (missingKinds.length > 0) status = 'partial';
  return {
    status,
    queryFingerprint,
    compatibleArtifactCount: compatible.length,
    missingKinds,
    expiredKinds,
    incompatibleKinds,
    reasons,
  };
}
