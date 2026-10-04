/**
 * Validation for the persisted forecast-calibration blob
 * (`crystalball-forecast-calibration-v1`).
 *
 * The adapter used to cast whatever `localStorage` held straight to
 * `PredictionRecord[]`. A corrupt or tampered entry (NaN probability, an
 * unknown status, a string where a number belongs) then flowed into Brier
 * scores, champion/challenger gates and resolver inputs. Each entry is now
 * rebuilt from known fields only; invalid entries are dropped, unknown fields
 * never survive, and the result is capped to the newest `max` records.
 */

import type { PredictionRecord, PredictionStatus, ResolutionCriteria, ResolutionProvenance } from './forecast-calibration';
import type { FactDomain } from './types';

const STATUSES: ReadonlySet<string> = new Set(['pending', 'resolved_true', 'resolved_false', 'expired']);
const CRITERIA_KINDS: ReadonlySet<string> = new Set(['market_move', 'event_occurrence', 'warning_verification']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseProvenance(value: unknown): ResolutionProvenance | undefined {
  if (!isObject(value)) return undefined;
  if (typeof value.resolverId !== 'string') return undefined;
  if (value.kind !== 'direct' && value.kind !== 'proxy') return undefined;
  const evidence = Array.isArray(value.evidence) ? value.evidence.filter((entry) => isObject(entry)) : [];
  return { resolverId: value.resolverId, kind: value.kind, evidence: evidence as unknown as ResolutionProvenance['evidence'] };
}

/** Rebuild one persisted record from its known fields, or null when invalid. */
export function parsePersistedPrediction(value: unknown): PredictionRecord | null {
  if (!isObject(value)) return null;
  const { id, sourceId, domain, claim, probability, predictedAt, resolveBy, status } = value;
  if (!nonEmpty(id) || !nonEmpty(sourceId) || !nonEmpty(domain) || typeof claim !== 'string') return null;
  if (!finite(probability) || probability < 0 || probability > 1) return null;
  if (!finite(predictedAt) || !finite(resolveBy)) return null;
  if (typeof status !== 'string' || !STATUSES.has(status)) return null;

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
  if (isObject(value.criteria) && typeof value.criteria.kind === 'string' && CRITERIA_KINDS.has(value.criteria.kind)) {
    record.criteria = value.criteria as unknown as ResolutionCriteria;
  }
  if (finite(value.resolvedAt)) record.resolvedAt = value.resolvedAt;
  if (typeof value.resolutionNote === 'string') record.resolutionNote = value.resolutionNote;
  const provenance = parseProvenance(value.resolutionProvenance);
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
