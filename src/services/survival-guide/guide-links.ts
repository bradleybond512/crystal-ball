/**
 * Maps live-situation taxonomies onto survival guides so reactive surfaces
 * (Action Brief, Storm Mode, dossier) can deep-link to the right reference.
 * Pure. Must be TOTAL over both source unions — enforced by unit test + tsc.
 */

import type { GuideId } from './guide-types';
import type { PlaybookCategory } from '../insights/reaction-playbooks';
import type { WeatherHazardKind } from '../weather/weather-threat-types';

/** Each PlaybookCategory -> one or more guides (most-relevant first). */
export const GUIDES_BY_PLAYBOOK_CATEGORY: Record<PlaybookCategory, readonly GuideId[]> = {
  severe_weather: ['severe_thunderstorm', 'tornado', 'flood', 'shelter_in_place'],
  wildfire: ['wildfire', 'wildfire_smoke', 'evacuation_planning'],
  oil_fuel_shortage: ['fuel_shortage'],
  food_shortage: ['food_shortage', 'food_storage'],
  cyber_campaign: ['cyber_banking_outage'],
  banking_outage: ['cyber_banking_outage'],
  conflict_escalation: ['armed_conflict', 'shelter_in_place', 'go_bag'],
  travel_disruption: ['evacuation_planning', 'go_bag'],
  grid_outage: ['power_grid_outage'],
  disease_outbreak: ['disease_outbreak'],
  earthquake: ['earthquake', 'shelter_in_place'],
};

/** Each WeatherHazardKind -> the single best guide. */
export const GUIDE_BY_WEATHER_HAZARD: Record<WeatherHazardKind, GuideId> = {
  tornado: 'tornado',
  severe_thunderstorm: 'severe_thunderstorm',
  flash_flood: 'flood',
  flood: 'flood',
  high_wind: 'severe_thunderstorm',
  winter_storm: 'winter_storm',
  blizzard: 'winter_storm',
  ice_storm: 'winter_storm',
  extreme_heat: 'extreme_heat',
  extreme_cold: 'winter_storm',
  fire_weather: 'wildfire',
  wildfire_smoke: 'wildfire_smoke',
  tropical: 'hurricane',
  storm_surge: 'hurricane',
  special_marine: 'shelter_in_place',
  dust_storm: 'wildfire_smoke',
  other: 'shelter_in_place',
};

export function guidesForPlaybookCategory(cat: PlaybookCategory): readonly GuideId[] {
  return GUIDES_BY_PLAYBOOK_CATEGORY[cat] ?? [];
}

export function guideForWeatherHazard(hazard: WeatherHazardKind): GuideId | undefined {
  return GUIDE_BY_WEATHER_HAZARD[hazard];
}
