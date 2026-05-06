import type { WebcamFeed } from '../webcam-types';

export type ExtendedDotJurisdiction =
  | 'OH'
  | 'AZ'
  | 'ID'
  | 'GA'
  | 'OR'
  | 'NC'
  | 'NSW'
  | 'UK'
  | 'ROAD511';

export interface ExtendedDotAdapterResult {
  feeds: WebcamFeed[];
  requiresKey?: boolean;
  keySource?: string;
  isPaid?: boolean;
  disabled?: boolean;
  message?: string;
}

function isFiniteCoord(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n !== 0;
}

function pickArray(payload: unknown, keys: readonly string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    for (const key of keys) {
      const v = (payload as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

function buildFeed(opts: {
  source: 'DOT511';
  idPrefix: string;
  rawId: string | number | null | undefined;
  name: string;
  lat: unknown;
  lon: unknown;
  snapshotUrl: unknown;
  streamUrl?: unknown;
  metadata: Record<string, string>;
}): WebcamFeed | null {
  if (!isFiniteCoord(opts.lat) || !isFiniteCoord(opts.lon)) return null;
  if (typeof opts.snapshotUrl !== 'string' || opts.snapshotUrl.length === 0) return null;
  const id = String(opts.rawId ?? `${opts.lat}-${opts.lon}`);
  const stream =
    typeof opts.streamUrl === 'string' && opts.streamUrl.length > 0 ? opts.streamUrl : undefined;
  return {
    id: `${opts.idPrefix}:${id}`,
    source: opts.source,
    name: opts.name || 'Camera',
    lat: opts.lat,
    lon: opts.lon,
    snapshotUrl: opts.snapshotUrl,
    ...(stream ? { streamUrl: stream } : {}),
    refreshIntervalSec: 300,
    category: 'traffic',
    metadata: opts.metadata,
  };
}

// ── Ohio OHGO ────────────────────────────────────────────────────────────

interface OhgoRaw {
  id?: string | number;
  location?: { latitude?: number; longitude?: number; description?: string };
  imageUrl?: string;
  isActive?: boolean;
}

export function parseOhgoCameras(payload: unknown): WebcamFeed[] {
  const items = pickArray(payload, ['cameras', 'results', 'data']);
  const out: WebcamFeed[] = [];
  for (const c of items as OhgoRaw[]) {
    if (!c || typeof c !== 'object') continue;
    if (c.isActive === false) continue;
    const feed = buildFeed({
      source: 'DOT511',
      idPrefix: 'DOT:OH',
      rawId: c.id,
      name: c.location?.description ?? 'OH Camera',
      lat: c.location?.latitude,
      lon: c.location?.longitude,
      snapshotUrl: c.imageUrl,
      metadata: { state: 'OH', jurisdiction: 'OH' },
    });
    if (feed) out.push(feed);
  }
  return out;
}

// ── ibi511 platform (AZ/ID/GA — same shape as WSDOT WA) ─────────────────

interface Ibi511Raw {
  Id?: string | number;
  CameraID?: string | number;
  Title?: string;
  Description?: string;
  Latitude?: number;
  Longitude?: number;
  CameraLocation?: { Latitude?: number; Longitude?: number; RoadName?: string; Direction?: string };
  ImageURL?: string;
  ImageUrl?: string;
  IsActive?: boolean;
}

function parseIbi511(state: 'AZ' | 'ID' | 'GA', payload: unknown): WebcamFeed[] {
  const items = pickArray(payload, ['cameras', 'features', 'data']);
  const out: WebcamFeed[] = [];
  for (const c of items as Ibi511Raw[]) {
    if (!c || typeof c !== 'object') continue;
    if (c.IsActive === false) continue;
    const lat = c.CameraLocation?.Latitude ?? c.Latitude;
    const lon = c.CameraLocation?.Longitude ?? c.Longitude;
    const url = c.ImageURL ?? c.ImageUrl;
    const feed = buildFeed({
      source: 'DOT511',
      idPrefix: `DOT:${state}`,
      rawId: c.Id ?? c.CameraID,
      name: c.Title ?? c.Description ?? c.CameraLocation?.RoadName ?? `${state} Camera`,
      lat,
      lon,
      snapshotUrl: url,
      metadata: {
        state,
        jurisdiction: state,
        ...(c.CameraLocation?.RoadName ? { route: c.CameraLocation.RoadName } : {}),
        ...(c.CameraLocation?.Direction ? { direction: c.CameraLocation.Direction } : {}),
      },
    });
    if (feed) out.push(feed);
  }
  return out;
}

export function parseAzCameras(payload: unknown): WebcamFeed[] {
  return parseIbi511('AZ', payload);
}
export function parseIdCameras(payload: unknown): WebcamFeed[] {
  return parseIbi511('ID', payload);
}
export function parseGaCameras(payload: unknown): WebcamFeed[] {
  return parseIbi511('GA', payload);
}

// ── Oregon TripCheck ────────────────────────────────────────────────────

interface OregonRaw {
  camId?: string | number;
  latitude?: number;
  longitude?: number;
  streamUrl?: string;
  imageUrl?: string;
  name?: string;
  direction?: string;
}

export function parseOregonCameras(payload: unknown): WebcamFeed[] {
  const items = pickArray(payload, ['cameras', 'data']);
  const out: WebcamFeed[] = [];
  for (const c of items as OregonRaw[]) {
    if (!c || typeof c !== 'object') continue;
    const url = c.streamUrl ?? c.imageUrl;
    const feed = buildFeed({
      source: 'DOT511',
      idPrefix: 'DOT:OR',
      rawId: c.camId,
      name: c.name ?? 'OR Camera',
      lat: c.latitude,
      lon: c.longitude,
      snapshotUrl: url,
      metadata: {
        state: 'OR',
        jurisdiction: 'OR',
        ...(c.direction ? { direction: c.direction } : {}),
      },
    });
    if (feed) out.push(feed);
  }
  return out;
}

// ── North Carolina NCDOT (ArcGIS GeoJSON) ───────────────────────────────

interface NcArcgisFeature {
  properties?: {
    CAMERA_ID?: string | number;
    LOCATION_DESCRIPTION?: string;
    IMAGE_URL?: string;
    ROUTE?: string;
  };
  geometry?: { coordinates?: [number, number] };
}

export function parseNcCameras(payload: unknown): WebcamFeed[] {
  const items = pickArray(payload, ['features']);
  const out: WebcamFeed[] = [];
  for (const f of items as NcArcgisFeature[]) {
    if (!f || typeof f !== 'object') continue;
    const props = f.properties ?? {};
    const coords = f.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const feed = buildFeed({
      source: 'DOT511',
      idPrefix: 'DOT:NC',
      rawId: props.CAMERA_ID,
      name: props.LOCATION_DESCRIPTION ?? 'NC Camera',
      lat: coords[1],
      lon: coords[0],
      snapshotUrl: props.IMAGE_URL,
      metadata: {
        state: 'NC',
        jurisdiction: 'NC',
        ...(props.ROUTE ? { route: props.ROUTE } : {}),
      },
    });
    if (feed) out.push(feed);
  }
  return out;
}

// ── Transport for NSW (Australia) ───────────────────────────────────────

interface NswFeature {
  properties?: { href?: string; title?: string; direction?: string; region?: string };
  geometry?: { coordinates?: [number, number] };
}

export function parseNswCameras(payload: unknown): WebcamFeed[] {
  const items = pickArray(payload, ['features']);
  const out: WebcamFeed[] = [];
  for (const f of items as NswFeature[]) {
    if (!f || typeof f !== 'object') continue;
    const props = f.properties ?? {};
    const coords = f.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const feed = buildFeed({
      source: 'DOT511',
      idPrefix: 'DOT:NSW',
      rawId: props.title ?? `${coords[1]}-${coords[0]}`,
      name: props.title ?? 'NSW Camera',
      lat: coords[1],
      lon: coords[0],
      snapshotUrl: props.href,
      metadata: {
        country: 'AU',
        jurisdiction: 'NSW',
        ...(props.region ? { region: props.region } : {}),
        ...(props.direction ? { direction: props.direction } : {}),
      },
    });
    if (feed) out.push(feed);
  }
  return out;
}

// ── UK National Highways ────────────────────────────────────────────────

interface UkRaw {
  id?: string | number;
  name?: string;
  coordinates?: { latitude?: number; longitude?: number };
  imageUrl?: string;
  active?: boolean;
  road?: string;
}

export function parseUkCameras(payload: unknown): WebcamFeed[] {
  const items = pickArray(payload, ['cameras', 'data']);
  const out: WebcamFeed[] = [];
  for (const c of items as UkRaw[]) {
    if (!c || typeof c !== 'object') continue;
    if (c.active === false) continue;
    const feed = buildFeed({
      source: 'DOT511',
      idPrefix: 'DOT:UK',
      rawId: c.id,
      name: c.name ?? 'UK Highways Camera',
      lat: c.coordinates?.latitude,
      lon: c.coordinates?.longitude,
      snapshotUrl: c.imageUrl,
      metadata: {
        country: 'UK',
        jurisdiction: 'UK',
        ...(c.road ? { route: c.road } : {}),
      },
    });
    if (feed) out.push(feed);
  }
  return out;
}

// ── Road511 (paid, multi-jurisdiction) ──────────────────────────────────

interface Road511Raw {
  id?: string | number;
  cameraId?: string | number;
  name?: string;
  jurisdiction?: string;
  lat?: number;
  latitude?: number;
  lon?: number;
  longitude?: number;
  imageUrl?: string;
  snapshotUrl?: string;
  route?: string;
  direction?: string;
}

export function parseRoad511Cameras(payload: unknown): WebcamFeed[] {
  const items = pickArray(payload, ['cameras', 'data', 'results']);
  const out: WebcamFeed[] = [];
  for (const c of items as Road511Raw[]) {
    if (!c || typeof c !== 'object') continue;
    const lat = c.lat ?? c.latitude;
    const lon = c.lon ?? c.longitude;
    const url = c.snapshotUrl ?? c.imageUrl;
    const jurisdiction = String(c.jurisdiction ?? 'UNK');
    const feed = buildFeed({
      source: 'DOT511',
      idPrefix: `DOT:${jurisdiction}`,
      rawId: c.id ?? c.cameraId,
      name: c.name ?? `${jurisdiction} Camera`,
      lat,
      lon,
      snapshotUrl: url,
      metadata: {
        state: jurisdiction,
        jurisdiction,
        provider: 'ROAD511',
        ...(c.route ? { route: c.route } : {}),
        ...(c.direction ? { direction: c.direction } : {}),
      },
    });
    if (feed) out.push(feed);
  }
  return out;
}

export const ROAD511_DISABLED_RESULT: ExtendedDotAdapterResult = {
  feeds: [],
  isPaid: true,
  disabled: true,
  message:
    'Road511 covers all 65 US/Canadian DOT jurisdictions (38,219 cameras). Subscribe at road511.com ($29/mo) then add ROAD511_API_KEY to settings.',
};

// ── Per-jurisdiction parser router ──────────────────────────────────────

export const JURISDICTION_PARSERS: Record<
  ExtendedDotJurisdiction,
  (payload: unknown) => WebcamFeed[]
> = {
  OH: parseOhgoCameras,
  AZ: parseAzCameras,
  ID: parseIdCameras,
  GA: parseGaCameras,
  OR: parseOregonCameras,
  NC: parseNcCameras,
  NSW: parseNswCameras,
  UK: parseUkCameras,
  ROAD511: parseRoad511Cameras,
};

export const NO_KEY_RESULT_NSW: ExtendedDotAdapterResult = {
  feeds: [],
  requiresKey: true,
  keySource: 'opendata.transport.nsw.gov.au',
};

export const NO_KEY_RESULT_UK: ExtendedDotAdapterResult = {
  feeds: [],
  requiresKey: true,
  keySource: 'developer.data.nationalhighways.co.uk',
};
