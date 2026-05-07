/**
 * Per-domain heatmap layer configuration for the God's Vision globe.
 *
 * Pure deterministic. Builds deck.gl `HexagonLayer` props from domain
 * point arrays + a palette so the toggle UI in GodsVisionView can do
 * the wiring without re-deriving constants.
 *
 * Why a config builder instead of mounting the layer here?
 *   The Cesium ↔ deck.gl overlay is owned by GodsVisionView and the
 *   existing GlobeDataManager lifecycle. Decoupling the config from the
 *   mount keeps this module unit-testable on static fixtures and lets
 *   the panel UI snapshot config shape without touching WebGL.
 *
 * Plan invariants:
 *   - Only one heatmap layer is "active" at a time per the spec; this
 *     module just produces the config — single-active state lives in
 *     the toggle UI that consumes it.
 *   - Per-domain palette has a 6-stop color ramp so HexagonLayer's
 *     binning produces a smooth gradient, not stair-steps.
 *   - Default opacity 0.6 (spec); caller can override for the slider.
 *   - Output is JSON-serializable apart from the accessor closures —
 *     `data` is a plain array, `colorRange` is RGB tuples.
 */

// ── Public types ──────────────────────────────────────────────────────

export type HeatmapDomain = 'seismic' | 'fire' | 'cyber' | 'conflict';

export interface HeatmapPoint {
  lat: number;
  lon: number;
  /** Optional weight — defaults to 1 in HexagonLayer's binning. */
  weight?: number;
  /** Free-text id for tooltip / debugging. */
  id?: string;
}

/** RGB triplet, 0-255 each channel. */
export type RgbTuple = readonly [number, number, number];

export interface HeatmapPalette {
  domain: HeatmapDomain;
  /** Display label for the toggle button. */
  label: string;
  /** 6-stop color ramp from low→high density. deck.gl interpolates. */
  colorRange: readonly RgbTuple[];
  /** Hex bin radius in metres. Domain-specific so seismic
   *  (continental sparseness) doesn't render the same as cyber events
   *  (city-clustered). */
  radius: number;
  /** Aggregation function applied to weights inside a hex bin —
   *  HexagonLayer accepts 'SUM' | 'MEAN' | 'MIN' | 'MAX'. */
  aggregation: 'SUM' | 'MEAN';
  /** Vertical exaggeration of the hex columns. 0 = flat hexes. */
  elevationScale: number;
}

export interface HeatmapLayerConfig {
  /** Stable id deck.gl uses to track the layer between renders. */
  id: string;
  /** Domain points the layer aggregates. */
  data: readonly HeatmapPoint[];
  /** Hex bin radius in metres. */
  radius: number;
  /** 6-stop RGB ramp the layer's gradient uses. */
  colorRange: readonly RgbTuple[];
  aggregation: 'SUM' | 'MEAN';
  elevationScale: number;
  /** [0, 1] — default 0.6 per spec. */
  opacity: number;
  /** Whether the layer should currently render. The toggle UI flips
   *  this; only one heatmap is active at a time. */
  visible: boolean;
  /** Position accessor passed to HexagonLayer. */
  getPosition: (p: HeatmapPoint) => [number, number];
  /** Weight accessor passed to HexagonLayer. */
  getWeight: (p: HeatmapPoint) => number;
}

// ── Per-domain palettes ───────────────────────────────────────────────

/** Seismic: cool blue → red, sized for continental spacing. */
const SEISMIC_PALETTE: HeatmapPalette = {
  domain: 'seismic',
  label: 'Seismic Density',
  colorRange: [
    [33, 102, 172], [103, 169, 207], [209, 229, 240],
    [253, 219, 199], [239, 138, 98], [178, 24, 43],
  ],
  radius: 80_000, // 80 km
  aggregation: 'SUM',
  elevationScale: 0,
};

/** Fire: yellow → deep orange. NIFC hotspot density. */
const FIRE_PALETTE: HeatmapPalette = {
  domain: 'fire',
  label: 'Fire Density',
  colorRange: [
    [255, 247, 188], [254, 227, 145], [254, 196, 79],
    [254, 153, 41], [217, 95, 14], [153, 52, 4],
  ],
  radius: 30_000, // 30 km — fires cluster tighter than quakes
  aggregation: 'SUM',
  elevationScale: 0,
};

