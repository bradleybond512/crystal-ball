// src/services/survival/retrospective-digest.ts
//
// E7 · Closed-loop integration — the "what I got wrong last time" digest.
//
// Two calibration loops close on the board:
//   • posture-calibration.ts grades a committed MOVE's promised effect vs what it
//     actually delivered (MoveEffectCalibration).
//   • projection-calibration.ts grades a forward PROJECTION's level vs what the
//     axis actually reached (ProjectionCalibration).
//
// Each speaks its own verdict vocabulary, but both describe the SAME failure axis:
// was the board's read of the world too rosy or too grim? A move that "over_promises"
// (helped less than modeled) and a projection that "under_projects" (axis ran hotter
// than shown) are the SAME danger — reality was WORSE than the board said, so the
// user is less protected than they think. This module fuses both into one ranked,
// board-ready surface that answers a single question: "what should I distrust most?"
//
// Overconfident (reality-worse-than-shown) lessons are the ones that get you hurt,
// so they outrank equal-magnitude underconfident (pleasant-surprise) lessons.
//
// Pure: no DOM, no fetch, no globals, no clock. A function of the passed calibrations.

import type { SurvivalAxis } from './survival-types.ts';
import { axisLabel } from './survival-types.ts';
import type { MoveEffectCalibration } from './posture-calibration.ts';
import type { ProjectionCalibration } from './projection-calibration.ts';

export type RetroSource = 'move_effect' | 'projection';

/** The unified bias direction across both loops.
 *  - overconfident: reality ran WORSE than the board showed (the dangerous side —
 *    a move that under-delivered, or an axis that escalated past its projection).
 *  - underconfident: reality ran BETTER than shown (benign — over-warned / over-modeled).
 *  - accurate / unproven: not actionable (well-calibrated / too little evidence). */
export type RetroBiasKind = 'overconfident' | 'underconfident' | 'accurate' | 'unproven';

export type RetroSeverity = 'critical' | 'notable' | 'minor';

/** One learned lesson, normalized across both calibration loops. */
export interface RetroLesson {
  source: RetroSource;
  /** Human subject: "shelter-interior-room · Physical safety" or "Supply · 72h". */
  subject: string;
  axis: SurvivalAxis;
  biasKind: RetroBiasKind;
  severity: RetroSeverity;
  /** Absolute miss in level points — comparable across both sources. */
  missMagnitude: number;
  sampleCount: number;
  confidence: number;
  /** Ranking score; higher surfaces sooner. Danger- and confidence-weighted. */
  priority: number;
  /** The plain-language lesson, carried verbatim from the underlying calibration. */
  lesson: string;
}

export interface RetrospectiveSummary {
  /** Every calibration fed in, regardless of verdict. */
  totalCalibrations: number;
  /** Actionable lessons surfaced (overconfident + underconfident). */
  actionableLessons: number;
  /** Dangerous lessons: reality ran worse than the board showed. */
  overconfident: number;
  /** Benign lessons: reality ran better than the board showed. */
  underconfident: number;
  wellCalibrated: number;
  insufficientData: number;
  /** Mean confidence across actionable lessons (0 when there are none). */
  meanLessonConfidence: number;
}

export interface RetrospectiveDigest {
  /** Actionable lessons only, ranked most-worth-distrusting first. */
  lessons: RetroLesson[];
  summary: RetrospectiveSummary;
  /** Board-ready one-liner. */
  headline: string;
}

/** Overconfident lessons get this multiplier so they outrank equal-magnitude
 *  underconfident ones — being under-protected is worse than being over-warned. */
const DANGER_WEIGHT = 1.5;
/** Miss (level points) at/above which a lesson is critical / notable. */
const CRITICAL_MISS = 20;
const NOTABLE_MISS = 10;

export interface RetrospectiveOptions {
  /** Drop actionable lessons below this miss magnitude (level points). Default 0. */
  minMissMagnitude?: number;
}

