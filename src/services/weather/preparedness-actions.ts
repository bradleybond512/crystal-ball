/**
 * Weather preparedness action cards — per
 * docs/WEATHER_WARNING_REMEDIATION_PLAN.md section 6 (lines 148-181).
 *
 * Per-hazard action lists the user can take RIGHT NOW. Pure data, no
 * runtime side effects. Storm Mode (and any other consumer) reads from
 * this module to render its action cards.
 *
 * Plan invariant: "Make every major alert actionable." The action sets
 * here are calm, specific, and proportionate — no "general weather
 * preparedness" mush.
 */

import type { WeatherHazardKind } from './weather-threat-types';

// ── Action shape ─────────────────────────────────────────────────────────

export interface PreparednessAction {
  /** Stable id for analytics + checkbox state. */
  id: string;
  /** Short imperative label ("Charge phone", "Move to interior room"). */
  label: string;
  /** Optional longer rationale shown on hover. */
  rationale?: string;
  /** Priority 1 = critical (do now), 5 = nice-to-have. */
  priority: 1 | 2 | 3 | 4 | 5;
  /** Estimated minutes to complete — drives ordering when arrival
   *  window is short. */
  estimatedMinutes: number;
}

// ── Action library ───────────────────────────────────────────────────────

const TORNADO_ACTIONS: PreparednessAction[] = [
  { id: 'tornado-shelter', label: 'Move to lowest interior room without windows', rationale: 'Bathrooms and basements offer best protection from rotating winds and debris.', priority: 1, estimatedMinutes: 1 },
  { id: 'tornado-shoes', label: 'Put shoes on', rationale: 'Glass and debris in the aftermath cause most secondary injuries.', priority: 1, estimatedMinutes: 1 },
  { id: 'tornado-helmet', label: 'Use a bike or sports helmet if available', rationale: 'Head injuries are the leading cause of tornado fatalities.', priority: 1, estimatedMinutes: 1 },
  { id: 'tornado-bring-phone', label: 'Bring phone + charger to your shelter spot', rationale: 'You may need to call 911 or signal for help after.', priority: 2, estimatedMinutes: 1 },
  { id: 'tornado-avoid-windows', label: 'Stay away from windows', priority: 1, estimatedMinutes: 0 },
];

const SEVERE_TS_ACTIONS: PreparednessAction[] = [
  { id: 'wind-secure-items', label: 'Secure or bring in loose outdoor items', rationale: 'Patio furniture and trash cans become projectiles in 60+ mph gusts.', priority: 2, estimatedMinutes: 5 },
  { id: 'wind-avoid-windows', label: 'Avoid trees and windows', priority: 2, estimatedMinutes: 0 },
  { id: 'wind-charge', label: 'Charge phone, laptop, and battery pack', rationale: 'Outage risk is high — keep your communication channels alive.', priority: 2, estimatedMinutes: 5 },
  { id: 'wind-flashlight', label: 'Locate flashlights and check batteries', priority: 3, estimatedMinutes: 3 },
  { id: 'wind-park-away', label: 'Park vehicles away from trees', priority: 3, estimatedMinutes: 5 },
];

const HIGH_WIND_ACTIONS: PreparednessAction[] = [
  { id: 'wind-secure-items', label: 'Secure or bring in loose outdoor items', priority: 2, estimatedMinutes: 5 },
  { id: 'wind-avoid-driving', label: 'Avoid driving high-profile vehicles', rationale: 'High wind warnings include dangerous crosswinds for trucks/SUVs/RVs.', priority: 3, estimatedMinutes: 0 },
  { id: 'wind-charge', label: 'Charge devices', priority: 2, estimatedMinutes: 5 },
];

const FLASH_FLOOD_ACTIONS: PreparednessAction[] = [
  { id: 'flood-avoid-crossings', label: 'Avoid low-water crossings — turn around, do not drown', rationale: '6 inches of moving water can knock down an adult; 12 inches can carry off a vehicle.', priority: 1, estimatedMinutes: 0 },
  { id: 'flood-move-vehicle', label: 'Move vehicle to higher ground', priority: 2, estimatedMinutes: 10 },
  { id: 'flood-monitor-gauges', label: 'Monitor local creek + river gauges', priority: 3, estimatedMinutes: 2 },
  { id: 'flood-elevate', label: 'Move valuables to upper floor if at-risk', priority: 2, estimatedMinutes: 15 },
];

