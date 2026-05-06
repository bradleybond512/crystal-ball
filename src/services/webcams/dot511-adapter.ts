import type { WebcamFeed } from './webcam-types';

export type DotState = 'CA' | 'NY' | 'WA' | 'CO' | 'FL';

export interface RawDotCam {
  id: string;
  title: string;
  state: string;
  lat: number;
  lon: number;
  imageUrl: string;
  direction?: string;
  route?: string;
}

function isFiniteCoord(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n !== 0;
}

export function adaptDotCam(raw: RawDotCam): WebcamFeed | null {
  if (!raw || typeof raw !== 'object') return null;
  if (!raw.id || !raw.imageUrl) return null;
  if (!isFiniteCoord(raw.lat) || !isFiniteCoord(raw.lon)) return null;
  return {
    id: raw.id.startsWith('DOT:') ? raw.id : `DOT:${raw.state}:${raw.id}`,
    source: 'DOT511',
    name: raw.title || `${raw.state} Camera`,
    lat: raw.lat,
    lon: raw.lon,
    snapshotUrl: raw.imageUrl,
    refreshIntervalSec: 60,
    category: 'traffic',
    metadata: {
      state: String(raw.state),
      ...(raw.direction ? { direction: raw.direction } : {}),
      ...(raw.route ? { route: raw.route } : {}),
    },
  };
}

export function adaptDotCams(raws: RawDotCam[]): WebcamFeed[] {
  if (!Array.isArray(raws)) return [];
  const out: WebcamFeed[] = [];
  for (const raw of raws) {
    const f = adaptDotCam(raw);
    if (f) out.push(f);
  }
  return out;
}

interface WaRaw {
  CameraID?: number | string;
  Title?: string;
  CameraLocation?: { Latitude?: number; Longitude?: number; RoadName?: string; Direction?: string };
  ImageURL?: string;
  IsActive?: boolean;
  DisplayLatitude?: number;
  DisplayLongitude?: number;
}

export function parseWaCameras(payload: unknown): RawDotCam[] {
  const items = Array.isArray(payload) ? payload : [];
  const out: RawDotCam[] = [];
  for (const c of items as WaRaw[]) {
    if (!c || typeof c !== 'object') continue;
    if (c.IsActive === false) continue;
    const lat = c.CameraLocation?.Latitude ?? c.DisplayLatitude;
    const lon = c.CameraLocation?.Longitude ?? c.DisplayLongitude;
    if (!isFiniteCoord(lat) || !isFiniteCoord(lon)) continue;
    if (typeof c.ImageURL !== 'string' || c.ImageURL.length === 0) continue;
    out.push({
      id: String(c.CameraID ?? `${lat}-${lon}`),
      title: String(c.Title ?? c.CameraLocation?.RoadName ?? 'WA Camera'),
      state: 'WA',
      lat,
      lon,
      imageUrl: c.ImageURL,
      direction: c.CameraLocation?.Direction,
      route: c.CameraLocation?.RoadName,
    });
  }
  return out;
}

interface CoRaw {
  id?: string | number;
  description?: string;
  name?: string;
  latitude?: number;
  longitude?: number;
  imageURL?: string;
  imageUrl?: string;
  routeName?: string;
}

function pickCoItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const obj = payload as { features?: unknown[]; cameras?: unknown[] } | null;
  if (Array.isArray(obj?.features)) return obj.features;
  if (Array.isArray(obj?.cameras)) return obj.cameras;
  return [];
}

export function parseCoCameras(payload: unknown): RawDotCam[] {
  const items = pickCoItems(payload);
  const out: RawDotCam[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const c = (
      'properties' in item ? (item as { properties: CoRaw }).properties : (item as CoRaw)
    );
    const geometry = (item as { geometry?: { coordinates?: [number, number] } }).geometry;
    const lat = c.latitude ?? geometry?.coordinates?.[1];
    const lon = c.longitude ?? geometry?.coordinates?.[0];
    if (!isFiniteCoord(lat) || !isFiniteCoord(lon)) continue;
    const url = c.imageURL ?? c.imageUrl;
    if (typeof url !== 'string' || url.length === 0) continue;
    out.push({
      id: String(c.id ?? `${lat}-${lon}`),
      title: String(c.description ?? c.name ?? 'CO Camera'),
      state: 'CO',
      lat,
      lon,
      imageUrl: url,
      route: c.routeName,
    });
  }
  return out;
}

interface FlRaw {
  Id?: string | number;
  id?: string | number;
  Description?: string;
  description?: string;
  Latitude?: number;
  latitude?: number;
  Longitude?: number;
  longitude?: number;
  Url?: string;
  url?: string;
  ImageUrl?: string;
  imageUrl?: string;
  Roadway?: string;
  roadway?: string;
}

function pickFlItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const obj = payload as { cameras?: unknown[] } | null;
  if (Array.isArray(obj?.cameras)) return obj.cameras;
  return [];
}

export function parseFlCameras(payload: unknown): RawDotCam[] {
  const items = pickFlItems(payload);
  const out: RawDotCam[] = [];
  for (const c of items as FlRaw[]) {
    if (!c || typeof c !== 'object') continue;
    const lat = c.Latitude ?? c.latitude;
    const lon = c.Longitude ?? c.longitude;
    if (!isFiniteCoord(lat) || !isFiniteCoord(lon)) continue;
    const url = c.ImageUrl ?? c.imageUrl ?? c.Url ?? c.url;
    if (typeof url !== 'string' || url.length === 0) continue;
    out.push({
      id: String(c.Id ?? c.id ?? `${lat}-${lon}`),
      title: String(c.Description ?? c.description ?? 'FL Camera'),
      state: 'FL',
      lat,
      lon,
      imageUrl: url,
      route: c.Roadway ?? c.roadway,
    });
  }
  return out;
}
