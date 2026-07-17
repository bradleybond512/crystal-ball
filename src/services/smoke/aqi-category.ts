/** EPA US-AQI category boundaries — single source of truth for thresholds. */
import type { AqiCategory } from './smoke-types';

/** Callout/alert boundary: 101 = start of Unhealthy for Sensitive Groups. */
export const USG_THRESHOLD = 101;

export function categorizeUsAqi(usAqi: number | null): AqiCategory {
  if (usAqi === null || Number.isNaN(usAqi)) return 'unknown';
  if (usAqi <= 50) return 'good';
  if (usAqi <= 100) return 'moderate';
  if (usAqi <= 150) return 'usg';
  if (usAqi <= 200) return 'unhealthy';
  if (usAqi <= 300) return 'very_unhealthy';
  return 'hazardous';
}

export const AQI_CATEGORY_LABEL: Record<AqiCategory, string> = {
  good: 'Good',
  moderate: 'Moderate',
  usg: 'Unhealthy for Sensitive Groups',
  unhealthy: 'Unhealthy',
  very_unhealthy: 'Very Unhealthy',
  hazardous: 'Hazardous',
  unknown: 'Unknown',
};

/** Design-token key per category (renderers resolve to CSS). */
export const AQI_CATEGORY_TONE: Record<AqiCategory, 'ok' | 'warn' | 'bad' | 'critical' | 'muted'> = {
  good: 'ok',
  moderate: 'warn',
  usg: 'warn',
  unhealthy: 'bad',
  very_unhealthy: 'critical',
  hazardous: 'critical',
  unknown: 'muted',
};
