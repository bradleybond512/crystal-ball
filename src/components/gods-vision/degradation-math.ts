/**
 * Pure-math half of GlobeDegradation. No Cesium imports — testable in Node.
 *
 * Exponential decay confidence model:
 *   raw = exp(-timeFromNow / τ)
 *   confidence = max(CONFIDENCE_FLOOR, min(1, raw))
 *
 * Visual transitions are threshold-driven on the bounded confidence:
 *   < DASH_THRESHOLD     → dashed polylines, faded labels
 *   < BLUR_THRESHOLD     → reduced billboard scale, reduced point size
 *   < JITTER_THRESHOLD   → deterministic per-id pixel jitter
 *   < LABEL_THRESHOLD    → label hidden
 *
 * The confidence floor (5%) prevents entities at extreme forecast horizons
 * from disappearing entirely — they degrade to ghosts but stay pickable.
 */

const DAY_MS = 86_400_000;

export const CONFIDENCE_FLOOR = 0.05;
export const DASH_THRESHOLD = 0.5;
export const BLUR_THRESHOLD = 0.3;
export const JITTER_THRESHOLD = 0.2;
export const LABEL_THRESHOLD = 0.3;
export const JITTER_MAX_PX = 6;

export const LAYER_DECAY_TAU_MS: Record<string, number> = {
  conflicts: 2.33 * DAY_MS,
  airstrikes: 2.33 * DAY_MS,
  earthquakes: 10 * DAY_MS,
  gdacs: 0.67 * DAY_MS,
  cyclones: 1.67 * DAY_MS,
  fires: 0.67 * DAY_MS,
};

export interface DegradationState {
  confidence: number;
  opacity: number;
  isDashed: boolean;
  blur: number;
  jitter: number;
}

export function computeDegradationState(timeFromNowMs: number, tauMs: number): DegradationState {
  if (tauMs <= 0 || timeFromNowMs <= 0) {
    return { confidence: 1, opacity: 1, isDashed: false, blur: 0, jitter: 0 };
  }
  const raw = Math.exp(-timeFromNowMs / tauMs);
  const confidence = Math.max(CONFIDENCE_FLOOR, Math.min(1, raw));
  return {
    confidence,
    opacity: confidence,
    isDashed: confidence < DASH_THRESHOLD,
    blur: confidence < BLUR_THRESHOLD ? (1 - confidence) * 2 : 0,
    jitter: confidence < JITTER_THRESHOLD ? (1 - confidence) * 4 : 0,
  };
}

/** Stable per-entity jitter offset from a deterministic hash of the id. */
export function computeJitterOffset(id: string, intensity: number): [number, number] {
  if (intensity <= 0) return [0, 0];
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = Math.trunc((hash << 5) - hash + (id.codePointAt(i) ?? 0));
  }
  const angle = ((hash & 0xFF_FF) / 0xFF_FF) * Math.PI * 2;
  const magnitude = Math.min(1, intensity) * JITTER_MAX_PX;
  return [Math.cos(angle) * magnitude, Math.sin(angle) * magnitude];
}