function finite(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function severityFor(miss: number): RetroSeverity {
  if (miss >= CRITICAL_MISS) return 'critical';
  if (miss >= NOTABLE_MISS) return 'notable';
  return 'minor';
}

function priorityFor(missMagnitude: number, biasKind: RetroBiasKind, confidence: number): number {
  const danger = biasKind === 'overconfident' ? DANGER_WEIGHT : 1;
  // Confidence scales priority but never zeros a lesson: a 0-confidence miss still
  // counts for half, so a large low-evidence miss isn't buried under trivia.
  const conf = 0.5 + 0.5 * clamp(confidence, 0, 1);
  return missMagnitude * danger * conf;
}

/** A move calibration → unified bias kind. over_promises = reality worse (overconfident). */
function moveBiasKind(verdict: MoveEffectCalibration['verdict']): RetroBiasKind {
  if (verdict === 'over_promises') return 'overconfident';
  if (verdict === 'under_promises') return 'underconfident';
  if (verdict === 'well_calibrated') return 'accurate';
  return 'unproven';
}

/** A projection calibration → unified bias kind. under_projects = axis ran hotter
 *  than shown (overconfident). */
function projectionBiasKind(verdict: ProjectionCalibration['verdict']): RetroBiasKind {
  if (verdict === 'under_projects') return 'overconfident';
  if (verdict === 'over_projects') return 'underconfident';
  if (verdict === 'well_calibrated') return 'accurate';
  return 'unproven';
}

function moveLesson(cal: MoveEffectCalibration): RetroLesson {
  const biasKind = moveBiasKind(cal.verdict);
  const missMagnitude = Math.abs(finite(cal.meanProjectionError));
  const confidence = clamp(finite(cal.confidence), 0, 1);
  return {
    source: 'move_effect',
    subject: `${cal.moveId} · ${axisLabel(cal.axis)}`,
    axis: cal.axis,
    biasKind,
    severity: severityFor(missMagnitude),
    missMagnitude,
    sampleCount: cal.sampleCount,
    confidence,
    priority: priorityFor(missMagnitude, biasKind, confidence),
    lesson: cal.lesson,
  };
}

function projectionLesson(cal: ProjectionCalibration): RetroLesson {
  const biasKind = projectionBiasKind(cal.verdict);
  const missMagnitude = Math.abs(finite(cal.meanSignedError));
  const confidence = clamp(finite(cal.confidence), 0, 1);
  return {
    source: 'projection',
    subject: `${axisLabel(cal.axis)} · ${cal.horizonId}`,
    axis: cal.axis,
    biasKind,
    severity: severityFor(missMagnitude),
    missMagnitude,
    sampleCount: cal.sampleCount,
    confidence,
    priority: priorityFor(missMagnitude, biasKind, confidence),
    lesson: cal.lesson,
  };
}

function isActionable(lesson: RetroLesson): boolean {
  return lesson.biasKind === 'overconfident' || lesson.biasKind === 'underconfident';
}

/** Rank: highest priority first; ties break to the dangerous (overconfident) side,
 *  then larger raw miss, then subject for determinism. */
function compareLessons(a: RetroLesson, b: RetroLesson): number {
  if (b.priority !== a.priority) return b.priority - a.priority;
  const aDanger = a.biasKind === 'overconfident' ? 1 : 0;
  const bDanger = b.biasKind === 'overconfident' ? 1 : 0;
  if (bDanger !== aDanger) return bDanger - aDanger;
  if (b.missMagnitude !== a.missMagnitude) return b.missMagnitude - a.missMagnitude;
  return compareStrings(a.subject, b.subject);
}

function headlineFor(lessons: RetroLesson[], summary: RetrospectiveSummary): string {
  if (lessons.length === 0) {
    if (summary.totalCalibrations === 0) {
      return 'No calibration history yet — nothing to learn from.';
    }
    return `Nothing miscalibrated — ${summary.wellCalibrated} well-calibrated, ${summary.insufficientData} still gathering evidence.`;
  }
  const top = lessons[0]!;
  const noun = summary.actionableLessons === 1 ? 'lesson' : 'lessons';
  let head = `${summary.actionableLessons} calibration ${noun} to learn from`;
  if (summary.overconfident > 0) {
    const danger = summary.overconfident === 1 ? 'read was' : 'reads were';
    head += ` — ${summary.overconfident} where the board's ${danger} overconfident (reality ran worse than shown)`;
  }
  head += `. Biggest miss: ${top.subject} (${top.missMagnitude.toFixed(0)} pts).`;
  return head;
}

/** Fuse move-effect and projection calibrations into one ranked retrospective.
 *  Well-calibrated and insufficient-data entries are counted in the summary but
 *  excluded from `lessons` — they are not "what I got wrong." */
export function buildRetrospectiveDigest(
  moveCalibrations: MoveEffectCalibration[],
  projectionCalibrations: ProjectionCalibration[],
  options: RetrospectiveOptions = {},
): RetrospectiveDigest {
  const minMiss = Math.max(0, finite(options.minMissMagnitude ?? 0));

  const all: RetroLesson[] = [
    ...moveCalibrations.map((c) => moveLesson(c)),
    ...projectionCalibrations.map((c) => projectionLesson(c)),
  ];

  const wellCalibrated = all.filter((l) => l.biasKind === 'accurate').length;
  const insufficientData = all.filter((l) => l.biasKind === 'unproven').length;

  const lessons = all
    .filter((l) => isActionable(l))
    .filter((l) => l.missMagnitude >= minMiss)
    .sort(compareLessons);

  const overconfident = lessons.filter((l) => l.biasKind === 'overconfident').length;
  const underconfident = lessons.filter((l) => l.biasKind === 'underconfident').length;
  const meanLessonConfidence =
    lessons.length === 0 ? 0 : lessons.reduce((s, l) => s + l.confidence, 0) / lessons.length;

  const summary: RetrospectiveSummary = {
    totalCalibrations: all.length,
    actionableLessons: lessons.length,
    overconfident,
    underconfident,
    wellCalibrated,
    insufficientData,
    meanLessonConfidence,
  };

  return { lessons, summary, headline: headlineFor(lessons, summary) };
}
