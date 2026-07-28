// src/services/survival/retrospective-view.ts
//
// E7 · Closed-loop integration — the board-ready view over the retrospective
// digest. The spec's E7 asks to surface "what I got wrong last time" ON THE
// BOARD; retrospective-digest.ts produces the full ranked analysis, and this
// module bounds + tones + formats it into a fixed-size card the board can
// render without knowing anything about calibration internals.
//
// Same split as storm-posture-view.ts (selectPostureCards) and scrubber-view.ts:
// the engine core stays a pure function of its inputs, and the *view-model* here
// decides display order caps, tone, and label text — so the eventual renderer
// mount is a dumb map over these rows.
//
// Pure: no DOM, no fetch, no globals, no clock. A function of the passed digest.

import type {
  RetrospectiveDigest,
  RetroLesson,
  RetroBiasKind,
  RetroSeverity,
} from './retrospective-digest.ts';

/** Display tone for a lesson row or the card as a whole.
 *  - danger: an overconfident miss (reality ran worse than shown) — the side
 *    that gets the user hurt, so it always dominates.
 *  - caution: a *large* benign miss (we over-warned notably) — worth a soft note.
 *  - muted: a small benign miss.
 *  - neutral: nothing actionable to show. */
export type RetroTone = 'danger' | 'caution' | 'muted' | 'neutral';

/** One render-ready lesson row. */
export interface RetroLessonRow {
  /** "shelter · Physical safety" / "Supply · 72h" — carried from the digest. */
  subject: string;
  /** The plain-language lesson, verbatim from the underlying calibration. */
  lesson: string;
  biasKind: RetroBiasKind;
  severity: RetroSeverity;
  tone: RetroTone;
  /** Short chip text: "Overconfident" / "Underconfident". */
  chip: string;
  /** Right-aligned magnitude, e.g. "24 pts". */
  metric: string;
}

export interface RetrospectiveBoardView {
  /** Constant board title. */
  title: string;
  /** One-liner from the digest (names the biggest miss, or the all-clear). */
  headline: string;
  /** Card-level tone: danger if any overconfident lesson exists at all. */
  tone: RetroTone;
  /** Bounded, already-ranked lesson rows (most-worth-distrusting first). */
  rows: RetroLessonRow[];
  /** Actionable lessons hidden by the row cap. */
  overflow: number;
  /** "" when nothing is hidden, else "+N more". */
  overflowLabel: string;
  /** "2 overconfident · 1 underconfident · 3 well-calibrated". */
  summaryLine: string;
  /** True when there is nothing miscalibrated to show. */
  isEmpty: boolean;
}

export interface RetrospectiveViewOptions {
  /** Max rows the board card shows before overflowing. Default 5. */
  maxRows?: number;
}

const BOARD_TITLE = 'What I got wrong last time';
const DEFAULT_MAX_ROWS = 5;

function toneForLesson(biasKind: RetroBiasKind, severity: RetroSeverity): RetroTone {
  // Overconfident is the dangerous direction regardless of size — even a minor
  // under-delivery means the user was less protected than the board implied.
  if (biasKind === 'overconfident') return 'danger';
  // Benign (over-warned) misses: flag only the large ones, softly.
  if (severity === 'critical' || severity === 'notable') return 'caution';
  return 'muted';
}

function chipFor(biasKind: RetroBiasKind): string {
  if (biasKind === 'overconfident') return 'Overconfident';
  if (biasKind === 'underconfident') return 'Underconfident';
  // accurate / unproven never reach a row (digest excludes them), but keep total.
  return 'Calibrated';
}

function metricFor(lesson: RetroLesson): string {
  const pts = Math.round(Math.max(0, Number.isFinite(lesson.missMagnitude) ? lesson.missMagnitude : 0));
  return `${pts} pts`;
}

function toRow(lesson: RetroLesson): RetroLessonRow {
  return {
    subject: lesson.subject,
    lesson: lesson.lesson,
    biasKind: lesson.biasKind,
    severity: lesson.severity,
    tone: toneForLesson(lesson.biasKind, lesson.severity),
    chip: chipFor(lesson.biasKind),
    metric: metricFor(lesson),
  };
}

function summaryLine(digest: RetrospectiveDigest): string {
  const s = digest.summary;
  const parts = [
    `${s.overconfident} overconfident`,
    `${s.underconfident} underconfident`,
    `${s.wellCalibrated} well-calibrated`,
  ];
  if (s.insufficientData > 0) parts.push(`${s.insufficientData} unproven`);
  return parts.join(' · ');
}

/** Bound, tone, and format a retrospective digest into a board card view-model.
 *  The digest's `lessons` are already ranked most-worth-distrusting first, so we
 *  slice the top `maxRows` and report the rest as overflow. */
export function buildRetrospectiveBoardView(
  digest: RetrospectiveDigest,
  options: RetrospectiveViewOptions = {},
): RetrospectiveBoardView {
  const rawMax = options.maxRows ?? DEFAULT_MAX_ROWS;
  // A non-finite or negative cap collapses to zero rows (everything overflows)
  // rather than throwing or slicing weirdly.
  const maxRows = Number.isFinite(rawMax) ? Math.max(0, Math.floor(rawMax)) : DEFAULT_MAX_ROWS;

  const shown = digest.lessons.slice(0, maxRows);
  const rows = shown.map((lesson) => toRow(lesson));
  const overflow = digest.lessons.length - rows.length;

  const isEmpty = digest.lessons.length === 0;
  // Any overconfident lesson anywhere (not just the shown rows) reddens the card.
  let tone: RetroTone = 'neutral';
  if (!isEmpty) tone = digest.summary.overconfident > 0 ? 'danger' : 'muted';

  return {
    title: BOARD_TITLE,
    headline: digest.headline,
    tone,
    rows,
    overflow,
    overflowLabel: overflow > 0 ? `+${overflow} more` : '',
    summaryLine: summaryLine(digest),
    isEmpty,
  };
}
