/**
 * Weather nowcast confirmation loop — Phase 4 of
 * docs/CLAUDE_HIGH_IMPACT_EVENT_INTELLIGENCE_VISION_2026-04-29.md.
 *
 * Pure deterministic. Tracks expected nowcast signals (radar core
 * strengthening, lightning density rise, storm reports, power
 * outages, airport ground stops, stream gauge rise) and:
 *   - Confirms the situation when those signals arrive in time
 *   - Decays urgency when they don't
 *
 * This is a domain-specific complement to the generic watch-window
 * evaluator: it adds a richer confirmation taxonomy + escalation
 * logic specific to severe weather.
 */

// ── Public API ──────────────────────────────────────────────────────────

export type NowcastSignalKind =
  | 'radar_core_strengthening'
  | 'lightning_density_rise'
  | 'storm_reports'
  | 'power_outage_reports'
  | 'airport_ground_stops'
  | 'stream_gauge_rise'
  | 'polygon_expansion';

export interface NowcastSignal {
  kind: NowcastSignalKind;
  observedAt: number;
  /** 0..1 strength of the observation (radar reflectivity, outage
   *  count fraction, etc.). */
  strength: number;
  /** Free-text source label. */
  source: string;
}

export interface NowcastEvaluation {
  /** Whether enough confirmation signals have appeared to escalate
   *  the underlying situation. */
  escalate: boolean;
  /** Whether enough confirmations have arrived to declare the
   *  situation 'confirmed' (UI can stop showing "watch" wording). */
  confirmed: boolean;
  /** Plain-English reason. */
  reason: string;
  /** Confirmation count by kind. */
  byKind: Readonly<Record<NowcastSignalKind, number>>;
  /** Total weighted confirmation score 0..1. */
  weightedScore: number;
  /** Recommended urgency adjustment for the host to apply on top
   *  of the existing situation urgency. Bounded -0.2..+0.2. */
  urgencyDelta: number;
}

export interface NowcastInput {
  /** Signals observed since the situation was first emitted. */
  signals: readonly NowcastSignal[];
  /** Optional escalation threshold (default 0.5). */
  escalateAt?: number;
  /** Optional confirmation threshold (default 0.7). */
  confirmAt?: number;
}

const KIND_WEIGHT: Record<NowcastSignalKind, number> = {
  radar_core_strengthening: 0.25,
  lightning_density_rise: 0.15,
  storm_reports: 0.2,
  power_outage_reports: 0.15,
  airport_ground_stops: 0.1,
  stream_gauge_rise: 0.1,
  polygon_expansion: 0.05,
};

export function evaluateWeatherNowcast(input: NowcastInput): NowcastEvaluation {
  const escalateAt = input.escalateAt ?? 0.5;
  const confirmAt = input.confirmAt ?? 0.7;

  const byKind: Record<NowcastSignalKind, number> = {
    radar_core_strengthening: 0,
    lightning_density_rise: 0,
    storm_reports: 0,
    power_outage_reports: 0,
    airport_ground_stops: 0,
    stream_gauge_rise: 0,
    polygon_expansion: 0,
  };
  let weightedScore = 0;
  for (const sig of input.signals) {
    byKind[sig.kind] = (byKind[sig.kind] ?? 0) + 1;
    // Weight by kind × strength; cap at 1 so a single very-strong
    // signal can't dominate over diversity.
    weightedScore += Math.min(1, sig.strength) * KIND_WEIGHT[sig.kind];
  }
  weightedScore = Math.min(1, weightedScore);

  const escalate = weightedScore >= escalateAt;
  const confirmed = weightedScore >= confirmAt;
  // Linear ramp: 0.5 → +0.05, 0.9 → +0.2. Below escalateAt, mild
  // negative for "things are quieting down" so urgency drifts back
  // when no signals arrive.
  let urgencyDelta = 0;
  if (weightedScore >= escalateAt) {
    urgencyDelta = Math.min(0.2, 0.05 + (weightedScore - escalateAt) * 0.4);
  } else if (input.signals.length === 0) {
    urgencyDelta = -0.05;
  }

  let reason: string;
  if (confirmed) {
    reason = `Confirmed by ${input.signals.length} nowcast signal(s) (weighted ${weightedScore.toFixed(2)} ≥ confirm ${confirmAt})`;
  } else if (escalate) {
    reason = `Escalating: ${input.signals.length} signal(s), weighted ${weightedScore.toFixed(2)} ≥ escalate ${escalateAt}`;
  } else {
    reason = `Below escalation threshold (${weightedScore.toFixed(2)} < ${escalateAt})`;
  }

  return {
    escalate,
    confirmed,
    reason,
    byKind,
    weightedScore,
    urgencyDelta,
  };
}
