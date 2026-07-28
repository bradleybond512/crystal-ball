import type {
  PredictionRecord,
  ResolutionEvidence,
  ResolutionMetadata,
  ResolutionProvenance,
} from './forecast-calibration';

export type ResolutionValidationReason =
  | 'invalid_resolution_time'
  | 'invalid_note'
  | 'invalid_resolver'
  | 'missing_evidence'
  | 'malformed_evidence'
  | 'duplicate_evidence'
  | 'label_leakage'
  | 'contradictory_evidence';

export type ResolutionValidationResult =
  | { ok: true }
  | { ok: false; reason: ResolutionValidationReason };

export interface ResolutionOriginCounts {
  direct: number;
  proxy: number;
  manual: number;
}

export interface ResolutionQualityDomainRow {
  domain: PredictionRecord['domain'];
  total: number;
  resolved: number;
  resolutionCoverage: number;
  origins: ResolutionOriginCounts;
  malformed: number;
  labelLeakage: number;
  duplicateOutcomes: number;
  lateResolutions: number;
  contradictoryEvidence: number;
  uncertainProxy: number;
}

export interface ResolutionQualityAudit {
  summary: {
    total: number;
    resolved: number;
    resolutionCoverage: number;
    origins: ResolutionOriginCounts;
    malformed: number;
    labelLeakage: number;
    duplicateOutcomes: number;
    lateResolutions: number;
    contradictoryEvidence: number;
    uncertainProxy: number;
  };
  byDomain: readonly ResolutionQualityDomainRow[];
}

const RESOLVER_ID = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const SOURCE_ID = /^[a-z0-9][a-z0-9:._-]{0,127}$/i;
const MAX_EVIDENCE = 32;

export function validateResolutionMetadata(
  prediction: PredictionRecord,
  resolvedAt: number,
  metadata: ResolutionMetadata,
): ResolutionValidationResult {
  if (!validResolutionTime(prediction, resolvedAt)) {
    return { ok: false, reason: 'invalid_resolution_time' };
  }
  const metadataRecord = objectRecord(metadata);
  const provenance = objectRecord(metadataRecord?.provenance);
  const kind = resolutionKind(provenance?.kind);
  if (!validResolver(provenance?.resolverId, kind)) {
    return { ok: false, reason: 'invalid_resolver' };
  }
  if (!validNote(metadataRecord?.note, kind)) {
    return { ok: false, reason: 'invalid_note' };
  }
  const evidence = unknownArray(provenance?.evidence);
  if (!evidence || evidence.length === 0) {
    return { ok: false, reason: 'missing_evidence' };
  }
  if (evidence.length > MAX_EVIDENCE) {
    return { ok: false, reason: 'malformed_evidence' };
  }

  const identities = new Set<string>();
  for (const candidate of evidence) {
    if (!isResolutionEvidence(candidate)) {
      return { ok: false, reason: 'malformed_evidence' };
    }
    if (evidenceLeaks(prediction, kind, candidate, resolvedAt)) {
      return { ok: false, reason: 'label_leakage' };
    }
    if (candidate.supportsOutcome !== true) {
      return { ok: false, reason: 'contradictory_evidence' };
    }
    const identity = evidenceIdentity(candidate);
    if (identities.has(identity)) {
      return { ok: false, reason: 'duplicate_evidence' };
    }
    identities.add(identity);
  }
  return { ok: true };
}

export function auditResolutionQuality(
  predictions: readonly PredictionRecord[],
  now: number = Date.now(),
): ResolutionQualityAudit {
  const duplicateIds = duplicateOutcomeIds(predictions);
  const byDomain = new Map<PredictionRecord['domain'], MutableDomainRow>();
  const totalOrigins = freshOrigins();
  const summary = {
    total: predictions.length,
    resolved: 0,
    resolutionCoverage: 0,
    origins: totalOrigins,
    malformed: 0,
    labelLeakage: 0,
    duplicateOutcomes: duplicateIds.size,
    lateResolutions: 0,
    contradictoryEvidence: 0,
    uncertainProxy: 0,
  };

  for (const prediction of predictions) {
    const row = domainRow(byDomain, prediction.domain);
    row.total += 1;
    if (!isResolved(prediction)) continue;
    row.resolved += 1;
    summary.resolved += 1;
    const origin = resolutionOrigin(prediction);
    row.origins[origin] += 1;
    summary.origins[origin] += 1;

    const quality = inspectResolvedPrediction(prediction, now);
    addQuality(summary, quality);
    addQuality(row, quality);
    if (duplicateIds.has(prediction.id)) row.duplicateOutcomes += 1;
  }

  summary.resolutionCoverage = ratio(summary.resolved, summary.total);
  return {
    summary,
    byDomain: [...byDomain.values()]
      .map((row) => ({
        ...row,
        resolutionCoverage: ratio(row.resolved, row.total),
      }))
      .sort((a, b) => b.total - a.total || a.domain.localeCompare(b.domain)),
  };
}

