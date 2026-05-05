/**
 * Outcome Resolver — PR 3 of the Algorithm Accuracy Enhancement Plan.
 *
 * Grades algorithm decisions once ground truth is observable. Walks the
 * pending queue from the AlgorithmEvaluationLedger, decides whether each
 * record is now ripe for grading (delay-based), and writes back a hit /
 * miss / partial / inconclusive verdict.
 *
 * Pure-deterministic core: `gradeRecord` and `selectDueRecords` take
 * inputs and return outputs. Side effects (ledger writes, scheduler) are
 * confined to the orchestrator helpers at the bottom.
 *
 * Outcome semantics (mapped to the existing 4-value EvaluationOutcome):
 *   TRUE_POSITIVE  -> 'hit'          (predicted event occurred + alert fired correctly)
 *   FALSE_POSITIVE -> 'miss'         (alert fired but predicted event did not occur)
 *   TRUE_NEGATIVE  -> 'inconclusive' (no alert and no event - silent success, not graded as hit)
 *   FALSE_NEGATIVE -> 'miss'         (event occurred but no alert)
 *   INCONCLUSIVE   -> 'inconclusive'
 *
 * The ledger uses {hit, miss, partial, inconclusive}. The richer 5-value
 * resolver verdict is preserved in `outcomeReason` so the metrics layer
 * (PR 4) can split precision and recall properly.
 */

import type {
  AlgorithmEvaluationLedger,
  EvaluationRecord,
} from './algorithm-evaluation-ledger';
import type { AlgorithmDomain } from './algorithm-evaluation-ledger';

// Public types

export type ResolverVerdict =
  | 'TRUE_POSITIVE'
  | 'FALSE_POSITIVE'
  | 'TRUE_NEGATIVE'
  | 'FALSE_NEGATIVE'
  | 'INCONCLUSIVE';

export interface GroundTruthObservation {
  /** Did the predicted event actually occur in the wild? */
  eventOccurred: boolean;
  /** Did the alert / decision fire (the algorithm said "yes")? Inferred
   *  from `record.score`/`record.label` if not provided here. */
  alertFired?: boolean;
  /** Severity actually observed, normalized 0..1. Used to detect a
   *  partial hit (event occurred but at a much lower severity than predicted). */
  observedSeverity?: number;
  /** Severity that the algorithm predicted, normalized 0..1. If absent,
   *  the resolver treats the record's `score` field as the prediction. */
  predictedSeverity?: number;
  /** Free-text observation reason - e.g. "tornado touched down at 3:42pm". */
  notes?: string;
}

export interface GradeResult {
  verdict: ResolverVerdict;
  outcome: EvaluationRecord['outcome'];
  reason: string;
}

export interface ResolverDelayPolicy {
  /** Default delay in ms before a record is eligible for grading. */
  defaultDelayMs: number;
  /** Per-domain overrides. Geopolitical / intelligence domains tend to
   *  need longer windows for ground truth to surface. */
  domainOverrides?: Partial<Record<AlgorithmDomain, number>>;
}

export const DEFAULT_RESOLVER_DELAYS: ResolverDelayPolicy = {
  defaultDelayMs: 24 * 60 * 60 * 1000,
  domainOverrides: {
    compound_risk: 72 * 60 * 60 * 1000,
    forecast_calibration: 72 * 60 * 60 * 1000,
    reasoning_hypothesis: 72 * 60 * 60 * 1000,
    situation_clustering: 72 * 60 * 60 * 1000,
  },
};

// Core grading

