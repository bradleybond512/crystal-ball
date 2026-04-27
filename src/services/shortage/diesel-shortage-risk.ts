/**
 * Deterministic diesel shortage risk model.
 *
 * Per the plan's worked example (lines 99-106):
 *
 *   Diesel stress risk rising:
 *   - distillate inventories below 5-year range
 *   - refinery utilization falling
 *   - imports down week-over-week
 *   - port weather risk increasing
 *   - freight demand stable/rising
 *   - diesel crack spread widening
 *
 * Same compositional pattern as the wheat model — provenance-aware
 * inputs in, drivers + data gaps + confidence out. No fetch.
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
import { DIESEL_PLAYBOOK, isSeasonalRisk } from './commodity-playbooks';

export interface DieselModelInputs extends ShortageInputBag {
  /** Distillate inventory % deviation from 5-year average. Negative = below. */
  distillate_inventory_vs_5yr?: ShortageInput;
  /** Refinery utilization % (national or region). 90+ healthy. */
  refinery_utilization_pct?: ShortageInput;
  /** Crude imports week-over-week % change. Negative = falling. */
  crude_imports_wow?: ShortageInput;
  /** Distillate crack spread (USD/bbl). Wide = stress. */
  crack_spread_distillate?: ShortageInput;
  /** Capacity offline as % of total refining capacity. */
  refinery_outage_capacity_pct?: ShortageInput;
  /** Gulf weather risk index 0-100. */
  gulf_weather_risk?: ShortageInput;
  /** Diesel retail price week-over-week % change. */
  diesel_retail_price_wow?: ShortageInput;
  /** Freight demand index (0-100, 50 = baseline). */
  freight_demand_index?: ShortageInput;
  /** Distillate futures curve (positive = backwardation). */
  futures_curve_distillate?: ShortageInput;
  /** Strategic Petroleum Reserve release flag (0 = none, 1 = announced). */
  spr_release_announcement?: ShortageInput;
}

export interface DieselModelOptions {
  region: string;
  /** Defaults to Date.now(). Inject for deterministic tests. */
  now?: number;
}

const REQUIRED_INPUTS = [
  { key: 'distillate_inventory_vs_5yr', label: 'distillate inventory', staleAfterMs: 8 * 24 * 60 * 60 * 1000 },
  { key: 'refinery_utilization_pct', label: 'refinery utilization', staleAfterMs: 8 * 24 * 60 * 60 * 1000 },
  { key: 'crack_spread_distillate', label: 'crack spread', staleAfterMs: 3 * 24 * 60 * 60 * 1000 },
  { key: 'diesel_retail_price_wow', label: 'retail diesel price', staleAfterMs: 8 * 24 * 60 * 60 * 1000 },
];

interface DriverSpec<K extends keyof DieselModelInputs> {
  key: K;
  kind: ShortageDriver['kind'];
  toRisk: (v: number) => number;
  label: (v: number) => string;
  when?: (v: number) => boolean;
  polarity?: 'risk' | 'protective';
}

const DIESEL_DRIVER_SPECS: DriverSpec<keyof DieselModelInputs>[] = [
  { key: 'distillate_inventory_vs_5yr', kind: 'inventory', toRisk: inverseLinear(-25, 10),
    label: (v) => `Distillate inventory ${signedPct(v)} vs 5-yr avg` },
  { key: 'refinery_utilization_pct', kind: 'production', toRisk: inverseLinear(75, 95),
    label: (v) => `Refinery utilization ${Math.round(v)}%` },
  { key: 'refinery_outage_capacity_pct', kind: 'production', toRisk: directLinear(0, 15),
    label: (v) => `${v.toFixed(1)}% capacity offline` },
  { key: 'crude_imports_wow', kind: 'transport', toRisk: inverseLinear(-25, 5),
    label: (v) => `Crude imports ${signedPct(v)} WoW` },
  { key: 'gulf_weather_risk', kind: 'transport', toRisk: (v) => v,
    label: (v) => `Gulf weather risk ${Math.round(v)}/100` },
  { key: 'freight_demand_index', kind: 'demand', toRisk: directLinear(50, 80),
    label: (v) => `Freight demand index ${Math.round(v)}` },
  { key: 'crack_spread_distillate', kind: 'price', toRisk: directLinear(20, 50),
    label: (v) => `Distillate crack spread $${v.toFixed(1)}/bbl` },
  { key: 'diesel_retail_price_wow', kind: 'price', toRisk: directLinear(0, 10),
    label: (v) => `Retail diesel ${signedPct(v)} WoW` },
  { key: 'futures_curve_distillate', kind: 'price', toRisk: directLinear(0, 10),
    label: (v) => `Distillate futures curve ${v.toFixed(1)}` },
  { key: 'spr_release_announcement', kind: 'policy', toRisk: () => 100,
    label: () => 'SPR release announced — partially protective',
    when: (v) => v > 0, polarity: 'protective' },
];

function buildDriversFromSpecs(
  inputs: DieselModelInputs,
  specs: readonly DriverSpec<keyof DieselModelInputs>[],
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

export function computeDieselShortageRisk(
  inputs: DieselModelInputs,
  options: DieselModelOptions,
): ShortageForecast {
  const now = options.now ?? Date.now();
  const drivers = buildDriversFromSpecs(inputs, DIESEL_DRIVER_SPECS);

  // Hurricane-season bump for transport and production drivers.
  const month = new Date(now).getUTCMonth() + 1;
  if (isSeasonalRisk(DIESEL_PLAYBOOK, month)) {
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
    commodity: DIESEL_PLAYBOOK.commodity,
    domain: DIESEL_PLAYBOOK.domain,
    region: options.region,
    horizonDays: DIESEL_PLAYBOOK.forecastHorizonDays,
    riskScore: overall.riskScore,
    confidence,
    drivers,
    confirmingIndicators: [...DIESEL_PLAYBOOK.confirmingIndicators],
    invalidatingIndicators: [...DIESEL_PLAYBOOK.invalidatingIndicators],
    dataGaps,
    lastUpdated: new Date(now).toISOString(),
  };
}

function computeWorstFreshness(inputs: DieselModelInputs, now: number): number {
  // EIA weekly publishes Wed; markets refresh daily. 7 days is a fair
  // worst-case refresh window for the slowest input.
  const week = 7 * 24 * 60 * 60 * 1000;
  let worst = 1;
  for (const v of Object.values(inputs)) {
    if (!v) continue;
    const f = freshnessFor(v, week, now);
    if (f < worst) worst = f;
  }
  return worst;
}

function signedPct(n: number): string {
  return n >= 0 ? `+${n.toFixed(1)}%` : `${n.toFixed(1)}%`;
}
