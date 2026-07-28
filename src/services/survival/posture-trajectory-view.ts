// src/services/survival/posture-trajectory-view.ts
//
// E5 · World-State Brain — the board-ready view over the escalation projection.
// posture-trajectory.ts projects each survival axis FORWARD over a set of
// horizons ("where is this heading in 6h / 24h / 72h?"); this module bounds +
// tones + labels that projection into a fixed "where this is heading" board card
// so the eventual renderer mount is a dumb map over these rows.
//
// Same split as the sibling surfacing-prep views (retrospective / decision-
// consequence / offline-playbook / comms-fallback / grid-down-certify): the
// projection core stays a pure function of the posture; the *view-model* here
// decides display order, per-horizon caps, tone, and label text. The core already
// emits its projections horizon-major and worst-first within each horizon, so this
// module preserves that ordering and simply groups it into per-horizon slices.
//
// Pure: no DOM, no fetch, no globals, no clock. A function of the passed trajectory.

import type { SurvivalAxis, SurvivalBand } from './survival-types.ts';
import { axisLabel, bandForLevel, bandRank } from './survival-types.ts';
import type {
  AxisProjection,
  PostureTrajectory,
  ProjectionDirection,
} from './posture-trajectory.ts';

/** Row / card tone.
 *  - danger: escalating into a high/critical band.
 *  - caution: escalating into a lower band, or holding high/critical.
 *  - muted: holding at a low band.
 *  - neutral: easing, or nothing to project. */
export type TrajectoryTone = 'danger' | 'caution' | 'muted' | 'neutral';

/** One render-ready axis projection row. */
export interface TrajectoryAxisRow {
  axis: SurvivalAxis;
  axisTitle: string;
  currentLevel: number;
  currentBand: SurvivalBand;
  projectedLevel: number;
  projectedBand: SurvivalBand;
  /** projectedLevel − currentLevel, rounded. */
  delta: number;
  /** "+18 pts" / "−6 pts" / "0 pts". */
  deltaLabel: string;
  direction: ProjectionDirection;
  /** "Escalating" / "Steady" / "Easing". */
  directionLabel: string;
  tone: TrajectoryTone;
  /** 0–1 projection confidence, carried verbatim. */
  confidence: number;
  /** "High" / "Medium" / "Low". */
  confidenceLabel: string;
  /** The projection's leading driver (drivers[0]). */
  topDriver: string;
  /** The core's rationale, carried verbatim. */
  rationale: string;
}

/** One horizon column: the worst axes projected to that horizon. */
export interface TrajectoryHorizonView {
  horizonId: string;
  horizonMins: number;
  /** Bounded axis rows, worst-first (highest projected level leads). */
  rows: TrajectoryAxisRow[];
  overflow: number;
  overflowLabel: string;
  /** Worst projected band across ALL axes at this horizon (not just shown rows). */
  worstBand: SurvivalBand;
}

export interface PostureTrajectoryBoardView {
  /** Constant board title. */
  title: string;
  /** One-liner from the projection core. */
  headline: string;
  /** Card tone: the worst row tone across the whole trajectory. */
  tone: TrajectoryTone;
  peakAxis: SurvivalAxis | null;
  /** "" when there is no peak. */
  peakAxisTitle: string;
  peakLevel: number;
  peakBand: SurvivalBand;
  peakHorizonId: string | null;
  /** Compact chip, e.g. "Supply reaching critical by 24h"; "" when nothing escalates. */
  peakCallout: string;
  /** How many projections are escalating across the whole trajectory. */
  escalatingCount: number;
  /** Per-horizon columns, in the core's horizon order. */
  horizons: TrajectoryHorizonView[];
  isEmpty: boolean;
}

export interface PostureTrajectoryViewOptions {
  /** Max axis rows shown per horizon before overflowing. Default 3. */
  maxAxesPerHorizon?: number;
}

const BOARD_TITLE = 'Where this is heading';
const DEFAULT_MAX_AXES = 3;
/** Mirror the core's own "holds steady" floor: below this projected level there
 *  is no escalation story worth a callout. */
const CALLOUT_FLOOR = 20;

const TONE_RANK: Record<TrajectoryTone, number> = {
  danger: 3,
  caution: 2,
  muted: 1,
  neutral: 0,
};

function directionLabel(direction: ProjectionDirection): string {
  switch (direction) {
    case 'escalating': {
      return 'Escalating';
    }
    case 'steady': {
      return 'Steady';
    }
    case 'easing': {
      return 'Easing';
    }
  }
}

function verbForDirection(direction: ProjectionDirection): string {
  switch (direction) {
    case 'escalating': {
      return 'reaching';
    }
    case 'steady': {
      return 'holding at';
    }
    case 'easing': {
      return 'easing to';
    }
  }
}

function deltaLabel(delta: number): string {
  const r = Math.round(Number.isFinite(delta) ? delta : 0);
  if (r > 0) return `+${r} pts`;
  if (r < 0) return `−${Math.abs(r)} pts`;
  return '0 pts';
}

function confidenceLabel(confidence: number): string {
  const c = Number.isFinite(confidence) ? confidence : 0;
  if (c >= 0.75) return 'High';
  if (c >= 0.5) return 'Medium';
  return 'Low';
}

