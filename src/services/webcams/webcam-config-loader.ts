import type { WebcamCategory, WebcamFeed, WebcamSource, WebcamStreamType } from './webcam-types';

/** A dotted-path string like "a.b.0.c" or a function that extracts a value from a row. */
export type Getter = string | ((row: unknown) => unknown);

/** A literal value or a function that derives it from a row. */
export type Derive<T> = T | ((row: unknown) => T);

export interface WebcamSourceConfig {
  id: WebcamSource;
  mode: 'json';
  url: string | string[];
  arrayPath?: string;
  map: {
    id: Getter;
    name: Getter;
    lat: Getter;
    lon: Getter;
    /** Path string or function — always resolved against the row, not used as a literal. */
    snapshotUrl: Getter;
    /** Path string or function — always resolved against the row. Omit if no stream. */
    streamUrl?: Getter;
    streamType?: Derive<WebcamStreamType | undefined>;
  };
  category: Derive<WebcamCategory>;
  refreshIntervalSec: number;
  onlineWhen?: (row: unknown) => boolean;
  headers?: Record<string, string>;
  snapshotTtlSec?: number;
  metadata?: Record<string, string>;
}

export function getPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    const idx = Number(part);
    cur = !Number.isNaN(idx) && Array.isArray(cur) ? (cur as unknown[])[idx] : (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function resolveGetter(getter: Getter, row: unknown): unknown {
  if (typeof getter === 'function') return getter(row);
  return getPath(row, getter);
}

function resolveDerive<T>(derive: Derive<T>, row: unknown): T {
  if (typeof derive === 'function') return (derive as (row: unknown) => T)(row);
  return derive;
}

function inferStreamType(streamUrl: string): WebcamStreamType {
  // Strip query/hash so tokenised stream URLs (…/stream.m3u8?token=…) still
  // classify by their real extension instead of falling back to snapshot.
  const path = streamUrl.split(/[?#]/, 1)[0] ?? streamUrl;
  if (path.endsWith('.m3u8')) return 'hls';
  if (streamUrl.includes('multipart') || path.endsWith('.mjpg') || path.endsWith('.mjpeg')) return 'mjpeg';
  return 'snapshot';
}

function isFiniteCoord(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function toCoord(raw: unknown): number {
  if (isFiniteCoord(raw)) return raw;
  return Number.parseFloat(typeof raw === 'string' ? raw : '');
}

function toStr(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number') return String(raw);
  return '';
}

function resolveRowArrayPath(payload: unknown, arrayPath: string | undefined): unknown[] {
  if (!arrayPath) {
    if (Array.isArray(payload)) return payload;
    return [];
  }
  const val = getPath(payload, arrayPath);
  return Array.isArray(val) ? val : [];
}

function resolveStreamFields(
  map: WebcamSourceConfig['map'],
  row: unknown,
): { streamUrl: string | undefined; streamType: WebcamStreamType | undefined } {
  let streamUrl: string | undefined;
  let streamType: WebcamStreamType | undefined;

  if (map.streamUrl) {
    const raw = resolveGetter(map.streamUrl, row);
    if (typeof raw === 'string' && raw.length > 0) streamUrl = raw;
  }

  if (map.streamType) {
    const raw = resolveDerive(map.streamType, row);
    if (raw) streamType = raw;
  } else if (streamUrl) {
    streamType = inferStreamType(streamUrl);
  } else {
    streamType = 'snapshot';
  }

  return { streamUrl, streamType };
}

function buildRowFeed(
  config: WebcamSourceConfig,
  row: unknown,
): WebcamFeed | null {
  if (config.onlineWhen && !config.onlineWhen(row)) return null;

  const rawId = resolveGetter(config.map.id, row);
  const rawName = resolveGetter(config.map.name, row);
  const rawLat = resolveGetter(config.map.lat, row);
  const rawLon = resolveGetter(config.map.lon, row);
  const rawSnapshot = resolveGetter(config.map.snapshotUrl, row);

  const lat = toCoord(rawLat);
  const lon = toCoord(rawLon);

  if (!isFiniteCoord(lat) || !isFiniteCoord(lon)) return null;
  if (typeof rawSnapshot !== 'string' || rawSnapshot.length === 0) return null;

  const idStr = toStr(rawId) || `${lat}-${lon}`;
  const id = `${config.id}:${idStr}`;
  const rawNameStr = toStr(rawName);
  const name = rawNameStr.length > 0 ? rawNameStr : toStr(rawId) || 'Camera';

  const { streamUrl, streamType } = resolveStreamFields(config.map, row);
  const category = resolveDerive(config.category, row);

  return {
    id,
    source: config.id,
    name,
    lat,
    lon,
    snapshotUrl: rawSnapshot,
    ...(streamUrl ? { streamUrl } : {}),
    ...(streamType ? { streamType } : {}),
    refreshIntervalSec: config.refreshIntervalSec,
    category,
    metadata: { ...config.metadata },
  };
}

export function buildFeedsFromConfig(config: WebcamSourceConfig, payloads: unknown[]): WebcamFeed[] {
  const out: WebcamFeed[] = [];
  for (const payload of payloads) {
    const rows = resolveRowArrayPath(payload, config.arrayPath);
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const feed = buildRowFeed(config, row);
      if (feed) out.push(feed);
    }
  }
  return out;
}
