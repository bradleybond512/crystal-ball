/**
 * Alert prioritization — Wave 5 ("decision support & alert intelligence") of the
 * CRYSTAL_BALL_OVERHAUL_ROADMAP.md. The roadmap's rule: rank alerts by
 * **expected impact × calibrated probability × time-criticality**, not by raw
 * severity or event count — because alert fatigue, not missed events, is what
 * kills these systems.
 *
 * This is decision-theoretic and deliberately distinct from the existing
 * `prioritizer.ts` (additive severity + proximity + recency over
 * `ObservationEvent`s). Here each alert carries a probability it is real, an
 * impact if true, and an optional deadline; the score is the urgency-weighted
 * expected severity. Crucially it consumes the Wave 4 calibration layer: an
 * overconfident source's probability is de-biased *before* it competes for the
 * operator's attention, so a confident-but-wrong source can't dominate.
 *
 * Pure deterministic. No DOM, no fetch, no globals.
 */

import type { CalibrationReport, CalibrationGroupReport } from './calibration-report';

// ── Public types ───────────────────────────────────────────────────────────

export interface AlertSignal {
  id: string;
  domain?: string;
  sourceId?: string;
  /** Probability the alert reflects a real / true event, 0..1. */
  probability: number;
  /** Impact if true — magnitude of consequence on a 0..100 scale
   *  (severity-like; 100 = maximal). */
  impact: number;
  /** ms until the actionable deadline (lead time). Smaller = more urgent.
   *  Undefined = no deadline (relevant but not time-critical). A past
   *  deadline (negative) is treated as maximally urgent. */
  timeToDeadlineMs?: number;
  /** Optional provenance labels surfaced in the explanation. */
  provenance?: readonly string[];
}

/** Maps a raw probability to a calibrated one given the alert's context.
 *  Identity by default; derive a real one from a `CalibrationReport` via
 *  `calibrationAdjusterFromReport`. */
export type CalibrationAdjuster = (
  probability: number,
  ctx: { domain?: string; sourceId?: string },
) => number;

export type AlertRecommendation = 'act_now' | 'prepare' | 'monitor' | 'suppress';

export interface PriorityComponents {
  /** Probability after calibration de-biasing, 0..1. */
  calibratedProbability: number;
  /** Raw probability as supplied, 0..1. */
  rawProbability: number;
  /** Impact normalized to 0..1. */
  impact: number;
  /** Time-criticality weight, 0..1 (1 = imminent). */
  timeCriticality: number;
}

export interface PrioritizedAlert {
  id: string;
  /** Urgency-weighted expected severity, 0..100. Higher = act sooner. */
  score: number;
  components: PriorityComponents;
  recommendation: AlertRecommendation;
  /** Confidence + provenance + why, in one line. */
  explanation: string;
}

export interface PrioritizeAlertsOptions {
  /** Calibration de-biasing. Default identity (no adjustment). */
  adjuster?: CalibrationAdjuster;
  /** Lead-time (ms) at or under which urgency is maxed. Default 1 h. */
  urgentWithinMs?: number;
  /** Lead-time (ms) beyond which urgency floors. Default 24 h. */
  notUrgentBeyondMs?: number;
  /** Minimum time-criticality for an alert with no deadline. Default 0.3. */
  baselineTimeCriticality?: number;
  /** Score thresholds for the recommendation ladder. */
  thresholds?: { actNow: number; prepare: number; monitor: number };
}

const DEFAULT_THRESHOLDS = { actNow: 50, prepare: 25, monitor: 8 } as const;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// ── Scoring ──────────────────────────────────────────────────────────────────

/** Score and rank alerts, highest priority first. Stable: ties keep input
 *  order. */
export function prioritizeAlerts(
  alerts: readonly AlertSignal[],
  options: PrioritizeAlertsOptions = {},
): PrioritizedAlert[] {
  const adjuster = options.adjuster ?? ((p) => p);
  const urgentWithin = options.urgentWithinMs ?? HOUR_MS;
  const notUrgentBeyond = options.notUrgentBeyondMs ?? DAY_MS;
  const baseline = clamp01(options.baselineTimeCriticality ?? 0.3);
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;

  const scored = alerts.map((a, index) =>
    scoreOne(a, index, adjuster, urgentWithin, notUrgentBeyond, baseline, thresholds),
  );
  scored.sort((a, b) => b.alert.score - a.alert.score || a.index - b.index);
  return scored.map((s) => s.alert);
}

