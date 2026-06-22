/**
 * Runtime-bound entry for the OSM power adapter. Kept separate from
 * `osm-power.ts` so that module stays hermetically testable (no runtime
 * import); this file is the thin glue that resolves the right endpoint.
 *
 * On desktop the renderer can't reach overpass-api.de directly (CSP restricts
 * connect-src to 127.0.0.1), so it routes through the sidecar `/api/osm-power`
 * relay; elsewhere it goes direct to the public Overpass endpoint.
 */

import { getApiBaseUrl, isDesktopRuntime } from '@/services/runtime';
import {
  fetchPowerInfrastructure,
  summarizePowerContext,
  DEFAULT_OVERPASS_ENDPOINT,
  type FetchPowerOptions,
  type PowerAsset,
  type PowerContext,
} from './osm-power';

function resolveEndpoint(explicit?: string): string {
  if (explicit !== undefined) return explicit;
  return isDesktopRuntime() ? `${getApiBaseUrl()}/api/osm-power` : DEFAULT_OVERPASS_ENDPOINT;
}

/** Fetch power assets near a point, CSP-safe on desktop. */
export async function fetchSitePowerAssets(
  lat: number,
  lon: number,
  radiusKm = 25,
  options: FetchPowerOptions = {},
): Promise<PowerAsset[]> {
  return fetchPowerInfrastructure(lat, lon, radiusKm, {
    ...options,
    endpoint: resolveEndpoint(options.endpoint),
  });
}

/** Fetch + summarize power infrastructure for a site — the `PowerContext` the
 *  datacenter readiness layer consumes (nearest substation, nearby generation). */
export async function fetchSitePowerContext(
  lat: number,
  lon: number,
  radiusKm = 25,
  options: FetchPowerOptions = {},
): Promise<PowerContext> {
  const assets = await fetchSitePowerAssets(lat, lon, radiusKm, options);
  return summarizePowerContext({ lat, lon }, radiusKm, assets);
}
