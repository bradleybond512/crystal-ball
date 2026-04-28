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

// ── Soft commodities (batch 5) ─────────────────────────────────────────

export const SUGAR_PLAYBOOK: CommodityPlaybook = {
  commodity: 'sugar',
  domain: 'food',
  leadingIndicators: [
    'rainfall_pct_of_normal',
    'soil_moisture_percentile',
    'fertilizer_price_yoy',
    'cane_yield_anomaly',
    'ethanol_diversion_pct',
    'india_export_quota_pct',
    'oil_price_brent',
  ],
  confirmingIndicators: [
    'raw_sugar_futures_mom',
    'shipping_rates_brazil_panamax',
    'export_corridor_status',
  ],
  invalidatingIndicators: [
    'india_export_quota_raised',
    'cane_yield_recovery',
    'ethanol_diversion_falling',
  ],
  // Brazilian centre-south crush Apr–Nov; Indian harvest Oct–Apr. The
  // hand-off windows are when ethanol diversion + monsoon misses bite hardest.
  seasonalRiskMonths: [4, 5, 9, 10, 11],
  chokepoints: ['Port of Santos', 'Port of Paranaguá', 'Suez Canal', 'Indian export quotas'],
  affectedCountries: ['BR', 'IN', 'TH', 'AU', 'PK', 'ID', 'CN', 'EU', 'US'],
  affectedSectors: ['food retail', 'beverages', 'confectionery', 'ethanol'],
  forecastHorizonDays: 60,
};

export const COFFEE_PLAYBOOK: CommodityPlaybook = {
  commodity: 'coffee',
  domain: 'food',
  leadingIndicators: [
    'rainfall_pct_of_normal',
    'frost_risk_index_brazil',
    'soil_moisture_percentile',
    'fertilizer_price_yoy',
    'arabica_robusta_spread_mom',
    'colombia_export_volume_yoy',
    'vietnam_export_volume_yoy',
  ],
  confirmingIndicators: [
    'arabica_futures_mom',
    'shipping_rates_brazil_panamax',
    'roaster_inventory_weeks',
  ],
  invalidatingIndicators: [
    'frost_risk_passed',
    'rainfall_recovery_brazil',
    'roaster_inventory_rebuilds',
  ],
  // Brazil flowering Sep-Nov, frost risk Jun-Aug. Vietnam Robusta harvest
  // Oct-Jan. Frost season is the highest-impact window.
  seasonalRiskMonths: [6, 7, 8, 9, 10, 11],
  chokepoints: ['Port of Santos', 'Vietnamese export terminals', 'Suez Canal'],
  affectedCountries: ['BR', 'VN', 'CO', 'ID', 'ET', 'HN', 'IN', 'US', 'EU'],
  affectedSectors: ['retail coffee', 'roasters', 'cafés', 'instant coffee'],
  forecastHorizonDays: 90,
};

export const COCOA_PLAYBOOK: CommodityPlaybook = {
  commodity: 'cocoa',
  domain: 'food',
  leadingIndicators: [
    'rainfall_pct_of_normal',
    'harmattan_dust_index',
    'black_pod_disease_index',
    'fertilizer_price_yoy',
    'ghana_cote_divoire_export_pace',
    'midcrop_pollination_window_temp',
  ],
  confirmingIndicators: [
    'cocoa_futures_mom',
    'grindings_yoy',
    'shipping_rates_west_africa',
  ],
  invalidatingIndicators: [
    'rainfall_recovery_west_africa',
    'disease_index_falling',
    'export_pace_recovery',
  ],
  // West-Africa main crop Oct-Mar, midcrop Apr-Sep. Harmattan dust risk
  // peaks Dec-Feb; black-pod disease worst Jul-Sep.
  seasonalRiskMonths: [7, 8, 9, 12, 1, 2],
  chokepoints: ['Port of Abidjan', 'Port of Tema', 'Suez Canal'],
  affectedCountries: ['CI', 'GH', 'ID', 'NG', 'CM', 'EC', 'BR', 'US', 'EU', 'CH'],
  affectedSectors: ['confectionery', 'chocolate processing', 'specialty food retail'],
  forecastHorizonDays: 120,
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



export const RICE_PLAYBOOK: CommodityPlaybook = {
  commodity: 'rice',
  domain: 'food',
  leadingIndicators: [
    'monsoon_rainfall_pct_of_normal',
    'paddy_water_availability_index',
    'fertilizer_price_yoy',
    'export_corridor_status',
    'planting_progress_pct',
  ],
  confirmingIndicators: [
    'thai_rice_export_price_mom',
    'india_export_ban_active',
    'fews_net_stage',
    'futures_curve_tightness',
  ],
  invalidatingIndicators: [
    'monsoon_rainfall_recovery',
    'export_ban_lifted',
    'inventory_release_announced',
  ],
  // Asian monsoon planting Jun-Sep; harvest Oct-Dec. Late or weak
  // monsoon = the headline risk window.
  seasonalRiskMonths: [5, 6, 7, 8, 9, 10],
  chokepoints: ['Bay of Bengal exports', 'Mekong River corridor', 'Strait of Malacca'],
  affectedCountries: ['IN', 'TH', 'VN', 'PH', 'BD', 'ID', 'MY', 'SG', 'CN', 'NG', 'EG'],
  affectedSectors: ['food retail', 'humanitarian aid', 'street-food economies'],
  forecastHorizonDays: 90,
};


export const SOYBEANS_PLAYBOOK: CommodityPlaybook = {
  commodity: 'soybeans',
  domain: 'food',
  leadingIndicators: [
    'rainfall_pct_of_normal',
    'soil_moisture_percentile',
    'ndvi_anomaly',
    'planting_progress_pct',
    'south_america_la_nina_signal',
    'china_crush_demand_index',
  ],
  confirmingIndicators: [
    'usda_crop_condition_g_e_pct',
    'cbot_soy_price_mom',
    'soy_meal_basis_widening',
    'futures_curve_tightness',
  ],
  invalidatingIndicators: [
    'late_season_rainfall_recovery',
    'usda_yield_upgrade',
    'china_demand_softening',
  ],
  // US plant May-Jun, pod-fill Jul-Aug, harvest Sep-Oct.
  // Brazil/Argentina plant Oct-Dec, harvest Mar-May.
  seasonalRiskMonths: [5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3],
  chokepoints: [
    'Mississippi River barge corridor',
    'Brazilian Cerrado export ports',
    'Panama Canal',
    'Argentine Paraná River',
  ],
  affectedCountries: ['US', 'BR', 'AR', 'CN', 'EU', 'MX', 'JP'],
  affectedSectors: ['livestock feed', 'cooking oil', 'biofuel', 'tofu / food'],
  forecastHorizonDays: 90,
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
  SUGAR_PLAYBOOK,
  COFFEE_PLAYBOOK,
  COCOA_PLAYBOOK,
  FERTILIZER_PLAYBOOK,
  CRUDE_PLAYBOOK,
  PROPANE_PLAYBOOK,
  ELECTRICITY_PLAYBOOK,
  RICE_PLAYBOOK,
  SOYBEANS_PLAYBOOK,
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
