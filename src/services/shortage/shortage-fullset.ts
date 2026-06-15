/**
 * Shortage Full-Set — 8-commodity orchestrator for the Shortage Radar UI.
 *
 * Covers the task-spec set: wheat, corn, rice, soybeans, diesel, gasoline,
 * natural-gas, jet-fuel. Pure deterministic: no DOM, no fetch, no globals.
 *
 * Tracks a lightweight "previous snapshot" in module-level memory so the
 * UI can show a trend arrow without needing a database.
 */

import { computeWheatShortageRisk } from './wheat-shortage-risk';
import { computeCornShortageRisk } from './corn-shortage-risk';
import { computeRiceShortageRisk } from './rice-shortage-risk';
import { computeSoybeansShortageRisk } from './soybeans-shortage-risk';
import { computeDieselShortageRisk } from './diesel-shortage-risk';
import { computeGasolineShortageRisk } from './gasoline-shortage-risk';
import { computeNaturalGasShortageRisk } from './natural-gas-shortage-risk';
import { computeJetFuelShortageRisk } from './jet-fuel-shortage-risk';
import {
  computeFertilizerShortageRisk,
  computeCrudeShortageRisk,
  computePropaneShortageRisk,
  computeElectricityShortageRisk,
} from './energy-fertilizer-models';
import type { ShortageForecast, ShortageInputBag } from './shortage-types';
import { recordAlgorithmEvaluation } from '@/services/algorithms/record-evaluation';

// ── Public types ───────────────────────────────────────────────────────────

export type FullSetCommodity =
  | 'wheat'
  | 'corn'
  | 'rice'
  | 'soybeans'
  | 'diesel'
  | 'gasoline'
  | 'natural-gas'
  | 'jet-fuel'
  | 'fertilizer'
  | 'crude'
  | 'propane'
  | 'electricity';

export type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
export type Trend = 'improving' | 'stable' | 'deteriorating';

export const ALL_FULLSET_COMMODITIES: readonly FullSetCommodity[] = [
  'wheat',
  'corn',
  'rice',
  'soybeans',
  'diesel',
  'gasoline',
  'natural-gas',
  'jet-fuel',
  'fertilizer',
  'crude',
  'propane',
  'electricity',
];

export interface ShortageSummaryEntry {
  commodity: FullSetCommodity;
  riskScore: number;
  riskLevel: RiskLevel;
  primaryDrivers: string[];
  timeToImpact: string;
  trend: Trend;
  forecast: ShortageForecast;
}

export interface ShortageFullSetOptions {
  region?: string;
  /** Optional clock epoch ms for deterministic tests. */
  now?: number;
  /** When provided, only these commodities are computed; the rest are skipped
   *  entirely so their module-level trend memory is left untouched. The
   *  partial-outage supply merge uses this to avoid writing a discarded baseline
   *  score into trend state (which would show a false trend on recovery). Omit to
   *  compute the full set. */
  only?: ReadonlySet<FullSetCommodity>;
}

// ── Trend tracking ─────────────────────────────────────────────────────────
// Simple in-memory map for cross-render trend comparison. Module-level so
// it persists across panel refreshes without needing an IDB store.

const _prevScores = new Map<FullSetCommodity, number>();
const TREND_THRESHOLD = 3; // points needed to call improving/deteriorating

function deriveTrend(commodity: FullSetCommodity, current: number): Trend {
  const prev = _prevScores.get(commodity);
  _prevScores.set(commodity, current);
  if (prev === undefined) return 'stable';
  const delta = current - prev;
  if (delta >= TREND_THRESHOLD) return 'deteriorating';
  if (delta <= -TREND_THRESHOLD) return 'improving';
  return 'stable';
}

// ── Risk level mapping ─────────────────────────────────────────────────────

export function riskLevelFor(score: number): RiskLevel {
  if (score >= 75) return 'CRITICAL';
  if (score >= 50) return 'HIGH';
  if (score >= 25) return 'MODERATE';
  return 'LOW';
}

// ── Time-to-impact label ───────────────────────────────────────────────────

