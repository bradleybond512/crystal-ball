/**
 * Deterministic natural-gas shortage risk model.
 *
 * Same compositional pattern as wheat/corn/diesel/gasoline. Natural-gas
 * specific signals: storage vs 5yr (the Henry Hub headline number),
 * heating-degree days vs normal (winter demand pull), LNG export
 * capacity utilization, pipeline outages, basis widening.
 *
 * Pure deterministic. No fetch.
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
import { NATURAL_GAS_PLAYBOOK, isSeasonalRisk } from './commodity-playbooks';

export interface NaturalGasModelInputs extends ShortageInputBag {
  /** % deviation from 5-year storage average. Negative = below. */
  natgas_storage_vs_5yr?: ShortageInput;
  /** HDD week vs normal % (positive = colder than normal = more demand). */
  heating_degree_days_vs_normal?: ShortageInput;
  /** CDD week vs normal % (summer power burn). */
  cooling_degree_days_vs_normal?: ShortageInput;
  /** LNG export terminal capacity utilization %. */
  lng_export_capacity_pct?: ShortageInput;
  /** Pipeline outage capacity %. */
  production_pipeline_outage_pct?: ShortageInput;
  /** Henry Hub basis widening (positive = stress). */
  henry_hub_basis_widening?: ShortageInput;
  /** Retail natural gas price month-over-month % change. */
  retail_natgas_price_mom?: ShortageInput;
  /** Futures curve (positive = backwardation = stress). */
  futures_curve_natgas?: ShortageInput;
  /** 0 = no curtailment, 1 = utility curtailment in effect. */
  utility_curtailment_active?: ShortageInput;
  /** 0 = no cold snap, 1 = cold snap arrival within 7d. */
  cold_snap_arrival_imminent?: ShortageInput;
}

export interface NaturalGasModelOptions {
  region: string;
  now?: number;
}

const REQUIRED_INPUTS = [
  { key: 'natgas_storage_vs_5yr', label: 'natural gas storage', staleAfterMs: 8 * 24 * 60 * 60 * 1000 },
  { key: 'heating_degree_days_vs_normal', label: 'HDD vs normal', staleAfterMs: 7 * 24 * 60 * 60 * 1000 },
  { key: 'henry_hub_basis_widening', label: 'Henry Hub basis', staleAfterMs: 3 * 24 * 60 * 60 * 1000 },
  { key: 'retail_natgas_price_mom', label: 'retail natural gas price', staleAfterMs: 14 * 24 * 60 * 60 * 1000 },
];

interface DriverSpec<K extends keyof NaturalGasModelInputs> {
  key: K;
  kind: ShortageDriver['kind'];
  toRisk: (v: number) => number;
  label: (v: number) => string;
  when?: (v: number) => boolean;
}

const NATGAS_DRIVER_SPECS: DriverSpec<keyof NaturalGasModelInputs>[] = [
  { key: 'natgas_storage_vs_5yr', kind: 'inventory', toRisk: inverseLinear(-25, 10),
    label: (v) => `Natural gas storage ${v >= 0 ? '+' : ''}${v.toFixed(1)}% vs 5-yr avg` },
  { key: 'heating_degree_days_vs_normal', kind: 'demand', toRisk: directLinear(0, 30),
    label: (v) => `HDD ${v >= 0 ? '+' : ''}${v.toFixed(0)}% vs normal (heating demand)` },
  { key: 'cooling_degree_days_vs_normal', kind: 'demand', toRisk: directLinear(0, 30),
    label: (v) => `CDD ${v >= 0 ? '+' : ''}${v.toFixed(0)}% vs normal (power-burn demand)` },
  { key: 'lng_export_capacity_pct', kind: 'transport', toRisk: directLinear(75, 100),
    label: (v) => `LNG export capacity ${Math.round(v)}% utilized` },
  { key: 'production_pipeline_outage_pct', kind: 'production', toRisk: directLinear(0, 12),
    label: (v) => `${v.toFixed(1)}% pipeline capacity offline` },
  { key: 'henry_hub_basis_widening', kind: 'price', toRisk: directLinear(0, 5),
    label: (v) => `Henry Hub basis +$${v.toFixed(2)}` },
  { key: 'retail_natgas_price_mom', kind: 'price', toRisk: directLinear(0, 25),
    label: (v) => `Retail price ${v >= 0 ? '+' : ''}${Math.round(v)}% MoM` },
  { key: 'futures_curve_natgas', kind: 'price', toRisk: directLinear(0, 8),
    label: (v) => `Futures curve ${v.toFixed(1)}` },
  { key: 'utility_curtailment_active', kind: 'demand', toRisk: () => 100,
    label: () => 'Utility curtailment active', when: (v) => v > 0 },
  { key: 'cold_snap_arrival_imminent', kind: 'cross_domain', toRisk: () => 75,
    label: () => 'Cold snap arrival imminent', when: (v) => v > 0 },
];

function buildDriversFromSpecs(
  inputs: NaturalGasModelInputs,
  specs: readonly DriverSpec<keyof NaturalGasModelInputs>[],
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

export function computeNaturalGasShortageRisk(
  inputs: NaturalGasModelInputs,
  options: NaturalGasModelOptions,
): ShortageForecast {
  const now = options.now ?? Date.now();
  const drivers = buildDriversFromSpecs(inputs, NATGAS_DRIVER_SPECS);

  // Winter (Dec-Feb) gets a heating-demand multiplier, summer (Jun-Aug)
  // gets a power-burn cooling multiplier.
  const month = new Date(now).getUTCMonth() + 1;
  if (isSeasonalRisk(NATURAL_GAS_PLAYBOOK, month)) {
    const isWinter = month === 12 || month <= 2;
    for (const d of drivers) {
      if (d.kind === 'demand' || d.kind === 'inventory') {
        d.score = Math.min(100, Math.round(d.score * (isWinter ? 1.15 : 1.08)));
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
    commodity: NATURAL_GAS_PLAYBOOK.commodity,
    domain: NATURAL_GAS_PLAYBOOK.domain,
    region: options.region,
    horizonDays: NATURAL_GAS_PLAYBOOK.forecastHorizonDays,
    riskScore: overall.riskScore,
    confidence,
    drivers,
    confirmingIndicators: [...NATURAL_GAS_PLAYBOOK.confirmingIndicators],
    invalidatingIndicators: [...NATURAL_GAS_PLAYBOOK.invalidatingIndicators],
    dataGaps,
    lastUpdated: new Date(now).toISOString(),
  };
}

function computeWorstFreshness(inputs: NaturalGasModelInputs, now: number): number {
  const week = 7 * 24 * 60 * 60 * 1000;
  let worst = 1;
  for (const v of Object.values(inputs)) {
    if (!v) continue;
    const f = freshnessFor(v, week, now);
    if (f < worst) worst = f;
  }
  return worst;
}
