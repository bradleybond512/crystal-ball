/**
 * Deterministic soybeans shortage risk model.
 *
 * Soybean-specific signals: La Niña pattern flag (most consequential
 * for South American belt), China crush demand (China is the largest
 * importer; demand swings move the global market), CBOT MoM, soy meal
 * basis widening.
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
import { SOYBEANS_PLAYBOOK, isSeasonalRisk } from './commodity-playbooks';

export interface SoybeansModelInputs extends ShortageInputBag {
  rainfall_pct_of_normal?: ShortageInput;
  soil_moisture_percentile?: ShortageInput;
  ndvi_anomaly?: ShortageInput;
  planting_progress_pct?: ShortageInput;
  /** La Niña intensity 0-100 (0 = neutral; 100 = strong, dry SA). */
  south_america_la_nina_signal?: ShortageInput;
  /** China crush demand index 50 = baseline; >70 = elevated demand pull. */
  china_crush_demand_index?: ShortageInput;
  /** USDA Crop Condition rating: % good or excellent. */
  usda_crop_condition_g_e_pct?: ShortageInput;
  /** CBOT soybean price MoM % change. */
  cbot_soy_price_mom?: ShortageInput;
  /** Soy meal basis widening (positive = stress). */
  soy_meal_basis_widening?: ShortageInput;
  futures_curve_tightness?: ShortageInput;
}

export interface SoybeansModelOptions {
  region: string;
  now?: number;
}

const REQUIRED_INPUTS = [
  { key: 'rainfall_pct_of_normal', label: 'rainfall vs normal', staleAfterMs: 7 * 24 * 60 * 60 * 1000 },
  { key: 'usda_crop_condition_g_e_pct', label: 'USDA crop condition', staleAfterMs: 14 * 24 * 60 * 60 * 1000 },
  { key: 'cbot_soy_price_mom', label: 'CBOT soybean price', staleAfterMs: 7 * 24 * 60 * 60 * 1000 },
  { key: 'china_crush_demand_index', label: 'China crush demand', staleAfterMs: 14 * 24 * 60 * 60 * 1000 },
];

interface DriverSpec<K extends keyof SoybeansModelInputs> {
  key: K;
  kind: ShortageDriver['kind'];
  toRisk: (v: number) => number;
  label: (v: number) => string;
  when?: (v: number) => boolean;
}

const SOY_DRIVER_SPECS: DriverSpec<keyof SoybeansModelInputs>[] = [
  { key: 'rainfall_pct_of_normal', kind: 'production', toRisk: inverseLinear(40, 100),
    label: (v) => `Rainfall ${Math.round(v)}% of normal` },
  { key: 'soil_moisture_percentile', kind: 'production', toRisk: inverseLinear(0, 50),
    label: (v) => `Soil moisture ${Math.round(v)}th percentile` },
  { key: 'ndvi_anomaly', kind: 'production', toRisk: inverseLinear(-0.25, 0.05),
    label: (v) => `NDVI anomaly ${v.toFixed(2)} vs baseline` },
  { key: 'planting_progress_pct', kind: 'production', toRisk: inverseLinear(50, 100),
    label: (v) => `Planting progress ${Math.round(v)}% of typical` },
  { key: 'usda_crop_condition_g_e_pct', kind: 'production', toRisk: inverseLinear(40, 80),
    label: (v) => `USDA condition ${Math.round(v)}% good/excellent` },
  { key: 'south_america_la_nina_signal', kind: 'cross_domain', toRisk: directLinear(0, 80),
    label: (v) => `La Niña signal ${Math.round(v)}/100 (SA dryness)` },
  { key: 'china_crush_demand_index', kind: 'demand', toRisk: directLinear(50, 90),
    label: (v) => `China crush demand ${Math.round(v)}` },
  { key: 'cbot_soy_price_mom', kind: 'price', toRisk: directLinear(0, 25),
    label: (v) => `CBOT soybean price ${v >= 0 ? '+' : ''}${Math.round(v)}% MoM` },
  { key: 'soy_meal_basis_widening', kind: 'price', toRisk: directLinear(0, 8),
    label: (v) => `Soy meal basis +${v.toFixed(1)}` },
  { key: 'futures_curve_tightness', kind: 'price', toRisk: directLinear(0, 10),
    label: (v) => `Futures curve tightness ${v.toFixed(1)}` },
];

function buildDriversFromSpecs(
  inputs: SoybeansModelInputs,
  specs: readonly DriverSpec<keyof SoybeansModelInputs>[],
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

export function computeSoybeansShortageRisk(
  inputs: SoybeansModelInputs,
  options: SoybeansModelOptions,
): ShortageForecast {
  const now = options.now ?? Date.now();
  const drivers = buildDriversFromSpecs(inputs, SOY_DRIVER_SPECS);

  // Soy is in-season most of the year (US summer + SA spring/summer).
  const month = new Date(now).getUTCMonth() + 1;
  if (isSeasonalRisk(SOYBEANS_PLAYBOOK, month)) {
    for (const d of drivers) {
      if (d.kind === 'production') d.score = Math.min(100, Math.round(d.score * 1.08));
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
    commodity: SOYBEANS_PLAYBOOK.commodity,
    domain: SOYBEANS_PLAYBOOK.domain,
    region: options.region,
    horizonDays: SOYBEANS_PLAYBOOK.forecastHorizonDays,
    riskScore: overall.riskScore,
    confidence,
    drivers,
    confirmingIndicators: [...SOYBEANS_PLAYBOOK.confirmingIndicators],
    invalidatingIndicators: [...SOYBEANS_PLAYBOOK.invalidatingIndicators],
    dataGaps,
    lastUpdated: new Date(now).toISOString(),
  };
}

function computeWorstFreshness(inputs: SoybeansModelInputs, now: number): number {
  const week = 7 * 24 * 60 * 60 * 1000;
  let worst = 1;
  for (const v of Object.values(inputs)) {
    if (!v) continue;
    const f = freshnessFor(v, week, now);
    if (f < worst) worst = f;
  }
  return worst;
}
