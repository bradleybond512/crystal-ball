import { horizonBucket } from './forecast-evaluation';
import type {
  PredictionRecord,
  PredictionStatus,
} from './forecast-calibration';

export type ForecastReplayLabelOrigin = 'direct' | 'manual' | 'proxy';

export interface ForecastReplayFixture {
  id: string;
  sourceId: string;
  domain: PredictionRecord['domain'];
  probability: number;
  predictedAt: number;
  resolveBy: number;
  status: PredictionStatus;
  resolvedAt?: number;
  labelOrigin: ForecastReplayLabelOrigin;
  algorithmVersion?: string;
}

export interface ForecastReplayOptions {
  corpusId?: string;
  initialTrainingRecords?: number;
  evaluationWindowRecords?: number;
  minTrainingResolved?: number;
  highConfidenceThreshold?: number;
}

export interface ForecastReplayFold {
  index: number;
  evaluationWindowStart: number;
  trainingRecords: number;
  trainingResolved: number;
  evaluationRecords: number;
  resolved: number;
  scored: number;
  proxyLabelsExcluded: number;
  invalidProbabilitiesExcluded: number;
  resolutionCoverage: number;
  brier: number | null;
  logLoss: number | null;
  baselineProbability: number | null;
  baselineBrier: number | null;
  brierSkill: number | null;
  highConfidenceMisses: number;
}

export interface ForecastReplayMetricRow {
  key: string;
  sampleSize: number;
  brier: number;
  logLoss: number;
  baselineBrier: number;
  brierSkill: number | null;
  totalBrierLoss: number;
  shareOfBrierLoss: number;
  highConfidenceMisses: number;
}

export interface ForecastReplayReport {
  schemaVersion: 1;
  strategy: 'expanding_window';
  corpus: {
    id: string;
    recordCount: number;
    firstPredictedAt: number | null;
    lastPredictedAt: number | null;
  };
  config: {
    initialTrainingRecords: number;
    evaluationWindowRecords: number;
    minTrainingResolved: number;
    highConfidenceThreshold: number;
  };
  folds: readonly ForecastReplayFold[];
  overall: {
    evaluationRecords: number;
    resolved: number;
    scored: number;
    proxyLabelsExcluded: number;
    invalidProbabilitiesExcluded: number;
    resolutionCoverage: number;
    brier: number | null;
    logLoss: number | null;
    baselineBrier: number | null;
    brierSkill: number | null;
    highConfidenceMisses: number;
  };
  groups: {
    bySource: readonly ForecastReplayMetricRow[];
    byDomain: readonly ForecastReplayMetricRow[];
    byHorizon: readonly ForecastReplayMetricRow[];
    byAlgorithmVersion: readonly ForecastReplayMetricRow[];
  };
}

export interface ForecastReplayBaseline {
  schemaVersion: 1;
  corpusId: string;
  recordCount: number;
  metrics: {
    brierSkill: number;
    logLoss: number;
    resolutionCoverage: number;
    highConfidenceMisses: number;
  };
  tolerances: {
    brierSkillDrop: number;
    logLossIncrease: number;
    resolutionCoverageDrop: number;
    highConfidenceMissIncrease: number;
  };
}

export type ForecastReplayRegressionMetric =
  | 'corpusId'
  | 'recordCount'
  | 'brierSkill'
  | 'logLoss'
  | 'resolutionCoverage'
  | 'highConfidenceMisses';

export interface ForecastReplayRegression {
  metric: ForecastReplayRegressionMetric;
  baseline: number | string;
  actual: number | string | null;
  message: string;
}

export interface ForecastReplayComparison {
  ok: boolean;
  regressions: readonly ForecastReplayRegression[];
}

interface ReplayScore {
  sourceId: string;
  domain: PredictionRecord['domain'];
  horizon: string;
  algorithmVersion: string;
  probability: number;
  outcome: 0 | 1;
  brier: number;
  logLoss: number;
  baselineBrier: number;
  highConfidenceMiss: boolean;
}

interface ReplayWindowProjection {
  scores: ReplayScore[];
  resolved: number;
  proxyLabelsExcluded: number;
  invalidProbabilitiesExcluded: number;
}

const DEFAULT_CORPUS_ID = 'crystal-ball-forecast-replay-v1';
const DEFAULT_INITIAL_TRAINING_RECORDS = 40;
const DEFAULT_EVALUATION_WINDOW_RECORDS = 20;
const DEFAULT_MIN_TRAINING_RESOLVED = 20;
const DEFAULT_HIGH_CONFIDENCE_THRESHOLD = 0.8;
const LOG_LOSS_EPSILON = 1e-6;

