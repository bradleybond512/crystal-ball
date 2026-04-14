/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
/**
 * CII Choropleth Layer Data Source
 *
 * Produces a country-code -> fill-color map suitable for a deck.gl
 * GeoJsonLayer. The actual map rendering stays in DeckGLMap.ts; this
 * service just supplies the colored mapping.
 *
 * Color scale (red-yellow-green, higher CII = more unstable = redder):
 *   0-20  green        (76, 175, 80, 140)
 *  20-40  yellow-green (205, 220, 57, 140)
 *  40-60  yellow       (255, 235, 59, 140)
 *  60-80  orange       (255, 152, 0, 160)
 *  80-100 red          (244, 67, 54, 180)
 *  no-data gray        (100, 100, 100, 60)
 */

import type { CountryScore } from '@/services/country-instability';

export interface CIIChoroplethCell {
  countryCode: string;
  ciiScore: number;
  /** RGBA, 0-255 per channel. */
  fillColor: [number, number, number, number];
  /** RGBA, 0-255 per channel. */
  lineColor: [number, number, number, number];
}

type RGBA = [number, number, number, number];

const COLOR_GREEN: RGBA = [76, 175, 80, 140];
const COLOR_YELLOW_GREEN: RGBA = [205, 220, 57, 140];
const COLOR_YELLOW: RGBA = [255, 235, 59, 140];
const COLOR_ORANGE: RGBA = [255, 152, 0, 160];
const COLOR_RED: RGBA = [244, 67, 54, 180];
const COLOR_NO_DATA: RGBA = [100, 100, 100, 60];
const LINE_NO_DATA: RGBA = [120, 120, 120, 80];

/**
 * Map a CII score (0-100) to an RGBA color.
 * Scores outside the 0-100 range are clamped.
 */
export function scoreToColor(score: number): RGBA {
  if (!Number.isFinite(score)) return COLOR_NO_DATA;
  const s = Math.max(0, Math.min(100, score));
  if (s < 20) return [...COLOR_GREEN] as RGBA;
  if (s < 40) return [...COLOR_YELLOW_GREEN] as RGBA;
  if (s < 60) return [...COLOR_YELLOW] as RGBA;
  if (s < 80) return [...COLOR_ORANGE] as RGBA;
  return [...COLOR_RED] as RGBA;
}

/**
 * Derive the stroke color for a cell from its fill color (same RGB, alpha 200).
 */
function fillToLine(fill: RGBA): RGBA {
  return [fill[0], fill[1], fill[2], 200];
}

/**
 * Build a list of choropleth cells from a set of CountryScore rows.
 *
 * If multiple scores share a country code, the most recent one
 * (by `lastUpdated`) wins. Countries without a finite score are skipped.
 */
export function buildChoroplethCells(scores: CountryScore[]): CIIChoroplethCell[] {
  const latestByCode = new Map<string, CountryScore>();
  for (const s of scores) {
    if (!s || typeof s.code !== 'string') continue;
    const code = s.code.toUpperCase();
    const existing = latestByCode.get(code);
    if (!existing) {
      latestByCode.set(code, s);
      continue;
    }
    const existingT = existing.lastUpdated?.getTime?.() ?? 0;
    const candidateT = s.lastUpdated?.getTime?.() ?? 0;
    if (candidateT >= existingT) latestByCode.set(code, s);
  }

  const cells: CIIChoroplethCell[] = [];
  for (const [code, s] of latestByCode) {
    if (!Number.isFinite(s.score)) continue;
    const fill = scoreToColor(s.score);
    cells.push({
      countryCode: code,
      ciiScore: s.score,
      fillColor: fill,
      lineColor: fillToLine(fill),
    });
  }
  return cells;
}

/**
 * Look up the fill color for a single country code against a score list.
 * Falls back to the no-data gray when the country is absent or unscored.
 */
export function getCountryFillColor(
  countryCode: string,
  scores: CountryScore[],
): RGBA {
  if (!countryCode) return [...COLOR_NO_DATA] as RGBA;
  const target = countryCode.toUpperCase();
  let latest: CountryScore | undefined;
  let latestT = -Infinity;
  for (const s of scores) {
    if (!s || typeof s.code !== 'string') continue;
    if (s.code.toUpperCase() !== target) continue;
    const t = s.lastUpdated?.getTime?.() ?? 0;
    if (t >= latestT) {
      latest = s;
      latestT = t;
    }
  }
  if (!latest || !Number.isFinite(latest.score)) {
    return [...COLOR_NO_DATA] as RGBA;
  }
  return scoreToColor(latest.score);
}

/**
 * Exported for callers that need to render a "no data" stroke explicitly.
 */
export function getNoDataLineColor(): RGBA {
  return [...LINE_NO_DATA] as RGBA;
}
