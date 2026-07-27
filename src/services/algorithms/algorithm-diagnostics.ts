import {
  summarizeCalibration,
  type EvaluationRecord,
  type OutcomeLabelOrigin,
} from './algorithm-evaluation-ledger';
import {
  aggregateAlgorithmHealth,
  filterCurrentVersionRecords,
  type AlgorithmDefinition,
  type AlgorithmHealthReport,
} from './algorithm-health';
import {
  proposeAdjustments,
  type AdjustmentProposal,
  type AlgorithmAdjustmentTuning,
} from './safe-adjustment';
import type { AlgorithmLedgerPersistenceStatus } from './algorithm-ledger-persistence';
import type { TuningDecision } from './tuning-decision-log';
import type { SpotPriceDiagnostics } from '../market/spot-price-store';
import type { StormReportBatch } from '../intelligence/outcome-resolvers';
import {
  brierScore,
  perDomainAccuracy,
  perSourceMultipliers,
  type PredictionRecord,
  type SourceMultiplier,
} from '../intelligence/forecast-calibration';
import {
  auditResolutionQuality,
  type ResolutionQualityAudit,
} from '../intelligence/resolution-quality-audit';
import {
  evaluateForecastCohort,
  forecastLossAttribution,
  horizonBucket,
  splitForecastRecordsChronologically,
  type BrierSkillMetric,
  type CalibrationFit,
  type EqualMassEceMetric,
  type EvidenceMetric,
  type ForecastCohortEvaluation,
  type ForecastCoverage,
  type ForecastLossAttribution,
  type ForecastLossContribution,
} from '../intelligence/forecast-evaluation';

const RECENT_EVALUATION_LIMIT = 20;
const RECENT_TUNING_DECISION_LIMIT = 20;
const FORECAST_COHORT_LIMIT = 10;
const FORECAST_COHORT_LABEL_LIMIT = 80;
const FORECAST_RESOLUTION_GRACE_MS = 15 * 60 * 1000;
const WEATHER_REPORT_STALE_MS = 30 * 60 * 1000;
const WEATHER_REPORT_TYPES = new Set([
  'tornado',
  'hail',
  'wind',
  'flooding',
  'other',
]);

export interface AlgorithmRuntimeDiagnostics {
  algorithmId: string;
  version: string | null;
  domain: string;
  totalRuns: number;
  historicalRuns: number;
  graded: number;
  pending: number;
  errors: number;
  lastRunAt: number | null;
  latencyMs: {
    p50: number;
    p95: number;
    max: number;
    mean: number;
    last: number;
  };
}

export interface RecentAlgorithmEvaluation {
  id: string;
  algorithmId: string;
  domain: string;
  at: number;
  durationMs: number;
  score?: number;
  label?: string;
  outcome?: EvaluationRecord['outcome'];
  outcomeAt?: number;
  version?: string;
  outcomeOrigin?: OutcomeLabelOrigin;
  forecastLinked: boolean;
}

export type OutcomeOriginCounts = Record<OutcomeLabelOrigin, number>;

export interface AlgorithmDiagnosticsSnapshot {
  schemaVersion: 1;
  generatedAt: number;
  ledger: {
    total: number;
    graded: number;
    pending: number;
    lastEvaluationAt: number | null;
    outcomeOrigins: OutcomeOriginCounts;
    persistence: AlgorithmLedgerPersistenceStatus;
  };
  health: AlgorithmHealthReport;
  forecastCalibration: ForecastCalibrationDiagnostics;
  runtime: readonly AlgorithmRuntimeDiagnostics[];
  tunings: readonly AlgorithmAdjustmentTuning[];
  proposals: readonly AdjustmentProposal[];
  recentEvaluations: readonly RecentAlgorithmEvaluation[];
  recentTuningDecisions: readonly TuningDecision[];
}

export interface BuildAlgorithmDiagnosticsInput {
  generatedAt?: number;
  definitions: readonly AlgorithmDefinition[];
  records: readonly EvaluationRecord[];
  forecastPredictions?: readonly PredictionRecord[];
  marketSpotPrices?: SpotPriceDiagnostics;
  weatherReportBatch?: StormReportBatch | null;
  persistence: AlgorithmLedgerPersistenceStatus;
  tunings: readonly AlgorithmAdjustmentTuning[];
  tuningDecisions: readonly TuningDecision[];
}

