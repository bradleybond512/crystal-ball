// src/services/survival/posture-calibration.ts
//
// E7 · Closed-loop integration — move-effect calibration.
//
// E6's replay grader produces, per completed episode, the signed gap between
// what a committed move's model PROMISED on an axis (`projectedDelta`) and what
// the posture actually DID (`actualDelta`). One episode's gap is noisy — a single
// storm's own evolution rides on top of the move's effect and cannot be isolated
// (see PostureLoopGrade.actualDelta). But averaged across many episodes of the
// SAME move on the SAME axis, that noise washes out and a real bias emerges: the
// move's model consistently over- or under-promises.
//
// This module turns a pile of graded episodes into that per-move, per-axis
// calibration: a signed bias, a correction factor to scale future modeled
// deltas, a confidence that grows with evidence, and a plain-language lesson —
// "here's what I got wrong last time." It is the learning half of the loop the
// spec's Layer 4 calls for, seeded from replay fixtures until live history exists.
//
// Pure: no DOM, no fetch, no globals, no clock. A function of the passed grades.

import type { SurvivalAxis } from './survival-types.ts';
import { axisLabel } from './survival-types.ts';
import type { PostureLoopGrade } from './posture-loop-replay.ts';

/** How a move's modeled effect compares to what it actually delivered, over the
 *  episodes seen so far. */
export type CalibrationVerdict =
  | 'well_calibrated'
  | 'over_promises'
  | 'under_promises'
  | 'insufficient_data';

export interface MoveEffectCalibration {
  moveId: string;
  axis: SurvivalAxis;
  /** How many graded episodes of this (move, axis) fed the calibration. */
  sampleCount: number;
  /** Mean signed modeled change on the axis (negative = predicted improvement). */
  meanProjectedDelta: number;
  /** Mean signed observed change on the axis (negative = observed improvement). */
  meanActualDelta: number;
  /** Mean signed projection error (observed − projected). Positive = the move
   *  helped LESS than modeled (over-promised); negative = helped more. The bias. */
  meanProjectionError: number;
  /** Multiplier to apply to a future modeled delta so it better matches reality.
   *  ~1 = accurate; <1 = the move over-promised, scale it down; >1 = under-promised.
   *  Clamped to [0, 2]; 1 when there is not enough signal to correct. */
  correctionFactor: number;
  /** 0–1, grows with sample count and with agreement between episodes. */
  confidence: number;
  verdict: CalibrationVerdict;
  /** "What I got wrong last time" — plain-language, board-ready. */
  lesson: string;
}

/** Episodes below this are reported as insufficient_data (correctionFactor 1). */
export const MIN_CALIBRATION_SAMPLES = 3;
/** |meanProjectionError| within this (level points) counts as well-calibrated. */
export const DEFAULT_CALIBRATION_TOLERANCE = 5;
/** Shrinkage constant: confidence = n / (n + K). */
const CONFIDENCE_SHRINKAGE_K = 3;
/** A modeled delta at or below this magnitude is too small to calibrate a ratio on. */
const MIN_PROJECTED_MAGNITUDE = 1;