export function runForecastReplayBenchmark(
  fixtures: readonly ForecastReplayFixture[],
  options: ForecastReplayOptions = {},
): ForecastReplayReport {
  const ordered = [...fixtures].sort(
    (left, right) =>
      finiteTime(left.predictedAt) - finiteTime(right.predictedAt)
      || left.id.localeCompare(right.id),
  );
  const initialTrainingRecords = boundedPositiveInteger(
    options.initialTrainingRecords,
    DEFAULT_INITIAL_TRAINING_RECORDS,
  );
  const evaluationWindowRecords = boundedPositiveInteger(
    options.evaluationWindowRecords,
    DEFAULT_EVALUATION_WINDOW_RECORDS,
  );
  const minTrainingResolved = boundedPositiveInteger(
    options.minTrainingResolved,
    DEFAULT_MIN_TRAINING_RESOLVED,
  );
  const highConfidenceThreshold = validConfidenceThreshold(
    options.highConfidenceThreshold,
  );
  const folds: ForecastReplayFold[] = [];
  const scores: ReplayScore[] = [];
  let totalEvaluationRecords = 0;
  let totalResolved = 0;
  let totalProxyLabels = 0;
  let totalInvalidProbabilities = 0;

  for (
    let evaluationStart = initialTrainingRecords, foldIndex = 0;
    evaluationStart < ordered.length;
    evaluationStart += evaluationWindowRecords, foldIndex += 1
  ) {
    const evaluation = ordered.slice(
      evaluationStart,
      evaluationStart + evaluationWindowRecords,
    );
    if (evaluation.length === 0) break;
    const evaluationWindowStart = evaluation[0]!.predictedAt;
    const training = ordered.slice(0, evaluationStart);
    const trainingResolved = availableTrainingLabels(
      training,
      evaluationWindowStart,
    );
    const baselineProbability = trainingResolved.length >= minTrainingResolved
      ? mean(trainingResolved.map((fixture) => outcomeOf(fixture)!))
      : null;
    const projection = projectEvaluationWindow(
      evaluation,
      baselineProbability,
      highConfidenceThreshold,
    );
    scores.push(...projection.scores);

    totalEvaluationRecords += evaluation.length;
    totalResolved += projection.resolved;
    totalProxyLabels += projection.proxyLabelsExcluded;
    totalInvalidProbabilities += projection.invalidProbabilitiesExcluded;
    folds.push({
      index: foldIndex,
      evaluationWindowStart,
      trainingRecords: training.length,
      trainingResolved: trainingResolved.length,
      evaluationRecords: evaluation.length,
      resolved: projection.resolved,
      scored: projection.scores.length,
      proxyLabelsExcluded: projection.proxyLabelsExcluded,
      invalidProbabilitiesExcluded: projection.invalidProbabilitiesExcluded,
      resolutionCoverage: ratio(projection.resolved, evaluation.length),
      brier: meanOrNull(projection.scores.map((score) => score.brier)),
      logLoss: meanOrNull(projection.scores.map((score) => score.logLoss)),
      baselineProbability,
      baselineBrier: meanOrNull(
        projection.scores.map((score) => score.baselineBrier),
      ),
      brierSkill: brierSkill(projection.scores),
      highConfidenceMisses:
        projection.scores.filter((score) => score.highConfidenceMiss).length,
    });
  }

  const totalBrierLoss = sum(scores.map((score) => score.brier));
  return {
    schemaVersion: 1,
    strategy: 'expanding_window',
    corpus: {
      id: options.corpusId ?? DEFAULT_CORPUS_ID,
      recordCount: ordered.length,
      firstPredictedAt: ordered[0]?.predictedAt ?? null,
      lastPredictedAt: ordered[ordered.length - 1]?.predictedAt ?? null,
    },
    config: {
      initialTrainingRecords,
      evaluationWindowRecords,
      minTrainingResolved,
      highConfidenceThreshold,
    },
    folds,
    overall: {
      evaluationRecords: totalEvaluationRecords,
      resolved: totalResolved,
      scored: scores.length,
      proxyLabelsExcluded: totalProxyLabels,
      invalidProbabilitiesExcluded: totalInvalidProbabilities,
      resolutionCoverage: ratio(totalResolved, totalEvaluationRecords),
      brier: meanOrNull(scores.map((score) => score.brier)),
      logLoss: meanOrNull(scores.map((score) => score.logLoss)),
      baselineBrier: meanOrNull(scores.map((score) => score.baselineBrier)),
      brierSkill: brierSkill(scores),
      highConfidenceMisses:
        scores.filter((score) => score.highConfidenceMiss).length,
    },
    groups: {
      bySource: groupScores(scores, (score) => score.sourceId, totalBrierLoss),
      byDomain: groupScores(scores, (score) => score.domain, totalBrierLoss),
      byHorizon: groupScores(scores, (score) => score.horizon, totalBrierLoss),
      byAlgorithmVersion: groupScores(
        scores,
        (score) => score.algorithmVersion,
        totalBrierLoss,
      ),
    },
  };
}

