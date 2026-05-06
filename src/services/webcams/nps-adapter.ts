import type { WebcamFeed } from './webcam-types';

interface NpsImage {
  url?: string;
  altText?: string;
  caption?: string;
  credit?: string;
}

interface NpsRelatedPark {
  fullName?: string;
  parkCode?: string;
  states?: string;
}

interface NpsRawWebcam {
  id?: string;
  url?: string;
  title?: string;
  description?: string;
  status?: string;
  statusMessage?: string;
  isStreaming?: boolean | string;
  latitude?: string | number;
  longitude?: string | number;
  images?: NpsImage[];
  relatedParks?: NpsRelatedPark[];
  tags?: string[];
}

function parseLatLon(raw: string | number | undefined): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.length > 0) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function adaptNpsWebcam(raw: NpsRawWebcam): WebcamFeed | null {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.status && raw.status.toLowerCase() !== 'active') return null;
  const lat = parseLatLon(raw.latitude);
  const lon = parseLatLon(raw.longitude);
  if (lat === null || lon === null) return null;
  const snapshot = raw.images?.[0]?.url;
  if (typeof snapshot !== 'string' || snapshot.length === 0) return null;
  const id = raw.id ?? `${lat}-${lon}`;
  const park = raw.relatedParks?.[0];
  return {
    id: `NPS:${id}`,
    source: 'NPS',
    name: raw.title ?? park?.fullName ?? 'NPS Webcam',
    lat,
    lon,
    snapshotUrl: snapshot,
    refreshIntervalSec: 300,
    category: 'nature',
    metadata: {
      ...(park?.fullName ? { park: park.fullName } : {}),
      ...(park?.parkCode ? { parkCode: park.parkCode } : {}),
      ...(park?.states ? { states: park.states } : {}),
      ...(raw.description ? { description: raw.description } : {}),
    },
    isOnline: true,
  };
}

export function adaptNpsResponse(payload: unknown): WebcamFeed[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = (payload as { data?: unknown }).data;
  const items = Array.isArray(data) ? data : [];
  const out: WebcamFeed[] = [];
  for (const item of items) {
    const f = adaptNpsWebcam(item as NpsRawWebcam);
    if (f) out.push(f);
  }
  return out;
}
