// src/services/survival/survival-posture-view.ts
//
// Grand-Strategy Survival OS — the board-ready view over the HEADLINE posture.
// survival-posture.ts fuses every axis contributor into a `SurvivalPosture`: the
// 8 survival axes, each with a level / band / trend / drivers / threats, plus an
// overall band, the worst axis, and any stale inputs. This module bounds + tones
// + labels that posture into the top-of-board "how am I doing across every
// survival domain" card so the eventual renderer mount is a dumb map over these
// rows.
//
// Same split as the sibling surfacing-prep views (posture-trajectory / world-
// branches / decision-consequence / grid-down-certify / offline-playbook / comms-
// fallback / retrospective): the posture core stays a pure function of its
// contributor inputs; the *view-model* here decides display order, the axis cap,
// tone, and label text. lens-board.ts already consumes `SurvivalPosture` for map
// marker tinting — this is the complementary CARD surface, not a second scorer.
//
// Honesty carried through: stale inputs are surfaced (never silently dropped),
// the row tone blends band with trend so a worsening axis reads hotter than a
// steady one at the same band, and per-axis confidence is exposed so a
// low-confidence "critical" is not presented as settled fact.
//
// Pure: no DOM, no fetch, no globals, no clock. A function of the passed posture.

import type {
  AxisState,
  PostureThreat,
  SurvivalAxis,
  SurvivalBand,
  SurvivalPosture,
} from './survival-types.ts';
import { axisLabel, bandRank } from './survival-types.ts';

/** Row / card tone.
 *  - danger: worsening into a high/critical band.
 *  - caution: worsening lower, or holding/improving at high/critical.
 *  - muted: a steady/worsening mid band.
 *  - neutral: secure/guarded, improving, or nothing to show. */
export type PostureTone = 'danger' | 'caution' | 'muted' | 'neutral';

/** The soonest / worst threat on an axis, compacted for the card. */
export interface PostureThreatSummary {
  hazardLabel: string;
  /** "35-55 min" or "" when arrival is unknown. */
  arrivalLabel: string;
  /** low | medium | high, carried verbatim. */
  confidenceLabel: PostureThreat['confidenceLabel'];
  /** The matcher's plain-language reason. */
  why: string;
}

/** One render-ready axis row. */
export interface PostureAxisRow {
  axis: SurvivalAxis;
  axisTitle: string;
  level: number;
  band: SurvivalBand;
  trend: AxisState['trend'];
  /** "Improving" / "Steady" / "Worsening". */
  trendLabel: string;
  tone: PostureTone;
  /** The axis's leading driver (drivers[0]). */
  topDriver: string;
  /** 0–100 confidence from the axis ConfidenceBreakdown (total / max). */
  confidencePct: number;
  /** "High" / "Medium" / "Low". */
  confidenceLabel: string;
  /** How many threats are attached to this axis. */
  threatCount: number;
  /** The soonest/worst threat, or null when the axis carries none. */
  leadThreat: PostureThreatSummary | null;
  /** Compact "Tornado Warning · 35-55 min"; "" when no lead threat. */
  leadThreatLabel: string;
}

export interface SurvivalPostureBoardView {
  /** Constant board title. */
  title: string;
  /** One-liner from the posture core. */
  headline: string;
  /** Card tone: the worst row tone across every axis. */
  tone: PostureTone;
  overallLevel: number;
  overallBand: SurvivalBand;
  worstAxis: SurvivalAxis | null;
  /** "" when there is no worst axis. */
  worstAxisTitle: string;
  /** Axes at elevated band or worse. */
  axesAtRiskCount: number;
  /** True when the posture is fully clear (overall level 0). */
  allClear: boolean;
  /** Per-axis rows, worst-first (highest band then level leads). */
  rows: PostureAxisRow[];
  overflow: number;
  overflowLabel: string;
  /** Stale input ids, carried verbatim from the core. */
  staleInputs: string[];
  /** "2 stale inputs" / "1 stale input" / "". */
  staleLabel: string;
  isEmpty: boolean;
}

export interface SurvivalPostureViewOptions {
  /** Max axis rows before overflowing. Default 8 (the full axis set). */
  maxAxes?: number;
}

const BOARD_TITLE = 'Survival posture';
const DEFAULT_MAX_AXES = 8;
/** Elevated is the first band that counts as "at risk". */
const AT_RISK_RANK = bandRank('elevated');

const TONE_RANK: Record<PostureTone, number> = {
  danger: 3,
  caution: 2,
  muted: 1,
  neutral: 0,
};

function trendLabel(trend: AxisState['trend']): string {
  switch (trend) {
    case 'improving': {
      return 'Improving';
    }
    case 'steady': {
      return 'Steady';
    }
    case 'worsening': {
      return 'Worsening';
    }
  }
}

/** Row tone blends the axis band with its trend: a worsening axis heading into
 *  critical reads danger, while the same band merely holding steady reads
 *  caution, and a low band reads muted/neutral. An improving severe axis stays
 *  caution — better, but not yet quiet. */
function rowTone(band: SurvivalBand, trend: AxisState['trend']): PostureTone {
  const severe = band === 'critical' || band === 'high';
  const moderate = band === 'elevated';
  switch (trend) {
    case 'worsening': {
      if (severe) return 'danger';
      return moderate ? 'caution' : 'muted';
    }
    case 'steady': {
      if (severe) return 'caution';
      return moderate ? 'muted' : 'neutral';
    }
    case 'improving': {
      return severe ? 'caution' : 'neutral';
    }
  }
}

