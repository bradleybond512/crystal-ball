import { getApiBaseUrl } from '@/services/runtime';
import type { WebcamCatalog, WebcamFeed, WebcamSource, WebcamSourceHealth } from './webcam-types';
import { annotateVisibility } from './airnow-visibility-catalog';

const FAVORITES_KEY = 'crystalball-webcam-favorites';
const CATALOG_TTL_MS = 5 * 60 * 1000;

let cache: { catalog: WebcamCatalog; ts: number } | null = null;

interface FetchOpts {
  sources?: WebcamSource[];
  category?: string;
  bbox?: { minLat: number; minLon: number; maxLat: number; maxLon: number };
  signal?: AbortSignal;
}

export function catalogFromResponse(data: {
  feeds?: WebcamFeed[];
  sourceHealth?: WebcamSourceHealth[];
  updatedAt?: number;
}): WebcamCatalog {
  // Tag the AirNow visibility cams (NPS haze webcams) so surfaces can filter
  // them and the smoke trigger can find them — pure, no new feeds.
  const feeds = annotateVisibility(Array.isArray(data.feeds) ? data.feeds : []);
  const bySource = feeds.reduce<Record<WebcamSource, WebcamFeed[]>>(
    (acc, feed) => {
      if (!acc[feed.source]) acc[feed.source] = [];
      acc[feed.source].push(feed);
      return acc;
    },
    {} as Record<WebcamSource, WebcamFeed[]>,
  );
  return {
    feeds,
    bySource,
    lastUpdated: (data.updatedAt ?? Math.floor(Date.now() / 1000)) * 1000,
    sourceHealth: Array.isArray(data.sourceHealth) ? data.sourceHealth : undefined,
  };
}

export async function fetchUnifiedWebcams(opts: FetchOpts = {}): Promise<WebcamCatalog> {
  if (cache && Date.now() - cache.ts < CATALOG_TTL_MS && !opts.sources && !opts.category && !opts.bbox) {
    return cache.catalog;
  }
  const params = new URLSearchParams();
  if (opts.sources?.length) params.set('source', opts.sources.join(','));
  if (opts.category) params.set('category', opts.category);
  if (opts.bbox) {
    params.set('bbox', `${opts.bbox.minLat},${opts.bbox.minLon},${opts.bbox.maxLat},${opts.bbox.maxLon}`);
  }
  const qs = params.toString();
  const suffix = qs ? `?${qs}` : '';
  const url = `${getApiBaseUrl()}/api/webcams${suffix}`;
  const res = await fetch(url, { signal: opts.signal ?? AbortSignal.timeout(30_000) });
  if (!res.ok) {
    if (cache) return cache.catalog;
    throw new Error(`Webcam catalog request failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { feeds?: WebcamFeed[]; sourceHealth?: WebcamSourceHealth[]; updatedAt?: number };
  const catalog = catalogFromResponse(data);
  if (!opts.sources && !opts.category && !opts.bbox) {
    cache = { catalog, ts: Date.now() };
  }
  return catalog;
}

export function getFavoriteIds(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function isFavorite(id: string): boolean {
  return getFavoriteIds().includes(id);
}

export function toggleFavorite(id: string): boolean {
  const current = getFavoriteIds();
  const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
  } catch {
    // ignore (private browsing / quota)
  }
  return next.includes(id);
}

export function clearWebcamCatalogCache(): void {
  cache = null;
}
