/**
 * Commodity playbooks — plan section "Commodity Playbooks" (lines 108-142).
 *
 * Each playbook is a static fact sheet describing a commodity's:
 *   - leading / confirming / invalidating indicators
 *   - seasonal exposure
 *   - chokepoints and most-affected geographies/sectors
 *   - default forecast horizon
 *
 * The first batch covers wheat (food) and diesel (energy). Adding a
 * new commodity = adding a new entry plus a model file that reads from
 * the same indicator key namespace.
 *
 * Playbooks are intentionally NOT models. They define what to look at;
 * the per-commodity *-shortage-risk.ts files do the math.
 */

import type { CommodityPlaybook } from './shortage-types';

export const WHEAT_PLAYBOOK: CommodityPlaybook = {
  commodity: 'wheat',
  domain: 'food',
  leadingIndicators: [
    'rainfall_pct_of_normal',
    'soil_moisture_percentile',
    'ndvi_anomaly',
    'fertilizer_price_yoy',
    'planting_progress_pct',
    'export_corridor_status',
  ],
  confirmingIndicators: [
    'local_wheat_price_mom',
    'futures_curve_tightness',
    'export_ban_count',
    'fews_net_stage',
  ],
  invalidatingIndicators: [
    'late_season_rainfall_recovery',
    'export_ban_lifted',
    'inventory_release_announced',
  ],
  // Northern Hemisphere planting Sep-Nov, growth Mar-May, harvest Jun-Aug.
  // Markets care most when those windows overlap with stress signals.
  seasonalRiskMonths: [3, 4, 5, 6, 7, 8],
  chokepoints: ['Black Sea ports', 'Bosphorus Strait', 'Suez Canal', 'Mississippi River'],
  // Top exporters/importers most exposed to disruption.
  affectedCountries: ['UA', 'RU', 'US', 'CA', 'AU', 'FR', 'EG', 'TR', 'ID', 'BD'],
  affectedSectors: ['food retail', 'humanitarian aid', 'livestock feed', 'baking'],
  forecastHorizonDays: 60,
};

export const DIESEL_PLAYBOOK: CommodityPlaybook = {
  commodity: 'diesel',
  domain: 'energy',
  leadingIndicators: [
    'distillate_inventory_vs_5yr',
    'refinery_utilization_pct',
    'crude_imports_wow',
    'crack_spread_distillate',
    'refinery_outage_capacity_pct',
    'gulf_weather_risk',
  ],
  confirmingIndicators: [
    'diesel_retail_price_wow',
    'freight_demand_index',
    'futures_curve_distillate',
    'spr_release_announcement',
  ],
  invalidatingIndicators: [
    'refinery_back_online',
    'inventory_build_consecutive',
    'crack_spread_normalizing',
  ],
  // US winter heating + summer freight peak. Hurricane season Jun-Nov
  // hits the Gulf refining corridor.
  seasonalRiskMonths: [6, 7, 8, 9, 10, 11, 12, 1, 2],
  chokepoints: [
    'US Gulf Coast refineries',
    'Strait of Hormuz',
    'Rotterdam ARA hub',
    'Singapore distillate hub',
  ],
  affectedCountries: ['US', 'CA', 'MX', 'NL', 'DE', 'IN', 'BR', 'SG'],
  affectedSectors: ['trucking', 'farming', 'rail', 'mining', 'maritime', 'construction'],
  forecastHorizonDays: 30,
};

export const CORN_PLAYBOOK: CommodityPlaybook = {
  commodity: 'corn',
  domain: 'food',
  leadingIndicators: [
    'rainfall_pct_of_normal',
    'soil_moisture_percentile',
    'ndvi_anomaly',
    'gdd_accumulation_pct',
    'pollination_window_temp_anomaly_c',
    'fertilizer_price_yoy',
    'ethanol_demand_index',
  ],
  confirmingIndicators: [
    'usda_crop_condition_g_e_pct',
    'local_corn_price_mom',
    'futures_curve_tightness',
    'feedlot_demand_index',
  ],
  invalidatingIndicators: [
    'late_season_rainfall_recovery',
    'usda_yield_upgrade',
    'pollination_temps_normalize',
  ],
  // Corn Belt plant Apr-May, pollinate Jul, harvest Sep-Oct. Pollination
  // heat stress is the highest-risk window.
  seasonalRiskMonths: [5, 6, 7, 8, 9, 10],
  chokepoints: ['Mississippi River barge corridor', 'Gulf of Mexico export ports', 'Panama Canal'],
  // Top US producing states + major importers.
  affectedCountries: ['US', 'CN', 'BR', 'AR', 'MX', 'JP', 'KR', 'EG'],
  affectedSectors: ['livestock feed', 'ethanol', 'food processing', 'sweeteners'],
  forecastHorizonDays: 90,
};

export const GASOLINE_PLAYBOOK: CommodityPlaybook = {
  commodity: 'gasoline',
  domain: 'energy',
  leadingIndicators: [
    'gasoline_inventory_vs_5yr',
    'refinery_utilization_pct',
    'crude_imports_wow',
    'crack_spread_gasoline',
    'refinery_outage_capacity_pct',
    'driving_season_demand_proxy',
    'rbob_futures_backwardation',
  ],
  confirmingIndicators: [
    'retail_gasoline_price_wow',
    'futures_curve_gasoline',
    'pipeline_disruption_active',
    'ethanol_blend_disruption',
  ],
  invalidatingIndicators: [
    'refinery_back_online',
    'inventory_build_consecutive',
    'crack_spread_gasoline_normalizing',
  ],
  // US summer driving season is the headline demand window. Hurricane
  // season Jun-Nov + winter blend transitions Mar-May add stress points.
  seasonalRiskMonths: [3, 4, 5, 6, 7, 8, 9],
  chokepoints: [
    'US Gulf Coast refineries',
    'Colonial Pipeline',
    'PADD 5 (West Coast) isolation',
    'NW Europe ARA hub',
  ],
  affectedCountries: ['US', 'CA', 'MX', 'NL', 'DE', 'GB', 'JP'],
  affectedSectors: ['retail fuel', 'automotive', 'aviation feedstock', 'logistics'],
  forecastHorizonDays: 30,
};

export const ALL_PLAYBOOKS: readonly CommodityPlaybook[] = [
  WHEAT_PLAYBOOK,
  CORN_PLAYBOOK,
  DIESEL_PLAYBOOK,
  GASOLINE_PLAYBOOK,
];

/** Lookup helper — preferred over reaching into ALL_PLAYBOOKS directly. */
export function getPlaybook(commodity: string): CommodityPlaybook | undefined {
  const lc = commodity.toLowerCase();
  return ALL_PLAYBOOKS.find((p) => p.commodity === lc);
}

/** True if `month` (1-12) is inside the playbook's seasonal risk window.
 *  Handles wrap-around (e.g. diesel's Sep-Feb window). */
export function isSeasonalRisk(playbook: CommodityPlaybook, month: number): boolean {
  return playbook.seasonalRiskMonths.includes(month);
}
