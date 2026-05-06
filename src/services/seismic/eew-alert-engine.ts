/**
 * EEW alert engine — Layer 7 of the seismic intelligence stack.
 *
 * Pure deterministic. No DOM, no fetch, no globals at import time.
 * Takes fused seismic events + saved places + a prior ledger and
 * produces:
 *   - the alerts that should fire right now
 *   - the updated ledger to persist for the next tick
 *
 * Plan invariants:
 *   - Every alert carries an explanation (`reason` string).
 *   - Same eventId + same tier within 1h → suppressed (dedup).
 *   - Same eventId + higher tier than highestTier → emitted with
 *     `upgradedFrom = oldHighest`.
 *   - Same eventId + lower tier → suppressed (never downgrade).
 *   - Ledger entries expire after 24h so a re-issued event after a long
 *     quiet period can still fire.
 *   - Tsunami today is degraded: `tsunamiFlag` only fires the
 *     TIER_2_WATCH branch. NOAA tsunami feeds (advisory / warning)
 *     would be a separate PR; the gap is called out explicitly in the
 *     alert reason rather than averaged into the watch tier.
 */

import type { FusedSeismicEvent } from './seismic-fusion';
import type { SavedPlaceLite } from './shaking-estimator';

// ── Public types ───────────────────────────────────────────────────────

export type EewTier =
  | 'TIER_1_INFO'
  | 'TIER_2_WATCH'
  | 'TIER_3_WARNING'
  | 'TIER_4_SEVERE'
  | 'TIER_5_EXTREME';

export interface EewAlert {
  eventId: string;
  tier: EewTier;
  /** Human-readable trigger reason (which clause matched + magnitude). */
  reason: string;
  triggeredAt: number;
  /** Set when this alert is an upgrade from a prior tier for the same
   *  eventId. */
  upgradedFrom?: EewTier;
  /** TIER_5 alerts wire iMessage in Layer 8; this field is set there
   *  and round-tripped through the ledger. */
  imessageStatus?: 'pending' | 'sent' | 'failed' | 'disabled';
  imessageError?: string;
}

export interface EewLedgerEvent {
  highestTier: EewTier;
  tierFiredAt: Partial<Record<EewTier, number>>;
}

export interface EewAlertLedger {
  events: Record<string, EewLedgerEvent>;
}

export interface EewEvaluationInput {
  events: readonly FusedSeismicEvent[];
  savedPlaces: readonly SavedPlaceLite[];
  ledger: EewAlertLedger;
  nowMs: number;
}

export interface EewEvaluationOutput {
  alerts: EewAlert[];
  updatedLedger: EewAlertLedger;
}

export function emptyLedger(): EewAlertLedger {
  return { events: {} };
}

// ── Constants ──────────────────────────────────────────────────────────

const DEDUP_WINDOW_MS = 60 * 60 * 1000; // 1h
const LEDGER_TTL_MS = 24 * 60 * 60 * 1000; // 24h

const TIER_ORDER: readonly EewTier[] = [
  'TIER_1_INFO',
  'TIER_2_WATCH',
  'TIER_3_WARNING',
  'TIER_4_SEVERE',
  'TIER_5_EXTREME',
];

function tierIndex(tier: EewTier): number {
  return TIER_ORDER.indexOf(tier);
}

function isHigherTier(candidate: EewTier, baseline: EewTier): boolean {
  return tierIndex(candidate) > tierIndex(baseline);
}

// ── Public API ─────────────────────────────────────────────────────────

export function evaluateEewAlerts(input: EewEvaluationInput): EewEvaluationOutput {
  const ledger = pruneStaleLedger(input.ledger, input.nowMs);
  const alerts: EewAlert[] = [];

  for (const event of input.events) {
    const triggered = evaluateEvent(event, input.savedPlaces);
    if (!triggered) continue;

    const prior = ledger.events[event.id];
    const decision = decideEmission({
      tier: triggered.tier,
      prior,
      nowMs: input.nowMs,
    });
    if (!decision.emit) continue;

    alerts.push({
      eventId: event.id,
      tier: triggered.tier,
      reason: triggered.reason,
      triggeredAt: input.nowMs,
      upgradedFrom: decision.upgradedFrom,
    });

    ledger.events[event.id] = {
      highestTier: decision.newHighest,
      tierFiredAt: {
        ...prior?.tierFiredAt,
        [triggered.tier]: input.nowMs,
      },
    };
  }

  return { alerts, updatedLedger: ledger };
}

// ── Per-event tier evaluation ──────────────────────────────────────────

interface TriggeredAlert {
  tier: EewTier;
  reason: string;
}

