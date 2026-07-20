// src/services/survival/map-modes-apply.ts
/**
 * Apply survival map-modes onto a live `MapLayers` toggle state (E4 glue).
 *
 * The mode UI holds a set of active `SurvivalAxis` modes. This pure helper folds
 * `resolveLayerVisibility` onto the current layer state so the DeckGL glue can
 * `setLayers(applyModeVisibility(current, active))`:
 *   - no active modes → the base state passes through UNCHANGED (modes off = the
 *     user's normal map);
 *   - ≥1 active mode → mode-managed layers are forced on/off per the active axes'
 *     layer sets; unmanaged layers (base-map furniture, variant-only layers) are
 *     left exactly as the user had them.
 */
import type { MapLayers } from '../../types/index.ts';
import type { SurvivalAxis } from './survival-types.ts';
import { resolveLayerVisibility } from './map-modes.ts';

export function applyModeVisibility(base: MapLayers, active: readonly SurvivalAxis[]): MapLayers {
  if (active.length === 0) return base;
  const visibility = resolveLayerVisibility(active);
  const next: MapLayers = { ...base };
  for (const [layer, on] of Object.entries(visibility)) {
    next[layer as keyof MapLayers] = Boolean(on);
  }
  return next;
}

/** The layer keys `applyModeVisibility` would change relative to `base` for the
 *  given active modes — handy for a diff-only `setLayers` and for tests. */
export function modeVisibilityDelta(
  base: MapLayers,
  active: readonly SurvivalAxis[],
): Partial<Record<keyof MapLayers, boolean>> {
  const next = applyModeVisibility(base, active);
  const delta: Partial<Record<keyof MapLayers, boolean>> = {};
  for (const key of Object.keys(next) as (keyof MapLayers)[]) {
    if (next[key] !== base[key]) delta[key] = next[key];
  }
  return delta;
}
