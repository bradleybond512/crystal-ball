/**
 * Deterministic corn shortage risk model.
 *
 * Same compositional pattern as wheat/diesel: provenance-aware inputs
 * → drivers + data gaps + confidence. Corn-specific signals: GDD
 * accumulation, pollination heat stress, USDA crop condition (good/
 * excellent percent), ethanol demand, feedlot demand.
 *
 * Pure deterministic. No fetch, no DOM.
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
import { CORN_PLAYBOOK, isSeasonalRisk } from './commodity-playbooks';

export interface CornModelInputs extends ShortageInputBag {
  rainfall_pct_of_normal?: ShortageInput;
  soil_moisture_percentile?: ShortageInput;
  /** NDVI anomaly vs 10y baseline. */
  ndvi_anomaly?: ShortageInput;
  /** Growing-degree-days accumulation as % of typical pace. */
  gdd_accumulation_pct?: ShortageInput;
  /** Temperature anomaly during pollination window in °C
   *  (positive = hotter than normal; >2°C is high stress). */
  pollination_window_temp_anomaly_c?: ShortageInput;
  fertilizer_price_yoy?: ShortageInput;
  /** Ethanol demand 0-100; >50 = elevated demand pulling on supply. */
  ethanol_demand_index?: ShortageInput;
  /** USDA Crop Condition rating: % good or excellent. <50 is poor. */
  usda_crop_condition_g_e_pct?: ShortageInput;
  local_corn_price_mom?: ShortageInput;
  futures_curve_tightness?: ShortageInput;
  feedlot_demand_index?: ShortageInput;
}

export interface CornModelOptions {
  region: string;
  now?: number;
}

const REQUIRED_INPUTS = [
  { key: 'rainfall_pct_of_normal', label: 'rainfall vs normal', staleAfterMs: 7 * 24 * 60 * 60 * 1000 },
  { key: 'soil_moisture_percentile', label: 'soil moisture percentile', staleAfterMs: 7 * 24 * 60 * 60 * 1000 },
  { key: 'usda_crop_condition_g_e_pct', label: 'USDA crop condition', staleAfterMs: 14 * 24 * 60 * 60 * 1000 },
  { key: 'local_corn_price_mom', label: 'local corn price', staleAfterMs: 14 * 24 * 60 * 60 * 1000 },
  { key: 'fertilizer_price_yoy', label: 'fertilizer prices', staleAfterMs: 30 * 24 * 60 * 60 * 1000 },
];

interface DriverSpec<K extends keyof CornModelInputs> {
  key: K;
  kind: ShortageDriver['kind'];
  toRisk: (v: number) => number;
  label: (v: number) => string;
  when?: (v: number) => boolean;
}

const CORN_DRIVER_SPECS: DriverSpec<keyof CornModelInputs>[] = [
  { key: 'rainfall_pct_of_normal', kind: 'production', toRisk: inverseLinear(40, 100),
    label: (v) => `Rainfall ${Math.round(v)}% of normal` },
  { key: 'soil_moisture_percentile', kind: 'production', toRisk: inverseLinear(0, 50),
    label: (v) => `Soil moisture ${Math.round(v)}th percentile` },
  { key: 'ndvi_anomaly', kind: 'production', toRisk: inverseLinear(-0.25, 0.05),
    label: (v) => `NDVI anomaly ${v.toFixed(2)} vs baseline` },
  { key: 'gdd_accumulation_pct', kind: 'production', toRisk: inverseLinear(60, 100),
    label: (v) => `GDD accumulation ${Math.round(v)}% of typical` },
  { key: 'pollination_window_temp_anomaly_c', kind: 'production', toRisk: directLinear(0, 4),
    label: (v) => `Pollination heat anomaly ${v >= 0 ? '+' : ''}${v.toFixed(1)}°C` },
  { key: 'usda_crop_condition_g_e_pct', kind: 'production', toRisk: inverseLinear(40, 80),
    label: (v) => `USDA condition ${Math.round(v)}% good/excellent` },
  { key: 'fertilizer_price_yoy', kind: 'policy', toRisk: directLinear(0, 60),
    label: (v) => `Fertilizer prices +${Math.round(v)}% YoY` },
  { key: 'ethanol_demand_index', kind: 'demand', toRisk: directLinear(50, 90),
    label: (v) => `Ethanol demand index ${Math.round(v)}` },
  { key: 'feedlot_demand_index', kind: 'demand', toRisk: directLinear(50, 90),
    label: (v) => `Feedlot demand index ${Math.round(v)}` },
  { key: 'local_corn_price_mom', kind: 'price', toRisk: directLinear(0, 25),
    label: (v) => `Local corn price ${v >= 0 ? '+' : ''}${Math.round(v)}% MoM` },
  { key: 'futures_curve_tightness', kind: 'price', toRisk: directLinear(0, 10),
    label: (v) => `Futures curve tightness ${v.toFixed(1)}` },
];

function buildDriversFromSpecs(
  inputs: CornModelInputs,
  specs: readonly DriverSpec<keyof CornModelInputs>[],
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

export function computeCornShortageRisk(
  inputs: CornModelInputs,
  options: CornModelOptions,
): ShortageForecast {
  const now = options.now ?? Date.now();
  const drivers = buildDriversFromSpecs(inputs, CORN_DRIVER_SPECS);

  // Pollination-window months (Jul) are the most consequential — bump
  // production drivers harder when in-season.
  const month = new Date(now).getUTCMonth() + 1;
  if (isSeasonalRisk(CORN_PLAYBOOK, month)) {
    const isPollination = month === 7;
    const multiplier = isPollination ? 1.15 : 1.08;
    for (const d of drivers) {
      if (d.kind === 'production') d.score = Math.min(100, Math.round(d.score * multiplier));
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
    commodity: CORN_PLAYBOOK.commodity,
    domain: CORN_PLAYBOOK.domain,
    region: options.region,
    horizonDays: CORN_PLAYBOOK.forecastHorizonDays,
    riskScore: overall.riskScore,
    confidence,
    drivers,
    confirmingIndicators: [...CORN_PLAYBOOK.confirmingIndicators],
    invalidatingIndicators: [...CORN_PLAYBOOK.invalidatingIndicators],
    dataGaps,
    lastUpdated: new Date(now).toISOString(),
  };
}

function computeWorstFreshness(inputs: CornModelInputs, now: number): number {
  const week = 7 * 24 * 60 * 60 * 1000;
  let worst = 1;
  for (const v of Object.values(inputs)) {
    if (!v) continue;
    const f = freshnessFor(v, week, now);
    if (f < worst) worst = f;
  }
  return worst;
}
