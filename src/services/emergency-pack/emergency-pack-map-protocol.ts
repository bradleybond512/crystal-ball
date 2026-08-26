const PROTOCOL_NAME = 'wm-emergency-pack-map';
const PROTOCOL_PREFIX = `${PROTOCOL_NAME}://tile/`;
const CARTO_HOST_PATTERN = /^[a-d]\.basemaps\.cartocdn\.com$/;
const DARK_ALL_PATH = /^\/dark_all\/(\d+)\/(\d+)\/(\d+)@2x\.png$/;
const DARK_NO_LABELS_PATH = /^\/rastertiles\/dark_nolabels\/(\d+)\/(\d+)\/(\d+)\.png$/;
const CARTO_SUBDOMAINS = ['a', 'b', 'c', 'd'] as const;
const MAP_TILE_MAX_BYTES = 1024 * 1024;
const MAP_TILE_TIMEOUT_MS = 15_000;
const MAP_TILE_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif']);

export interface EmergencyPackMapTileData {
  data: ArrayBuffer;
  contentType: string;
}

function parseEligibleUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:'
      || !CARTO_HOST_PATTERN.test(url.hostname)
      || url.port !== ''
      || url.username !== ''
      || url.password !== ''
      || url.search !== ''
      || url.hash !== '') return null;
    return DARK_ALL_PATH.test(url.pathname) || DARK_NO_LABELS_PATH.test(url.pathname) ? url : null;
  } catch {
    return null;
  }
}

export function emergencyPackMapSourceUrls(requestUrl: string): string[] {
  const url = parseEligibleUrl(requestUrl);
  if (!url) return [];
  if (DARK_ALL_PATH.test(url.pathname)) return [url.href];
  const match = DARK_NO_LABELS_PATH.exec(url.pathname);
  if (!match) return [];
  const [, zoom, tileX, tileY] = match;
  const x = Number(tileX);
  const y = Number(tileY);
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return [];
  const subdomain = CARTO_SUBDOMAINS[(x + y) % CARTO_SUBDOMAINS.length]!;
  return [`https://${subdomain}.basemaps.cartocdn.com/dark_all/${zoom}/${tileX}/${tileY}@2x.png`];
}

export function transformEmergencyPackMapRequest(url: string, resourceType?: string): { url: string } {
  if (resourceType !== 'Tile' || emergencyPackMapSourceUrls(url).length === 0) return { url };
  return { url: `${PROTOCOL_PREFIX}${encodeURIComponent(url)}` };
}

export function unwrapEmergencyPackMapUrl(url: string): string | null {
  if (!url.startsWith(PROTOCOL_PREFIX)) return null;
  try {
    const unwrapped = decodeURIComponent(url.slice(PROTOCOL_PREFIX.length));
    return parseEligibleUrl(unwrapped)?.href ?? null;
  } catch {
    return null;
  }
}

function createFetchAbortScope(upstream: AbortSignal, timeoutMs: number): {
  signal: AbortSignal;
  dispose(): void;
} {
  const controller = new AbortController();
  const abortFromUpstream = () => controller.abort(upstream.reason);
  if (upstream.aborted) abortFromUpstream();
  else upstream.addEventListener('abort', abortFromUpstream, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    dispose(): void {
      clearTimeout(timeout);
      upstream.removeEventListener('abort', abortFromUpstream);
    },
  };
}

async function cancelResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The response remains rejected when its producer cannot be cancelled.
  }
}

async function rejectResponse(response: Response, message: string): Promise<never> {
  await cancelResponse(response);
  throw new Error(message);
}

function declaredByteLength(response: Response): number | null {
  const value = response.headers.get('content-length');
  if (value === null) return null;
  if (!/^[1-9]\d*$/.test(value)) return Number.NaN;
  const length = Number(value);
  return Number.isSafeInteger(length) ? length : Number.NaN;
}

