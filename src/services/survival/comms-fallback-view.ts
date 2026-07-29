// src/services/survival/comms-fallback-view.ts
//
// E6 · Grid-down hardening — the board-ready view over the comms fallback ladder.
// comms-fallback.ts resolves, from the snapshot alone, which rungs of the comms
// ladder are still viable, the single transmit rung to reach for first, and the
// highest viable receive channel. This module bounds + tones + formats that plan
// into a fixed "how to reach people" board card so the eventual renderer mount is
// a dumb map over these rows.
//
// Same split as retrospective-view.ts / decision-consequence-view.ts /
// offline-playbook-view.ts: the resolver core stays a pure function of the
// snapshot, and the *view-model* here decides display caps, tone, and label text.
//
// The comms grid-down guarantee — a viable, transmit-capable fallback always
// exists — is surfaced independently of rung bounding: recommendedMethod and
// receiveMethod are read from the plan's own ids, so a tight `maxRungs` can never
// hide which method the user should actually reach for.
//
// Pure: no DOM, no fetch, no globals, no clock. A function of the passed plan.

import type { SurvivalBand } from './survival-types.ts';
import type {
  CommsFallbackPlan,
  CommsRung,
  CommsDependency,
} from './comms-fallback.ts';

/** How a rung reads on the board.
 *  - recommended: the highest viable rung you can TRANSMIT on (reach for this).
 *  - viable: a working fallback that isn't the primary transmit path.
 *  - down: an assumed-gone rung, shown so the user sees what they've lost. */
export type CommsRungState = 'recommended' | 'viable' | 'down';

/** Card-level tone, driven by the comms band.
 *  - danger: critical. caution: high. muted: elevated. neutral: secure/guarded. */
export type CommsTone = 'danger' | 'caution' | 'muted' | 'neutral';

/** One render-ready rung row. */
export interface CommsRungRow {
  id: string;
  method: string;
  instruction: string;
  state: CommsRungState;
  /** "Use this" / "Backup" / "Down". */
  stateLabel: string;
  offlineCapable: boolean;
  receiveOnly: boolean;
  /** This rung is the recommended receive channel (a weather radio when reachable). */
  isReceiveChannel: boolean;
  /** "No infrastructure needed" / "Battery-powered" / "Needs Internet, Mains power". */
  dependencySummary: string;
  /** Static frequency/channel reference, or "" when the rung carries none. */
  reference: string;
}

export interface CommsCheckInView {
  outOfAreaContact: string;
  meetingPoint: string;
  cadenceLabel: string;
}

export interface CommsFallbackBoardView {
  /** Constant board title. */
  title: string;
  /** One-liner from the resolver. */
  headline: string;
  /** Card tone, from the comms band. */
  tone: CommsTone;
  commsBand: SurvivalBand;
  powerCompromised: boolean;
  /** "" or a one-liner noting mains-powered rungs are assumed down. */
  powerNote: string;
  /** Bounded rungs in ladder order (most-capable first). */
  rungs: CommsRungRow[];
  rungOverflow: number;
  rungOverflowLabel: string;
  /** Method name of the recommended transmit rung — always present, read from the
   *  plan's own id so rung bounding can't hide it. */
  recommendedMethod: string;
  /** Method name of the recommended receive channel, or null when none is viable. */
  receiveMethod: string | null;
  /** Viable rungs across the whole ladder (not just the bounded slice). */
  viableCount: number;
  checkIn: CommsCheckInView;
  /** False in practice — the ladder is a fixed set of rungs. */
  isEmpty: boolean;
}

export interface CommsFallbackViewOptions {
  /** Max rung rows shown before overflowing. Default 8 (the whole ladder). */
  maxRungs?: number;
}

const BOARD_TITLE = 'How to reach people';
const DEFAULT_MAX_RUNGS = 8;

