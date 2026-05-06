import type { WebcamCatalog, WebcamCategory, WebcamFeed } from './webcam-types';

const EARTH_RADIUS_KM = 6371.0088;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

export interface NearestOptions {
  maxResults?: number;
}

export class WebcamSpatialIndex {
  private readonly feeds: readonly WebcamFeed[];

  constructor(catalog: WebcamCatalog | { feeds: WebcamFeed[] }) {
    this.feeds = Array.isArray(catalog?.feeds) ? [...catalog.feeds] : [];
  }

  size(): number {
    return this.feeds.length;
  }

  nearest(lat: number, lon: number, radiusKm: number, opts: NearestOptions = {}): WebcamFeed[] {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radiusKm)) return [];
    if (radiusKm <= 0) return [];
    const maxResults = opts.maxResults ?? 50;
    const scored: { feed: WebcamFeed; km: number }[] = [];
    for (const f of this.feeds) {
      if (!Number.isFinite(f.lat) || !Number.isFinite(f.lon)) continue;
      const km = haversineKm(lat, lon, f.lat, f.lon);
      if (km <= radiusKm) scored.push({ feed: f, km });
    }
    scored.sort((a, b) => a.km - b.km);
    return scored.slice(0, maxResults).map((s) => s.feed);
  }

  inBbox(minLat: number, minLon: number, maxLat: number, maxLon: number): WebcamFeed[] {
    return this.feeds.filter(
      (f) => f.lat >= minLat && f.lat <= maxLat && f.lon >= minLon && f.lon <= maxLon,
    );
  }

  byCategory(category: WebcamCategory): WebcamFeed[] {
    return this.feeds.filter((f) => f.category === category);
  }

  all(): readonly WebcamFeed[] {
    return this.feeds;
  }
}