export interface CalibrationOptions {
  minSamples?: number;
  toleranceLevels?: number;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Population standard deviation, used to gauge how much episodes agree. */
function stddev(values: number[], avg: number): number {
  if (values.length === 0) return 0;
  const variance = values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Ratio of mean-observed to mean-projected — robust to individual tiny projections,
 *  which mean-of-ratios is not. Only meaningful when the move models a real effect. */
function correctionFactorFor(meanProjected: number, meanActual: number): number {
  if (Math.abs(meanProjected) < MIN_PROJECTED_MAGNITUDE) return 1;
  const raw = meanActual / meanProjected;
  // A negative ratio means the move modeled improvement but, on average, posture
  // moved the other way: credit it with nothing rather than a nonsensical factor.
  if (raw < 0) return 0;
  return clamp(raw, 0, 2);
}

function verdictFor(
  sampleCount: number,
  meanProjectionError: number,
  minSamples: number,
  tolerance: number,
): CalibrationVerdict {
  if (sampleCount < minSamples) return 'insufficient_data';
  if (Math.abs(meanProjectionError) <= tolerance) return 'well_calibrated';
  return meanProjectionError > 0 ? 'over_promises' : 'under_promises';
}

/** Count-shrinkage confidence, dampened when episodes disagree with each other. */
function confidenceFor(sampleCount: number, errors: number[], meanError: number): number {
  if (sampleCount === 0) return 0;
  const countConfidence = sampleCount / (sampleCount + CONFIDENCE_SHRINKAGE_K);
  const dispersion = stddev(errors, meanError);
  // Agreement shrinks toward 0 as spread grows relative to a 10-pt reference band.
  const agreement = clamp(1 - dispersion / 10, 0.25, 1);
  return clamp(countConfidence * agreement, 0, 1);
}

function lessonFor(cal: Omit<MoveEffectCalibration, 'lesson'>): string {
  const axis = axisLabel(cal.axis);
  const modeled = Math.abs(cal.meanProjectedDelta).toFixed(0);
  const delivered = Math.abs(cal.meanActualDelta).toFixed(0);
  const n = cal.sampleCount;
  const ep = n === 1 ? 'episode' : 'episodes';

  if (cal.verdict === 'insufficient_data') {
    return `Only ${n} ${ep} of “${cal.moveId}” on ${axis} so far — not enough to calibrate its effect yet.`;
  }
  if (cal.verdict === 'over_promises') {
    return `“${cal.moveId}” modeled ~${modeled} pts of ${axis} relief but delivered ~${delivered} over ${n} ${ep} — scale its projected effect by ${cal.correctionFactor.toFixed(2)}.`;
  }
  if (cal.verdict === 'under_promises') {
    return `“${cal.moveId}” delivered ~${delivered} pts of ${axis} relief versus ~${modeled} modeled over ${n} ${ep} — it is worth more than the board shows (×${cal.correctionFactor.toFixed(2)}).`;
  }
  return `“${cal.moveId}” is well-calibrated on ${axis}: modeled ~${modeled} pts, delivered ~${delivered} over ${n} ${ep}.`;
}

function calibrateGroup(
  moveId: string,
  axis: SurvivalAxis,
  grades: PostureLoopGrade[],
  minSamples: number,
  tolerance: number,
): MoveEffectCalibration {
  const projected = grades.map((g) => g.projectedDelta);
  const actual = grades.map((g) => g.actualDelta);
  const errors = grades.map((g) => g.projectionError);

  const meanProjectedDelta = mean(projected);
  const meanActualDelta = mean(actual);
  const meanProjectionError = mean(errors);
  const sampleCount = grades.length;

  const verdict = verdictFor(sampleCount, meanProjectionError, minSamples, tolerance);
  const correctionFactor =
    verdict === 'insufficient_data' ? 1 : correctionFactorFor(meanProjectedDelta, meanActualDelta);

  const base: Omit<MoveEffectCalibration, 'lesson'> = {
    moveId,
    axis,
    sampleCount,
    meanProjectedDelta,
    meanActualDelta,
    meanProjectionError,
    correctionFactor,
    confidence: confidenceFor(sampleCount, errors, meanProjectionError),
    verdict,
  };
  return { ...base, lesson: lessonFor(base) };
}

/** Group graded episodes by (moveId, axis) and calibrate each move's modeled
 *  effect against what it actually delivered. Sorted worst-calibrated first
 *  (largest absolute bias among moves that have enough evidence), so "what I got
 *  wrong most" surfaces at the top of the board. */
export function calibrateMoveEffects(
  grades: PostureLoopGrade[],
  options: CalibrationOptions = {},
): MoveEffectCalibration[] {
  const minSamples = Math.max(1, Math.floor(options.minSamples ?? MIN_CALIBRATION_SAMPLES));
  const tolerance = Math.max(0, options.toleranceLevels ?? DEFAULT_CALIBRATION_TOLERANCE);

  const groups = new Map<string, PostureLoopGrade[]>();
  for (const g of grades) {
    const key = `${g.moveId} ${g.axis}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(g);
    else groups.set(key, [g]);
  }

  const calibrations: MoveEffectCalibration[] = [];
  for (const bucket of groups.values()) {
    const first = bucket[0];
    if (!first) continue; // buckets are never empty by construction
    calibrations.push(calibrateGroup(first.moveId, first.axis, bucket, minSamples, tolerance));
  }

  return calibrations.sort(compareByBias);
}

/** Well-calibrated and insufficient-data moves rank below biased ones; among
 *  biased moves, larger absolute bias ranks first. */
function biasRank(cal: MoveEffectCalibration): number {
  if (cal.verdict === 'insufficient_data') return -1;
  if (cal.verdict === 'well_calibrated') return 0;
  return Math.abs(cal.meanProjectionError);
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function compareByBias(a: MoveEffectCalibration, b: MoveEffectCalibration): number {
  const rankDelta = biasRank(b) - biasRank(a);
  if (rankDelta !== 0) return rankDelta;
  const byMove = compareStrings(a.moveId, b.moveId);
  return byMove === 0 ? compareStrings(a.axis, b.axis) : byMove;
}

/** Apply a calibration to a fresh modeled delta so the board shows the move's
 *  learned effect, not its raw model. Insufficient evidence → the delta is
 *  returned unchanged (factor 1). Sign is preserved. */
export function applyCalibration(modeledDelta: number, cal: MoveEffectCalibration): number {
  if (!Number.isFinite(modeledDelta)) return 0;
  return modeledDelta * cal.correctionFactor;
}
