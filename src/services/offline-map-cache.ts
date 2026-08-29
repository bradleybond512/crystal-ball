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
  cacheKey: string;
  sha256: string;
  generationId: string;
  byteLength: number;
  verified: true;
}

export interface ExactOfflineMapCache {
  put(request: RequestInfo | URL, response: Response): Promise<void>;
  match(request: RequestInfo | URL): Promise<Response | undefined>;
  delete(request: RequestInfo | URL): Promise<boolean>;
}

interface ExactOfflineMapCaptureResultBase {
  total: number;
  downloaded: number;
  totalBytes: number;
  tiles: ExactOfflineMapTile[];
}

export interface ExactOfflineMapCaptureSuccess extends ExactOfflineMapCaptureResultBase {
  ok: true;
  releaseStagedGeneration(): Promise<{ ok: boolean; reason?: string }>;
}

export interface ExactOfflineMapCaptureFailure extends ExactOfflineMapCaptureResultBase {
  ok: false;
  reason?: string;
  cleanupTombstone?: {
    generationId: string;
    cacheKeys: string[];
  };
}

export type ExactOfflineMapCaptureResult = ExactOfflineMapCaptureSuccess | ExactOfflineMapCaptureFailure;

export interface ExactOfflineMapCleanupMetadata {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ExactOfflineMapCleanupCoordinator {
  prepareCapture(cache: ExactOfflineMapCache): Promise<{ ok: boolean; reason?: string }>;
  stageGeneration(generationId: string, cacheKeys: string[]): void;
  adoptGeneration(generationId: string, cacheKeys: string[]): void;
  reconcileRecoveredGeneration(input: {
    generationId: string;
    cacheKeys: string[];
  }): ExactOfflineMapRecoveredOwnershipResult;
  releaseGeneration(input: {
    generationId: string;
    cacheKeys: string[];
    cache: ExactOfflineMapCache;
  }): Promise<{ ok: boolean; reason?: string }>;
}

export type ExactOfflineMapRecoveredOwnershipResult =
  | {
    ok: true;
    disposition: 'claimed-provisional' | 'already-owned' | 'unrelated-tombstone-preserved';
  }
  | {
    ok: false;
    reason: 'cleanup-tombstone-invalid' | 'cleanup-tombstone-storage-failure';
  };

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
const EXACT_TILE_CACHE_PREFIX = 'https://offline-map.crystalball.invalid/exact';
const EXACT_GENERATION_ID_MAX_LENGTH = 180;
const EXACT_CLEANUP_TOMBSTONE_KEY = 'wm-offline-map-exact-cleanup-v1';
const EXACT_CLEANUP_TOMBSTONE_MAX_BYTES = 384 * 1024;

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

function isValidGenerationId(value: string | undefined): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= EXACT_GENERATION_ID_MAX_LENGTH;
}

function exactTileCacheKey(generationId: string, index: number): string {
  return `${EXACT_TILE_CACHE_PREFIX}/${encodeURIComponent(generationId)}/${index}`;
}

