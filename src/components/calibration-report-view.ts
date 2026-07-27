import type { ReliabilityCurve } from '@/services/cognition/recalibration';
import type { CalibrationComparison } from '@/services/cognition/forecast-journal';
import { brierScore } from '@/services/intelligence/forecast-calibration';
import type { PredictionRecord } from '@/services/intelligence/forecast-calibration';
import {
  brierContribution,
  evaluateForecastCohort,
  horizonBucket,
  type EvidenceMetric,
  type EqualMassEceMetric,
  type ForecastCohortEvaluation,
} from '@/services/intelligence/forecast-evaluation';
import type { ReliabilityPoint } from '@/services/intelligence/proper-scoring';

/** Below this many resolved predictions a per-domain Brier score is too
 *  noisy to show — the row reports it as null (rendered as "—") instead. */
const MIN_RESOLVED_FOR_BRIER = 5;

export interface CalibrationReportRow {
  predicted: number;
  observed: number;
  count: number;
}

export interface CalibrationReportView {
  headline: string;
  rows: CalibrationReportRow[];
  hasOperatorData: boolean;
  operatorLine?: string;
}

export interface BuildCalibrationReportInput {
  curve: ReliabilityCurve;
  coveragePct: number;
  comparison: CalibrationComparison | null;
}

export function buildCalibrationReport(input: BuildCalibrationReportInput): CalibrationReportView {
  const { curve, coveragePct, comparison } = input;

  const rows: CalibrationReportRow[] = curve.bins.map(bin => ({
    predicted: bin.predictedMean,
    observed: bin.observedRate,
    count: bin.n,
  }));

  const headline = `System calibration · ${coveragePct}% conformal coverage`;

  const hasOperatorData = !!comparison && comparison.operator.n > 0;
  const operatorLine = hasOperatorData
    ? `operator Brier ${comparison!.operator.brier.toFixed(3)} (n=${comparison!.operator.n}) vs system Brier ${comparison!.system.brier.toFixed(3)} (n=${comparison!.system.n})`
    : undefined;

  return { headline, rows, hasOperatorData, operatorLine };
}

// ── Per-domain report card (Prediction Uplift PR A3) ────────────────────────

export interface DomainReportRow {
  domain: string;
  total: number;
  resolved: number;
  brier: number | null;
}

export interface DomainReportCard {
  rows: DomainReportRow[];
}

/**
 * Groups prediction records by domain and summarizes each into a report-card
 * row: total predictions logged, how many resolved, and the resolved-set
 * Brier score (null until MIN_RESOLVED_FOR_BRIER is reached — a handful of
 * resolutions is too noisy to be worth showing). Rows are sorted by resolved
 * count descending so the most-evidenced domains surface first.
 */
export function buildDomainReportCard(records: readonly PredictionRecord[]): DomainReportCard {
  const byDomain = new Map<string, PredictionRecord[]>();
  for (const r of records) {
    const list = byDomain.get(r.domain) ?? [];
    list.push(r);
    byDomain.set(r.domain, list);
  }
  const rows = [...byDomain.entries()]
    .map(([domain, list]) => {
      const resolved = list.filter((r) => r.status === 'resolved_true' || r.status === 'resolved_false');
      return {
        domain,
        total: list.length,
        resolved: resolved.length,
        brier: resolved.length >= MIN_RESOLVED_FOR_BRIER
          ? Math.round(brierScore(resolved).score * 10_000) / 10_000
          : null,
      };
    })
    .sort((a, b) => b.resolved - a.resolved);
  return { rows };
}

// ── Per-forecast workbench (ACC-202) ───────────────────────────────────────

export type ForecastResolutionMethod = 'direct' | 'proxy' | 'manual' | 'unresolved';
export type ForecastMetricExclusionReason = 'training' | 'proxy' | 'unscored';
export type ForecastObservedOutcome = 0 | 1 | null;
export type ForecastWorkbenchSortField =
  | 'brier'
  | 'probability'
  | 'evidenceAge'
  | 'target';
export type ForecastWorkbenchSortDirection = 'asc' | 'desc';

export interface ForecastWorkbenchFilters {
  source: string;
  domain: string;
  horizon: string;
  version: string;
  resolutionMethod: string;
}

export interface ForecastWorkbenchState {
  filters: ForecastWorkbenchFilters;
  sort: {
    field: ForecastWorkbenchSortField;
    direction: ForecastWorkbenchSortDirection;
  };
}

export interface ForecastWorkbenchRow {
  id: string;
  target: string;
  claim: string;
  source: string;
  domain: string;
  horizon: string;
  version: string;
  resolutionMethod: ForecastResolutionMethod;
  status: PredictionRecord['status'];
  probability: number | null;
  outcome: ForecastObservedOutcome;
  brierContribution: number | null;
  evidenceAgeMs: number | null;
  resolutionNote: string;
  predictedAt: number;
  excludedFromMetrics: boolean;
  metricExclusionReason: ForecastMetricExclusionReason | null;
}

