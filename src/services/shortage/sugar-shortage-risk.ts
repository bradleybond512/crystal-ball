/**
 * Deterministic sugar shortage risk model — batch 5 of
 * docs/SHORTAGE_AND_COMMODITY_FORECAST_PLAN.md.
 *
 * Sugar is two-pole: Brazil's centre-south crush (Apr-Nov) and India's
 * Oct-Apr harvest. The two main shortage drivers are weather damage to
 * cane yield and Brazilian ethanol diversion (when oil is high, mills
 * make ethanol instead of sugar).
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
import { SUGAR_PLAYBOOK, isSeasonalRisk } from './commodity-playbooks';

export interface SugarModelInputs extends ShortageInputBag {
  rainfall_pct_of_normal?: ShortageInput;
  soil_moisture_percentile?: ShortageInput;
  fertilizer_price_yoy?: ShortageInput;
  cane_yield_anomaly?: ShortageInput;
  /** Brazil ethanol diversion %. Higher = less sugar. */
  ethanol_diversion_pct?: ShortageInput;
  /** Indian export quota as % of free-trade level. 0 = full ban. */
  india_export_quota_pct?: ShortageInput;
  /** Brent crude price in USD/bbl — drives ethanol diversion. */
  oil_price_brent?: ShortageInput;
  raw_sugar_futures_mom?: ShortageInput;
  shipping_rates_brazil_panamax?: ShortageInput;
  export_corridor_status?: ShortageInput;
}

export interface SugarModelOptions {
  region: string;
  now?: number;
}

const REQUIRED_INPUTS = [
  { key: 'rainfall_pct_of_normal', label: 'rainfall vs normal', staleAfterMs: 7 * 24 * 60 * 60 * 1000 },
  { key: 'cane_yield_anomaly', label: 'cane yield anomaly', staleAfterMs: 30 * 24 * 60 * 60 * 1000 },
  { key: 'ethanol_diversion_pct', label: 'ethanol diversion', staleAfterMs: 14 * 24 * 60 * 60 * 1000 },
  { key: 'india_export_quota_pct', label: 'India export quota', staleAfterMs: 30 * 24 * 60 * 60 * 1000 },
  { key: 'raw_sugar_futures_mom', label: 'sugar futures', staleAfterMs: 7 * 24 * 60 * 60 * 1000 },
];

interface DriverSpec<K extends keyof SugarModelInputs> {
  key: K;
  kind: ShortageDriver['kind'];
  toRisk: (v: number) => number;
  label: (v: number) => string;
  when?: (v: number) => boolean;
  polarity?: 'risk' | 'protective';
}

const SUGAR_DRIVER_SPECS: DriverSpec<keyof SugarModelInputs>[] = [
  { key: 'rainfall_pct_of_normal', kind: 'production', toRisk: inverseLinear(40, 100),
    label: (v) => `Rainfall ${Math.round(v)}% of normal` },
  { key: 'soil_moisture_percentile', kind: 'production', toRisk: inverseLinear(0, 50),
    label: (v) => `Soil moisture ${Math.round(v)}th percentile` },
  { key: 'cane_yield_anomaly', kind: 'production', toRisk: inverseLinear(-15, 5),
    label: (v) => `Cane yield ${v.toFixed(1)}% vs normal` },
  { key: 'fertilizer_price_yoy', kind: 'production', toRisk: directLinear(0, 50),
    label: (v) => `Fertilizer prices +${Math.round(v)}% YoY` },
  { key: 'ethanol_diversion_pct', kind: 'demand', toRisk: directLinear(40, 65),
    label: (v) => `Ethanol diversion ${Math.round(v)}%` },
  { key: 'india_export_quota_pct', kind: 'transport', toRisk: inverseLinear(0, 100),
    label: (v) => `India export quota ${Math.round(v)}%` },
  { key: 'oil_price_brent', kind: 'demand', toRisk: directLinear(70, 110),
    label: (v) => `Brent at $${Math.round(v)}` },
  { key: 'raw_sugar_futures_mom', kind: 'price', toRisk: directLinear(0, 15),
    label: (v) => `Raw sugar futures +${v.toFixed(1)}% MoM` },
  { key: 'shipping_rates_brazil_panamax', kind: 'transport', toRisk: directLinear(0, 80),
    label: (v) => `Brazil shipping rates +${Math.round(v)}%` },
  { key: 'export_corridor_status', kind: 'transport', toRisk: directLinear(0, 100),
    label: (v) => `Export corridor ${Math.round(v)}/100 disrupted` },
];

export function computeSugarShortageRisk(
  inputs: SugarModelInputs,
  options: SugarModelOptions,
): ShortageForecast {
  const now = options.now ?? Date.now();
  const month = new Date(now).getUTCMonth() + 1;
  const drivers: ShortageDriver[] = [];
  for (const spec of SUGAR_DRIVER_SPECS) {
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
        polarity: spec.polarity,
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
  // seasonal is consulted later by playbook-aware UI. Compute it now
  // so the call exercises the helper at evaluation time even though we
  // don't currently surface it in the forecast shape.
  if (isSeasonalRisk(SUGAR_PLAYBOOK, month)) {
    // No-op marker: surface in a future revision once the forecast
    // shape carries a seasonal flag.
  }
  return {
    commodity: SUGAR_PLAYBOOK.commodity,
    domain: SUGAR_PLAYBOOK.domain,
    region: options.region,
    horizonDays: SUGAR_PLAYBOOK.forecastHorizonDays,
    riskScore: overall.riskScore,
    confidence,
    drivers,
    confirmingIndicators: [...SUGAR_PLAYBOOK.confirmingIndicators],
    invalidatingIndicators: [...SUGAR_PLAYBOOK.invalidatingIndicators],
    dataGaps,
    lastUpdated: new Date(now).toISOString(),
  };
}

function computeWorstFreshness(inputs: SugarModelInputs, now: number): number {
  const week = 7 * 24 * 60 * 60 * 1000;
  let worst = 1;
  for (const v of Object.values(inputs)) {
    if (!v) continue;
    const f = freshnessFor(v, week, now);
    if (f < worst) worst = f;
  }
  return worst;
}
