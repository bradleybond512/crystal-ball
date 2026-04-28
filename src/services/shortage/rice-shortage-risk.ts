/**
 * Deterministic rice shortage risk model.
 *
 * Rice-specific signals: monsoon rainfall (the headline driver for
 * Asian rice belts), paddy water availability, India's export-ban
 * stance (India is the world's largest rice exporter; bans cascade
 * fast), Thai export-price MoM (the global benchmark for rice prices).
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
import { RICE_PLAYBOOK, isSeasonalRisk } from './commodity-playbooks';

export interface RiceModelInputs extends ShortageInputBag {
  /** Monsoon rainfall % of normal (seasonal cumulative). */
  monsoon_rainfall_pct_of_normal?: ShortageInput;
  /** Paddy water availability index (0-100; 0 = severely constrained). */
  paddy_water_availability_index?: ShortageInput;
  fertilizer_price_yoy?: ShortageInput;
  /** Export corridor status (0 = open, 100 = blocked). */
  export_corridor_status?: ShortageInput;
  planting_progress_pct?: ShortageInput;
  /** Thai 5% white rice export price MoM (global benchmark). */
  thai_rice_export_price_mom?: ShortageInput;
  /** 0 = no Indian export ban, 1 = ban active. */
  india_export_ban_active?: ShortageInput;
  /** FEWS NET food-security stage 1-5. */
  fews_net_stage?: ShortageInput;
  /** Futures curve tightness (positive = backwardation). */
  futures_curve_tightness?: ShortageInput;
}

export interface RiceModelOptions {
  region: string;
  now?: number;
}

const REQUIRED_INPUTS = [
  { key: 'monsoon_rainfall_pct_of_normal', label: 'monsoon rainfall', staleAfterMs: 14 * 24 * 60 * 60 * 1000 },
  { key: 'paddy_water_availability_index', label: 'paddy water availability', staleAfterMs: 14 * 24 * 60 * 60 * 1000 },
  { key: 'thai_rice_export_price_mom', label: 'Thai rice export price', staleAfterMs: 14 * 24 * 60 * 60 * 1000 },
  { key: 'fews_net_stage', label: 'FEWS NET stage', staleAfterMs: 30 * 24 * 60 * 60 * 1000 },
];

interface DriverSpec<K extends keyof RiceModelInputs> {
  key: K;
  kind: ShortageDriver['kind'];
  toRisk: (v: number) => number;
  label: (v: number) => string;
  when?: (v: number) => boolean;
}

const RICE_DRIVER_SPECS: DriverSpec<keyof RiceModelInputs>[] = [
  { key: 'monsoon_rainfall_pct_of_normal', kind: 'production', toRisk: inverseLinear(50, 100),
    label: (v) => `Monsoon rainfall ${Math.round(v)}% of normal` },
  { key: 'paddy_water_availability_index', kind: 'production', toRisk: inverseLinear(0, 80),
    label: (v) => `Paddy water availability ${Math.round(v)}/100` },
  { key: 'planting_progress_pct', kind: 'production', toRisk: inverseLinear(50, 100),
    label: (v) => `Planting progress ${Math.round(v)}% of typical` },
  { key: 'fertilizer_price_yoy', kind: 'policy', toRisk: directLinear(0, 60),
    label: (v) => `Fertilizer prices +${Math.round(v)}% YoY` },
  { key: 'export_corridor_status', kind: 'transport', toRisk: (v) => v,
    label: (v) => `Export corridor status ${Math.round(v)}/100 disrupted` },
  { key: 'india_export_ban_active', kind: 'policy', toRisk: () => 100,
    label: () => 'Indian export ban active — global supply tightens fast', when: (v) => v > 0 },
  { key: 'thai_rice_export_price_mom', kind: 'price', toRisk: directLinear(0, 25),
    label: (v) => `Thai 5% rice price ${v >= 0 ? '+' : ''}${Math.round(v)}% MoM` },
  { key: 'futures_curve_tightness', kind: 'price', toRisk: directLinear(0, 10),
    label: (v) => `Futures curve tightness ${v.toFixed(1)}` },
  { key: 'fews_net_stage', kind: 'cross_domain', toRisk: directLinear(1, 5),
    label: (v) => `FEWS NET stage ${v.toFixed(0)}` },
];

function buildDriversFromSpecs(
  inputs: RiceModelInputs,
  specs: readonly DriverSpec<keyof RiceModelInputs>[],
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

export function computeRiceShortageRisk(
  inputs: RiceModelInputs,
  options: RiceModelOptions,
): ShortageForecast {
  const now = options.now ?? Date.now();
  const drivers = buildDriversFromSpecs(inputs, RICE_DRIVER_SPECS);

  // Monsoon season (May-Oct) bumps production drivers.
  const month = new Date(now).getUTCMonth() + 1;
  if (isSeasonalRisk(RICE_PLAYBOOK, month)) {
    for (const d of drivers) {
      if (d.kind === 'production') d.score = Math.min(100, Math.round(d.score * 1.12));
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
    commodity: RICE_PLAYBOOK.commodity,
    domain: RICE_PLAYBOOK.domain,
    region: options.region,
    horizonDays: RICE_PLAYBOOK.forecastHorizonDays,
    riskScore: overall.riskScore,
    confidence,
    drivers,
    confirmingIndicators: [...RICE_PLAYBOOK.confirmingIndicators],
    invalidatingIndicators: [...RICE_PLAYBOOK.invalidatingIndicators],
    dataGaps,
    lastUpdated: new Date(now).toISOString(),
  };
}

function computeWorstFreshness(inputs: RiceModelInputs, now: number): number {
  const week = 7 * 24 * 60 * 60 * 1000;
  let worst = 1;
  for (const v of Object.values(inputs)) {
    if (!v) continue;
    const f = freshnessFor(v, week, now);
    if (f < worst) worst = f;
  }
  return worst;
}