function evaluateEvent(
  event: FusedSeismicEvent,
  savedPlaces: readonly SavedPlaceLite[],
): TriggeredAlert | null {
  const magnitude = event.primary.magnitude;
  if (magnitude === null) return null;

  let best: TriggeredAlert | null = null;

  // ── Anywhere clauses ──────────────────────────────────────────────
  best = pickHigher(best, anywhereTier(magnitude));

  // ── Saved-place clauses ───────────────────────────────────────────
  for (const place of savedPlaces) {
    const distanceKm = haversineKm(
      event.primary.lat,
      event.primary.lon,
      place.lat,
      place.lon,
    );
    best = pickHigher(best, savedPlaceTier(magnitude, distanceKm, place.name));
  }

  // ── Tsunami clause (degraded — only watch fires today) ────────────
  if (event.primary.tsunamiFlag === true) {
    best = pickHigher(best, {
      tier: 'TIER_2_WATCH',
      reason: 'tsunami flag set on event (advisory/warning ladder pending separate NOAA tsunami feed)',
    });
  }

  if (!best) return null;
  // Final reason includes the magnitude so the EEWStatusBar (L9) can
  // surface it without re-deriving.
  return {
    tier: best.tier,
    reason: `M${magnitude.toFixed(1)} — ${best.reason}`,
  };
}

function anywhereTier(magnitude: number): TriggeredAlert | null {
  if (magnitude >= 8) return { tier: 'TIER_5_EXTREME', reason: 'M≥8.0 anywhere' };
  if (magnitude >= 7) return { tier: 'TIER_4_SEVERE', reason: 'M≥7.0 anywhere' };
  if (magnitude >= 6.5) return { tier: 'TIER_3_WARNING', reason: 'M≥6.5 anywhere' };
  if (magnitude >= 5.5) return { tier: 'TIER_2_WATCH', reason: 'M≥5.5 anywhere' };
  if (magnitude >= 4) return { tier: 'TIER_1_INFO', reason: 'M≥4.0 anywhere' };
  return null;
}

function savedPlaceTier(
  magnitude: number,
  distanceKm: number,
  placeName: string,
): TriggeredAlert | null {
  // Highest match wins; structured roughly highest-tier-first so the
  // first match we find is the answer.
  if (magnitude >= 7 && distanceKm <= 500) {
    return { tier: 'TIER_5_EXTREME', reason: `M≥7.0 within 500km of ${placeName}` };
  }
  if (magnitude >= 6 && distanceKm <= 300) {
    return { tier: 'TIER_4_SEVERE', reason: `M≥6.0 within 300km of ${placeName}` };
  }
  if (magnitude >= 5 && distanceKm <= 200) {
    return { tier: 'TIER_3_WARNING', reason: `M≥5.0 within 200km of ${placeName}` };
  }
  if (magnitude >= 4 && distanceKm <= 300) {
    return { tier: 'TIER_2_WATCH', reason: `M≥4.0 within 300km of ${placeName}` };
  }
  if (magnitude >= 2.5 && distanceKm <= 200) {
    return { tier: 'TIER_1_INFO', reason: `M≥2.5 within 200km of ${placeName}` };
  }
  return null;
}

function pickHigher(
  current: TriggeredAlert | null,
  candidate: TriggeredAlert | null,
): TriggeredAlert | null {
  if (!candidate) return current;
  if (!current) return candidate;
  return isHigherTier(candidate.tier, current.tier) ? candidate : current;
}

// ── Dedup + upgrade decision ───────────────────────────────────────────

interface EmissionDecision {
  emit: boolean;
  upgradedFrom?: EewTier;
  newHighest: EewTier;
}

function decideEmission(input: {
  tier: EewTier;
  prior: EewLedgerEvent | undefined;
  nowMs: number;
}): EmissionDecision {
  const { tier, prior, nowMs } = input;

  // No prior → always emit.
  if (!prior) {
    return { emit: true, newHighest: tier };
  }

  // Lower than highest seen → never downgrade.
  if (tierIndex(tier) < tierIndex(prior.highestTier)) {
    return { emit: false, newHighest: prior.highestTier };
  }

  // Higher than highest seen → emit as upgrade.
  if (tierIndex(tier) > tierIndex(prior.highestTier)) {
    return { emit: true, upgradedFrom: prior.highestTier, newHighest: tier };
  }

  // Equal tier → check dedup window.
  const lastFired = prior.tierFiredAt[tier];
  if (lastFired !== undefined && nowMs - lastFired < DEDUP_WINDOW_MS) {
    return { emit: false, newHighest: prior.highestTier };
  }
  return { emit: true, newHighest: prior.highestTier };
}

// ── Ledger TTL ─────────────────────────────────────────────────────────

function pruneStaleLedger(prior: EewAlertLedger, nowMs: number): EewAlertLedger {
  const next: EewAlertLedger = { events: {} };
  for (const [eventId, entry] of Object.entries(prior.events)) {
    const lastFiredEntries = Object.values(entry.tierFiredAt) as number[];
    const lastFired = lastFiredEntries.length > 0
      ? Math.max(...lastFiredEntries)
      : 0;
    if (nowMs - lastFired <= LEDGER_TTL_MS) {
      next.events[eventId] = entry;
    }
  }
  return next;
}

// ── Math ───────────────────────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dPhi / 2) ** 2
    + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

// ── Test hooks ─────────────────────────────────────────────────────────

export const __INTERNAL = {
  DEDUP_WINDOW_MS,
  LEDGER_TTL_MS,
  TIER_ORDER,
  haversineKm,
  anywhereTier,
  savedPlaceTier,
};
