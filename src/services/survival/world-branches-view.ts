// src/services/survival/world-branches-view.ts
//
// E5 · World-State Brain — the board-ready view over the branch enumeration.
// posture-trajectory.ts projects a SINGLE expected path per axis; world-branches.ts
// fans each projection into escalate / hold / ease branches, each carrying a
// probability and a projected level. This module bounds + tones + labels that
// fan into a fixed "what could happen" board card so the eventual renderer mount
// is a dumb map over these rows.
//
// Same split as the sibling surfacing-prep views (retrospective / decision-
// consequence / offline-playbook / comms-fallback / grid-down-certify / posture-
// trajectory): the branch core stays a pure function of the trajectory; the
// *view-model* here decides display order, per-horizon caps, tone, and label text.
// The core already emits its axis-sets horizon-major and worst-expected-first
// within each horizon, so this module preserves that ordering and simply groups
// it into per-horizon slices.
//
// Honesty carried through from the core: the row TONE follows the calibrated
// expected band (the probability-weighted central estimate), NOT the scariest
// tail — but the downside tail is never hidden. Each escalate branch keeps its
// own chip tone, every row exposes a compact `downsideLabel`, and the card
// surfaces the single most consequential escalation branch as `topDownside`. So
// the colour reflects what we actually expect while the spread stays visible.
//
// Pure: no DOM, no fetch, no globals, no clock. A function of the passed branches.

import type { SurvivalAxis, SurvivalBand } from './survival-types.ts';
import { axisLabel, bandRank } from './survival-types.ts';
import type {
  AxisBranch,
  AxisBranchSet,
  BranchKind,
  WorldBranches,
} from './world-branches.ts';

/** Chip / row / card tone, keyed on band severity.
 *  - danger: critical band.
 *  - caution: high band.
 *  - muted: elevated band.
 *  - neutral: guarded / secure band, or nothing to branch. */
export type BranchTone = 'danger' | 'caution' | 'muted' | 'neutral';

/** One branch of an axis fan, render-ready. */
export interface BranchChip {
  kind: BranchKind;
  /** "Escalate" / "Hold" / "Ease". */
  kindLabel: string;
  /** 0–1, carried verbatim from the core. */
  probability: number;
  /** Rounded integer percent. */
  probabilityPct: number;
  /** "62%". */
  probabilityLabel: string;
  level: number;
  band: SurvivalBand;
  tone: BranchTone;
  /** True for the fan's most-likely branch. */
  isMostLikely: boolean;
  /** The core's per-branch rationale, carried verbatim. */
  rationale: string;
}

/** One axis fan: its three branches plus the calibrated central estimate. */
export interface BranchAxisRow {
  axis: SurvivalAxis;
  axisTitle: string;
  /** Probability-weighted mean level, rounded for display. */
  expectedLevel: number;
  expectedBand: SurvivalBand;
  mostLikely: BranchKind;
  /** "Escalate" / "Hold" / "Ease" for the most-likely branch. */
  mostLikelyLabel: string;
  /** Row tone from the expected band (the calibrated central estimate). */
  tone: BranchTone;
  /** Exactly three chips, escalate → hold → ease (as the core orders them). */
  chips: BranchChip[];
  /** Compact downside tag from the escalate branch, e.g. "22% → critical".
   *  "" when the escalate branch sits below the material floor. */
  downsideLabel: string;
}

/** One horizon column: the worst axis fans projected to that horizon. */
export interface BranchHorizonView {
  horizonId: string;
  horizonMins: number;
  /** Bounded axis rows, worst-expected-first (highest expected level leads). */
  rows: BranchAxisRow[];
  overflow: number;
  overflowLabel: string;
  /** Worst EXPECTED band across ALL axes at this horizon (not just shown rows). */
  worstExpectedBand: SurvivalBand;
}

/** The single most consequential escalation branch across the whole fan. */
export interface TopDownside {
  axis: SurvivalAxis;
  axisTitle: string;
  band: SurvivalBand;
  level: number;
  probability: number;
  probabilityPct: number;
  probabilityLabel: string;
  horizonId: string;
  /** "Supply → critical (~62%) by 24h". */
  label: string;
}

export interface WorldBranchesBoardView {
  /** Constant board title. */
  title: string;
  /** One-liner from the branch core. */
  headline: string;
  /** Card tone: the worst row tone across the whole fan. */
  tone: BranchTone;
  /** The most consequential escalation branch, or null when none is material. */
  topDownside: TopDownside | null;
  /** Per-horizon columns, in the core's horizon order. */
  horizons: BranchHorizonView[];
  isEmpty: boolean;
}

export interface WorldBranchesViewOptions {
  /** Max axis rows shown per horizon before overflowing. Default 3. */
  maxAxesPerHorizon?: number;
}

const BOARD_TITLE = 'What could happen';
const DEFAULT_MAX_AXES = 3;
/** Mirror the core's own materiality floor: an escalate branch below this level
 *  is not a downside story worth flagging. */
const MATERIAL_FLOOR = 20;

const TONE_RANK: Record<BranchTone, number> = {
  danger: 3,
  caution: 2,
  muted: 1,
  neutral: 0,
};

const KIND_LABEL: Record<BranchKind, string> = {
  escalate: 'Escalate',
  hold: 'Hold',
  ease: 'Ease',
};

/** Band → tone. The expected band drives row/card colour; each chip carries its
 *  own band's tone so a scary escalate tail still reads red even under a calm
 *  expectation. */
