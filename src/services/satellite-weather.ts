/**
 * Weather satellite imagery — NOAA GOES + JMA Himawari
 *
 * Uses NOAA's public WMS/tile services for GOES-East/West satellite imagery.
 * Also provides Himawari-9 coverage for Western Pacific.
 * No API key required — all public government data.
 *
 * Tile sources:
 *  - GOES-East (covers Americas): NOAA SLIDER WMS
 *  - Himawari-9 (covers Asia-Pacific): JMA/SLIDER
 */

export type SatelliteProduct =
  | 'geocolor' // True-color visible (day) + IR longwave (night)
  | 'infrared' // Band 13 — cloud-top temperature
  | 'water_vapor' // Band 8 — upper-level moisture
  | 'visible'; // Band 2 — daytime visible

export type SatelliteRegion = 'goes_east' | 'goes_west' | 'himawari';

interface SatelliteSource {
  label: string;
  region: SatelliteRegion;
  tileUrl: string;
}

const GOES_BASE = 'https://cdn.star.nesdis.noaa.gov/GOES16/ABI/CONUS';
const HIMAWARI_BASE = 'https://cdn.star.nesdis.noaa.gov/GOES17/ABI/FD';

export const SATELLITE_SOURCES: Record<string, SatelliteSource> = {
  goes_east_geocolor: {
 label: 'GOES-East GeoColor',
 region: 'goes_east',
 tileUrl: `${GOES_BASE}/GEOCOLOR/latest.jpg`,
  },
  goes_west_geocolor: {
 label: 'GOES-West GeoColor',
 region: 'goes_west',
 tileUrl: `${HIMAWARI_BASE}/GEOCOLOR/latest.jpg`,
  },
};

/** NOAA GOES WMS endpoint for tiled access */
export function getGoesWmsTileUrl(product: SatelliteProduct = 'geocolor'): string {
  const layerMap: Record<SatelliteProduct, string> = {
 geocolor: 'goes_conus_geocolor',
 infrared: 'goes_conus_ir',
 water_vapor: 'goes_conus_wv',
 visible: 'goes_conus_vis',
  };
  const layer = layerMap[product];
  return `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/${layer}/{z}/{x}/{y}.png`;
}

/** Himawari satellite tiles from Iowa State Mesonet */
export function getHimawariTileUrl(): string {
  return 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/himawari_fd_geocolor/{z}/{x}/{y}.png';
}

/** Available satellite products with labels */
export const SATELLITE_PRODUCTS: { id: SatelliteProduct; label: string }[] = [
  { id: 'geocolor', label: 'GeoColor (True Color)' },
  { id: 'infrared', label: 'Infrared (Cloud Tops)' },
  { id: 'water_vapor', label: 'Water Vapor' },
  { id: 'visible', label: 'Visible (Daytime)' },
];
