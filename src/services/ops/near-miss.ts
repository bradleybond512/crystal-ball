/**
 * Near-miss detector — per
 * docs/CLOSED_LOOP_INTELLIGENCE_OPERATIONS_PLAN.md PR 5.
 *
 * A "near miss" is an event the app got partially right or saw too
 * late: the system *had* a weak signal but never escalated, the
 * warning fired only after the impact, or the user found the event
 * via an external source before we surfaced it.
 *
 * The detector turns these patterns into a structured record the
 * replay harness (PR 6) can consume as a regression fixture.
 *
 * Pure deterministic.
 */

import type { MissionEvent, MissionRecord } from './mission-types';

// ── Public API ──────────────────────────────────────────────────────────

export type NearMissKind =
  | 'late_warning'           // user_notified after actual_impact
  | 'silent_signal'          // weak_signal recorded but no user_notified
  | 'external_discovery'     // explicit near_miss event
  | 'unconfirmed'            // app_watch but no official_confirmed
  | 'low_follow_through';    // notified but user never acknowledged

export interface NearMissReport {
  missionId: string;
  domain: MissionRecord['domain'];
  kind: NearMissKind;
  /** Plain-English description for the inspector. */
  description: string;
  /** ms timestamp the near miss was identified. */
  detectedAt: number;
  /** Pivot timestamps the replay engine cares about. */
  signalAt?: number;
  warningAt?: number;
  impactAt?: number;
  /** Concrete remediation suggestion. */
  remediation: string;
}

export interface DetectNearMissesOptions {
  /** Optional clock for tests. Defaults to Date.now(). */
  now?: () => number;
  /** Window after impact within which a warning still counts as
   *  "after_event near-miss" rather than "no_warning". Default 24 h. */
  lateWarningWindowMs?: number;
}

const DEFAULT_LATE_WARNING_WINDOW_MS = 24 * 60 * 60 * 1000;

export function detectNearMisses(
  missions: readonly MissionRecord[],
  options: DetectNearMissesOptions = {},
): NearMissReport[] {
  const now = options.now ?? (() => Date.now());
  const lateWindowMs = options.lateWarningWindowMs ?? DEFAULT_LATE_WARNING_WINDOW_MS;
  const out: NearMissReport[] = [];
  for (const m of missions) {
    const report = classifyMission(m, lateWindowMs, now);
    if (report) out.push(report);
  }
  return out;
}

interface MissionTimings {
  signalAt?: number;
  warningAt?: number;
  impactAt?: number;
  officialAt?: number;
  userAck: boolean;
}

function extractMissionTimings(m: MissionRecord): MissionTimings {
  return {
    signalAt: firstEventTime(m.events, 'weak_signal'),
    warningAt: firstEventTime(m.events, 'user_notified'),
    impactAt: firstEventTime(m.events, 'actual_impact'),
    officialAt: firstEventTime(m.events, 'official_confirmed'),
    userAck: m.events.some((e) => e.kind === 'user_acknowledged'),
  };
}

function classifyMission(
  m: MissionRecord,
  lateWindowMs: number,
  now: () => number,
): NearMissReport | undefined {
  const t = extractMissionTimings(m);
  const explicit = m.events.find((e) => e.kind === 'near_miss');
  if (explicit) return externalDiscoveryReport(m, t, explicit);
  const lateReport = lateWarningReportIfApplicable(m, t, lateWindowMs);
  if (lateReport) return lateReport;
  if (t.signalAt !== undefined && t.warningAt === undefined) return silentSignalReport(m, t, now());
  if (m.events.some((e) => e.kind === 'app_watch') && t.officialAt === undefined && m.status !== 'active') {
    return unconfirmedReport(m, t, now());
  }
  if (t.warningAt !== undefined && !t.userAck && m.status !== 'active') {
    return lowFollowThroughReport(m, t);
  }
  return undefined;
}

function externalDiscoveryReport(
  m: MissionRecord,
  t: MissionTimings,
  explicit: { at: number; label: string },
): NearMissReport {
  return {
    missionId: m.id,
    domain: m.domain,
    kind: 'external_discovery',
    description: explicit.label || 'External discovery — user found this before we surfaced it.',
    detectedAt: explicit.at,
    signalAt: t.signalAt,
    warningAt: t.warningAt,
    impactAt: t.impactAt,
    remediation:
      'Open the Evaluation Ledger for this mission domain and treat the trigger as a regression fixture.',
  };
}

function lateWarningReportIfApplicable(
  m: MissionRecord,
  t: MissionTimings,
  lateWindowMs: number,
): NearMissReport | undefined {
  if (t.warningAt === undefined || t.impactAt === undefined) return undefined;
  if (t.warningAt <= t.impactAt) return undefined;
  const lag = t.warningAt - t.impactAt;
  if (lag > lateWindowMs) return undefined;
  return {
    missionId: m.id,
    domain: m.domain,
    kind: 'late_warning',
    description: `Warning fired ${formatMs(lag)} after impact.`,
    detectedAt: t.warningAt,
    signalAt: t.signalAt,
    warningAt: t.warningAt,
    impactAt: t.impactAt,
    remediation: 'Lower the urgency-ladder thresholds for this domain so escalation fires earlier.',
  };
}

function silentSignalReport(m: MissionRecord, t: MissionTimings, detectedAt: number): NearMissReport {
  return {
    missionId: m.id,
    domain: m.domain,
    kind: 'silent_signal',
    description: 'A weak signal was recorded but no user notification was ever dispatched.',
    detectedAt,
    signalAt: t.signalAt,
    warningAt: t.warningAt,
    impactAt: t.impactAt,
    remediation:
      'Audit the situation-engine → notification-router path: which gate suppressed this signal?',
  };
}

function unconfirmedReport(m: MissionRecord, t: MissionTimings, detectedAt: number): NearMissReport {
  return {
    missionId: m.id,
    domain: m.domain,
    kind: 'unconfirmed',
    description: 'App started watching the situation but no authoritative source ever confirmed it.',
    detectedAt,
    signalAt: t.signalAt,
    warningAt: t.warningAt,
    impactAt: t.impactAt,
    remediation:
      'Add a corroboration requirement before opening a watch, or expire the watch faster without confirmation.',
  };
}

function lowFollowThroughReport(m: MissionRecord, t: MissionTimings): NearMissReport {
  return {
    missionId: m.id,
    domain: m.domain,
    kind: 'low_follow_through',
    description: 'Warning was dispatched but the user never acknowledged.',
    detectedAt: t.warningAt!,
    signalAt: t.signalAt,
    warningAt: t.warningAt,
    impactAt: t.impactAt,
    remediation:
      'Consider raising the relevance threshold or adding a low-friction acknowledge action to the notification.',
  };
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

function formatMs(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)} min`;
  if (ms < 24 * 60 * 60_000) return `${(ms / (60 * 60_000)).toFixed(1)} h`;
  return `${(ms / (24 * 60 * 60_000)).toFixed(1)} d`;
}
