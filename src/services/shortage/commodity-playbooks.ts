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

// ── Inputs / energy (batch 6) ──────────────────────────────────────────

export const FERTILIZER_PLAYBOOK: CommodityPlaybook = {
  commodity: 'fertilizer',
  domain: 'food',
  leadingIndicators: [
    'natural_gas_price_yoy',
    'urea_price_mom',
    'phosphate_dap_price_mom',
    'potash_price_mom',
    'china_export_quota_pct',
    'russia_belarus_sanctions_pressure',
    'shipping_rates_panamax',
  ],
  confirmingIndicators: [
    'farmer_application_intent_yoy',
    'corn_soybean_price_yoy',
  ],
  invalidatingIndicators: [
    'natural_gas_price_falling',
    'china_export_quota_raised',
  ],
  // Fertilizer demand peaks at planting — Apr-May NH, Sep-Oct SH.
  seasonalRiskMonths: [3, 4, 5, 9, 10],
  chokepoints: ['Russian/Belarusian sanctions corridor', 'China export quotas', 'Suez Canal', 'Tampa phosphate hub'],
  affectedCountries: ['RU', 'BY', 'CN', 'US', 'BR', 'IN', 'CA', 'MA'],
  affectedSectors: ['row crops', 'specialty agriculture', 'biofuels feedstock'],
  forecastHorizonDays: 60,
};

export const CRUDE_PLAYBOOK: CommodityPlaybook = {
  commodity: 'crude',
  domain: 'energy',
  leadingIndicators: [
    'opec_compliance_pct',
    'us_strategic_petroleum_reserve_level',
    'global_floating_storage',
    'rig_count_yoy',
    'middle_east_tension_index',
    'russia_seaborne_export_volume',
  ],
  confirmingIndicators: [
    'brent_wti_spread',
    'crude_futures_curve',
    'tanker_freight_rates',
  ],
  invalidatingIndicators: [
    'spr_release_announced',
    'opec_quota_raised',
    'rig_count_recovery',
  ],
  // Northern hemisphere driving + heating demand layers + hurricane season.
  seasonalRiskMonths: [6, 7, 8, 9, 10, 11, 12, 1],
  chokepoints: ['Strait of Hormuz', 'Bab el-Mandeb', 'Suez Canal', 'Russian Black Sea ports'],
  affectedCountries: ['SA', 'RU', 'US', 'IR', 'IQ', 'AE', 'CN', 'IN', 'EU'],
  affectedSectors: ['refining', 'petrochemicals', 'transport', 'aviation'],
  forecastHorizonDays: 30,
};

export const PROPANE_PLAYBOOK: CommodityPlaybook = {
  commodity: 'propane',
  domain: 'energy',
  leadingIndicators: [
    'propane_inventory_vs_5yr',
    'heating_degree_days_anomaly',
    'us_export_pace_lpg',
    'crude_to_propane_spread',
    'crop_drying_demand_index',
  ],
  confirmingIndicators: [
    'mont_belvieu_propane_price_wow',
    'pipeline_disruption_active',
  ],
  invalidatingIndicators: [
    'inventory_build_consecutive',
    'export_pace_slowing',
    'mild_winter_forecast',
  ],
  // Heating + crop drying both peak Sep-Mar in the US.
  seasonalRiskMonths: [9, 10, 11, 12, 1, 2, 3],
  chokepoints: ['Mont Belvieu hub', 'US Gulf Coast export terminals', 'Conway hub'],
  affectedCountries: ['US', 'CA', 'MX', 'JP', 'KR', 'CN', 'EU'],
  affectedSectors: ['rural heating', 'agriculture', 'petrochemicals', 'autogas'],
  forecastHorizonDays: 30,
};

export const ELECTRICITY_PLAYBOOK: CommodityPlaybook = {
  commodity: 'electricity',
  domain: 'energy',
  leadingIndicators: [
    'natural_gas_price_yoy',
    'reservoir_levels_pct',
    'wind_solar_capacity_factor',
    'transmission_outage_capacity_mw',
    'extreme_temperature_index',
    'spr_to_grid_battery_state_of_charge',
  ],
  confirmingIndicators: [
    'wholesale_power_price_mom',
    'reserve_margin_pct',
    'grid_alert_active',
  ],
  invalidatingIndicators: [
    'reserve_margin_recovery',
    'temperature_normalizing',
    'transmission_back_online',
  ],
  // Summer cooling + winter heating — bi-modal, with shoulder months
  // typically clean.
  seasonalRiskMonths: [6, 7, 8, 12, 1, 2],
  chokepoints: ['ERCOT', 'CAISO summer peak', 'PJM winter peak', 'European interconnects'],
  affectedCountries: ['US', 'CA', 'MX', 'GB', 'DE', 'FR', 'JP', 'AU'],
  affectedSectors: ['data centers', 'industrial', 'residential', 'EV charging'],
  forecastHorizonDays: 7,
};

export const ALL_PLAYBOOKS: readonly CommodityPlaybook[] = [
  WHEAT_PLAYBOOK,
  CORN_PLAYBOOK,
  DIESEL_PLAYBOOK,
  GASOLINE_PLAYBOOK,
  FERTILIZER_PLAYBOOK,
  CRUDE_PLAYBOOK,
  PROPANE_PLAYBOOK,
  ELECTRICITY_PLAYBOOK,
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
