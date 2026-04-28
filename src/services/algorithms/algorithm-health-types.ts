/**
 * Shared algorithm health types — per
 * docs/ALGORITHM_DIAGNOSTICS_SELF_IMPROVEMENT_PLAN.md PR 1 (lines 369-378).
 *
 * Pure type module: no runtime, no DOM. PRs 2-4 (ledger, health
 * aggregator, safe adjustment engine) read and write these shapes.
 *
 * Plan invariants:
 *   - Every record JSON-serializable (export bundle)
 *   - Adjustments are always bounded + explainable
 *   - Safety-critical algorithms cannot be silenced from this layer
 */

// ── Status ──────────────────────────────────────────────────────────────

/** 5-level algorithm status. 'unsafe' means a safety-critical algorithm
 *  is failing in a way that would cause silent misses; the system
 *  diagnostic should escalate immediately. */
export type AlgorithmStatus =
  | 'healthy'
  | 'watch'
  | 'degraded'
  | 'unsafe'
  | 'unknown';

// ── Adjustment kinds ────────────────────────────────────────────────────

/** Whitelist of allowed self-adjustments per the plan's "Allowed
 *  adjustments" section (lines 285-293). Anything outside this enum
 *  requires user/PR review. */
export type AlgorithmAdjustmentKind =
  | 'source_multiplier'
  | 'relevance_boost'
  | 'correlation_pair_multiplier'
  | 'notification_threshold_nudge'
  | 'watch_window_duration_nudge'
  | 'stale_dependency_penalty'
  | 'ranking_weight_adjustment';

export interface AlgorithmAdjustment {
  algorithmId: string;
  kind: AlgorithmAdjustmentKind;
  /** Numeric value the adjustment proposes (delta or multiplier
   *  depending on kind). Bounded by the safe adjustment engine. */
  value: number;
  /** Direction the adjustment moves the algorithm. */
  direction: 'tighten' | 'loosen' | 'shift';
  /** Free-text reason — required by the plan. */
  reason: string;
  /** ms timestamp when the adjustment was proposed. */
  proposedAt: number;
  /** ms timestamp when the adjustment was applied. Undefined when
   *  pending. */
  appliedAt?: number;
  /** Sample size that drove the proposal. The engine refuses to act
   *  below the configured minimum. */
  sampleSize: number;
  /** Optional value that would be restored if rolled back. */
  rollbackValue?: number;
}

// ── Algorithm health record ─────────────────────────────────────────────

export interface AlgorithmHealth {
  algorithmId: string;
  status: AlgorithmStatus;

  /** Brier score over the most-recent window (0..1, lower is better).
   *  Undefined when the algorithm doesn't produce binary forecasts. */
  brier?: number;
  /** |meanProbability − hitRate| over resolved predictions. */
  calibrationError?: number;
  /** Resolved-true / resolved fraction. */
  hitRate?: number;
  /** 0..1 — lower is better. Estimate of the algorithm's tendency to
   *  fire on benign signals. */
  falsePositiveRisk?: number;
  /** 0..1 — lower is better. Estimate of the algorithm's tendency to
   *  miss real events. The plan singles this one out — for safety
   *  algorithms this MUST stay near zero. */
  falseNegativeRisk?: number;
  /** 0..1 user-noise score derived from the alert-fatigue learner.
   *  Higher = users are dismissing this algorithm's outputs more often. */
  userNoiseScore?: number;
  /** ms — p95 latency over the most-recent window. */
  latencyP95?: number;
  /** 0..1 confidence dampener applied because dependencies are stale
   *  or otherwise degraded. */
  dataQualityPenalty?: number;
  /** When non-undefined, the safe adjustment engine has a recommended
   *  bounded change ready to apply (after sample size + safety gates). */
  recommendedAdjustment?: AlgorithmAdjustment;
  /** Plain-text explanation lines for the UI. Plan invariant:
   *  every algorithm health record must explain itself. */
  explanation: readonly string[];
}

// ── Aggregate report ────────────────────────────────────────────────────

export interface AlgorithmHealthReport {
  generatedAt: number;
  status: AlgorithmStatus;
  /** Plain-English summary the diagnostic surface can render without
   *  parsing the records. */
  summary: string;
  algorithms: readonly AlgorithmHealth[];
  /** Pending self-adjustments awaiting application. */
  pendingAdjustments: readonly AlgorithmAdjustment[];
  /** Adjustments applied in the most-recent window. */
  recentAdjustments: readonly AlgorithmAdjustment[];
  /** Targeted remediation hints — same pattern as weather miss
   *  diagnostics. */
  recommendations: readonly string[];
}
