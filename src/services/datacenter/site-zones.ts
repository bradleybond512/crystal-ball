/**
 * Best-effort resolution of a datacenter site's own NWS UGC zones
 * (forecast zone + county) for zone-only products such as ice, heat and
 * flood warnings (R3-BUG-002).
 *
 * A failed `/points` lookup (5xx, 429, timeout, malformed body) must never
 * stop the posture from being computed: it degrades to polygon-only matching
 * and reports `degraded` so the posture can say zone warnings are unverified.
 * Failures are never cached, so the next tick retries. A successful answer is
 * cached, including `[]` for a site outside NWS jurisdiction (a real answer).
 */

export interface SiteZoneResolution {
  zones: readonly string[];
  /** True when the lookup failed and zone-only warnings cannot be checked. */
  degraded: boolean;
}

export interface ZoneSite {
  lat: number;
  lon: number;
  ugcZones?: readonly string[];
}

export function siteZoneCacheKey(site: ZoneSite): string {
  return `${site.lat},${site.lon}`;
}

export async function resolveSiteZonesBestEffort(
  site: ZoneSite,
  cache: Map<string, string[]>,
  fetchZones: (lat: number, lon: number) => Promise<string[]>,
): Promise<SiteZoneResolution> {
  if (site.ugcZones) return { zones: site.ugcZones, degraded: false };
  const key = siteZoneCacheKey(site);
  const cached = cache.get(key);
  if (cached) return { zones: cached, degraded: false };
  try {
    const zones = await fetchZones(site.lat, site.lon);
    cache.set(key, zones);
    return { zones, degraded: false };
  } catch {
    return { zones: [], degraded: true };
  }
}
