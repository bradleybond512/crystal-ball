// Base configuration shared across all variants
import type { PanelConfig, MapLayers } from '@/types';

// Shared exports (re-exported by all variants)
export { SECTORS, COMMODITIES, MARKET_SYMBOLS } from '../markets';
export { UNDERSEA_CABLES } from '../geo';
export { AI_DATA_CENTERS } from '../ai-datacenters';

// Refresh intervals - shared across all variants
export const REFRESH_INTERVALS = {
  feeds: 10 * 60 * 1000,
  markets: 8 * 60 * 1000,
  crypto: 8 * 60 * 1000,
  predictions: 10 * 60 * 1000,
  ais: 10 * 60 * 1000,
};

// Monitor colors - shared
export const MONITOR_COLORS = [
  '#44ff88',
  '#ff8844',
  '#4488ff',
  '#ff44ff',
  '#ffff44',
  '#ff453a',
  '#44ffff',
  '#88ff44',
  '#ff88ff',
  '#88ffff',
];

// Storage keys - shared
export const STORAGE_KEYS = {
  panels: 'crystalball-panels',
  monitors: 'crystalball-monitors',
  mapLayers: 'crystalball-layers',
  disabledFeeds: 'crystalball-disabled-feeds',
  liveChannels: 'crystalball-live-channels',
} as const;

// Type definitions for variant configs
export interface VariantConfig {
  name: string;
  description: string;
  panels: Record<string, PanelConfig>;
  mapLayers: MapLayers;
  mobileMapLayers: MapLayers;
}
