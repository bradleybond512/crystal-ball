import type { PredictionRecord } from '../intelligence/forecast-calibration';
import { getAlgorithm } from './algorithm-registry';
import type {
  AlgorithmEvaluationLedger,
  EvaluationRecord,
  ForecastEvaluationTarget,
  OutcomeLabelOrigin,
} from './algorithm-evaluation-ledger';
import { getAlgorithmEvaluationLedger } from './algorithms-state';

const MAX_PREDICTION_ID_LENGTH = 768;
const MAX_TARGET_KEY_LENGTH = 768;
const MAX_VERSION_LENGTH = 128;
const MAX_REFERENCE_LENGTH = 128;
const FNV_OFFSET_64 = 0xCB_F2_9C_E4_84_22_23_25n;
const FNV_PRIME_64 = 0x01_00_00_00_01_B3n;
const FNV_MASK_64 = 0xFF_FF_FF_FF_FF_FF_FF_FFn;

interface PreparedForecastEvaluation {
  id: string;
  algorithmId: string;
  domain: EvaluationRecord['domain'];
  version: string;
  target: ForecastEvaluationTarget;
}

export interface ForecastEvaluationSyncResult {
  eligible: number;
  linked: number;
  graded: number;
  alreadyLinked: number;
  alreadyGraded: number;
}

export function ensureForecastEvaluation(
  prediction: PredictionRecord,
  ledger: AlgorithmEvaluationLedger = getAlgorithmEvaluationLedger(),
): EvaluationRecord | null {
  const prepared = prepareForecastEvaluation(prediction);
  if (!prepared) return null;

  const samePrediction = ledger.all().find(
    (record) =>
      record.forecastTarget?.predictionId === prepared.target.predictionId,
  );
  if (samePrediction) {
    return evaluationMatches(samePrediction, prepared)
      ? samePrediction
      : null;
  }

  const existing = ledger.get(prepared.id);
  if (existing) {
    return evaluationMatches(existing, prepared) ? existing : null;
  }

  try {
    return ledger.recordEvaluation({
      id: prepared.id,
      algorithmId: prepared.algorithmId,
      domain: prepared.domain,
      version: prepared.version,
      at: prediction.predictedAt,
      durationMs: 0,
      score: prediction.probability,
      label: prediction.probability >= 0.5
        ? 'forecast-likely'
        : 'forecast-unlikely',
      forecastTarget: prepared.target,
    });
  } catch {
    return null;
  }
}

export function gradeForecastOutcome(
  prediction: PredictionRecord,
  ledger: AlgorithmEvaluationLedger = getAlgorithmEvaluationLedger(),
): EvaluationRecord | null {
  if (
    prediction.status !== 'resolved_true'
    && prediction.status !== 'resolved_false'
  ) {
    return null;
  }
  if (
    typeof prediction.resolvedAt !== 'number'
    || !Number.isFinite(prediction.resolvedAt)
  ) {
    return null;
  }

  const record = ensureForecastEvaluation(prediction, ledger);
  if (!record || record.outcome !== undefined || !record.forecastTarget || !record.version) {
    return record;
  }

  const materialized = prediction.status === 'resolved_true';
  const forecastLikely = prediction.probability >= 0.5;
  const outcome = forecastLikely === materialized ? 'hit' : 'miss';
  const origin = labelOriginFor(prediction);
  const reference = boundedReference(
    prediction.resolutionProvenance?.resolverId,
  );

  try {
    return ledger.recordOutcome(
      record.id,
      outcome,
      `forecast ${forecastLikely ? 'likely' : 'unlikely'} at ${formatProbability(prediction.probability)}; outcome ${materialized ? 'materialized' : 'did not materialize'}`,
      prediction.resolvedAt,
      {
        origin,
        algorithmVersion: prediction.algorithmVersion!,
        forecastTarget: record.forecastTarget,
        reference,
      },
    );
  } catch {
    return null;
  }
}