function timeToImpactLabel(horizonDays: number): string {
  if (horizonDays <= 30) return '≤30 days';
  if (horizonDays <= 60) return '≤60 days';
  return '≤90 days';
}

// ── Per-commodity runner ───────────────────────────────────────────────────

function runCommodity(
  commodity: FullSetCommodity,
  inputs: ShortageInputBag,
  region: string,
  now: number,
): ShortageForecast | undefined {
  const opts = { region, now };
  switch (commodity) {
    case 'wheat': {
      const _t0 = performance.now();
      const r = computeWheatShortageRisk(inputs, opts);
      if (r) {
        try {
          recordAlgorithmEvaluation('shortage-wheat', {
            durationMs: performance.now() - _t0,
            score: r.riskScore / 100,
            label: r.confidence,
            detail: { region, drivers: r.drivers.length, dataGaps: r.dataGaps.length },
          });
        } catch { /* ledger unavailable */ }
      }
      return r;
    }
    case 'corn': {        return computeCornShortageRisk(inputs, opts);
    }
    case 'rice': {        return computeRiceShortageRisk(inputs, opts);
    }
    case 'soybeans': {    return computeSoybeansShortageRisk(inputs, opts);
    }
    case 'diesel': {
      const _t0 = performance.now();
      const r = computeDieselShortageRisk(inputs, opts);
      if (r) {
        try {
          recordAlgorithmEvaluation('shortage-diesel', {
            durationMs: performance.now() - _t0,
            score: r.riskScore / 100,
            label: r.confidence,
            detail: { region, drivers: r.drivers.length, dataGaps: r.dataGaps.length },
          });
        } catch { /* ledger unavailable */ }
      }
      return r;
    }
    case 'gasoline': {    return computeGasolineShortageRisk(inputs, opts);
    }
    case 'natural-gas': { return computeNaturalGasShortageRisk(inputs, opts);
    }
    case 'jet-fuel': {    return computeJetFuelShortageRisk(inputs, opts);
    }
    case 'fertilizer': {  return computeFertilizerShortageRisk(inputs, opts);
    }
    case 'crude': {       return computeCrudeShortageRisk(inputs, opts);
    }
    case 'propane': {     return computePropaneShortageRisk(inputs, opts);
    }
    case 'electricity': { return computeElectricityShortageRisk(inputs, opts);
    }
  }
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Compute shortage summaries for all 8 commodities.
 * Pass empty record ({}) for any commodity to get a baseline forecast with
 * neutral/zero inputs (model still runs; confidence will be low).
 */
export function computeShortageFullSet(
  inputs: Partial<Record<FullSetCommodity, ShortageInputBag>>,
  options: ShortageFullSetOptions = {},
): ShortageSummaryEntry[] {
  const region = options.region ?? 'global';
  const now = options.now ?? Date.now();

  const entries: ShortageSummaryEntry[] = [];

  for (const commodity of ALL_FULLSET_COMMODITIES) {
    if (options.only && !options.only.has(commodity)) continue;
    const bag = inputs[commodity] ?? {};
    const forecast = runCommodity(commodity, bag, region, now);
    if (!forecast) continue;

    const drivers = [...forecast.drivers]
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((d) => d.label);

    entries.push({
      commodity,
      riskScore: forecast.riskScore,
      riskLevel: riskLevelFor(forecast.riskScore),
      primaryDrivers: drivers,
      timeToImpact: timeToImpactLabel(forecast.horizonDays),
      trend: deriveTrend(commodity, forecast.riskScore),
      forecast,
    });
  }

  return entries;
}

/** Returns the full forecast for a single commodity. */
export function computeShortageDetail(
  commodity: FullSetCommodity,
  inputs: ShortageInputBag,
  options: ShortageFullSetOptions = {},
): ShortageForecast | undefined {
  const region = options.region ?? 'global';
  const now = options.now ?? Date.now();
  return runCommodity(commodity, inputs, region, now);
}

/** Reset trend memory — used in tests. */
export function _resetTrendMemory(): void {
  _prevScores.clear();
}
