/**
 * Pure helpers for the EEWStatusBar UI (Layer 9).
 *
 * The DOM-bound component file imports these and uses them to map a
 * status payload into render properties. Keeping the mapping pure means
 * we can unit-test the visual state without spinning up the DOM.
 */

import type { EewAlert, EewTier } from './eew-alert-engine';

export type StatusBarColor =
  | 'gray'
  | 'blue'
  | 'yellow'
  | 'orange'
  | 'red'
  | 'crimson';

export interface StatusBarState {
  /** True when nothing above TIER_1 is active. */
  allClear: boolean;
  color: StatusBarColor;
  label: string;
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

/** Map a status payload into the visual state for the bar. */
export function deriveStatusBarState(payload: EewStatusPayload | null): StatusBarState {
  if (!payload || payload.activeAlerts.length === 0) {
    return {
      allClear: true,
      color: 'gray',
      label: 'ALL CLEAR',
      tier: null,
      lastAlert: null,
      imessage: { visible: false, status: null },
    };
  }

  const lead = pickLeadAlert(payload.activeAlerts);
  const tier = lead?.tier ?? payload.highestTier;
  if (!tier || !lead) {
    return {
      allClear: true,
      color: 'gray',
      label: 'ALL CLEAR',
      tier: null,
      lastAlert: null,
      imessage: { visible: false, status: null },
    };
  }

  // Below TIER_2, label is INFO but it's not "active" enough to count
  // as a non-clear state. Per spec the bar shows TIER_1_INFO color/label
  // but allClear stays false since we have an active info alert.
  return {
    allClear: false,
    color: TIER_COLORS[tier],
    label: TIER_LABELS[tier],
    tier,
    lastAlert: lead,
    imessage: deriveImessageState(lead),
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
