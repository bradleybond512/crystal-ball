/**
 * Offline Map Region Pre-Caching
 *
 * Downloads CartoDB dark basemap tiles for a bounding box around a given
 * lat/lon so the map remains usable during connectivity loss or grid-down
 * scenarios. Uses the Cache API (main-thread safe) and persists region
 * metadata to localStorage.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OfflineMapRegion {
  id: string;
  label: string;
  lat: number;
  lon: number;
  radiusKm: number;
  zoomLevels: number[];
  tileCount: number;
  sizeMB: number;
  cachedAt: number;
}

export interface DownloadProgress {
  downloaded: number;
  total: number;
  sizeMB: number;
}

export type ProgressCallback = (progress: DownloadProgress) => void;

export interface ExactOfflineMapTile {
  url: string;
  byteLength: number;
  verified: true;
}

export interface ExactOfflineMapCache {
  put(request: RequestInfo | URL, response: Response): Promise<void>;
  match(request: RequestInfo | URL): Promise<Response | undefined>;
}

export interface ExactOfflineMapCaptureResult {
  ok: boolean;
  total: number;
  downloaded: number;
  totalBytes: number;
  tiles: ExactOfflineMapTile[];
  reason?: string;
}

export interface OfflineMapTilePlan {
  ok: boolean;
  tileUrls: string[];
  reason?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_NAME = 'wm-offline-maps';
const REGIONS_KEY = 'wm-offline-map-regions';
export const DEFAULT_ZOOM_LEVELS = [4, 6, 8, 10, 12];
export const MAX_RADIUS_KM = 100;
const TILE_SUBDOMAINS = ['a', 'b', 'c', 'd'];
const TILE_URL_TEMPLATE = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png';
/** Estimated average tile size (compressed PNG) — ~15 KB for dark basemap @2x */
const AVG_TILE_SIZE_KB = 15;
export const EXACT_OFFLINE_MAP_MAX_TILES = 512;
export const EXACT_OFFLINE_MAP_MAX_TILE_BYTES = 1024 * 1024;
export const EXACT_OFFLINE_MAP_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
export const EXACT_OFFLINE_MAP_MAX_CONCURRENCY = 4;
const MAX_WEB_MERCATOR_LAT = 85.05112878;
const EXACT_TILE_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif']);

// ---------------------------------------------------------------------------
// Tile math helpers (Slippy-map / Web Mercator)
// ---------------------------------------------------------------------------

function lonToTileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * (1 << z));
}

function latToTileY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.floor(
 ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * (1 << z),
  );
}

/**
 * Returns [minLat, maxLat, minLon, maxLon] for a bounding box centred on
 * (lat, lon) with the given radius in kilometres.
 */
function boundingBox(
  lat: number,
  lon: number,
  radiusKm: number,
): [number, number, number, number] {
  const KM_PER_DEG_LAT = 111.32;
  const dLat = radiusKm / KM_PER_DEG_LAT;
  const dLon = radiusKm / (KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  return [lat - dLat, lat + dLat, lon - dLon, lon + dLon];
}

function tileRangeForZoom(
  lat: number,
  lon: number,
  radiusKm: number,
  z: number,
): { xMin: number; xMax: number; yMin: number; yMax: number } {
  const [minLat, maxLat, minLon, maxLon] = boundingBox(lat, lon, radiusKm);
  const maxTile = (1 << z) - 1;
  return {
 xMin: Math.max(0, lonToTileX(minLon, z)),
 xMax: Math.min(maxTile, lonToTileX(maxLon, z)),
 yMin: Math.max(0, latToTileY(maxLat, z)), // note: y inverted in slippy-map
 yMax: Math.min(maxTile, latToTileY(minLat, z)),
  };
}

function tileUrl(z: number, x: number, y: number): string {
  const s = TILE_SUBDOMAINS[(x + y) % TILE_SUBDOMAINS.length]!;
  return TILE_URL_TEMPLATE.replace('{s}', s)
 .replace('{z}', String(z))
 .replace('{x}', String(x))
 .replace('{y}', String(y));
}

function isValidExactTileUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

async function readTileResponse(response: Response | undefined): Promise<Uint8Array | null> {
  if (!response?.ok) return null;
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (!EXACT_TILE_CONTENT_TYPES.has(contentType)) return null;
  try {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > EXACT_OFFLINE_MAP_MAX_TILE_BYTES) return null;
    return bytes;
  } catch {
    return null;
  }
}

