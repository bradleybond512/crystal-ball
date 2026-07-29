// src/services/survival/offline-playbook-view.ts
//
// E6 · Grid-down hardening — the board-ready view over the offline playbook.
// offline-playbook.ts resolves, per elevated survival axis, the static actions a
// user can take with NO network (worst-first, ≥1 action guaranteed per axis).
// This module bounds + tones + formats that into a fixed-size "if the grid goes
// down" board card so the eventual renderer mount is a dumb map over these cards.
//
// Same split as retrospective-view.ts / decision-consequence-view.ts: the
// resolver core stays a pure function of the snapshot, and the *view-model* here
// decides display caps, tone, and label text. Unlike the flat retro/decision
// views this one is two-level (axis cards → action rows), matching the resolver.
//
// Pure: no DOM, no fetch, no globals, no clock. A function of the passed result.

import type { SurvivalAxis, SurvivalBand } from './survival-types.ts';
import { axisLabel, bandRank } from './survival-types.ts';
import type {
  OfflinePlaybookResult,
  AxisOfflinePlaybook,
  OfflinePlayItem,
  OfflinePlaySource,
} from './offline-playbook.ts';

/** Display tone for an axis card or the card set as a whole.
 *  - danger: a critical-band axis.
 *  - caution: a high-band axis.
 *  - muted: an elevated (but sub-high) axis.
 *  - neutral: nothing elevated — no offline play needed. */
export type PlaybookTone = 'danger' | 'caution' | 'muted' | 'neutral';

/** One render-ready action row. */
export interface OfflineActionRow {
  id: string;
  label: string;
  /** The action's reason, or "" when it carries none. */
  rationale: string;
  priority: 1 | 2 | 3 | 4 | 5;
  /** "Do now" (1) / "Soon" (2–3) / "When able" (4–5). */
  urgencyLabel: string;
  /** "now" / "~5 min". */
  timeLabel: string;
  source: OfflinePlaySource;
}

/** One render-ready axis card. */
export interface OfflineAxisCard {
  axis: SurvivalAxis;
  axisTitle: string;
  level: number;
  band: SurvivalBand;
  tone: PlaybookTone;
  /** "Tornado warning, Power outage +1" — bounded trigger list. */
  triggerSummary: string;
  /** Bounded top actions (resolver order preserved). */
  actions: OfflineActionRow[];
  actionOverflow: number;
  actionOverflowLabel: string;
}

export interface OfflinePlaybookBoardView {
  /** Constant board title. */
  title: string;
  /** One-liner from the resolver. */
  headline: string;
  /** Card-level tone: the worst axis band across all cards. */
  tone: PlaybookTone;
  /** Bounded axis cards (worst-first). */
  cards: OfflineAxisCard[];
  cardOverflow: number;
  cardOverflowLabel: string;
  /** Elevated axes that resolved to zero actions — 0 by construction; a positive
   *  count is a loud regression the renderer should surface, not hide. */
  unresolvedCount: number;
  isEmpty: boolean;
}

export interface OfflinePlaybookViewOptions {
  /** Max axis cards shown before overflowing. Default 4. */
  maxAxes?: number;
  /** Max action rows per card before overflowing. Default 3. */
  maxActionsPerAxis?: number;
}

const BOARD_TITLE = 'If the grid goes down';
const DEFAULT_MAX_AXES = 4;
const DEFAULT_MAX_ACTIONS = 3;
const MAX_TRIGGERS_SHOWN = 2;

function toneForBand(band: SurvivalBand): PlaybookTone {
  if (band === 'critical') return 'danger';
  if (band === 'high') return 'caution';
  return 'muted';
}

function urgencyLabel(priority: number): string {
  if (priority <= 1) return 'Do now';
  if (priority <= 3) return 'Soon';
  return 'When able';
}

function timeLabel(estimatedMinutes: number): string {
  const m = Math.round(Number.isFinite(estimatedMinutes) ? Math.max(0, estimatedMinutes) : 0);
  if (m === 0) return 'now';
  return `~${m} min`;
}

function triggerSummary(triggers: readonly string[]): string {
  if (triggers.length === 0) return '';
  const shown = triggers.slice(0, MAX_TRIGGERS_SHOWN).join(', ');
  const extra = triggers.length - MAX_TRIGGERS_SHOWN;
  return extra > 0 ? `${shown} +${extra}` : shown;
}

function toActionRow(item: OfflinePlayItem): OfflineActionRow {
  return {
    id: item.id,
    label: item.label,
    rationale: item.rationale ?? '',
    priority: item.priority,
    urgencyLabel: urgencyLabel(item.priority),
    timeLabel: timeLabel(item.estimatedMinutes),
    source: item.source,
  };
}

function toAxisCard(playbook: AxisOfflinePlaybook, maxActions: number): OfflineAxisCard {
  const shown = playbook.actions.slice(0, maxActions);
  const actionOverflow = playbook.actions.length - shown.length;
  return {
    axis: playbook.axis,
    axisTitle: axisLabel(playbook.axis),
    level: playbook.level,
    band: playbook.band,
    tone: toneForBand(playbook.band),
    triggerSummary: triggerSummary(playbook.triggers),
    actions: shown.map((a) => toActionRow(a)),
    actionOverflow,
    actionOverflowLabel: actionOverflow > 0 ? `+${actionOverflow} more` : '',
  };
}

/** Worst tone across cards drives the card-set tone (cards are worst-first, so
 *  the first card holds it, but reduce over all for safety). */
function worstTone(cards: readonly OfflineAxisCard[]): PlaybookTone {
  if (cards.length === 0) return 'neutral';
  let worst = cards[0]!.band;
  for (const c of cards) {
    if (bandRank(c.band) > bandRank(worst)) worst = c.band;
  }
  return toneForBand(worst);
}

/** Bound, tone, and format an offline-playbook result into a board card view-model.
 *  The resolver's `playbooks` are already worst-first, so we slice the top
 *  `maxAxes` and report the rest as overflow. */
export function buildOfflinePlaybookBoardView(
  result: OfflinePlaybookResult,
  options: OfflinePlaybookViewOptions = {},
): OfflinePlaybookBoardView {
  const rawMaxAxes = options.maxAxes ?? DEFAULT_MAX_AXES;
  const maxAxes = Number.isFinite(rawMaxAxes) ? Math.max(0, Math.floor(rawMaxAxes)) : DEFAULT_MAX_AXES;
  const rawMaxActions = options.maxActionsPerAxis ?? DEFAULT_MAX_ACTIONS;
  // A non-positive per-axis cap would blank every card; floor it to 1 so a card
  // that exists always shows at least its top (do-now) action.
  const maxActions = Number.isFinite(rawMaxActions) ? Math.max(1, Math.floor(rawMaxActions)) : DEFAULT_MAX_ACTIONS;

  const shown = result.playbooks.slice(0, maxAxes);
  const cards = shown.map((p) => toAxisCard(p, maxActions));
  const cardOverflow = result.playbooks.length - cards.length;

  return {
    title: BOARD_TITLE,
    headline: result.headline,
    tone: worstTone(cards),
    cards,
    cardOverflow,
    cardOverflowLabel: cardOverflow > 0 ? `+${cardOverflow} more` : '',
    unresolvedCount: result.unresolvedAxes.length,
    isEmpty: result.playbooks.length === 0,
  };
}
