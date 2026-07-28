import type { PredictionRecord } from './forecast-calibration';
import { horizonBucket } from './forecast-evaluation';
import { isBaselineSourceId } from './baseline-model-ids';

export const HIERARCHICAL_BASE_RATE_SOURCE_ID = 'hierarchical-base-rate';
export const HIERARCHICAL_BASE_RATE_VERSION = '1.0.0';

const MIN_GLOBAL_RESOLVED = 30;
const MIN_DOMAIN_RESOLVED = 20;
const DOMAIN_PRIOR_STRENGTH = 200;
const MIN_HORIZON_RESOLVED = 10;
const HORIZON_PRIOR_STRENGTH = 5;
const BETA_PRIOR_ALPHA = 1;
const BETA_PRIOR_BETA = 1;
const FNV_OFFSET_64 = 0xCB_F2_9C_E4_84_22_23_25n;
const FNV_PRIME_64 = 0x01_00_00_00_01_B3n;
const FNV_MASK_64 = 0xFF_FF_FF_FF_FF_FF_FF_FFn;

export interface HierarchicalBaseRateOptions {
  minGlobalResolved?: number;
}

export interface HierarchicalBaseRateEstimate {
  probability: number;
  globalProbability: number;
}

export function buildHierarchicalBaseRatePrediction(
  target: PredictionRecord,
  history: readonly PredictionRecord[],
  options: HierarchicalBaseRateOptions = {},
): PredictionRecord | null {
  const estimate = estimateHierarchicalBaseRate(target, history, options);
  if (!estimate) return null;
  return {
    ...target,
    id: `base-rate:${fnv1a64([
      target.targetKey!,
      target.domain,
      String(target.predictedAt),
      String(target.resolveBy),
    ].join('\u0000'))}`,
    sourceId: HIERARCHICAL_BASE_RATE_SOURCE_ID,
    probability: estimate.probability,
    algorithmVersion: HIERARCHICAL_BASE_RATE_VERSION,
  };
}

export function estimateHierarchicalBaseRate(
  target: PredictionRecord,
  history: readonly PredictionRecord[],
  options: HierarchicalBaseRateOptions = {},
): HierarchicalBaseRateEstimate | null {
  if (
    target.status !== 'pending'
    || !target.targetKey
    || isBaselineSourceId(target.sourceId)
    || !Number.isFinite(target.predictedAt)
    || !Number.isFinite(target.resolveBy)
    || target.resolveBy <= target.predictedAt
  ) {
    return null;
  }
  const outcomes = deduplicateOutcomes(
    history.filter(
      (record) =>
        // Never train on ANY baseline model's records (ACC-302 widened
        // this from self-exclusion to the shared family exclusion —
        // corpus-neutral: no baseline-sourced fixtures exist).
        !isBaselineSourceId(record.sourceId)
        && resolvedOutcome(record) !== null
        && !isProxyResolution(record)
        && Number.isFinite(record.predictedAt)
        && Number.isFinite(record.resolveBy)
        && record.resolveBy > record.predictedAt
        && record.predictedAt < target.predictedAt
        && record.resolvedAt !== undefined
        && Number.isFinite(record.resolvedAt)
        && record.resolvedAt >= record.predictedAt
        && record.resolvedAt < target.predictedAt
        && evidenceAvailableBefore(record, target.predictedAt),
    ),
  );
  const minGlobalResolved = positiveInteger(
    options.minGlobalResolved,
    MIN_GLOBAL_RESOLVED,
  );
  if (outcomes.length < minGlobalResolved) return null;
  const positives = outcomes.reduce(
    (total, record) => total + (resolvedOutcome(record) ?? 0),
    0,
  );
  const globalProbability = (
    positives + BETA_PRIOR_ALPHA
  ) / (
    outcomes.length + BETA_PRIOR_ALPHA + BETA_PRIOR_BETA
  );
  const domainOutcomes = outcomes.filter(
    (record) => record.domain === target.domain,
  );
  let probability = globalProbability;
  if (domainOutcomes.length >= MIN_DOMAIN_RESOLVED) {
    const domainPositives = domainOutcomes.reduce(
      (total, record) => total + (resolvedOutcome(record) ?? 0),
      0,
    );
    const domainProbability = (
      domainPositives + globalProbability * DOMAIN_PRIOR_STRENGTH
    ) / (
      domainOutcomes.length + DOMAIN_PRIOR_STRENGTH
    );
    const targetHorizon = horizonBucket(target.resolveBy - target.predictedAt);
    const horizonOutcomes = domainOutcomes.filter(
      (record) =>
        horizonBucket(record.resolveBy - record.predictedAt) === targetHorizon,
    );
    if (horizonOutcomes.length < MIN_HORIZON_RESOLVED) {
      probability = domainProbability;
    } else {
      const horizonPositives = horizonOutcomes.reduce(
        (total, record) => total + (resolvedOutcome(record) ?? 0),
        0,
      );
      probability = (
        horizonPositives + domainProbability * HORIZON_PRIOR_STRENGTH
      ) / (
        horizonOutcomes.length + HORIZON_PRIOR_STRENGTH
      );
    }
  }
  return {
    probability,
    globalProbability,
  };
}

function deduplicateOutcomes(
  records: readonly PredictionRecord[],
): PredictionRecord[] {
  const unique = new Map<string, PredictionRecord | null>();
  for (const record of records) {
    const key = `${record.targetKey ?? record.id}\u0000${record.resolveBy}`;
    if (!unique.has(key)) {
      unique.set(key, record);
      continue;
    }
    const existing = unique.get(key);
    if (
      existing
      && resolvedOutcome(existing) !== resolvedOutcome(record)
    ) {
      unique.set(key, null);
    }
  }
  return [...unique.values()].filter(
    (record): record is PredictionRecord => record !== null,
  );
}

function resolvedOutcome(record: PredictionRecord): 0 | 1 | null {
  if (record.status === 'resolved_true') return 1;
  if (record.status === 'resolved_false') return 0;
  return null;
}

function isProxyResolution(record: PredictionRecord): boolean {
  return record.resolutionProvenance?.kind === 'proxy'
    || record.resolutionNote?.startsWith('proxy:') === true;
}

function evidenceAvailableBefore(
  record: PredictionRecord,
  cutoff: number,
): boolean {
  const provenance = record.resolutionProvenance;
  if (!provenance) return true;
  return provenance.evidence.length > 0
    && provenance.evidence.every(
      (evidence) =>
        Number.isFinite(evidence.observedAt)
        && evidence.observedAt < cutoff,
    );
}

export function fnv1a64(input: string): string {
  let hash = FNV_OFFSET_64;
  for (const character of input) {
    hash ^= BigInt(character.codePointAt(0)!);
    hash = (hash * FNV_PRIME_64) & FNV_MASK_64;
  }
  return hash.toString(16).padStart(16, '0');
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}
