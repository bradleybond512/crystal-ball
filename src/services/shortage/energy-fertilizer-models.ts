/**
 * Energy + fertilizer shortage models — batch 6 of
 * docs/SHORTAGE_AND_COMMODITY_FORECAST_PLAN.md.
 *
 * Four deterministic risk models that share the shortage-score
 * helpers: fertilizer (food domain), crude / propane / electricity
 * (energy domain). All four follow the same shape so the host
 * (forecast view, MCP shortage tools) can iterate them uniformly.
 *
 * No fetch, no globals.
 */

import type {
  ShortageDriver,
  ShortageForecast,
  ShortageInput,
  ShortageInputBag,
} from './shortage-types';
import {
  buildDriver,
  deriveConfidence,
  detectGaps,
  directLinear,
  freshnessFor,
  inverseLinear,
  scoreOverallShortage,
  uniqueSourceCount,
} from './shortage-score';
import {
  CRUDE_PLAYBOOK,
  ELECTRICITY_PLAYBOOK,
  FERTILIZER_PLAYBOOK,
  PROPANE_PLAYBOOK,
  isSeasonalRisk,
} from './commodity-playbooks';

// ── Shared helpers ──────────────────────────────────────────────────────

interface DriverSpec<I extends ShortageInputBag> {
  key: keyof I & string;
  kind: ShortageDriver['kind'];
  toRisk: (v: number) => number;
  label: (v: number) => string;
}

interface RequiredInput {
  key: string;
  label: string;
  staleAfterMs?: number;
}

function buildDrivers<I extends ShortageInputBag>(
  inputs: I,
  specs: readonly DriverSpec<I>[],
): ShortageDriver[] {
  const drivers: ShortageDriver[] = [];
  for (const spec of specs) {
    const input = inputs[spec.key] as ShortageInput | undefined;
    if (!input) continue;
    drivers.push(
      buildDriver({
        kind: spec.kind,
        value: input.value,
        toRisk: spec.toRisk,
        label: spec.label(input.value),
        source: input.source,
      }),
    );
  }
  return drivers;
}

function computeWorstFreshness(inputs: ShortageInputBag, now: number): number {
  const week = 7 * 24 * 60 * 60 * 1000;
  let worst = 1;
  for (const v of Object.values(inputs)) {
    if (!v) continue;
    const f = freshnessFor(v, week, now);
    if (f < worst) worst = f;
  }
  return worst;
}

// ── Fertilizer ──────────────────────────────────────────────────────────

export interface FertilizerModelInputs extends ShortageInputBag {
  natural_gas_price_yoy?: ShortageInput;
  urea_price_mom?: ShortageInput;
  phosphate_dap_price_mom?: ShortageInput;
  potash_price_mom?: ShortageInput;
  /** China NPK export quota as % of free-trade level. */
  china_export_quota_pct?: ShortageInput;
  /** 0-100 sanctions pressure index on Russian/Belarusian fertilizer. */
  russia_belarus_sanctions_pressure?: ShortageInput;
  shipping_rates_panamax?: ShortageInput;
  /** Farmer application intent YoY %. Negative = demand destruction. */
  farmer_application_intent_yoy?: ShortageInput;
  corn_soybean_price_yoy?: ShortageInput;
}

export interface RegionOptions {
  region: string;
  now?: number;
}

const FERTILIZER_REQUIRED: RequiredInput[] = [
  { key: 'natural_gas_price_yoy', label: 'natural gas price', staleAfterMs: 7 * 24 * 60 * 60 * 1000 },
  { key: 'urea_price_mom', label: 'urea price', staleAfterMs: 14 * 24 * 60 * 60 * 1000 },
  { key: 'china_export_quota_pct', label: 'China export quota', staleAfterMs: 30 * 24 * 60 * 60 * 1000 },
  { key: 'russia_belarus_sanctions_pressure', label: 'sanctions pressure', staleAfterMs: 14 * 24 * 60 * 60 * 1000 },
];