/** Row tone blends the trajectory DIRECTION with the projected band, so a
 *  worsening axis heading into critical reads danger, while an axis merely
 *  holding at a low band reads muted. A steady high/critical axis stays caution
 *  — it is not getting worse, but it is not quiet either. */
function rowTone(direction: ProjectionDirection, band: SurvivalBand): TrajectoryTone {
  const severe = band === 'critical' || band === 'high';
  switch (direction) {
    case 'escalating': {
      return severe ? 'danger' : 'caution';
    }
    case 'steady': {
      return severe ? 'caution' : 'muted';
    }
    case 'easing': {
      return 'neutral';
    }
  }
}

function toRow(p: AxisProjection): TrajectoryAxisRow {
  const projectedBand = p.projectedBand;
  return {
    axis: p.axis,
    axisTitle: axisLabel(p.axis),
    currentLevel: p.currentLevel,
    currentBand: bandForLevel(p.currentLevel),
    projectedLevel: p.projectedLevel,
    projectedBand,
    delta: Math.round(p.delta),
    deltaLabel: deltaLabel(p.delta),
    direction: p.direction,
    directionLabel: directionLabel(p.direction),
    tone: rowTone(p.direction, projectedBand),
    confidence: p.confidence,
    confidenceLabel: confidenceLabel(p.confidence),
    topDriver: p.drivers[0] ?? 'no active escalation drivers',
    rationale: p.rationale,
  };
}

function worstBandOf(projections: readonly AxisProjection[]): SurvivalBand {
  let worst: SurvivalBand = 'secure';
  for (const p of projections) {
    if (bandRank(p.projectedBand) > bandRank(worst)) worst = p.projectedBand;
  }
  return worst;
}

function cardTone(rows: readonly TrajectoryAxisRow[]): TrajectoryTone {
  let worst: TrajectoryTone = 'neutral';
  for (const r of rows) {
    if (TONE_RANK[r.tone] > TONE_RANK[worst]) worst = r.tone;
  }
  return worst;
}

/** Build the "peak escalation" chip from the peak (axis, horizon) point. Empty
 *  when there is no peak or the peak sits below the callout floor. */
function peakCallout(
  trajectory: PostureTrajectory,
  peakBand: SurvivalBand,
): string {
  if (trajectory.peakAxis === null || trajectory.peakLevel < CALLOUT_FLOOR) return '';
  const peak = trajectory.projections.find(
    (p) => p.axis === trajectory.peakAxis && p.horizonId === trajectory.peakHorizonId,
  );
  if (!peak) return '';
  const when = peak.horizonId ? ` by ${peak.horizonId}` : '';
  return `${axisLabel(peak.axis)} ${verbForDirection(peak.direction)} ${peakBand}${when}`;
}

/** Bound, tone, and format a posture trajectory into a board card view-model.
 *  Rows are grouped per horizon in the core's own order; within each horizon the
 *  core already sorts worst-first, so a `maxAxesPerHorizon` cap drops the
 *  least-severe axes and reports the remainder as overflow. Card-level counts
 *  (escalating, peak, worst band) read the WHOLE trajectory so a tight cap can
 *  never understate how much is heading the wrong way. */
export function buildPostureTrajectoryBoardView(
  trajectory: PostureTrajectory,
  options: PostureTrajectoryViewOptions = {},
): PostureTrajectoryBoardView {
  const rawMax = options.maxAxesPerHorizon ?? DEFAULT_MAX_AXES;
  // A non-positive cap would blank every horizon; floor to 1 so each horizon
  // always shows its single worst axis.
  const maxAxes = Number.isFinite(rawMax) ? Math.max(1, Math.floor(rawMax)) : DEFAULT_MAX_AXES;

  const horizons: TrajectoryHorizonView[] = trajectory.horizons.map((h) => {
    const forHorizon = trajectory.projections.filter((p) => p.horizonId === h.id);
    const shown = forHorizon.slice(0, maxAxes);
    const rows = shown.map((p) => toRow(p));
    const overflow = forHorizon.length - rows.length;
    return {
      horizonId: h.id,
      horizonMins: h.mins,
      rows,
      overflow,
      overflowLabel: overflow > 0 ? `+${overflow} more` : '',
      worstBand: worstBandOf(forHorizon),
    };
  });

  // Tone + escalating count read every projection, not just the bounded rows.
  const allRows = trajectory.projections.map((p) => toRow(p));
  const escalatingCount = trajectory.projections.filter((p) => p.direction === 'escalating').length;

  const peakBand = bandForLevel(trajectory.peakLevel);

  return {
    title: BOARD_TITLE,
    headline: trajectory.headline,
    tone: cardTone(allRows),
    peakAxis: trajectory.peakAxis,
    peakAxisTitle: trajectory.peakAxis ? axisLabel(trajectory.peakAxis) : '',
    peakLevel: trajectory.peakLevel,
    peakBand,
    peakHorizonId: trajectory.peakHorizonId,
    peakCallout: peakCallout(trajectory, peakBand),
    escalatingCount,
    horizons,
    isEmpty: trajectory.projections.length === 0,
  };
}
