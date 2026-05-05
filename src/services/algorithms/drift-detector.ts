/**
 * Temporal Drift Detection — PR 12.
 *
 * Detect when an algorithm's performance characteristics shift
 * significantly over time using a Page-Hinkley test on the rolling
 * F1 score.
 *
 * Page-Hinkley accumulates the deviation (F1_t - threshold). On a
 * positive deviation (F1 ≥ threshold) the statistic resets toward
 * zero — only sustained downward drift accumulates. When |statistic|
 * exceeds λ, drift is declared.
 *
 * Pure deterministic. No DOM, no fetch.
 */

import { computeF1ForAlgorithm } from './ensemble-voter.ts';
import type { EvaluationRecord } from './algorithm-evaluation-ledger.ts';

// ── Types ──────────────────────────────────────────────────────────────

export type DriftAction = 'retune' | 'shadow' | 'review' | 'none';

export interface DriftAlert {
  algorithmId: string;
  detectedAt: number;
  /** Last known stable F1 (rolling mean before drift). */
  lastStableF1: number;
  /** Most recent F1 used in the test. */
  currentF1: number;
  /** Page-Hinkley statistic at trigger. */
  statistic: number;
  recommendedAction: DriftAction;
  /** Number of buckets contributing to the statistic. */
  sampleBuckets: number;
}

export interface DriftStatus {
  algorithmId: string;
  /** Current Page-Hinkley statistic (always ≥ 0; positive means
   *  performance below threshold). */
  statistic: number;
  /** Rolling threshold (mean of F1 buckets, or explicit). */
  threshold: number;
  /** Latest computed F1. */
  currentF1: number;
  /** True when |statistic| > λ. */
  alerting: boolean;
  /** Drift alert when alerting. */
  alert?: DriftAlert;
}

export interface DriftDetectorOptions {
  /** Trigger when the Page-Hinkley statistic exceeds this. Spec
   *  default is 50; smaller values trigger sooner. */
  lambda?: number;
  /** Tolerance subtracted from each delta — protects against natural
   *  variation. Smaller → more sensitive. */
  delta?: number;
  /** Bucket length over which to compute one F1 sample (ms). */
  bucketMs?: number;
  /** Number of buckets to keep in the rolling window. */
  windowBuckets?: number;
  /** Optional explicit reference threshold; otherwise use the
   *  rolling mean of buckets up to (but not including) the latest. */
  threshold?: number;
  now?: () => number;
}

const DEFAULTS = {
  lambda: 50,
  delta: 0,
  bucketMs: 24 * 60 * 60 * 1000,
  windowBuckets: 30,
};

// ── Core math ──────────────────────────────────────────────────────────

/** Compute per-bucket F1 series for a single algorithm. Most-recent
 *  bucket is last. Buckets without graded records get F1=0. */
export function buildF1Buckets(
  records: readonly EvaluationRecord[],
  algorithmId: string,
  options: { bucketMs: number; windowBuckets: number; now: number },
): number[] {
  const buckets: number[] = [];
  for (let i = options.windowBuckets - 1; i >= 0; i -= 1) {
    const end = options.now - i * options.bucketMs;
    const f1 = computeF1ForAlgorithm(records, algorithmId, {
      windowMs: options.bucketMs,
      now: end,
    });
    buckets.push(f1);
  }
  return buckets;
}

/** Run Page-Hinkley over an F1 series. Returns the final statistic
 *  and the last index where the statistic reset (the last "stable"
 *  point). */
export function pageHinkley(
  series: readonly number[],
  threshold: number,
  delta: number,
): { statistic: number; lastStableIndex: number } {
  let cumSum = 0;
  let lastStableIndex = 0;
  for (const [i, element] of series.entries()) {
    const x = element!;
    const dev = threshold - x - delta; // positive when below threshold
    cumSum += dev;
    if (cumSum < 0) {
      cumSum = 0;
      lastStableIndex = i;
    }
  }
  return { statistic: cumSum, lastStableIndex };
}

/** Evaluate drift for one algorithm. */
export function evaluateDrift(
  records: readonly EvaluationRecord[],
  algorithmId: string,
  options: DriftDetectorOptions = {},
): DriftStatus {
  const lambda = options.lambda ?? DEFAULTS.lambda;
  const delta = options.delta ?? DEFAULTS.delta;
  const bucketMs = options.bucketMs ?? DEFAULTS.bucketMs;
  const windowBuckets = options.windowBuckets ?? DEFAULTS.windowBuckets;
  const now = (options.now ?? (() => Date.now()))();

  const series = buildF1Buckets(records, algorithmId, { bucketMs, windowBuckets, now });
  const currentF1 = series.length > 0 ? series[series.length - 1]! : 0;

  const threshold = options.threshold ?? meanOf(series.slice(0, -1)) ?? currentF1;
  const { statistic, lastStableIndex } = pageHinkley(series, threshold, delta);
  const alerting = statistic > lambda;

  const status: DriftStatus = {
    algorithmId,
    statistic,
    threshold,
    currentF1,
    alerting,
  };
  if (alerting) {
    status.alert = {
      algorithmId,
      detectedAt: now,
      lastStableF1: series[lastStableIndex] ?? threshold,
      currentF1,
      statistic,
      recommendedAction: recommendAction(statistic, lambda, currentF1, threshold),
      sampleBuckets: series.length,
    };
  }
  return status;
}

/** Map a drift statistic to a recommended action. */
function recommendAction(
  statistic: number,
  lambda: number,
  currentF1: number,
  threshold: number,
): DriftAction {
  // Severe drop in F1 → review. Sustained but mild → shadow. Mild but
  // crossed λ → retune.
  const drop = threshold - currentF1;
  if (statistic > 3 * lambda || drop > 0.3) return 'review';
  if (statistic > 2 * lambda || drop > 0.15) return 'shadow';
  return 'retune';
}

function meanOf(arr: readonly number[]): number | undefined {
  if (arr.length === 0) return undefined;
  let sum = 0;
  for (const x of arr) sum += x;
  return sum / arr.length;
}

// ── Drift history ledger ──────────────────────────────────────────────

const driftHistory = new Map<string, DriftAlert[]>();

export function recordDriftAlert(alert: DriftAlert, options: { maxPerAlgorithm?: number } = {}): void {
  const max = options.maxPerAlgorithm ?? 50;
  const list = driftHistory.get(alert.algorithmId) ?? [];
  list.push({ ...alert });
  while (list.length > max) list.shift();
  driftHistory.set(alert.algorithmId, list);
}

export function getDriftHistory(algorithmId: string): DriftAlert[] {
  return [...(driftHistory.get(algorithmId) ?? [])];
}

export function listAllDriftHistory(): Record<string, DriftAlert[]> {
  const out: Record<string, DriftAlert[]> = {};
  for (const [id, list] of driftHistory) out[id] = [...list];
  return out;
}

export function _resetDriftHistoryForTests(): void {
  driftHistory.clear();
}
