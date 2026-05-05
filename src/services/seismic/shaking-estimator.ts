/**
 * Saved-place shaking estimator — per
 * docs/CLAUDE_SEISMIC_INTELLIGENCE_SYSTEM_PLAN_2026-05-05.md Layer 3.
 *
 * Pure deterministic. No DOM, no fetch, no globals at import time.
 * Takes a fused seismic event + saved places and produces a per-place
 * estimate of timing (`may_arrive_soon` / `likely_arrived` / `aftershock_watch`
 * / `too_far` / `unknown`), intensity, useful-warning-window, and a
 * recommended low-regret action.
 *
 * Plan invariants:
 *   - Approximate wave speeds (P ~6 km/s, S ~3.5 km/s) used ONLY for
 *     classification. We never claim official Earthquake Early Warning.
 *   - When feed latency exceeds the estimated P-wave arrival, the
 *     estimator flips to `likely_arrived` — it must not lie about
 *     warning time we no longer have.
 *   - Deterministic attenuation model: magnitude − log10(distanceKm)
 *     factor + shallow-quake boost + uncertainty penalty. Intentionally
 *     conservative; later PRs can replace with USGS ShakeMap products.
 *   - User-facing guidance is low-regret (Drop/Cover/Hold On only when
 *     strong+ shaking is plausible and may still arrive).
 */

import type { FusedSeismicEvent } from './seismic-fusion';

// ── Public types ────────────────────────────────────────────────────────

export type ShakingTiming =
  | 'may_arrive_soon'
  | 'likely_arrived'
  | 'aftershock_watch'
  | 'too_far'
  | 'unknown';

export type ShakingIntensity =
  | 'none'
  | 'weak'
  | 'light'
  | 'moderate'
  | 'strong'
  | 'severe'
  | 'violent';

export type RecommendedAction =
  | 'none'
  | 'drop_cover_hold_on'
  | 'prepare_aftershock'
  | 'inspect_damage'
  | 'monitor';

