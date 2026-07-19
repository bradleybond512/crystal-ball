import type {
  WebcamCatalog,
  WebcamCategory,
  WebcamFeed,
  WebcamSource,
} from './webcam-types';

const DEDUPE_DEGREE_TOLERANCE = 0.01;

const CATEGORY_ORDER: Record<WebcamCategory, number> = {
  fire: 0,
  volcano: 1,
  weather: 2,
  coastal: 3,
  stream: 4,
  traffic: 5,
  nature: 6,
};

const ALL_SOURCES: WebcamSource[] = [
  'FAA',
  'DOT511',
  'USGS_VOLCANO',
  'NPS',
  'ALERTWILDFIRE',
  'WINDY',
  'USFS',
  'USGS_STREAM',
  'NOAA_COASTAL',
  'CALTRANS',
  'TFL',
  'SINGAPORE',
  'HAZECAM',
];

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isWithinTolerance(a: number, b: number): boolean {
  return Math.abs(a - b) <= DEDUPE_DEGREE_TOLERANCE;
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function isValidFeed(feed: unknown): feed is WebcamFeed {
  if (!feed || typeof feed !== 'object') return false;
  const f = feed as Partial<WebcamFeed>;
  return (
    typeof f.id === 'string' &&
    f.id.length > 0 &&
    typeof f.name === 'string' &&
    typeof f.snapshotUrl === 'string' &&
    isFiniteNumber(f.lat) &&
    isFiniteNumber(f.lon)
  );
}

export function dedupeFeeds(feeds: WebcamFeed[]): WebcamFeed[] {
  const out: WebcamFeed[] = [];
  for (const feed of feeds) {
    const dup = out.find(
      (existing) =>
        normalizeName(existing.name) === normalizeName(feed.name) &&
        isWithinTolerance(existing.lat, feed.lat) &&
        isWithinTolerance(existing.lon, feed.lon),
    );
    if (!dup) {
      out.push(feed);
      continue;
    }
    if (
      (feed.lastChecked ?? 0) > (dup.lastChecked ?? 0) ||
      (feed.isOnline === true && dup.isOnline !== true)
    ) {
      const idx = out.indexOf(dup);
      out[idx] = feed;
    }
  }
  return out;
}

export function sortFeeds(feeds: WebcamFeed[]): WebcamFeed[] {
  return [...feeds].sort((a, b) => {
    const ca = CATEGORY_ORDER[a.category] ?? 99;
    const cb = CATEGORY_ORDER[b.category] ?? 99;
    if (ca !== cb) return ca - cb;
    return a.name.localeCompare(b.name, 'en');
  });
}

export function aggregateWebcams(
  sourceArrays: readonly (readonly WebcamFeed[] | null | undefined)[],
  now: number = Date.now(),
): WebcamCatalog {
  const merged: WebcamFeed[] = [];
  for (const arr of sourceArrays) {
    if (!Array.isArray(arr)) continue;
    for (const feed of arr) if (isValidFeed(feed)) merged.push(feed);
  }

  const deduped = dedupeFeeds(merged);
  const sorted = sortFeeds(deduped);

  const bySource = ALL_SOURCES.reduce<Record<WebcamSource, WebcamFeed[]>>(
    (acc, src) => {
      acc[src] = [];
      return acc;
    },
    {} as Record<WebcamSource, WebcamFeed[]>,
  );
  for (const feed of sorted) bySource[feed.source].push(feed);

  return { feeds: sorted, bySource, lastUpdated: now };
}

export function filterByBoundingBox(
  feeds: WebcamFeed[],
  bbox: { minLat: number; minLon: number; maxLat: number; maxLon: number },
): WebcamFeed[] {
  return feeds.filter(
    (f) =>
      f.lat >= bbox.minLat &&
      f.lat <= bbox.maxLat &&
      f.lon >= bbox.minLon &&
      f.lon <= bbox.maxLon,
  );
}
