/**
 * Deterministic coffee shortage risk model — batch 5 of
 * docs/SHORTAGE_AND_COMMODITY_FORECAST_PLAN.md.
 *
 * Coffee's two-pole structure (Brazilian arabica + Vietnamese robusta)
 * means the highest-risk window is Brazilian frost season (Jun-Aug).
 * The model treats frost risk as a hard binary (when present, it
 * dominates) and tracks the spread between arabica and robusta as a
 * substitution leak.
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
import { COFFEE_PLAYBOOK, isSeasonalRisk } from './commodity-playbooks';

export interface CoffeeModelInputs extends ShortageInputBag {
  rainfall_pct_of_normal?: ShortageInput;
  /** 0-100 risk score: 0 = no frost forecast, 100 = imminent severe frost. */
  frost_risk_index_brazil?: ShortageInput;
  soil_moisture_percentile?: ShortageInput;
  fertilizer_price_yoy?: ShortageInput;
  /** Arabica/Robusta price spread MoM % change. Wider = more arabica stress. */
  arabica_robusta_spread_mom?: ShortageInput;
  colombia_export_volume_yoy?: ShortageInput;
  vietnam_export_volume_yoy?: ShortageInput;
  arabica_futures_mom?: ShortageInput;
  shipping_rates_brazil_panamax?: ShortageInput;
  /** Roaster inventory in weeks of cover. Lower = stress. */
  roaster_inventory_weeks?: ShortageInput;
}

export interface CoffeeModelOptions {
  region: string;
  now?: number;
}

const REQUIRED_INPUTS = [
  { key: 'rainfall_pct_of_normal', label: 'rainfall vs normal', staleAfterMs: 7 * 24 * 60 * 60 * 1000 },
  { key: 'frost_risk_index_brazil', label: 'Brazil frost risk', staleAfterMs: 7 * 24 * 60 * 60 * 1000 },
  { key: 'arabica_futures_mom', label: 'arabica futures', staleAfterMs: 7 * 24 * 60 * 60 * 1000 },
  { key: 'roaster_inventory_weeks', label: 'roaster inventory', staleAfterMs: 14 * 24 * 60 * 60 * 1000 },
];

interface DriverSpec<K extends keyof CoffeeModelInputs> {
  key: K;
  kind: ShortageDriver['kind'];
  toRisk: (v: number) => number;
  label: (v: number) => string;
}

const COFFEE_DRIVER_SPECS: DriverSpec<keyof CoffeeModelInputs>[] = [
  { key: 'rainfall_pct_of_normal', kind: 'production', toRisk: inverseLinear(50, 110),
    label: (v) => `Rainfall ${Math.round(v)}% of normal` },
  { key: 'frost_risk_index_brazil', kind: 'production', toRisk: directLinear(0, 60),
    label: (v) => `Brazil frost risk ${Math.round(v)}/100` },
  { key: 'soil_moisture_percentile', kind: 'production', toRisk: inverseLinear(0, 50),
    label: (v) => `Soil moisture ${Math.round(v)}th percentile` },
  { key: 'fertilizer_price_yoy', kind: 'production', toRisk: directLinear(0, 50),
    label: (v) => `Fertilizer prices +${Math.round(v)}% YoY` },
  { key: 'arabica_robusta_spread_mom', kind: 'price', toRisk: directLinear(0, 10),
    label: (v) => `Arabica/Robusta spread +${v.toFixed(1)}% MoM` },
  { key: 'colombia_export_volume_yoy', kind: 'transport', toRisk: inverseLinear(-15, 5),
    label: (v) => `Colombia exports ${v.toFixed(1)}% YoY` },
  { key: 'vietnam_export_volume_yoy', kind: 'transport', toRisk: inverseLinear(-15, 5),
    label: (v) => `Vietnam exports ${v.toFixed(1)}% YoY` },
  { key: 'arabica_futures_mom', kind: 'price', toRisk: directLinear(0, 12),
    label: (v) => `Arabica futures +${v.toFixed(1)}% MoM` },
  { key: 'shipping_rates_brazil_panamax', kind: 'transport', toRisk: directLinear(0, 80),
    label: (v) => `Brazil shipping rates +${Math.round(v)}%` },
  { key: 'roaster_inventory_weeks', kind: 'demand', toRisk: inverseLinear(2, 12),
    label: (v) => `Roaster inventory ${v.toFixed(1)}w` },
];

export function computeCoffeeShortageRisk(
  inputs: CoffeeModelInputs,
  options: CoffeeModelOptions,
): ShortageForecast {
  const now = options.now ?? Date.now();
  const month = new Date(now).getUTCMonth() + 1;
  const drivers: ShortageDriver[] = [];
  for (const spec of COFFEE_DRIVER_SPECS) {
    const input = inputs[spec.key];
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
  const overall = scoreOverallShortage(drivers);
  const dataGaps = detectGaps(inputs, REQUIRED_INPUTS, now);
  const worstFreshness = computeWorstFreshness(inputs, now);
  const confidence = deriveConfidence({
    gapCount: dataGaps.length,
    uniqueSourceCount: uniqueSourceCount(drivers),
    worstFreshness,
    weightUsed: overall.weightUsed,
  });
  if (isSeasonalRisk(COFFEE_PLAYBOOK, month)) {
    // Seasonal risk window — surfaced by the playbook-aware UI elsewhere.
  }
  return {
    commodity: COFFEE_PLAYBOOK.commodity,
    domain: COFFEE_PLAYBOOK.domain,
    region: options.region,
    horizonDays: COFFEE_PLAYBOOK.forecastHorizonDays,
    riskScore: overall.riskScore,
    confidence,
    drivers,
    confirmingIndicators: [...COFFEE_PLAYBOOK.confirmingIndicators],
    invalidatingIndicators: [...COFFEE_PLAYBOOK.invalidatingIndicators],
    dataGaps,
    lastUpdated: new Date(now).toISOString(),
  };
}

function computeWorstFreshness(inputs: CoffeeModelInputs, now: number): number {
  const week = 7 * 24 * 60 * 60 * 1000;
  let worst = 1;
  for (const v of Object.values(inputs)) {
    if (!v) continue;
    const f = freshnessFor(v, week, now);
    if (f < worst) worst = f;
  }
  return worst;
}