export interface ForecastFilterOption {
  value: string;
  count: number;
}

export interface ForecastWorkbenchMetric {
  status: 'ok' | 'insufficient_evidence';
  sampleSize: number;
  value?: number;
  minSampleSize?: number;
  reason?: string;
}

export type ForecastReliabilityView =
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
      bins: readonly [];
      reason?: string;
    };

export interface ForecastCohortSummary {
  total: number;
  scored: number;
  proxyLabelsExcluded: number;
  brier: ForecastWorkbenchMetric;
  ece: ForecastWorkbenchMetric;
}

export interface ForecastWorkbenchView {
  totalRecords: number;
  totalMatching: number;
  hasActiveFilters: boolean;
  rows: readonly ForecastWorkbenchRow[];
  worstErrors: readonly ForecastWorkbenchRow[];
  highConfidenceMisses: readonly ForecastWorkbenchRow[];
  reliability: ForecastReliabilityView;
  comparison: {
    overall: ForecastCohortSummary;
    selected: ForecastCohortSummary;
  };
  window: {
    trainingRecords: number;
    evaluationRecords: number;
    evaluationWindowStart?: number;
  };
  filterOptions: {
    sources: readonly ForecastFilterOption[];
    domains: readonly ForecastFilterOption[];
    horizons: readonly ForecastFilterOption[];
    versions: readonly ForecastFilterOption[];
    resolutionMethods: readonly ForecastFilterOption[];
  };
}

export interface ForecastWorkbenchOptions {
  minResolved?: number;
  minTrainingResolved?: number;
  binCount?: number;
}

const ALL_FILTERS = 'all';
const WORKBENCH_TRAINING_SHARE = 0.6;
const DRILLDOWN_LIMIT = 5;
const HORIZON_ORDER = ['<1h', '1h-6h', '6h-24h', '1d-7d', '7d-30d', '30d+', 'invalid'];
const RESOLUTION_ORDER: readonly ForecastResolutionMethod[] = [
  'direct',
  'manual',
  'proxy',
  'unresolved',
];

export function createForecastWorkbenchState(): ForecastWorkbenchState {
  return {
    filters: {
      source: ALL_FILTERS,
      domain: ALL_FILTERS,
      horizon: ALL_FILTERS,
      version: ALL_FILTERS,
      resolutionMethod: ALL_FILTERS,
    },
    sort: {
      field: 'brier',
      direction: 'desc',
    },
  };
}

export function buildForecastWorkbench(
  records: readonly PredictionRecord[],
  state: ForecastWorkbenchState = createForecastWorkbenchState(),
  options: ForecastWorkbenchOptions = {},
): ForecastWorkbenchView {
  const split = splitForecastRecords(records);
  const matches = (record: PredictionRecord): boolean =>
    recordMatchesFilters(record, state.filters);
  const selectedTraining = split.training.filter((record) => matches(record));
  const selectedEvaluation = split.evaluation.filter((record) => matches(record));
  const evaluationOptions = {
    minResolved: options.minResolved,
    minTrainingResolved: options.minTrainingResolved,
    binCount: options.binCount,
  };
  const overallEvaluation = evaluateForecastCohort({
    trainingRecords: split.training,
    evaluationRecords: split.evaluation,
  }, evaluationOptions);
  const selectedCohortEvaluation = evaluateForecastCohort({
    trainingRecords: selectedTraining,
    evaluationRecords: selectedEvaluation,
  }, evaluationOptions);
  const evaluationRecords = new Set(split.evaluation);
  const rows = records
    .filter((record) => matches(record))
    .map((record) => toWorkbenchRow(record, evaluationRecords.has(record)))
    .sort((left, right) => compareWorkbenchRows(left, right, state.sort));
  const scoredRows = rows.filter((row) =>
    row.brierContribution !== null && !row.excludedFromMetrics);

  return {
    totalRecords: records.length,
    totalMatching: rows.length,
    hasActiveFilters: Object.values(state.filters).some((value) => value !== ALL_FILTERS),
    rows,
    worstErrors: [...scoredRows]
      .sort((left, right) =>
        (right.brierContribution ?? 0) - (left.brierContribution ?? 0)
        || left.id.localeCompare(right.id))
      .slice(0, DRILLDOWN_LIMIT),
    highConfidenceMisses: scoredRows
      .filter((row) => isHighConfidenceMiss(row))
      .sort((left, right) =>
        (right.brierContribution ?? 0) - (left.brierContribution ?? 0)
        || left.id.localeCompare(right.id))
      .slice(0, DRILLDOWN_LIMIT),
    reliability: toReliabilityView(selectedCohortEvaluation.equalMassEce),
    comparison: {
      overall: toCohortSummary(overallEvaluation),
      selected: toCohortSummary(selectedCohortEvaluation),
    },
    window: {
      trainingRecords: split.training.length,
      evaluationRecords: split.evaluation.length,
      evaluationWindowStart: overallEvaluation.evaluationWindowStart,
    },
    filterOptions: buildFilterOptions(records),
  };
}