interface ForecastResolverDiagnostics {
  resolverId: string;
  resolved: number;
  resolvedTrue: number;
  resolvedFalse: number;
  expired: number;
  lastResolvedAt: number | null;
}

export interface ForecastCalibrationDiagnostics {
  summary: {
    total: number;
    resolved: number;
    pending: number;
    expired: number;
    overduePending: number;
    oldestPendingAt: number | null;
    brierScore: number | null;
    criteriaDeclared: number;
    directResolved: number;
    proxyResolved: number;
    unattributedResolved: number;
    resolverExpired: number;
  };
  byDomain: readonly {
    domain: PredictionRecord['domain'];
    predictionCount: number;
    resolvedCount: number;
    brier: number | null;
    calibrationError: number | null;
  }[];
  bySource: readonly SourceMultiplier[];
  byResolver: readonly ForecastResolverDiagnostics[];
  evaluation: ForecastEvaluationDiagnostics;
  resolutionQuality: ResolutionQualityAudit;
  marketSpots: SpotPriceDiagnostics | null;
  weatherReports: WeatherReportDiagnostics;
}

export type ForecastDiagnosticMetric =
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

export type ForecastCalibrationFitDiagnostics =
  | {
      status: 'ok';
      sampleSize: number;
      intercept: number;
      slope: number;
      iterations: number;
    }
  | {
      status: 'insufficient_evidence';
      sampleSize: number;
      minSampleSize: number;
      reason?: string;
    };

export interface ForecastCohortDiagnostics {
  coverage: ForecastCoverage;
  trainingSampleSize: number;
  exclusions: ForecastCohortEvaluation['exclusions'];
  brier: ForecastDiagnosticMetric;
  logLoss: ForecastDiagnosticMetric;
  baseRate: ForecastDiagnosticMetric;
  brierSkill: ForecastDiagnosticMetric;
  equalMassEce: ForecastDiagnosticMetric;
  calibrationFit: ForecastCalibrationFitDiagnostics;
}

export interface ForecastEvaluationCohortDiagnostics
  extends ForecastCohortDiagnostics {
  sourceId: string;
  domain: PredictionRecord['domain'];
  horizon: string;
}

export interface ForecastLossContributionDiagnostics {
  key: string;
  sampleSize: number;
  totalBrierLoss: number;
  meanBrier: number;
  shareOfBrierLoss: number;
  highConfidenceMisses: number;
}

export interface ForecastLossAttributionDiagnostics {
  sampleSize: number;
  totalBrierLoss: number;
  highConfidenceMisses: number;
  groupLimit: 10;
  bySource: readonly ForecastLossContributionDiagnostics[];
  byDomain: readonly ForecastLossContributionDiagnostics[];
  byHorizon: readonly ForecastLossContributionDiagnostics[];
  byAlgorithmVersion: readonly ForecastLossContributionDiagnostics[];
}

export interface ForecastEvaluationDiagnostics {
  schemaVersion: 1;
  split: {
    strategy: 'chronological_60_40';
    trainingRecords: number;
    evaluationRecords: number;
    evaluationWindowStart: number | null;
  };
  resolutionBacklog: {
    pending: number;
    overduePending: number;
    expired: number;
    oldestPendingAt: number | null;
  };
  labelOrigins: {
    direct: number;
    proxy: number;
    manual: number;
    unattributed: number;
  };
  overall: ForecastCohortDiagnostics;
  lossAttribution: ForecastLossAttributionDiagnostics;
  worstCohorts: readonly ForecastEvaluationCohortDiagnostics[];
  cohortLimit: 10;
  cohortCount: number;
  omittedCohortCount: number;
}

export interface WeatherReportDiagnostics {
  status: 'missing' | 'fresh' | 'incomplete' | 'stale' | 'invalid';
  reportCount: number;
  validReportCount: number;
  invalidReportCount: number;
  pendingWarningPredictions: number;
  fetchedAt: number | null;
  ageMs: number | null;
  coverageStart: number | null;
  coverageEnd: number | null;
  complete: boolean;
}

