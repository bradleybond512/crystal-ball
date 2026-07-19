import type { WebcamFeed } from './webcam-types';

/**
 * CAMNET / hazecam.net visibility-camera catalog.
 *
 * CAMNET (hazecam.net) is a NESCAUM-run public educational haze/visibility
 * camera network across the Northeast and Mid-Atlantic — several of the cameras
 * the AirNow "Web Cameras" directory points to. Each site publishes a live
 * full-frame snapshot at a stable URL (`/images/large/<site>_left.jpg`), so
 * unlike the AirNow partner programs (HTML galleries) these are real image
 * feeds. They are tagged `visibility` at the source so the smoke correlation
 * trigger and the panel's Visibility filter pick them up directly.
 *
 * The sidecar `/api/webcams/hazecam` route HEAD-validates each snapshot and
 * drops dead ones (some sites publish only certain views), so a retired camera
 * degrades to absent rather than a broken tile.
 */

export interface HazecamSite {
  site: string;
  name: string;
  lat: number;
  lon: number;
  region: 'Northeast' | 'Mid-Atlantic';
}

export const HAZECAM_ATTRIBUTION = 'CAMNET / hazecam.net (NESCAUM)';

/** Active CAMNET sites (coordinates are the well-known camera locations). */
export const HAZECAM_SITES: readonly HazecamSite[] = [
  { site: 'acadia', name: 'Acadia National Park, ME', lat: 44.377, lon: -68.261, region: 'Northeast' },
  { site: 'baltimore', name: 'Baltimore, MD', lat: 39.29, lon: -76.612, region: 'Mid-Atlantic' },
  { site: 'bluehill', name: 'Blue Hill Observatory, MA', lat: 42.212, lon: -71.114, region: 'Northeast' },
  { site: 'boston', name: 'Boston, MA', lat: 42.36, lon: -71.058, region: 'Northeast' },
  { site: 'brigantine', name: 'Brigantine (Forsythe NWR), NJ', lat: 39.464, lon: -74.448, region: 'Mid-Atlantic' },
  { site: 'burlington', name: 'Burlington, VT', lat: 44.476, lon: -73.212, region: 'Northeast' },
  { site: 'frostburg', name: 'Frostburg, MD', lat: 39.658, lon: -78.928, region: 'Mid-Atlantic' },
  { site: 'mtwash', name: 'Mount Washington, NH', lat: 44.27, lon: -71.303, region: 'Northeast' },
  { site: 'nyc', name: 'New York City, NY', lat: 40.713, lon: -74.006, region: 'Mid-Atlantic' },
];

/** Live snapshot URL for a CAMNET site (the wide left-view frame). */
export function hazecamSnapshotUrl(site: string): string {
  return `https://hazecam.net/images/large/${site}_left.jpg`;
}

/** Public camera page for a CAMNET site (link-out / provenance). */
export function hazecamPageUrl(site: string): string {
  return `https://hazecam.net/camsite.aspx?site=${site}`;
}

export function hazecamSiteToFeed(rec: HazecamSite): WebcamFeed {
  return {
    id: `HAZECAM:${rec.site}`,
    source: 'HAZECAM',
    name: `${rec.name} — visibility (CAMNET)`,
    lat: rec.lat,
    lon: rec.lon,
    snapshotUrl: hazecamSnapshotUrl(rec.site),
    refreshIntervalSec: 600,
    category: 'nature',
    metadata: {
      visibility: 'true',
      program: 'camnet',
      attribution: HAZECAM_ATTRIBUTION,
      region: rec.region,
      pageUrl: hazecamPageUrl(rec.site),
    },
    isOnline: true,
  };
}

export function hazecamCamsToFeeds(): WebcamFeed[] {
  return HAZECAM_SITES.map((r) => hazecamSiteToFeed(r));
}
