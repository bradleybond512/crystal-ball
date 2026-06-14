/**
 * Historical Backtest — the "backtest-before-apply" gate (Phase 4 foundation).
 *
 * Before an automated tuning change (a threshold knob the closed-loop tuner
 * wants to move) is auto-applied to live inference, it must first be replayed
 * against the recent graded history in the Algorithm Evaluation Ledger. If the
 * candidate value would have made the algorithm LESS accurate than the current
 * value over that window, the change is blocked (the gate's `backtestPassed`
 * signal is false) and the runner holds it for user approval instead.
 *
 * This is NOT the synthetic `backtest-engine` (which models hand-authored
 * scenarios and cannot score an arbitrary knob). It is a pure, deterministic
 * replay over REAL recorded decisions:
 *
 *   1. Take the graded ledger records for the algorithm in the last N days.
 *   2. For each record we know the score the algorithm produced AND the
 *      ground-truth outcome (hit / miss / partial). Reconstruct the decision
 *      the CURRENT threshold made (fire iff score crosses the threshold), and
 *      derive what reality said "should" have happened from the outcome.
 *   3. Replay both the current and the candidate threshold over that labelled
 *      set and compare accuracy. The candidate passes only if it does not
 *      regress.
 *
 * Fail-closed by construction: a knob we don't know how to replay (its score
 * isn't comparable to the threshold), or a window without enough decisive
 * samples, returns `verdict: 'fail'`. The gate never auto-approves a change it
 * cannot prove safe.
 *
 * Pure deterministic. No DOM, no fetch, no globals at import time — the clock
 * is injected so the 30-day window is reproducible in tests.
 */

import type { EvaluationRecord } from './algorithm-evaluation-ledger';

// ── Public API ──────────────────────────────────────────────────────────

export interface BacktestChange {
  algorithmId: string;
  parameterId: string;
  /** The value live inference currently uses. */
  priorValue: number;
  /** The value the tuner proposes to apply. */
  nextValue: number;
}

export type BacktestVerdict = 'pass' | 'fail';

export interface BacktestResult {
  verdict: BacktestVerdict;
  /** Replayed accuracy of the CURRENT value over the window (0..1). NaN when
   *  the change isn't backtestable. */
  currentScore: number;
  /** Replayed accuracy of the CANDIDATE value over the window (0..1). NaN when
   *  the change isn't backtestable. */
  backtestScore: number;
  /** backtestScore − currentScore. Negative ⇒ regression ⇒ blocked. */
  delta: number;
  /** Decisive (hit/miss/partial) records inside the window the replay used. */
  sampleSize: number;
  /** Plan-readable explanation of the verdict. */
  reason: string;
}

export interface BacktestOptions {
  /** Reference "now" for the rolling window. Injected for tests. */
  now: number;
  /** Window length in days. Defaults to 30. */
  windowDays?: number;
}

// ── Tunables of the gate itself ───────────────────────────────────────────

/** Default historical window per the plan: 30 days of observations. */
export const DEFAULT_WINDOW_DAYS = 30;
/** Below this many decisive records the window is too thin to trust — fail
 *  closed rather than auto-apply on noise. */
export const MIN_DECISIVE_SAMPLES = 10;
/** Float tolerance so an exactly-equal replay (delta ≈ 0) is not read as a
 *  regression by rounding noise. The candidate must not be MEASURABLY worse. */
const REGRESSION_EPSILON = 1e-9;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Knobs whose ledger `score` is directly comparable to the threshold value, so
 * the fire decision can be honestly replayed. Anything not listed here is NOT
 * backtestable (its score lives on a different scale than the knob, e.g. a
 * continuous penalty multiplier) and fails closed.
 *
 * `compare`:
 *   - 'score_ge': the algorithm "fires" when score ≥ threshold (a minimum bar
 *     to qualify — big-event-detector total-score threshold).
 *   - 'score_lt': the algorithm "fires" when score < threshold (a floor below
 *     which something is disabled — kept for the inverse case).
 *
 * `recordedScoreScale`: multiplier that brings the ledger-recorded `score` onto
 * the knob's own units before the fire comparison. This MUST match the scale
 * the recording call site uses. big-event-detector records `totalScore / 100`
 * (a 0..1 value) but its `threshold` knob lives on the 0..100 totalScore scale
 * (range 20..60), so the recorded score is multiplied by 100 to compare. Get
 * this wrong and the comparison is always one-sided (every threshold yields the
 * same decision) — the gate would silently pass every change.
 */
const BACKTESTABLE_KNOBS: Record<string, { compare: 'score_ge' | 'score_lt'; recordedScoreScale: number }> = {
  'big-event-detector:threshold': { compare: 'score_ge', recordedScoreScale: 100 },
};

function knobKey(algorithmId: string, parameterId: string): string {
  return `${algorithmId}:${parameterId}`;
}

/** Whether a change is one the historical backtest knows how to replay. */
export function isBacktestable(algorithmId: string, parameterId: string): boolean {
  return Object.prototype.hasOwnProperty.call(BACKTESTABLE_KNOBS, knobKey(algorithmId, parameterId));
}