export function buildAlgorithmDiagnosticsSnapshot(
  input: BuildAlgorithmDiagnosticsInput,
): AlgorithmDiagnosticsSnapshot {
  const generatedAt = input.generatedAt ?? Date.now();
  const records = [...input.records].sort((a, b) => a.at - b.at);
  const currentRecords = filterCurrentVersionRecords(records, input.definitions);
  const calibrations = summarizeCalibration(currentRecords);
  const health = aggregateAlgorithmHealth({
    generatedAt,
    definitions: input.definitions,
    calibrations,
  });
  const lastRecord = records.length > 0 ? records[records.length - 1] : undefined;

  return {
    schemaVersion: 1,
    generatedAt,
    ledger: {
      total: records.length,
      graded: records.filter((record) => record.outcome !== undefined).length,
      pending: records.filter((record) => record.outcome === undefined).length,
      lastEvaluationAt: lastRecord?.at ?? null,
      outcomeOrigins: countOutcomeOrigins(records),
      persistence: { ...input.persistence },
    },
    health,
    forecastCalibration: buildForecastCalibrationDiagnostics(
      input.forecastPredictions ?? [],
      generatedAt,
      input.marketSpotPrices,
      input.weatherReportBatch,
    ),
    runtime: buildRuntimeRows(input.definitions, records),
    tunings: input.tunings.map((tuning) => copyTuning(tuning)),
    proposals: proposeAdjustments(
      { reports: health.algorithms, tunings: input.tunings },
      { now: () => generatedAt },
    ),
    recentEvaluations: records
      .slice(-RECENT_EVALUATION_LIMIT)
      .reverse()
      .map((record) => toRecentEvaluation(record)),
    recentTuningDecisions: input.tuningDecisions
      .slice(0, RECENT_TUNING_DECISION_LIMIT)
      .map((decision) => ({ ...decision })),
  };
}

function buildForecastCalibrationDiagnostics(
  predictions: readonly PredictionRecord[],
  now: number,
  marketSpotPrices?: SpotPriceDiagnostics,
  weatherReportBatch?: StormReportBatch | null,
): ForecastCalibrationDiagnostics {
  const resolved = predictions.filter(
    (record) => record.status === 'resolved_true' || record.status === 'resolved_false',
  );
  const pending = predictions
    .filter((record) => record.status === 'pending')
    .sort((a, b) => a.predictedAt - b.predictedAt);
  const domainRows = perDomainAccuracy(predictions);
  const resolverDiagnostics = buildForecastResolverDiagnostics(predictions, resolved);
  const resolutionQuality = auditResolutionQuality(predictions, now);

  return {
    summary: {
      total: predictions.length,
      resolved: resolved.length,
      pending: pending.length,
      expired: predictions.filter((record) => record.status === 'expired').length,
      overduePending: pending.filter(
        (record) => record.resolveBy < now - FORECAST_RESOLUTION_GRACE_MS,
      ).length,
      oldestPendingAt: pending[0]?.predictedAt ?? null,
      brierScore: resolved.length > 0 ? brierScore(resolved).score : null,
      criteriaDeclared: predictions.filter((record) => record.criteria !== undefined).length,
      directResolved: resolverDiagnostics.directResolved,
      proxyResolved: resolverDiagnostics.proxyResolved,
      unattributedResolved:
        resolved.length
        - resolverDiagnostics.directResolved
        - resolverDiagnostics.proxyResolved,
      resolverExpired: resolverDiagnostics.resolverExpired,
    },
    byDomain: domainRows.map((row) => {
      const resolvedCount = resolved.filter((record) => record.domain === row.domain).length;
      return {
        domain: row.domain,
        predictionCount: row.predictionCount,
        resolvedCount,
        brier: resolvedCount > 0 ? row.brier : null,
        calibrationError: resolvedCount > 0 ? row.calibrationError : null,
      };
    }),
    bySource: perSourceMultipliers(predictions),
    byResolver: resolverDiagnostics.rows,
    evaluation: buildForecastEvaluationDiagnostics(
      predictions,
      now,
      resolutionQuality,
    ),
    resolutionQuality,
    marketSpots: marketSpotPrices ? { ...marketSpotPrices } : null,
    weatherReports: buildWeatherReportDiagnostics(
      predictions,
      weatherReportBatch,
      now,
    ),
  };
}

