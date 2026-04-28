/**
 * Safe Adjustment Engine — per
 * docs/ALGORITHM_DIAGNOSTICS_SELF_IMPROVEMENT_PLAN.md PR 4.
 *
 * When the Algorithm Health Aggregator (PR 3) reports an algorithm
 * below floor, this engine proposes a *bounded* parameter adjustment
 * the operator can accept or reject. The engine never auto-applies
 * — every change is a proposal that requires explicit approval, and
 * the proposal carries the rationale, the predicted impact, and the
 * rollback path.
 *
 * Plan invariants:
 *   - Adjustments are always within the algorithm's declared
 *     tunable bounds (min/max/step). The engine refuses to propose
 *     an out-of-range value — it returns a 'manual_review' proposal
 *     instead.
 *   - Safety-critical algorithms get conservative deltas (half-steps)
 *     and require an extra calibration cushion before reverting.
 *   - Every proposal records the prior value so rollback is one call.
 *   - Output is JSON-serializable so proposals can sit in a queue
 *     and be reviewed across sessions.
 */

import type {
  AlgorithmCriticality,
  AlgorithmHealth,
  AlgorithmHealthStatus,
} from './algorithm-health';

// ── Public API ──────────────────────────────────────────────────────────

export type ParameterDirection = 'increase' | 'decrease';

export interface TunableParameter {
  /** Stable id, e.g. "polygon-buffer-km" or "relevance-threshold". */
  parameterId: string;
  /** Current value the algorithm runs with. */
  current: number;
  /** Minimum allowed value (inclusive). */
  min: number;
  /** Maximum allowed value (inclusive). */
  max: number;
  /** Step size for a single adjustment. The engine takes one step
   *  for non-safety algorithms, half a step for safety-critical
   *  ones. */
  step: number;
  /** Direction the engine should move when the algorithm misses.
   *  Some parameters need to go up to fix misses (e.g. polygon
   *  buffer); others need to go down (e.g. relevance threshold). */
  fixDirection: ParameterDirection;
  /** Human-readable description used in the proposal rationale. */
  description: string;
}

export interface AlgorithmAdjustmentTuning {
  algorithmId: string;
  parameters: readonly TunableParameter[];
}

export type AdjustmentVerdict =
  | 'apply'              // proposal: change current → next
  | 'noop'               // algorithm healthy, no change needed
  | 'at_bound'           // already at the safe bound; manual review needed
  | 'manual_review'      // status too severe for auto-tune (e.g. unsafe)
  | 'no_tunable';        // no tunables declared for this algorithm

export interface AdjustmentProposal {
  algorithmId: string;
  /** ms timestamp the proposal was generated. */
  generatedAt: number;
  verdict: AdjustmentVerdict;
  /** The specific parameter being moved. Undefined for noop /
   *  manual_review / no_tunable. */
  parameterId?: string;
  /** Prior value, captured before the proposed change. Required for
   *  rollback. */
  priorValue?: number;
  /** Proposed new value. */
  nextValue?: number;
  /** Direction we moved (matches the parameter's fixDirection). */
  direction?: ParameterDirection;
  /** Plain-English rationale — what observation drove the change. */
  rationale: string;
  /** Predicted effect on the calibration ("expected hit rate +5%"). */
  predictedEffect: string;
  /** Concrete rollback instructions in case the change makes things
   *  worse. */
  rollback?: string;
}

export interface AdjustmentEngineOptions {
  /** Optional clock for tests. Defaults to Date.now(). */
  now?: () => number;
}

export interface ProposeAdjustmentsInput {
  reports: readonly AlgorithmHealth[];
  /** Parameter tuning per algorithm. Algorithms without a tuning
   *  entry get a `no_tunable` proposal. */
  tunings: readonly AlgorithmAdjustmentTuning[];
}

/** Compute one proposal per algorithm in `reports`. Pure function. */
export function proposeAdjustments(
  input: ProposeAdjustmentsInput,
  options: AdjustmentEngineOptions = {},
): AdjustmentProposal[] {
  const now = options.now ?? (() => Date.now());
  const tuningById = new Map<string, AlgorithmAdjustmentTuning>();
  for (const t of input.tunings) tuningById.set(t.algorithmId, t);

  const out: AdjustmentProposal[] = [];
  for (const report of input.reports) {
    const tuning = tuningById.get(report.algorithmId);
    out.push(proposeForOne(report, tuning, now()));
  }
  return out;
}

