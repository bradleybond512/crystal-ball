import type { PredictionRecord } from './forecast-calibration';
import {
  reliabilityDiagram,
  type ReliabilityPoint,
} from './proper-scoring';

export interface EvaluationForecast {
  probability: number;
  outcome: 0 | 1;
}

export interface ScoredForecast extends EvaluationForecast {
  id: string;
  targetKey?: string;
  sourceId: string;
  domain: PredictionRecord['domain'];
  predictedAt: number;
  resolveBy: number;
  resolvedAt?: number;
  algorithmVersion?: string;
  brierContribution: number;
  logLossContribution: number;
}

export type EvidenceMetric =
  | {
      status: 'ok';
      sampleSize: number;
      value: number;
    }
  | {
      status: 'insufficient_evidence';
      sampleSize: number;
      minSampleSize: number;
      reason?: string;
    };

export type BrierSkillMetric =
  | {
      status: 'ok';
      sampleSize: number;
      value: number;
      forecastBrier: number;
      baselineBrier: number;
      baselineProbability: number;
    }
  | {
      status: 'insufficient_evidence';
      sampleSize: number;
      minSampleSize: number;
      reason?: string;
    };

export type EqualMassEceMetric =
  | {
      status: 'ok';
      sampleSize: number;
      value: number;
      bins: readonly ReliabilityPoint[];
    }
  | {
      status: 'insufficient_evidence';
      sampleSize: number;
      minSampleSize: number;
      reason?: string;
    };

export type CalibrationFit =
  | {
      status: 'ok';
      sampleSize: number;
      intercept: number;
      slope: number;
      iterations: number;
      converged: true;
    }
  | {
      status: 'insufficient_evidence';
      sampleSize: number;
      minSampleSize: number;
      reason:
        | 'sample_floor'
        | 'degenerate_outcomes'
        | 'degenerate_probabilities'
        | 'singular_fit'
        | 'fit_failed';
    };

export interface ForecastCoverage {
  total: number;
  resolved: number;
  expired: number;
  pending: number;
  overduePending: number | null;
  resolutionCoverage: number;
  expirationRate: number;
  closedCoverage: number;
}

export interface ForecastCohortInput {
  trainingRecords: readonly PredictionRecord[];
  evaluationRecords: readonly PredictionRecord[];
}

export interface ForecastEvaluationOptions {
  includeProxyLabels?: boolean;
  minResolved?: number;
  minTrainingResolved?: number;
  minCalibrationFit?: number;
  binCount?: number;
  logLossEpsilon?: number;
  now?: number;
}

export interface ForecastCohortEvaluation {
  evaluationWindowStart?: number;
  scoredRecords: readonly ScoredForecast[];
  trainingSampleSize: number;
  exclusions: {
    proxyLabels: number;
    invalidProbabilities: number;
    trainingWindowOverlap: number;
    trainingProxyLabels: number;
    trainingInvalidProbabilities: number;
  };
  coverage: ForecastCoverage;
  brier: EvidenceMetric;
  logLoss: EvidenceMetric;
  baseRate: EvidenceMetric;
  brierSkill: BrierSkillMetric;
  equalMassEce: EqualMassEceMetric;
  calibrationFit: CalibrationFit;
}

export type ForecastGroupDimension =
  | 'target'
  | 'source'
  | 'domain'
  | 'horizon'
  | 'algorithmVersion';

export interface ForecastGroupEvaluation {
  key: string;
  evaluation: ForecastCohortEvaluation;
}

export interface ForecastEvaluationReport {
  overall: ForecastCohortEvaluation;
  groups: {
    byTarget: readonly ForecastGroupEvaluation[];
    bySource: readonly ForecastGroupEvaluation[];
    byDomain: readonly ForecastGroupEvaluation[];
    byHorizon: readonly ForecastGroupEvaluation[];
    byAlgorithmVersion: readonly ForecastGroupEvaluation[];
  };
}

export interface PairedMetricSample {
  incumbent: number;
  challenger: number;
}

export interface PairedBootstrapOptions {
  seed?: number;
  iterations?: number;
  confidenceLevel?: number;
  minPairs?: number;
}