interface QualityCounts {
  malformed: number;
  labelLeakage: number;
  lateResolutions: number;
  contradictoryEvidence: number;
  uncertainProxy: number;
}

interface MutableDomainRow extends QualityCounts {
  domain: PredictionRecord['domain'];
  total: number;
  resolved: number;
  resolutionCoverage: number;
  origins: ResolutionOriginCounts;
  duplicateOutcomes: number;
}

function inspectResolvedPrediction(
  prediction: PredictionRecord,
  now: number,
): QualityCounts {
  const provenance = prediction.resolutionProvenance;
  const resolvedAt = prediction.resolvedAt;
  const quality: QualityCounts = {
    malformed: resolvedAt !== undefined && resolvedAt > now ? 1 : 0,
    labelLeakage: 0,
    lateResolutions: resolvedAt !== undefined && resolvedAt > prediction.resolveBy ? 1 : 0,
    contradictoryEvidence: 0,
    uncertainProxy: 0,
  };
  if (!provenance) return quality;
  const inspected = inspectPersistedProvenance(
    provenance,
    prediction.resolutionNote,
  );
  if (!inspected.valid) {
    quality.malformed = 1;
  }
  if (hasLeakedEvidence(
    prediction,
    inspected.kind,
    inspected.evidence,
    resolvedAt,
  )) {
    quality.labelLeakage = 1;
  }
  if (inspected.evidence.some((item) => item.supportsOutcome === false)) {
    quality.contradictoryEvidence = 1;
  }
  if (
    inspected.kind === 'proxy'
    && (
      uniqueEvidenceSources(inspected.evidence).size < 2
      || inspected.evidence.some((item) => item.supportsOutcome !== true)
    )
  ) {
    quality.uncertainProxy = 1;
  }
  return quality;
}

interface InspectedProvenance {
  kind: ResolutionProvenance['kind'] | null;
  evidence: readonly ResolutionEvidence[];
  valid: boolean;
}

function inspectPersistedProvenance(
  value: unknown,
  note: unknown,
): InspectedProvenance {
  const provenance = objectRecord(value);
  const kind = resolutionKind(provenance?.kind);
  const rawEvidence = unknownArray(provenance?.evidence);
  const evidence = rawEvidence?.filter((item) => isResolutionEvidence(item)) ?? [];
  const directEvidencePresent = kind !== 'direct' || evidence.length > 0;
  return {
    kind,
    evidence,
    valid:
      validResolver(provenance?.resolverId, kind)
      && validNote(note, kind)
      && rawEvidence !== null
      && rawEvidence.length <= MAX_EVIDENCE
      && directEvidencePresent
      && evidence.length === rawEvidence.length,
  };
}

function hasLeakedEvidence(
  prediction: PredictionRecord,
  kind: ResolutionProvenance['kind'] | null,
  evidence: readonly ResolutionEvidence[],
  resolvedAt: number | undefined,
): boolean {
  return evidence.some((item) =>
    evidenceLeaks(prediction, kind, item, resolvedAt));
}

function duplicateOutcomeIds(
  predictions: readonly PredictionRecord[],
): Set<string> {
  const groups = new Map<string, PredictionRecord[]>();
  for (const prediction of predictions) {
    if (!isResolved(prediction) || !prediction.targetKey) continue;
    const key = [
      prediction.sourceId,
      prediction.targetKey,
      prediction.domain,
      prediction.algorithmVersion ?? '',
      prediction.predictedAt,
      prediction.resolveBy,
    ].join('\u0000');
    const group = groups.get(key) ?? [];
    group.push(prediction);
    groups.set(key, group);
  }
  const duplicates = new Set<string>();
  for (const group of groups.values()) {
    const sorted = [...group];
    sorted.sort((a, b) => a.id.localeCompare(b.id));
    for (const prediction of sorted.slice(1)) duplicates.add(prediction.id);
  }
  return duplicates;
}

function evidenceIdentity(item: ResolutionEvidence): string {
  const sourceIds = [...item.sourceIds];
  sourceIds.sort((a, b) => a.localeCompare(b));
  return [
    sourceIds.join(','),
    item.observedAt,
    item.reference ?? '',
    item.value ?? '',
  ].join('\u0000');
}

