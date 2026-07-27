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
 *
 * `firedLabel`: the ledger `label` value the algorithm records when it actually
 * FIRED at decision time. Ground truth is anchored to this recorded decision —
 * NOT reconstructed from the current threshold — because a record's hit/miss
 * was graded against whatever threshold was live when it was created. If the
 * threshold moved during the window, reconstructing "did it fire?" from today's
 * prior would mislabel those records (a true positive could look like a
 * should-not-fire). The recorded label is the stable, threshold-independent
 * truth signal. big-event-detector records `isBigEvent ? 'big-event' : 'quiet'`.
 */
interface BacktestableKnob {
  compare: 'score_ge' | 'score_lt';
  recordedScoreScale: number;
  firedLabel: string;
}

interface LabelledBacktestRecord {
  score: number;
  shouldFire: boolean;
  weight: number;
}

const BACKTESTABLE_KNOBS: Record<string, BacktestableKnob> = {
  'big-event-detector:threshold': { compare: 'score_ge', recordedScoreScale: 100, firedLabel: 'big-event' },
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

function toLabelledRecord(
  record: EvaluationRecord,
  change: BacktestChange,
  knob: BacktestableKnob,
  windowStart: number,
  now: number,
): LabelledBacktestRecord | null {
  if (record.algorithmId !== change.algorithmId) return null;
  if (record.at < windowStart || record.at > now) return null;
  if (typeof record.score !== 'number' || !Number.isFinite(record.score)) return null;
  if (record.outcome === undefined || record.outcome === 'inconclusive') return null;
  if (record.label === undefined) return null;

  const score = record.score * knob.recordedScoreScale;
  const firedActual = record.label === knob.firedLabel;
  if (record.outcome === 'miss') {
    return { score, shouldFire: !firedActual, weight: 1 };
  }
  return {
    score,
    shouldFire: firedActual,
    weight: record.outcome === 'partial' ? 0.5 : 1,
  };
}

function buildLabelledRecords(
  records: readonly EvaluationRecord[],
  change: BacktestChange,
  knob: BacktestableKnob,
  windowStart: number,
  now: number,
): LabelledBacktestRecord[] {
  const labelled: LabelledBacktestRecord[] = [];
  for (const record of records) {
    const item = toLabelledRecord(record, change, knob, windowStart, now);
    if (item) labelled.push(item);
  }
  return labelled;
}

function accuracyAt(
  records: readonly LabelledBacktestRecord[],
  threshold: number,
  compare: BacktestableKnob['compare'],
): number {
  let correct = 0;
  let total = 0;
  for (const record of records) {
    total += record.weight;
    if (fired(record.score, threshold, compare) === record.shouldFire) {
      correct += record.weight;
    }
  }
  return total === 0 ? Number.NaN : correct / total;
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

  const labelled = buildLabelledRecords(
    records,
    change,
    knob,
    windowStart,
    options.now,
  );

  if (labelled.length < MIN_DECISIVE_SAMPLES) {
    return failClosed(
      `Only ${labelled.length} decisive sample(s) in the ${windowDays}-day window (need ≥${MIN_DECISIVE_SAMPLES}).`,
      labelled.length,
    );
  }

  const currentScore = accuracyAt(labelled, change.priorValue, knob.compare);
  const backtestScore = accuracyAt(labelled, change.nextValue, knob.compare);
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
