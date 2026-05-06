import type { WebcamCategory, WebcamFeed } from './webcam-types';

export const CATEGORY_MARKER_COLOR: Record<WebcamCategory, string> = {
  fire: '#f85149',
  volcano: '#bc8cff',
  weather: '#56d4dd',
  coastal: '#3fb950',
  stream: '#1f6feb',
  traffic: '#d29922',
  nature: '#7ee787',
};

export interface MapBounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export function computeBoundsForFeeds(feeds: readonly WebcamFeed[]): MapBounds | null {
  if (feeds.length === 0) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const f of feeds) {
    if (!Number.isFinite(f.lat) || !Number.isFinite(f.lon)) continue;
    if (f.lat < minLat) minLat = f.lat;
    if (f.lat > maxLat) maxLat = f.lat;
    if (f.lon < minLon) minLon = f.lon;
    if (f.lon > maxLon) maxLon = f.lon;
  }
  if (!Number.isFinite(minLat)) return null;
  return { minLat, maxLat, minLon, maxLon };
}

export interface SvgPoint {
  x: number;
  y: number;
}

export interface ProjectionViewport {
  width: number;
  height: number;
  bounds: MapBounds;
  paddingPx: number;
}

/** Equirectangular projection — simple, fast, works for clustered views.
 *  Returns pixel coords inside the viewport, with a constant pixel padding. */
export function projectEquirectangular(
  lat: number,
  lon: number,
  vp: ProjectionViewport,
): SvgPoint {
  const { width, height, bounds, paddingPx } = vp;
  const usableW = Math.max(width - paddingPx * 2, 1);
  const usableH = Math.max(height - paddingPx * 2, 1);
  const lonSpan = Math.max(bounds.maxLon - bounds.minLon, 0.0001);
  const latSpan = Math.max(bounds.maxLat - bounds.minLat, 0.0001);
  const x = paddingPx + ((lon - bounds.minLon) / lonSpan) * usableW;
  const y = paddingPx + (1 - (lat - bounds.minLat) / latSpan) * usableH;
  return { x, y };
}

// ── Snapshot to local download ──────────────────────────────────────────

export type SnapshotResult =
  | { ok: true; filename: string }
  | { ok: false; reason: string };

/** Returns the canonical Downloads filename for a snapshot. */
export function buildSnapshotFilename(camName: string, now: number = Date.now()): string {
  let safe = camName.replace(/[^a-zA-Z0-9]+/g, '-');
  while (safe.startsWith('-')) safe = safe.slice(1);
  while (safe.endsWith('-')) safe = safe.slice(0, -1);
  safe = safe.slice(0, 60) || 'cam';
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `crystalball-cam-${safe}-${stamp}.jpg`;
}

// ── Offline probe ────────────────────────────────────────────────────────

export type OfflineStatus = 'online' | 'offline' | 'unknown';

export interface OfflineProbeResult {
  feedId: string;
  status: OfflineStatus;
  checkedAt: number;
  httpStatus?: number;
  error?: string;
}

/** Decide a feed's online/offline status from a probe response or error.
 *  Pure: no network, no DOM. The HTTP layer is in the caller. */
export function decideOfflineStatus(input: {
  responseStatus?: number;
  errorName?: string;
  timedOut?: boolean;
}): OfflineStatus {
  if (input.timedOut) return 'offline';
  if (input.errorName === 'AbortError') return 'offline';
  if (input.errorName) return 'unknown';
  if (typeof input.responseStatus !== 'number') return 'unknown';
  if (input.responseStatus >= 200 && input.responseStatus < 400) return 'online';
  if (input.responseStatus >= 400) return 'offline';
  return 'unknown';
}

export const OFFLINE_PROBE_TIMEOUT_MS = 8000;
export const OFFLINE_REPROBE_INTERVAL_MS = 5 * 60 * 1000;