export function syncForecastEvaluations(
  predictions: readonly PredictionRecord[],
  ledger: AlgorithmEvaluationLedger = getAlgorithmEvaluationLedger(),
): ForecastEvaluationSyncResult {
  const result: ForecastEvaluationSyncResult = {
    eligible: 0,
    linked: 0,
    graded: 0,
    alreadyLinked: 0,
    alreadyGraded: 0,
  };

  for (const prediction of predictions) {
    const prepared = prepareForecastEvaluation(prediction);
    if (!prepared) continue;
    result.eligible += 1;

    const existing = ledger.get(prepared.id);
    const record = ensureForecastEvaluation(prediction, ledger);
    if (!record) continue;
    if (existing) result.alreadyLinked += 1;
    else result.linked += 1;

    if (
      prediction.status !== 'resolved_true'
      && prediction.status !== 'resolved_false'
    ) {
      continue;
    }
    if (record.outcome !== undefined) {
      result.alreadyGraded += 1;
      continue;
    }
    if (gradeForecastOutcome(prediction, ledger)?.outcome !== undefined) {
      result.graded += 1;
    }
  }
  return result;
}

function prepareForecastEvaluation(
  prediction: PredictionRecord,
): PreparedForecastEvaluation | null {
  const algorithmId = algorithmIdForSource(prediction.sourceId);
  const definition = algorithmId ? getAlgorithm(algorithmId) : undefined;
  if (!algorithmId || !definition?.healthDomain) return null;
  if (
    typeof prediction.targetKey !== 'string'
    || prediction.targetKey.length === 0
    || prediction.targetKey.length > MAX_TARGET_KEY_LENGTH
    || typeof prediction.algorithmVersion !== 'string'
    || prediction.algorithmVersion.length === 0
    || prediction.algorithmVersion.length > MAX_VERSION_LENGTH
    || prediction.id.length === 0
    || prediction.id.length > MAX_PREDICTION_ID_LENGTH
    || !Number.isFinite(prediction.predictedAt)
    || !Number.isFinite(prediction.resolveBy)
    || prediction.resolveBy < prediction.predictedAt
    || !Number.isFinite(prediction.probability)
    || prediction.probability < 0
    || prediction.probability > 1
  ) {
    return null;
  }

  const target: ForecastEvaluationTarget = {
    predictionId: prediction.id,
    targetKey: prediction.targetKey,
    predictedAt: prediction.predictedAt,
    resolveBy: prediction.resolveBy,
  };
  return {
    id: `forecast-eval:${fnv1a64([
      algorithmId,
      prediction.algorithmVersion,
      target.predictionId,
      target.targetKey,
      String(target.predictedAt),
      String(target.resolveBy),
    ].join('\u0000'))}`,
    algorithmId,
    domain: definition.healthDomain,
    version: prediction.algorithmVersion,
    target,
  };
}

function evaluationMatches(
  record: EvaluationRecord,
  expected: PreparedForecastEvaluation,
): boolean {
  const target = record.forecastTarget;
  return record.algorithmId === expected.algorithmId
    && record.domain === expected.domain
    && record.version === expected.version
    && target?.predictionId === expected.target.predictionId
    && target.targetKey === expected.target.targetKey
    && target.predictedAt === expected.target.predictedAt
    && target.resolveBy === expected.target.resolveBy;
}

function algorithmIdForSource(sourceId: string): string | null {
  if (sourceId === 'analyst-loop') return 'analyst-loop';
  if (sourceId === 'superforecast') return 'superforecast';
  if (sourceId === 'nws-warning') return 'warning-verification';
  if (sourceId.startsWith('mode-forecast:')) return 'mode-forecast';
  if (sourceId.startsWith('shortage:')) {
    return `shortage-${sourceId.slice('shortage:'.length)}`;
  }
  return getAlgorithm(sourceId) ? sourceId : null;
}

function labelOriginFor(prediction: PredictionRecord): OutcomeLabelOrigin {
  return prediction.resolutionProvenance?.kind ?? 'manual';
}

function boundedReference(reference: string | undefined): string | undefined {
  if (!reference) return undefined;
  return reference.slice(0, MAX_REFERENCE_LENGTH);
}

function formatProbability(probability: number): string {
  return `${Math.round(probability * 1000) / 10}%`;
}

function fnv1a64(input: string): string {
  let hash = FNV_OFFSET_64;
  for (const character of input) {
    hash ^= BigInt(character.codePointAt(0)!);
    hash = (hash * FNV_PRIME_64) & FNV_MASK_64;
  }
  return hash.toString(16).padStart(16, '0');
}