const DEP_LABEL: Record<CommsDependency, string> = {
  internet: 'Internet',
  cell_tower: 'Cell tower',
  mains_power: 'Mains power',
  landline: 'Landline (copper)',
  battery: 'Battery',
  none: 'No infrastructure',
};

function toneForBand(band: SurvivalBand): CommsTone {
  if (band === 'critical') return 'danger';
  if (band === 'high') return 'caution';
  if (band === 'elevated') return 'muted';
  return 'neutral';
}

function rungState(rung: CommsRung, recommendedRungId: string): CommsRungState {
  if (rung.id === recommendedRungId) return 'recommended';
  if (rung.viable) return 'viable';
  return 'down';
}

function stateLabel(state: CommsRungState): string {
  switch (state) {
    case 'recommended': {
      return 'Use this';
    }
    case 'viable': {
      return 'Backup';
    }
    case 'down': {
      return 'Down';
    }
  }
}

function dependencySummary(rung: CommsRung): string {
  if (rung.dependsOn.every((d) => d === 'none')) return 'No infrastructure needed';
  if (rung.offlineCapable) return 'Battery-powered';
  const labels = rung.dependsOn.map((d) => DEP_LABEL[d]);
  return `Needs ${labels.join(', ')}`;
}

function toRungRow(rung: CommsRung, plan: CommsFallbackPlan): CommsRungRow {
  const state = rungState(rung, plan.recommendedRungId);
  return {
    id: rung.id,
    method: rung.method,
    instruction: rung.instruction,
    state,
    stateLabel: stateLabel(state),
    offlineCapable: rung.offlineCapable,
    receiveOnly: rung.receiveOnly,
    isReceiveChannel: rung.id === plan.receiveRungId,
    dependencySummary: dependencySummary(rung),
    reference: rung.reference ?? '',
  };
}

function methodForId(ladder: readonly CommsRung[], id: string | null): string | null {
  if (id === null) return null;
  const rung = ladder.find((r) => r.id === id);
  return rung ? rung.method : null;
}

/** Bound, tone, and format a comms fallback plan into a board card view-model.
 *  The plan's `ladder` is most-capable first; we slice the top `maxRungs` and
 *  report the rest as overflow, while the recommended transmit / receive methods
 *  are surfaced separately so bounding can never hide the guaranteed fallback. */
export function buildCommsFallbackBoardView(
  plan: CommsFallbackPlan,
  options: CommsFallbackViewOptions = {},
): CommsFallbackBoardView {
  const rawMaxRungs = options.maxRungs ?? DEFAULT_MAX_RUNGS;
  // A non-positive cap would blank the ladder; floor to 1 so at least the
  // most-capable rung always shows.
  const maxRungs = Number.isFinite(rawMaxRungs) ? Math.max(1, Math.floor(rawMaxRungs)) : DEFAULT_MAX_RUNGS;

  const shown = plan.ladder.slice(0, maxRungs);
  const rungOverflow = plan.ladder.length - shown.length;

  return {
    title: BOARD_TITLE,
    headline: plan.headline,
    tone: toneForBand(plan.commsBand),
    commsBand: plan.commsBand,
    powerCompromised: plan.powerCompromised,
    powerNote: plan.powerCompromised
      ? 'Mains power is down — powered rungs are assumed out.'
      : '',
    rungs: shown.map((r) => toRungRow(r, plan)),
    rungOverflow,
    rungOverflowLabel: rungOverflow > 0 ? `+${rungOverflow} more` : '',
    recommendedMethod: methodForId(plan.ladder, plan.recommendedRungId) ?? '',
    receiveMethod: methodForId(plan.ladder, plan.receiveRungId),
    viableCount: plan.ladder.filter((r) => r.viable).length,
    checkIn: {
      outOfAreaContact: plan.checkIn.outOfAreaContact,
      meetingPoint: plan.checkIn.meetingPoint,
      cadenceLabel: plan.checkIn.cadenceLabel,
    },
    isEmpty: plan.ladder.length === 0,
  };
}