async function readExistingTileExact(
  cache: ExactOfflineMapCache,
  url: string,
): Promise<Uint8Array | null> {
  const first = await readTileResponse(await cache.match(url));
  if (!first) return null;
  const readback = await readTileResponse(await cache.match(url));
  return readback && bytesEqual(first, readback) ? readback : null;
}

async function fetchAndStoreTileExact(
  cache: ExactOfflineMapCache,
  fetchTile: (url: string) => Promise<Response>,
  url: string,
): Promise<Uint8Array | null> {
  const existing = await readExistingTileExact(cache, url);
  if (existing) return existing;

  let response: Response;
  try {
    response = await fetchTile(url);
  } catch {
    return null;
  }
  const fetched = await readTileResponse(response);
  if (!fetched) return null;

  try {
    await cache.put(url, new Response(fetched.slice(), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }));
    const readback = await readTileResponse(await cache.match(url));
    return readback && bytesEqual(fetched, readback) ? readback : null;
  } catch {
    return null;
  }
}

export function validateOfflineMapCaptureBounds(
  tiles: Array<{ url: string; byteLength: number; verified: boolean }>,
): { ok: boolean; reason?: string } {
  if (tiles.length === 0) return { ok: false, reason: 'tile-count-invalid' };
  if (tiles.length > EXACT_OFFLINE_MAP_MAX_TILES) return { ok: false, reason: 'tile-count-limit' };

  const urls = new Set<string>();
  let totalBytes = 0;
  for (const tile of tiles) {
    if (!isValidExactTileUrl(tile.url)) return { ok: false, reason: 'tile-url-invalid' };
    if (urls.has(tile.url)) return { ok: false, reason: 'tile-url-duplicate' };
    urls.add(tile.url);
    if (!tile.verified) return { ok: false, reason: 'tile-verification-failed' };
    if (!Number.isSafeInteger(tile.byteLength) || tile.byteLength <= 0) {
      return { ok: false, reason: 'tile-size-invalid' };
    }
    if (tile.byteLength > EXACT_OFFLINE_MAP_MAX_TILE_BYTES) {
      return { ok: false, reason: 'tile-size-limit' };
    }
    totalBytes += tile.byteLength;
    if (totalBytes > EXACT_OFFLINE_MAP_MAX_TOTAL_BYTES) {
      return { ok: false, reason: 'total-size-limit' };
    }
  }
  return { ok: true };
}

export async function captureOfflineMapTilesExact(input: {
  tileUrls: string[];
  cache: ExactOfflineMapCache;
  fetchTile: (url: string) => Promise<Response>;
  concurrency?: number;
}): Promise<ExactOfflineMapCaptureResult> {
  const total = input.tileUrls.length;
  if (total === 0) {
    return { ok: false, total, downloaded: 0, totalBytes: 0, tiles: [], reason: 'tile-count-invalid' };
  }
  if (total > EXACT_OFFLINE_MAP_MAX_TILES) {
    return { ok: false, total, downloaded: 0, totalBytes: 0, tiles: [], reason: 'tile-count-limit' };
  }
  const urls = new Set<string>();
  for (const url of input.tileUrls) {
    if (!isValidExactTileUrl(url)) {
      return { ok: false, total, downloaded: 0, totalBytes: 0, tiles: [], reason: 'tile-url-invalid' };
    }
    if (urls.has(url)) {
      return { ok: false, total, downloaded: 0, totalBytes: 0, tiles: [], reason: 'tile-url-duplicate' };
    }
    urls.add(url);
  }

  const requestedConcurrency = Number.isSafeInteger(input.concurrency) ? input.concurrency! : EXACT_OFFLINE_MAP_MAX_CONCURRENCY;
  const concurrency = Math.max(1, Math.min(requestedConcurrency, EXACT_OFFLINE_MAP_MAX_CONCURRENCY, total));
  const results = Array.from<ExactOfflineMapTile | null>({ length: total }).fill(null);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < total) {
      const index = cursor++;
      const url = input.tileUrls[index]!;
      const bytes = await fetchAndStoreTileExact(input.cache, input.fetchTile, url);
      if (bytes) results[index] = { url, byteLength: bytes.byteLength, verified: true };
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const tiles = results.filter((tile): tile is ExactOfflineMapTile => tile !== null);
  const totalBytes = tiles.reduce((sum, tile) => sum + tile.byteLength, 0);
  if (tiles.length !== total) {
    return {
      ok: false,
      total,
      downloaded: tiles.length,
      totalBytes,
      tiles,
      reason: 'tile-verification-incomplete',
    };
  }
  const bounds = validateOfflineMapCaptureBounds(tiles);
  return {
    ok: bounds.ok,
    total,
    downloaded: tiles.length,
    totalBytes,
    tiles,
    ...(bounds.reason ? { reason: bounds.reason } : {}),
  };
}

