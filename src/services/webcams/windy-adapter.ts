import type { WebcamFeed } from './webcam-types';

interface WindyImage {
  preview?: string;
  thumbnail?: string;
}

interface WindyImagesEnvelope {
  current?: WindyImage;
  daylight?: WindyImage;
}

interface WindyPlayerSize {
  embed?: string;
}

interface WindyPlayer {
  day?: WindyPlayerSize;
  full?: WindyPlayerSize;
}

interface WindyLocation {
  latitude?: number;
  longitude?: number;
  city?: string;
  region?: string;
  country?: string;
  countryCode?: string;
}

interface WindyRawWebcam {
  webcamId?: number | string;
  id?: number | string;
  title?: string;
  status?: string;
  images?: WindyImagesEnvelope;
  location?: WindyLocation;
  player?: WindyPlayer;
  lastUpdatedOn?: string;
  categories?: { id?: string; name?: string }[];
}

function categorizeWindy(raw: WindyRawWebcam): WebcamFeed['category'] {
  const cats = (raw.categories ?? []).map((c) => (c.name ?? c.id ?? '').toLowerCase());
  if (cats.some((c) => c.includes('mount') || c.includes('national') || c.includes('park') || c.includes('beach') || c.includes('island')))
    return 'nature';
  if (cats.some((c) => c.includes('marine') || c.includes('harbor') || c.includes('port') || c.includes('coast')))
    return 'coastal';
  if (cats.some((c) => c.includes('traffic') || c.includes('highway') || c.includes('road')))
    return 'traffic';
  return 'weather';
}

export function adaptWindyWebcam(raw: WindyRawWebcam): WebcamFeed | null {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.status && raw.status !== 'active') return null;
  const id = String(raw.webcamId ?? raw.id ?? '');
  if (!id) return null;
  const lat = raw.location?.latitude;
  const lon = raw.location?.longitude;
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const snapshot = raw.images?.current?.preview ?? raw.images?.daylight?.preview ?? raw.images?.current?.thumbnail;
  if (typeof snapshot !== 'string' || snapshot.length === 0) return null;
  const stream = raw.player?.day?.embed ?? raw.player?.full?.embed;
  return {
    id: `WINDY:${id}`,
    source: 'WINDY',
    name: raw.title ?? `Windy ${id}`,
    lat,
    lon,
    snapshotUrl: snapshot,
    streamUrl: typeof stream === 'string' && stream.length > 0 ? stream : undefined,
    refreshIntervalSec: 600,
    category: categorizeWindy(raw),
    metadata: {
      ...(raw.location?.city ? { city: raw.location.city } : {}),
      ...(raw.location?.country ? { country: raw.location.country } : {}),
      ...(raw.location?.countryCode ? { countryCode: raw.location.countryCode } : {}),
      ...(raw.location?.region ? { region: raw.location.region } : {}),
      ...(raw.lastUpdatedOn ? { lastUpdatedOn: raw.lastUpdatedOn } : {}),
    },
    isOnline: true,
    lastChecked: raw.lastUpdatedOn ? Date.parse(raw.lastUpdatedOn) || undefined : undefined,
  };
}

export function adaptWindyResponse(payload: unknown): WebcamFeed[] {
  if (!payload || typeof payload !== 'object') return [];
  const items = (payload as { webcams?: unknown[] }).webcams;
  if (!Array.isArray(items)) return [];
  const out: WebcamFeed[] = [];
  for (const item of items) {
    const f = adaptWindyWebcam(item as WindyRawWebcam);
    if (f) out.push(f);
  }
  return out;
}
