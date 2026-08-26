const PROTOCOL_NAME = 'wm-emergency-pack-map';
const PROTOCOL_PREFIX = `${PROTOCOL_NAME}://tile/`;
const CARTO_HOST_PATTERN = /^[a-d]\.basemaps\.cartocdn\.com$/;
const DARK_ALL_PATH = /^\/dark_all\/(\d+)\/(\d+)\/(\d+)@2x\.png$/;
const DARK_NO_LABELS_PATH = /^\/rastertiles\/dark_nolabels\/(\d+)\/(\d+)\/(\d+)\.png$/;
const CARTO_SUBDOMAINS = ['a', 'b', 'c', 'd'] as const;

export interface EmergencyPackMapTileData {
  data: ArrayBuffer;
  contentType: string;
}

function parseEligibleUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:'
      || !CARTO_HOST_PATTERN.test(url.hostname)
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

export function createEmergencyPackMapProtocolHandler(dependencies: {
  resolveTile(url: string): Promise<EmergencyPackMapTileData | null>;
  fetchTile(url: string, signal: AbortSignal): Promise<Response>;
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
    const response = await dependencies.fetchTile(originalUrl, controller.signal);
    if (!response.ok) throw new Error(`Map tile fetch failed (${response.status})`);
    return { data: await response.arrayBuffer() };
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
