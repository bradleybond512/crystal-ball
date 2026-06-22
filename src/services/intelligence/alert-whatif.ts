/**
 * Alert "what-if" — the counterfactual completion of Wave 5 ("decision support")
 * from CRYSTAL_BALL_OVERHAUL_ROADMAP.md, built on `alert-prioritization.ts`.
 *
 * The roadmap's what-if: "if entity X continues / this situation escalates, what
 * happens to the queue?" Here that means mutating one alert's probability /
 * impact / deadline and reporting how the *prioritized* queue reorders — what
 * newly crosses into `act_now` — plus an act-by clock-advance simulation that
 * shows which alerts become urgent as time passes.
 *
 * Distinct from `counterfactual-replay.ts` (domain-level world-snapshot replay)
 * and `course-of-action.ts` (LLM action plans): this is a deterministic,
 * decision-theoretic what-if over the alert queue itself.
 *
 * Pure deterministic. No DOM, no fetch, no globals.
 */

import {
  prioritizeAlerts,
  type AlertSignal,
  type PrioritizedAlert,
  type PrioritizeAlertsOptions,
  type AlertRecommendation,
} from './alert-prioritization';

// ── What-if on a single alert ────────────────────────────────────────────────

export interface AlertMutation {
  /** Set probability (0..1). Applied before `probabilityDelta`. */
  probability?: number;
  /** Add to probability (clamped downstream). */
  probabilityDelta?: number;
  /** Set impact (0..100). */
  impact?: number;
  /** Set time-to-deadline (ms). */
  timeToDeadlineMs?: number;
}

export interface WhatIfResult {
  alertId: string;
  before: PrioritizedAlert;
  after: PrioritizedAlert;
  scoreDelta: number;
  /** 1-based rank in the queue (1 = top priority). */
  rankBefore: number;
  rankAfter: number;
  /** Positive = moved up toward the top of the queue. */
  rankDelta: number;
  recommendationBefore: AlertRecommendation;
  recommendationAfter: AlertRecommendation;
  /** True when the alert was not `act_now` before and is `act_now` after. */
  crossedIntoActNow: boolean;
  summary: string;
}

/**
 * Apply a hypothetical mutation to one alert and report how it moves in the
 * prioritized queue. Returns undefined when `alertId` is not in `alerts`.
 */
export function whatIfAlert(
  alerts: readonly AlertSignal[],
  alertId: string,
  mutation: AlertMutation,
  options: PrioritizeAlertsOptions = {},
): WhatIfResult | undefined {
  const target = alerts.find((a) => a.id === alertId);
  if (target === undefined) return undefined;

  const mutated = alerts.map((a) => (a.id === alertId ? applyMutation(a, mutation) : a));
  const before = prioritizeAlerts(alerts, options);
  const after = prioritizeAlerts(mutated, options);

  const beforeAlert = before.find((p) => p.id === alertId)!;
  const afterAlert = after.find((p) => p.id === alertId)!;
  const rankBefore = before.findIndex((p) => p.id === alertId) + 1;
  const rankAfter = after.findIndex((p) => p.id === alertId) + 1;
  const crossedIntoActNow =
    beforeAlert.recommendation !== 'act_now' && afterAlert.recommendation === 'act_now';

  return {
    alertId,
    before: beforeAlert,
    after: afterAlert,
    scoreDelta: round2(afterAlert.score - beforeAlert.score),
    rankBefore,
    rankAfter,
    rankDelta: rankBefore - rankAfter,
    recommendationBefore: beforeAlert.recommendation,
    recommendationAfter: afterAlert.recommendation,
    crossedIntoActNow,
    summary: summarize(alertId, beforeAlert, afterAlert, rankBefore, rankAfter, crossedIntoActNow),
  };
}

function applyMutation(alert: AlertSignal, mutation: AlertMutation): AlertSignal {
  let probability = alert.probability;
  if (mutation.probability !== undefined) probability = mutation.probability;
  if (mutation.probabilityDelta !== undefined) probability += mutation.probabilityDelta;
  return {
    ...alert,
    probability,
    impact: mutation.impact ?? alert.impact,
    timeToDeadlineMs: mutation.timeToDeadlineMs ?? alert.timeToDeadlineMs,
  };
}

function summarize(
  id: string,
  before: PrioritizedAlert,
  after: PrioritizedAlert,
  rankBefore: number,
  rankAfter: number,
  crossedIntoActNow: boolean,
): string {
  const move = movePhrase(rankBefore, rankAfter);
  const rec =
    before.recommendation === after.recommendation
      ? after.recommendation
      : `${before.recommendation}→${after.recommendation}`;
  const flag = crossedIntoActNow ? ' — now ACT NOW' : '';
  return `${id} ${move} (score ${before.score}→${after.score}; ${rec})${flag}.`;
}

function movePhrase(rankBefore: number, rankAfter: number): string {
  if (rankAfter < rankBefore) return `rises #${rankBefore}→#${rankAfter}`;
  if (rankAfter > rankBefore) return `falls #${rankBefore}→#${rankAfter}`;
  return `holds #${rankBefore}`;
}

// ── Act-by clock advance ─────────────────────────────────────────────────────

export interface ClockAdvanceResult {
  deltaMs: number;
  before: PrioritizedAlert[];
  after: PrioritizedAlert[];
  /** Alert ids that were not `act_now` before and are `act_now` after. */
  newlyActNow: string[];
}

/**
 * Advance the wall clock by `deltaMs`: every alert's deadline moves that much
 * closer (deadline-less alerts are unaffected). Reports which alerts newly
 * become `act_now` as their act-by window tightens — the queue's urgency
 * pressure made explicit.
 */
export function advanceClock(
  alerts: readonly AlertSignal[],
  deltaMs: number,
  options: PrioritizeAlertsOptions = {},
): ClockAdvanceResult {
  const advanced = alerts.map((a) => {
    if (a.timeToDeadlineMs === undefined || !Number.isFinite(a.timeToDeadlineMs)) return a;
    return { ...a, timeToDeadlineMs: a.timeToDeadlineMs - deltaMs };
  });
  const before = prioritizeAlerts(alerts, options);
  const after = prioritizeAlerts(advanced, options);

  const wasActNow = new Set(
    before.filter((p) => p.recommendation === 'act_now').map((p) => p.id),
  );
  const newlyActNow = after
    .filter((p) => p.recommendation === 'act_now' && !wasActNow.has(p.id))
    .map((p) => p.id);

  return { deltaMs, before, after, newlyActNow };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