export function gradeRecord(
  record: EvaluationRecord,
  observation: GroundTruthObservation,
): GradeResult {
  const alertFired =
    observation.alertFired ?? defaultAlertFired(record);
  const predicted = observation.predictedSeverity ?? record.score;
  const observed = observation.observedSeverity;
  const note = observation.notes ? ` ${observation.notes}` : '';

  if (observation.eventOccurred && alertFired) {
    if (
      typeof predicted === 'number' &&
      typeof observed === 'number' &&
      Number.isFinite(predicted) &&
      Number.isFinite(observed) &&
      observed + 0.1 < predicted
    ) {
      return {
        verdict: 'TRUE_POSITIVE',
        outcome: 'partial',
        reason: `partial hit: predicted ${predicted.toFixed(2)}, observed ${observed.toFixed(2)}.${note}`.trim(),
      };
    }
    return {
      verdict: 'TRUE_POSITIVE',
      outcome: 'hit',
      reason: `event occurred and alert fired.${note}`.trim(),
    };
  }

  if (observation.eventOccurred && !alertFired) {
    return {
      verdict: 'FALSE_NEGATIVE',
      outcome: 'miss',
      reason: `event occurred but alert did not fire.${note}`.trim(),
    };
  }

  if (!observation.eventOccurred && alertFired) {
    return {
      verdict: 'FALSE_POSITIVE',
      outcome: 'miss',
      reason: `alert fired but event did not occur.${note}`.trim(),
    };
  }

  return {
    verdict: 'TRUE_NEGATIVE',
    outcome: 'inconclusive',
    reason: `no event, no alert.${note}`.trim(),
  };
}

function defaultAlertFired(record: EvaluationRecord): boolean {
  if (typeof record.score === 'number' && Number.isFinite(record.score)) {
    return record.score >= 0.5;
  }
  if (typeof record.label === 'string' && record.label.length > 0) {
    return record.label !== 'no_alert';
  }
  return false;
}

// Delay scheduling

export function delayForRecord(
  record: EvaluationRecord,
  policy: ResolverDelayPolicy = DEFAULT_RESOLVER_DELAYS,
): number {
  return policy.domainOverrides?.[record.domain] ?? policy.defaultDelayMs;
}

export function selectDueRecords(
  records: readonly EvaluationRecord[],
  nowMs: number,
  policy: ResolverDelayPolicy = DEFAULT_RESOLVER_DELAYS,
): EvaluationRecord[] {
  return records.filter((r) => {
    if (r.outcome !== undefined) return false;
    return r.at + delayForRecord(r, policy) <= nowMs;
  });
}

// Orchestrator

export interface PendingResolution {
  id: string;
  algorithmId: string;
  domain: AlgorithmDomain;
  recordedAt: number;
  /** ms until eligible for grading. Negative means already due. */
  msUntilDue: number;
  score?: number;
  label?: string;
}

export interface ResolverDeps {
  ledger: AlgorithmEvaluationLedger;
  now?: () => number;
  policy?: ResolverDelayPolicy;
}

export function listPendingResolutions(deps: ResolverDeps): PendingResolution[] {
  const now = deps.now ?? Date.now;
  const policy = deps.policy ?? DEFAULT_RESOLVER_DELAYS;
  const t = now();
  return deps.ledger
    .pending()
    .map((r) => ({
      id: r.id,
      algorithmId: r.algorithmId,
      domain: r.domain,
      recordedAt: r.at,
      msUntilDue: r.at + delayForRecord(r, policy) - t,
      score: r.score,
      label: r.label,
    }))
    .sort((a, b) => a.msUntilDue - b.msUntilDue);
}

export function applyManualGrade(
  deps: ResolverDeps,
  args: { id: string; observation: GroundTruthObservation },
): { record: EvaluationRecord; result: GradeResult } {
  const existing = deps.ledger.get(args.id);
  if (!existing) {
    throw new Error(`Unknown evaluation id: ${args.id}`);
  }
  if (existing.outcome) {
    throw new Error(`Evaluation "${args.id}" already graded as ${existing.outcome}`);
  }
  const result = gradeRecord(existing, args.observation);
  if (result.outcome === undefined) {
    throw new Error('grade result produced no outcome');
  }
  const reasonWithVerdict = `[${result.verdict}] ${result.reason}`;
  const updated = deps.ledger.recordOutcome(args.id, result.outcome, reasonWithVerdict);
  return { record: updated, result };
}

export function extractVerdict(reason: string | undefined): ResolverVerdict | undefined {
  if (!reason) return undefined;
  const m = /^\[(TRUE_POSITIVE|FALSE_POSITIVE|TRUE_NEGATIVE|FALSE_NEGATIVE|INCONCLUSIVE)\]/.exec(reason);
  return m ? (m[1] as ResolverVerdict) : undefined;
}