/** Cyber: muted greys → dark red. Tighter radius for city-clustered events. */
const CYBER_PALETTE: HeatmapPalette = {
  domain: 'cyber',
  label: 'Cyber Incidents',
  colorRange: [
    [240, 240, 240], [217, 217, 217], [189, 189, 189],
    [216, 109, 109], [165, 15, 21], [103, 0, 13],
  ],
  radius: 50_000, // 50 km
  aggregation: 'SUM',
  elevationScale: 0,
};

/** Conflict: amber palette for ACLED / GDELT events. */
const CONFLICT_PALETTE: HeatmapPalette = {
  domain: 'conflict',
  label: 'Conflict Events',
  colorRange: [
    [255, 245, 235], [254, 230, 206], [253, 208, 162],
    [253, 174, 107], [241, 105, 19], [127, 39, 4],
  ],
  radius: 40_000, // 40 km
  aggregation: 'SUM',
  elevationScale: 0,
};

const PALETTES: Readonly<Record<HeatmapDomain, HeatmapPalette>> = {
  seismic: SEISMIC_PALETTE,
  fire: FIRE_PALETTE,
  cyber: CYBER_PALETTE,
  conflict: CONFLICT_PALETTE,
};

// ── Public API ────────────────────────────────────────────────────────

/** Lookup a domain palette. Pure. */
export function paletteFor(domain: HeatmapDomain): HeatmapPalette {
  return PALETTES[domain];
}

/** Every palette as a sorted list. The toggle UI uses this to render
 *  the radio-style button row. */
export function listPalettes(): readonly HeatmapPalette[] {
  return ['seismic', 'fire', 'cyber', 'conflict'].map((d) => PALETTES[d as HeatmapDomain]);
}

export interface BuildLayerOptions {
  /** [0, 1]. Default 0.6 (spec). */
  opacity?: number;
  /** Default true. Set false on inactive layers when rendering all
   *  four for animated transitions. */
  visible?: boolean;
  /** Override id (defaults to `heatmap-{domain}`). */
  id?: string;
}

/**
 * Build a deck.gl HexagonLayer config object for a domain. The caller
 * (GodsVisionView heatmap manager) wraps this in `new HexagonLayer(...)`.
 *
 * Returning a plain object (rather than the layer instance) keeps the
 * service free of deck.gl runtime imports — this module loads cleanly
 * in `tsx --test` without bringing in WebGL.
 */
export function buildHeatmapLayerConfig(
  domain: HeatmapDomain,
  points: readonly HeatmapPoint[],
  options: BuildLayerOptions = {},
): HeatmapLayerConfig {
  const palette = PALETTES[domain];
  return {
    id: options.id ?? `heatmap-${domain}`,
    data: points,
    radius: palette.radius,
    colorRange: palette.colorRange,
    aggregation: palette.aggregation,
    elevationScale: palette.elevationScale,
    opacity: clamp01(options.opacity ?? 0.6),
    visible: options.visible ?? true,
    getPosition: (p) => [p.lon, p.lat],
    getWeight: (p) => p.weight ?? 1,
  };
}

/**
 * Single-active-domain controller helper. Given the user's currently
 * selected domain (or null when all heatmaps are off) and a per-domain
 * data map, return one config per domain — exactly one with
 * `visible: true`.
 *
 * Pure: callers re-invoke on every render with fresh data + selection
 * and diff against the previous result themselves (or just replace
 * the whole layer set, which deck.gl handles fine).
 */
export function buildAllHeatmapLayers(input: {
  selected: HeatmapDomain | null;
  points: Partial<Record<HeatmapDomain, readonly HeatmapPoint[]>>;
  opacity?: number;
}): HeatmapLayerConfig[] {
  return listPalettes().map((p) => buildHeatmapLayerConfig(
    p.domain,
    input.points[p.domain] ?? [],
    {
      opacity: input.opacity ?? 0.6,
      visible: input.selected === p.domain,
    },
  ));
}

// ── Helpers ───────────────────────────────────────────────────────────

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
