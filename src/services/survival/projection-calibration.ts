// src/services/survival/projection-calibration.ts
//
// E7 · Closed-loop integration — threat-projection calibration.
//
// posture-trajectory.ts projects each axis FORWARD: "physical safety will reach
// level 70 within 24h." posture-calibration.ts already closes the loop on a
// committed MOVE's promised effect. This module closes it on the PROJECTION
// itself: once a horizon passes and the axis's actual level is known, the gap
// between what the trajectory projected and what actually happened is recorded,
// and — averaged across many episodes of the SAME axis at the SAME horizon — a
// real directional bias emerges: the model consistently under- or over-projects
// escalation on that axis/horizon.
//
// A projection is an ABSOLUTE claim (a 0–100 level), so it calibrates with an
// additive bias OFFSET in level points, not a multiplicative factor. Positive
// bias = the axis ran HOTTER than projected (the model under-warned — the
// dangerous direction); negative = it came in cooler (the model over-warned).
//
// Pure: no DOM, no fetch, no globals, no clock. A function of the passed outcomes.

import type { SurvivalAxis } from './survival-types.ts';
import { axisLabel } from './survival-types.ts';
import type { AxisProjection, ProjectionDirection } from './posture-trajectory.ts';

/** One resolved projection: what the trajectory said, and what actually happened
 *  at that horizon. */
export interface ProjectionOutcome {
  axis: SurvivalAxis;
  horizonId: string;
  /** Axis level when the projection was made. */
  currentLevel: number;
  /** 0–100 level the trajectory projected for this horizon. */
  projectedLevel: number;
  /** The direction the trajectory called (escalating / steady / easing). */
  projectedDirection: ProjectionDirection;
  /** 0–100 level the axis actually reached at the horizon. */
  actualLevel: number;
}

/** How a horizon's projections compare to what actually happened. */
export type ProjectionCalibrationVerdict =
  | 'well_calibrated'
  | 'under_projects'
  | 'over_projects'
  | 'insufficient_data';

export interface ProjectionCalibration {
  axis: SurvivalAxis;
  horizonId: string;
  /** How many resolved episodes of this (axis, horizon) fed the calibration. */
  sampleCount: number;
  meanProjectedLevel: number;
  meanActualLevel: number;
  /** Mean signed error (actual − projected). Positive = the axis ran hotter than
   *  projected (model under-warned); negative = cooler (model over-warned). */
  meanSignedError: number;
  /** Mean absolute error — the sharpness of the projection, regardless of side. */
  meanAbsError: number;
  /** Level points to ADD to a future projection so it better matches reality.
   *  0 when there is not enough evidence to correct. */
  biasOffset: number;
  /** 0–1 fraction of episodes whose projected DIRECTION matched what happened. */
  directionalHitRate: number;
  /** 0–1, grows with sample count and with agreement between episodes. */
  confidence: number;
  verdict: ProjectionCalibrationVerdict;
  /** "What I got wrong last time" — plain-language, board-ready. */
  lesson: string;
}

/** Episodes below this are reported as insufficient_data (biasOffset 0). */
export const MIN_PROJECTION_SAMPLES = 3;
/** |meanSignedError| within this (level points) counts as well-calibrated.
 *  Projections are coarser than a single move's delta, so the band is wider. */
export const DEFAULT_PROJECTION_TOLERANCE = 8;
/** A realized move smaller than this reads as "steady" — mirrors the trajectory's
 *  own STEADY_BAND so realized direction is judged on the same terms as projected. */
export const DEFAULT_STEADY_BAND = 5;
/** Shrinkage constant: confidence = n / (n + K). */
const CONFIDENCE_SHRINKAGE_K = 3;

export interface ProjectionCalibrationOptions {
  minSamples?: number;
  toleranceLevels?: number;
  steadyBand?: number;
}

