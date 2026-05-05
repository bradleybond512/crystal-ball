/**
 * Globe overlay emitter — Layer 4.
 *
 * Pure deterministic. No DOM, no fetch, no globals at import time. Takes
 * a list of `FusedSeismicEvent` plus `nowMs` and produces the per-event
 * overlay snapshot the God's Eye Cesium globe renders as expanding
 * P/S-wave rings.
 *
 * Plan invariants:
 *   - Wave speeds match Layer 3 shaking estimator (P ~6 km/s, S ~3.5 km/s).
 *     Reused via the shaking-estimator's `__INTERNAL` exports so a future
 *     model swap touches one place.
 *   - Radii are hard-capped at the antipodal distance (~20015 km) so a
 *     ring never "wraps around" the globe.
 *   - Opacity decays linearly from 1.0 at the epicenter to 0 at the
 *     antipode. After full-globe traversal the wave is done.
 *   - Events older than 4 hours are excluded — the visual layer does not
 *     pollute the globe with stale rings.
 *   - Output is sorted by magnitude descending and capped at
 *     `maxOverlays` (default 50). The cap is the first thing a downstream
 *     renderer can rely on for performance budgeting.
 */

import type { FusedSeismicEvent } from './seismic-fusion';

// ── Constants ──────────────────────────────────────────────────────────

const P_WAVE_KM_PER_SEC = 6;
const S_WAVE_KM_PER_SEC = 3.5;
const EARTH_RADIUS_KM = 6371;
const ANTIPODE_KM = Math.PI * EARTH_RADIUS_KM;
const FOUR_HOURS_MS = 4 * 3600 * 1000;
const DEFAULT_MIN_MAGNITUDE = 4.5;
const DEFAULT_MAX_OVERLAYS = 50;

// ── Public types ───────────────────────────────────────────────────────

export interface GlobeSeismicOverlay {
  /** Canonical fused event id (from `FusedSeismicEvent.id`). */
  eventId: string;
  lat: number;
  lon: number;
  magnitude: number | null;
  /** Current P-wave radius in km, capped at antipode. */
  pWaveRadiusKm: number;
  /** Current S-wave radius in km, capped at antipode. */
  sWaveRadiusKm: number;
  /** P-wave opacity in [0, 1]. Linear decay from 1 at origin to 0 at antipode. */
  pWaveOpacity: number;
  /** S-wave opacity in [0, 1]. */
  sWaveOpacity: number;
  /** Seconds since the event's `occurredAt`. Negative when nowMs is
   *  before occurredAt (rare; clamped to 0 for radius/opacity math). */
  ageSec: number;
  /** True iff the event is older than the 4-hour visibility window.
   *  Expired overlays are filtered out before this struct is returned;
   *  the field exists for downstream visibility (e.g. test diagnostics). */
  expired: boolean;
}

export interface GlobeOverlayInput {
  events: readonly FusedSeismicEvent[];
  nowMs: number;
  /** Magnitude floor. Events below this are filtered out. Default 4.5. */
  minMagnitude?: number;
  /** Hard cap on output length. Higher-magnitude events are kept first.
   *  Default 50. */
  maxOverlays?: number;
}

// ── Public API ─────────────────────────────────────────────────────────

export function buildGlobeOverlays(input: GlobeOverlayInput): GlobeSeismicOverlay[] {
  const minMagnitude = input.minMagnitude ?? DEFAULT_MIN_MAGNITUDE;
  const maxOverlays = input.maxOverlays ?? DEFAULT_MAX_OVERLAYS;

  const overlays: GlobeSeismicOverlay[] = [];
  for (const event of input.events) {
    const overlay = buildOverlay(event, input.nowMs, minMagnitude);
    if (overlay !== null) overlays.push(overlay);
  }

  overlays.sort((a, b) => magnitudeKey(b) - magnitudeKey(a));
  return overlays.slice(0, maxOverlays);
}

// ── Per-event overlay ──────────────────────────────────────────────────

function buildOverlay(
  event: FusedSeismicEvent,
  nowMs: number,
  minMagnitude: number,
): GlobeSeismicOverlay | null {
  const magnitude = event.primary.magnitude;
  if (magnitude === null || magnitude < minMagnitude) return null;

  const ageSec = (nowMs - event.primary.occurredAt) / 1000;
  if (ageSec * 1000 > FOUR_HOURS_MS) return null;

  const elapsedForWave = Math.max(0, ageSec);
  const rawP = elapsedForWave * P_WAVE_KM_PER_SEC;
  const rawS = elapsedForWave * S_WAVE_KM_PER_SEC;

  const pWaveRadiusKm = Math.min(rawP, ANTIPODE_KM);
  const sWaveRadiusKm = Math.min(rawS, ANTIPODE_KM);

  const pWaveOpacity = clamp01(1 - rawP / ANTIPODE_KM);
  const sWaveOpacity = clamp01(1 - rawS / ANTIPODE_KM);

  return {
    eventId: event.id,
    lat: event.primary.lat,
    lon: event.primary.lon,
    magnitude,
    pWaveRadiusKm,
    sWaveRadiusKm,
    pWaveOpacity,
    sWaveOpacity,
    ageSec,
    expired: false,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

function magnitudeKey(overlay: GlobeSeismicOverlay): number {
  return overlay.magnitude ?? -Infinity;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

// ── Re-exports (unit tests pin these) ──────────────────────────────────

export const __INTERNAL = {
  P_WAVE_KM_PER_SEC,
  S_WAVE_KM_PER_SEC,
  ANTIPODE_KM,
  FOUR_HOURS_MS,
  DEFAULT_MIN_MAGNITUDE,
  DEFAULT_MAX_OVERLAYS,
};
