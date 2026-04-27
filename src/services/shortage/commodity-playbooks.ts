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

export const NATURAL_GAS_PLAYBOOK: CommodityPlaybook = {
  commodity: 'natural_gas',
  domain: 'energy',
  leadingIndicators: [
    'natgas_storage_vs_5yr',
    'heating_degree_days_vs_normal',
    'cooling_degree_days_vs_normal',
    'lng_export_capacity_pct',
    'production_pipeline_outage_pct',
    'henry_hub_basis_widening',
  ],
  confirmingIndicators: [
    'retail_natgas_price_mom',
    'futures_curve_natgas',
    'utility_curtailment_active',
    'cold_snap_arrival_imminent',
  ],
  invalidatingIndicators: [
    'mild_winter_forecast',
    'storage_build_consecutive',
    'lng_export_throttle',
  ],
  // Northern Hemisphere winter Dec-Feb is heating-demand peak;
  // summer Jun-Aug is power-burn cooling demand. Storage typically
  // builds Apr-Oct.
  seasonalRiskMonths: [11, 12, 1, 2, 3, 6, 7, 8],
  chokepoints: [
    'US Northeast pipelines (Marcellus delivery)',
    'European LNG import terminals',
    'Russian gas transit corridors',
    'Permian gas takeaway capacity',
  ],
  affectedCountries: ['US', 'CA', 'MX', 'DE', 'NL', 'GB', 'IT', 'ES', 'FR', 'JP', 'KR', 'CN'],
  affectedSectors: ['heating', 'power generation', 'industrial feedstock', 'fertilizer (ammonia)'],
  forecastHorizonDays: 60,
};

export const JET_FUEL_PLAYBOOK: CommodityPlaybook = {
  commodity: 'jet_fuel',
  domain: 'energy',
  leadingIndicators: [
    'jet_fuel_inventory_vs_5yr',
    'refinery_utilization_pct',
    'crack_spread_jet',
    'air_traffic_demand_proxy',
    'sustainable_aviation_fuel_constraint',
    'pipeline_jet_disruption_active',
  ],
  confirmingIndicators: [
    'airline_fuel_surcharge_active',
    'futures_curve_jet',
    'airport_fuel_shortage_alert',
    'cargo_capacity_diversion',
  ],
  invalidatingIndicators: [
    'inventory_build_consecutive',
    'crack_spread_jet_normalizing',
    'air_traffic_demand_softening',
  ],
  // Holiday peak Nov-Jan; summer peak Jun-Aug.
  seasonalRiskMonths: [6, 7, 8, 11, 12, 1],
  chokepoints: [
    'US East Coast (Buckeye / Colonial)',
    'European hub airports',
    'Singapore jet hub',
    'Middle East refinery output',
  ],
  affectedCountries: ['US', 'GB', 'NL', 'AE', 'SG', 'JP', 'DE', 'IN', 'CN'],
  affectedSectors: ['airlines', 'cargo aviation', 'military aviation', 'business aviation'],
  forecastHorizonDays: 30,
};

export const ALL_PLAYBOOKS: readonly CommodityPlaybook[] = [
  WHEAT_PLAYBOOK,
  CORN_PLAYBOOK,
  DIESEL_PLAYBOOK,
  GASOLINE_PLAYBOOK,
  NATURAL_GAS_PLAYBOOK,
  JET_FUEL_PLAYBOOK,
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