const FERTILIZER_DRIVER_SPECS: DriverSpec<FertilizerModelInputs>[] = [
  { key: 'natural_gas_price_yoy', kind: 'production', toRisk: directLinear(0, 100),
    label: (v) => `Natural gas +${Math.round(v)}% YoY` },
  { key: 'urea_price_mom', kind: 'price', toRisk: directLinear(0, 25),
    label: (v) => `Urea +${v.toFixed(1)}% MoM` },
  { key: 'phosphate_dap_price_mom', kind: 'price', toRisk: directLinear(0, 20),
    label: (v) => `DAP +${v.toFixed(1)}% MoM` },
  { key: 'potash_price_mom', kind: 'price', toRisk: directLinear(0, 20),
    label: (v) => `Potash +${v.toFixed(1)}% MoM` },
  { key: 'china_export_quota_pct', kind: 'policy', toRisk: inverseLinear(0, 100),
    label: (v) => `China export quota ${Math.round(v)}%` },
  { key: 'russia_belarus_sanctions_pressure', kind: 'policy', toRisk: directLinear(0, 100),
    label: (v) => `Sanctions pressure ${Math.round(v)}/100` },
  { key: 'shipping_rates_panamax', kind: 'transport', toRisk: directLinear(0, 80),
    label: (v) => `Shipping rates +${Math.round(v)}%` },
  { key: 'farmer_application_intent_yoy', kind: 'demand', toRisk: directLinear(-15, 5),
    label: (v) => `Farmer intent ${v >= 0 ? '+' : ''}${v.toFixed(1)}% YoY` },
  { key: 'corn_soybean_price_yoy', kind: 'demand', toRisk: directLinear(0, 30),
    label: (v) => `Crop prices +${v.toFixed(1)}% YoY` },
];

export function computeFertilizerShortageRisk(
  inputs: FertilizerModelInputs,
  options: RegionOptions,
): ShortageForecast {
  return assembleForecast({
    inputs,
    options,
    specs: FERTILIZER_DRIVER_SPECS,
    required: FERTILIZER_REQUIRED,
    playbook: FERTILIZER_PLAYBOOK,
  });
}

// ── Crude ───────────────────────────────────────────────────────────────

export interface CrudeModelInputs extends ShortageInputBag {
  /** OPEC compliance with quotas as %. >100 = under-producing. */
  opec_compliance_pct?: ShortageInput;
  /** US SPR level in million barrels. */
  us_strategic_petroleum_reserve_level?: ShortageInput;
  /** Global floating storage in million barrels — high = oversupply. */
  global_floating_storage?: ShortageInput;
  /** Active rig count YoY %. Negative = production headwind. */
  rig_count_yoy?: ShortageInput;
  /** 0-100 Middle East tension index. */
  middle_east_tension_index?: ShortageInput;
  /** Russian seaborne export volume million bbl/day. */
  russia_seaborne_export_volume?: ShortageInput;
  brent_wti_spread?: ShortageInput;
  crude_futures_curve?: ShortageInput;
  tanker_freight_rates?: ShortageInput;
}

const CRUDE_REQUIRED: RequiredInput[] = [
  { key: 'opec_compliance_pct', label: 'OPEC compliance', staleAfterMs: 30 * 24 * 60 * 60 * 1000 },
  { key: 'us_strategic_petroleum_reserve_level', label: 'SPR level', staleAfterMs: 7 * 24 * 60 * 60 * 1000 },
  { key: 'global_floating_storage', label: 'floating storage', staleAfterMs: 14 * 24 * 60 * 60 * 1000 },
  { key: 'middle_east_tension_index', label: 'Middle East tension', staleAfterMs: 7 * 24 * 60 * 60 * 1000 },
];

const CRUDE_DRIVER_SPECS: DriverSpec<CrudeModelInputs>[] = [
  { key: 'opec_compliance_pct', kind: 'policy', toRisk: directLinear(95, 115),
    label: (v) => `OPEC compliance ${Math.round(v)}%` },
  { key: 'us_strategic_petroleum_reserve_level', kind: 'inventory', toRisk: inverseLinear(350, 700),
    label: (v) => `SPR ${Math.round(v)}M bbl` },
  { key: 'global_floating_storage', kind: 'inventory', toRisk: inverseLinear(80, 180),
    label: (v) => `Floating storage ${Math.round(v)}M bbl` },
  { key: 'rig_count_yoy', kind: 'production', toRisk: inverseLinear(-15, 5),
    label: (v) => `Rig count ${v >= 0 ? '+' : ''}${v.toFixed(1)}% YoY` },
  { key: 'middle_east_tension_index', kind: 'transport', toRisk: directLinear(20, 80),
    label: (v) => `ME tension ${Math.round(v)}/100` },
  { key: 'russia_seaborne_export_volume', kind: 'production', toRisk: inverseLinear(2.5, 4.5),
    label: (v) => `RU exports ${v.toFixed(1)} mb/d` },
  { key: 'brent_wti_spread', kind: 'price', toRisk: directLinear(0, 8),
    label: (v) => `Brent-WTI +$${v.toFixed(1)}` },
  { key: 'crude_futures_curve', kind: 'price', toRisk: directLinear(-5, 5),
    label: (v) => `Curve ${v >= 0 ? 'backwardation' : 'contango'} ${Math.abs(v).toFixed(1)}` },
  { key: 'tanker_freight_rates', kind: 'transport', toRisk: directLinear(0, 100),
    label: (v) => `Tanker rates +${Math.round(v)}%` },
];

