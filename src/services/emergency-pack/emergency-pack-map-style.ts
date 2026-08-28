import type { SiteVariant } from '@/config/variant.ts';

export type PersistedEmergencyPackBaseMap = 'dark' | 'light' | 'satellite' | 'terrain';
export type EmergencyPackBaseMap = PersistedEmergencyPackBaseMap | 'emergency';
export type EmergencyPackMapTheme = 'dark' | 'light';

const PERSISTED_BASE_MAPS = new Set<PersistedEmergencyPackBaseMap>([
  'dark',
  'light',
  'satellite',
  'terrain',
]);

export function isEmergencyPackBaseMap(value: unknown): value is EmergencyPackBaseMap {
  return value === 'emergency' || PERSISTED_BASE_MAPS.has(value as PersistedEmergencyPackBaseMap);
}

export function persistedEmergencyPackBaseMap(value: unknown): PersistedEmergencyPackBaseMap | null {
  return PERSISTED_BASE_MAPS.has(value as PersistedEmergencyPackBaseMap)
    ? value as PersistedEmergencyPackBaseMap
    : null;
}

export function resolveEmergencyPackInitialBaseMap(
  saved: unknown,
  theme: EmergencyPackMapTheme,
): PersistedEmergencyPackBaseMap {
  return persistedEmergencyPackBaseMap(saved) ?? theme;
}

export function resolveEmergencyPackThemeBaseMap(
  active: EmergencyPackBaseMap,
  theme: EmergencyPackMapTheme,
): EmergencyPackBaseMap {
  return active === 'dark' || active === 'light' ? theme : active;
}

export function getEmergencyPackBaseMapStyleUrl(
  basemap: EmergencyPackBaseMap,
  variant: SiteVariant,
): string {
  switch (basemap) {
    case 'emergency': {
      return '/map-styles/emergency.json';
    }
    case 'satellite': {
      return '/map-styles/satellite.json';
    }
    case 'terrain': {
      return '/map-styles/terrain.json';
    }
    case 'light': {
      return variant === 'happy' ? '/map-styles/happy-light.json' : '/map-styles/light.json';
    }
    case 'dark': {
      return variant === 'happy' ? '/map-styles/happy-dark.json' : '/map-styles/dark.json';
    }
  }
}