export function planOfflineMapTileUrls(
  lat: number,
  lon: number,
  radiusKm: number,
  zoomLevels: number[] = DEFAULT_ZOOM_LEVELS,
): OfflineMapTilePlan {
  if (!Number.isFinite(lat) || lat < -MAX_WEB_MERCATOR_LAT || lat > MAX_WEB_MERCATOR_LAT
    || !Number.isFinite(lon) || lon < -180 || lon > 180
    || !Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > MAX_RADIUS_KM
    || zoomLevels.length === 0
    || zoomLevels.some((zoom) => !Number.isSafeInteger(zoom) || zoom < 0 || zoom > 22)) {
    return { ok: false, tileUrls: [], reason: 'tile-region-invalid' };
  }

  const urls = new Set<string>();
  for (const zoom of [...new Set(zoomLevels)].sort((left, right) => left - right)) {
    const [minLat, maxLat, minLon, maxLon] = boundingBox(lat, lon, radiusKm);
    const maxTile = (1 << zoom) - 1;
    const yMin = Math.max(0, latToTileY(Math.min(maxLat, MAX_WEB_MERCATOR_LAT), zoom));
    const yMax = Math.min(maxTile, latToTileY(Math.max(minLat, -MAX_WEB_MERCATOR_LAT), zoom));
    const longitudeRanges: Array<[number, number]> = minLon < -180
      ? [[-180, maxLon], [minLon + 360, 180]]
      : maxLon > 180
        ? [[minLon, 180], [-180, maxLon - 360]]
        : [[minLon, maxLon]];

    for (const [rangeMinLon, rangeMaxLon] of longitudeRanges) {
      const xMin = Math.max(0, lonToTileX(rangeMinLon, zoom));
      const xMax = Math.min(maxTile, lonToTileX(rangeMaxLon, zoom));
      for (let x = xMin; x <= xMax; x++) {
        for (let y = yMin; y <= yMax; y++) {
          urls.add(tileUrl(zoom, x, y));
          if (urls.size > EXACT_OFFLINE_MAP_MAX_TILES) {
            return { ok: false, tileUrls: [], reason: 'tile-count-limit' };
          }
        }
      }
    }
  }
  return urls.size > 0
    ? { ok: true, tileUrls: [...urls] }
    : { ok: false, tileUrls: [], reason: 'tile-count-invalid' };
}

export function planOfflineMapTileCleanup(
  targetRegionId: string,
  regions: Array<{ id: string; tileUrls: string[] }>,
): { deleteUrls: string[]; remainingRegionIds: string[] } {
  const target = regions.find((region) => region.id === targetRegionId);
  const remaining = regions.filter((region) => region.id !== targetRegionId);
  if (!target) return { deleteUrls: [], remainingRegionIds: remaining.map((region) => region.id) };

  const referenced = new Set(remaining.flatMap((region) => region.tileUrls));
  const deleteUrls = [...new Set(target.tileUrls)].filter((url) => !referenced.has(url));
  return { deleteUrls, remainingRegionIds: remaining.map((region) => region.id) };
}

// ---------------------------------------------------------------------------
// Estimate
// ---------------------------------------------------------------------------

export function estimateTileCount(
  radiusKm: number,
  zoomLevels: number[] = DEFAULT_ZOOM_LEVELS,
): number {
  const clampedRadius = Math.min(radiusKm, MAX_RADIUS_KM);
  let count = 0;
  for (const z of zoomLevels) {
 const { xMin, xMax, yMin, yMax } = tileRangeForZoom(0, 0, clampedRadius, z);
 count += (xMax - xMin + 1) * (yMax - yMin + 1);
  }
  return count;
}

export function estimateSizeMB(tileCount: number): number {
  return Math.round((tileCount * AVG_TILE_SIZE_KB) / 1024 * 100) / 100;
}

// ---------------------------------------------------------------------------
// Region persistence
// ---------------------------------------------------------------------------