const FLOOD_ACTIONS: PreparednessAction[] = [
  { id: 'flood-monitor-gauges', label: 'Monitor river gauges + evacuation guidance', priority: 2, estimatedMinutes: 2 },
  { id: 'flood-prepare-go-bag', label: 'Prepare a go-bag (documents, meds, chargers)', priority: 3, estimatedMinutes: 20 },
  { id: 'flood-elevate', label: 'Move valuables to upper floor', priority: 2, estimatedMinutes: 30 },
];

const TROPICAL_ACTIONS: PreparednessAction[] = [
  { id: 'tropical-fuel', label: 'Top off fuel and pick up cash', priority: 2, estimatedMinutes: 30 },
  { id: 'tropical-water', label: 'Fill containers with drinking water (1 gal/person/day)', priority: 2, estimatedMinutes: 15 },
  { id: 'tropical-evac', label: 'Review evacuation routes + shelter locations', priority: 1, estimatedMinutes: 10 },
  { id: 'tropical-secure', label: 'Bring in or secure outdoor items + windows', priority: 2, estimatedMinutes: 30 },
  { id: 'tropical-charge', label: 'Charge all devices + portable power', priority: 2, estimatedMinutes: 5 },
];

const STORM_SURGE_ACTIONS: PreparednessAction[] = [
  { id: 'surge-evac', label: 'Evacuate per local orders — surge is the deadliest hazard', priority: 1, estimatedMinutes: 60 },
  { id: 'surge-vehicle', label: 'Move vehicles to higher ground', priority: 2, estimatedMinutes: 15 },
  { id: 'surge-elevate', label: 'Elevate or bag valuables', priority: 3, estimatedMinutes: 30 },
];

const WINTER_STORM_ACTIONS: PreparednessAction[] = [
  { id: 'winter-stockpile', label: 'Stock food + water for 3 days', priority: 2, estimatedMinutes: 30 },
  { id: 'winter-fuel', label: 'Top off fuel + check generator', priority: 2, estimatedMinutes: 20 },
  { id: 'winter-warm-room', label: 'Designate one warm room if power fails', priority: 2, estimatedMinutes: 10 },
  { id: 'winter-pipes', label: 'Drip faucets to prevent frozen pipes', priority: 3, estimatedMinutes: 5 },
  { id: 'winter-charge', label: 'Charge devices + battery packs', priority: 2, estimatedMinutes: 5 },
];

const BLIZZARD_ACTIONS: PreparednessAction[] = [
  { id: 'blizzard-stay-home', label: 'Stay off roads — visibility will be near-zero', priority: 1, estimatedMinutes: 0 },
  ...WINTER_STORM_ACTIONS,
];

const ICE_STORM_ACTIONS: PreparednessAction[] = [
  { id: 'ice-no-driving', label: 'Avoid all driving — ice is invisible and unpredictable', priority: 1, estimatedMinutes: 0 },
  { id: 'ice-charge', label: 'Charge devices — ice storms cause prolonged outages', priority: 2, estimatedMinutes: 5 },
  { id: 'ice-water', label: 'Fill water containers in case pipes freeze', priority: 2, estimatedMinutes: 10 },
];

const HEAT_ACTIONS: PreparednessAction[] = [
  { id: 'heat-hydrate', label: 'Drink water before you feel thirsty', priority: 2, estimatedMinutes: 0 },
  { id: 'heat-cool-room', label: 'Stay in air conditioning during peak hours', priority: 1, estimatedMinutes: 0 },
  { id: 'heat-check-on-others', label: 'Check on elderly neighbors / family', priority: 2, estimatedMinutes: 10 },
  { id: 'heat-no-cars', label: 'Never leave kids or pets in cars — ever', priority: 1, estimatedMinutes: 0 },
];

const COLD_ACTIONS: PreparednessAction[] = [
  { id: 'cold-layer-up', label: 'Dress in layers + cover exposed skin outdoors', priority: 2, estimatedMinutes: 5 },
  { id: 'cold-pipes', label: 'Drip faucets to prevent frozen pipes', priority: 3, estimatedMinutes: 5 },
  { id: 'cold-pets', label: 'Bring pets indoors', priority: 1, estimatedMinutes: 5 },
];

const FIRE_WEATHER_ACTIONS: PreparednessAction[] = [
  { id: 'fire-no-burn', label: 'Avoid all outdoor burning + sparks', priority: 1, estimatedMinutes: 0 },
  { id: 'fire-go-bag', label: 'Pack a go-bag in case of evacuation', priority: 2, estimatedMinutes: 30 },
  { id: 'fire-clear-vents', label: 'Close windows + outside vents to limit smoke entry', priority: 2, estimatedMinutes: 10 },
];

