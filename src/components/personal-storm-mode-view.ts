/**
 * Personal Storm Mode — pure view + visibility helpers.
 *
 * Per docs/WEATHER_WARNING_REMEDIATION_PLAN.md PR 5 ("Minimal Storm Mode
 * UI"). `PersonalStormMode.ts` owns the DOM; everything decidable without
 * a DOM lives here so it can be unit-tested with `tsx --test`
 * (precedent: `forecast-provenance-view.ts`).
 *
 * Covers:
 *   - Acknowledgment persistence records (localStorage payload shape) so
 *     an acked threat stays dismissed across reloads until it materially
 *     changes. The "meaningful change" rules mirror
 *     `weather-urgency.ts` repeat suppression: threat escalated, place
 *     crossed outside → inside polygon, or the polygon edge moved
 *     ≥ 5 km closer.
 *   - Snooze records (15-min quick action).
 *   - The show/hide decision for the strip, including expiry — the plan
 *     requires "a persistent in-app status until the threat expires or
 *     is acknowledged".
 *   - Display strings (tier chip, hazard-first title, meta rows) so the
 *     component renders via textContent only.
 *
 * Pure deterministic. No DOM, no fetch, no globals — the component passes
 * the persisted state in and writes it back out.
 */

import type { WeatherDispatchDecision } from '@/services/weather/weather-warning-router';
import type { ThreatLevel } from '@/services/weather/weather-threat-types';

// ── Persistence shape ────────────────────────────────────────────────────

/** localStorage key the component persists under (crystalball-* naming). */
export const STORM_MODE_UI_STORAGE_KEY = 'crystalball-storm-mode-ui-v1';

/** Distance-shrink threshold that counts as a meaningful change —
 *  mirrors `weather-urgency.ts` repeatIntervalFor. */
export const MEANINGFUL_DISTANCE_DELTA_KM = 5;

/** Acks with no recorded expiry are dropped after this long so the store
 *  can't grow without bound. */
const MAX_ACK_AGE_MS = 12 * 60 * 60 * 1000;

export interface StormAckRecord {
  alertId: string;
  /** Threat level at acknowledgment time — escalation past this resurfaces. */
  threatLevel: ThreatLevel;
  /** Whether the matched place was inside the polygon/zone at ack time. */
  wasInside: boolean;
  /** Distance to polygon edge at ack time (km). Undefined when inside
   *  or when the match had no distance. */
  distanceKm?: number;
  /** ms timestamp of the acknowledgment. */
  ackedAt: number;
  /** Alert expiry at ack time (ms) — prune anchor. */
  expiresAtMs?: number;
}

export interface StormSnoozeRecord {
  alertId: string;
  untilMs: number;
}

export interface StormModeUiState {
  acks: StormAckRecord[];
  snoozes: StormSnoozeRecord[];
}

export function emptyStormModeUiState(): StormModeUiState {
  return { acks: [], snoozes: [] };
}

/** Safe parse of the persisted JSON — malformed/foreign input degrades
 *  to the empty state instead of throwing. */
export function parseStormModeUiState(raw: string | null | undefined): StormModeUiState {
  if (!raw) return emptyStormModeUiState();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return emptyStormModeUiState();
    const obj = parsed as { acks?: unknown; snoozes?: unknown };
    const acks = Array.isArray(obj.acks)
      ? obj.acks.filter((a): a is StormAckRecord => isAckRecord(a))
      : [];
    const snoozes = Array.isArray(obj.snoozes)
      ? obj.snoozes.filter((s): s is StormSnoozeRecord => isSnoozeRecord(s))
      : [];
    return { acks, snoozes };
  } catch {
    return emptyStormModeUiState();
  }
}

export function serializeStormModeUiState(state: StormModeUiState): string {
  return JSON.stringify(state);
}

const THREAT_LEVELS: readonly ThreatLevel[] = ['none', 'advisory', 'watch', 'warning', 'emergency'];