function bandTone(band: SurvivalBand): BranchTone {
  switch (band) {
    case 'critical': {
      return 'danger';
    }
    case 'high': {
      return 'caution';
    }
    case 'elevated': {
      return 'muted';
    }
    case 'guarded':
    case 'secure': {
      return 'neutral';
    }
  }
}

function pct(probability: number): number {
  return Math.round((Number.isFinite(probability) ? probability : 0) * 100);
}

function toChip(branch: AxisBranch, mostLikely: BranchKind): BranchChip {
  const p = pct(branch.probability);
  return {
    kind: branch.kind,
    kindLabel: KIND_LABEL[branch.kind],
    probability: branch.probability,
    probabilityPct: p,
    probabilityLabel: `${p}%`,
    level: branch.level,
    band: branch.band,
    tone: bandTone(branch.band),
    isMostLikely: branch.kind === mostLikely,
    rationale: branch.rationale,
  };
}

/** Compact downside tag from the escalate branch. "" below the material floor. */
function downsideLabelFor(set: AxisBranchSet): string {
  const esc = set.branches.find((b) => b.kind === 'escalate');
  if (!esc || esc.level < MATERIAL_FLOOR) return '';
  return `${pct(esc.probability)}% → ${esc.band}`;
}

function toRow(set: AxisBranchSet): BranchAxisRow {
  return {
    axis: set.axis,
    axisTitle: axisLabel(set.axis),
    expectedLevel: Math.round(set.expectedLevel),
    expectedBand: set.expectedBand,
    mostLikely: set.mostLikely,
    mostLikelyLabel: KIND_LABEL[set.mostLikely],
    tone: bandTone(set.expectedBand),
    chips: set.branches.map((b) => toChip(b, set.mostLikely)),
    downsideLabel: downsideLabelFor(set),
  };
}

function worstExpectedBandOf(sets: readonly AxisBranchSet[]): SurvivalBand {
  let worst: SurvivalBand = 'secure';
  for (const s of sets) {
    if (bandRank(s.expectedBand) > bandRank(worst)) worst = s.expectedBand;
  }
  return worst;
}

function cardTone(rows: readonly BranchAxisRow[]): BranchTone {
  let worst: BranchTone = 'neutral';
  for (const r of rows) {
    if (TONE_RANK[r.tone] > TONE_RANK[worst]) worst = r.tone;
  }
  return worst;
}

/** The most consequential escalation branch across the whole fan: the escalate
 *  branch with the largest probability-weighted level. Materiality (level ≥ the
 *  floor) is filtered BEFORE ranking — mirroring the core's headline logic — so a
 *  high-probability sub-material branch can't win the score race and then get
 *  rejected, hiding a genuine critical branch that scored lower behind it. */
function topDownsideOf(sets: readonly AxisBranchSet[]): TopDownside | null {
  let worst: AxisBranch | null = null;
  let worstScore = 0;
  for (const s of sets) {
    const esc = s.branches.find((b) => b.kind === 'escalate');
    if (!esc || esc.level < MATERIAL_FLOOR) continue;
    const score = esc.probability * esc.level;
    if (score > worstScore) {
      worstScore = score;
      worst = esc;
    }
  }
  if (!worst) return null;
  const p = pct(worst.probability);
  const title = axisLabel(worst.axis);
  return {
    axis: worst.axis,
    axisTitle: title,
    band: worst.band,
    level: worst.level,
    probability: worst.probability,
    probabilityPct: p,
    probabilityLabel: `${p}%`,
    horizonId: worst.horizonId,
    label: `${title} → ${worst.band} (~${p}%) by ${worst.horizonId}`,
  };
}

/** Bound, tone, and format a world-branch fan into a board card view-model.
 *  Rows are grouped per horizon in the core's own order; within each horizon the
 *  core already sorts worst-expected-first, so a `maxAxesPerHorizon` cap drops the
 *  least-severe axes and reports the remainder as overflow. Card-level fields
 *  (tone, worst band, top downside) read the WHOLE fan so a tight cap can never
 *  understate the spread of outcomes. */
export function buildWorldBranchesBoardView(
  branches: WorldBranches,
  options: WorldBranchesViewOptions = {},
): WorldBranchesBoardView {
  const rawMax = options.maxAxesPerHorizon ?? DEFAULT_MAX_AXES;
  // A non-positive cap would blank every horizon; floor to 1 so each horizon
  // always shows its single worst axis.
  const maxAxes = Number.isFinite(rawMax) ? Math.max(1, Math.floor(rawMax)) : DEFAULT_MAX_AXES;

  const horizons: BranchHorizonView[] = branches.horizons.map((h) => {
    const forHorizon = branches.axisSets.filter((s) => s.horizonId === h.id);
    const shown = forHorizon.slice(0, maxAxes);
    const rows = shown.map((s) => toRow(s));
    const overflow = forHorizon.length - rows.length;
    return {
      horizonId: h.id,
      horizonMins: h.mins,
      rows,
      overflow,
      overflowLabel: overflow > 0 ? `+${overflow} more` : '',
      worstExpectedBand: worstExpectedBandOf(forHorizon),
    };
  });

  // Tone reads every fan, not just the bounded rows.
  const allRows = branches.axisSets.map((s) => toRow(s));

  return {
    title: BOARD_TITLE,
    headline: branches.headline,
    tone: cardTone(allRows),
    topDownside: topDownsideOf(branches.axisSets),
    horizons,
    isEmpty: branches.axisSets.length === 0,
  };
}
