// src/services/survival/lens-marker-apply.ts
/**
 * Apply a `LensMarkerStyle` onto a marker's base visual (E4 glue).
 *
 * Renderer-agnostic: both board renderers reduce their marker to a base alpha
 * (0..1) + base size (px), call this, and map the result back to their own
 * properties — Cesium (billboard/point color alpha, pixelSize, label.show,
 * eyeOffset by zIndex) and DeckGL (getFillColor alpha, getRadius, getLineWidth
 * for the outline, getFilterValue for draw order). Markers with no lens view
 * (not on the board, or the lens is off) skip this and keep their base style.
 */
import type { LensMarkerStyle } from './lens-marker-style.ts';

export interface BaseMarkerVisual {
  /** Base fill/point opacity, 0..1. */
  alpha: number;
  /** Base size in px (Cesium pixelSize / DeckGL radius). */
  sizePx: number;
}

export interface AppliedMarkerVisual {
  alpha: number;
  sizePx: number;
  outline: boolean;
  showLabel: boolean;
  zIndex: number;
  dimmed: boolean;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Combine a base marker visual with its lens style. `alpha`/`scale` multiply the
 *  base; alpha is clamped to [0,1] and size floored at 1px so a dimmed marker
 *  stays faintly visible rather than vanishing. */
export function applyLensStyle(base: BaseMarkerVisual, style: LensMarkerStyle): AppliedMarkerVisual {
  return {
    alpha: clamp01(base.alpha * style.alpha),
    sizePx: Math.max(1, base.sizePx * style.scale),
    outline: style.outline,
    showLabel: style.showLabel,
    zIndex: style.zIndex,
    dimmed: style.dimmed,
  };
}