function uniqueEvidenceSources(
  evidence: readonly ResolutionEvidence[],
): Set<string> {
  return new Set(evidence.flatMap((item) => item.sourceIds));
}

function resolutionOrigin(
  prediction: PredictionRecord,
): keyof ResolutionOriginCounts {
  if (prediction.resolutionProvenance?.kind === 'direct') return 'direct';
  if (prediction.resolutionProvenance?.kind === 'proxy') return 'proxy';
  if (prediction.resolutionNote?.startsWith('direct:')) return 'direct';
  if (prediction.resolutionNote?.startsWith('proxy:')) return 'proxy';
  return 'manual';
}

function isResolved(prediction: PredictionRecord): boolean {
  return prediction.status === 'resolved_true'
    || prediction.status === 'resolved_false';
}

function domainRow(
  rows: Map<PredictionRecord['domain'], MutableDomainRow>,
  domain: PredictionRecord['domain'],
): MutableDomainRow {
  const existing = rows.get(domain);
  if (existing) return existing;
  const row: MutableDomainRow = {
    domain,
    total: 0,
    resolved: 0,
    resolutionCoverage: 0,
    origins: freshOrigins(),
    malformed: 0,
    labelLeakage: 0,
    duplicateOutcomes: 0,
    lateResolutions: 0,
    contradictoryEvidence: 0,
    uncertainProxy: 0,
  };
  rows.set(domain, row);
  return row;
}

function freshOrigins(): ResolutionOriginCounts {
  return { direct: 0, proxy: 0, manual: 0 };
}

function addQuality(target: QualityCounts, quality: QualityCounts): void {
  target.malformed += quality.malformed;
  target.labelLeakage += quality.labelLeakage;
  target.lateResolutions += quality.lateResolutions;
  target.contradictoryEvidence += quality.contradictoryEvidence;
  target.uncertainProxy += quality.uncertainProxy;
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 1000;
}

function validResolutionTime(
  prediction: PredictionRecord,
  resolvedAt: number,
): boolean {
  return Number.isFinite(resolvedAt) && resolvedAt >= prediction.predictedAt;
}

function evidenceLeaks(
  prediction: PredictionRecord,
  kind: ResolutionProvenance['kind'] | null,
  evidence: ResolutionEvidence,
  resolvedAt: number | undefined,
): boolean {
  return evidence.observedAt < prediction.predictedAt
    || (resolvedAt !== undefined && evidence.observedAt > resolvedAt)
    || (kind === 'direct' && evidence.observedAt > prediction.resolveBy);
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function unknownArray(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? value as readonly unknown[] : null;
}

function resolutionKind(
  value: unknown,
): ResolutionProvenance['kind'] | null {
  return value === 'direct' || value === 'proxy' ? value : null;
}

function validResolver(
  resolverId: unknown,
  kind: ResolutionProvenance['kind'] | null,
): resolverId is string {
  return kind !== null
    && typeof resolverId === 'string'
    && RESOLVER_ID.test(resolverId);
}

function validNote(
  note: unknown,
  kind: ResolutionProvenance['kind'] | null,
): note is string {
  return kind !== null
    && typeof note === 'string'
    && note.length > 0
    && note.length <= 2048
    && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(note)
    && note.startsWith(`${kind}:`);
}

function isResolutionEvidence(value: unknown): value is ResolutionEvidence {
  const evidence = objectRecord(value);
  if (!evidence) return false;
  return validSourceIds(evidence.sourceIds)
    && typeof evidence.observedAt === 'number'
    && Number.isFinite(evidence.observedAt)
    && validOptionalNumber(evidence.value)
    && validReference(evidence.reference)
    && validOptionalBoolean(evidence.supportsOutcome);
}

function validSourceIds(value: unknown): value is readonly string[] {
  const sourceIds = unknownArray(value);
  return sourceIds !== null
    && sourceIds.length > 0
    && sourceIds.length <= 16
    && new Set(sourceIds).size === sourceIds.length
    && sourceIds.every((sourceId) =>
      typeof sourceId === 'string' && SOURCE_ID.test(sourceId));
}

function validOptionalNumber(value: unknown): boolean {
  return value === undefined
    || (typeof value === 'number' && Number.isFinite(value));
}

function validReference(value: unknown): boolean {
  return value === undefined
    || (
      typeof value === 'string'
      && value.length > 0
      && value.length <= 512
      && !/[\u0000-\u001F\u007F]/.test(value)
    );
}

function validOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}