interface ExactOfflineMapCleanupTombstone {
  schemaVersion: 1;
  generationId: string;
  cacheKeys: string[];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateCleanupIdentity(
  generationId: string,
  cacheKeys: readonly string[],
): ExactOfflineMapCleanupTombstone | null {
  if (!isValidGenerationId(generationId)
    || cacheKeys.length === 0
    || cacheKeys.length > EXACT_OFFLINE_MAP_MAX_TILES
    || new Set(cacheKeys).size !== cacheKeys.length) return null;
  const prefix = `${EXACT_TILE_CACHE_PREFIX}/${encodeURIComponent(generationId)}/`;
  for (const cacheKey of cacheKeys) {
    if (typeof cacheKey !== 'string' || !cacheKey.startsWith(prefix)) return null;
    const indexText = cacheKey.slice(prefix.length);
    const index = Number(indexText);
    if (!Number.isSafeInteger(index)
      || index < 0
      || index >= EXACT_OFFLINE_MAP_MAX_TILES
      || exactTileCacheKey(generationId, index) !== cacheKey) return null;
  }
  return { schemaVersion: 1, generationId, cacheKeys: [...cacheKeys] };
}

function encodeCleanupTombstone(tombstone: ExactOfflineMapCleanupTombstone): string {
  const encoded = JSON.stringify(tombstone);
  if (new TextEncoder().encode(encoded).byteLength > EXACT_CLEANUP_TOMBSTONE_MAX_BYTES) {
    throw new Error('offline map cleanup tombstone exceeds bound');
  }
  return encoded;
}

function parseCleanupTombstone(encoded: string): ExactOfflineMapCleanupTombstone | null {
  if (new TextEncoder().encode(encoded).byteLength > EXACT_CLEANUP_TOMBSTONE_MAX_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    return null;
  }
  if (!isPlainRecord(value)
    || Object.keys(value).length !== 3
    || value.schemaVersion !== 1
    || typeof value.generationId !== 'string'
    || !Array.isArray(value.cacheKeys)
    || !value.cacheKeys.every((cacheKey) => typeof cacheKey === 'string')) return null;
  return validateCleanupIdentity(
    value.generationId,
    value.cacheKeys,
  );
}

function sameCleanupIdentity(
  tombstone: ExactOfflineMapCleanupTombstone,
  generationId: string,
  cacheKeys: readonly string[],
): boolean {
  return tombstone.generationId === generationId
    && tombstone.cacheKeys.length === cacheKeys.length
    && tombstone.cacheKeys.every((cacheKey, index) => cacheKey === cacheKeys[index]);
}

export function createExactOfflineMapCleanupCoordinator(input: {
  metadata: ExactOfflineMapCleanupMetadata;
}): ExactOfflineMapCleanupCoordinator {
  const activeGenerations = new Set<string>();

  const readTombstone = (): ExactOfflineMapCleanupTombstone | null => {
    const encoded = input.metadata.getItem(EXACT_CLEANUP_TOMBSTONE_KEY);
    if (encoded === null) return null;
    const tombstone = parseCleanupTombstone(encoded);
    if (!tombstone) throw new Error('offline map cleanup tombstone invalid');
    return tombstone;
  };

  const writeTombstone = (generationId: string, cacheKeys: string[]): void => {
    const tombstone = validateCleanupIdentity(generationId, cacheKeys);
    if (!tombstone) throw new Error('offline map cleanup tombstone invalid');
    const existing = readTombstone();
    if (existing && !sameCleanupIdentity(existing, generationId, cacheKeys)) {
      throw new Error('offline map cleanup tombstone pending');
    }
    const encoded = encodeCleanupTombstone(tombstone);
    try {
      input.metadata.setItem(EXACT_CLEANUP_TOMBSTONE_KEY, encoded);
      if (input.metadata.getItem(EXACT_CLEANUP_TOMBSTONE_KEY) !== encoded) {
        throw new Error('readback mismatch');
      }
    } catch {
      throw new Error('offline map cleanup tombstone write failed');
    }
  };

  const removeTombstone = (): void => {
    input.metadata.removeItem(EXACT_CLEANUP_TOMBSTONE_KEY);
    if (input.metadata.getItem(EXACT_CLEANUP_TOMBSTONE_KEY) !== null) {
      throw new Error('offline map cleanup tombstone removal failed');
    }
  };

  const drain = async (cache: ExactOfflineMapCache): Promise<{ ok: boolean; reason?: string }> => {
    let tombstone: ExactOfflineMapCleanupTombstone | null;
    try {
      tombstone = readTombstone();
    } catch {
      return { ok: false, reason: 'cleanup-tombstone-invalid' };
    }
    if (!tombstone) return { ok: true };
    if (activeGenerations.has(tombstone.generationId)) {
      return { ok: false, reason: 'generation-cleanup-pending' };
    }
    if (!await cleanupExactCacheKeys(cache, tombstone.cacheKeys)) {
      return { ok: false, reason: 'generation-cleanup-pending' };
    }
    try {
      removeTombstone();
    } catch {
      return { ok: false, reason: 'cleanup-tombstone-storage-failure' };
    }
    return { ok: true };
  };

  return {
    prepareCapture: drain,
    stageGeneration(generationId, cacheKeys): void {
      writeTombstone(generationId, cacheKeys);
      activeGenerations.add(generationId);
    },
    adoptGeneration(generationId, cacheKeys): void {
      const tombstone = readTombstone();
      if (!tombstone) {
        if (activeGenerations.has(generationId)) {
          throw new Error('offline map cleanup tombstone ownership mismatch');
        }
        return;
      }
      if (!sameCleanupIdentity(tombstone, generationId, cacheKeys)) {
        throw new Error('offline map cleanup tombstone ownership mismatch');
      }
      removeTombstone();
      activeGenerations.delete(generationId);
    },
    reconcileRecoveredGeneration({ generationId, cacheKeys }): ExactOfflineMapRecoveredOwnershipResult {
      if (!validateCleanupIdentity(generationId, cacheKeys)) {
        return { ok: false, reason: 'cleanup-tombstone-invalid' };
      }
      let tombstone: ExactOfflineMapCleanupTombstone | null;
      try {
        tombstone = readTombstone();
      } catch {
        return { ok: false, reason: 'cleanup-tombstone-invalid' };
      }
      if (!tombstone) {
        activeGenerations.delete(generationId);
        return { ok: true, disposition: 'already-owned' };
      }
      if (!sameCleanupIdentity(tombstone, generationId, cacheKeys)) {
        return { ok: true, disposition: 'unrelated-tombstone-preserved' };
      }
      try {
        removeTombstone();
      } catch {
        return { ok: false, reason: 'cleanup-tombstone-storage-failure' };
      }
      activeGenerations.delete(generationId);
      return { ok: true, disposition: 'claimed-provisional' };
    },
    async releaseGeneration({ generationId, cacheKeys, cache }): Promise<{ ok: boolean; reason?: string }> {
      const tombstone = readTombstone();
      if (!tombstone) writeTombstone(generationId, cacheKeys);
      else if (!sameCleanupIdentity(tombstone, generationId, cacheKeys)) {
        throw new Error('offline map cleanup tombstone pending');
      }
      activeGenerations.delete(generationId);
      return drain(cache);
    },
  };
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The response is rejected regardless of whether its producer accepts cancellation.
  }
}