function scoreOne(
  alert: AlertSignal,
  index: number,
  adjuster: CalibrationAdjuster,
  urgentWithin: number,
  notUrgentBeyond: number,
  baseline: number,
  thresholds: { actNow: number; prepare: number; monitor: number },
): { alert: PrioritizedAlert; index: number } {
  const rawProbability = clamp01(alert.probability);
  const calibratedProbability = clamp01(
    adjuster(rawProbability, { domain: alert.domain, sourceId: alert.sourceId }),
  );
  const impact = clamp01((Number.isFinite(alert.impact) ? alert.impact : 0) / 100);
  const timeCriticality = timeCriticalityFor(
    alert.timeToDeadlineMs,
    urgentWithin,
    notUrgentBeyond,
    baseline,
  );

  // Urgency-weighted expected severity on a 0..100 scale.
  const score = round2(100 * calibratedProbability * impact * timeCriticality);
  const recommendation = recommend(score, thresholds);

  return {
    index,
    alert: {
      id: alert.id,
      score,
      components: { calibratedProbability, rawProbability, impact, timeCriticality },
      recommendation,
      explanation: explain(alert, {
        calibratedProbability,
        rawProbability,
        impact,
        timeCriticality,
      }),
    },
  };
}

function timeCriticalityFor(
  timeToDeadlineMs: number | undefined,
  urgentWithin: number,
  notUrgentBeyond: number,
  baseline: number,
): number {
  if (timeToDeadlineMs === undefined || !Number.isFinite(timeToDeadlineMs)) return baseline;
  if (timeToDeadlineMs <= urgentWithin) return 1; // imminent or overdue
  if (timeToDeadlineMs >= notUrgentBeyond) return baseline;
  // Linear ramp from baseline (at notUrgentBeyond) up to 1 (at urgentWithin).
  const span = notUrgentBeyond - urgentWithin;
  const frac = (notUrgentBeyond - timeToDeadlineMs) / span;
  return round4(baseline + (1 - baseline) * frac);
}

function recommend(
  score: number,
  thresholds: { actNow: number; prepare: number; monitor: number },
): AlertRecommendation {
  if (score >= thresholds.actNow) return 'act_now';
  if (score >= thresholds.prepare) return 'prepare';
  if (score >= thresholds.monitor) return 'monitor';
  return 'suppress';
}

function explain(alert: AlertSignal, c: PriorityComponents): string {
  const expectedSeverity = round1(100 * c.impact * c.calibratedProbability);
  const parts = [
    `Expected severity ${expectedSeverity}/100 (impact ${Math.round(c.impact * 100)} × p=${c.calibratedProbability})`,
  ];
  if (Math.abs(c.calibratedProbability - c.rawProbability) >= 0.01) {
    parts.push(`calibrated from raw p=${c.rawProbability}`);
  }
  parts.push(`urgency ${c.timeCriticality}`);
  if (alert.timeToDeadlineMs !== undefined && Number.isFinite(alert.timeToDeadlineMs)) {
    parts.push(deadlinePhrase(alert.timeToDeadlineMs));
  }
  if (alert.provenance && alert.provenance.length > 0) {
    parts.push(`sources: ${alert.provenance.join(', ')}`);
  }
  return `${parts.join('; ')}.`;
}

function deadlinePhrase(ms: number): string {
  if (ms < 0) return 'deadline passed';
  if (ms < HOUR_MS) return `deadline in ${Math.round(ms / 60_000)}m`;
  if (ms < DAY_MS) return `deadline in ${Math.round(ms / HOUR_MS)}h`;
  return `deadline in ${Math.round(ms / DAY_MS)}d`;
}

// ── Calibration-driven adjuster ──────────────────────────────────────────────

/**
 * Build a `CalibrationAdjuster` from a `CalibrationReport`. Applies a mean-bias
 * correction: a group whose forecasts run, on average, `signedBias` higher than
 * reality (overconfident) has its probabilities shrunk by that bias;
 * underconfident groups are nudged up. Per-source assessment takes precedence
 * over per-domain; groups with insufficient data are left untouched.
 */
export function calibrationAdjusterFromReport(report: CalibrationReport): CalibrationAdjuster {
  const bySource = indexGroups(report.bySource);
  const byDomain = indexGroups(report.byDomain);
  return (probability, ctx) => {
    const group =
      (ctx.sourceId !== undefined ? bySource.get(ctx.sourceId) : undefined) ??
      (ctx.domain !== undefined ? byDomain.get(ctx.domain) : undefined);
    if (!group || group.assessment.verdict === 'insufficient_data') return probability;
    return clamp01(probability - group.assessment.signedBias);
  };
}

function indexGroups(groups: readonly CalibrationGroupReport[]): Map<string, CalibrationGroupReport> {
  const map = new Map<string, CalibrationGroupReport>();
  for (const g of groups) map.set(g.key, g);
  return map;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function round4(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}