function fired(score: number, threshold: number, compare: 'score_ge' | 'score_lt'): boolean {
  return compare === 'score_ge' ? score >= threshold : score < threshold;
}

/**
 * The decision function: replay the proposed change against the graded ledger
 * history and decide whether it regresses accuracy.
 *
 * `records` should be the ledger's graded records for the algorithm (callers
 * typically pass `ledger.byAlgorithm(change.algorithmId)`); this function does
 * its own window + outcome + finite-score filtering, so passing the unfiltered
 * set is fine.
 */
export function backtestChange(
  change: BacktestChange,
  records: readonly EvaluationRecord[],
  options: BacktestOptions,
): BacktestResult {
  const knob = BACKTESTABLE_KNOBS[knobKey(change.algorithmId, change.parameterId)];
  if (!knob) {
    return failClosed(`Knob "${change.algorithmId}.${change.parameterId}" is not backtestable — its score is not comparable to the threshold.`);
  }
  if (!Number.isFinite(change.priorValue) || !Number.isFinite(change.nextValue)) {
    return failClosed('Prior or candidate value is not a finite number.');
  }

  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const windowStart = options.now - windowDays * MS_PER_DAY;

  // Build the labelled set: in-window, decisive outcome, finite score.
  const labelled: { score: number; shouldFire: boolean; weight: number }[] = [];
  for (const r of records) {
    if (r.algorithmId !== change.algorithmId) continue;
    if (r.at < windowStart || r.at > options.now) continue;
    if (typeof r.score !== 'number' || !Number.isFinite(r.score)) continue;
    if (r.outcome === undefined || r.outcome === 'inconclusive') continue;

    // Bring the recorded score onto the knob's own scale before comparing to
    // the threshold (the ledger may record a normalized score — see the knob's
    // `recordedScoreScale`).
    const comparableScore = r.score * knob.recordedScoreScale;
    const firedPrior = fired(comparableScore, change.priorValue, knob.compare);
    // Reconstruct ground truth from the decision the current threshold made:
    //  - a 'hit' means the decision matched reality, so reality == firedPrior;
    //  - a 'miss' means the decision was wrong, so reality == !firedPrior;
    //  - a 'partial' leans correct but counts half.
    let shouldFire: boolean;
    let weight: number;
    if (r.outcome === 'hit') {
      shouldFire = firedPrior;
      weight = 1;
    } else if (r.outcome === 'miss') {
      shouldFire = !firedPrior;
      weight = 1;
    } else {
      // partial
      shouldFire = firedPrior;
      weight = 0.5;
    }
    labelled.push({ score: comparableScore, shouldFire, weight });
  }

  if (labelled.length < MIN_DECISIVE_SAMPLES) {
    return failClosed(
      `Only ${labelled.length} decisive sample(s) in the ${windowDays}-day window (need ≥${MIN_DECISIVE_SAMPLES}).`,
      labelled.length,
    );
  }

  const accuracyAt = (threshold: number): number => {
    let correct = 0;
    let total = 0;
    for (const ex of labelled) {
      total += ex.weight;
      if (fired(ex.score, threshold, knob.compare) === ex.shouldFire) correct += ex.weight;
    }
    return total === 0 ? Number.NaN : correct / total;
  };

  const currentScore = accuracyAt(change.priorValue);
  const backtestScore = accuracyAt(change.nextValue);
  const delta = backtestScore - currentScore;
  const regresses = delta < -REGRESSION_EPSILON;

  return {
    verdict: regresses ? 'fail' : 'pass',
    currentScore,
    backtestScore,
    delta,
    sampleSize: labelled.length,
    reason: regresses
      ? `Candidate regresses accuracy ${currentScore.toFixed(3)} → ${backtestScore.toFixed(3)} (Δ ${delta.toFixed(3)}) over ${labelled.length} samples — blocked.`
      : `Candidate holds or improves accuracy ${currentScore.toFixed(3)} → ${backtestScore.toFixed(3)} (Δ ${delta.toFixed(3)}) over ${labelled.length} samples.`,
  };
}

/**
 * Convenience for the tuning-apply runner: the boolean the policy gate's
 * `backtestPassed` signal expects. True only when the change is backtestable
 * AND the replay shows no regression over the window.
 */
export function backtestPassesForChange(
  change: BacktestChange,
  records: readonly EvaluationRecord[],
  options: BacktestOptions,
): boolean {
  return backtestChange(change, records, options).verdict === 'pass';
}

function failClosed(reason: string, sampleSize = 0): BacktestResult {
  return {
    verdict: 'fail',
    currentScore: Number.NaN,
    backtestScore: Number.NaN,
    delta: Number.NaN,
    sampleSize,
    reason,
  };
}

// Test-only: expose the knob registry so a compliance test can assert which
// knobs are backtestable without re-deriving the map.
export const __internals = { BACKTESTABLE_KNOBS };
