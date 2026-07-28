// src/services/survival/posture-loop-replay.ts
//
// E6 · Survival Kernel hardening — the storm→posture→move→outcome replay grader.
//
// E1 proved a storm slice renders and offers moves; E5 projected what a move
// WOULD do. This module closes the last E6 gap by grading, after the fact, what a
// committed move ACTUALLY did — the `storm-posture-loop` replay fixture the spec
// calls for. It answers the two questions an after-action review asks of a
// survival episode:
//
//   1. Warning lead time — did the warning land far enough ahead of impact to act?
//   2. Posture improvement — did the move you committed actually reduce the threat
//      on its axis, and by how much versus what the model promised?
//
// The gap between the projected PostureDelta and the observed change is a signed
// calibration signal — the model over- or under-promised — which is exactly the
// evidence E7's closed loop consumes. This module produces that evidence purely,
// so the loop can be seeded from replay fixtures before any live history exists.
//
// Pure: no DOM, no fetch, no globals, no clock. A function of the passed
// fixture(s) alone — every timestamp and level is supplied by the caller.

import type { PostureDelta, SurvivalAxis, SurvivalBand } from './survival-types.ts';
import { bandForLevel } from './survival-types.ts';

/** Was the warning early enough to act on? */
export type LeadVerdict = 'adequate' | 'short' | 'missed';

/** How the observed posture change compared to the move's modeled effect. */
export type ProjectionVerdict = 'accurate' | 'overpredicted' | 'underpredicted';

/** One completed survival episode: a threat warned, a move committed, an outcome
 *  observed. Levels are 0–100 on the graded axis (higher = worse). */
export interface PostureLoopFixture {
  label: string;
  axis: SurvivalAxis;
  /** When the warning was issued and when impact actually arrived. */
  warningIssuedAtMs: number;
  impactAtMs: number;
  /** Graded-axis level before the move, and after the move + the storm. */
  postureBefore: number;
  postureAfter: number;
  committedMove: {
    moveId: string;
    committedAtMs: number;
    /** The move's modeled effect, as projected at commit time. */
    effect: PostureDelta[];
  };
  /** Lead time (ms) at or above which a warning counts as adequate. Default 30 min. */
  leadTimeTargetMs?: number;
  /** Tolerance (level points) within which a projection is called accurate. Default 5. */
  projectionToleranceLevels?: number;
}

export interface PostureLoopGrade {
  label: string;
  axis: SurvivalAxis;
  /** impact − warning issued. Negative means the warning came at or after impact. */
  warningLeadMs: number;
  leadVerdict: LeadVerdict;
  bandBefore: SurvivalBand;
  bandAfter: SurvivalBand;
  /** Signed modeled change on the graded axis (negative = predicted improvement). */
  projectedDelta: number;
  /** Signed observed change on the graded axis (negative = observed improvement). */
  actualDelta: number;
  /** The move actually reduced the threat on its axis. */
  moveImproved: boolean;
  /** actual − projected. Positive = move helped LESS than modeled (over-promised). */
  projectionError: number;
  projectionVerdict: ProjectionVerdict;
  /** The move was committed at or before impact (there was time to execute). */
  committedBeforeImpact: boolean;
  headline: string;
  notes: string[];
}

export interface PostureLoopSummary {
  count: number;
  adequateWarnings: number;
  shortWarnings: number;
  missedWarnings: number;
  movesImproved: number;
  meanWarningLeadMs: number;
  meanAbsProjectionError: number;
  /** Signed mean projection error — the model's bias. The seed E7 calibrates on. */
  meanProjectionError: number;
  grades: PostureLoopGrade[];
}

const DEFAULT_LEAD_TARGET_MS = 30 * 60_000;
const DEFAULT_PROJECTION_TOLERANCE = 5;

function clampLevel(n: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
}

function finiteOr(n: number, fallback: number): number {
  return Number.isFinite(n) ? n : fallback;
}

/** Sum the modeled deltas that land on the graded axis. A move may touch several
 *  axes; only its effect on `axis` is graded here. */
function projectedDeltaFor(effect: PostureDelta[], axis: SurvivalAxis): number {
  return effect
    .filter((d) => d.axis === axis)
    .reduce((sum, d) => sum + finiteOr(d.deltaLevel, 0), 0);
}

function leadVerdictFor(warningLeadMs: number, leadTarget: number): LeadVerdict {
  if (warningLeadMs <= 0) return 'missed';
  if (warningLeadMs < leadTarget) return 'short';
  return 'adequate';
}

function projectionVerdictFor(projectionError: number, tolerance: number): ProjectionVerdict {
  if (Math.abs(projectionError) <= tolerance) return 'accurate';
  return projectionError > 0 ? 'overpredicted' : 'underpredicted';
}