export type PairedBootstrapResult =
  | {
      status: 'ok';
      sampleSize: number;
      meanDifference: number;
      lowerBound: number;
      upperBound: number;
      confidenceLevel: number;
      iterations: number;
      seed: number;
    }
  | {
      status: 'insufficient_evidence';
      sampleSize: number;
      minSampleSize: number;
    };

const DEFAULT_MIN_RESOLVED = 20;
const DEFAULT_MIN_TRAINING_RESOLVED = 20;
const DEFAULT_MIN_CALIBRATION_FIT = 50;
const DEFAULT_BIN_COUNT = 10;
const DEFAULT_LOG_LOSS_EPSILON = 1e-6;
const DEFAULT_BOOTSTRAP_ITERATIONS = 2000;
const DEFAULT_BOOTSTRAP_SEED = 0x43_52_59_53;
const DEFAULT_MIN_PAIRS = 30;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export function brierContribution(probability: number, outcome: 0 | 1): number {
  return (clamp01(probability) - outcome) ** 2;
}

export function binaryLogLossContribution(
  probability: number,
  outcome: 0 | 1,
  epsilon = DEFAULT_LOG_LOSS_EPSILON,
): number {
  const clip = validEpsilon(epsilon);
  const probabilityClipped = Math.max(clip, Math.min(1 - clip, clamp01(probability)));
  return outcome === 1
    ? -Math.log(probabilityClipped)
    : -Math.log(1 - probabilityClipped);
}

export function meanBrierScore(
  forecasts: readonly EvaluationForecast[],
  minSamples = DEFAULT_MIN_RESOLVED,
): EvidenceMetric {
  const valid = validForecasts(forecasts);
  const floor = sampleFloor(minSamples, DEFAULT_MIN_RESOLVED);
  if (valid.length < floor) return insufficient(valid.length, floor);
  return {
    status: 'ok',
    sampleSize: valid.length,
    value: mean(valid.map((item) => brierContribution(item.probability, item.outcome))),
  };
}

export function meanBinaryLogLoss(
  forecasts: readonly EvaluationForecast[],
  options: { minSamples?: number; epsilon?: number } = {},
): EvidenceMetric {
  const valid = validForecasts(forecasts);
  const floor = sampleFloor(options.minSamples, DEFAULT_MIN_RESOLVED);
  if (valid.length < floor) return insufficient(valid.length, floor);
  return {
    status: 'ok',
    sampleSize: valid.length,
    value: mean(valid.map((item) =>
      binaryLogLossContribution(item.probability, item.outcome, options.epsilon))),
  };
}

export function empiricalBaseRate(
  forecasts: readonly EvaluationForecast[],
  minSamples = DEFAULT_MIN_TRAINING_RESOLVED,
): EvidenceMetric {
  const valid = validForecasts(forecasts);
  const floor = sampleFloor(minSamples, DEFAULT_MIN_TRAINING_RESOLVED);
  if (valid.length < floor) return insufficient(valid.length, floor);
  return {
    status: 'ok',
    sampleSize: valid.length,
    value: mean(valid.map((item) => item.outcome)),
  };
}

export function brierSkillScore(
  forecasts: readonly EvaluationForecast[],
  baselineProbability: number,
  minSamples = DEFAULT_MIN_RESOLVED,
): BrierSkillMetric {
  const valid = validForecasts(forecasts);
  const floor = sampleFloor(minSamples, DEFAULT_MIN_RESOLVED);
  if (valid.length < floor) return insufficient(valid.length, floor);
  if (!Number.isFinite(baselineProbability)) {
    return { ...insufficient(valid.length, floor), reason: 'invalid_baseline' };
  }
  const baseline = clamp01(baselineProbability);
  const forecastBrier = mean(
    valid.map((item) => brierContribution(item.probability, item.outcome)),
  );
  const baselineBrier = mean(
    valid.map((item) => brierContribution(baseline, item.outcome)),
  );
  if (baselineBrier <= Number.EPSILON) {
    return {
      ...insufficient(valid.length, floor),
      reason: 'zero_baseline_error',
    };
  }
  return {
    status: 'ok',
    sampleSize: valid.length,
    value: 1 - forecastBrier / baselineBrier,
    forecastBrier,
    baselineBrier,
    baselineProbability: baseline,
  };
}

