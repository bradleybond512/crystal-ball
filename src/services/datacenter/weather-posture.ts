import type { NwsAlertMinimal, WeatherHazardKind } from '../weather/weather-threat-types.ts';
import type { SavedPlace as WeatherPlace } from '../weather/weather-threat-types.ts';
import { matchAlertToPlace } from '../weather/nws-polygon-match.ts';
import { buildStormModePayload } from '../weather/personal-storm-mode.ts';
import type { DcLevel, SiteConfig, WeatherPosture } from './datacenter-types.ts';
import { dcLevelRank, mapThreatLevelToDc } from './datacenter-types.ts';

export interface WeatherPostureOptions {
  now?: number;
}

export function computeWeatherPosture(
  site: SiteConfig,
  alerts: readonly NwsAlertMinimal[],
  options: WeatherPostureOptions = {},
): WeatherPosture {
  const now = options.now ?? Date.now();
  const place: WeatherPlace = { id: site.id, label: site.name, lat: site.lat, lon: site.lon, radiusKm: site.radiusKm, ugcZones: site.ugcZones };

  let level: DcLevel = 'normal';
  const hazards = new Set<WeatherHazardKind>();
  const drivers: string[] = [];
  let bestStormMode: WeatherPosture['stormMode'] = null;
  let bestStormRank = -1;
  let arrivalWindowMins: number | null = null;

  for (const alert of alerts) {
    const match = matchAlertToPlace(alert, place, { now });
    if (match.matchKind === 'no_match' || match.isCancellation) continue;

    const dc = mapThreatLevelToDc(match.threatLevel);
    if (dcLevelRank(dc) > dcLevelRank(level)) level = dc;
    hazards.add(match.hazardKind);
    drivers.push(`${match.event} — ${match.reason}`);

    if (
      match.matchKind === 'inside_polygon' ||
      match.matchKind === 'inside_zone' ||
      match.matchKind === 'near_polygon'
    ) {
      const payload = buildStormModePayload(match, site.name, { now });
      const rank = dcLevelRank(mapThreatLevelToDc(payload.threatLevel));
      if (rank > bestStormRank) {
        bestStormRank = rank;
        bestStormMode = payload;
        arrivalWindowMins = payload.arrivalWindow
          ? Math.max(0, Math.round((payload.arrivalWindow.earliestMs - now) / 60_000))
          : null;
      }
    }
  }

  return {
    level,
    activeHazards: [...hazards],
    stormMode: bestStormMode,
    arrivalWindowMins,
    drivers,
  };
}
