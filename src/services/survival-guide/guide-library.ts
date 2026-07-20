/**
 * Aggregates the 24 per-guide content files into one library + lookups.
 * Pure. No DOM, no fetch.
 */

import type { GuideId, SurvivalGuide } from './guide-types';

import { TORNADO_GUIDE } from './guides/tornado';
import { FLOOD_GUIDE } from './guides/flood';
import { HURRICANE_GUIDE } from './guides/hurricane';
import { SEVERE_THUNDERSTORM_GUIDE } from './guides/severe-thunderstorm';
import { WINTER_STORM_GUIDE } from './guides/winter-storm';
import { EXTREME_HEAT_GUIDE } from './guides/extreme-heat';
import { WILDFIRE_GUIDE } from './guides/wildfire';
import { WILDFIRE_SMOKE_GUIDE } from './guides/wildfire-smoke';
import { EARTHQUAKE_GUIDE } from './guides/earthquake';
import { POWER_GRID_OUTAGE_GUIDE } from './guides/power-grid-outage';
import { FUEL_SHORTAGE_GUIDE } from './guides/fuel-shortage';
import { FOOD_SHORTAGE_GUIDE } from './guides/food-shortage';
import { DISEASE_OUTBREAK_GUIDE } from './guides/disease-outbreak';
import { CYBER_BANKING_OUTAGE_GUIDE } from './guides/cyber-banking-outage';
import { CIVIL_UNREST_GUIDE } from './guides/civil-unrest';
import { ARMED_CONFLICT_GUIDE } from './guides/armed-conflict';
import { NUCLEAR_RADIOLOGICAL_GUIDE } from './guides/nuclear-radiological';
import { GO_BAG_GUIDE } from './guides/go-bag';
import { WATER_STORAGE_GUIDE } from './guides/water-storage';
import { FOOD_STORAGE_GUIDE } from './guides/food-storage';
import { FAMILY_COMMS_PLAN_GUIDE } from './guides/family-comms-plan';
import { FIRST_AID_BASICS_GUIDE } from './guides/first-aid-basics';
import { EVACUATION_PLANNING_GUIDE } from './guides/evacuation-planning';
import { SHELTER_IN_PLACE_GUIDE } from './guides/shelter-in-place';

/** Library order = display order (hazards first, then preparedness). */
export const ALL_GUIDES: readonly SurvivalGuide[] = [
  TORNADO_GUIDE,
  FLOOD_GUIDE,
  HURRICANE_GUIDE,
  SEVERE_THUNDERSTORM_GUIDE,
  WINTER_STORM_GUIDE,
  EXTREME_HEAT_GUIDE,
  WILDFIRE_GUIDE,
  WILDFIRE_SMOKE_GUIDE,
  EARTHQUAKE_GUIDE,
  POWER_GRID_OUTAGE_GUIDE,
  FUEL_SHORTAGE_GUIDE,
  FOOD_SHORTAGE_GUIDE,
  DISEASE_OUTBREAK_GUIDE,
  CYBER_BANKING_OUTAGE_GUIDE,
  CIVIL_UNREST_GUIDE,
  ARMED_CONFLICT_GUIDE,
  NUCLEAR_RADIOLOGICAL_GUIDE,
  GO_BAG_GUIDE,
  WATER_STORAGE_GUIDE,
  FOOD_STORAGE_GUIDE,
  FAMILY_COMMS_PLAN_GUIDE,
  FIRST_AID_BASICS_GUIDE,
  EVACUATION_PLANNING_GUIDE,
  SHELTER_IN_PLACE_GUIDE,
];

const BY_ID: ReadonlyMap<GuideId, SurvivalGuide> = new Map(ALL_GUIDES.map((g) => [g.id, g]));

export function allGuides(): readonly SurvivalGuide[] {
  return ALL_GUIDES;
}

export function getGuide(id: GuideId): SurvivalGuide | undefined {
  return BY_ID.get(id);
}

export function guidesByKind(kind: SurvivalGuide['kind']): SurvivalGuide[] {
  return ALL_GUIDES.filter((g) => g.kind === kind);
}