export function equalMassExpectedCalibrationError(
  forecasts: readonly EvaluationForecast[],
  options: { binCount?: number; minSamples?: number } = {},
): EqualMassEceMetric {
  const valid = validForecasts(forecasts);
  const floor = sampleFloor(options.minSamples, DEFAULT_MIN_RESOLVED);
  if (valid.length < floor) return insufficient(valid.length, floor);
  const bins = reliabilityDiagram(valid, {
    binCount: positiveInteger(options.binCount, DEFAULT_BIN_COUNT),
    mode: 'equal-mass',
  });
  const value = bins.reduce(
    (sum, bin) =>
      sum
      + (bin.count / valid.length)
        * Math.abs(bin.predictedMean - bin.observedFrequency),
    0,
  );
  return {
    status: 'ok',
    sampleSize: valid.length,
    value,
    bins,
  };
}

export function calibrationSlopeIntercept(
  forecasts: readonly EvaluationForecast[],
  options: {
    minSamples?: number;
    epsilon?: number;
    maxIterations?: number;
    tolerance?: number;
  } = {},
): CalibrationFit {
  const valid = validForecasts(forecasts);
  const floor = sampleFloor(options.minSamples, DEFAULT_MIN_CALIBRATION_FIT);
  if (valid.length < floor) {
    return {
      ...insufficient(valid.length, floor),
      reason: 'sample_floor',
    };
  }
  const outcomeSum = valid.reduce((sum, item) => sum + item.outcome, 0);
  if (outcomeSum === 0 || outcomeSum === valid.length) {
    return {
      ...insufficient(valid.length, floor),
      reason: 'degenerate_outcomes',
    };
  }

  const epsilon = validEpsilon(options.epsilon);
  const predictors = valid.map((item) => logit(item.probability, epsilon));
  if (variance(predictors) <= Number.EPSILON) {
    return {
      ...insufficient(valid.length, floor),
      reason: 'degenerate_probabilities',
    };
  }

  const maxIterations = positiveInteger(options.maxIterations, 100);
  const tolerance = positiveFinite(options.tolerance, 1e-10);
  let intercept = 0;
  let slope = 1;

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    let gradientIntercept = 0;
    let gradientSlope = 0;
    let hessianIntercept = 0;
    let hessianCross = 0;
    let hessianSlope = 0;

    for (const [index, forecast] of valid.entries()) {
      const predictor = predictors[index]!;
      const outcome = forecast.outcome;
      const fitted = sigmoid(intercept + slope * predictor);
      const residual = outcome - fitted;
      const weight = Math.max(fitted * (1 - fitted), 1e-12);
      gradientIntercept += residual;
      gradientSlope += predictor * residual;
      hessianIntercept += weight;
      hessianCross += weight * predictor;
      hessianSlope += weight * predictor * predictor;
    }

    const determinant =
      hessianIntercept * hessianSlope - hessianCross * hessianCross;
    if (!Number.isFinite(determinant) || Math.abs(determinant) <= 1e-14) {
      return {
        ...insufficient(valid.length, floor),
        reason: 'singular_fit',
      };
    }

    const interceptStep =
      (gradientIntercept * hessianSlope - gradientSlope * hessianCross)
      / determinant;
    const slopeStep =
      (gradientSlope * hessianIntercept - gradientIntercept * hessianCross)
      / determinant;
    intercept += interceptStep;
    slope += slopeStep;

    if (!Number.isFinite(intercept) || !Number.isFinite(slope)) {
      return {
        ...insufficient(valid.length, floor),
        reason: 'fit_failed',
      };
    }
    if (Math.max(Math.abs(interceptStep), Math.abs(slopeStep)) <= tolerance) {
      return {
        status: 'ok',
        sampleSize: valid.length,
        intercept,
        slope,
        iterations: iteration,
        converged: true,
      };
    }
  }

  return {
    ...insufficient(valid.length, floor),
    reason: 'fit_failed',
  };
}

