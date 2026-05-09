/**
 * Heatmap grid binning + color mapping.
 *
 * Pure deterministic. No DOM, no fetch, no Cesium imports — the
 * Cesium glue lives in `GlobeHeatmapRenderer.ts` and consumes the
 * binned cells this module produces.
 *
 * Plan invariants:
 *   - Cell footprint is a fixed 1°×1° grid. Lat/lon bin keys are
 *     integer floor() of the position; no float drift.
 *   - Aggregation function is per-domain — seismic uses `max`
 *     (highest magnitude in cell), wildfire uses `sum` (total FRP),
 *     weather + infrastructure use `count`.
 *   - Color ramps live here as fixed 5-stop arrays so tests + UI
 *     agree on stop boundaries.
 *   - Output rectangles are degree-aligned (`west`, `south`, `east`,
 *     `north`) so the renderer can pass them straight to
 *     `Rectangle.fromDegrees()` with no further math.
 */

// ── Public types ────────────────────────────────────────────────────────

export type HeatmapDomain = 'seismic' | 'wildfire' | 'weather' | 'infrastructure';

export interface HeatmapPoint {
  lat: number;
  lon: number;
  /** Domain-specific intensity:
   *  - seismic: magnitude (e.g. 5.4)
   *  - wildfire: FRP MW (e.g. 234.5)
   *  - weather: 1 per alert (callers pre-multiply if they have weights)
   *  - infrastructure: 1 per outage (or customers/1000) */
  intensity: number;
}

export interface HeatmapCell {
  /** Integer-floor lat (south edge). */
  south: number;
  /** Integer-floor lon (west edge). */
  west: number;
  /** south + 1. */
  north: number;
  /** west + 1. */
  east: number;
  /** Aggregated value used for color mapping. */
  value: number;
  /** Number of points that fell into this cell. */
  count: number;
}

export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  /** [0, 1] alpha. */
  a: number;
}

export type AggregationKind = 'max' | 'sum' | 'count';

// ── Per-domain color ramps + aggregation rules ──────────────────────────

const SEISMIC_RAMP: readonly RgbaColor[] = [
  { r: 30,  g: 64,  b: 175, a: 0.35 },  // blue (M ≤ 3)
  { r: 99,  g: 102, b: 241, a: 0.45 },  // indigo (M 3–4)
  { r: 234, g: 179, b: 8,   a: 0.55 },  // amber (M 4–5)
  { r: 249, g: 115, b: 22,  a: 0.65 },  // orange (M 5–6)
  { r: 220, g: 38,  b: 38,  a: 0.75 },  // red (M ≥ 6)
];

const WILDFIRE_RAMP: readonly RgbaColor[] = [
  { r: 254, g: 240, b: 138, a: 0.35 },  // pale yellow
  { r: 253, g: 186, b: 116, a: 0.45 },
  { r: 251, g: 113, b: 133, a: 0.55 },
  { r: 234, g: 88,  b: 12,  a: 0.65 },
  { r: 153, g: 27,  b: 27,  a: 0.8 },  // deep red
];

const WEATHER_RAMP: readonly RgbaColor[] = [
  { r: 134, g: 239, b: 172, a: 0.35 },  // green (1 alert)
  { r: 250, g: 204, b: 21,  a: 0.45 },  // yellow
  { r: 249, g: 115, b: 22,  a: 0.55 },  // orange
  { r: 168, g: 85,  b: 247, a: 0.65 },  // purple
  { r: 109, g: 40,  b: 217, a: 0.75 },  // deep purple
];

const INFRA_RAMP: readonly RgbaColor[] = [
  { r: 240, g: 240, b: 240, a: 0.35 },  // near-white
  { r: 254, g: 215, b: 170, a: 0.45 },
  { r: 251, g: 113, b: 133, a: 0.55 },
  { r: 220, g: 38,  b: 38,  a: 0.65 },
  { r: 127, g: 29,  b: 29,  a: 0.8 },  // deep red
];