const WILDFIRE_SMOKE_ACTIONS: PreparednessAction[] = [
  { id: 'smoke-stay-in', label: 'Stay indoors; close windows + outside air vents', priority: 1, estimatedMinutes: 5 },
  { id: 'smoke-recirc', label: 'Run HVAC/AC on recirculate, not fresh-air intake', priority: 1, estimatedMinutes: 3 },
  { id: 'smoke-purifier', label: 'Run an air purifier / box-fan filter in your main room', rationale: 'A HEPA or MERV-13 filter cuts indoor smoke particulates fast.', priority: 2, estimatedMinutes: 10 },
  { id: 'smoke-mask', label: 'Wear an N95/KN95 if you must go outside', priority: 2, estimatedMinutes: 0 },
  { id: 'smoke-sensitive', label: 'Limit outdoor exertion — esp. kids, elderly, heart/lung conditions', priority: 2, estimatedMinutes: 0 },
];

const POWER_OUTAGE_ACTIONS: PreparednessAction[] = [
  { id: 'outage-charge', label: 'Charge phone + battery packs', priority: 1, estimatedMinutes: 5 },
  { id: 'outage-fridge', label: 'Avoid opening the refrigerator', rationale: 'A closed fridge keeps food cold for 4+ hours; an opened one drops fast.', priority: 2, estimatedMinutes: 0 },
  { id: 'outage-report', label: 'Report outage to your utility', priority: 2, estimatedMinutes: 3 },
  { id: 'outage-flashlight', label: 'Keep flashlights handy — never use candles', priority: 2, estimatedMinutes: 5 },
];

const DEFAULT_ACTIONS: PreparednessAction[] = [
  { id: 'generic-charge', label: 'Charge devices', priority: 3, estimatedMinutes: 5 },
  { id: 'generic-monitor', label: 'Monitor local NWS updates', priority: 3, estimatedMinutes: 0 },
];

const ACTIONS_BY_HAZARD: Record<WeatherHazardKind, PreparednessAction[]> = {
  tornado: TORNADO_ACTIONS,
  severe_thunderstorm: SEVERE_TS_ACTIONS,
  flash_flood: FLASH_FLOOD_ACTIONS,
  flood: FLOOD_ACTIONS,
  high_wind: HIGH_WIND_ACTIONS,
  winter_storm: WINTER_STORM_ACTIONS,
  blizzard: BLIZZARD_ACTIONS,
  ice_storm: ICE_STORM_ACTIONS,
  extreme_heat: HEAT_ACTIONS,
  extreme_cold: COLD_ACTIONS,
  fire_weather: FIRE_WEATHER_ACTIONS,
  wildfire_smoke: WILDFIRE_SMOKE_ACTIONS,
  tropical: TROPICAL_ACTIONS,
  storm_surge: STORM_SURGE_ACTIONS,
  special_marine: SEVERE_TS_ACTIONS,
  dust_storm: HIGH_WIND_ACTIONS,
  other: DEFAULT_ACTIONS,
};

// ── Public API ───────────────────────────────────────────────────────────

export interface ActionsForOptions {
  /** Maximum actions to return. Default 5. */
  max?: number;
  /** When set, only actions estimated to complete within this many
   *  minutes are returned. Used when arrival window is short. */
  maxMinutesAvailable?: number;
  /** Add power-outage actions when true (e.g. severe wind warnings
   *  routinely cause outages). */
  includeOutageActions?: boolean;
}

export function actionsForHazard(
  hazard: WeatherHazardKind,
  options: ActionsForOptions = {},
): PreparednessAction[] {
  const max = options.max ?? 5;
  const base = [...(ACTIONS_BY_HAZARD[hazard] ?? DEFAULT_ACTIONS)];
  if (options.includeOutageActions) {
    for (const a of POWER_OUTAGE_ACTIONS) {
      if (!base.some((b) => b.id === a.id)) base.push(a);
    }
  }
  // Filter by time budget.
  const filtered = options.maxMinutesAvailable === undefined
    ? base
    : base.filter((a) => a.estimatedMinutes <= options.maxMinutesAvailable!);
  // Sort by priority asc, then estimated minutes asc (fast-and-critical first).
  filtered.sort((a, b) => a.priority - b.priority || a.estimatedMinutes - b.estimatedMinutes);
  return filtered.slice(0, max);
}

/** Direct access for the UI when it wants the full unfiltered list. */
export function allActionsForHazard(hazard: WeatherHazardKind): readonly PreparednessAction[] {
  return ACTIONS_BY_HAZARD[hazard] ?? DEFAULT_ACTIONS;
}
