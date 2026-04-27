/**
 * Deterministic gasoline shortage risk model.
 *
 * Same compositional pattern as wheat/corn/diesel: provenance-aware
 * inputs → drivers + data gaps + confidence. Gasoline-specific signals:
 * RBOB futures backwardation, summer driving season demand,
 * pipeline disruptions (Colonial), ethanol blend transitions.
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
import { GASOLINE_PLAYBOOK, isSeasonalRisk } from './commodity-playbooks';

export interface GasolineModelInputs extends ShortageInputBag {
  /** Gasoline inventory % deviation from 5-year average (negative = below). */
  gasoline_inventory_vs_5yr?: ShortageInput;
  refinery_utilization_pct?: ShortageInput;
  crude_imports_wow?: ShortageInput;
  /** RBOB crack spread (USD/bbl). */
  crack_spread_gasoline?: ShortageInput;
  refinery_outage_capacity_pct?: ShortageInput;
  /** Driving-season demand proxy (50 baseline; >70 = elevated holiday/
   *  vacation pull). */
  driving_season_demand_proxy?: ShortageInput;
  /** RBOB futures backwardation: positive = front-month above back. */
  rbob_futures_backwardation?: ShortageInput;
  retail_gasoline_price_wow?: ShortageInput;
  futures_curve_gasoline?: ShortageInput;
  /** 0 = no pipeline issue, 1 = active disruption (e.g. Colonial). */
  pipeline_disruption_active?: ShortageInput;
  /** 0 = blend transition smooth, 1 = blend supply gap. */
  ethanol_blend_disruption?: ShortageInput;
}

export interface GasolineModelOptions {
  region: string;
  now?: number;
}

const REQUIRED_INPUTS = [
  { key: 'gasoline_inventory_vs_5yr', label: 'gasoline inventory', staleAfterMs: 8 * 24 * 60 * 60 * 1000 },
  { key: 'refinery_utilization_pct', label: 'refinery utilization', staleAfterMs: 8 * 24 * 60 * 60 * 1000 },
  { key: 'crack_spread_gasoline', label: 'gasoline crack spread', staleAfterMs: 3 * 24 * 60 * 60 * 1000 },
  { key: 'retail_gasoline_price_wow', label: 'retail gasoline price', staleAfterMs: 8 * 24 * 60 * 60 * 1000 },
];

interface DriverSpec<K extends keyof GasolineModelInputs> {
  key: K;
  kind: ShortageDriver['kind'];
  toRisk: (v: number) => number;
  label: (v: number) => string;
  when?: (v: number) => boolean;
}

const GAS_DRIVER_SPECS: DriverSpec<keyof GasolineModelInputs>[] = [
  { key: 'gasoline_inventory_vs_5yr', kind: 'inventory', toRisk: inverseLinear(-25, 10),
    label: (v) => `Gasoline inventory ${v >= 0 ? '+' : ''}${v.toFixed(1)}% vs 5-yr avg` },
  { key: 'refinery_utilization_pct', kind: 'production', toRisk: inverseLinear(75, 95),
    label: (v) => `Refinery utilization ${Math.round(v)}%` },
  { key: 'refinery_outage_capacity_pct', kind: 'production', toRisk: directLinear(0, 15),
    label: (v) => `${v.toFixed(1)}% capacity offline` },
  { key: 'crude_imports_wow', kind: 'transport', toRisk: inverseLinear(-25, 5),
    label: (v) => `Crude imports ${v >= 0 ? '+' : ''}${v.toFixed(1)}% WoW` },
  { key: 'pipeline_disruption_active', kind: 'transport', toRisk: () => 100,
    label: () => 'Pipeline disruption active', when: (v) => v > 0 },
  { key: 'driving_season_demand_proxy', kind: 'demand', toRisk: directLinear(50, 85),
    label: (v) => `Driving season demand ${Math.round(v)}` },
  { key: 'ethanol_blend_disruption', kind: 'demand', toRisk: () => 75,
    label: () => 'Ethanol blend disruption', when: (v) => v > 0 },
  { key: 'crack_spread_gasoline', kind: 'price', toRisk: directLinear(15, 45),
    label: (v) => `Gasoline crack spread $${v.toFixed(1)}/bbl` },
  { key: 'retail_gasoline_price_wow', kind: 'price', toRisk: directLinear(0, 8),
    label: (v) => `Retail gasoline ${v >= 0 ? '+' : ''}${v.toFixed(1)}% WoW` },
  { key: 'futures_curve_gasoline', kind: 'price', toRisk: directLinear(0, 10),
    label: (v) => `Gasoline futures curve ${v.toFixed(1)}` },
  { key: 'rbob_futures_backwardation', kind: 'price', toRisk: directLinear(0, 8),
    label: (v) => `RBOB backwardation ${v.toFixed(1)}` },
];

function buildDriversFromSpecs(
  inputs: GasolineModelInputs,
  specs: readonly DriverSpec<keyof GasolineModelInputs>[],
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

export function computeGasolineShortageRisk(
  inputs: GasolineModelInputs,
  options: GasolineModelOptions,
): ShortageForecast {
  const now = options.now ?? Date.now();
  const drivers = buildDriversFromSpecs(inputs, GAS_DRIVER_SPECS);

  // Summer driving season + hurricane window: bump transport + production.
  const month = new Date(now).getUTCMonth() + 1;
  if (isSeasonalRisk(GASOLINE_PLAYBOOK, month)) {
    for (const d of drivers) {
      if (d.kind === 'transport' || d.kind === 'production') {
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
    commodity: GASOLINE_PLAYBOOK.commodity,
    domain: GASOLINE_PLAYBOOK.domain,
    region: options.region,
    horizonDays: GASOLINE_PLAYBOOK.forecastHorizonDays,
    riskScore: overall.riskScore,
    confidence,
    drivers,
    confirmingIndicators: [...GASOLINE_PLAYBOOK.confirmingIndicators],
    invalidatingIndicators: [...GASOLINE_PLAYBOOK.invalidatingIndicators],
    dataGaps,
    lastUpdated: new Date(now).toISOString(),
  };
}

function computeWorstFreshness(inputs: GasolineModelInputs, now: number): number {
  const week = 7 * 24 * 60 * 60 * 1000;
  let worst = 1;
  for (const v of Object.values(inputs)) {
    if (!v) continue;
    const f = freshnessFor(v, week, now);
    if (f < worst) worst = f;
  }
  return worst;
}
