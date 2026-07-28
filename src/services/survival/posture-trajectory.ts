// src/services/survival/posture-trajectory.ts
//
// E5 · World-State Brain — escalation projection.
//
// The posture (survival-posture.ts) is a *present-state* reading: where each
// axis stands right now. This module projects it FORWARD over a set of
// horizons, answering "where is this heading in 6h / 24h / 72h?".
//
// Honesty rules (inherited from the intelligence stack invariants):
//   - The dominant signal is REAL threat-arrival timing (`timeToImpactMins`).
//     An approaching threat ramps the axis toward its severity as its arrival
//     window enters the horizon — this is genuine escalation, not invention.
//   - `trend` contributes only a small, bounded nudge so direction is honored
//     without fabricating a magnitude we don't have evidence for.
//   - Confidence decays with horizon length AND is discounted when a move is
//     driven by the heuristic nudge rather than a timed threat.
//   - Nothing is fabricated: a worsening axis with no timed threat holds level
//     (minus the small nudge) and says so, at reduced confidence.
//
// Pure: no DOM, no fetch, no globals. Deterministic in `now`-free terms — the
// caller passes the posture; projection is a function of it alone.

import type {
  AxisState, PostureThreat, SurvivalAxis, SurvivalBand, SurvivalPosture,
} from './survival-types.ts';
import { axisLabel, bandForLevel } from './survival-types.ts';

export interface TrajectoryHorizon {
  id: string;
  mins: number;
}

export const DEFAULT_HORIZONS: readonly TrajectoryHorizon[] = [
  { id: '6h', mins: 360 },
  { id: '24h', mins: 1440 },
  { id: '72h', mins: 4320 },
];

export type ProjectionDirection = 'escalating' | 'steady' | 'easing';

export interface AxisProjection {
  axis: SurvivalAxis;
  horizonId: string;
  horizonMins: number;
  currentLevel: number;
  /** 0–100 projected axis level at the horizon. */
  projectedLevel: number;
  projectedBand: SurvivalBand;
  /** projectedLevel − currentLevel. */
  delta: number;
  direction: ProjectionDirection;
  /** 0–1; lower = less certain (longer horizon, or nudge-driven). */
  confidence: number;
  drivers: string[];
  rationale: string;
}

export interface PostureTrajectory {
  capturedAtMs: number;
  horizons: TrajectoryHorizon[];
  /** Horizon-major, worst-first within each horizon. */
  projections: AxisProjection[];
  peakAxis: SurvivalAxis | null;
  peakLevel: number;
  peakHorizonId: string | null;
  headline: string;
}

export interface TrajectoryOptions {
  horizons?: readonly TrajectoryHorizon[];
}

/** How far a `worsening`/`improving` trend can move an axis, at the longest
 *  default horizon (72h). Deliberately small — trend is a tie-breaker, not the
 *  driver. Scales linearly with horizon length. */
const MAX_TREND_NUDGE = 10;
const NUDGE_FULL_MINS = 4320;

/** Movement smaller than this (either way) reads as "steady". */
const STEADY_BAND = 5;