function toWorkbenchRow(
  record: PredictionRecord,
  isEvaluationRecord: boolean,
): ForecastWorkbenchRow {
  const outcome = resolvedOutcome(record);
  const probability = Number.isFinite(record.probability)
    ? Math.max(0, Math.min(1, record.probability))
    : null;
  const resolutionMethod = getResolutionMethod(record);
  const metricExclusionReason = getMetricExclusionReason({
    isEvaluationRecord,
    resolutionMethod,
    probability,
    outcome,
  });

  return {
    id: record.id,
    target: record.targetKey ?? record.claim,
    claim: record.claim,
    source: record.sourceId,
    domain: record.domain,
    horizon: horizonBucket(record.resolveBy - record.predictedAt),
    version: record.algorithmVersion ?? 'unversioned',
    resolutionMethod,
    status: record.status,
    probability,
    outcome,
    brierContribution:
      probability !== null && outcome !== null
        ? brierContribution(probability, outcome)
        : null,
    evidenceAgeMs: evidenceAgeAtResolution(record),
    resolutionNote: record.resolutionNote ?? '',
    predictedAt: record.predictedAt,
    excludedFromMetrics: metricExclusionReason !== null,
    metricExclusionReason,
  };
}

function getMetricExclusionReason(input: {
  isEvaluationRecord: boolean;
  resolutionMethod: ForecastResolutionMethod;
  probability: number | null;
  outcome: ForecastObservedOutcome;
}): ForecastMetricExclusionReason | null {
  if (!input.isEvaluationRecord) return 'training';
  if (input.resolutionMethod === 'proxy') return 'proxy';
  if (input.probability === null || input.outcome === null) return 'unscored';
  return null;
}

function resolvedOutcome(record: PredictionRecord): ForecastObservedOutcome {
  if (record.status === 'resolved_true') return 1;
  if (record.status === 'resolved_false') return 0;
  return null;
}

function splitForecastRecords(records: readonly PredictionRecord[]): {
  training: PredictionRecord[];
  evaluation: PredictionRecord[];
} {
  const ordered = [...records].sort((left, right) => {
    const leftTime = Number.isFinite(left.predictedAt)
      ? left.predictedAt
      : Number.POSITIVE_INFINITY;
    const rightTime = Number.isFinite(right.predictedAt)
      ? right.predictedAt
      : Number.POSITIVE_INFINITY;
    return leftTime - rightTime || left.id.localeCompare(right.id);
  });
  if (ordered.length === 0) return { training: [], evaluation: [] };
  if (ordered.length === 1) return { training: [], evaluation: ordered };
  const splitIndex = Math.max(
    1,
    Math.min(ordered.length - 1, Math.floor(ordered.length * WORKBENCH_TRAINING_SHARE)),
  );
  return {
    training: ordered.slice(0, splitIndex),
    evaluation: ordered.slice(splitIndex),
  };
}

function recordMatchesFilters(
  record: PredictionRecord,
  filters: ForecastWorkbenchFilters,
): boolean {
  return filterMatches(filters.source, record.sourceId)
    && filterMatches(filters.domain, record.domain)
    && filterMatches(
      filters.horizon,
      horizonBucket(record.resolveBy - record.predictedAt),
    )
    && filterMatches(filters.version, record.algorithmVersion ?? 'unversioned')
    && filterMatches(filters.resolutionMethod, getResolutionMethod(record));
}

function filterMatches(filter: string, value: string): boolean {
  return filter === ALL_FILTERS || filter === value;
}

function getResolutionMethod(record: PredictionRecord): ForecastResolutionMethod {
  if (record.status !== 'resolved_true' && record.status !== 'resolved_false') {
    return 'unresolved';
  }
  if (
    record.resolutionProvenance?.kind === 'proxy'
    || record.resolutionNote?.startsWith('proxy:') === true
  ) {
    return 'proxy';
  }
  if (
    record.resolutionProvenance?.kind === 'direct'
    || record.resolutionNote?.startsWith('direct:') === true
  ) {
    return 'direct';
  }
  return 'manual';
}

