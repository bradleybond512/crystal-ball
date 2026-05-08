/**
 * Pure helpers for the wastewater-states globe layer. Builds entity
 * descriptors at state centroids, sized + colored by the state-rollup
 * level. Extracted from GlobeDataManager so the geometry/color
 * computations can be unit-tested without spinning up Cesium.
 */

import {
  WW_LEVEL_COLOR,
  type NwssStateRollup,
  type WwLevel,
} from '@/services/biosurveillance/wastewater-service';
import { US_STATE_CENTROIDS } from '@/services/infrastructure/infrastructure-overlay';

export interface WastewaterStateEntity {
  stateCode: string;
  stateName: string;
  lat: number;
  lon: number;
  level: WwLevel;
  /** Hex color for the marker fill. */
  fillColor: string;
  /** Pixel radius — scales with level so high spots stand out. */
  radiusPx: number;
  description: string;
}

const RADIUS_BY_LEVEL: Readonly<Record<WwLevel, number>> = {
  high: 26,
  elevated: 20,
  moderate: 14,
  low: 10,
};

/** Convert state rollups → globe entity descriptors. States without a
 *  known centroid are dropped (so we never plot at 0,0). 'low'-level
 *  states are dropped by default to keep the globe readable; pass
 *  `{ includeLow: true }` to surface them too. */
export function buildWastewaterStateEntities(
  states: readonly NwssStateRollup[],
  options: { includeLow?: boolean } = {},
): WastewaterStateEntity[] {
  const includeLow = options.includeLow ?? false;
  const out: WastewaterStateEntity[] = [];
  for (const s of states) {
    if (!includeLow && s.level === 'low') continue;
    const centroid = US_STATE_CENTROIDS[s.stateCode];
    if (!centroid) continue;
    out.push({
      stateCode: s.stateCode,
      stateName: s.state,
      lat: centroid.lat,
      lon: centroid.lon,
      level: s.level,
      fillColor: WW_LEVEL_COLOR[s.level],
      radiusPx: RADIUS_BY_LEVEL[s.level],
      description: buildEntityDescription(s),
    });
  }
  out.sort((a, b) => RADIUS_BY_LEVEL[b.level] - RADIUS_BY_LEVEL[a.level]);
  return out;
}

function formatPtc(ptc: number | null): string {
  if (ptc === null) return '—';
  const sign = ptc > 0 ? '+' : '';
  return `${sign}${ptc.toFixed(0)}%`;
}

function buildEntityDescription(s: NwssStateRollup): string {
  const percentile = s.medianPercentile15d === null ? '—' : s.medianPercentile15d.toFixed(0);
  const ptc = formatPtc(s.medianPtc15d);
  const trendLabel = s.trend.charAt(0).toUpperCase() + s.trend.slice(1);
  return [
    `Wastewater · ${s.state} (${s.stateCode})`,
    `Level: ${s.level.toUpperCase()}`,
    `Median percentile: ${percentile}`,
    `15-day change: ${ptc} (${trendLabel})`,
    `${s.siteCount} reporting site${s.siteCount === 1 ? '' : 's'}`,
  ].join('\n');
}