export function forecastCoverage(
  records: readonly PredictionRecord[],
  now?: number,
): ForecastCoverage {
  let resolved = 0;
  let expired = 0;
  let pending = 0;
  const asOf = now !== undefined && Number.isFinite(now) ? now : null;
  let overduePending = 0;
  for (const record of records) {
    if (resolvedOutcome(record) !== null) resolved += 1;
    else if (record.status === 'expired') expired += 1;
    else if (record.status === 'pending') {
      pending += 1;
      if (asOf !== null && record.resolveBy < asOf) overduePending += 1;
    }
  }
  const total = records.length;
  return {
    total,
    resolved,
    expired,
    pending,
    overduePending: asOf === null ? null : overduePending,
    resolutionCoverage: ratio(resolved, total),
    expirationRate: ratio(expired, total),
    closedCoverage: ratio(resolved + expired, total),
  };
}

export function evaluateForecastCohort(
  input: ForecastCohortInput,
  options: ForecastEvaluationOptions = {},
): ForecastCohortEvaluation {
  const evaluationWindowStart = earliestPredictedAt(input.evaluationRecords);
  const trainingRecords = input.trainingRecords.filter(
    (record) =>
      evaluationWindowStart === undefined
      || recordAvailableBefore(record, evaluationWindowStart),
  );
  const scoringOptions = {
    includeProxyLabels: options.includeProxyLabels ?? false,
    epsilon: options.logLossEpsilon,
  };
  const evaluationProjection = scoreRecords(input.evaluationRecords, scoringOptions);
  const trainingProjection = scoreRecords(trainingRecords, scoringOptions);
  const evaluationForecasts = evaluationProjection.records;
  const trainingForecasts = trainingProjection.records;
  const minResolved = sampleFloor(options.minResolved, DEFAULT_MIN_RESOLVED);
  const minTraining = sampleFloor(
    options.minTrainingResolved,
    DEFAULT_MIN_TRAINING_RESOLVED,
  );
  const baseRate = empiricalBaseRate(trainingForecasts, minTraining);
  const brierSkill = baseRate.status === 'ok'
    ? brierSkillScore(evaluationForecasts, baseRate.value, minResolved)
    : {
        ...insufficient(evaluationForecasts.length, minResolved),
        reason: 'training_sample_floor',
      };

  return {
    evaluationWindowStart,
    scoredRecords: evaluationProjection.records,
    trainingSampleSize: trainingForecasts.length,
    exclusions: {
      proxyLabels: evaluationProjection.proxyLabels,
      invalidProbabilities: evaluationProjection.invalidProbabilities,
      trainingWindowOverlap:
        input.trainingRecords.length - trainingRecords.length,
      trainingProxyLabels: trainingProjection.proxyLabels,
      trainingInvalidProbabilities: trainingProjection.invalidProbabilities,
    },
    coverage: forecastCoverage(
      input.evaluationRecords,
      options.now,
    ),
    brier: meanBrierScore(evaluationForecasts, minResolved),
    logLoss: meanBinaryLogLoss(evaluationForecasts, {
      minSamples: minResolved,
      epsilon: options.logLossEpsilon,
    }),
    baseRate,
    brierSkill,
    equalMassEce: equalMassExpectedCalibrationError(evaluationForecasts, {
      binCount: options.binCount,
      minSamples: minResolved,
    }),
    calibrationFit: calibrationSlopeIntercept(evaluationForecasts, {
      minSamples: options.minCalibrationFit,
      epsilon: options.logLossEpsilon,
    }),
  };
}

export function evaluateForecastGroups(
  input: ForecastCohortInput,
  dimension: ForecastGroupDimension,
  options: ForecastEvaluationOptions = {},
): ForecastGroupEvaluation[] {
  const evaluationGroups = groupRecords(input.evaluationRecords, dimension);
  const trainingGroups = groupRecords(input.trainingRecords, dimension);
  const groups = [...evaluationGroups].map(([key, evaluationRecords]) => ({
    key,
    evaluation: evaluateForecastCohort(
      {
        evaluationRecords,
        trainingRecords: trainingGroups.get(key) ?? [],
      },
      options,
    ),
  }));
  groups.sort((left, right) =>
    right.evaluation.coverage.total - left.evaluation.coverage.total
    || compareGroupKeys(left.key, right.key, dimension));
  return groups;
}