function isAckRecord(value: unknown): value is StormAckRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.alertId === 'string'
    && typeof v.threatLevel === 'string'
    && THREAT_LEVELS.includes(v.threatLevel as ThreatLevel)
    && typeof v.wasInside === 'boolean'
    && typeof v.ackedAt === 'number'
    && (v.distanceKm === undefined || typeof v.distanceKm === 'number')
    && (v.expiresAtMs === undefined || typeof v.expiresAtMs === 'number');
}

function isSnoozeRecord(value: unknown): value is StormSnoozeRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.alertId === 'string' && typeof v.untilMs === 'number';
}

/** Drop expired snoozes and acks past their alert expiry (or older than
 *  MAX_ACK_AGE_MS when no expiry was recorded). */
export function pruneStormModeUiState(state: StormModeUiState, now: number): StormModeUiState {
  return {
    acks: state.acks.filter((a) => (a.expiresAtMs ?? a.ackedAt + MAX_ACK_AGE_MS) > now),
    snoozes: state.snoozes.filter((s) => s.untilMs > now),
  };
}

// ── Ack / snooze record builders ─────────────────────────────────────────

/** Snapshot the decision into an ack record. Undefined when the decision
 *  has no match to key change-detection off. */
export function ackRecordFor(decision: WeatherDispatchDecision, now: number): StormAckRecord | undefined {
  if (!decision.match) return undefined;
  return {
    alertId: decision.alertId,
    threatLevel: decision.match.threatLevel,
    wasInside: decision.match.isInside,
    distanceKm: decision.match.distanceKm,
    ackedAt: now,
    expiresAtMs: decision.payload?.expiresAtMs,
  };
}

export function snoozeRecordFor(decision: WeatherDispatchDecision, minutes: number, now: number): StormSnoozeRecord {
  return { alertId: decision.alertId, untilMs: now + minutes * 60_000 };
}

/** Replace any prior ack for the same alert with the new record. */
export function withAck(state: StormModeUiState, ack: StormAckRecord): StormModeUiState {
  return {
    acks: [...state.acks.filter((a) => a.alertId !== ack.alertId), ack],
    snoozes: state.snoozes,
  };
}

export function withSnooze(state: StormModeUiState, snooze: StormSnoozeRecord): StormModeUiState {
  return {
    acks: state.acks,
    snoozes: [...state.snoozes.filter((s) => s.alertId !== snooze.alertId), snooze],
  };
}

// ── Meaningful-change detection ──────────────────────────────────────────

/** Did the threat materially change since the user acknowledged it?
 *  Mirrors the repeat-suppression semantics in `weather-urgency.ts`:
 *  escalation, outside → inside, or the polygon edge ≥ 5 km closer. */
export function meaningfulChangeSinceAck(ack: StormAckRecord, decision: WeatherDispatchDecision): boolean {
  const match = decision.match;
  if (!match) return false;
  if (THREAT_LEVELS.indexOf(match.threatLevel) > THREAT_LEVELS.indexOf(ack.threatLevel)) return true;
  if (!ack.wasInside && match.isInside) return true;
  if (
    ack.distanceKm !== undefined &&
    match.distanceKm !== undefined &&
    ack.distanceKm - match.distanceKm >= MEANINGFUL_DISTANCE_DELTA_KM
  ) return true;
  return false;
}

// ── Visibility decision ─────────────────────────────────────────────────

export type StormModeHiddenReason =
  | 'no_decision'
  | 'suppressed'
  | 'no_payload'
  | 'inactive'
  | 'expired'
  | 'snoozed'
  | 'acknowledged';

export type StormModeVisibility =
  | { visible: true }
  | { visible: false; reason: StormModeHiddenReason };

/** The single show/hide decision for the strip. The plan's contract:
 *  persistent in-app status until the threat expires or is acknowledged;
 *  activation is driven by the Storm Mode payload (warnings and
 *  emergencies — the router only builds a payload at banner+). */