interface ExactTileBody {
  bytes: Uint8Array;
  contentType: string;
}

async function readTileResponseBounded(response: Response | undefined): Promise<ExactTileBody | null> {
  if (!response) return null;
  if (!response.ok) {
    await cancelBody(response);
    return null;
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (!EXACT_TILE_CONTENT_TYPES.has(contentType)) {
    await cancelBody(response);
    return null;
  }
  const declaredLengthValue = response.headers.get('content-length');
  const declaredLength = declaredLengthValue === null ? null : Number(declaredLengthValue);
  if (declaredLength !== null
    && (!Number.isSafeInteger(declaredLength)
      || declaredLength <= 0
      || declaredLength > EXACT_OFFLINE_MAP_MAX_TILE_BYTES)) {
    await cancelBody(response);
    return null;
  }
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > EXACT_OFFLINE_MAP_MAX_TILE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(chunk.value);
    }
    if (byteLength === 0) return null;
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { bytes, contentType };
  } catch {
    try {
      await reader.cancel();
    } catch {
      // The read already failed closed.
    }
    return null;
  }
}

async function sha256(bytes: Uint8Array): Promise<string | null> {
  try {
    const digest = await globalThis.crypto?.subtle.digest('SHA-256', bytes.slice().buffer);
    if (!digest) return null;
    return [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
}

async function readSourceTileExact(
  cache: ExactOfflineMapCache,
  fetchTile: (url: string) => Promise<Response>,
  url: string,
): Promise<ExactTileBody | null> {
  const existing = await readTileResponseBounded(await cache.match(url));
  if (existing) return existing;

  let response: Response;
  try {
    response = await fetchTile(url);
  } catch {
    return null;
  }
  return readTileResponseBounded(response);
}

async function cleanupExactCacheKeys(
  cache: ExactOfflineMapCache,
  cacheKeys: readonly string[],
): Promise<boolean> {
  let cursor = 0;
  let cleaned = true;
  const worker = async (): Promise<void> => {
    while (cursor < cacheKeys.length) {
      const cacheKey = cacheKeys[cursor++]!;
      try {
        await cache.delete(cacheKey);
        if (await cache.match(cacheKey)) cleaned = false;
      } catch {
        cleaned = false;
      }
    }
  };
  const concurrency = Math.min(EXACT_OFFLINE_MAP_MAX_CONCURRENCY, cacheKeys.length);
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return cleaned;
}

async function storeTileGenerationExact(input: {
  cache: ExactOfflineMapCache;
  cacheKey: string;
  generationId: string;
  sourceUrl: string;
  bytes: Uint8Array;
  contentType: string;
}): Promise<ExactOfflineMapTile | null> {
  const digest = await sha256(input.bytes);
  if (!digest) return null;

  try {
    await input.cache.put(input.cacheKey, new Response(input.bytes.slice(), {
      status: 200,
      headers: { 'content-type': input.contentType },
    }));
    const readback = await readTileResponseBounded(await input.cache.match(input.cacheKey));
    if (!readback
      || !bytesEqual(input.bytes, readback.bytes)
      || await sha256(readback.bytes) !== digest) return null;
    return {
      url: input.sourceUrl,
      cacheKey: input.cacheKey,
      sha256: digest,
      generationId: input.generationId,
      byteLength: readback.bytes.byteLength,
      verified: true,
    };
  } catch {
    return null;
  }
}

export function validateOfflineMapCaptureBounds(
  tiles: ReadonlyArray<{ url: string; byteLength: number; verified: boolean }>,
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
  generationId?: string;
  tileUrls: string[];
  cache: ExactOfflineMapCache;
  cleanup?: ExactOfflineMapCleanupCoordinator;
  fetchTile: (url: string) => Promise<Response>;
  concurrency?: number;
}): Promise<ExactOfflineMapCaptureResult> {
  const total = input.tileUrls.length;
  const generationId = input.generationId;
  if (!isValidGenerationId(generationId)) {
    return { ok: false, total, downloaded: 0, totalBytes: 0, tiles: [], reason: 'generation-id-invalid' };
  }
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
  if (!input.cleanup) {
    return { ok: false, total, downloaded: 0, totalBytes: 0, tiles: [], reason: 'cleanup-coordinator-required' };
  }
  let prepared: { ok: boolean; reason?: string };
  try {
    prepared = await input.cleanup.prepareCapture(input.cache);
  } catch {
    return { ok: false, total, downloaded: 0, totalBytes: 0, tiles: [], reason: 'cleanup-tombstone-storage-failure' };
  }
  if (!prepared.ok) {
    return {
      ok: false,
      total,
      downloaded: 0,
      totalBytes: 0,
      tiles: [],
      reason: prepared.reason ?? 'generation-cleanup-pending',
    };
  }

  const generationCacheKeys = input.tileUrls.map((_, index) => exactTileCacheKey(generationId, index));
  try {
    for (const cacheKey of generationCacheKeys) {
      if (await input.cache.match(cacheKey)) {
        return { ok: false, total, downloaded: 0, totalBytes: 0, tiles: [], reason: 'generation-collision' };
      }
    }
    input.cleanup.stageGeneration(generationId, generationCacheKeys);
  } catch {
    return { ok: false, total, downloaded: 0, totalBytes: 0, tiles: [], reason: 'cleanup-tombstone-write-failed' };
  }

  const requestedConcurrency = Number.isSafeInteger(input.concurrency) ? input.concurrency! : EXACT_OFFLINE_MAP_MAX_CONCURRENCY;
  const concurrency = Math.max(1, Math.min(requestedConcurrency, EXACT_OFFLINE_MAP_MAX_CONCURRENCY, total));
  const results = Array.from<ExactOfflineMapTile | null>({ length: total }).fill(null);
  let reservedBytes = 0;
  let cursor = 0;
  let releasePromise: Promise<{ ok: boolean; reason?: string }> | null = null;

  const releaseStagedGeneration = (): Promise<{ ok: boolean; reason?: string }> => {
    releasePromise ??= (async () => {
      try {
        return await input.cleanup!.releaseGeneration({
          generationId,
          cacheKeys: generationCacheKeys,
          cache: input.cache,
        });
      } catch {
        return { ok: false, reason: 'cleanup-tombstone-storage-failure' };
      }
    })();
    return releasePromise;
  };

  const worker = async (): Promise<void> => {
    while (cursor < total) {
      const index = cursor++;
      const url = input.tileUrls[index]!;
      const cacheKey = generationCacheKeys[index]!;
      const tileBody = await readSourceTileExact(input.cache, input.fetchTile, url);
      if (!tileBody) continue;
      if (reservedBytes + tileBody.bytes.byteLength > EXACT_OFFLINE_MAP_MAX_TOTAL_BYTES) continue;
      reservedBytes += tileBody.bytes.byteLength;
      const tile = await storeTileGenerationExact({
        cache: input.cache,
        cacheKey,
        generationId,
        sourceUrl: url,
        bytes: tileBody.bytes,
        contentType: tileBody.contentType,
      });
      if (tile) results[index] = tile;
    }
  };
  const workerSettlements = await Promise.allSettled(
    Array.from({ length: concurrency }, () => worker()),
  );
  const workerFailed = workerSettlements.some(({ status }) => status === 'rejected');

  const tiles = results.filter((tile): tile is ExactOfflineMapTile => tile !== null);
  const totalBytes = tiles.reduce((sum, tile) => sum + tile.byteLength, 0);
  if (workerFailed || tiles.length !== total) {
    const cleanup = await releaseStagedGeneration();
    return {
      ok: false,
      total,
      downloaded: tiles.length,
      totalBytes,
      tiles,
      reason: cleanup.ok
        ? workerFailed ? 'tile-worker-failed' : 'tile-verification-incomplete'
        : cleanup.reason ?? 'generation-cleanup-pending',
      ...(!cleanup.ok ? { cleanupTombstone: { generationId, cacheKeys: [...generationCacheKeys] } } : {}),
    };
  }
  const bounds = validateOfflineMapCaptureBounds(tiles);
  if (!bounds.ok) {
    const cleanup = await releaseStagedGeneration();
    return {
      ok: false,
      total,
      downloaded: 0,
      totalBytes: 0,
      tiles: [],
      ...(!cleanup.ok
        ? {
          reason: cleanup.reason ?? 'generation-cleanup-pending',
          cleanupTombstone: { generationId, cacheKeys: [...generationCacheKeys] },
        }
        : bounds.reason ? { reason: bounds.reason } : {}),
    };
  }
  return {
    ok: true,
    total,
    downloaded: tiles.length,
    totalBytes,
    tiles,
    releaseStagedGeneration,
  };
}

function validateExactGenerationTiles(
  generationId: string,
  tiles: readonly ExactOfflineMapTile[],
): { ok: boolean; reason?: string } {
  if (!isValidGenerationId(generationId)) return { ok: false, reason: 'generation-id-invalid' };
  const bounds = validateOfflineMapCaptureBounds(tiles);
  if (!bounds.ok) return bounds;
  for (const [index, tile] of tiles.entries()) {
    if (tile.generationId !== generationId
      || tile.cacheKey !== exactTileCacheKey(generationId, index)) {
      return { ok: false, reason: 'generation-key-mismatch' };
    }
    if (!/^[a-f0-9]{64}$/.test(tile.sha256)) return { ok: false, reason: 'tile-digest-invalid' };
  }
  return { ok: true };
}

export async function verifyOfflineMapGenerationExact(input: {
  generationId: string;
  tiles: ExactOfflineMapTile[];
  cache: ExactOfflineMapCache;
}): Promise<{ ok: boolean; reason?: string }> {
  const validation = validateExactGenerationTiles(input.generationId, input.tiles);
  if (!validation.ok) return validation;
  for (const tile of input.tiles) {
    let readback: ExactTileBody | null;
    try {
      readback = await readTileResponseBounded(await input.cache.match(tile.cacheKey));
    } catch {
      readback = null;
    }
    if (!readback
      || readback.bytes.byteLength !== tile.byteLength
      || await sha256(readback.bytes) !== tile.sha256) {
      return { ok: false, reason: 'tile-readback-mismatch' };
    }
  }
  return { ok: true };
}

export async function readOfflineMapTileExact(input: {
  generationId: string;
  tiles: ExactOfflineMapTile[];
  sourceUrls: readonly string[];
  cache: ExactOfflineMapCache;
}): Promise<{ data: ArrayBuffer; contentType: string } | null> {
  const validation = validateExactGenerationTiles(input.generationId, input.tiles);
  if (!validation.ok || input.sourceUrls.length === 0) return null;
  const requested = new Set(input.sourceUrls);
  const tile = input.tiles.find(({ url }) => requested.has(url));
  if (!tile) return null;
  let readback: ExactTileBody | null;
  try {
    readback = await readTileResponseBounded(await input.cache.match(tile.cacheKey));
  } catch {
    return null;
  }
  if (!readback
    || readback.bytes.byteLength !== tile.byteLength
    || await sha256(readback.bytes) !== tile.sha256) return null;
  return { data: readback.bytes.slice().buffer, contentType: readback.contentType };
}

export async function readOfflineMapTileAtIndexExact(input: {
  generationId: string;
  tileIndex: number;
  tile: ExactOfflineMapTile;
  cache: ExactOfflineMapCache;
}): Promise<{ data: ArrayBuffer; contentType: string } | null> {
  if (!isValidGenerationId(input.generationId)
    || !Number.isSafeInteger(input.tileIndex)
    || input.tileIndex < 0
    || input.tileIndex >= EXACT_OFFLINE_MAP_MAX_TILES
    || input.tile.generationId !== input.generationId
    || input.tile.cacheKey !== exactTileCacheKey(input.generationId, input.tileIndex)
    || !validateOfflineMapCaptureBounds([input.tile]).ok
    || !/^[a-f0-9]{64}$/.test(input.tile.sha256)) return null;
  let readback: ExactTileBody | null;
  try {
    readback = await readTileResponseBounded(await input.cache.match(input.tile.cacheKey));
  } catch {
    return null;
  }
  if (!readback
    || readback.bytes.byteLength !== input.tile.byteLength
    || await sha256(readback.bytes) !== input.tile.sha256) return null;
  return { data: readback.bytes.slice().buffer, contentType: readback.contentType };
}

export async function deleteOfflineMapGenerationExact(input: {
  generationId: string;
  tiles: ExactOfflineMapTile[];
  retainedCacheKeys?: string[];
  cache: ExactOfflineMapCache;
  cleanup?: ExactOfflineMapCleanupCoordinator;
}): Promise<{ ok: boolean; deleted: number; retained: number; reason?: string; durableCleanup?: true }> {
  const validation = validateExactGenerationTiles(input.generationId, input.tiles);
  if (!validation.ok) {
    return { ok: false, deleted: 0, retained: 0, ...(validation.reason ? { reason: validation.reason } : {}) };
  }
  const retainedCacheKeys = input.retainedCacheKeys
    ? new Set(input.retainedCacheKeys)
    : new Set<string>();
  const cacheKeys = input.tiles
    .map(({ cacheKey }) => cacheKey)
    .filter((cacheKey) => !retainedCacheKeys.has(cacheKey));
  const retained = input.tiles.length - cacheKeys.length;
  if (cacheKeys.length === 0) return { ok: true, deleted: 0, retained };
  if (!input.cleanup) {
    return { ok: false, deleted: 0, retained, reason: 'cleanup-coordinator-required' };
  }
  const released = await input.cleanup.releaseGeneration({
    generationId: input.generationId,
    cacheKeys,
    cache: input.cache,
  });
  if (!released.ok) {
    return {
      ok: false,
      deleted: 0,
      retained,
      reason: released.reason ?? 'generation-cleanup-pending',
      durableCleanup: true,
    };
  }
  return { ok: true, deleted: cacheKeys.length, retained };
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
