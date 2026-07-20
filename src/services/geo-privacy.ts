/**
 * Geo-privacy — coarsen precise coordinates before they leave the device in a
 * cloud LLM prompt. The app tracks household-level home/family GPS (4 decimals
 * ≈ 11 m); region-level survival/chat advice only needs ~city precision, so we
 * round to 1 decimal (≈ 11 km) before any coordinate is interpolated into a
 * prompt bound for a third-party model.
 */

export const COARSE_COORD_DECIMALS = 1;

/**
 * Round a latitude/longitude to `decimals` places (default 1 ≈ 11 km).
 * Non-finite input collapses to 0 so a bad coordinate can never leak a raw
 * value or produce `NaN` in a prompt.
 */
export function coarsenCoord(value: number, decimals: number = COARSE_COORD_DECIMALS): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Format a coordinate pair coarsened for prompt egress, e.g. "~41.6, ~-86.7". */
export function coarseCoordPair(lat: number, lon: number, decimals: number = COARSE_COORD_DECIMALS): string {
  return `~${coarsenCoord(lat, decimals)}, ~${coarsenCoord(lon, decimals)}`;
}
