/**
 * OpenWeatherMap weather tile overlays
 *
 * Source: https://openweathermap.org/api/weathermaps
 * Requires OWM_API_KEY (free tier available).
 * Provides global tile layers for temperature, precipitation, clouds, wind, pressure.
 * Tiles are 256x256 PNG in standard web mercator (z/x/y).
 */

import { getRuntimeConfigSnapshot } from '@/services/runtime-config';

export type OwmTileLayer =
  | 'temp_new' // Temperature
  | 'precipitation_new' // Precipitation
  | 'clouds_new' // Cloud cover
  | 'wind_new' // Wind speed
  | 'pressure_new'; // Sea level pressure

export interface OwmLayerInfo {
  id: OwmTileLayer;
  label: string;
  unit: string;
}

export const OWM_LAYERS: OwmLayerInfo[] = [
  { id: 'temp_new', label: 'Temperature', unit: '\u00B0C' },
  { id: 'precipitation_new', label: 'Precipitation', unit: 'mm' },
  { id: 'clouds_new', label: 'Cloud Cover', unit: '%' },
  { id: 'wind_new', label: 'Wind Speed', unit: 'm/s' },
  { id: 'pressure_new', label: 'Pressure', unit: 'hPa' },
];

/** Returns an OWM tile URL template, or null if no API key is configured */
export function getOwmTileUrl(layer: OwmTileLayer): string | null {
  const key = getRuntimeConfigSnapshot().secrets.OWM_API_KEY?.value;
  if (!key) return null;
  return `https://tile.openweathermap.org/map/${layer}/{z}/{x}/{y}.png?appid=${key}`;
}

/** Check if OWM tiles are available (key is configured) */
export function isOwmAvailable(): boolean {
  return Boolean(getRuntimeConfigSnapshot().secrets.OWM_API_KEY?.value);
}