export function computeCrudeShortageRisk(
  inputs: CrudeModelInputs,
  options: RegionOptions,
): ShortageForecast {
  return assembleForecast({
    inputs,
    options,
    specs: CRUDE_DRIVER_SPECS,
    required: CRUDE_REQUIRED,
    playbook: CRUDE_PLAYBOOK,
  });
}

// ── Propane ─────────────────────────────────────────────────────────────

export interface PropaneModelInputs extends ShortageInputBag {
  /** Propane inventory as % of 5-year average. */
  propane_inventory_vs_5yr?: ShortageInput;
  /** Heating degree days anomaly (positive = colder). */
  heating_degree_days_anomaly?: ShortageInput;
  /** US LPG export volume YoY %. High = stress on domestic supply. */
  us_export_pace_lpg?: ShortageInput;
  crude_to_propane_spread?: ShortageInput;
  /** 0-100 crop-drying demand spike index. */
  crop_drying_demand_index?: ShortageInput;
  mont_belvieu_propane_price_wow?: ShortageInput;
  pipeline_disruption_active?: ShortageInput;
}

const PROPANE_REQUIRED: RequiredInput[] = [
  { key: 'propane_inventory_vs_5yr', label: 'propane inventory', staleAfterMs: 7 * 24 * 60 * 60 * 1000 },
  { key: 'heating_degree_days_anomaly', label: 'heating-degree days', staleAfterMs: 3 * 24 * 60 * 60 * 1000 },
  { key: 'us_export_pace_lpg', label: 'US LPG exports', staleAfterMs: 7 * 24 * 60 * 60 * 1000 },
];

const PROPANE_DRIVER_SPECS: DriverSpec<PropaneModelInputs>[] = [
  { key: 'propane_inventory_vs_5yr', kind: 'inventory', toRisk: inverseLinear(70, 110),
    label: (v) => `Inventory ${Math.round(v)}% of 5y avg` },
  { key: 'heating_degree_days_anomaly', kind: 'demand', toRisk: directLinear(0, 35),
    label: (v) => `HDD anomaly +${v.toFixed(1)}` },
  { key: 'us_export_pace_lpg', kind: 'demand', toRisk: directLinear(0, 25),
    label: (v) => `US LPG exports +${v.toFixed(1)}% YoY` },
  { key: 'crude_to_propane_spread', kind: 'price', toRisk: directLinear(0, 20),
    label: (v) => `Crude-propane spread ${v.toFixed(1)}` },
  { key: 'crop_drying_demand_index', kind: 'demand', toRisk: directLinear(20, 80),
    label: (v) => `Crop-drying ${Math.round(v)}/100` },
  { key: 'mont_belvieu_propane_price_wow', kind: 'price', toRisk: directLinear(0, 10),
    label: (v) => `Mont Belvieu +${v.toFixed(1)}% WoW` },
  { key: 'pipeline_disruption_active', kind: 'transport', toRisk: directLinear(0, 1),
    label: (v) => `Pipeline disruption ${v >= 0.5 ? 'active' : 'clear'}` },
];

export function computePropaneShortageRisk(
  inputs: PropaneModelInputs,
  options: RegionOptions,
): ShortageForecast {
  return assembleForecast({
    inputs,
    options,
    specs: PROPANE_DRIVER_SPECS,
    required: PROPANE_REQUIRED,
    playbook: PROPANE_PLAYBOOK,
  });
}

// ── Electricity ─────────────────────────────────────────────────────────

export interface ElectricityModelInputs extends ShortageInputBag {
  natural_gas_price_yoy?: ShortageInput;
  /** Hydro reservoir level as % of normal. */
  reservoir_levels_pct?: ShortageInput;
  /** Wind+solar capacity factor as % of 5-year baseline. */
  wind_solar_capacity_factor?: ShortageInput;
  /** Transmission outage capacity in MW. Higher = more strain. */
  transmission_outage_capacity_mw?: ShortageInput;
  /** 0-100 extreme temperature stress index. */
  extreme_temperature_index?: ShortageInput;
  /** Grid battery storage state of charge (0-100). */
  spr_to_grid_battery_state_of_charge?: ShortageInput;
  wholesale_power_price_mom?: ShortageInput;
  /** Reserve margin as % above peak demand. */
  reserve_margin_pct?: ShortageInput;
  /** 1 = grid alert active, 0 = clear. */
  grid_alert_active?: ShortageInput;
}

