/**
 * Time-to-Warn engine — per
 * docs/CLOSED_LOOP_INTELLIGENCE_OPERATIONS_PLAN.md PR 2.
 *
 * Reads mission records (PR 1) and computes per-mission TimeToWarn
 * metrics: how early did the first signal land, how soon after that
 * did the user actually get notified, how far ahead of the actual
 * impact was the warning, and how does the system compare against
 * the gameplan's lead-time targets (45 min for severe weather, 5
 * days for fuel stress, 30 days for shortages, …).
 *
 * Pure deterministic. No DOM, no fetch, no globals at import time.
 *
 * Plan invariants:
 *   - Lead time is computed from `firstWarningAt` (the first
 *     `user_notified` event) to `actualImpactAt` (the first
 *     `actual_impact` event). Positive = warned in advance,
 *     negative = warned after the fact.
 *   - The signal-to-warn lag (`firstSignalAt` → `firstWarningAt`)
 *     measures how slowly the system responds to a detected signal.
 *   - Roll-ups are per-domain so "is the weather mission working?"
 *     is answerable independently of "is the markets mission working?".
 */

import type {
  MissionDomain,
  MissionEvent,
  MissionRecord,
} from './mission-types';

// ── Public API ──────────────────────────────────────────────────────────

export interface TimeToWarnMetrics {
  missionId: string;
  domain: MissionDomain;
  /** ms timestamp of the first weak / detected signal. Undefined when
   *  the mission was created without a recorded weak signal. */
  firstSignalAt?: number;
  /** ms timestamp of the first user-notified event. */
  firstWarningAt?: number;
  /** ms timestamp of the actual_impact event. Undefined when the
   *  mission has no ground-truth impact yet. */
  actualImpactAt?: number;
  /** firstWarningAt - firstSignalAt. Undefined when either is missing.
   *  Positive numbers mean the system was slow to fire after detection. */
  signalLagMs?: number;
  /** actualImpactAt - firstWarningAt. Positive = warned in advance,
   *  negative = warned after the event. Undefined when either is
   *  missing. */
  leadTimeMs?: number;
  /** A categorical assessment of leadTimeMs against the domain target. */
  rating: TimeToWarnRating;
  /** Free-text reason — surfaced in the diagnostics inspector. */
  reason: string;
  /** Did the user take any explicit action? Helps distinguish "warned
   *  but ignored" from "warned and acted". */
  userActed: boolean;
}

export type TimeToWarnRating =
  | 'on_target'      // within or beyond the domain's target lead time
  | 'too_late'       // warned, but not enough lead time
  | 'after_event'    // warning fired after the impact
  | 'no_warning'     // event impacted, no warning was ever sent
  | 'pending'        // mission still active or no impact recorded
  | 'unknown';       // not enough events to evaluate

/** Plan-defined target lead times per domain. The gameplan's
 *  Time-To-Warn Engine section calls these out explicitly. */
export const DEFAULT_DOMAIN_TARGETS_MS: Record<MissionDomain, number> = {
  weather_safety: 45 * 60 * 1000,                 // 45 minutes
  conflict_escalation: 48 * 60 * 60 * 1000,       // 48 hours (airspace closure)
  cyber_exposure: 8 * 60 * 60 * 1000,             // 8 hours (mainstream reporting)
  food_commodity_shortage: 30 * 24 * 60 * 60 * 1000, // 30 days
  energy_fuel_stress: 5 * 24 * 60 * 60 * 1000,    // 5 days
  travel_disruption: 4 * 60 * 60 * 1000,          // 4 hours
  market_portfolio_risk: 24 * 60 * 60 * 1000,     // 24 hours
  local_infrastructure: 30 * 60 * 1000,           // 30 minutes
};

export interface ComputeTimeToWarnOptions {
  /** Override the default per-domain target lead times. */
  domainTargetsMs?: Partial<Record<MissionDomain, number>>;
}

export function computeTimeToWarn(
  mission: MissionRecord,
  options: ComputeTimeToWarnOptions = {},
): TimeToWarnMetrics {
  const targetMs = options.domainTargetsMs?.[mission.domain] ?? DEFAULT_DOMAIN_TARGETS_MS[mission.domain];

  const firstSignalAt = firstEventTime(mission.events, 'weak_signal') ??
    firstEventTime(mission.events, 'app_watch');
  const firstWarningAt = firstEventTime(mission.events, 'user_notified');
  const actualImpactAt = firstEventTime(mission.events, 'actual_impact');
  const userActed = mission.events.some(
    (e) => e.kind === 'user_acknowledged' || e.kind === 'user_action_taken',
  );

  const signalLagMs =
    firstSignalAt !== undefined && firstWarningAt !== undefined
      ? firstWarningAt - firstSignalAt
      : undefined;
  const leadTimeMs =
    firstWarningAt !== undefined && actualImpactAt !== undefined
      ? actualImpactAt - firstWarningAt
      : undefined;

  const { rating, reason } = decideRating(
    firstWarningAt,
    actualImpactAt,
    leadTimeMs,
    targetMs,
    mission,
  );

  return {
    missionId: mission.id,
    domain: mission.domain,
    firstSignalAt,
    firstWarningAt,
    actualImpactAt,
    signalLagMs,
    leadTimeMs,
    rating,
    reason,
    userActed,
  };
}

