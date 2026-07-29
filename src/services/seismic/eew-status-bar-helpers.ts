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
export type StatusBarSource = 'eew' | 'weather' | 'safety' | 'readiness' | 'none';

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
  /**
   * The user's CURRENT personal weather threat — the worst Extreme/Severe
   * NWS alert matched to a saved place (getPersonalWeatherThreat()). This
   * is deliberately PERSONAL, not the national feed: there is always severe
   * weather somewhere, so the national feed would pin the chip non-clear.
   * 'extreme' → crimson "WEATHER: EXTREME" (rank 5), 'severe' → red
   * "SEVERE WEATHER" (rank 4). null / undefined = no personal threat.
   */
  weatherSeverity?: 'extreme' | 'severe' | null;
  /**
   * Whether a FRESH weather read has actually PROVEN no matched threat
   * (isPersonalWeatherClearConfirmed()). `weatherSeverity: null` alone is
   * ambiguous — it means both "proven clear" and "not evaluated yet" — so the
   * chip used to paint boot/stale states as a green ALL CLEAR it had not
   * verified. Only an explicit `true` may show ALL CLEAR; ANY other value —
   * `false`, or missing/undefined (boot, an unwired provider, or a provider
   * throw where readCompositeInputs() returns undefined) — fails closed to the
   * neutral CHECKING WEATHER state rather than claim an unverified all-clear.
   */
  weatherClearConfirmed?: boolean;
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
/** Personal Extreme weather (e.g. Tornado Warning over the user). Crimson,
 *  ties with TIER_5 EEW (which wins the tie as the live/imminent hazard). */
const WEATHER_EXTREME_RANK = 5;
/** Personal Severe weather. Red, ties with TIER_4 EEW / safety / readiness. */
const WEATHER_SEVERE_RANK = 4;

const WEATHER_RANK_BY_SEVERITY: Record<'extreme' | 'severe', number> = {
  extreme: WEATHER_EXTREME_RANK,
  severe: WEATHER_SEVERE_RANK,
};

const ALL_CLEAR_STATE: StatusBarState = {
  allClear: true,
  color: 'gray',
  label: 'ALL CLEAR',
  source: 'none',
  tier: null,
  lastAlert: null,
  imessage: { visible: false, status: null },
};

/** Neutral "we have not verified weather yet" state. Shown instead of ALL CLEAR
 *  when nothing else is alarming but a fresh weather read has not yet proven the
 *  area clear (boot, or a stale/failed feed). Deliberately NOT allClear and NOT
 *  red: honest uncertainty, neither a false all-clear nor a false alarm. */
const CHECKING_STATE: StatusBarState = {
  allClear: false,
  color: 'gray',
  label: 'CHECKING WEATHER',
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
interface CompositeRanks {
  weatherSeverity: 'extreme' | 'severe' | null;
  weatherRank: number;
  safetyReview: boolean;
  safetyRank: number;
  readinessRank: number;
}

/** Rank the non-EEW composite inputs. Kept out of deriveStatusBarState so the
 *  main dispatch stays flat: this is where the per-source ternaries live. */
function compositeRanks(composite?: CompositeStatusInputs): CompositeRanks {
  const weatherSeverity = composite?.weatherSeverity ?? null;
  const safetyReview = composite?.safetyCaseSafeToOperate === false;
  const readinessCritical = composite?.readinessStatus === 'unsafe';
  return {
    weatherSeverity,
    weatherRank: weatherSeverity ? WEATHER_RANK_BY_SEVERITY[weatherSeverity] : 0,
    safetyReview,
    safetyRank: safetyReview ? SAFETY_REVIEW_RANK : 0,
    readinessRank: readinessCritical ? READINESS_CRITICAL_RANK : 0,
  };
}

function weatherState(severity: 'extreme' | 'severe'): StatusBarState {
  const extreme = severity === 'extreme';
  return {
    allClear: false,
    color: extreme ? 'crimson' : 'red',
    label: extreme ? 'WEATHER: EXTREME' : 'SEVERE WEATHER',
    source: 'weather',
    tier: null,
    lastAlert: null,
    imessage: { visible: false, status: null },
  };
}

export function deriveStatusBarState(
  payload: EewStatusPayload | null,
  composite?: CompositeStatusInputs,
): StatusBarState {
  const lead = payload && payload.activeAlerts.length > 0
    ? pickLeadAlert(payload.activeAlerts)
    : null;
  const tier = lead?.tier ?? null;
  const eewRank = tier === null ? 0 : TIER_RANK[tier];
  const { weatherSeverity, weatherRank, safetyReview, safetyRank, readinessRank } =
    compositeRanks(composite);

  // Worst-of composite: the highest rank drives the chip. Ties break in
  // source order EEW > weather > safety > readiness (the checks below run in
  // that order), so a live seismic alert beats a storm, a storm beats the
  // meta signals, and safety beats readiness. "ALL CLEAR" only when all zero.
  const maxRank = Math.max(eewRank, weatherRank, safetyRank, readinessRank);
  if (maxRank === 0) {
    // Nothing is alarming — but only claim ALL CLEAR once a fresh weather read
    // has actually PROVEN no matched threat (weatherClearConfirmed === true).
    // Anything else — an explicit `false`, or a missing/undefined flag (boot,
    // an unwired composite provider, or a provider throw where
    // readCompositeInputs() returns undefined) — is an UNKNOWN weather state,
    // not a proven clear. Fail closed to neutral CHECKING rather than assert a
    // safety we have not verified.
    if (composite?.weatherClearConfirmed === true) {
      return { ...ALL_CLEAR_STATE, imessage: { visible: false, status: null } };
    }
    return { ...CHECKING_STATE, imessage: { visible: false, status: null } };
  }
  if (lead && tier && eewRank === maxRank) {
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
  if (weatherSeverity && weatherRank === maxRank) {
    return weatherState(weatherSeverity);
  }
  if (safetyReview && safetyRank === maxRank) {
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
