import {
  summarizeCalibration,
  type EvaluationRecord,
} from './algorithm-evaluation-ledger';
import {
  aggregateAlgorithmHealth,
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

const RECENT_EVALUATION_LIMIT = 20;
const RECENT_TUNING_DECISION_LIMIT = 20;

export interface AlgorithmRuntimeDiagnostics {
  algorithmId: string;
  domain: string;
  totalRuns: number;
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
  persistence: AlgorithmLedgerPersistenceStatus;
  tunings: readonly AlgorithmAdjustmentTuning[];
  tuningDecisions: readonly TuningDecision[];
}

export function buildAlgorithmDiagnosticsSnapshot(
  input: BuildAlgorithmDiagnosticsInput,
): AlgorithmDiagnosticsSnapshot {
  const generatedAt = input.generatedAt ?? Date.now();
  const records = [...input.records].sort((a, b) => a.at - b.at);
  const calibrations = summarizeCalibration(records);
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
      const durations = rows.map((record) => record.durationMs).sort((a, b) => a - b);
      const last = rows.length > 0 ? rows[rows.length - 1] : undefined;
      const definition = definitions.find((candidate) => candidate.algorithmId === algorithmId);
      return {
        algorithmId,
        domain: definition?.domain ?? last?.domain ?? 'other',
        totalRuns: rows.length,
        graded: rows.filter((record) => record.outcome !== undefined).length,
        pending: rows.filter((record) => record.outcome === undefined).length,
        errors: rows.filter((record) => record.label === 'error').length,
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
