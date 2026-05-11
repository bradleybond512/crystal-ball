/**
 * Rapid Impact Assessment — Layer 4 of the Seismic Intelligence System.
 *
 * Pure deterministic. No DOM, no fetch, no globals at import time. Two
 * upstream USGS shapes (PAGER summary feed + ShakeMap product) are
 * parsed by separate functions; a third function fuses them into a
 * single `EarthquakeImpactAssessment`. The sidecar fetches the feeds
 * and calls `assessEarthquakeImpact()` so this module stays trivially
 * unit-testable.
 *
 * Plan invariants:
 *   - PAGER alert level + USGS-published fatality / loss ranges are
 *     surfaced verbatim (string ranges, never our re-derived numbers).
 *     PAGER ranges are a USGS publication; we don't second-guess them.
 *   - ShakeMap MMI grid is preserved as-is (lat,lon,intensity rows)
 *     plus a derived maxMMI for fast "should I act?" filtering.
 *   - `affectedCities` is sorted by descending intensity then by
 *     descending population — most-shaken biggest cities first.
 *   - When PAGER lacks an alert level we still emit an assessment with
 *     `pagerAlert: null` rather than dropping it; downstream UI needs
 *     a row for every reviewed event.
 */

// ── Public types ────────────────────────────────────────────────────────

export type PagerAlertLevel = 'green' | 'yellow' | 'orange' | 'red';

/** USGS publishes PAGER ranges as labels, not numbers — keep them as
 *  strings so we don't lose precision or imply false certainty. */
export interface PagerEstimate {
  alertLevel: PagerAlertLevel | null;
  fatalitiesRange: string;
  lossesRangeUsd: string;
  populationExposedThousands: number | null;
}

export interface ShakeMapMmiCell {
  lat: number;
  lon: number;
  /** Modified Mercalli Intensity, 1..12. */
  mmi: number;
}

export interface ShakeMapSummary {
  /** Grid cells; may be empty when ShakeMap hasn't been generated yet. */
  grid: ShakeMapMmiCell[];
  maxMmi: number | null;
  /** ms epoch — when ShakeMap was last published. `null` when missing. */
  publishedAt: number | null;
}

export interface AffectedCity {
  name: string;
  /** Population estimate, in thousands of residents. */
  populationThousands: number;
  /** MMI estimated for this city — max across nearby grid cells. */
  estimatedMmi: number;
  distanceKm: number;
}

export interface EarthquakeImpactAssessment {
  eventId: string;
  pagerAlert: PagerAlertLevel | null;
  estimatedFatalities: string;
  estimatedLosses: string;
  shakeMapMaxMmi: number | null;
  shakeMapGrid: ShakeMapMmiCell[];
  shakeMapPublishedAt: number | null;
  /** Cities with at least one MMI≥4 grid cell within `cityRadiusKm`. */
  affectedCities: AffectedCity[];
  /** Population-thousands sum across affected cities — a quick "magnitude
   *  of human exposure" indicator separate from PAGER's labelled range. */
  affectedPopulationThousands: number;
}

// ── PAGER parsing ──────────────────────────────────────────────────────

/** Shape of a single feature in the PAGER significant_month feed. */
export interface PagerFeature {
  id: string;
  geometry?: { coordinates?: [number, number, number] };
  properties?: {
    alert?: string | null;
    mag?: number | null;
    place?: string | null;
    time?: number | null;
    updated?: number | null;
    sig?: number | null;
    products?: {
      losspager?: {
        properties?: {
          alertlevel?: string;
          maxmmi?: string;
          impact1?: string;
          impact2?: string;
          'fatalities'?: string;
          'eqp-deaths'?: string;
          'eqp-economic'?: string;
        };
      }[];
    };
  };
}

const ALERT_RANGES: Record<PagerAlertLevel, { fatalities: string; losses: string }> = {
  red: { fatalities: '1,000+', losses: '>$1B' },
  orange: { fatalities: '100–999', losses: '$100M–$1B' },
  yellow: { fatalities: '1–99', losses: '$1M–$100M' },
  green: { fatalities: '< 1', losses: '< $1M' },
};

/** Parse a PAGER GeoJSON feed feature into a `PagerEstimate`. Returns
 *  `null` when the feature is too malformed to be useful. */
export function parsePagerFeature(feature: PagerFeature): PagerEstimate | null {
  const props = feature.properties;
  if (!props) return null;
  const rawAlert = (props.alert ?? null) as PagerAlertLevel | null;
  const alertLevel = isPagerLevel(rawAlert) ? rawAlert : null;
  const labels = alertLevel ? ALERT_RANGES[alertLevel] : { fatalities: 'unknown', losses: 'unknown' };
  const losspager = props.products?.losspager?.[0]?.properties;
  // PAGER occasionally publishes a more specific impact string in the
  // product's properties (`impact1` / `impact2`). Prefer those when
  // they look like actual ranges; fall back to the standard labels.
  const fatalitiesRange = sanitizeRange(losspager?.impact2) ?? labels.fatalities;
  const lossesRangeUsd = sanitizeRange(losspager?.impact1) ?? labels.losses;

  return {
    alertLevel,
    fatalitiesRange,
    lossesRangeUsd,
    populationExposedThousands: null,
  };
}

function isPagerLevel(value: string | null): value is PagerAlertLevel {
  return value === 'green' || value === 'yellow' || value === 'orange' || value === 'red';
}

function sanitizeRange(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Reject obvious narrative strings ("Significant casualties likely")
  // by requiring at least one digit, currency symbol, or range marker.
  if (!/[\d$<–-]/.test(trimmed)) return null;
  return trimmed;
}

