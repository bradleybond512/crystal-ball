/**
 * Calibrated edge confidence for the correlate stage.
 *
 * Replaces the correlate-engine's linear time-decay-only score with a
 * multi-factor kernel:
 *
 *   value = clamp( base × temporal × spatial × entity × reliability × regime )
 *
 * Every factor is bounded and the result carries a human-readable
 * explanation (plan invariant: every score explains itself). Pure:
 * no DOM, no fetch, no globals, no clock reads.
 *
 * See docs/CORRELATION_NEXTGEN_PLAN.md §D2 for the design rationale.
 */

import type { ObservationEvent } from '@/types/intelligence';

export interface EdgeConfidenceInput {
  /** |a.timestamp − b.timestamp| in ms. */
  gapMs: number;
  /** The rule's time window in ms. */
  timeWindowMs: number;
  /** Rule conviction override — when set, the temporal factor is forced
   *  to 1.0 (the author declared temporal decay misleading for this rule)
   *  and this becomes the base factor instead. Other factors still apply. */
  baseConfidence?: number;
  /** Great-circle distance between the two events, or undefined when
   *  either side has no location (neutral — absence of information is
   *  not evidence against; cyber/market events are unlocated by design). */
  distanceKm?: number;
  /** Count of entity ids the two events share. */
  sharedEntityCount: number;
  /** Per-rule learned reliability multiplier (correlation outcome ledger).
   *  Neutral 1.0 when absent. Clamped to [0.5, 1.5]. */
  reliability?: number;
  /** Regime-coupling factor (BOCPD). Boost-only by design: neutral 1.0
   *  when absent, clamped to [1, 1.15] — a broken/disabled provider can
   *  never silently penalize. */
  regimeFactor?: number;
}

export interface EdgeConfidenceFactors {
  base: number;
  temporal: number;
  spatial: number;
  entity: number;
  reliability: number;
  regime: number;
}

export interface EdgeConfidence {
  /** Final confidence, clamped to [0.2, 1], rounded to 4 dp. */
  value: number;
  factors: EdgeConfidenceFactors;
  explanation: string;
}

/** Spatial factor is neutral up to this separation. */
const SPATIAL_NEUTRAL_KM = 25;
/** e-folding distance for the spatial decay beyond the neutral radius. */
const SPATIAL_DECAY_KM = 400;
const SPATIAL_FLOOR = 0.5;
const ENTITY_BOOST_PER_SHARED = 0.15;
const ENTITY_BOOST_MAX_SHARED = 2;
const VALUE_FLOOR = 0.2;

export function computeEdgeConfidence(input: EdgeConfidenceInput): EdgeConfidence {
  // Injected providers (reliability, regime) and upstream data (distance,
  // baseConfidence) can be malformed; non-finite values fall back to
  // neutral so a broken provider can never produce NaN confidence.
  const factors: EdgeConfidenceFactors = {
    base: clamp(finiteOr(input.baseConfidence, 1), 0, 1),
    temporal: temporalFactor(input),
    spatial: spatialFactor(
      input.distanceKm !== undefined && Number.isFinite(input.distanceKm)
        ? input.distanceKm
        : undefined,
    ),
    entity: entityFactor(finiteOr(input.sharedEntityCount, 0)),
    reliability: clamp(finiteOr(input.reliability, 1), 0.5, 1.5),
    regime: clamp(finiteOr(input.regimeFactor, 1), 1, 1.15),
  };
  const product =
    factors.base * factors.temporal * factors.spatial *
    factors.entity * factors.reliability * factors.regime;
  const value = Number(clamp(product, VALUE_FLOOR, 1).toFixed(4));
  return { value, factors, explanation: explain(input, factors) };
}

/** Exponential half-life kernel: 1.0 at gap 0, 0.5 at half the window,
 *  ≈0.25 at the full window. Forced to 1.0 under a baseConfidence rule. */
function temporalFactor(input: EdgeConfidenceInput): number {
  if (input.baseConfidence !== undefined && Number.isFinite(input.baseConfidence)) return 1;
  if (!Number.isFinite(input.timeWindowMs) || input.timeWindowMs <= 0) return 1;
  if (!Number.isFinite(input.gapMs)) return 1;
  const halfLife = input.timeWindowMs / 2;
  return Math.exp(-Math.LN2 * (Math.max(0, input.gapMs) / halfLife));
}

function spatialFactor(distanceKm: number | undefined): number {
  if (distanceKm === undefined) return 1;
  const excess = Math.max(0, distanceKm - SPATIAL_NEUTRAL_KM);
  return Math.max(SPATIAL_FLOOR, Math.exp(-excess / SPATIAL_DECAY_KM));
}

function entityFactor(shared: number): number {
  const counted = Math.min(Math.max(0, shared), ENTITY_BOOST_MAX_SHARED);
  return 1 + ENTITY_BOOST_PER_SHARED * counted;
}

/** Count of entity ids present on both events. */
export function sharedEntityCount(
  a: readonly string[],
  b: readonly string[],
): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  let n = 0;
  for (const id of new Set(b)) if (setA.has(id)) n += 1;
  return n;
}

/** Great-circle distance between two observations, or undefined when
 *  either side carries no location. */
export function pairDistanceKm(
  a: ObservationEvent,
  b: ObservationEvent,
): number | undefined {
  if (!a.location || !b.location) return undefined;
  return haversineKm(a.location.lat, a.location.lon, b.location.lat, b.location.lon);
}

function explain(input: EdgeConfidenceInput, f: EdgeConfidenceFactors): string {
  const parts: string[] = [];
  if (input.baseConfidence !== undefined) {
    parts.push(`base ${f.base.toFixed(2)} (rule conviction, temporal decay off)`);
  } else if (f.temporal < 0.995) {
    parts.push(
      `temporal ${f.temporal.toFixed(2)} (gap ${hours(input.gapMs)} of ${hours(input.timeWindowMs)} window)`,
    );
  }
  if (input.distanceKm !== undefined && f.spatial < 0.995) {
    parts.push(`spatial ${f.spatial.toFixed(2)} (${Math.round(input.distanceKm)}km apart)`);
  }
  if (f.entity > 1) {
    parts.push(`entity ×${f.entity.toFixed(2)} (${input.sharedEntityCount} shared)`);
  }
  if (Math.abs(f.reliability - 1) > 0.005) {
    parts.push(`reliability ×${f.reliability.toFixed(2)} (learned from outcomes)`);
  }
  if (Math.abs(f.regime - 1) > 0.005) {
    parts.push(`regime ×${f.regime.toFixed(2)}`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'no decay factors (tight pair)';
}

function hours(ms: number): string {
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function finiteOr(v: number | undefined, fallback: number): number {
  return v !== undefined && Number.isFinite(v) ? v : fallback;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
