/**
 * Pure helpers for the war-risk-zone and infrastructure-overlay globe
 * layers. No DOM, no fetch, no Cesium — testable with static inputs.
 */

import type { Severity } from '@/services/infrastructure/grid-monitor';
import type { WarRiskZone } from '@/services/maritime/maritime-threats';

export interface WarZoneColors {
  outlineHex: string;
  fillHex: string;
  fillAlpha: number;
}

const WAR_ZONE_PALETTE: Readonly<Record<WarRiskZone['threatCategory'], WarZoneColors>> = {
  state_conflict: { outlineHex: '#dc2626', fillHex: '#dc2626', fillAlpha: 0.18 },
  missile_drone:  { outlineHex: '#a855f7', fillHex: '#a855f7', fillAlpha: 0.18 },
  piracy:         { outlineHex: '#f97316', fillHex: '#f97316', fillAlpha: 0.18 },
  mixed:          { outlineHex: '#facc15', fillHex: '#facc15', fillAlpha: 0.18 },
};

export function warZoneColors(category: WarRiskZone['threatCategory']): WarZoneColors {
  return WAR_ZONE_PALETTE[category];
}

export interface OutageRectExtent {
  west: number;
  south: number;
  east: number;
  north: number;
}

const SEVERITY_HALF_WIDTH_DEG: Readonly<Record<Severity, number>> = {
  normal: 0,
  elevated: 1.6,
  high: 2,
  major: 2.4,
  extreme: 2.8,
};

const SEVERITY_HALF_HEIGHT_DEG: Readonly<Record<Severity, number>> = {
  normal: 0,
  elevated: 1.2,
  high: 1.5,
  major: 1.8,
  extreme: 2.1,
};

/**
 * Axis-aligned rectangle centered on (lat, lon) sized by severity.
 * The on-screen footprint is a stylized choropleth tile — actual state
 * GeoJSON would inflate the bundle and isn't required to communicate
 * "this state is in trouble."
 */
export function outageRectExtent(lat: number, lon: number, severity: Severity): OutageRectExtent {
  const halfW = SEVERITY_HALF_WIDTH_DEG[severity];
  const halfH = SEVERITY_HALF_HEIGHT_DEG[severity];
  return {
    west: lon - halfW,
    south: lat - halfH,
    east: lon + halfW,
    north: lat + halfH,
  };
}

/**
 * Pulse pixelSize for RadNet dots. Same triangle-wave shape as the
 * X-flare halo but in pixels rather than metres.
 */
export function radnetPulsePixelSize(
  elapsedMs: number,
  pulsePeriodMs: number,
  minPx = 8,
  maxPx = 22,
): number {
  if (pulsePeriodMs <= 0) return (minPx + maxPx) / 2;
  const period = pulsePeriodMs;
  const norm = ((elapsedMs % period) + period) % period;
  const phase = norm / period;
  const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2;
  return minPx + (maxPx - minPx) * tri;
}