function buildForecastEvaluationDiagnostics(
  predictions: readonly PredictionRecord[],
  now: number,
  resolutionQuality: ResolutionQualityAudit,
): ForecastEvaluationDiagnostics {
  const split = splitForecastRecordsChronologically(predictions);
  const evaluationOptions = { now };
  const overallEvaluation = evaluateForecastCohort({
    trainingRecords: split.training,
    evaluationRecords: split.evaluation,
  }, evaluationOptions);
  const trainingGroups = groupForecastCohorts(split.training);
  const evaluationGroups = groupForecastCohorts(split.evaluation);
  const cohorts = [...evaluationGroups].map(([key, group]) => {
    const evaluation = evaluateForecastCohort({
      trainingRecords: trainingGroups.get(key)?.records ?? [],
      evaluationRecords: group.records,
    }, evaluationOptions);
    return {
      sourceId: boundedCohortLabel(group.sourceId),
      domain: group.domain,
      horizon: group.horizon,
      ...toForecastCohortDiagnostics(evaluation),
    };
  });
  cohorts.sort(compareForecastCohorts);
  const pending = predictions
    .filter((record) => record.status === 'pending')
    .sort((left, right) => left.predictedAt - right.predictedAt);
  const origins = resolutionQuality.summary.origins;

  return {
    schemaVersion: 1,
    split: {
      strategy: 'chronological_60_40',
      trainingRecords: split.training.length,
      evaluationRecords: split.evaluation.length,
      evaluationWindowStart: overallEvaluation.evaluationWindowStart ?? null,
    },
    resolutionBacklog: {
      pending: pending.length,
      overduePending: pending.filter(
        (record) => record.resolveBy < now - FORECAST_RESOLUTION_GRACE_MS,
      ).length,
      expired: predictions.filter((record) => record.status === 'expired').length,
      oldestPendingAt: pending[0]?.predictedAt ?? null,
    },
    labelOrigins: {
      ...origins,
      unattributed: Math.max(
        0,
        resolutionQuality.summary.resolved
        - origins.direct
        - origins.proxy
        - origins.manual,
      ),
    },
    overall: toForecastCohortDiagnostics(overallEvaluation),
    lossAttribution: toForecastLossAttributionDiagnostics(
      forecastLossAttribution(overallEvaluation.scoredRecords),
    ),
    worstCohorts: cohorts.slice(0, FORECAST_COHORT_LIMIT),
    cohortLimit: FORECAST_COHORT_LIMIT,
    cohortCount: cohorts.length,
    omittedCohortCount: Math.max(0, cohorts.length - FORECAST_COHORT_LIMIT),
  };
}

function toForecastLossAttributionDiagnostics(
  attribution: ForecastLossAttribution,
): ForecastLossAttributionDiagnostics {
  return {
    sampleSize: attribution.sampleSize,
    totalBrierLoss: roundedMetricValue(attribution.totalBrierLoss),
    highConfidenceMisses: attribution.highConfidenceMisses,
    groupLimit: FORECAST_COHORT_LIMIT,
    bySource: attribution.bySource
      .slice(0, FORECAST_COHORT_LIMIT)
      .map((contribution) =>
        toForecastLossContributionDiagnostics(contribution)),
    byDomain: attribution.byDomain
      .slice(0, FORECAST_COHORT_LIMIT)
      .map((contribution) =>
        toForecastLossContributionDiagnostics(contribution)),
    byHorizon: attribution.byHorizon
      .slice(0, FORECAST_COHORT_LIMIT)
      .map((contribution) =>
        toForecastLossContributionDiagnostics(contribution)),
    byAlgorithmVersion: attribution.byAlgorithmVersion
      .slice(0, FORECAST_COHORT_LIMIT)
      .map((contribution) =>
        toForecastLossContributionDiagnostics(contribution)),
  };
}

function toForecastLossContributionDiagnostics(
  contribution: ForecastLossContribution,
): ForecastLossContributionDiagnostics {
  return {
    key: boundedCohortLabel(contribution.key),
    sampleSize: contribution.sampleSize,
    totalBrierLoss: roundedMetricValue(contribution.totalBrierLoss),
    meanBrier: roundedMetricValue(contribution.meanBrier),
    shareOfBrierLoss: roundedMetricValue(contribution.shareOfBrierLoss),
    highConfidenceMisses: contribution.highConfidenceMisses,
  };
}

interface ForecastCohortGroup {
  sourceId: string;
  domain: PredictionRecord['domain'];
  horizon: string;
  records: PredictionRecord[];
}

