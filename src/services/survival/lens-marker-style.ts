// src/services/survival/lens-marker-style.ts
/**
 * Lens-driven marker treatment for the World Stage board (Grand-Strategy Survival
 * OS, E4). Turns a `LensView` (tier + relevance from personal-lens.ts) into a
 * renderer-agnostic style descriptor that BOTH board renderers consume:
 *   - Cesium (God's Eye globe) — multiply a marker's base `Color` alpha by
 *     `alpha`, its `pixelSize`/`scale` by `scale`, draw an emphasis outline when
 *     `outline`, show its label when `showLabel`, sort by `zIndex`.
 *   - DeckGL (2D map) — same multipliers on `getFillColor` alpha / `getRadius` /
 *     line width / `getFilterValue` for draw order.
 *
 * The personal lens dims what doesn't matter to the user and lights up what does:
 * `core` items are opaque, larger, outlined, labeled and on top; `background`
 * items fade back, shrink and drop their labels. `relevance` fine-tunes size +
 * alpha CONTINUOUSLY within a tier so a 0.95 core reads slightly hotter than a
 * 0.72 core.
 *
 * Pure: no Cesium/DeckGL/DOM imports — just numbers + booleans the glue applies.
 */
import type { LensTier, LensView } from './personal-lens.ts';
import { lensTint } from './personal-lens.ts';

export interface LensMarkerStyle {
  /** Multiply the marker's base fill/point alpha by this (0..1). */
  alpha: number;
  /** Multiply the marker's base size (Cesium pixelSize / DeckGL radius) by this. */
  scale: number;
  /** Draw an emphasis outline/ring (core + elevated only). */
  outline: boolean;
  /** Whether the label is shown by default at this tier. */
  showLabel: boolean;
  /** Draw / sort order — higher renders on top. */
  zIndex: number;
  /** Convenience flag: this marker is de-emphasized (ambient/background). */
  dimmed: boolean;
}

/** Base size multiplier per tier (before the continuous relevance nudge). */
const SCALE_BY_TIER: Record<LensTier, number> = {
  core: 1.4,
  elevated: 1.15,
  ambient: 0.9,
  background: 0.7,
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Round to 3 decimals so styles are stable/comparable across renders. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Board marker treatment for a scored board item. Tier sets the base treatment
 * (via `lensTint`); relevance adds a small continuous nudge to size and alpha so
 * ordering within a tier is preserved visually.
 */
export function markerStyleForLens(view: LensView): LensMarkerStyle {
  const tint = lensTint(view.tier);
  const r = clamp01(view.relevance);

  // Continuous nudge: relevance 0 is exactly the tier base, relevance 1 boosts
  // size by +15% and alpha by +10% (clamped). Keeps within-tier ordering visible
  // without crossing tiers.
  const scale = round3(SCALE_BY_TIER[view.tier] * (1 + 0.15 * r));
  const alpha = round3(clamp01(tint.opacity * (1 + 0.1 * r)));

  return {
    alpha,
    scale,
    outline: view.tier === 'core' || view.tier === 'elevated',
    showLabel: tint.labeled,
    zIndex: tint.priority,
    dimmed: view.tier === 'ambient' || view.tier === 'background',
  };
}

/**
 * Build an eventId → marker-style lookup from scored lens views. The board glue
 * (Cesium / DeckGL) iterates its markers and, for any whose backing eventId is in
 * the index, applies the style; markers with no lens view keep their base style.
 * Pure — the renderer owns the actual entity mutation.
 */
export function buildLensStyleIndex(views: readonly LensView[]): Map<string, LensMarkerStyle> {
  const index = new Map<string, LensMarkerStyle>();
  for (const view of views) {
    if (view.eventId) index.set(view.eventId, markerStyleForLens(view));
  }
  return index;
}

/** Style for a tier with no per-item relevance (relevance treated as the tier's
 * midpoint) — handy for legends / bulk-styling a whole map mode. */
export function markerStyleForTier(tier: LensTier): LensMarkerStyle {
  const MIDPOINT: Record<LensTier, number> = {
    core: 0.85, elevated: 0.575, ambient: 0.325, background: 0.1,
  };
  return markerStyleForLens({ eventId: '', relevance: MIDPOINT[tier], tier, axis: 'physical_safety', drivers: [] });
}