function loadRegions(): OfflineMapRegion[] {
  try {
 const raw = localStorage.getItem(REGIONS_KEY);
 return raw ? (JSON.parse(raw) as OfflineMapRegion[]) : [];
  } catch {
 return [];
  }
}

function saveRegions(regions: OfflineMapRegion[]): void {
  localStorage.setItem(REGIONS_KEY, JSON.stringify(regions));
}

export function getDownloadedRegions(): OfflineMapRegion[] {
  return loadRegions();
}

export function getTotalCacheStats(): { totalTiles: number; totalSizeMB: number } {
  const regions = loadRegions();
  let totalTiles = 0;
  let totalSizeMB = 0;
  for (const r of regions) {
 totalTiles += r.tileCount;
 totalSizeMB += r.sizeMB;
  }
  return { totalTiles, totalSizeMB: Math.round(totalSizeMB * 100) / 100 };
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

export async function downloadRegion(
  lat: number,
  lon: number,
  radiusKm: number,
  zoomLevels: number[] = DEFAULT_ZOOM_LEVELS,
  label = 'Region',
  onProgress?: ProgressCallback,
): Promise<DownloadProgress> {
  const clampedRadius = Math.min(radiusKm, MAX_RADIUS_KM);

  // Collect all tile URLs
  const urls: string[] = [];
  for (const z of zoomLevels) {
 const { xMin, xMax, yMin, yMax } = tileRangeForZoom(lat, lon, clampedRadius, z);
 for (let x = xMin; x <= xMax; x++) {
 for (let y = yMin; y <= yMax; y++) {
 urls.push(tileUrl(z, x, y));
 }
 }
  }

  const total = urls.length;
  let downloaded = 0;
  let totalBytes = 0;

  const cache = await caches.open(CACHE_NAME);

  // Download in batches to avoid overwhelming the browser
  const BATCH = 6;
  for (let i = 0; i < urls.length; i += BATCH) {
 const batch = urls.slice(i, i + BATCH);
 const results = await Promise.allSettled(
 batch.map(async (url) => {
 const req = new Request(url);
 // Skip if already cached
 const existing = await cache.match(req);
 if (existing) {
 const size = Number(existing.headers.get('content-length')) || AVG_TILE_SIZE_KB * 1024;
 return size;
 }
 const resp = await fetch(url, { mode: 'cors' });
 if (!resp.ok) throw new Error(`Tile fetch failed: ${resp.status}`);
 const clone = resp.clone();
 await cache.put(req, resp);
 const size = Number(clone.headers.get('content-length')) || AVG_TILE_SIZE_KB * 1024;
 return size;
 }),
 );

 for (const r of results) {
 downloaded++;
 if (r.status === 'fulfilled') totalBytes += r.value;
 }

 const sizeMB = Math.round((totalBytes / (1024 * 1024)) * 100) / 100;
 onProgress?.({ downloaded, total, sizeMB });
  }

  const sizeMB = Math.round((totalBytes / (1024 * 1024)) * 100) / 100;

  const region: OfflineMapRegion = {
 id: `region-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
 label,
 lat,
 lon,
 radiusKm: clampedRadius,
 zoomLevels,
 tileCount: total,
 sizeMB,
 cachedAt: Date.now(),
  };

  const regions = loadRegions();
  regions.push(region);
  saveRegions(regions);

  return { downloaded, total, sizeMB };
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteRegion(id: string): Promise<void> {
  const regions = loadRegions();
  const target = regions.find((r) => r.id === id);
  if (!target) return;

  const plannedRegions = regions.map((region) => ({
    id: region.id,
    tileUrls: planOfflineMapTileUrls(
      region.lat,
      region.lon,
      region.radiusKm,
      region.zoomLevels,
    ).tileUrls,
  }));
  const allPlansComplete = plannedRegions.every((region) => region.tileUrls.length > 0);

  // If legacy metadata cannot be planned inside the exact bounds, retain its
  // shared cache entries instead of risking deletion of another region's tiles.
  const cache = await caches.open(CACHE_NAME);
  const cleanup = allPlansComplete
    ? planOfflineMapTileCleanup(id, plannedRegions)
    : { deleteUrls: [] };
  for (const url of cleanup.deleteUrls) {
    await cache.delete(new Request(url));
  }

  saveRegions(regions.filter((r) => r.id !== id));
}