export function evaluateForecastReport(
  input: ForecastCohortInput,
  options: ForecastEvaluationOptions = {},
): ForecastEvaluationReport {
  return {
    overall: evaluateForecastCohort(input, options),
    groups: {
      byTarget: evaluateForecastGroups(input, 'target', options),
      bySource: evaluateForecastGroups(input, 'source', options),
      byDomain: evaluateForecastGroups(input, 'domain', options),
      byHorizon: evaluateForecastGroups(input, 'horizon', options),
      byAlgorithmVersion: evaluateForecastGroups(
        input,
        'algorithmVersion',
        options,
      ),
    },
  };
}

export function horizonBucket(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return 'invalid';
  const duration = durationMs;
  if (duration < HOUR) return '<1h';
  if (duration < 6 * HOUR) return '1h-6h';
  if (duration < DAY) return '6h-24h';
  if (duration < 7 * DAY) return '1d-7d';
  if (duration < 30 * DAY) return '7d-30d';
  return '30d+';
}

export function pairedBootstrapMeanDifference(
  samples: readonly PairedMetricSample[],
  options: PairedBootstrapOptions = {},
): PairedBootstrapResult {
  const valid = samples.filter(
    (sample) =>
      Number.isFinite(sample.incumbent)
      && Number.isFinite(sample.challenger),
  );
  const minPairs = sampleFloor(options.minPairs, DEFAULT_MIN_PAIRS);
  if (valid.length < minPairs) return insufficient(valid.length, minPairs);

  const iterations = positiveInteger(
    options.iterations,
    DEFAULT_BOOTSTRAP_ITERATIONS,
  );
  const confidenceLevel =
    options.confidenceLevel !== undefined
    && Number.isFinite(options.confidenceLevel)
    && options.confidenceLevel > 0
    && options.confidenceLevel < 1
      ? options.confidenceLevel
      : 0.95;
  const seed = Number.isFinite(options.seed)
    ? (options.seed as number) >>> 0
    : DEFAULT_BOOTSTRAP_SEED;
  const random = mulberry32(seed);
  const differences = valid.map(
    (sample) => sample.challenger - sample.incumbent,
  );
  const bootstrapMeans: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let sum = 0;
    let drawsRemaining = differences.length;
    while (drawsRemaining > 0) {
      sum += differences[Math.floor(random() * differences.length)]!;
      drawsRemaining -= 1;
    }
    bootstrapMeans.push(sum / differences.length);
  }
  bootstrapMeans.sort((left, right) => left - right);
  const tail = (1 - confidenceLevel) / 2;
  return {
    status: 'ok',
    sampleSize: valid.length,
    meanDifference: mean(differences),
    lowerBound: quantile(bootstrapMeans, tail),
    upperBound: quantile(bootstrapMeans, 1 - tail),
    confidenceLevel,
    iterations,
    seed,
  };
}

interface RecordProjection {
  records: ScoredForecast[];
  proxyLabels: number;
  invalidProbabilities: number;
}

