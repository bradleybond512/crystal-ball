// src/services/survival/lens-board.ts
/**
 * Composition + apply helpers that wire the personal lens onto the board's
 * markers (Grand-Strategy Survival OS, E4). `styleIndexForBoard` is the one-call
 * path from live inputs to the `eventId → LensMarkerStyle` map the renderer looks
 * up; `applyLensToMarker` is the pure numeric transform each renderer uses to fold
 * a style into a marker's base alpha + size (Cesium billboard `color.alpha` +
 * `scale`, or DeckGL fill alpha + radius).
 *
 * Pure: no Cesium/DeckGL/DOM. The renderer owns the actual entity mutation.
 *
 * Renderer-apply note (deferred to a build-capable session): the Cesium glue
 * must NOT naively write `billboard.color` alpha, because `applyCursorOpacity`
 * (globe/cursor-opacity) already *sets* billboard alpha (1.0 in-window / 0.3
 * out) on every time-stamped entity — and board markers (earthquakes, conflict,
 * strikes) ARE time-stamped. Two writers with different models (cursor *sets*,
 * lens *multiplies*) would fight, and whichever runs last wins. Correct wiring
 * composes both over one cached true-base — `final = trueBase × cursorFactor ×
 * lensFactor` in a single apply pass — or routes lens through a non-colliding
 * channel (`billboard.scale`, which cursor-opacity never touches). That apply is
 * runtime-verified on the live globe, so it lands with the renderer session; this
 * module is the tested seam it builds on.
 */
import { applyPersonalLens, type LensOptions } from './personal-lens.ts';
import { buildLensStyleIndex, type LensMarkerStyle } from './lens-marker-style.ts';
import type { IncomingEvent, PersonalProfile } from '../personal/personal-impact.ts';
import type { SurvivalPosture } from './survival-types.ts';

/**
 * One call from live board inputs to the marker-style index: score the events
 * through the personal lens against the user's profile + current survival posture,
 * then index the styles by eventId (which equals the marker's `boardEntityId`).
 */
export function styleIndexForBoard(
  events: readonly IncomingEvent[],
  profile: PersonalProfile,
  posture: SurvivalPosture,
  options?: LensOptions,
): Map<string, LensMarkerStyle> {
  return buildLensStyleIndex(applyPersonalLens(events, profile, posture, options));
}

export interface MarkerBase {
  /** Marker's base fill/point alpha 0..1. */
  alpha: number;
  /** Marker's base size (Cesium pixelSize/scale, DeckGL radius). */
  scale: number;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Non-negative, finite size — NaN/Infinity collapse to 0 so a bad input never
 *  reaches a Cesium billboard `scale` / DeckGL `radius`. */
function safeSize(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, n);
}

/**
 * Fold a lens style into a marker's base look. Alpha is multiplied then clamped
 * to [0,1]; size is multiplied (never negative). Renderer-agnostic — the Cesium
 * glue reads `entity.billboard.color.alpha` + `.scale` and writes these back; the
 * DeckGL glue applies them to `getFillColor` alpha + `getRadius`.
 */
export function applyLensToMarker(base: MarkerBase, style: LensMarkerStyle): MarkerBase {
  return {
    alpha: clamp01(base.alpha * style.alpha),
    scale: safeSize(base.scale * style.scale),
  };
}
