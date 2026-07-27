import {
  summarizeCalibration,
  type EvaluationRecord,
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
import {
  brierScore,
  perDomainAccuracy,
  perSourceMultipliers,
  type PredictionRecord,
  type SourceMultiplier,
} from '../intelligence/forecast-calibration';

const RECENT_EVALUATION_LIMIT = 20;
const RECENT_TUNING_DECISION_LIMIT = 20;
const FORECAST_RESOLUTION_GRACE_MS = 15 * 60 * 1000;

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
}

export interface AlgorithmDiagnosticsSnapshot {
  schemaVersion: 1;
  generatedAt: number;
  ledger: {
    total: number;
    graded: number;
    pending: number;
    lastEvaluationAt: number | null;
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
  marketSpots: SpotPriceDiagnostics | null;
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
      persistence: { ...input.persistence },
    },
    health,
    forecastCalibration: buildForecastCalibrationDiagnostics(
      input.forecastPredictions ?? [],
      generatedAt,
      input.marketSpotPrices,
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
): ForecastCalibrationDiagnostics {
  const resolved = predictions.filter(
    (record) => record.status === 'resolved_true' || record.status === 'resolved_false',
  );
  const pending = predictions
    .filter((record) => record.status === 'pending')
    .sort((a, b) => a.predictedAt - b.predictedAt);
  const domainRows = perDomainAccuracy(predictions);
  const resolverDiagnostics = buildForecastResolverDiagnostics(predictions, resolved);

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
    marketSpots: marketSpotPrices ? { ...marketSpotPrices } : null,
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
  };
}