function finite(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

function clampLevel(n: number): number {
  return Math.max(0, Math.min(100, finite(n)));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stddev(values: number[], avg: number): number {
  if (values.length === 0) return 0;
  const variance = values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Convert a signed level change into the same three-way direction the trajectory
 *  uses, so projected and realized directions are compared on equal terms. */
function realizedDirection(currentLevel: number, actualLevel: number, steadyBand: number): ProjectionDirection {
  const delta = actualLevel - currentLevel;
  if (delta > steadyBand) return 'escalating';
  if (delta < -steadyBand) return 'easing';
  return 'steady';
}

function verdictFor(
  sampleCount: number,
  meanSignedError: number,
  minSamples: number,
  tolerance: number,
): ProjectionCalibrationVerdict {
  if (sampleCount < minSamples) return 'insufficient_data';
  if (Math.abs(meanSignedError) <= tolerance) return 'well_calibrated';
  return meanSignedError > 0 ? 'under_projects' : 'over_projects';
}

/** Count-shrinkage confidence, dampened when episodes disagree with each other. */
function confidenceFor(sampleCount: number, errors: number[], meanError: number): number {
  if (sampleCount === 0) return 0;
  const countConfidence = sampleCount / (sampleCount + CONFIDENCE_SHRINKAGE_K);
  const dispersion = stddev(errors, meanError);
  // A 15-pt reference band: projection errors spread wider than move deltas.
  const agreement = clamp(1 - dispersion / 15, 0.25, 1);
  return clamp(countConfidence * agreement, 0, 1);
}

function lessonFor(cal: Omit<ProjectionCalibration, 'lesson'>): string {
  const axis = axisLabel(cal.axis);
  const miss = Math.abs(cal.meanSignedError).toFixed(0);
  const n = cal.sampleCount;
  const ep = n === 1 ? 'episode' : 'episodes';

  if (cal.verdict === 'insufficient_data') {
    return `Only ${n} ${ep} of ${axis} at ${cal.horizonId} so far — not enough to trust its projection bias yet.`;
  }
  if (cal.verdict === 'under_projects') {
    return `${axis} at ${cal.horizonId} ran ~${miss} pts hotter than projected over ${n} ${ep} — the board under-warns here; add +${miss} before trusting the calm read.`;
  }
  if (cal.verdict === 'over_projects') {
    return `${axis} at ${cal.horizonId} came in ~${miss} pts below projection over ${n} ${ep} — the board over-warns here (subtract ${miss}).`;
  }
  return `${axis} projections at ${cal.horizonId} land within tolerance (mean miss ~${miss} pts over ${n} ${ep}).`;
}

function calibrateGroup(
  axis: SurvivalAxis,
  horizonId: string,
  outcomes: ProjectionOutcome[],
  minSamples: number,
  tolerance: number,
  steadyBand: number,
): ProjectionCalibration {
  const projected = outcomes.map((o) => clampLevel(o.projectedLevel));
  const actual = outcomes.map((o) => clampLevel(o.actualLevel));
  const errors = outcomes.map((o) => clampLevel(o.actualLevel) - clampLevel(o.projectedLevel));

  const meanProjectedLevel = mean(projected);
  const meanActualLevel = mean(actual);
  const meanSignedError = mean(errors);
  const meanAbsError = mean(errors.map((e) => Math.abs(e)));
  const sampleCount = outcomes.length;

  const directionHits = outcomes.filter(
    (o) => o.projectedDirection === realizedDirection(clampLevel(o.currentLevel), clampLevel(o.actualLevel), steadyBand),
  ).length;
  const directionalHitRate = sampleCount === 0 ? 0 : directionHits / sampleCount;

  const verdict = verdictFor(sampleCount, meanSignedError, minSamples, tolerance);
  const biasOffset = verdict === 'insufficient_data' ? 0 : Math.round(meanSignedError);

  const base: Omit<ProjectionCalibration, 'lesson'> = {
    axis,
    horizonId,
    sampleCount,
    meanProjectedLevel,
    meanActualLevel,
    meanSignedError,
    meanAbsError,
    biasOffset,
    directionalHitRate,
    confidence: confidenceFor(sampleCount, errors, meanSignedError),
    verdict,
  };
  return { ...base, lesson: lessonFor(base) };
}

/** Under-projection (missed escalation) is the more dangerous bias, so at equal
 *  magnitude it outranks over-projection. Insufficient and well-calibrated sink. */
function biasRank(cal: ProjectionCalibration): number {
  if (cal.verdict === 'insufficient_data') return -1;
  if (cal.verdict === 'well_calibrated') return 0;
  return Math.abs(cal.meanSignedError);
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function dangerRank(verdict: ProjectionCalibrationVerdict): number {
  return verdict === 'under_projects' ? 1 : 0;
}

function compareByBias(a: ProjectionCalibration, b: ProjectionCalibration): number {
  const rankDelta = biasRank(b) - biasRank(a);
  if (rankDelta !== 0) return rankDelta;
  const dangerDelta = dangerRank(b.verdict) - dangerRank(a.verdict);
  if (dangerDelta !== 0) return dangerDelta;
  const byAxis = compareStrings(a.axis, b.axis);
  return byAxis === 0 ? compareStrings(a.horizonId, b.horizonId) : byAxis;
}

/** Build a resolved outcome from a live projection plus the level the axis was
 *  later observed to reach at that horizon. */
export function projectionOutcome(projection: AxisProjection, actualLevel: number): ProjectionOutcome {
  return {
    axis: projection.axis,
    horizonId: projection.horizonId,
    currentLevel: projection.currentLevel,
    projectedLevel: projection.projectedLevel,
    projectedDirection: projection.direction,
    actualLevel,
  };
}

/** Group resolved projection outcomes by (axis, horizon) and calibrate each
 *  horizon's projections against what actually happened. Sorted so the most
 *  dangerous miscalibration — largest bias, under-projection first — leads. */
export function calibrateProjections(
  outcomes: ProjectionOutcome[],
  options: ProjectionCalibrationOptions = {},
): ProjectionCalibration[] {
  const minSamples = Math.max(1, Math.floor(options.minSamples ?? MIN_PROJECTION_SAMPLES));
  const tolerance = Math.max(0, options.toleranceLevels ?? DEFAULT_PROJECTION_TOLERANCE);
  const steadyBand = Math.max(0, options.steadyBand ?? DEFAULT_STEADY_BAND);

  const groups = new Map<string, ProjectionOutcome[]>();
  for (const o of outcomes) {
    const key = `${o.axis} ${o.horizonId}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(o);
    else groups.set(key, [o]);
  }

  const calibrations: ProjectionCalibration[] = [];
  for (const bucket of groups.values()) {
    const first = bucket[0];
    if (!first) continue; // buckets are never empty by construction
    calibrations.push(calibrateGroup(first.axis, first.horizonId, bucket, minSamples, tolerance, steadyBand));
  }

  return calibrations.sort(compareByBias);
}

/** Apply a projection calibration to a fresh projected level so the board shows
 *  the bias-corrected read. Insufficient evidence → unchanged (offset 0). The
 *  corrected level is clamped to [0, 100]. */
export function applyProjectionCalibration(projectedLevel: number, cal: ProjectionCalibration): number {
  if (!Number.isFinite(projectedLevel)) return 0;
  return clampLevel(projectedLevel + cal.biasOffset);
}
