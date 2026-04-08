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

  // Remove tiles that belong to this region from the cache
  const cache = await caches.open(CACHE_NAME);
  for (const z of target.zoomLevels) {
 const { xMin, xMax, yMin, yMax } = tileRangeForZoom(
 target.lat,
 target.lon,
 target.radiusKm,
 z,
 );
 for (let x = xMin; x <= xMax; x++) {
 for (let y = yMin; y <= yMax; y++) {
 await cache.delete(new Request(tileUrl(z, x, y)));
 }
 }
  }

  saveRegions(regions.filter((r) => r.id !== id));
}

