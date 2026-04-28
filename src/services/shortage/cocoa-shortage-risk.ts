/**
 * Deterministic cocoa shortage risk model — batch 5 of
 * docs/SHORTAGE_AND_COMMODITY_FORECAST_PLAN.md.
 *
 * Cocoa is dominated by Côte d'Ivoire + Ghana (60% of global supply).
 * The two main risk drivers are West African weather (Harmattan dust
 * + drought) and black-pod disease pressure during the wet season.
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
import { COCOA_PLAYBOOK, isSeasonalRisk } from './commodity-playbooks';

export interface CocoaModelInputs extends ShortageInputBag {
  rainfall_pct_of_normal?: ShortageInput;
  /** 0-100 dust intensity. 0 = clear, 100 = extreme Harmattan. */
  harmattan_dust_index?: ShortageInput;
  /** 0-100 black-pod disease pressure. */
  black_pod_disease_index?: ShortageInput;
  fertilizer_price_yoy?: ShortageInput;
  /** Combined Ghana + Côte d'Ivoire export pace as % of normal. */
  ghana_cote_divoire_export_pace?: ShortageInput;
  /** Midcrop pollination window temperature anomaly C. */
  midcrop_pollination_window_temp?: ShortageInput;
  cocoa_futures_mom?: ShortageInput;
  /** Global grindings (demand proxy) YoY %. */
  grindings_yoy?: ShortageInput;
  shipping_rates_west_africa?: ShortageInput;
}

export interface CocoaModelOptions {
  region: string;
  now?: number;
}

const REQUIRED_INPUTS = [
  { key: 'rainfall_pct_of_normal', label: 'rainfall vs normal', staleAfterMs: 7 * 24 * 60 * 60 * 1000 },
  { key: 'ghana_cote_divoire_export_pace', label: 'WA export pace', staleAfterMs: 14 * 24 * 60 * 60 * 1000 },
  { key: 'cocoa_futures_mom', label: 'cocoa futures', staleAfterMs: 7 * 24 * 60 * 60 * 1000 },
  { key: 'black_pod_disease_index', label: 'black pod disease', staleAfterMs: 14 * 24 * 60 * 60 * 1000 },
];

interface DriverSpec<K extends keyof CocoaModelInputs> {
  key: K;
  kind: ShortageDriver['kind'];
  toRisk: (v: number) => number;
  label: (v: number) => string;
}

const COCOA_DRIVER_SPECS: DriverSpec<keyof CocoaModelInputs>[] = [
  { key: 'rainfall_pct_of_normal', kind: 'production', toRisk: inverseLinear(50, 110),
    label: (v) => `Rainfall ${Math.round(v)}% of normal` },
  { key: 'harmattan_dust_index', kind: 'production', toRisk: directLinear(20, 80),
    label: (v) => `Harmattan dust ${Math.round(v)}/100` },
  { key: 'black_pod_disease_index', kind: 'production', toRisk: directLinear(20, 70),
    label: (v) => `Black-pod disease ${Math.round(v)}/100` },
  { key: 'fertilizer_price_yoy', kind: 'production', toRisk: directLinear(0, 50),
    label: (v) => `Fertilizer prices +${Math.round(v)}% YoY` },
  { key: 'ghana_cote_divoire_export_pace', kind: 'transport', toRisk: inverseLinear(60, 110),
    label: (v) => `WA export pace ${Math.round(v)}% of normal` },
  { key: 'midcrop_pollination_window_temp', kind: 'production', toRisk: directLinear(0, 5),
    label: (v) => `Midcrop temp anomaly +${v.toFixed(1)}°C` },
  { key: 'cocoa_futures_mom', kind: 'price', toRisk: directLinear(0, 15),
    label: (v) => `Cocoa futures +${v.toFixed(1)}% MoM` },
  { key: 'grindings_yoy', kind: 'demand', toRisk: directLinear(0, 8),
    label: (v) => `Grindings +${v.toFixed(1)}% YoY` },
  { key: 'shipping_rates_west_africa', kind: 'transport', toRisk: directLinear(0, 80),
    label: (v) => `WA shipping rates +${Math.round(v)}%` },
];

export function computeCocoaShortageRisk(
  inputs: CocoaModelInputs,
  options: CocoaModelOptions,
): ShortageForecast {
  const now = options.now ?? Date.now();
  const month = new Date(now).getUTCMonth() + 1;
  const drivers: ShortageDriver[] = [];
  for (const spec of COCOA_DRIVER_SPECS) {
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
  if (isSeasonalRisk(COCOA_PLAYBOOK, month)) {
    // Seasonal risk window — surfaced by the playbook-aware UI elsewhere.
  }
  return {
    commodity: COCOA_PLAYBOOK.commodity,
    domain: COCOA_PLAYBOOK.domain,
    region: options.region,
    horizonDays: COCOA_PLAYBOOK.forecastHorizonDays,
    riskScore: overall.riskScore,
    confidence,
    drivers,
    confirmingIndicators: [...COCOA_PLAYBOOK.confirmingIndicators],
    invalidatingIndicators: [...COCOA_PLAYBOOK.invalidatingIndicators],
    dataGaps,
    lastUpdated: new Date(now).toISOString(),
  };
}

function computeWorstFreshness(inputs: CocoaModelInputs, now: number): number {
  const week = 7 * 24 * 60 * 60 * 1000;
  let worst = 1;
  for (const v of Object.values(inputs)) {
    if (!v) continue;
    const f = freshnessFor(v, week, now);
    if (f < worst) worst = f;
  }
  return worst;
}