function proposeForOne(
  report: AlgorithmHealth,
  tuning: AlgorithmAdjustmentTuning | undefined,
  generatedAt: number,
): AdjustmentProposal {
  if (report.status === 'healthy' || report.status === 'unknown') {
    return {
      algorithmId: report.algorithmId,
      generatedAt,
      verdict: 'noop',
      rationale:
        report.status === 'healthy'
          ? 'Algorithm is within calibration floor; no adjustment needed.'
          : 'Insufficient graded samples — no adjustment can be proposed yet.',
      predictedEffect: 'No change.',
    };
  }

  if (report.status === 'unsafe') {
    return {
      algorithmId: report.algorithmId,
      generatedAt,
      verdict: 'manual_review',
      rationale:
        'Algorithm is in an unsafe state. Auto-adjustment is too risky; quarantine and review the most-recent misses in the Evaluation Ledger.',
      predictedEffect: 'No change until manual review.',
    };
  }

  if (!tuning || tuning.parameters.length === 0) {
    return {
      algorithmId: report.algorithmId,
      generatedAt,
      verdict: 'no_tunable',
      rationale: 'No tunable parameters declared for this algorithm.',
      predictedEffect: 'No change.',
    };
  }

  // Pick the first tunable for now. Future work: rank by which
  // parameter the calibration miss-mode points to. This module is
  // deliberately conservative — one parameter per proposal.
  const param = tuning.parameters[0]!;
  const stepSize = stepForCriticality(param.step, report.criticality);
  const proposedNext = stepValue(param, stepSize);

  if (Math.abs(proposedNext - param.current) < 1e-9) {
    return {
      algorithmId: report.algorithmId,
      generatedAt,
      verdict: 'at_bound',
      parameterId: param.parameterId,
      priorValue: param.current,
      rationale: `Parameter "${param.parameterId}" is already at the ${param.fixDirection === 'increase' ? 'maximum' : 'minimum'} safe bound (${formatBound(param)}).`,
      predictedEffect: 'No further auto-adjustment available — manual review required.',
      rollback: 'No change to roll back.',
    };
  }

  return {
    algorithmId: report.algorithmId,
    generatedAt,
    verdict: 'apply',
    parameterId: param.parameterId,
    priorValue: param.current,
    nextValue: proposedNext,
    direction: param.fixDirection,
    rationale: `${report.reason} ${param.description} ${param.fixDirection === 'increase' ? 'increased' : 'decreased'} by ${formatNumber(Math.abs(proposedNext - param.current))} (criticality=${report.criticality}, step halved for safety: ${report.criticality === 'safety' ? 'yes' : 'no'}).`,
    predictedEffect: predictEffect(report.status, report.criticality),
    rollback: `Restore ${param.parameterId} to ${formatNumber(param.current)} via the Evaluation Ledger inspector.`,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

function stepForCriticality(step: number, criticality: AlgorithmCriticality): number {
  // Safety-critical algorithms move in half-steps so we don't
  // overcorrect on a stricter floor.
  return criticality === 'safety' ? step / 2 : step;
}

function stepValue(param: TunableParameter, stepSize: number): number {
  const next = param.fixDirection === 'increase'
    ? param.current + stepSize
    : param.current - stepSize;
  return clamp(next, param.min, param.max);
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function formatBound(param: TunableParameter): string {
  return param.fixDirection === 'increase' ? `max=${formatNumber(param.max)}` : `min=${formatNumber(param.min)}`;
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  // Trim trailing zeros (and any orphaned decimal point) without a
  // backtracking-prone regex.
  let out = n.toFixed(3);
  while (out.endsWith('0')) out = out.slice(0, -1);
  if (out.endsWith('.')) out = out.slice(0, -1);
  return out;
}

function predictEffect(
  status: AlgorithmHealthStatus,
  criticality: AlgorithmCriticality,
): string {
  // Conservative predictions — a half-step in safety mode usually
  // moves the rate by a few percentage points, not by entire deciles.
  if (status === 'failing') {
    return criticality === 'safety'
      ? 'Expected weighted hit rate +3% (safety half-step).'
      : 'Expected weighted hit rate +5%.';
  }
  if (status === 'degraded') {
    return criticality === 'safety'
      ? 'Expected weighted hit rate +2% (safety half-step).'
      : 'Expected weighted hit rate +3%.';
  }
  return 'Expected modest improvement.';
}
