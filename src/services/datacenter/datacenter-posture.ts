import type { GridStatus } from '../power-grid.ts';
import type { NwsAlertMinimal } from '../weather/weather-threat-types.ts';
import type { DataCenterPosture, DcLevel, SiteConfig } from './datacenter-types.ts';
import { bumpDcLevel, dcLevelRank, maxDcLevel } from './datacenter-types.ts';
import { computePowerPosture } from './power-posture.ts';
import { computeWeatherPosture } from './weather-posture.ts';
import { buildReadinessActions } from './readiness-actions.ts';

export interface PostureInput {
  site: SiteConfig;
  gridStatus: GridStatus | null;
  weatherAlerts: readonly NwsAlertMinimal[];
  nearbyOutageCount: number | null;
  now?: number;
}

function blendOverall(power: DcLevel, weather: DcLevel): DcLevel {
  const higher = maxDcLevel(power, weather);
  const bothElevated =
    dcLevelRank(power) >= dcLevelRank('advisory') &&
    dcLevelRank(weather) >= dcLevelRank('advisory');
  return bothElevated ? bumpDcLevel(higher) : higher;
}

function buildHeadline(
  overall: DcLevel,
  weather: ReturnType<typeof computeWeatherPosture>,
  power: ReturnType<typeof computePowerPosture>,
): string {
  if (overall === 'normal') return 'No power or weather action needed — monitoring';
  const parts: string[] = [];
  if (weather.stormMode) {
    const mins = weather.arrivalWindowMins;
    const label = weather.stormMode.mainThreatLabel;
    parts.push(mins === null ? label : `${label} ~${mins} min out`);
  } else if (weather.activeHazards.length > 0) {
    parts.push(`${weather.activeHazards[0]} nearby`);
  }
  parts.push(power.level === 'normal' ? 'grid normal' : `grid ${power.level}`);
  return parts.join(' · ');
}

export function computeDatacenterPosture(input: PostureInput): DataCenterPosture {
  const now = input.now ?? Date.now();
  const staleInputs: string[] = [];
  if (!input.gridStatus) staleInputs.push('grid');
  if (input.nearbyOutageCount === null) staleInputs.push('outages');

  const power = computePowerPosture({
    gridUtilizationPct: input.gridStatus ? input.gridStatus.utilizationPct : null,
    gridAlerts: input.gridStatus ? input.gridStatus.alerts : [],
    nearbyOutageCount: input.nearbyOutageCount,
  });
  const weather = computeWeatherPosture(input.site, input.weatherAlerts, { now });
  const overall = blendOverall(power.level, weather.level);
  const actions = buildReadinessActions(power, weather, { now, overall });

  return {
    site: input.site,
    overall,
    headline: buildHeadline(overall, weather, power),
    power,
    weather,
    actions,
    updatedAt: now,
    staleInputs,
  };
}