function groupForecastCohorts(
  records: readonly PredictionRecord[],
): Map<string, ForecastCohortGroup> {
  const groups = new Map<string, ForecastCohortGroup>();
  for (const record of records) {
    const horizon = horizonBucket(record.resolveBy - record.predictedAt);
    const key = JSON.stringify([record.sourceId, record.domain, horizon]);
    const existing = groups.get(key);
    if (existing) {
      existing.records.push(record);
      continue;
    }
    groups.set(key, {
      sourceId: record.sourceId,
      domain: record.domain,
      horizon,
      records: [record],
    });
  }
  return groups;
}

function toForecastCohortDiagnostics(
  evaluation: ForecastCohortEvaluation,
): ForecastCohortDiagnostics {
  return {
    coverage: {
      ...evaluation.coverage,
      resolutionCoverage: roundedMetricValue(
        evaluation.coverage.resolutionCoverage,
      ),
      expirationRate: roundedMetricValue(evaluation.coverage.expirationRate),
      closedCoverage: roundedMetricValue(evaluation.coverage.closedCoverage),
    },
    trainingSampleSize: evaluation.trainingSampleSize,
    exclusions: { ...evaluation.exclusions },
    brier: toForecastDiagnosticMetric(evaluation.brier),
    logLoss: toForecastDiagnosticMetric(evaluation.logLoss),
    baseRate: toForecastDiagnosticMetric(evaluation.baseRate),
    brierSkill: toForecastDiagnosticMetric(evaluation.brierSkill),
    equalMassEce: toForecastDiagnosticMetric(evaluation.equalMassEce),
    calibrationFit: toForecastCalibrationFit(evaluation.calibrationFit),
  };
}

function toForecastDiagnosticMetric(
  metric: EvidenceMetric | BrierSkillMetric | EqualMassEceMetric,
): ForecastDiagnosticMetric {
  if (metric.status === 'ok') {
    return {
      status: 'ok',
      sampleSize: metric.sampleSize,
      value: roundedMetricValue(metric.value),
    };
  }
  return {
    status: 'insufficient_evidence',
    sampleSize: metric.sampleSize,
    minSampleSize: metric.minSampleSize,
    ...(metric.reason ? { reason: metric.reason } : {}),
  };
}

function toForecastCalibrationFit(
  fit: CalibrationFit,
): ForecastCalibrationFitDiagnostics {
  if (fit.status === 'ok') {
    return {
      status: 'ok',
      sampleSize: fit.sampleSize,
      intercept: roundedMetricValue(fit.intercept),
      slope: roundedMetricValue(fit.slope),
      iterations: fit.iterations,
    };
  }
  return {
    status: 'insufficient_evidence',
    sampleSize: fit.sampleSize,
    minSampleSize: fit.minSampleSize,
    ...(fit.reason ? { reason: fit.reason } : {}),
  };
}

function compareForecastCohorts(
  left: ForecastEvaluationCohortDiagnostics,
  right: ForecastEvaluationCohortDiagnostics,
): number {
  if (left.brier.status === 'ok' && right.brier.status !== 'ok') return -1;
  if (left.brier.status !== 'ok' && right.brier.status === 'ok') return 1;
  if (left.brier.status === 'ok' && right.brier.status === 'ok') {
    const brierOrder = right.brier.value - left.brier.value;
    if (brierOrder !== 0) return brierOrder;
  }
  const sampleOrder = right.brier.sampleSize - left.brier.sampleSize;
  if (sampleOrder !== 0) return sampleOrder;
  const totalOrder = right.coverage.total - left.coverage.total;
  if (totalOrder !== 0) return totalOrder;
  return left.sourceId.localeCompare(right.sourceId)
    || left.domain.localeCompare(right.domain)
    || left.horizon.localeCompare(right.horizon);
}

function boundedCohortLabel(value: string): string {
  const bounded = value
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, FORECAST_COHORT_LABEL_LIMIT);
  return bounded || 'unknown';
}