function scoreRecords(
  records: readonly PredictionRecord[],
  options: { includeProxyLabels: boolean; epsilon?: number },
): RecordProjection {
  const projection: RecordProjection = {
    records: [],
    proxyLabels: 0,
    invalidProbabilities: 0,
  };
  for (const record of records) {
    const outcome = resolvedOutcome(record);
    if (outcome === null) continue;
    if (!Number.isFinite(record.probability)) {
      projection.invalidProbabilities += 1;
      continue;
    }
    if (!options.includeProxyLabels && isProxyResolution(record)) {
      projection.proxyLabels += 1;
      continue;
    }
    projection.records.push({
      id: record.id,
      targetKey: record.targetKey,
      sourceId: record.sourceId,
      domain: record.domain,
      probability: clamp01(record.probability),
      outcome,
      predictedAt: record.predictedAt,
      resolveBy: record.resolveBy,
      resolvedAt: record.resolvedAt,
      algorithmVersion: record.algorithmVersion,
      brierContribution: brierContribution(record.probability, outcome),
      logLossContribution: binaryLogLossContribution(
        record.probability,
        outcome,
        options.epsilon,
      ),
    });
  }
  return projection;
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

function validForecasts(
  forecasts: readonly EvaluationForecast[],
): EvaluationForecast[] {
  return forecasts.filter((forecast) => Number.isFinite(forecast.probability));
}

function groupRecords(
  records: readonly PredictionRecord[],
  dimension: ForecastGroupDimension,
): Map<string, PredictionRecord[]> {
  const groups = new Map<string, PredictionRecord[]>();
  for (const record of records) {
    const key = groupKey(record, dimension);
    const group = groups.get(key);
    if (group) group.push(record);
    else groups.set(key, [record]);
  }
  return groups;
}

function groupKey(
  record: PredictionRecord,
  dimension: ForecastGroupDimension,
): string {
  switch (dimension) {
    case 'target': {
      return record.targetKey ?? 'unkeyed';
    }
    case 'source': {
      return record.sourceId;
    }
    case 'domain': {
      return record.domain;
    }
    case 'horizon': {
      return horizonBucket(record.resolveBy - record.predictedAt);
    }
    case 'algorithmVersion': {
      return record.algorithmVersion ?? 'unversioned';
    }
  }
}

function compareGroupKeys(
  left: string,
  right: string,
  dimension: ForecastGroupDimension,
): number {
  if (dimension !== 'horizon') return left.localeCompare(right);
  const order = [
    '<1h',
    '1h-6h',
    '6h-24h',
    '1d-7d',
    '7d-30d',
    '30d+',
    'invalid',
  ];
  return order.indexOf(left) - order.indexOf(right);
}

function recordAvailableBefore(
  record: PredictionRecord,
  evaluationWindowStart: number,
): boolean {
  if (
    !Number.isFinite(record.predictedAt)
    || record.predictedAt >= evaluationWindowStart
  ) {
    return false;
  }
  if (resolvedOutcome(record) === null) return true;
  return record.resolvedAt !== undefined
    && Number.isFinite(record.resolvedAt)
    && record.resolvedAt < evaluationWindowStart;
}

function earliestPredictedAt(
  records: readonly PredictionRecord[],
): number | undefined {
  let earliest: number | undefined;
  for (const record of records) {
    if (!Number.isFinite(record.predictedAt)) continue;
    if (earliest === undefined || record.predictedAt < earliest) {
      earliest = record.predictedAt;
    }
  }
  return earliest;
}

function insufficient(
  sampleSize: number,
  minSampleSize: number,
): {
  status: 'insufficient_evidence';
  sampleSize: number;
  minSampleSize: number;
} {
  return {
    status: 'insufficient_evidence',
    sampleSize,
    minSampleSize,
  };
}

function sampleFloor(value: number | undefined, fallback: number): number {
  return positiveInteger(value, fallback);
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) return fallback;
  return Math.floor(value);
}

function positiveFinite(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

function validEpsilon(value: number | undefined): number {
  if (
    value === undefined
    || !Number.isFinite(value)
    || value <= 0
    || value >= 0.5
  ) {
    return DEFAULT_LOG_LOSS_EPSILON;
  }
  return value;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values: readonly number[]): number {
  const average = mean(values);
  return mean(values.map((value) => (value - average) ** 2));
}

function logit(probability: number, epsilon: number): number {
  const clipped = Math.max(
    epsilon,
    Math.min(1 - epsilon, clamp01(probability)),
  );
  return Math.log(clipped / (1 - clipped));
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const exp = Math.exp(-value);
    return 1 / (1 + exp);
  }
  const exp = Math.exp(value);
  return exp / (1 + exp);
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D_2B_79_F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function quantile(sorted: readonly number[], probability: number): number {
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}
