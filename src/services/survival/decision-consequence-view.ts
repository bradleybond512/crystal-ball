// src/services/survival/decision-consequence-view.ts
//
// E5 · World-state brain — the board-ready view over the decision-consequence
// what-if sim. decision-consequence.ts ranks candidate moves by how much each
// buys down the projected peak across enumerated world branches; this module
// bounds + tones + formats that into a fixed-size "if I act now" board card so
// the eventual renderer mount is a dumb map over these rows.
//
// Same split as retrospective-view.ts / storm-posture-view.ts: the sim core stays
// a pure function of branches + moves, and the *view-model* here decides display
// order caps, tone, and label text.
//
// Pure: no DOM, no fetch, no globals, no clock. A function of the passed decision.

import type { MoveCost, SurvivalAxis } from './survival-types.ts';
import { axisLabel } from './survival-types.ts';
import type { DecisionConsequence, MoveConsequence } from './decision-consequence.ts';

/** Display tone for a move row or the card as a whole.
 *  - act: the recommended move (materially lowers the expected peak, no worse tail).
 *  - prepare: a move that helps but wasn't the pick.
 *  - muted: a move with no material effect.
 *  - neutral: nothing to evaluate. */
export type DecisionTone = 'act' | 'prepare' | 'muted' | 'neutral';

/** One render-ready move row. */
export interface DecisionMoveRow {
  moveId: string;
  moveLabel: string;
  cost: MoveCost;
  /** "Free" / "Low" / "Medium" / "High". */
  costLabel: string;
  /** "now" / "45 min" / "2 h". */
  leadTimeLabel: string;
  tone: DecisionTone;
  isRecommended: boolean;
  /** Signed peak change: "−12 pts" lowers the peak, "+12 pts" raises it, "0 pts". */
  metric: string;
  /** "Still worst: Supply" — what still hurts most after the move, or "". */
  residualLabel: string;
  /** The sim's rationale, carried verbatim. */
  rationale: string;
}

export interface DecisionBoardView {
  /** Constant board title. */
  title: string;
  /** One-liner from the sim (names the recommendation, or the hold). */
  headline: string;
  /** Card-level tone: act when a move is recommended, else muted / neutral. */
  tone: DecisionTone;
  recommendedMoveId: string | null;
  /** Bounded, already-ranked move rows (best-first). */
  rows: DecisionMoveRow[];
  overflow: number;
  overflowLabel: string;
  isEmpty: boolean;
}

export interface DecisionViewOptions {
  /** Max rows the board card shows before overflowing. Default 4. */
  maxRows?: number;
}

const BOARD_TITLE = 'If I act now';
const DEFAULT_MAX_ROWS = 4;

const COST_LABELS: Record<MoveCost, string> = {
  free: 'Free',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

function costLabel(cost: MoveCost): string {
  return COST_LABELS[cost] ?? 'Low';
}

function leadTimeLabel(mins: number): string {
  const m = Math.round(Number.isFinite(mins) ? Math.max(0, mins) : 0);
  if (m === 0) return 'now';
  if (m < 60) return `${m} min`;
  return `${Math.round(m / 60)} h`;
}

function metricFor(expectedReduction: number): string {
  const r = Math.round(Number.isFinite(expectedReduction) ? expectedReduction : 0);
  // The sim reports reduction as (baseline − moved), so a positive number means
  // the peak was lowered — the good direction. Show it signed the way the sim's
  // own rationale does ("−12"), and let tone carry the good/bad read.
  if (r > 0) return `−${r} pts`;
  if (r < 0) return `+${Math.abs(r)} pts`;
  return '0 pts';
}

function residualLabel(axis: SurvivalAxis | null): string {
  if (!axis) return '';
  return `Still worst: ${axisLabel(axis)}`;
}

function toneForRow(consequence: MoveConsequence, isRecommended: boolean): DecisionTone {
  if (isRecommended) return 'act';
  if (consequence.expectedReduction > 0) return 'prepare';
  return 'muted';
}

function toRow(consequence: MoveConsequence, recommendedMoveId: string | null): DecisionMoveRow {
  const isRecommended = recommendedMoveId !== null && consequence.moveId === recommendedMoveId;
  return {
    moveId: consequence.moveId,
    moveLabel: consequence.moveLabel,
    cost: consequence.cost,
    costLabel: costLabel(consequence.cost),
    leadTimeLabel: leadTimeLabel(consequence.leadTimeMins),
    tone: toneForRow(consequence, isRecommended),
    isRecommended,
    metric: metricFor(consequence.expectedReduction),
    residualLabel: residualLabel(consequence.residualPeakAxis),
    rationale: consequence.rationale,
  };
}

/** Bound, tone, and format a decision-consequence sim into a board card view-model.
 *  The sim's `consequences` are already ranked best-first, so we slice the top
 *  `maxRows` and report the rest as overflow. */
export function buildDecisionBoardView(
  decision: DecisionConsequence,
  options: DecisionViewOptions = {},
): DecisionBoardView {
  const rawMax = options.maxRows ?? DEFAULT_MAX_ROWS;
  // A non-finite or negative cap collapses to zero rows (everything overflows).
  const maxRows = Number.isFinite(rawMax) ? Math.max(0, Math.floor(rawMax)) : DEFAULT_MAX_ROWS;

  const shown = decision.consequences.slice(0, maxRows);
  const rows = shown.map((c) => toRow(c, decision.recommendedMoveId));
  const overflow = decision.consequences.length - rows.length;

  const isEmpty = decision.consequences.length === 0;
  let tone: DecisionTone = 'neutral';
  if (!isEmpty) tone = decision.recommendedMoveId === null ? 'muted' : 'act';

  return {
    title: BOARD_TITLE,
    headline: decision.headline,
    tone,
    recommendedMoveId: decision.recommendedMoveId,
    rows,
    overflow,
    overflowLabel: overflow > 0 ? `+${overflow} more` : '',
    isEmpty,
  };
}
