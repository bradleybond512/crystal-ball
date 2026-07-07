/**
 * Pure helpers for the EEWStatusBar UI (Layer 9).
 *
 * The DOM-bound component file imports these and uses them to map a
 * status payload into render properties. Keeping the mapping pure means
 * we can unit-test the visual state without spinning up the DOM.
 */

import type { EewAlert, EewTier } from './eew-alert-engine';
import type { HealthStatus } from '../diagnostics/system-health-types';

export type StatusBarColor =
  | 'gray'
  | 'blue'
  | 'yellow'
  | 'orange'
  | 'red'
  | 'crimson';

/** Which subsystem drives the chip when it is not all-clear. */
export type StatusBarSource = 'eew' | 'safety' | 'readiness' | 'none';

export interface StatusBarState {
  /** True only when EEW, safety case, AND readiness are all clear. */
  allClear: boolean;
  color: StatusBarColor;
  label: string;
  /** Which input decided the chip (worst-of across the three sources). */
  source: StatusBarSource;
  tier: EewTier | null;
  /** Most recent alert across activeAlerts (used for the subtitle). */
  lastAlert: EewAlert | null;
  /** TIER_5 only: status of the iMessage escalation. */
  imessage: {
    visible: boolean;
    status: 'sent' | 'failed' | 'disabled' | 'pending' | null;
    error?: string;
  };
}

/**
 * Non-EEW inputs for the composite chip. Callers gather these from the
 * relevant singletons at the call site so this module stays pure and
 * unit-testable (no service imports here).
 */
export interface CompositeStatusInputs {
  /**
   * Safety Case verdict (Safety Case panel): false when any safety
   * property is at FAIL — the panel shows "SAFETY REVIEW REQUIRED".
   * null / undefined = not evaluated yet (treated as clear).
   */
  safetyCaseSafeToOperate?: boolean | null;
  /**
   * System readiness from aggregateSystemHealth() — the state behind
   * the Command Center "Current risk" headline. 'unsafe' renders as
   * READINESS: CRITICAL. null / undefined = unknown (treated as clear).
   */
  readinessStatus?: HealthStatus | null;
}

const TIER_LABELS: Record<EewTier, string> = {
  TIER_1_INFO: 'TIER 1 — INFO',
  TIER_2_WATCH: 'TIER 2 — WATCH',
  TIER_3_WARNING: 'TIER 3 — WARNING',
  TIER_4_SEVERE: 'TIER 4 — SEVERE',
  TIER_5_EXTREME: 'TIER 5 — EXTREME',
};

const TIER_COLORS: Record<EewTier, StatusBarColor> = {
  TIER_1_INFO: 'blue',
  TIER_2_WATCH: 'yellow',
  TIER_3_WARNING: 'orange',
  TIER_4_SEVERE: 'red',
  TIER_5_EXTREME: 'crimson',
};

const TIER_RANK: Record<EewTier, number> = {
  TIER_1_INFO: 1,
  TIER_2_WATCH: 2,
  TIER_3_WARNING: 3,
  TIER_4_SEVERE: 4,
  TIER_5_EXTREME: 5,
};

export interface EewStatusPayload {
  activeAlerts: readonly EewAlert[];
  highestTier: EewTier | null;
  lastEventId: string | null;
  asOf: number;
}

/**
 * Pick the alert that should drive the status-bar subtitle. The
 * highest-tier alert wins; ties broken by most recent triggeredAt.
 */
export function pickLeadAlert(alerts: readonly EewAlert[]): EewAlert | null {
  if (alerts.length === 0) return null;
  let best = alerts[0]!;
  for (let i = 1; i < alerts.length; i += 1) {
    const candidate = alerts[i]!;
    const candidateRank = TIER_RANK[candidate.tier];
    const bestRank = TIER_RANK[best.tier];
    if (candidateRank > bestRank) best = candidate;
    else if (candidateRank === bestRank && candidate.triggeredAt > best.triggeredAt) {
      best = candidate;
    }
  }
  return best;
}

/** Severity rank (on the EEW 1–5 tier scale) for a failing safety case.
 *  Red-equivalent: outranks TIER_1..3, ties with TIER_4, loses to TIER_5. */
