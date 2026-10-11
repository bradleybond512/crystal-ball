/**
 * Validation for the persisted forecast-calibration blob
 * (`crystalball-forecast-calibration-v1`).
 *
 * Records are rebuilt from known top-level fields and capped to the newest
 * `max` records. Resolved rows with invalid present structured metadata are
 * dropped; genuinely absent legacy metadata remains compatible. Pending and
 * expired metadata is normalized only enough to keep store cloning safe.
 * Nested shape checks preserve audit-visible fields, not certify their quality.
 */

import type { PredictionRecord, PredictionStatus, ResolutionCriteria, ResolutionProvenance } from './forecast-calibration';
import type { FactDomain } from './types';

const STATUSES: ReadonlySet<string> = new Set(['pending', 'resolved_true', 'resolved_false', 'expired']);
const CRITERIA_KINDS: ReadonlySet<string> = new Set(['market_move', 'event_occurrence', 'warning_verification']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function arrayOf<T>(value: unknown, valid: (entry: unknown) => entry is T): value is T[] {
  return Array.isArray(value) && value.every((entry) => valid(entry));
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function optional(value: Record<string, unknown>, key: string, valid: (entry: unknown) => boolean): boolean {
  return !hasOwn(value, key) || valid(value[key]);
}

function isCoordinate(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every((entry) => finite(entry));
}

function isRing(value: unknown): value is [number, number][] {
  return arrayOf(value, isCoordinate);
}

function parseCriteria(value: unknown): ResolutionCriteria | undefined {
  if (!isObject(value) || typeof value.kind !== 'string' || !CRITERIA_KINDS.has(value.kind)) return undefined;
  if (value.kind === 'event_occurrence'
    && !['domains', 'eventTypes', 'entitySlugs'].every((key) => arrayOf(value[key], isString))) return undefined;
  if (value.kind === 'warning_verification'
    && (!isObject(value.polygon) || !arrayOf(value.polygon.rings, isRing) || !arrayOf(value.reportTypes, isString))) return undefined;
  return value as unknown as ResolutionCriteria;
}

function isCloneSafeEvidence(value: unknown): value is Record<string, unknown> {
  return isObject(value) && arrayOf(value.sourceIds, isString);
}

function isResolvedEvidence(value: unknown): value is Record<string, unknown> {
  return isCloneSafeEvidence(value)
    && finite(value.observedAt)
    && optional(value, 'value', finite)
    && optional(value, 'reference', isString)
    && optional(value, 'supportsOutcome', (entry) => typeof entry === 'boolean');
}

function parseProvenance(value: unknown, resolved: boolean): ResolutionProvenance | undefined {
  if (!isObject(value)) return undefined;
  if (typeof value.resolverId !== 'string') return undefined;
  if (value.kind !== 'direct' && value.kind !== 'proxy') return undefined;
  if (resolved && !arrayOf(value.evidence, isResolvedEvidence)) return undefined;
  const evidence = Array.isArray(value.evidence) ? value.evidence.filter((entry) => isCloneSafeEvidence(entry)) : [];
  return { ...value, resolverId: value.resolverId, kind: value.kind, evidence: evidence as unknown as ResolutionProvenance['evidence'] };
}

/** Rebuild one persisted record from its known fields, or null when invalid. */
export function parsePersistedPrediction(value: unknown): PredictionRecord | null {
  if (!isObject(value)) return null;
  const { id, sourceId, domain, claim, probability, predictedAt, resolveBy, status } = value;
  if (!nonEmpty(id) || !nonEmpty(sourceId) || !nonEmpty(domain) || typeof claim !== 'string') return null;
  if (!finite(probability) || probability < 0 || probability > 1) return null;
  if (!finite(predictedAt) || !finite(resolveBy)) return null;
  if (typeof status !== 'string' || !STATUSES.has(status)) return null;

  const resolved = status === 'resolved_true' || status === 'resolved_false';
  const criteria = parseCriteria(value.criteria);
  const provenance = parseProvenance(value.resolutionProvenance, resolved);
  if (resolved && hasOwn(value, 'criteria') && !criteria) return null;
  if (resolved && hasOwn(value, 'resolutionProvenance') && !provenance) return null;

  const record: PredictionRecord = {
    id,
    sourceId,
    domain: domain as FactDomain,
    claim,
    probability,
    predictedAt,
    resolveBy,
    status: status as PredictionStatus,
  };
  if (typeof value.targetKey === 'string') record.targetKey = value.targetKey;
  if (criteria) record.criteria = criteria;
  if (finite(value.resolvedAt)) record.resolvedAt = value.resolvedAt;
  if (typeof value.resolutionNote === 'string') record.resolutionNote = value.resolutionNote;
  if (provenance) record.resolutionProvenance = provenance;
  if (typeof value.algorithmVersion === 'string') record.algorithmVersion = value.algorithmVersion;
  return record;
}

/** Parse the whole persisted array: valid records only, newest `max` by predictedAt. */
export function parsePersistedPredictions(raw: unknown, max: number): PredictionRecord[] {
  if (!Array.isArray(raw)) return [];
  const records = raw
    .map((entry) => parsePersistedPrediction(entry))
    .filter((record): record is PredictionRecord => record !== null)
    .sort((a, b) => a.predictedAt - b.predictedAt);
  return records.slice(Math.max(0, records.length - max));
}
