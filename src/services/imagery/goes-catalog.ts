/**
 * GOES imagery catalog — pure-deterministic URL building + frame parsing.
 *
 * Replaces the old hardcoded "2 GeoColor CONUS views" with a full
 * satellite × sector × product catalog, correct GOES-19 East paths
 * (GOES-16 was retired as East on 2025-04-04), and animation-frame
 * parsing so the panel can play a live loop.
 *
 * No I/O. The sidecar route fetches the NESDIS directory listing and
 * feeds the HTML to `parseFrameListing`; unit tests feed it static
 * fixtures.
 *
 * NESDIS CDN layout:
 *   https://cdn.star.nesdis.noaa.gov/{SAT}/ABI/{SECTOR}/{PRODUCT}/
 *     latest.jpg                              full-res latest
 *     thumbnail.jpg                           small latest
 *     {YYYYDDDHHMM}_{SAT}-ABI-{SECTOR}-{PRODUCT}-{WxH}.jpg   timestamped frames
 *
 * Frame timestamps are UTC, encoded as 4-digit year + 3-digit
 * day-of-year + 2-digit hour + 2-digit minute (e.g. 20261511631).
 */

export const NESDIS_CDN_BASE = 'https://cdn.star.nesdis.noaa.gov';

export type GoesSatelliteId = 'GOES19' | 'GOES18';
export type GoesSectorId = 'CONUS' | 'FD';

export interface GoesSatellite {
  id: GoesSatelliteId;
  label: string;
  position: 'east' | 'west';
}

export interface GoesSector {
  id: GoesSectorId;
  label: string;
  /** Sized frame to embed for animation (keeps payload small vs full-res). */
  animationSize: string;
  /** Larger size for the still hero image. */
  stillSize: string;
}

export interface GoesProduct {
  /** NESDIS product directory name. */
  id: string;
  label: string;
  description: string;
}

export const GOES_SATELLITES: readonly GoesSatellite[] = [
  { id: 'GOES19', label: 'GOES-East (GOES-19)', position: 'east' },
  { id: 'GOES18', label: 'GOES-West (GOES-18)', position: 'west' },
];

export const GOES_SECTORS: readonly GoesSector[] = [
  { id: 'CONUS', label: 'CONUS', animationSize: '1250x750', stillSize: '2500x1500' },
  { id: 'FD', label: 'Full Disk', animationSize: '1808x1808', stillSize: '1808x1808' },
];

export const GOES_PRODUCTS: readonly GoesProduct[] = [
  { id: 'GEOCOLOR', label: 'GeoColor', description: 'True color by day, IR clouds by night' },
  { id: '13', label: 'Clean IR', description: 'Band 13 longwave IR — cloud-top temps, night storms' },
  { id: '07', label: 'Shortwave IR', description: 'Band 7 — fire / hot-spot detection' },
  { id: '08', label: 'Upper Water Vapor', description: 'Band 8 — upper-level moisture & jet dynamics' },
  { id: '09', label: 'Mid Water Vapor', description: 'Band 9 — mid-level moisture' },
];

export function getSatellite(id: string): GoesSatellite | undefined {
  return GOES_SATELLITES.find((s) => s.id === id);
}
export function getSector(id: string): GoesSector | undefined {
  return GOES_SECTORS.find((s) => s.id === id);
}
export function getProduct(id: string): GoesProduct | undefined {
  return GOES_PRODUCTS.find((p) => p.id === id);
}

export function isValidSelection(sat: string, sector: string, product: string): boolean {
  return Boolean(getSatellite(sat) && getSector(sector) && getProduct(product));
}

// URL builders

export function productDirUrl(
  sat: GoesSatelliteId,
  sector: GoesSectorId,
  product: string,
): string {
  return `${NESDIS_CDN_BASE}/${sat}/ABI/${sector}/${product}/`;
}

export function latestUrl(
  sat: GoesSatelliteId,
  sector: GoesSectorId,
  product: string,
): string {
  return `${productDirUrl(sat, sector, product)}latest.jpg`;
}

export function thumbnailUrl(
  sat: GoesSatelliteId,
  sector: GoesSectorId,
  product: string,
): string {
  return `${productDirUrl(sat, sector, product)}thumbnail.jpg`;
}

export function frameUrl(
  sat: GoesSatelliteId,
  sector: GoesSectorId,
  product: string,
  timestamp: string,
  size: string,
): string {
  return `${productDirUrl(sat, sector, product)}${timestamp}_${sat}-ABI-${sector}-${product}-${size}.jpg`;
}

// Timestamp parsing

/**
 * Convert a NESDIS `YYYYDDDHHMM` UTC stamp to epoch ms.
 * Returns null for malformed input (wrong length, out-of-range fields).
 */
export function goesTimestampToEpoch(stamp: string): number | null {
  if (!/^\d{11}$/.test(stamp)) return null;
  const year = Number(stamp.slice(0, 4));
  const dayOfYear = Number(stamp.slice(4, 7));
  const hour = Number(stamp.slice(7, 9));
  const minute = Number(stamp.slice(9, 11));
  if (dayOfYear < 1 || dayOfYear > 366) return null;
  if (hour > 23 || minute > 59) return null;
  // Jan 1 00:00 UTC of `year`, plus (dayOfYear - 1) days + hours + minutes.
  const base = Date.UTC(year, 0, 1, hour, minute, 0, 0);
  const withDays = base + (dayOfYear - 1) * 86_400_000;
  // Reject a day-of-year that overflowed into the next year (e.g. 366 in a
  // non-leap year lands in January — that's a malformed stamp for our use).
  if (new Date(withDays).getUTCFullYear() !== year) return null;
  return withDays;
}

// Frame-listing parser

export interface GoesFrame {
  timestamp: string;
  epochMs: number;
  size: string;
  url: string;
}

/**
 * Parse a NESDIS directory-listing HTML page into sorted frames (oldest
 * first) matching the requested size. Pure — the caller fetches the HTML.
 */
export function parseFrameListing(
  html: string,
  sat: GoesSatelliteId,
  sector: GoesSectorId,
  product: string,
  size: string,
): GoesFrame[] {
  const dir = productDirUrl(sat, sector, product);
  const fileRe = new RegExp(
    String.raw`(\d{11})_${sat}-ABI-${sector}-${product}-${size}\.jpg`,
    'g',
  );
  const seen = new Set<string>();
  const frames: GoesFrame[] = [];
  for (const m of html.matchAll(fileRe)) {
    const timestamp = m[1]!;
    if (seen.has(timestamp)) continue;
    const epochMs = goesTimestampToEpoch(timestamp);
    if (epochMs === null) continue;
    seen.add(timestamp);
    frames.push({
      timestamp,
      epochMs,
      size,
      url: `${dir}${timestamp}_${sat}-ABI-${sector}-${product}-${size}.jpg`,
    });
  }
  frames.sort((a, b) => a.epochMs - b.epochMs);
  return frames;
}

/** Keep the most recent `n` frames (for a bounded animation loop). */
export function recentFrames(frames: readonly GoesFrame[], n: number): GoesFrame[] {
  if (n <= 0) return [];
  return frames.slice(-n);
}