const SAFETY_REVIEW_RANK = 4;
/** Severity rank for readiness 'unsafe' ("Current risk CRITICAL"). */
const READINESS_CRITICAL_RANK = 4;

const ALL_CLEAR_STATE: StatusBarState = {
  allClear: true,
  color: 'gray',
  label: 'ALL CLEAR',
  source: 'none',
  tier: null,
  lastAlert: null,
  imessage: { visible: false, status: null },
};

/**
 * Map a status payload (+ optional composite inputs) into the visual
 * state for the bar.
 *
 * The chip is a worst-of composite across three sources:
 *   - EEW alerts (tier rank 1–5, existing labels/colors)
 *   - Safety Case safe-to-operate flag (rank 4 → "SAFETY REVIEW", red)
 *   - System readiness 'unsafe' (rank 4 → "READINESS: CRITICAL", red)
 *
 * Ties break in that order (a live seismic alert beats meta signals,
 * safety beats readiness) so the label always names the worst source.
 * "ALL CLEAR" is only shown when all three sources are clear.
 */
export function deriveStatusBarState(
  payload: EewStatusPayload | null,
  composite?: CompositeStatusInputs,
): StatusBarState {
  const lead = payload && payload.activeAlerts.length > 0
    ? pickLeadAlert(payload.activeAlerts)
    : null;
  const tier = lead?.tier ?? null;
  const eewRank = tier === null ? 0 : TIER_RANK[tier];

  const safetyReview = composite?.safetyCaseSafeToOperate === false;
  const readinessCritical = composite?.readinessStatus === 'unsafe';
  const safetyRank = safetyReview ? SAFETY_REVIEW_RANK : 0;
  const readinessRank = readinessCritical ? READINESS_CRITICAL_RANK : 0;

  if (eewRank === 0 && safetyRank === 0 && readinessRank === 0) {
    return { ...ALL_CLEAR_STATE, imessage: { visible: false, status: null } };
  }

  // Below TIER_2, label is INFO but it's not "active" enough to count
  // as a non-clear state. Per spec the bar shows TIER_1_INFO color/label
  // but allClear stays false since we have an active info alert.
  if (lead && tier && eewRank >= safetyRank && eewRank >= readinessRank) {
    return {
      allClear: false,
      color: TIER_COLORS[tier],
      label: TIER_LABELS[tier],
      source: 'eew',
      tier,
      lastAlert: lead,
      imessage: deriveImessageState(lead),
    };
  }

  if (safetyReview && safetyRank >= readinessRank) {
    return {
      allClear: false,
      color: 'red',
      label: 'SAFETY REVIEW',
      source: 'safety',
      tier: null,
      lastAlert: null,
      imessage: { visible: false, status: null },
    };
  }

  return {
    allClear: false,
    color: 'red',
    label: 'READINESS: CRITICAL',
    source: 'readiness',
    tier: null,
    lastAlert: null,
    imessage: { visible: false, status: null },
  };
}

function deriveImessageState(alert: EewAlert): StatusBarState['imessage'] {
  if (alert.tier !== 'TIER_5_EXTREME') {
    return { visible: false, status: null };
  }
  return {
    visible: true,
    status: alert.imessageStatus ?? null,
    error: alert.imessageError,
  };
}

/**
 * Compute the seconds-until-S-wave-arrival countdown for the lead
 * alert against the user's nearest saved place. Returns null when
 * there's no useful countdown (no saved-place clause in the trigger,
 * or distance/time data missing). The L9 component decrements this
 * client-side every second.
 */
export function deriveSWaveCountdownSec(
  alert: EewAlert | null,
  arrivalSWaveAtMs: number | null,
  nowMs: number,
): number | null {
  if (!alert || arrivalSWaveAtMs === null) return null;
  const remaining = Math.max(0, Math.round((arrivalSWaveAtMs - nowMs) / 1000));
  return remaining;
}

/** Format a time-ago string for the subtitle. Returns "just now" within
 *  60s, "Xm ago" otherwise. Pure — easy to test. */
export function formatTimeAgo(triggeredAt: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - triggeredAt) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