function evidenceAgeAtResolution(record: PredictionRecord): number | null {
  if (record.resolvedAt === undefined || !Number.isFinite(record.resolvedAt)) {
    return null;
  }
  const observedTimes = (record.resolutionProvenance?.evidence ?? [])
    .map((evidence) => evidence.observedAt)
    .filter((observedAt) => Number.isFinite(observedAt));
  if (observedTimes.length === 0) return null;
  const newestEvidence = Math.max(...observedTimes);
  if (newestEvidence > record.resolvedAt) return null;
  return record.resolvedAt - newestEvidence;
}

function compareWorkbenchRows(
  left: ForecastWorkbenchRow,
  right: ForecastWorkbenchRow,
  sort: ForecastWorkbenchState['sort'],
): number {
  if (sort.field === 'target') {
    const targetOrder = directionalOrder(
      left.target.localeCompare(right.target),
      sort.direction,
    );
    if (targetOrder !== 0) return targetOrder;
  }
  const numericOrder = nullableNumericOrder(
    workbenchSortValue(left, sort.field),
    workbenchSortValue(right, sort.field),
    sort.direction,
  );
  if (numericOrder !== 0) return numericOrder;
  return right.predictedAt - left.predictedAt || left.id.localeCompare(right.id);
}

function nullableNumericOrder(
  left: number | null,
  right: number | null,
  direction: ForecastWorkbenchSortDirection,
): number {
  if (left === null) {
    if (right === null) return 0;
    return 1;
  }
  if (right === null) return -1;
  return directionalOrder(left - right, direction);
}

function directionalOrder(
  comparison: number,
  direction: ForecastWorkbenchSortDirection,
): number {
  return direction === 'asc' ? comparison : -comparison;
}

function workbenchSortValue(
  row: ForecastWorkbenchRow,
  field: ForecastWorkbenchSortField,
): number | null {
  switch (field) {
    case 'brier': {
      return row.brierContribution;
    }
    case 'probability': {
      return row.probability;
    }
    case 'evidenceAge': {
      return row.evidenceAgeMs;
    }
    case 'target': {
      return null;
    }
  }
}

function isHighConfidenceMiss(row: ForecastWorkbenchRow): boolean {
  return row.probability !== null
    && (
      (row.probability >= 0.8 && row.outcome === 0)
      || (row.probability <= 0.2 && row.outcome === 1)
    );
}

function toReliabilityView(metric: EqualMassEceMetric): ForecastReliabilityView {
  if (metric.status === 'ok') {
    return {
      status: 'ok',
      sampleSize: metric.sampleSize,
      value: metric.value,
      bins: metric.bins,
    };
  }
  return {
    status: 'insufficient_evidence',
    sampleSize: metric.sampleSize,
    minSampleSize: metric.minSampleSize,
    bins: [],
    ...(metric.reason ? { reason: metric.reason } : {}),
  };
}

function toCohortSummary(evaluation: ForecastCohortEvaluation): ForecastCohortSummary {
  return {
    total: evaluation.coverage.total,
    scored: evaluation.scoredRecords.length,
    proxyLabelsExcluded: evaluation.exclusions.proxyLabels,
    brier: toWorkbenchMetric(evaluation.brier),
    ece: toWorkbenchMetric(evaluation.equalMassEce),
  };
}

function toWorkbenchMetric(metric: EvidenceMetric | EqualMassEceMetric): ForecastWorkbenchMetric {
  if (metric.status === 'ok') {
    return {
      status: 'ok',
      sampleSize: metric.sampleSize,
      value: metric.value,
    };
  }
  return {
    status: 'insufficient_evidence',
    sampleSize: metric.sampleSize,
    minSampleSize: metric.minSampleSize,
    ...(metric.reason ? { reason: metric.reason } : {}),
  };
}

function buildFilterOptions(records: readonly PredictionRecord[]): ForecastWorkbenchView['filterOptions'] {
  return {
    sources: countedOptions(records.map((record) => record.sourceId)),
    domains: countedOptions(records.map((record) => record.domain)),
    horizons: countedOptions(
      records.map((record) => horizonBucket(record.resolveBy - record.predictedAt)),
      HORIZON_ORDER,
    ),
    versions: countedOptions(
      records.map((record) => record.algorithmVersion ?? 'unversioned'),
    ),
    resolutionMethods: countedOptions(
      records.map((record) => getResolutionMethod(record)),
      RESOLUTION_ORDER,
    ),
  };
}

function countedOptions(
  values: readonly string[],
  preferredOrder?: readonly string[],
): ForecastFilterOption[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const order = preferredOrder
    ? new Map(preferredOrder.map((value, index) => [value, index]))
    : null;
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => {
      if (!order) return left.value.localeCompare(right.value);
      return (order.get(left.value) ?? Number.POSITIVE_INFINITY)
        - (order.get(right.value) ?? Number.POSITIVE_INFINITY)
        || left.value.localeCompare(right.value);
    });
}
