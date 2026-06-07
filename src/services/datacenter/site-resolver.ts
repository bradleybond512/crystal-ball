import type { SavedPlace } from '../saved-places.ts';
import { EIA_REGIONS, type EiaRegion } from '../infrastructure/grid-monitor.ts';
import type { SiteConfig } from './datacenter-types.ts';

/** Static, deterministic US lat/lon -> EIA balancing-authority lookup. Covers
 *  the five regions grid-monitor tracks; everything else falls back to MISO
 *  (the largest central-US authority). A manual override lives in the editor
 *  for edge cases (handled at the UI layer, not here). */
export function eiaRegionForLatLon(lat: number, lon: number): EiaRegion {
  // Texas (ERCOT) — roughly the state bounding box.
  if (lat >= 25.8 && lat <= 36.6 && lon >= -106.7 && lon <= -93.5) return 'ERCO';
  // California (CAISO).
  if (lat >= 32.5 && lat <= 42.1 && lon >= -124.5 && lon <= -114.1) return 'CISO';
  // New York (NYISO).
  if (lat >= 40.4 && lat <= 45.1 && lon >= -79.8 && lon <= -71.8) return 'NYIS';
  // PJM — Mid-Atlantic / Ohio Valley.
  if (lat >= 36.5 && lat <= 42.5 && lon >= -85 && lon <= -74) return 'PJM';
  return 'MISO';
}

export function resolveSiteConfig(places: readonly SavedPlace[]): SiteConfig | null {
  const tagged = places.filter((p) => p.tags.includes('data_center'));
  if (tagged.length === 0) return null;
  const chosen = [...tagged].sort((a, b) => b.priority - a.priority || a.sortIndex - b.sortIndex)[0]!;
  return {
    id: chosen.id,
    name: chosen.name,
    lat: chosen.lat,
    lon: chosen.lon,
    radiusKm: chosen.radiusKm,
    eiaRegion: eiaRegionForLatLon(chosen.lat, chosen.lon),
  };
}

/** Exposed for the override editor. */
export const SUPPORTED_EIA_REGIONS: readonly EiaRegion[] = EIA_REGIONS;