async function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) throw new Error('Map tile fetch aborted');
  let abort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new Error('Map tile fetch aborted'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([reader.read(), aborted]);
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
  }
}

async function validateOnlineTileResponse(response: Response): Promise<{
  reader: ReadableStreamDefaultReader<Uint8Array>;
  declaredLength: number | null;
}> {
  if (response.redirected) return rejectResponse(response, 'Map tile redirect rejected');
  if (response.status !== 200) return rejectResponse(response, `Map tile fetch failed (${response.status})`);
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (!MAP_TILE_CONTENT_TYPES.has(contentType)) {
    return rejectResponse(response, 'Map tile content type rejected');
  }
  const declaredLength = declaredByteLength(response);
  if (declaredLength !== null
    && (!Number.isSafeInteger(declaredLength) || declaredLength > MAP_TILE_MAX_BYTES)) {
    return rejectResponse(response, 'Map tile byte cap exceeded');
  }
  if (!response.body) throw new Error('Map tile body missing');
  return { reader: response.body.getReader(), declaredLength };
}

async function readTileStreamBounded(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<{ data: ArrayBuffer; byteLength: number }> {
  const bytes = new Uint8Array(MAP_TILE_MAX_BYTES);
  let byteLength = 0;
  while (true) {
    const chunk = await readWithAbort(reader, signal);
    if (chunk.done) break;
    if (!(chunk.value instanceof Uint8Array)
      || byteLength + chunk.value.byteLength > MAP_TILE_MAX_BYTES) {
      throw new Error('Map tile byte cap exceeded');
    }
    bytes.set(chunk.value, byteLength);
    byteLength += chunk.value.byteLength;
  }
  if (byteLength === 0) throw new Error('Map tile body missing');
  return { data: bytes.slice(0, byteLength).buffer, byteLength };
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // The bounded read failure remains authoritative.
  }
}

async function readOnlineTileBounded(response: Response, signal: AbortSignal): Promise<ArrayBuffer> {
  const { reader, declaredLength } = await validateOnlineTileResponse(response);
  try {
    const tile = await readTileStreamBounded(reader, signal);
    if (declaredLength !== null && declaredLength !== tile.byteLength) {
      throw new Error('Map tile length mismatch');
    }
    return tile.data;
  } catch (error) {
    await cancelReader(reader);
    if (signal.aborted) throw new Error('Map tile fetch aborted');
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export function createEmergencyPackMapProtocolHandler(dependencies: {
  resolveTile(url: string): Promise<EmergencyPackMapTileData | null>;
  fetchTile(url: string, init: RequestInit): Promise<Response>;
  timeoutMs?: number;
}) {
  return async (
    parameters: { url: string },
    controller: AbortController,
  ): Promise<{ data: ArrayBuffer }> => {
    const originalUrl = unwrapEmergencyPackMapUrl(parameters.url);
    if (!originalUrl) throw new Error('Invalid emergency pack map URL');
    try {
      const offline = await dependencies.resolveTile(originalUrl);
      if (offline) return { data: offline.data };
    } catch {
      // A failed local read is a cache miss; the original HTTPS path stays authoritative online.
    }
    const abortScope = createFetchAbortScope(controller.signal, dependencies.timeoutMs ?? MAP_TILE_TIMEOUT_MS);
    try {
      const response = await dependencies.fetchTile(originalUrl, {
        mode: 'cors',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: abortScope.signal,
      });
      return { data: await readOnlineTileBounded(response, abortScope.signal) };
    } catch (error) {
      if (abortScope.signal.aborted) throw new Error('Map tile fetch aborted');
      throw error;
    } finally {
      abortScope.dispose();
    }
  };
}

let registered = false;

export function registerEmergencyPackMapProtocolOnce(
  addProtocol: (name: string, handler: AddProtocolAction) => void,
  handler: AddProtocolAction,
): void {
  if (registered) return;
  addProtocol(PROTOCOL_NAME, handler);
  registered = true;
}
import type { AddProtocolAction } from 'maplibre-gl';