function roundedMetricValue(value: number): number {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function buildWeatherReportDiagnostics(
  predictions: readonly PredictionRecord[],
  batch: StormReportBatch | null | undefined,
  now: number,
): WeatherReportDiagnostics {
  const pendingWarningPredictions = predictions.filter((record) =>
    record.status === 'pending'
    && record.criteria?.kind === 'warning_verification').length;
  if (!batch) {
    return {
      status: 'missing',
      reportCount: 0,
      validReportCount: 0,
      invalidReportCount: 0,
      pendingWarningPredictions,
      fetchedAt: null,
      ageMs: null,
      coverageStart: null,
      coverageEnd: null,
      complete: false,
    };
  }
  const validReportCount = batch.reports.filter((report) =>
    typeof report.id === 'string'
    && report.id.length > 0
    && report.id.length <= 512
    && !/[\u0000-\u001F\u007F]/.test(report.id)
    && WEATHER_REPORT_TYPES.has(report.type)
    && Number.isFinite(report.lat)
    && report.lat >= -90
    && report.lat <= 90
    && Number.isFinite(report.lon)
    && report.lon >= -180
    && report.lon <= 180
    && Number.isFinite(report.reportedAt)).length;
  const timestampsValid = Number.isFinite(batch.fetchedAt)
    && batch.fetchedAt <= now
    && Number.isFinite(batch.coverageStart)
    && Number.isFinite(batch.coverageEnd)
    && batch.coverageStart <= batch.coverageEnd
    && batch.coverageEnd <= batch.fetchedAt;
  const ageMs = timestampsValid ? now - batch.fetchedAt : null;
  const invalidReportCount = batch.reports.length - validReportCount;
  let status: WeatherReportDiagnostics['status'];
  if (timestampsValid && ageMs! > WEATHER_REPORT_STALE_MS) status = 'stale';
  else if (!timestampsValid || invalidReportCount > 0) status = 'invalid';
  else if (batch.complete) status = 'fresh';
  else status = 'incomplete';
  return {
    status,
    reportCount: batch.reports.length,
    validReportCount,
    invalidReportCount,
    pendingWarningPredictions,
    fetchedAt: Number.isFinite(batch.fetchedAt) ? batch.fetchedAt : null,
    ageMs,
    coverageStart: Number.isFinite(batch.coverageStart)
      ? batch.coverageStart
      : null,
    coverageEnd: Number.isFinite(batch.coverageEnd) ? batch.coverageEnd : null,
    complete: batch.complete === true,
  };
}

function buildForecastResolverDiagnostics(
  predictions: readonly PredictionRecord[],
  resolved: readonly PredictionRecord[],
): {
  directResolved: number;
  proxyResolved: number;
  resolverExpired: number;
  rows: ForecastResolverDiagnostics[];
} {
  const directResolved = resolved.filter((record) =>
    record.resolutionProvenance?.kind === 'direct'
    || (!record.resolutionProvenance && record.resolutionNote?.startsWith('direct:'))).length;
  const proxyResolved = resolved.filter((record) =>
    record.resolutionProvenance?.kind === 'proxy'
    || (!record.resolutionProvenance && record.resolutionNote?.startsWith('proxy:'))).length;
  const resolverRows = new Map<string, ForecastResolverDiagnostics>();
  addResolvedResolverRows(resolved, resolverRows);
  const resolverExpired = addExpiredResolverRows(predictions, resolverRows);

  return {
    directResolved,
    proxyResolved,
    resolverExpired,
    rows: [...resolverRows.values()].sort(
      (a, b) => b.resolved - a.resolved || a.resolverId.localeCompare(b.resolverId),
    ),
  };
}

function resolverRowFor(
  resolverRows: ReadonlyMap<string, ForecastResolverDiagnostics>,
  resolverId: string,
): ForecastResolverDiagnostics {
  return resolverRows.get(resolverId) ?? {
    resolverId,
    resolved: 0,
    resolvedTrue: 0,
    resolvedFalse: 0,
    expired: 0,
    lastResolvedAt: null,
  };
}

function addResolvedResolverRows(
  resolved: readonly PredictionRecord[],
  resolverRows: Map<string, ForecastResolverDiagnostics>,
): void {
  for (const record of resolved) {
    const resolverId = record.resolutionProvenance?.resolverId;
    if (!resolverId) continue;
    const row = resolverRowFor(resolverRows, resolverId);
    row.resolved += 1;
    row.resolvedTrue += record.status === 'resolved_true' ? 1 : 0;
    row.resolvedFalse += record.status === 'resolved_false' ? 1 : 0;
    if (record.resolvedAt !== undefined) {
      row.lastResolvedAt = row.lastResolvedAt === null
        ? record.resolvedAt
        : Math.max(row.lastResolvedAt, record.resolvedAt);
    }
    resolverRows.set(resolverId, row);
  }
}

function addExpiredResolverRows(
  predictions: readonly PredictionRecord[],
  resolverRows: Map<string, ForecastResolverDiagnostics>,
): number {
  let resolverExpired = 0;
  for (const record of predictions) {
    if (record.status !== 'expired') continue;
    const match = /^unresolved:([a-z0-9][a-z0-9.-]{0,63})\b/i.exec(
      record.resolutionNote ?? '',
    );
    const resolverId = match?.[1];
    if (!resolverId) continue;
    resolverExpired += 1;
    const row = resolverRowFor(resolverRows, resolverId);
    row.expired += 1;
    resolverRows.set(resolverId, row);
  }
  return resolverExpired;
}

function buildRuntimeRows(
  definitions: readonly AlgorithmDefinition[],
  records: readonly EvaluationRecord[],
): AlgorithmRuntimeDiagnostics[] {
  const recordsByAlgorithm = new Map<string, EvaluationRecord[]>();
  for (const record of records) {
    const bucket = recordsByAlgorithm.get(record.algorithmId) ?? [];
    bucket.push(record);
    recordsByAlgorithm.set(record.algorithmId, bucket);
  }

  const ids = new Set(definitions.map((definition) => definition.algorithmId));
  for (const algorithmId of recordsByAlgorithm.keys()) ids.add(algorithmId);

  return [...ids]
    .map((algorithmId) => {
      const rows = recordsByAlgorithm.get(algorithmId) ?? [];
      const definition = definitions.find((candidate) => candidate.algorithmId === algorithmId);
      const currentRows = definition?.version === undefined
        ? rows
        : rows.filter((record) => record.version === definition.version);
      const durations = currentRows
        .map((record) => record.durationMs)
        .sort((a, b) => a - b);
      const last = currentRows.length > 0 ? currentRows[currentRows.length - 1] : undefined;
      return {
        algorithmId,
        version: definition?.version ?? last?.version ?? null,
        domain: definition?.domain ?? last?.domain ?? 'other',
        totalRuns: currentRows.length,
        historicalRuns: rows.length - currentRows.length,
        graded: currentRows.filter((record) => record.outcome !== undefined).length,
        pending: currentRows.filter((record) => record.outcome === undefined).length,
        errors: currentRows.filter((record) => record.label === 'error').length,
        lastRunAt: last?.at ?? null,
        latencyMs: {
          p50: percentile(durations, 50),
          p95: percentile(durations, 95),
          max: durations.length > 0 ? durations[durations.length - 1] ?? 0 : 0,
          mean: durations.length === 0
            ? 0
            : durations.reduce((sum, duration) => sum + duration, 0) / durations.length,
          last: last?.durationMs ?? 0,
        },
      };
    })
    .sort((a, b) => {
      if (a.errors !== b.errors) return b.errors - a.errors;
      if (a.latencyMs.p95 !== b.latencyMs.p95) return b.latencyMs.p95 - a.latencyMs.p95;
      return a.algorithmId.localeCompare(b.algorithmId);
    });
}

function percentile(sorted: readonly number[], percentileValue: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.floor((percentileValue / 100) * sorted.length),
  );
  return sorted[index] ?? 0;
}

