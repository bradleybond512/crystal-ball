import type { WebcamFeed } from './webcam-types';

interface AwfRawCamera {
  name?: string;
  longitude?: number;
  latitude?: number;
  position?: { latitude?: number; longitude?: number };
  state?: string;
  region?: string;
  active?: boolean;
  status?: string;
  imageUrl?: string;
  image_url?: string;
  streamUrl?: string;
  stream_url?: string;
  hd_video?: string;
  ptz?: boolean;
}

function isFiniteCoord(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n !== 0;
}

export function adaptAlertWildfireCamera(raw: AwfRawCamera): WebcamFeed | null {
  if (!raw || typeof raw !== 'object') return null;
  const status = raw.status?.toLowerCase();
  if (raw.active === false) return null;
  if (status === 'inactive' || status === 'down' || status === 'offline') return null;
  const lat = raw.latitude ?? raw.position?.latitude;
  const lon = raw.longitude ?? raw.position?.longitude;
  if (!isFiniteCoord(lat) || !isFiniteCoord(lon)) return null;
  const name = raw.name ?? '';
  if (!name) return null;
  const snapshot = raw.imageUrl ?? raw.image_url;
  const stream = raw.streamUrl ?? raw.stream_url ?? raw.hd_video;
  const finalSnapshot = snapshot ?? `https://cameras.alertwildfire.org/cameras/${encodeURIComponent(name)}/latest-frame.jpg`;
  return {
    id: `ALERTWILDFIRE:${name}`,
    source: 'ALERTWILDFIRE',
    name,
    lat,
    lon,
    snapshotUrl: finalSnapshot,
    streamUrl: typeof stream === 'string' && stream.length > 0 ? stream : undefined,
    refreshIntervalSec: 60,
    category: 'fire',
    metadata: {
      ...(raw.state ? { state: raw.state } : {}),
      ...(raw.region ? { region: raw.region } : {}),
      ...(raw.ptz ? { ptz: 'true' } : {}),
    },
    isOnline: true,
  };
}

function pickAwfItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const obj = payload as { cameras?: unknown[]; data?: unknown[]; features?: unknown[] };
  if (Array.isArray(obj.cameras)) return obj.cameras;
  if (Array.isArray(obj.data)) return obj.data;
  if (Array.isArray(obj.features)) return obj.features;
  return [];
}

function flattenAwfFeature(item: unknown): AwfRawCamera {
  if (!item || typeof item !== 'object' || !('properties' in item)) {
    return item as AwfRawCamera;
  }
  const props = (item as { properties?: AwfRawCamera }).properties ?? {};
  const geom = (item as { geometry?: { coordinates?: [number, number] } }).geometry;
  return {
    ...props,
    ...(geom?.coordinates
      ? { longitude: geom.coordinates[0], latitude: geom.coordinates[1] }
      : {}),
  };
}

export function adaptAlertWildfireResponse(payload: unknown): WebcamFeed[] {
  const items = pickAwfItems(payload);
  const out: WebcamFeed[] = [];
  for (const item of items) {
    const f = adaptAlertWildfireCamera(flattenAwfFeature(item));
    if (f) out.push(f);
  }
  return out;
}