function availableTrainingLabels(
  fixtures: readonly ForecastReplayFixture[],
  evaluationWindowStart: number,
): ForecastReplayFixture[] {
  return fixtures.filter(
    (fixture) =>
      isScorableLabel(fixture)
      && Number.isFinite(fixture.probability)
      && fixture.resolvedAt !== undefined
      && fixture.resolvedAt < evaluationWindowStart,
  );
}

function projectEvaluationWindow(
  fixtures: readonly ForecastReplayFixture[],
  baselineProbability: number | null,
  highConfidenceThreshold: number,
): ReplayWindowProjection {
  const projection: ReplayWindowProjection = {
    scores: [],
    resolved: 0,
    proxyLabelsExcluded: 0,
    invalidProbabilitiesExcluded: 0,
  };
  for (const fixture of fixtures) {
    const outcome = outcomeOf(fixture);
    if (outcome !== null) projection.resolved += 1;
    if (fixture.labelOrigin === 'proxy' && outcome !== null) {
      projection.proxyLabelsExcluded += 1;
      continue;
    }
    if (outcome === null) continue;
    if (!Number.isFinite(fixture.probability)) {
      projection.invalidProbabilitiesExcluded += 1;
      continue;
    }
    if (baselineProbability === null) continue;
    projection.scores.push(buildReplayScore(
      fixture,
      outcome,
      baselineProbability,
      highConfidenceThreshold,
    ));
  }
  return projection;
}

function buildReplayScore(
  fixture: ForecastReplayFixture,
  outcome: 0 | 1,
  baselineProbability: number,
  highConfidenceThreshold: number,
): ReplayScore {
  const probability = clamp01(fixture.probability);
  return {
    sourceId: fixture.sourceId,
    domain: fixture.domain,
    horizon: horizonBucket(fixture.resolveBy - fixture.predictedAt),
    algorithmVersion: fixture.algorithmVersion ?? 'unversioned',
    probability,
    outcome,
    brier: (probability - outcome) ** 2,
    logLoss: binaryLogLoss(probability, outcome),
    baselineBrier: (baselineProbability - outcome) ** 2,
    highConfidenceMiss: isHighConfidenceMiss(
      probability,
      outcome,
      highConfidenceThreshold,
    ),
  };
}

export function compareForecastReplayToBaseline(
  report: ForecastReplayReport,
  baseline: ForecastReplayBaseline,
): ForecastReplayComparison {
  const regressions: ForecastReplayRegression[] = [];
  if (report.corpus.id !== baseline.corpusId) {
    regressions.push({
      metric: 'corpusId',
      baseline: baseline.corpusId,
      actual: report.corpus.id,
      message:
        `corpus id changed: baseline=${baseline.corpusId} actual=${report.corpus.id}`,
    });
  }
  if (report.corpus.recordCount !== baseline.recordCount) {
    regressions.push({
      metric: 'recordCount',
      baseline: baseline.recordCount,
      actual: report.corpus.recordCount,
      message:
        `record count changed: baseline=${baseline.recordCount} actual=${report.corpus.recordCount}`,
    });
  }
  compareLowerIsRegression({
    metric: 'brierSkill',
    baseline: baseline.metrics.brierSkill,
    actual: report.overall.brierSkill,
    tolerance: baseline.tolerances.brierSkillDrop,
    regressions,
  });
  compareHigherIsRegression({
    metric: 'logLoss',
    baseline: baseline.metrics.logLoss,
    actual: report.overall.logLoss,
    tolerance: baseline.tolerances.logLossIncrease,
    regressions,
  });
  compareLowerIsRegression({
    metric: 'resolutionCoverage',
    baseline: baseline.metrics.resolutionCoverage,
    actual: report.overall.resolutionCoverage,
    tolerance: baseline.tolerances.resolutionCoverageDrop,
    regressions,
  });
  compareHigherIsRegression({
    metric: 'highConfidenceMisses',
    baseline: baseline.metrics.highConfidenceMisses,
    actual: report.overall.highConfidenceMisses,
    tolerance: baseline.tolerances.highConfidenceMissIncrease,
    regressions,
  });
  return { ok: regressions.length === 0, regressions };
}