const ELECTRICITY_REQUIRED: RequiredInput[] = [
  { key: 'reserve_margin_pct', label: 'reserve margin', staleAfterMs: 24 * 60 * 60 * 1000 },
  { key: 'extreme_temperature_index', label: 'temperature stress', staleAfterMs: 24 * 60 * 60 * 1000 },
  { key: 'natural_gas_price_yoy', label: 'natural gas price', staleAfterMs: 7 * 24 * 60 * 60 * 1000 },
  { key: 'reservoir_levels_pct', label: 'reservoir levels', staleAfterMs: 7 * 24 * 60 * 60 * 1000 },
];

const ELECTRICITY_DRIVER_SPECS: DriverSpec<ElectricityModelInputs>[] = [
  { key: 'natural_gas_price_yoy', kind: 'production', toRisk: directLinear(0, 100),
    label: (v) => `Natural gas +${Math.round(v)}% YoY` },
  { key: 'reservoir_levels_pct', kind: 'production', toRisk: inverseLinear(50, 100),
    label: (v) => `Reservoirs ${Math.round(v)}% of normal` },
  { key: 'wind_solar_capacity_factor', kind: 'production', toRisk: inverseLinear(70, 100),
    label: (v) => `Wind+solar CF ${Math.round(v)}% baseline` },
  { key: 'transmission_outage_capacity_mw', kind: 'transport', toRisk: directLinear(0, 5000),
    label: (v) => `Outage capacity ${Math.round(v)} MW` },
  { key: 'extreme_temperature_index', kind: 'demand', toRisk: directLinear(20, 80),
    label: (v) => `Temp stress ${Math.round(v)}/100` },
  { key: 'spr_to_grid_battery_state_of_charge', kind: 'inventory', toRisk: inverseLinear(20, 80),
    label: (v) => `Battery SoC ${Math.round(v)}%` },
  { key: 'wholesale_power_price_mom', kind: 'price', toRisk: directLinear(0, 30),
    label: (v) => `Power +${v.toFixed(1)}% MoM` },
  { key: 'reserve_margin_pct', kind: 'inventory', toRisk: inverseLinear(8, 25),
    label: (v) => `Reserve margin ${v.toFixed(1)}%` },
  { key: 'grid_alert_active', kind: 'policy', toRisk: directLinear(0, 1),
    label: (v) => `Grid alert ${v >= 0.5 ? 'active' : 'clear'}` },
];

export function computeElectricityShortageRisk(
  inputs: ElectricityModelInputs,
  options: RegionOptions,
): ShortageForecast {
  return assembleForecast({
    inputs,
    options,
    specs: ELECTRICITY_DRIVER_SPECS,
    required: ELECTRICITY_REQUIRED,
    playbook: ELECTRICITY_PLAYBOOK,
  });
}

// ── Shared assembler ────────────────────────────────────────────────────

interface AssembleArgs<I extends ShortageInputBag> {
  inputs: I;
  options: RegionOptions;
  specs: readonly DriverSpec<I>[];
  required: readonly RequiredInput[];
  playbook: import('./shortage-types').CommodityPlaybook;
}

function assembleForecast<I extends ShortageInputBag>(args: AssembleArgs<I>): ShortageForecast {
  const now = args.options.now ?? Date.now();
  const month = new Date(now).getUTCMonth() + 1;
  const drivers = buildDrivers(args.inputs, args.specs);
  const overall = scoreOverallShortage(drivers);
  const dataGaps = detectGaps(args.inputs, args.required, now);
  const worstFreshness = computeWorstFreshness(args.inputs, now);
  const confidence = deriveConfidence({
    gapCount: dataGaps.length,
    uniqueSourceCount: uniqueSourceCount(drivers),
    worstFreshness,
    weightUsed: overall.weightUsed,
  });
  if (isSeasonalRisk(args.playbook, month)) {
    // Seasonal window — surfaced by the playbook-aware UI elsewhere.
  }
  return {
    commodity: args.playbook.commodity,
    domain: args.playbook.domain,
    region: args.options.region,
    horizonDays: args.playbook.forecastHorizonDays,
    riskScore: overall.riskScore,
    confidence,
    drivers,
    confirmingIndicators: [...args.playbook.confirmingIndicators],
    invalidatingIndicators: [...args.playbook.invalidatingIndicators],
    dataGaps,
    lastUpdated: new Date(now).toISOString(),
  };
}