const RAMPS: Readonly<Record<HeatmapDomain, readonly RgbaColor[]>> = {
  seismic: SEISMIC_RAMP,
  wildfire: WILDFIRE_RAMP,
  weather: WEATHER_RAMP,
  infrastructure: INFRA_RAMP,
};

const AGGREGATION: Readonly<Record<HeatmapDomain, AggregationKind>> = {
  seismic: 'max',          // highest-magnitude quake in cell
  wildfire: 'sum',         // total fire radiative power in cell
  weather: 'count',        // alerts per cell
  infrastructure: 'count', // outages per cell
};

/** Per-domain stop boundaries. Stop[i] is the *upper* bound for the
 *  i-th color in the ramp; values ≥ stop[length-1] use the final color.
 *  Stops are tuned to the aggregation kind:
 *  - seismic max-magnitude bands: 3 / 4 / 5 / 6 / 6+
 *  - wildfire sum-FRP MW: 50 / 200 / 500 / 1000 / 1000+
 *  - weather count: 1 / 3 / 5 / 10 / 10+
 *  - infrastructure count: 1 / 5 / 20 / 50 / 50+ */
const STOPS: Readonly<Record<HeatmapDomain, readonly number[]>> = {
  seismic:        [3, 4, 5, 6],
  wildfire:       [50, 200, 500, 1000],
  weather:        [1, 3, 5, 10],
  infrastructure: [1, 5, 20, 50],
};

// ── Public API ──────────────────────────────────────────────────────────

export function rampFor(domain: HeatmapDomain): readonly RgbaColor[] {
  return RAMPS[domain];
}

export function aggregationFor(domain: HeatmapDomain): AggregationKind {
  return AGGREGATION[domain];
}

export function stopsFor(domain: HeatmapDomain): readonly number[] {
  return STOPS[domain];
}

/** Pick the ramp color for a domain + cell value. */
export function colorFor(domain: HeatmapDomain, value: number): RgbaColor {
  const ramp = RAMPS[domain];
  const stops = STOPS[domain];
  for (const [i, stop] of stops.entries()) {
    if (value < stop) return ramp[i]!;
  }
  return ramp[ramp.length - 1]!;
}

/** Bin points into 1°×1° cells. Empty input → empty array.
 *  Points outside [-90,90] / [-180,180] are silently dropped — callers
 *  pre-clean if they care. */
export function binToCells(
  domain: HeatmapDomain,
  points: readonly HeatmapPoint[],
): HeatmapCell[] {
  if (points.length === 0) return [];
  const agg = AGGREGATION[domain];
  const buckets = new Map<string, { south: number; west: number; value: number; count: number }>();
  for (const p of points) {
    if (p.lat < -90 || p.lat > 90) continue;
    if (p.lon < -180 || p.lon > 180) continue;
    if (!Number.isFinite(p.intensity)) continue;
    const south = Math.floor(p.lat);
    const west = Math.floor(p.lon);
    const key = `${south}|${west}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.value = combine(agg, existing.value, p.intensity);
      existing.count += 1;
    } else {
      buckets.set(key, { south, west, value: p.intensity, count: 1 });
    }
  }
  const out: HeatmapCell[] = [];
  for (const b of buckets.values()) {
    out.push({
      south: b.south,
      west: b.west,
      north: b.south + 1,
      east: b.west + 1,
      value: agg === 'count' ? b.count : b.value,
      count: b.count,
    });
  }
  out.sort((a, b) => (a.south - b.south) || (a.west - b.west));
  return out;
}

function combine(agg: AggregationKind, existing: number, next: number): number {
  switch (agg) {
    case 'max':   { return Math.max(existing, next); }
    case 'sum':   { return existing + next; }
    case 'count': { return existing; } // count is from `count` field, not value
  }
}

/** Convenience: bin + color in one pass. Used by the renderer's
 *  primary code path. */
export interface ColoredHeatmapCell extends HeatmapCell {
  color: RgbaColor;
}

export function buildColoredCells(
  domain: HeatmapDomain,
  points: readonly HeatmapPoint[],
): ColoredHeatmapCell[] {
  return binToCells(domain, points).map((cell) => ({
    ...cell,
    color: colorFor(domain, cell.value),
  }));
}