function groupScores(
  scores: readonly ReplayScore[],
  keyOf: (score: ReplayScore) => string,
  totalBrierLoss: number,
): ForecastReplayMetricRow[] {
  const groups = new Map<string, ReplayScore[]>();
  for (const score of scores) {
    const key = keyOf(score);
    const group = groups.get(key);
    if (group) group.push(score);
    else groups.set(key, [score]);
  }
  return [...groups].map(([key, group]) => {
    const groupBrierLoss = sum(group.map((score) => score.brier));
    return {
      key,
      sampleSize: group.length,
      brier: mean(group.map((score) => score.brier)),
      logLoss: mean(group.map((score) => score.logLoss)),
      baselineBrier: mean(group.map((score) => score.baselineBrier)),
      brierSkill: brierSkill(group),
      totalBrierLoss: groupBrierLoss,
      shareOfBrierLoss: ratio(groupBrierLoss, totalBrierLoss),
      highConfidenceMisses:
        group.filter((score) => score.highConfidenceMiss).length,
    };
  }).sort(
    (left, right) =>
      right.totalBrierLoss - left.totalBrierLoss
      || left.key.localeCompare(right.key),
  );
}

function compareLowerIsRegression(input: {
  metric: 'brierSkill' | 'resolutionCoverage';
  baseline: number;
  actual: number | null;
  tolerance: number;
  regressions: ForecastReplayRegression[];
}): void {
  const floor = input.baseline - input.tolerance;
  if (input.actual !== null && input.actual >= floor) return;
  input.regressions.push({
    metric: input.metric,
    baseline: input.baseline,
    actual: input.actual,
    message:
      `${input.metric} regressed: baseline=${formatMetric(input.baseline)} `
      + `actual=${formatMetric(input.actual)} floor=${formatMetric(floor)}`,
  });
}

function compareHigherIsRegression(input: {
  metric: 'logLoss' | 'highConfidenceMisses';
  baseline: number;
  actual: number | null;
  tolerance: number;
  regressions: ForecastReplayRegression[];
}): void {
  const ceiling = input.baseline + input.tolerance;
  if (input.actual !== null && input.actual <= ceiling) return;
  input.regressions.push({
    metric: input.metric,
    baseline: input.baseline,
    actual: input.actual,
    message:
      `${input.metric} regressed: baseline=${formatMetric(input.baseline)} `
      + `actual=${formatMetric(input.actual)} ceiling=${formatMetric(ceiling)}`,
  });
}

function outcomeOf(fixture: ForecastReplayFixture): 0 | 1 | null {
  if (fixture.status === 'resolved_true') return 1;
  if (fixture.status === 'resolved_false') return 0;
  return null;
}

function isScorableLabel(fixture: ForecastReplayFixture): boolean {
  return fixture.labelOrigin !== 'proxy' && outcomeOf(fixture) !== null;
}

function brierSkill(scores: readonly ReplayScore[]): number | null {
  if (scores.length === 0) return null;
  const forecastBrier = mean(scores.map((score) => score.brier));
  const baselineBrier = mean(scores.map((score) => score.baselineBrier));
  if (baselineBrier <= Number.EPSILON) return null;
  return 1 - forecastBrier / baselineBrier;
}

function binaryLogLoss(probability: number, outcome: 0 | 1): number {
  const clipped = Math.max(
    LOG_LOSS_EPSILON,
    Math.min(1 - LOG_LOSS_EPSILON, probability),
  );
  return outcome === 1 ? -Math.log(clipped) : -Math.log(1 - clipped);
}

function isHighConfidenceMiss(
  probability: number,
  outcome: 0 | 1,
  threshold: number,
): boolean {
  return (probability >= threshold && outcome === 0)
    || (probability <= 1 - threshold && outcome === 1);
}

function boundedPositiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : fallback;
}

function validConfidenceThreshold(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0.5 && value < 1
    ? value
    : DEFAULT_HIGH_CONFIDENCE_THRESHOLD;
}

function finiteTime(value: number): number {
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function mean(values: readonly number[]): number {
  return sum(values) / values.length;
}

function meanOrNull(values: readonly number[]): number | null {
  return values.length > 0 ? mean(values) : null;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function formatMetric(value: number | null): string {
  return value === null ? 'unavailable' : value.toFixed(6);
}