// ── ShakeMap parsing ───────────────────────────────────────────────────

/** Shape of the ShakeMap product as returned by USGS event detail. We
 *  only consume the small subset we need; tests pin the shape. */
export interface ShakeMapProduct {
  /** Array of cells: `[lon, lat, mmi]`. The USGS MMI grid is published
   *  as `grid.xml.zip`; the sidecar parses it down to this shape so the
   *  pure layer stays small. */
  cells?: [number, number, number][];
  /** ms epoch. */
  publishedAt?: number | null;
  maxMmi?: number | null;
}

/** Parse a ShakeMap product into a `ShakeMapSummary`. Treats missing
 *  fields as "no data" rather than throwing. */
export function parseShakeMapProduct(product: ShakeMapProduct | null | undefined): ShakeMapSummary {
  if (!product || !Array.isArray(product.cells) || product.cells.length === 0) {
    return {
      grid: [],
      maxMmi: product?.maxMmi ?? null,
      publishedAt: product?.publishedAt ?? null,
    };
  }
  const grid: ShakeMapMmiCell[] = [];
  let maxMmi = -Infinity;
  for (const cell of product.cells) {
    if (!Array.isArray(cell) || cell.length < 3) continue;
    const [lon, lat, mmi] = cell;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(mmi)) continue;
    grid.push({ lat, lon, mmi });
    if (mmi > maxMmi) maxMmi = mmi;
  }
  return {
    grid,
    maxMmi: Number.isFinite(maxMmi) ? maxMmi : (product.maxMmi ?? null),
    publishedAt: product.publishedAt ?? null,
  };
}

// ── Assessment construction ────────────────────────────────────────────

export interface CityCatalogEntry {
  name: string;
  lat: number;
  lon: number;
  populationThousands: number;
}

export interface AssessImpactInput {
  eventId: string;
  pager: PagerEstimate | null;
  shakeMap: ShakeMapSummary;
  /** Optional city catalog. The sidecar passes a curated list (e.g.
   *  populated places ≥100k). When omitted, `affectedCities` is empty —
   *  the assessment still surfaces PAGER + ShakeMap. */
  cities?: readonly CityCatalogEntry[];
  /** Cities count as affected when a grid cell within this radius has
   *  MMI ≥ `minAffectedMmi`. Default 50 km. */
  cityRadiusKm?: number;
  /** Default 4 (light shaking — first level at which residents
   *  generally report it). */
  minAffectedMmi?: number;
}

export function assessEarthquakeImpact(input: AssessImpactInput): EarthquakeImpactAssessment {
  const cityRadiusKm = input.cityRadiusKm ?? 50;
  const minAffectedMmi = input.minAffectedMmi ?? 4;
  const affectedCities = computeAffectedCities({
    cities: input.cities ?? [],
    grid: input.shakeMap.grid,
    cityRadiusKm,
    minAffectedMmi,
  });

  const labels = input.pager
    ? { fatalities: input.pager.fatalitiesRange, losses: input.pager.lossesRangeUsd }
    : { fatalities: 'unknown', losses: 'unknown' };

  return {
    eventId: input.eventId,
    pagerAlert: input.pager?.alertLevel ?? null,
    estimatedFatalities: labels.fatalities,
    estimatedLosses: labels.losses,
    shakeMapMaxMmi: input.shakeMap.maxMmi,
    shakeMapGrid: input.shakeMap.grid,
    shakeMapPublishedAt: input.shakeMap.publishedAt,
    affectedCities,
    affectedPopulationThousands: affectedCities.reduce((acc, c) => acc + c.populationThousands, 0),
  };
}

function computeAffectedCities(input: {
  cities: readonly CityCatalogEntry[];
  grid: readonly ShakeMapMmiCell[];
  cityRadiusKm: number;
  minAffectedMmi: number;
}): AffectedCity[] {
  if (input.cities.length === 0 || input.grid.length === 0) return [];
  const out: AffectedCity[] = [];
  for (const city of input.cities) {
    const best = bestGridCellForCity(city, input.grid, input.cityRadiusKm, input.minAffectedMmi);
    if (best === null) continue;
    out.push({
      name: city.name,
      populationThousands: city.populationThousands,
      estimatedMmi: best.mmi,
      distanceKm: best.distanceKm,
    });
  }
  out.sort((a, b) => {
    if (b.estimatedMmi !== a.estimatedMmi) return b.estimatedMmi - a.estimatedMmi;
    return b.populationThousands - a.populationThousands;
  });
  return out;
}

function bestGridCellForCity(
  city: CityCatalogEntry,
  grid: readonly ShakeMapMmiCell[],
  cityRadiusKm: number,
  minAffectedMmi: number,
): { mmi: number; distanceKm: number } | null {
  let bestMmi = -Infinity;
  let bestDistance = Infinity;
  for (const cell of grid) {
    if (cell.mmi < minAffectedMmi) continue;
    const distance = haversineKm(city.lat, city.lon, cell.lat, cell.lon);
    if (distance > cityRadiusKm) continue;
    const better = cell.mmi > bestMmi || (cell.mmi === bestMmi && distance < bestDistance);
    if (!better) continue;
    bestMmi = cell.mmi;
    bestDistance = distance;
  }
  return Number.isFinite(bestMmi) ? { mmi: bestMmi, distanceKm: bestDistance } : null;
}

// ── Math helper ────────────────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371;
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dPhi / 2) ** 2
    + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

export const __INTERNAL = {
  computeAffectedCities,
  haversineKm,
  ALERT_RANGES,
};
