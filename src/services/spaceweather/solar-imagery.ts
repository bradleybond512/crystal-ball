/**
 * Solar imagery catalog — pure helper module shared by the renderer
 * (SpaceWeatherPanel) and the sidecar (`/api/spaceweather/imagery`).
 *
 * NASA serves these JPEGs publicly without an API key. Both the
 * upstream URLs and the sidecar proxy paths live here so the two
 * surfaces cannot disagree on the allowlist, and a refactor to the
 * catalog lands in one place.
 *
 * Pure deterministic. No DOM, no fetch, no globals at import time.
 */

export type SolarImagerySlug =
  | 'sdo-aia-171'
  | 'sdo-aia-304'
  | 'sdo-hmi-magnetogram'
  | 'lasco-c2'
  | 'lasco-c3';

export interface SolarImageryEntry {
  /** URL-safe identifier used in sidecar paths and DOM ids. */
  slug: SolarImagerySlug;
  /** Short label for the UI (instrument + wavelength). */
  label: string;
  /** One-line description of what the image shows. */
  description: string;
  /** Upstream NASA URL. The sidecar proxy fetches this. */
  upstreamUrl: string;
}

export interface SolarImageryStatus {
  slug: SolarImagerySlug;
  label: string;
  description: string;
  /** Sidecar-relative proxy URL (`/api/spaceweather/imagery/{slug}.jpg`).
   *  The renderer renders <img src> from this so the browser never
   *  hits NASA directly — caching is consistent and CORS is bypassed. */
  proxyUrl: string;
  /** ISO timestamp of the upstream Last-Modified header, or null when
   *  the sidecar HEAD probe failed / upstream is silent. */
  lastModified: string | null;
  /** Free-form upstream status note for diagnostics ('ok', '404',
   *  'timeout', ...). Surfaced in the panel only when not-ok. */
  upstreamStatus: string;
}

export interface SolarImageryResponse {
  /** ISO timestamp the response was assembled. */
  asOf: string;
  images: SolarImageryStatus[];
}

/** The full image catalog. Order is the rendering order in the panel. */
export const SOLAR_IMAGERY_CATALOG: readonly SolarImageryEntry[] = [
  {
    slug: 'sdo-aia-171',
    label: 'SDO AIA 171Å',
    description: 'Quiet corona — coronal loops at ~600 000 K. Bright active regions and coronal holes.',
    upstreamUrl: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_0171.jpg',
  },
  {
    slug: 'sdo-aia-304',
    label: 'SDO AIA 304Å',
    description: 'Chromosphere / transition region at ~50 000 K. Filaments, prominences, and erupting plasma.',
    upstreamUrl: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_0304.jpg',
  },
  {
    slug: 'sdo-hmi-magnetogram',
    label: 'SDO HMI Magnetogram',
    description: 'Photospheric line-of-sight magnetic field. Sunspots and active-region polarity.',
    upstreamUrl: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_HMIBC.jpg',
  },
  {
    slug: 'lasco-c2',
    label: 'LASCO C2',
    description: 'Coronagraph 2–6 R☉. Earliest visibility for halo CMEs after eruption.',
    upstreamUrl: 'https://soho.nascom.nasa.gov/data/realtime/c2/1024/latest.jpg',
  },
  {
    slug: 'lasco-c3',
    label: 'LASCO C3',
    description: 'Wider coronagraph 3.5–32 R☉. Tracks CMEs once they leave C2 field.',
    upstreamUrl: 'https://soho.nascom.nasa.gov/data/realtime/c3/1024/latest.jpg',
  },
];

const VALID_SLUGS = new Set<string>(SOLAR_IMAGERY_CATALOG.map((e) => e.slug));

/** True when `s` is a known catalog slug. Use this for sidecar input
 *  validation so the proxy can never be coerced into fetching an
 *  arbitrary URL (SSRF defense). */
export function isSolarImagerySlug(s: unknown): s is SolarImagerySlug {
  return typeof s === 'string' && VALID_SLUGS.has(s);
}

/** Look up a catalog entry by slug, or null when unknown. */
export function findSolarImageryEntry(slug: string): SolarImageryEntry | null {
  return SOLAR_IMAGERY_CATALOG.find((e) => e.slug === slug) ?? null;
}

/** Sidecar proxy path for `slug`. The route is bytes-stable across
 *  reloads — workbox / SW caching can use it as a stable key. */
export function proxyPathForSlug(slug: SolarImagerySlug): string {
  return `/api/spaceweather/imagery/${slug}.jpg`;
}

/**
 * Format "Last updated X ago" for the panel. Returns 'just now' when
 * `nowMs - lastModifiedMs < 30 s`, then minutes / hours / days. Pure
 * function — caller supplies `now` for deterministic tests.
 */
export function formatLastUpdated(
  lastModifiedMs: number | null,
  nowMs: number,
): string {
  if (lastModifiedMs === null || !Number.isFinite(lastModifiedMs)) {
    return 'updated time unknown';
  }
  const deltaMs = nowMs - lastModifiedMs;
  if (deltaMs < 0) return 'updated just now';
  if (deltaMs < 30_000) return 'updated just now';
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return 'updated <1 min ago';
  if (minutes === 1) return 'updated 1 min ago';
  if (minutes < 60) return `updated ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return 'updated 1 hr ago';
  if (hours < 24) return `updated ${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'updated 1 day ago' : `updated ${days} days ago`;
}

/**
 * Validate a SolarImageryResponse shape (used by both the panel and
 * sidecar parity tests to make sure the wire format does not drift).
 */
export function isSolarImageryResponse(x: unknown): x is SolarImageryResponse {
  if (!x || typeof x !== 'object') return false;
  const obj = x as Record<string, unknown>;
  if (typeof obj.asOf !== 'string') return false;
  const images = obj.images;
  if (!Array.isArray(images)) return false;
  return images.every((img) => isSolarImageryStatus(img));
}

function isSolarImageryStatus(x: unknown): x is SolarImageryStatus {
  if (!x || typeof x !== 'object') return false;
  const obj = x as Record<string, unknown>;
  return (
    isSolarImagerySlug(obj.slug)
    && typeof obj.label === 'string'
    && typeof obj.description === 'string'
    && typeof obj.proxyUrl === 'string'
    && (obj.lastModified === null || typeof obj.lastModified === 'string')
    && typeof obj.upstreamStatus === 'string'
  );
}

/** Build a default-status response (used when the renderer can't
 *  reach the sidecar — every image still renders, just without a
 *  fresh-time stamp). */
export function buildDefaultImageryResponse(nowIso: string): SolarImageryResponse {
  return {
    asOf: nowIso,
    images: SOLAR_IMAGERY_CATALOG.map((e) => ({
      slug: e.slug,
      label: e.label,
      description: e.description,
      proxyUrl: proxyPathForSlug(e.slug),
      lastModified: null,
      upstreamStatus: 'unknown',
    })),
  };
}
