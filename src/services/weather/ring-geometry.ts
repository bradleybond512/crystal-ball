/**
 * Shared usability predicate for a polygon ring used in point-in-polygon
 * matching. A ring is usable only when it has ≥3 vertices AND encloses non-zero
 * area: a ring whose vertices are all identical or all collinear passes a naive
 * length check but can never contain a point, so an alert carrying only such
 * geometry is spatially unplaceable. `alertHasUsablePolygon` (weather.ts) and
 * `alertMatchRings` (weather-exposure.ts) share this so the clear-decision's
 * zone-only accounting and the matcher agree on exactly which rings place a
 * point. Only EXACTLY-zero area is rejected — a legitimately thin NWS warning
 * polygon (small but non-zero area) stays usable (fail-stuck guard).
 *
 * Cycle-free by design: this module imports nothing from weather.ts.
 */
export function isUsableMatchRing(ring: readonly (readonly [number, number])[]): boolean {
  if (ring.length < 3) return false;
  let area2 = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (!a || !b) return false;
    area2 += a[0] * b[1] - b[0] * a[1];
  }
  return area2 !== 0;
}