export interface SavedPlaceLite {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface SavedPlaceShakingEstimate {
  placeId: string;
  placeName: string;
  distanceKm: number;
  estimatedIntensity: ShakingIntensity;
  timing: ShakingTiming;
  /** Seconds elapsed between quake origin and `nowMs`. Negative when
   *  the clock is ahead of the event (rare, but possible with feed
   *  hydrate from a future fixture). */
  secondsSinceOrigin: number;
  /** Approx P-wave arrival time at the place, in seconds after origin. */
  estimatedPWaveArrivalSec: number;
  /** Approx S-wave arrival time at the place, in seconds after origin. */
  estimatedSWaveArrivalSec: number;
  /** Seconds remaining until S-wave arrival at `nowMs`. Zero when the
   *  S-wave likely already arrived. */
  usefulWarningWindowSec: number;
  /** Per-place confidence in [0..1]. Combines fused confidence with a
   *  distance/depth-based uncertainty penalty. */
  confidence: number;
  recommendedAction: RecommendedAction;
}

export interface ShakingEstimateInput {
  event: FusedSeismicEvent;
  places: readonly SavedPlaceLite[];
  /** ms epoch — used to compute `secondsSinceOrigin` and useful-warning
   *  window. Tests inject a frozen clock; production passes
   *  `Date.now()`. */
  nowMs: number;
  /** Estimated feed latency in ms. When the latency exceeds the P-wave
   *  arrival window, timing flips to `likely_arrived` — we will not
   *  have warned the user before the wave reached them. Defaults to 0
   *  if omitted (callers should pass real values from data-freshness). */
  feedLatencyMs?: number;
  /** Optional: when the parent quake is itself an aftershock context,
   *  the caller may pass the parent's magnitude here so the estimator
   *  knows to label the event `aftershock_watch` even for distant low-
   *  intensity reach. */
  parentMagnitude?: number;
}

// ── Constants ───────────────────────────────────────────────────────────

const P_WAVE_KM_PER_SEC = 6;
const S_WAVE_KM_PER_SEC = 3.5;
const EARTH_RADIUS_KM = 6371;

/** Beyond this distance, even M7+ quakes typically don't produce
 *  perceptible shaking at the surface. */
const TOO_FAR_KM = 1500;

/** Aftershock watch reach scales with mainshock magnitude. M5 → 50 km;
 *  M7 → 200 km; M8 → 500 km — broadly aligned with USGS guidance. */
function aftershockReachKm(mainshockMagnitude: number): number {
  if (mainshockMagnitude < 5) return 0;
  if (mainshockMagnitude < 6) return 50;
  if (mainshockMagnitude < 7) return 100;
  if (mainshockMagnitude < 8) return 200;
  return 500;
}

// ── Public API ──────────────────────────────────────────────────────────

export function estimateSavedPlaceShaking(input: ShakingEstimateInput): SavedPlaceShakingEstimate[] {
  const event = input.event;
  return input.places.map((place) => estimateForPlace(event, place, input));
}

function estimateForPlace(
  event: FusedSeismicEvent,
  place: SavedPlaceLite,
  input: ShakingEstimateInput,
): SavedPlaceShakingEstimate {
  const distanceKm = haversineKm(event.primary.lat, event.primary.lon, place.lat, place.lon);
  const estimatedPWaveArrivalSec = distanceKm / P_WAVE_KM_PER_SEC;
  const estimatedSWaveArrivalSec = distanceKm / S_WAVE_KM_PER_SEC;
  const secondsSinceOrigin = (input.nowMs - event.primary.occurredAt) / 1000;
  const feedLatencySec = (input.feedLatencyMs ?? 0) / 1000;
  const usefulWarningWindowSec = Math.max(0, estimatedSWaveArrivalSec - secondsSinceOrigin - feedLatencySec);

  const intensity = classifyIntensity({
    magnitude: event.primary.magnitude,
    depthKm: event.primary.depthKm,
    distanceKm,
  });

  const timing = classifyTiming({
    intensity,
    distanceKm,
    estimatedPWaveArrivalSec,
    estimatedSWaveArrivalSec,
    secondsSinceOrigin,
    feedLatencySec,
    eventMagnitude: event.primary.magnitude,
    parentMagnitude: input.parentMagnitude,
  });

  const recommendedAction = chooseAction({ intensity, timing });

  const confidence = scorePlaceConfidence({
    fusedConfidence: event.confidence,
    distanceKm,
    depthKm: event.primary.depthKm,
  });

  return {
    placeId: place.id,
    placeName: place.name,
    distanceKm,
    estimatedIntensity: intensity,
    timing,
    secondsSinceOrigin,
    estimatedPWaveArrivalSec,
    estimatedSWaveArrivalSec,
    usefulWarningWindowSec,
    confidence,
    recommendedAction,
  };
}

// ── Intensity classification ────────────────────────────────────────────

/** Deterministic attenuation. Returns one of seven labels.
 *  Score ≈ magnitude − log10(distance+1) + shallow boost − depth penalty.
 *  The mapping is intentionally conservative; tests pin the boundary
 *  cases. */
function classifyIntensity(input: {
  magnitude: number | null;
  depthKm: number | null;
  distanceKm: number;
}): ShakingIntensity {
  if (input.magnitude === null) return 'none';
  if (input.distanceKm > TOO_FAR_KM) return 'none';
  const depth = input.depthKm ?? 25;
  const shallowBoost = depth < 30 ? 0.4 : 0;
  const depthPenalty = depth > 70 ? 0.5 : 0;
  const distanceFactor = Math.log10(Math.max(1, input.distanceKm) + 1);
  const score = input.magnitude - distanceFactor + shallowBoost - depthPenalty;
  if (score < 1.5) return 'none';
  if (score < 2.5) return 'weak';
  if (score < 3.5) return 'light';
  if (score < 4.5) return 'moderate';
  if (score < 5.5) return 'strong';
  if (score < 6.5) return 'severe';
  return 'violent';
}

// ── Timing classification ──────────────────────────────────────────────

function classifyTiming(input: {
  intensity: ShakingIntensity;
  distanceKm: number;
  estimatedPWaveArrivalSec: number;
  estimatedSWaveArrivalSec: number;
  secondsSinceOrigin: number;
  feedLatencySec: number;
  eventMagnitude: number | null;
  parentMagnitude?: number;
}): ShakingTiming {
  if (input.eventMagnitude === null) return 'unknown';

  if (input.distanceKm > TOO_FAR_KM) return 'too_far';

  // Aftershock context: when the input event itself is part of an
  // ongoing sequence (parent magnitude provided) and the place is
  // inside the aftershock reach, label as aftershock_watch — even for
  // weak shaking from the current event.
  if (input.parentMagnitude !== undefined) {
    const reach = aftershockReachKm(input.parentMagnitude);
    if (reach > 0 && input.distanceKm <= reach) return 'aftershock_watch';
  }

  // Plan rule: if feed latency exceeds the P-wave arrival window, we
  // do not have warning time we can honestly promise.
  if (input.feedLatencySec >= input.estimatedPWaveArrivalSec) return 'likely_arrived';

  // S-wave already arrived (on the place): likely_arrived. We use the
  // S-wave (not P-wave) as the threshold because P-wave arrival
  // without S-wave still gives useful warning time.
  if (input.secondsSinceOrigin + input.feedLatencySec >= input.estimatedSWaveArrivalSec) {
    return 'likely_arrived';
  }

  // Intensity 'none' at this distance — sub-perceptible: too_far even
  // if numerically inside the cap.
  if (input.intensity === 'none') return 'too_far';

  return 'may_arrive_soon';
}

// ── Action choice ──────────────────────────────────────────────────────

const STRONG_OR_WORSE = new Set<ShakingIntensity>(['strong', 'severe', 'violent']);

function chooseAction(input: { intensity: ShakingIntensity; timing: ShakingTiming }): RecommendedAction {
  if (input.timing === 'too_far' || input.intensity === 'none') return 'none';

  if (input.timing === 'aftershock_watch') return 'prepare_aftershock';

  if (STRONG_OR_WORSE.has(input.intensity)) {
    if (input.timing === 'may_arrive_soon') return 'drop_cover_hold_on';
    if (input.timing === 'likely_arrived') return 'inspect_damage';
  }

  if (input.intensity === 'moderate' && input.timing === 'may_arrive_soon') return 'drop_cover_hold_on';
  if (input.intensity === 'moderate' && input.timing === 'likely_arrived') return 'inspect_damage';

  return 'monitor';
}

// ── Per-place confidence ───────────────────────────────────────────────

function scorePlaceConfidence(input: {
  fusedConfidence: number;
  distanceKm: number;
  depthKm: number | null;
}): number {
  // Fused confidence is the ceiling. Distance and unknown depth add
  // small uncertainty penalties because the attenuation model gets
  // noisier at large range and with no depth.
  let score = input.fusedConfidence;
  if (input.distanceKm > 500) score -= 0.1;
  if (input.distanceKm > 1000) score -= 0.1;
  if (input.depthKm === null) score -= 0.05;
  if (score < 0) return 0;
  if (score > 1) return 1;
  return score;
}

// ── Math helper ────────────────────────────────────────────────────────

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

// ── Re-exports (unit tests pin them) ───────────────────────────────────

export const __INTERNAL = {
  classifyIntensity,
  classifyTiming,
  chooseAction,
  aftershockReachKm,
  P_WAVE_KM_PER_SEC,
  S_WAVE_KM_PER_SEC,
  TOO_FAR_KM,
};
