/**
 * Deterministic jet-fuel shortage risk model.
 *
 * Same compositional pattern as wheat/corn/diesel/gasoline/natgas.
 * Jet-specific signals: jet inventory vs 5yr, refinery utilization,
 * jet crack spread, air-traffic demand, sustainable-aviation-fuel
 * supply constraint, pipeline disruption (Buckeye / Colonial Jet).
 */

import type { ShortageDriver, ShortageForecast, ShortageInput, ShortageInputBag } from './shortage-types';
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
import { JET_FUEL_PLAYBOOK, isSeasonalRisk } from './commodity-playbooks';

export interface JetFuelModelInputs extends ShortageInputBag {
  jet_fuel_inventory_vs_5yr?: ShortageInput;
  refinery_utilization_pct?: ShortageInput;
  /** Jet crack spread (USD/bbl). */
  crack_spread_jet?: ShortageInput;
  /** Air traffic demand 0-100 (50 baseline). */
  air_traffic_demand_proxy?: ShortageInput;
  /** SAF availability constraint 0-100 (100 = severe constraint). */
  sustainable_aviation_fuel_constraint?: ShortageInput;
  /** 0 = pipeline ok, 1 = active disruption. */
  pipeline_jet_disruption_active?: ShortageInput;
  /** 0 = no surcharge, 1 = airline added a fuel surcharge this period. */
  airline_fuel_surcharge_active?: ShortageInput;
  /** Futures curve (positive = backwardation). */
  futures_curve_jet?: ShortageInput;
  /** 0 = no airport shortage, 1 = at least one major airport reporting. */
  airport_fuel_shortage_alert?: ShortageInput;
  /** Cargo capacity diversion (proxy for cargo carriers absorbing
   *  passenger-airline fuel). 0-100. */
  cargo_capacity_diversion?: ShortageInput;
}

export interface JetFuelModelOptions {
  region: string;
  now?: number;
}

const REQUIRED_INPUTS = [
  { key: 'jet_fuel_inventory_vs_5yr', label: 'jet inventory', staleAfterMs: 8 * 24 * 60 * 60 * 1000 },
  { key: 'refinery_utilization_pct', label: 'refinery utilization', staleAfterMs: 8 * 24 * 60 * 60 * 1000 },
  { key: 'crack_spread_jet', label: 'jet crack spread', staleAfterMs: 3 * 24 * 60 * 60 * 1000 },
  { key: 'air_traffic_demand_proxy', label: 'air traffic demand', staleAfterMs: 7 * 24 * 60 * 60 * 1000 },
];

interface DriverSpec<K extends keyof JetFuelModelInputs> {
  key: K;
  kind: ShortageDriver['kind'];
  toRisk: (v: number) => number;
  label: (v: number) => string;
  when?: (v: number) => boolean;
}

const JET_DRIVER_SPECS: DriverSpec<keyof JetFuelModelInputs>[] = [
  { key: 'jet_fuel_inventory_vs_5yr', kind: 'inventory', toRisk: inverseLinear(-25, 10),
    label: (v) => `Jet fuel inventory ${v >= 0 ? '+' : ''}${v.toFixed(1)}% vs 5-yr avg` },
  { key: 'refinery_utilization_pct', kind: 'production', toRisk: inverseLinear(75, 95),
    label: (v) => `Refinery utilization ${Math.round(v)}%` },
  { key: 'crack_spread_jet', kind: 'price', toRisk: directLinear(15, 40),
    label: (v) => `Jet crack spread $${v.toFixed(1)}/bbl` },
  { key: 'air_traffic_demand_proxy', kind: 'demand', toRisk: directLinear(50, 90),
    label: (v) => `Air traffic demand ${Math.round(v)}` },
  { key: 'sustainable_aviation_fuel_constraint', kind: 'production', toRisk: directLinear(0, 80),
    label: (v) => `SAF supply constraint ${Math.round(v)}/100` },
  { key: 'pipeline_jet_disruption_active', kind: 'transport', toRisk: () => 100,
    label: () => 'Jet pipeline disruption active', when: (v) => v > 0 },
  { key: 'airline_fuel_surcharge_active', kind: 'price', toRisk: () => 70,
    label: () => 'Airline fuel surcharge active', when: (v) => v > 0 },
  { key: 'futures_curve_jet', kind: 'price', toRisk: directLinear(0, 8),
    label: (v) => `Jet futures curve ${v.toFixed(1)}` },
  { key: 'airport_fuel_shortage_alert', kind: 'transport', toRisk: () => 90,
    label: () => 'Airport fuel-shortage alert active', when: (v) => v > 0 },
  { key: 'cargo_capacity_diversion', kind: 'demand', toRisk: directLinear(0, 50),
    label: (v) => `Cargo capacity diversion ${Math.round(v)}` },
];

function buildDriversFromSpecs(
  inputs: JetFuelModelInputs,
  specs: readonly DriverSpec<keyof JetFuelModelInputs>[],
): ShortageDriver[] {
  const drivers: ShortageDriver[] = [];
  for (const spec of specs) {
    const input = inputs[spec.key];
    if (!input) continue;
    if (spec.when && !spec.when(input.value)) continue;
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

export function computeJetFuelShortageRisk(
  inputs: JetFuelModelInputs,
  options: JetFuelModelOptions,
): ShortageForecast {
  const now = options.now ?? Date.now();
  const drivers = buildDriversFromSpecs(inputs, JET_DRIVER_SPECS);

  // Holiday / summer travel windows amplify demand drivers.
  const month = new Date(now).getUTCMonth() + 1;
  if (isSeasonalRisk(JET_FUEL_PLAYBOOK, month)) {
    for (const d of drivers) {
      if (d.kind === 'demand' || d.kind === 'inventory') {
        d.score = Math.min(100, Math.round(d.score * 1.1));
      }
    }
  }

  const overall = scoreOverallShortage(drivers);
  const dataGaps = detectGaps(inputs, REQUIRED_INPUTS, now);
  const worstFreshness = computeWorstFreshness(inputs, now);
  const confidence = deriveConfidence({
    gapCount: dataGaps.length,
    uniqueSourceCount: uniqueSourceCount(drivers),
    worstFreshness,
    weightUsed: overall.weightUsed,
  });

  return {
    commodity: JET_FUEL_PLAYBOOK.commodity,
    domain: JET_FUEL_PLAYBOOK.domain,
    region: options.region,
    horizonDays: JET_FUEL_PLAYBOOK.forecastHorizonDays,
    riskScore: overall.riskScore,
    confidence,
    drivers,
    confirmingIndicators: [...JET_FUEL_PLAYBOOK.confirmingIndicators],
    invalidatingIndicators: [...JET_FUEL_PLAYBOOK.invalidatingIndicators],
    dataGaps,
    lastUpdated: new Date(now).toISOString(),
  };
}

function computeWorstFreshness(inputs: JetFuelModelInputs, now: number): number {
  const week = 7 * 24 * 60 * 60 * 1000;
  let worst = 1;
  for (const v of Object.values(inputs)) {
    if (!v) continue;
    const f = freshnessFor(v, week, now);
    if (f < worst) worst = f;
  }
  return worst;
}
