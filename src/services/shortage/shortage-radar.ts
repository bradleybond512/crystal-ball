/**
 * Shortage Radar — gap #9 from docs/ELITE_REMAINING_GAPS_FOR_CLAUDE.md.
 *
 * Pulls every registered commodity model into one ranked report the
 * Shortage Radar panel renders. Pure deterministic: callers pass
 * commodity inputs in, we run the right model, sort by risk score,
 * and produce a single `ShortageRadarReport` ready to display.
 *
 * No fetch, no DOM, no globals at import time. The host wires the
 * actual data feed → input mapping; this module just orchestrates.
 *
 * Plan invariants:
 *   - Every entry carries the model's confidence and data gaps so
 *     the user can see when "low risk" really means "we don't know"
 *   - Sort is risk score desc, then confidence desc — high-risk
 *     low-confidence entries surface above low-risk high-confidence
 *   - Output is JSON-serializable for the Claude debug bundle
 */

import { computeWheatShortageRisk } from './wheat-shortage-risk';
import { computeCornShortageRisk } from './corn-shortage-risk';
import { computeDieselShortageRisk } from './diesel-shortage-risk';
import { computeGasolineShortageRisk } from './gasoline-shortage-risk';
import { computeSugarShortageRisk } from './sugar-shortage-risk';
import { computeCoffeeShortageRisk } from './coffee-shortage-risk';
import { computeCocoaShortageRisk } from './cocoa-shortage-risk';
import type {
  ShortageForecast,
  ShortageInputBag,
} from './shortage-types';

// ── Public API ──────────────────────────────────────────────────────────

export type ShortageCommodity =
  | 'wheat'
  | 'corn'
  | 'diesel'
  | 'gasoline'
  | 'sugar'
  | 'coffee'
  | 'cocoa';

export const ALL_RADAR_COMMODITIES: readonly ShortageCommodity[] = [
  'wheat',
  'corn',
  'diesel',
  'gasoline',
  'sugar',
  'coffee',
  'cocoa',
];

export interface ShortageRadarRequest {
  commodity: ShortageCommodity;
  region: string;
  inputs: ShortageInputBag;
}

export interface ShortageRadarOptions {
  /** Optional clock for tests. Defaults to Date.now(). */
  now?: () => number;
}

export interface ShortageRadarEntry {
  commodity: ShortageCommodity;
  forecast: ShortageForecast;
  /** Top driver labels by score, capped at 3 for the UI. */
  topDrivers: string[];
  /** Plain-English headline for the panel. */
  headline: string;
}

export interface ShortageRadarReport {
  generatedAt: number;
  entries: readonly ShortageRadarEntry[];
  /** "3 commodities elevated, 1 critical, 3 low." */
  summary: string;
  /** Concrete next-action hints sorted by risk score. */
  recommendations: readonly string[];
}

// ── Orchestrator ───────────────────────────────────────────────────────

export function buildShortageRadar(
  requests: readonly ShortageRadarRequest[],
  options: ShortageRadarOptions = {},
): ShortageRadarReport {
  const now = options.now ?? (() => Date.now());
  const generatedAt = now();
  const entries: ShortageRadarEntry[] = [];
  for (const req of requests) {
    const forecast = runOne(req, generatedAt);
    if (!forecast) continue;
    entries.push({
      commodity: req.commodity,
      forecast,
      topDrivers: pickTopDrivers(forecast),
      headline: buildHeadline(req.commodity, forecast),
    });
  }
  entries.sort((a, b) => {
    if (b.forecast.riskScore !== a.forecast.riskScore) {
      return b.forecast.riskScore - a.forecast.riskScore;
    }
    return CONFIDENCE_RANK[b.forecast.confidence] - CONFIDENCE_RANK[a.forecast.confidence];
  });
  return {
    generatedAt,
    entries,
    summary: describeSummary(entries),
    recommendations: collectRecommendations(entries),
  };
}

// ── Per-commodity runner ───────────────────────────────────────────────

function runOne(req: ShortageRadarRequest, generatedAt: number): ShortageForecast | undefined {
  switch (req.commodity) {
    case 'wheat': {
      return computeWheatShortageRisk(req.inputs, { region: req.region, now: generatedAt });
    }
    case 'corn': {
      return computeCornShortageRisk(req.inputs, { region: req.region, now: generatedAt });
    }
    case 'diesel': {
      return computeDieselShortageRisk(req.inputs, { region: req.region, now: generatedAt });
    }
    case 'gasoline': {
      return computeGasolineShortageRisk(req.inputs, { region: req.region, now: generatedAt });
    }
    case 'sugar': {
      return computeSugarShortageRisk(req.inputs, { region: req.region, now: generatedAt });
    }
    case 'coffee': {
      return computeCoffeeShortageRisk(req.inputs, { region: req.region, now: generatedAt });
    }
    case 'cocoa': {
      return computeCocoaShortageRisk(req.inputs, { region: req.region, now: generatedAt });
    }
  }
}

// ── Output helpers ─────────────────────────────────────────────────────

function pickTopDrivers(forecast: ShortageForecast): string[] {
  return [...forecast.drivers]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((d) => d.label);
}

function buildHeadline(commodity: ShortageCommodity, forecast: ShortageForecast): string {
  const tier = pickTier(forecast.riskScore);
  const region = forecast.region;
  const noun = capitalize(commodity);
  return `${noun} (${region}): ${tier}`;
}

function pickTier(riskScore: number): string {
  if (riskScore >= 75) return 'CRITICAL';
  if (riskScore >= 50) return 'ELEVATED';
  if (riskScore >= 25) return 'WATCH';
  return 'CALM';
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

const CONFIDENCE_RANK: Record<'low' | 'medium' | 'high', number> = {
  low: 0,
  medium: 1,
  high: 2,
};

function formatDataGapNote(gapCount: number): string {
  if (gapCount === 0) return '';
  const noun = gapCount === 1 ? 'data gap' : 'data gaps';
  return ` (${gapCount} ${noun} — confidence reduced)`;
}

function describeSummary(entries: readonly ShortageRadarEntry[]): string {
  if (entries.length === 0) return 'No commodity feeds wired into the radar yet.';
  const tally = { critical: 0, elevated: 0, watch: 0, calm: 0 };
  for (const e of entries) {
    const t = pickTier(e.forecast.riskScore).toLowerCase() as keyof typeof tally;
    tally[t] += 1;
  }
  const parts: string[] = [];
  if (tally.critical) parts.push(`${tally.critical} critical`);
  if (tally.elevated) parts.push(`${tally.elevated} elevated`);
  if (tally.watch) parts.push(`${tally.watch} watch`);
  if (tally.calm) parts.push(`${tally.calm} calm`);
  return parts.length === 0 ? 'No commodities reporting.' : `Commodities: ${parts.join(', ')}.`;
}

function collectRecommendations(entries: readonly ShortageRadarEntry[]): readonly string[] {
  const out: string[] = [];
  for (const e of entries) {
    if (e.forecast.riskScore < 50) continue;
    const drivers = e.topDrivers.slice(0, 2).join(', ');
    const tier = pickTier(e.forecast.riskScore);
    const dataGapNote = formatDataGapNote(e.forecast.dataGaps.length);
    out.push(`${capitalize(e.commodity)} ${tier}: ${drivers}${dataGapNote}.`);
    if (out.length >= 6) break;
  }
  return out;
}