function copyTuning(tuning: AlgorithmAdjustmentTuning): AlgorithmAdjustmentTuning {
  return {
    algorithmId: tuning.algorithmId,
    parameters: tuning.parameters.map((parameter) => ({ ...parameter })),
  };
}

function toRecentEvaluation(record: EvaluationRecord): RecentAlgorithmEvaluation {
  return {
    id: record.id,
    algorithmId: record.algorithmId,
    domain: record.domain,
    at: record.at,
    durationMs: record.durationMs,
    score: record.score,
    label: record.label,
    outcome: record.outcome,
    outcomeAt: record.outcomeAt,
    version: record.version,
    outcomeOrigin: record.outcome === undefined
      ? undefined
      : outcomeOriginFor(record),
    forecastLinked: record.forecastTarget !== undefined,
  };
}

function countOutcomeOrigins(
  records: readonly EvaluationRecord[],
): OutcomeOriginCounts {
  const counts: OutcomeOriginCounts = {
    direct: 0,
    proxy: 0,
    manual: 0,
    llm: 0,
  };
  for (const record of records) {
    if (record.outcome === undefined) continue;
    counts[outcomeOriginFor(record)] += 1;
  }
  return counts;
}

function outcomeOriginFor(record: EvaluationRecord): OutcomeLabelOrigin {
  if (record.outcomeOrigin) return record.outcomeOrigin;
  return record.outcomeReason?.startsWith('llm-grader:') ? 'llm' : 'manual';
}