// ── Roll-up ────────────────────────────────────────────────────────────

export interface TimeToWarnSummary {
  domain: MissionDomain;
  /** Total missions evaluated in this domain. */
  total: number;
  /** Subset where leadTimeMs is defined. */
  evaluable: number;
  /** Median leadTimeMs (ms). NaN when evaluable=0. */
  medianLeadTimeMs: number;
  /** p25 leadTimeMs (ms). NaN when evaluable=0. */
  p25LeadTimeMs: number;
  /** p75 leadTimeMs (ms). */
  p75LeadTimeMs: number;
  /** Median signal-to-warn lag (ms). */
  medianSignalLagMs: number;
  /** Counts by rating. */
  ratingCounts: Record<TimeToWarnRating, number>;
  /** Hit rate against domain target — fraction of evaluable missions
   *  rated 'on_target'. */
  onTargetRate: number;
}

export function summarizeTimeToWarn(
  metrics: readonly TimeToWarnMetrics[],
): TimeToWarnSummary[] {
  const buckets = new Map<MissionDomain, TimeToWarnMetrics[]>();
  for (const m of metrics) {
    const list = buckets.get(m.domain) ?? [];
    list.push(m);
    buckets.set(m.domain, list);
  }
  const out: TimeToWarnSummary[] = [];
  for (const [domain, list] of buckets) {
    const evaluable = list.filter((m) => m.leadTimeMs !== undefined);
    const leadTimes = evaluable.map((m) => m.leadTimeMs!).sort((a, b) => a - b);
    const lags = evaluable
      .filter((m) => m.signalLagMs !== undefined)
      .map((m) => m.signalLagMs!)
      .sort((a, b) => a - b);
    const ratingCounts: Record<TimeToWarnRating, number> = {
      on_target: 0,
      too_late: 0,
      after_event: 0,
      no_warning: 0,
      pending: 0,
      unknown: 0,
    };
    for (const m of list) ratingCounts[m.rating] += 1;
    const onTarget = ratingCounts.on_target;
    out.push({
      domain,
      total: list.length,
      evaluable: evaluable.length,
      medianLeadTimeMs: percentile(leadTimes, 50),
      p25LeadTimeMs: percentile(leadTimes, 25),
      p75LeadTimeMs: percentile(leadTimes, 75),
      medianSignalLagMs: percentile(lags, 50),
      ratingCounts,
      onTargetRate: evaluable.length === 0 ? Number.NaN : onTarget / evaluable.length,
    });
  }
  out.sort((a, b) => a.domain.localeCompare(b.domain));
  return out;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function firstEventTime(events: readonly MissionEvent[], kind: MissionEvent['kind']): number | undefined {
  let best: number | undefined;
  for (const e of events) {
    if (e.kind !== kind) continue;
    if (best === undefined || e.at < best) best = e.at;
  }
  return best;
}

function decideRating(
  firstWarningAt: number | undefined,
  actualImpactAt: number | undefined,
  leadTimeMs: number | undefined,
  targetMs: number,
  mission: MissionRecord,
): { rating: TimeToWarnRating; reason: string } {
  // No impact yet → pending unless mission is resolved.
  if (actualImpactAt === undefined) {
    if (mission.status === 'active') {
      return { rating: 'pending', reason: 'Mission still active; no impact recorded yet.' };
    }
    if (mission.status === 'resolved_miss' && firstWarningAt !== undefined) {
      return { rating: 'unknown', reason: 'Mission resolved as a miss; no impact event to score lead time.' };
    }
    if (mission.status === 'resolved_miss' || mission.status === 'expired') {
      return { rating: 'unknown', reason: 'No impact event recorded — cannot evaluate lead time.' };
    }
    return { rating: 'unknown', reason: 'No impact event recorded.' };
  }
  // Impact recorded but no warning → no_warning.
  if (firstWarningAt === undefined) {
    return { rating: 'no_warning', reason: 'Event impacted but no user notification was dispatched.' };
  }
  if (leadTimeMs === undefined) {
    return { rating: 'unknown', reason: 'Lead time could not be computed.' };
  }
  if (leadTimeMs < 0) {
    return {
      rating: 'after_event',
      reason: `Warning fired ${formatHumanDuration(-leadTimeMs)} after impact.`,
    };
  }
  if (leadTimeMs >= targetMs) {
    return {
      rating: 'on_target',
      reason: `Lead time ${formatHumanDuration(leadTimeMs)} meets the ${formatHumanDuration(targetMs)} target.`,
    };
  }
  return {
    rating: 'too_late',
    reason: `Lead time ${formatHumanDuration(leadTimeMs)} below the ${formatHumanDuration(targetMs)} target.`,
  };
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0]!;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  const frac = rank - lo;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * frac;
}

function formatHumanDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)} min`;
  if (ms < 24 * 60 * 60_000) {
    const hours = ms / (60 * 60_000);
    return `${hours % 1 === 0 ? hours.toFixed(0) : hours.toFixed(1)} h`;
  }
  const days = ms / (24 * 60 * 60_000);
  return `${days % 1 === 0 ? days.toFixed(0) : days.toFixed(1)} d`;
}
