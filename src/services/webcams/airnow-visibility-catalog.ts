import type { WebcamFeed } from './webcam-types';

/**
 * AirNow visibility-camera catalog.
 *
 * The AirNow "Web Cameras" page (airnow.gov/resources/web-cams) is a curated
 * directory of partner haze/visibility cameras, not a live feed. The bulk are
 * National Park Service air-quality webcams that Crystal Ball already ingests
 * through the NPS Data API adapter (tagged generic `nature`). This catalog does
 * two things without duplicating those feeds:
 *
 *   1. `annotateVisibility()` tags the already-ingested NPS cams whose park is
 *      on the AirNow visibility list with `metadata.visibility='true'` so any
 *      surface can filter "haze cams" and the smoke trigger can find them.
 *   2. `AIRNOW_VISIBILITY_PROGRAMS` lists the non-NPS partner programs (state
 *      DEQ / university cams). Those publish HTML gallery pages with no stable
 *      direct-snapshot URL, so they are honest link-outs — surfaced as links and
 *      considered by the smoke correlation via their coordinates, never rendered
 *      as (broken) image tiles.
 */

/** NPS park codes on the AirNow visibility-camera list (canonical NPS Data API
 *  `parkCode`s; Great Smoky's two AirNow sites both map to `grsm`). */
export const NPS_VISIBILITY_PARKCODES: ReadonlySet<string> = new Set([
  'dena', 'grca', 'jotr', 'pore', 'seki', 'yose', 'wash', 'maca',
  'acad', 'grsm', 'thro', 'bibe', 'mora', 'noca', 'olym', 'glac',
]);

export interface AirnowVisibilityProgram {
  id: string;
  name: string;
  agency: string;
  /** External program page (HTML gallery) — a link-out, not a snapshot URL. */
  pageUrl: string;
  lat: number;
  lon: number;
  region?: string;
}

/** Non-NPS partner visibility-camera programs from the AirNow directory. */
export const AIRNOW_VISIBILITY_PROGRAMS: readonly AirnowVisibilityProgram[] = [
  { id: 'pima-tucson', name: 'Tucson', agency: 'Pima County DEQ', pageUrl: 'https://airinfonow.pima.gov/html/pics-deq123.html', lat: 32.221, lon: -110.926, region: 'Arizona' },
  { id: 'idaho-dietrich-butte', name: 'Dietrich Butte', agency: 'Idaho DEQ', pageUrl: 'https://www.deq.idaho.gov/air-quality/air-quality-index/visibility-cameras/', lat: 43.606, lon: -114.36, region: 'Idaho' },
  { id: 'usu-cache', name: 'Cache County', agency: 'Utah State University', pageUrl: 'https://www.usu.edu/webcams/', lat: 41.74, lon: -111.81, region: 'Utah' },
  { id: 'moosehorn-nwr', name: 'Moosehorn NWR', agency: 'US Fish & Wildlife Service', pageUrl: 'https://www.windy.com/-Webcams/United-States/Maine/Meddybemps/Moosehorn-National-Wildlife-Refuge/webcams/1281968940', lat: 45.011, lon: -67.28, region: 'Maine' },
];
// AirNow also lists a UMPI/Presque Isle cam (crownofmaine.com), omitted here: it
// serves http-only and the host is currently unreachable, so it can neither be
// opened via the https-only safe-open path nor verified live.

/** The NPS `parkCode` of a feed, lower-cased, or null if it is not an NPS cam. */
export function visibilityParkCodeOf(feed: WebcamFeed): string | null {
  if (feed.source !== 'NPS') return null;
  const code = feed.metadata?.parkCode;
  return typeof code === 'string' && code.length > 0 ? code.toLowerCase() : null;
}

/** True once a feed has been tagged as an AirNow visibility camera. */
export function isVisibilityCam(feed: WebcamFeed): boolean {
  return feed.metadata?.visibility === 'true';
}

/**
 * Pure: return feeds with the AirNow visibility cameras tagged. NPS feeds whose
 * park is on the visibility list gain `metadata.visibility='true'` +
 * `metadata.program='airnow'`; every other feed is returned unchanged (same
 * object reference, so callers can rely on identity for untouched feeds).
 */
export function annotateVisibility(feeds: readonly WebcamFeed[]): WebcamFeed[] {
  return feeds.map((feed) => {
    const parkCode = visibilityParkCodeOf(feed);
    if (parkCode === null || !NPS_VISIBILITY_PARKCODES.has(parkCode)) return feed;
    if (feed.metadata?.visibility === 'true') return feed;
    return {
      ...feed,
      metadata: { ...feed.metadata, visibility: 'true', program: 'airnow' },
    };
  });
}