function confidencePctOf(axis: AxisState): number {
  const { total, max } = axis.confidence;
  if (!Number.isFinite(max) || max <= 0) return 0;
  const ratio = (Number.isFinite(total) ? total : 0) / max;
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

function confidenceLabel(pct: number): string {
  if (pct >= 75) return 'High';
  if (pct >= 50) return 'Medium';
  return 'Low';
}

/** The threat to lead with: soonest impact wins; among threats with unknown
 *  arrival (or on a tie) the highest severity wins. */
function leadThreatOf(threats: readonly PostureThreat[]): PostureThreat | null {
  let best: PostureThreat | null = null;
  for (const t of threats) {
    if (best === null) {
      best = t;
      continue;
    }
    const tMins = t.timeToImpactMins;
    const bMins = best.timeToImpactMins;
    if (tMins !== null && bMins !== null) {
      if (tMins < bMins) best = t;
      continue;
    }
    if (tMins !== null && bMins === null) {
      best = t; // a known arrival always beats an unknown one
      continue;
    }
    if (tMins === null && bMins === null && t.severity > best.severity) {
      best = t;
    }
  }
  return best;
}

function threatSummaryOf(threat: PostureThreat): PostureThreatSummary {
  return {
    hazardLabel: threat.hazardLabel,
    arrivalLabel: threat.arrivalLabel ?? '',
    confidenceLabel: threat.confidenceLabel,
    why: threat.why,
  };
}

function threatLabel(summary: PostureThreatSummary): string {
  return summary.arrivalLabel
    ? `${summary.hazardLabel} · ${summary.arrivalLabel}`
    : summary.hazardLabel;
}

function toRow(axis: AxisState): PostureAxisRow {
  const pct = confidencePctOf(axis);
  const lead = leadThreatOf(axis.threats);
  const leadThreat = lead ? threatSummaryOf(lead) : null;
  return {
    axis: axis.axis,
    axisTitle: axisLabel(axis.axis),
    level: axis.level,
    band: axis.band,
    trend: axis.trend,
    trendLabel: trendLabel(axis.trend),
    tone: rowTone(axis.band, axis.trend),
    topDriver: axis.drivers[0] ?? 'no active drivers',
    confidencePct: pct,
    confidenceLabel: confidenceLabel(pct),
    threatCount: axis.threats.length,
    leadThreat,
    leadThreatLabel: leadThreat ? threatLabel(leadThreat) : '',
  };
}

/** Worst-first: highest band leads, ties broken by level then a stable axis
 *  order so the same posture always renders identically. */
function worstFirst(a: AxisState, b: AxisState): number {
  const byBand = bandRank(b.band) - bandRank(a.band);
  if (byBand !== 0) return byBand;
  const byLevel = b.level - a.level;
  if (byLevel !== 0) return byLevel;
  if (a.axis < b.axis) return -1;
  if (a.axis > b.axis) return 1;
  return 0;
}

function cardTone(rows: readonly PostureAxisRow[]): PostureTone {
  let worst: PostureTone = 'neutral';
  for (const r of rows) {
    if (TONE_RANK[r.tone] > TONE_RANK[worst]) worst = r.tone;
  }
  return worst;
}

function staleLabel(staleInputs: readonly string[]): string {
  const n = staleInputs.length;
  if (n === 0) return '';
  return `${n} stale input${n > 1 ? 's' : ''}`;
}

/** Bound, tone, and format a survival posture into the headline board card.
 *  Axes are sorted worst-first, then a `maxAxes` cap drops the calmest axes and
 *  reports the remainder as overflow. Card-level fields (tone, at-risk count,
 *  worst axis) read the WHOLE posture so a tight cap can never understate how
 *  much is at risk. */
export function buildSurvivalPostureBoardView(
  posture: SurvivalPosture,
  options: SurvivalPostureViewOptions = {},
): SurvivalPostureBoardView {
  const rawMax = options.maxAxes ?? DEFAULT_MAX_AXES;
  // A non-positive cap would blank the card; floor to 1 so the worst axis always shows.
  const maxAxes = Number.isFinite(rawMax) ? Math.max(1, Math.floor(rawMax)) : DEFAULT_MAX_AXES;

  const sorted = [...posture.axes].sort(worstFirst);
  const shown = sorted.slice(0, maxAxes);
  const rows = shown.map((a) => toRow(a));
  const overflow = sorted.length - rows.length;

  // Tone + at-risk count read every axis, not just the bounded rows.
  const allRows = sorted.map((a) => toRow(a));
  const axesAtRiskCount = posture.axes.filter((a) => bandRank(a.band) >= AT_RISK_RANK).length;

  const hasAxes = posture.axes.length > 0;

  return {
    title: BOARD_TITLE,
    headline: posture.headline,
    tone: cardTone(allRows),
    overallLevel: posture.overallLevel,
    overallBand: posture.overallBand,
    worstAxis: hasAxes ? posture.worstAxis : null,
    worstAxisTitle: hasAxes ? axisLabel(posture.worstAxis) : '',
    axesAtRiskCount,
    allClear: posture.overallLevel === 0,
    rows,
    overflow,
    overflowLabel: overflow > 0 ? `+${overflow} more` : '',
    staleInputs: [...posture.staleInputs],
    staleLabel: staleLabel(posture.staleInputs),
    isEmpty: !hasAxes,
  };
}
