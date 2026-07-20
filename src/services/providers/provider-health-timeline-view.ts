/**
 * Provider health timeline — pure view-model over a provider's fetch-outcome
 * ring buffer (`ProviderHealthState.outcomes[id]`). Turns the raw outcomes
 * into a compact, renderable timeline (oldest → newest dots + a windowed
 * success rate) for the SourceConfidencePanel's per-provider health strip.
 *
 * Reuses the existing ring buffer verbatim — no new scoring math, just a
 * windowing + shaping pass. Pure: no DOM, no fetch, no globals; `now` is
 * always caller-supplied so this stays fixture-testable.
 */

import type { ProviderHealthState } from './provider-health.ts';

export interface TimelinePoint {
  ok: boolean;
  at: number;
  latencyMs: number;
  httpStatus?: number;
}

export interface ProviderTimelineView {
  providerId: string;
  /** Oldest → newest, capped at `limit` (most recent outcomes). */
  points: readonly TimelinePoint[];
  /** Success rate over just the returned window (0..1); 1 when empty. */
  windowSuccessRate: number;
  /** ms since the most recent recorded outcome (success or failure). */
  lastOutcomeAgeMs?: number;
}

export const DEFAULT_TIMELINE_LIMIT = 20;

export function buildProviderTimeline(
  state: ProviderHealthState,
  providerId: string,
  now: number,
  limit = DEFAULT_TIMELINE_LIMIT,
): ProviderTimelineView {
  const all = state.outcomes[providerId] ?? [];
  const windowed = all.slice(-limit);
  const points: TimelinePoint[] = windowed.map((o) => ({
    ok: o.ok,
    at: o.at,
    latencyMs: o.latencyMs,
    httpStatus: o.httpStatus,
  }));
  const successCount = points.filter((p) => p.ok).length;
  const windowSuccessRate = points.length === 0 ? 1 : successCount / points.length;
  const last = points[points.length - 1];
  return {
    providerId,
    points,
    windowSuccessRate,
    lastOutcomeAgeMs: last ? Math.max(0, now - last.at) : undefined,
  };
}

/** Batch helper for a domain's provider list. */
export function buildProviderTimelines(
  state: ProviderHealthState,
  providerIds: readonly string[],
  now: number,
  limit = DEFAULT_TIMELINE_LIMIT,
): Record<string, ProviderTimelineView> {
  const out: Record<string, ProviderTimelineView> = {};
  for (const id of providerIds) out[id] = buildProviderTimeline(state, id, now, limit);
  return out;
}
