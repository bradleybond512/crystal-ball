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

/**
 * GIBS WMTS time segment — the most recent top-of-hour UTC timestamp,
 * optionally stepped back `hoursAgo` whole hours, as `YYYY-MM-DDTHH:00:00Z`.
 *
 * GOES/Himawari are sub-daily GIBS layers: their REST URLs *require* a TIME
 * segment between the style and the TileMatrixSet, and GIBS publishes each
 * frame into the "best" layer with a ~15–40 min latency. The current
 * top-of-hour is therefore frequently still a 404, so callers default to one
 * hour back and step further back on tile errors.
 */
export function gibsHourTimestamp(hoursAgo = 0, now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCMinutes(0, 0, 0);
  d.setUTCHours(d.getUTCHours() - hoursAgo);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * NOAA GOES WMTS via NASA GIBS for tiled access.
 *
 * Iowa State Mesonet's TMS layer names (`goes_conus_geocolor`, etc.) were
 * retired and now return a red "Invalid TMS Request" PNG with HTTP 200 —
 * which MapLibre/Cesium happily render as a magenta overlay across the
 * map. NASA GIBS publishes the same products with proper 4xx errors when
 * a layer is unavailable, so MapLibre falls through to a transparent tile
 * instead of rendering the error image.
 *
 * GOES GeoColor is a *sub-daily* layer, so the REST URL must carry a TIME
 * segment (`.../default/{YYYY-MM-DDTHH:00:00Z}/GoogleMapsCompatible_Level7/...`)
 * — without it GIBS 502/404s and the layer never renders. `hoursAgo` lets the
 * caller fall back to an earlier frame when the latest hour isn't published yet.
 *
 * The {z}/{y}/{x} ordering is required by GIBS's WMTS service and matches
 * the existing satellite basemap config under `public/map-styles/satellite.json`.
 */
export function getGoesWmsTileUrl(product: SatelliteProduct = 'geocolor', hoursAgo = 1): string {
  const layerMap: Record<SatelliteProduct, string> = {
 geocolor: 'GOES-East_ABI_GeoColor',
 infrared: 'GOES-East_ABI_Band13_Clean_Infrared',
 water_vapor: 'GOES-East_ABI_Band8_Upper-Level_Water_Vapor',
 visible: 'GOES-East_ABI_Band2_Red_Visible_1km',
  };
  const layer = layerMap[product];
  const time = gibsHourTimestamp(hoursAgo);
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${time}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`;
}

/** Himawari satellite tiles via NASA GIBS (Iowa State source returns Invalid TMS PNGs). */
export function getHimawariTileUrl(hoursAgo = 1): string {
  const time = gibsHourTimestamp(hoursAgo);
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Himawari_AHI_Band3_Red_Visible_1km/default/${time}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`;
}

/** Available satellite products with labels */
export const SATELLITE_PRODUCTS: { id: SatelliteProduct; label: string }[] = [
  { id: 'geocolor', label: 'GeoColor (True Color)' },
  { id: 'infrared', label: 'Infrared (Cloud Tops)' },
  { id: 'water_vapor', label: 'Water Vapor' },
  { id: 'visible', label: 'Visible (Daytime)' },
];