export function gradePostureLoop(fixture: PostureLoopFixture): PostureLoopGrade {
  const leadTarget = Math.max(0, finiteOr(fixture.leadTimeTargetMs ?? DEFAULT_LEAD_TARGET_MS, DEFAULT_LEAD_TARGET_MS));
  const tolerance = Math.max(0, finiteOr(fixture.projectionToleranceLevels ?? DEFAULT_PROJECTION_TOLERANCE, DEFAULT_PROJECTION_TOLERANCE));

  const issuedAt = finiteOr(fixture.warningIssuedAtMs, 0);
  const impactAt = finiteOr(fixture.impactAtMs, 0);
  const committedAt = finiteOr(fixture.committedMove.committedAtMs, 0);

  const warningLeadMs = impactAt - issuedAt;
  const leadVerdict = leadVerdictFor(warningLeadMs, leadTarget);

  const before = clampLevel(fixture.postureBefore);
  const after = clampLevel(fixture.postureAfter);
  const bandBefore = bandForLevel(before);
  const bandAfter = bandForLevel(after);

  const projectedDelta = projectedDeltaFor(fixture.committedMove.effect, fixture.axis);
  const actualDelta = after - before;
  const moveImproved = actualDelta < 0;

  const projectionError = actualDelta - projectedDelta;
  const projectionVerdict = projectionVerdictFor(projectionError, tolerance);

  const committedBeforeImpact = committedAt <= impactAt;

  const notes: string[] = [];
  if (leadVerdict === 'missed') notes.push('Warning landed at or after impact — no time to act.');
  else if (leadVerdict === 'short') notes.push(`Only ${Math.round(warningLeadMs / 60_000)} min of lead time (target ${Math.round(leadTarget / 60_000)} min).`);
  if (!committedBeforeImpact) notes.push('Move was committed after impact — too late to change the outcome.');
  if (!moveImproved) notes.push('Committed move did not reduce the threat on its axis.');
  if (projectionVerdict === 'overpredicted') notes.push(`Move helped ${Math.abs(projectionError).toFixed(0)} pts less than modeled.`);
  else if (projectionVerdict === 'underpredicted') notes.push(`Move helped ${Math.abs(projectionError).toFixed(0)} pts more than modeled.`);

  return {
    label: fixture.label,
    axis: fixture.axis,
    warningLeadMs,
    leadVerdict,
    bandBefore,
    bandAfter,
    projectedDelta,
    actualDelta,
    moveImproved,
    projectionError,
    projectionVerdict,
    committedBeforeImpact,
    headline: buildHeadline(fixture.label, leadVerdict, moveImproved, bandBefore, bandAfter),
    notes,
  };
}

function buildHeadline(
  label: string,
  leadVerdict: LeadVerdict,
  moveImproved: boolean,
  bandBefore: SurvivalBand,
  bandAfter: SurvivalBand,
): string {
  const warnedLabels: Record<LeadVerdict, string> = {
    adequate: 'warned in time',
    short: 'warned late',
    missed: 'not warned in time',
  };
  const warned = warnedLabels[leadVerdict];
  const moved = moveImproved ? `posture ${bandBefore}→${bandAfter}` : `posture held at ${bandAfter}`;
  return `${label}: ${warned}, ${moved}.`;
}

export function summarizePostureLoops(fixtures: PostureLoopFixture[]): PostureLoopSummary {
  const grades = fixtures.map((f) => gradePostureLoop(f));
  const count = grades.length;
  const sum = (pick: (g: PostureLoopGrade) => number): number => grades.reduce((s, g) => s + pick(g), 0);

  return {
    count,
    adequateWarnings: grades.filter((g) => g.leadVerdict === 'adequate').length,
    shortWarnings: grades.filter((g) => g.leadVerdict === 'short').length,
    missedWarnings: grades.filter((g) => g.leadVerdict === 'missed').length,
    movesImproved: grades.filter((g) => g.moveImproved).length,
    meanWarningLeadMs: count === 0 ? 0 : sum((g) => g.warningLeadMs) / count,
    meanAbsProjectionError: count === 0 ? 0 : sum((g) => Math.abs(g.projectionError)) / count,
    meanProjectionError: count === 0 ? 0 : sum((g) => g.projectionError) / count,
    grades,
  };
}

// ── Canonical fixture ──────────────────────────────────────────────────────
// The `storm-posture-loop` the spec calls for: a severe-wind / tornado polygon
// near a saved place. Warned 42 min ahead (adequate); the committed shelter move
// was modeled to cut physical_safety by 35 pts and actually cut it by 31 — a
// close, slightly over-promised projection. Timestamps are fixed so the fixture
// is deterministic.

const LOOP_T0 = 1_700_000_000_000;

export const STORM_POSTURE_LOOP_FIXTURE: PostureLoopFixture = {
  label: 'storm-posture-loop',
  axis: 'physical_safety',
  warningIssuedAtMs: LOOP_T0,
  impactAtMs: LOOP_T0 + 42 * 60_000,
  postureBefore: 82,
  postureAfter: 51,
  committedMove: {
    moveId: 'shelter-interior-room',
    committedAtMs: LOOP_T0 + 8 * 60_000,
    effect: [{ axis: 'physical_safety', deltaLevel: -35, rationale: 'Shelter in an interior room removes wind/debris exposure.' }],
  },
};