function finite(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

function clampLevel(n: number): number {
  const v = finite(n);
  return Math.max(0, Math.min(100, v));
}

function horizonBaseConfidence(mins: number): number {
  const m = finite(mins);
  if (m <= 360) return 0.9;
  if (m <= 1440) return 0.72;
  if (m <= 4320) return 0.55;
  return 0.4;
}

function confidenceLabelFactor(label: PostureThreat['confidenceLabel']): number {
  if (label === 'high') return 1;
  if (label === 'medium') return 0.8;
  return 0.6;
}

function trendDirection(trend: AxisState['trend']): number {
  if (trend === 'worsening') return 1;
  if (trend === 'improving') return -1;
  return 0;
}

function trendNudge(trend: AxisState['trend'], mins: number): number {
  const dir = trendDirection(trend);
  if (dir === 0) return 0;
  const frac = Math.min(1, Math.max(0, finite(mins) / NUDGE_FULL_MINS));
  return dir * MAX_TREND_NUDGE * frac;
}

/** Level a single threat drives the axis to at horizon `mins`. Untimed /
 *  already-impacting threats contribute their full severity now. A timed
 *  threat MORE severe than the current level interpolates the axis up from
 *  the current level toward that severity as the horizon approaches its
 *  arrival (so a big storm 48h out already nudges the axis at 6h, rather than
 *  staying flat until its ramped fraction happens to exceed today's level).
 *  A timed threat no more severe than now cannot escalate — it contributes
 *  its own severity, which the caller's `max` leaves dominated by current. */
function threatContribution(threat: PostureThreat, mins: number, currentLevel: number): number {
  const full = clampLevel(threat.severity);
  const t = threat.timeToImpactMins;
  if (t == null || t <= 0) return full;
  if (full <= currentLevel) return full;
  const ramp = Math.min(1, Math.max(0, finite(mins) / t));
  return currentLevel + (full - currentLevel) * ramp;
}

function directionFor(delta: number): ProjectionDirection {
  if (delta > STEADY_BAND) return 'escalating';
  if (delta < -STEADY_BAND) return 'easing';
  return 'steady';
}

interface ThreatScan {
  approachPeak: number;
  peakThreat: PostureThreat | null;
}

function scanThreats(threats: readonly PostureThreat[], mins: number, currentLevel: number): ThreatScan {
  let approachPeak = 0;
  let peakThreat: PostureThreat | null = null;
  for (const th of threats) {
    const rs = threatContribution(th, mins, currentLevel);
    if (rs > approachPeak) {
      approachPeak = rs;
      peakThreat = th;
    }
  }
  return { approachPeak, peakThreat };
}

function confidenceFor(
  mins: number, scan: ThreatScan, delta: number, threatDriven: boolean,
): number {
  let confidence = horizonBaseConfidence(mins);
  // Any move NOT driven by a threat is trend-nudge guesswork — discount it. The
  // presence of an unrelated timed bystander threat must not rescue that
  // certainty, so this keys only on threatDriven.
  if (delta !== 0 && !threatDriven) confidence *= 0.7;
  // When a threat drives the projection, scale by THAT threat's evidence label —
  // not the max across unrelated threats on the axis. Note: AxisState.confidence
  // is deliberately NOT consulted; its `.total` encodes the axis LEVEL (see
  // survival-posture.buildAxisState), so coupling to it would penalize low-level
  // axes rather than reflect projection certainty.
  if (threatDriven && scan.peakThreat) {
    confidence *= confidenceLabelFactor(scan.peakThreat.confidenceLabel);
  }
  return Math.max(0, Math.min(1, Math.round(confidence * 100) / 100));
}

function driversFor(a: AxisState, scan: ThreatScan, threatDriven: boolean, nudge: number): string[] {
  const drivers: string[] = [];
  if (threatDriven && scan.peakThreat) {
    const when = scan.peakThreat.arrivalLabel ? ` arriving ${scan.peakThreat.arrivalLabel}` : '';
    drivers.push(`${scan.peakThreat.hazardLabel}${when}`);
  }
  if (nudge !== 0) drivers.push(`${a.trend} trend`);
  if (drivers.length === 0) drivers.push('no active escalation drivers');
  return drivers;
}

function rationaleFor(
  a: AxisState, horizon: TrajectoryHorizon, direction: ProjectionDirection, band: SurvivalBand, topDriver: string,
): string {
  if (direction === 'steady') {
    return `${axisLabel(a.axis)} holds near ${band} through ${horizon.id}.`;
  }
  const verb = direction === 'escalating' ? 'reach' : 'ease to';
  return `${axisLabel(a.axis)} projected to ${verb} ${band} by ${horizon.id} (${topDriver}).`;
}

function projectAxisAtHorizon(a: AxisState, horizon: TrajectoryHorizon): AxisProjection {
  const currentLevel = clampLevel(a.level);
  const mins = horizon.mins;
  const scan = scanThreats(a.threats, mins, currentLevel);

  const nudge = trendNudge(a.trend, mins);
  const nudgedCurrent = currentLevel + nudge;
  const projectedLevel = clampLevel(Math.max(nudgedCurrent, scan.approachPeak));
  const delta = Math.round((projectedLevel - currentLevel) * 10) / 10;
  const direction = directionFor(delta);

  // Strict `>`: a threat only "drives" the projection when it lifts the axis
  // ABOVE where the nudge alone would land — on a tie the nudge gets the credit.
  const threatDriven = scan.approachPeak > nudgedCurrent && a.threats.length > 0;
  const confidence = confidenceFor(mins, scan, delta, threatDriven);
  const drivers = driversFor(a, scan, threatDriven, nudge);

  const band = bandForLevel(projectedLevel);
  const rationale = rationaleFor(a, horizon, direction, band, drivers[0]!);

  return {
    axis: a.axis,
    horizonId: horizon.id,
    horizonMins: mins,
    currentLevel,
    projectedLevel,
    projectedBand: band,
    delta,
    direction,
    confidence,
    drivers,
    rationale,
  };
}

/** Summarize the peak axis's WHOLE-window trajectory. Keys on the last (longest)
 *  horizon's direction — not the single peak projection's local direction — so an
 *  axis that is highest now but declining across the window reads as easing rather
 *  than falsely "holding across the projection window". `run` is the peak axis's
 *  projections in horizon order (earliest → latest). */
function trajectoryHeadline(run: readonly AxisProjection[]): string {
  const last = run[run.length - 1]!;
  const peakLevel = run.reduce((m, p) => Math.max(m, p.projectedLevel), 0);
  if (peakLevel < 20) return 'Posture holds steady across the projection window.';
  const label = axisLabel(last.axis);
  if (last.direction === 'escalating') return `${label} projected to reach ${last.projectedBand} within ${last.horizonId}.`;
  if (last.direction === 'easing') return `${label} easing toward ${last.projectedBand} by ${last.horizonId}.`;
  return `${label} holds at ${last.projectedBand} across the projection window.`;
}

export function projectPostureTrajectory(
  posture: SurvivalPosture,
  options: TrajectoryOptions = {},
): PostureTrajectory {
  // Sanitize horizon minutes on intake so a caller's non-finite custom horizon
  // can never leak NaN/Infinity into projection output.
  const horizons: TrajectoryHorizon[] = (options.horizons ?? DEFAULT_HORIZONS)
    .map((h) => ({ id: h.id, mins: Math.max(0, finite(h.mins)) }));
  const axes = posture.axes ?? [];

  const projections: AxisProjection[] = [];
  for (const horizon of horizons) {
    const forHorizon = axes.map((a) => projectAxisAtHorizon(a, horizon));
    forHorizon.sort((x, y) => y.projectedLevel - x.projectedLevel);
    projections.push(...forHorizon);
  }

  let peak: AxisProjection | null = null;
  for (const p of projections) {
    if (!peak || p.projectedLevel > peak.projectedLevel) peak = p;
  }

  let headline = 'No posture data to project.';
  if (peak) {
    const peakAxis = peak.axis;
    headline = trajectoryHeadline(projections.filter((p) => p.axis === peakAxis));
  }

  return {
    capturedAtMs: posture.capturedAtMs,
    horizons,
    projections,
    peakAxis: peak ? peak.axis : null,
    peakLevel: peak ? peak.projectedLevel : 0,
    peakHorizonId: peak ? peak.horizonId : null,
    headline,
  };
}