export function computeStormModeVisibility(
  decision: WeatherDispatchDecision | undefined,
  state: StormModeUiState,
  now: number,
): StormModeVisibility {
  if (!decision) return { visible: false, reason: 'no_decision' };
  if (decision.shouldSuppress || !decision.urgency) return { visible: false, reason: 'suppressed' };
  const payload = decision.payload;
  if (!payload) return { visible: false, reason: 'no_payload' };
  if (payload.activation === 'inactive') return { visible: false, reason: 'inactive' };
  if (payload.expiresAtMs <= now) return { visible: false, reason: 'expired' };
  const snooze = state.snoozes.find((s) => s.alertId === decision.alertId && s.untilMs > now);
  if (snooze) return { visible: false, reason: 'snoozed' };
  const ack = state.acks.find((a) => a.alertId === decision.alertId);
  if (ack && !meaningfulChangeSinceAck(ack, decision)) return { visible: false, reason: 'acknowledged' };
  return { visible: true };
}

/** When the strip should re-evaluate on a clock (independent of data
 *  refreshes): the alert's expiry when visible, or the snooze end when
 *  snoozed. Undefined when no timed transition is pending. */
export function nextVisibilityTransitionAt(
  decision: WeatherDispatchDecision | undefined,
  state: StormModeUiState,
  now: number,
): number | undefined {
  if (!decision?.payload) return undefined;
  const visibility = computeStormModeVisibility(decision, state, now);
  if (visibility.visible) return decision.payload.expiresAtMs;
  if (visibility.reason === 'snoozed') {
    const snooze = state.snoozes.find((s) => s.alertId === decision.alertId && s.untilMs > now);
    return snooze?.untilMs;
  }
  return undefined;
}

// ── Display strings ──────────────────────────────────────────────────────

export function capitalizeFirst(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

/** Tier chip text ("WARNING", "EMERGENCY"). */
export function stormTierLabel(decision: WeatherDispatchDecision): string {
  return (decision.urgency?.threatLevel ?? 'none').toUpperCase();
}

/** Hazard-first strip title — the plan requires "Show primary hazard
 *  first" and "Show closest saved place / current location". Inside
 *  matches read "at", approaching ones "near". */
export function stormStripTitle(decision: WeatherDispatchDecision): string {
  const hazard = capitalizeFirst(decision.payload?.mainThreatLabel ?? decision.urgency?.hazardKind ?? 'severe weather');
  const place = decision.matchedPlaceLabel ?? 'your area';
  const inside = decision.match?.isInside === true;
  return inside ? `${hazard} at ${place}` : `${hazard} near ${place}`;
}

export interface StormMetaPair {
  label: string;
  value: string;
}

/** The card's meta rows in display order: main threat first, then place,
 *  distance, arrival window, confidence, next update. Rows without data
 *  are omitted rather than rendered blank. */
export function stormMetaPairs(decision: WeatherDispatchDecision): StormMetaPair[] {
  const payload = decision.payload;
  const pairs: StormMetaPair[] = [];
  if (payload) pairs.push({ label: 'Main threat', value: capitalizeFirst(payload.mainThreatLabel) });
  if (decision.matchedPlaceLabel) pairs.push({ label: 'Place', value: decision.matchedPlaceLabel });
  const distance = decision.match?.distanceKm;
  if (decision.match && !decision.match.isInside && distance !== undefined && distance > 0) {
    pairs.push({ label: 'Distance', value: `${distance.toFixed(1)} km from warned area` });
  }
  if (payload?.arrivalWindow?.label) pairs.push({ label: 'Arrival', value: payload.arrivalWindow.label });
  pairs.push({ label: 'Confidence', value: capitalizeFirst(payload?.confidenceLabel ?? 'medium') });
  if (payload?.nextUpdateLabel) pairs.push({ label: 'Next update', value: payload.nextUpdateLabel });
  return pairs;
}
