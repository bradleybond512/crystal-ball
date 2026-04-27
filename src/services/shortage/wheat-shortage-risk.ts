/**
 * Deterministic wheat shortage risk model.
 *
 * Per the plan's worked example (lines 53-63):
 *
 *   Wheat shortage risk rising in Region X:
 *   - rainfall 42% below normal during key growth window
 *   - soil moisture below 10th percentile
 *   - fertilizer prices rising
 *   - export corridor disrupted
 *   - local wheat prices up 18% month-over-month
 *   - FEWS NET classification deteriorating nearby
 *
 * The model takes a `ShortageInputBag` of those indicators (provenance-
 * aware), maps each to a 0-100 driver in the right bucket, runs the
 * shared scorer, and reports drivers + data gaps + confidence.
 *
 * No fetch, no globals. Tests pass synthetic inputs.
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
import { WHEAT_PLAYBOOK, isSeasonalRisk } from './commodity-playbooks';

export interface WheatModelInputs extends ShortageInputBag {
  /** Seasonal rainfall as % of normal. 50 = drought. */
  rainfall_pct_of_normal?: ShortageInput;
  /** Soil moisture percentile (0-100). 10 = severely dry. */
  soil_moisture_percentile?: ShortageInput;
  /** NDVI anomaly vs 10y baseline (negative = stressed). */
  ndvi_anomaly?: ShortageInput;
  /** Fertilizer price YoY % change (positive = rising costs). */
  fertilizer_price_yoy?: ShortageInput;
  /** Planting progress as % of typical pace at this date. */
  planting_progress_pct?: ShortageInput;
  /** Export corridor status: 0 = open, 100 = fully blocked. */
  export_corridor_status?: ShortageInput;
  /** Local wheat price month-over-month % change. */
  local_wheat_price_mom?: ShortageInput;
  /** Futures curve "tightness" (positive = backwardation). */
  futures_curve_tightness?: ShortageInput;
  /** Number of recent export bans by major producers. */
  export_ban_count?: ShortageInput;
  /** FEWS NET food-security stage 1-5 (5 = famine). */
  fews_net_stage?: ShortageInput;
}

export interface WheatModelOptions {
  region: string;
  /** Defaults to Date.now(). Inject for deterministic tests. */
  now?: number;
}

const REQUIRED_INPUTS = [
  { key: 'rainfall_pct_of_normal', label: 'rainfall vs normal', staleAfterMs: 7 * 24 * 60 * 60 * 1000 },
  { key: 'soil_moisture_percentile', label: 'soil moisture percentile', staleAfterMs: 7 * 24 * 60 * 60 * 1000 },
  { key: 'fertilizer_price_yoy', label: 'fertilizer prices', staleAfterMs: 30 * 24 * 60 * 60 * 1000 },
  { key: 'export_corridor_status', label: 'export corridor status', staleAfterMs: 14 * 24 * 60 * 60 * 1000 },
  { key: 'local_wheat_price_mom', label: 'local wheat price', staleAfterMs: 14 * 24 * 60 * 60 * 1000 },
];

// Each spec maps a single input key to a driver. Spec list is walked
// once in computeWheatShortageRisk so the function stays small.
interface DriverSpec<K extends keyof WheatModelInputs> {
  key: K;
  kind: ShortageDriver['kind'];
  toRisk: (v: number) => number;
  label: (v: number) => string;
  /** Optional gate — driver is skipped when the predicate returns false. */
  when?: (v: number) => boolean;
  polarity?: 'risk' | 'protective';
}

const WHEAT_DRIVER_SPECS: DriverSpec<keyof WheatModelInputs>[] = [
  { key: 'rainfall_pct_of_normal', kind: 'production', toRisk: inverseLinear(40, 100),
    label: (v) => `Rainfall ${Math.round(v)}% of normal` },
  { key: 'soil_moisture_percentile', kind: 'production', toRisk: inverseLinear(0, 50),
    label: (v) => `Soil moisture ${Math.round(v)}th percentile` },
  { key: 'ndvi_anomaly', kind: 'production', toRisk: inverseLinear(-0.25, 0.05),
    label: (v) => `NDVI anomaly ${v.toFixed(2)} vs baseline` },
  { key: 'planting_progress_pct', kind: 'production', toRisk: inverseLinear(40, 100),
    label: (v) => `Planting progress ${Math.round(v)}% of typical` },
  { key: 'fertilizer_price_yoy', kind: 'policy', toRisk: directLinear(0, 60),
    label: (v) => `Fertilizer prices +${Math.round(v)}% YoY` },
  { key: 'export_ban_count', kind: 'policy', toRisk: directLinear(0, 5),
    label: (v) => `${v} active export ban(s) by major producers`,
    when: (v) => v > 0 },
  { key: 'export_corridor_status', kind: 'transport', toRisk: (v) => v,
    label: (v) => `Export corridor status ${Math.round(v)}/100 disrupted` },
  { key: 'local_wheat_price_mom', kind: 'price', toRisk: directLinear(0, 30),
    label: (v) => `Local wheat price ${signed(v)}% MoM` },
  { key: 'futures_curve_tightness', kind: 'price', toRisk: directLinear(0, 10),
    label: (v) => `Futures curve tightness ${v.toFixed(1)}` },
  { key: 'fews_net_stage', kind: 'cross_domain', toRisk: directLinear(1, 5),
    label: (v) => `FEWS NET stage ${v.toFixed(0)}` },
];

function buildDriversFromSpecs(
  inputs: WheatModelInputs,
  specs: readonly DriverSpec<keyof WheatModelInputs>[],
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
        polarity: spec.polarity,
      }),
    );
  }
  return drivers;
}

export function computeWheatShortageRisk(
  inputs: WheatModelInputs,
  options: WheatModelOptions,
): ShortageForecast {
  const now = options.now ?? Date.now();
  const drivers = buildDriversFromSpecs(inputs, WHEAT_DRIVER_SPECS);

  // Seasonal multiplier: in-window stress is more meaningful than out-of-
  // window noise. We bump production drivers by +10% when in-season.
  const month = new Date(now).getUTCMonth() + 1;
  if (isSeasonalRisk(WHEAT_PLAYBOOK, month)) {
    for (const d of drivers) {
      if (d.kind === 'production') d.score = Math.min(100, Math.round(d.score * 1.1));
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
    commodity: WHEAT_PLAYBOOK.commodity,
    domain: WHEAT_PLAYBOOK.domain,
    region: options.region,
    horizonDays: WHEAT_PLAYBOOK.forecastHorizonDays,
    riskScore: overall.riskScore,
    confidence,
    drivers,
    confirmingIndicators: [...WHEAT_PLAYBOOK.confirmingIndicators],
    invalidatingIndicators: [...WHEAT_PLAYBOOK.invalidatingIndicators],
    dataGaps,
    lastUpdated: new Date(now).toISOString(),
  };
}

function computeWorstFreshness(inputs: WheatModelInputs, now: number): number {
  // 14 days = expected refresh window for the model's bread-and-butter
  // weekly indicators (rainfall, prices, FEWS NET).
  const week = 7 * 24 * 60 * 60 * 1000;
  let worst = 1;
  for (const v of Object.values(inputs)) {
    if (!v) continue;
    const f = freshnessFor(v, week, now);
    if (f < worst) worst = f;
  }
  return worst;
}

function signed(n: number): string {
  return n >= 0 ? `+${Math.round(n)}` : `${Math.round(n)}`;
}
