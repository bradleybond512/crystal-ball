/**
 * Forecast Overlay — predictive threat regions for DeckGL map visualization
 *
 * Combines EMA forecast data (rolling 24-session risk scores) with active
 * situations from the situation engine to produce geographic risk regions
 * rendered as transparent colored circles on the map.
 *
 * Risk color gradient: green (0-25) → yellow (25-50) → orange (50-75) → red (75-100)
 */

import { forecastRegions, type ForecastResult } from './ema-forecast';
import { situationEngine } from './situation-engine';
import type { SituationDomain } from './situation-types';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ForecastRegion {
  id: string;
  center: [number, number]; // [lon, lat]
  riskScore: number; // 0-100
  velocity: number; // rate of change
  trend: 'rising' | 'stable' | 'falling';
  domains: string[]; // which signal domains contribute
  label: string; // region name
  radius: number; // km
}

// ── Region geo-center lookup ──────────────────────────────────────────────────

/** Approximate geographic centers for commonly tracked regions.
 *  Keys are lowercase region names that match EMA forecast region strings. */
const REGION_CENTERS: Record<string, [number, number]> = {
  'eastern europe': [30, 50],
  'western europe': [5, 48],
  'middle east': [45, 30],
  'east asia': [120, 35],
  'south asia': [78, 22],
  'southeast asia': [110, 5],
  'central asia': [65, 42],
  'north africa': [15, 30],
  'sub-saharan africa': [25, 0],
  'west africa': [-5, 10],
  'east africa': [38, 5],
  'southern africa': [28, -25],
  'north america': [-100, 45],
  'central america': [-88, 15],
  'south america': [-60, -15],
  'caribbean': [-70, 18],
  'oceania': [150, -25],
  'arctic': [0, 80],
  'caucasus': [44, 42],
  'balkans': [20, 43],
  'horn of africa': [44, 8],
  'sahel': [0, 15],
  'persian gulf': [52, 26],
  'taiwan strait': [120, 24],
  'south china sea': [115, 12],
  'black sea': [34, 43],
  'baltic': [22, 57],
  'korean peninsula': [127, 37],
  'levant': [36, 33],
  'maghreb': [3, 33],
  'indochina': [105, 16],
};

/** Default radius (km) for regions without situation geo data */
const DEFAULT_RADIUS_KM = 500;

// ── Domain mapping ────────────────────────────────────────────────────────────

const DOMAIN_FROM_TREND: Record<string, SituationDomain> = {
  up: 'military',
  stable: 'infrastructure',
  down: 'civil_unrest',
};

// ── Color helpers (exported for layer use) ────────────────────────────────────

/**
 * Map risk score (0-100) to RGBA color.
 * green (0-25) → yellow (25-50) → orange (50-75) → red (75-100)
 */
export function riskToColor(score: number): [number, number, number, number] {
  const s = Math.max(0, Math.min(100, score));
  // Opacity scales with risk: 25 at low, 200 at high
  const alpha = Math.round(25 + (s / 100) * 175);

  if (s <= 25) {
 // green → yellow
 const t = s / 25;
 return [Math.round(t * 255), 200, Math.round((1 - t) * 100), alpha];
  } else if (s <= 50) {
 // yellow → orange
 const t = (s - 25) / 25;
 return [255, Math.round(200 - t * 70), Math.round((1 - t) * 50), alpha];
  } else if (s <= 75) {
 // orange → red-orange
 const t = (s - 50) / 25;
 return [255, Math.round(130 - t * 80), 0, alpha];
  } else {
 // red-orange → deep red
 const t = (s - 75) / 25;
 return [255, Math.round(50 - t * 50), 0, alpha];
  }
}

/**
 * Map risk score to opacity for ScatterplotLayer (0.1 at 20, 0.5 at 80).
 * Linear interpolation between those anchor points, clamped.
 */
export function riskToOpacity(score: number): number {
  const s = Math.max(0, Math.min(100, score));
  // Linear: opacity = 0.1 + (score - 20) * (0.4 / 60), clamped to [0.05, 0.6]
  const raw = 0.1 + ((s - 20) / 60) * 0.4;
  return Math.max(0.05, Math.min(0.6, raw));
}

/**
 * Format trend arrow for label display.
 */
function trendArrow(trend: 'rising' | 'stable' | 'falling'): string {
  switch (trend) {
 case 'rising': { return '\u2191'; } // ↑
 case 'falling': { return '\u2193'; }  // ↓
 case 'stable': { return '\u2192'; } // →
  }
}

// ── Core builder ──────────────────────────────────────────────────────────────

function mapForecastTrend(t: ForecastResult['trending']): ForecastRegion['trend'] {
  switch (t) {
 case 'up': { return 'rising'; }
 case 'down': { return 'falling'; }
 default: { return 'stable'; }
  }
}

function phaseToTrend(phase: string): ForecastRegion['trend'] {
  if (phase === 'active') { return 'rising'; }
  if (phase === 'de-escalating') { return 'falling'; }
  return 'stable';
}

/**
 * Build EMA-based forecast regions from the rolling time-series data.
 */
function buildEMARegions(): ForecastRegion[] {
  const regions: ForecastRegion[] = [];
  const forecasts = forecastRegions();
  for (const f of forecasts) {
 if (f.risk24h < 20) continue;
 const key = f.region.toLowerCase();
 const center = REGION_CENTERS[key];
 if (!center) continue;

 const trend = mapForecastTrend(f.trending);
 regions.push({
 id: `ema-${key}`,
 center,
 riskScore: f.risk24h,
 velocity: f.deviation,
 trend,
 domains: [DOMAIN_FROM_TREND[f.trending] ?? 'compound'],
 label: `${f.region}`,
 radius: DEFAULT_RADIUS_KM,
 });
  }
  return regions;
}

/**
 * Build forecast overlay regions from EMA forecast + situation engine data.
 * Returns regions with risk >= 20 (below that is noise).
 */
export function buildForecastOverlay(): ForecastRegion[] {
  // 1. EMA forecast regions
  const regions = buildEMARegions();
  const seen = new Set<string>(regions.map(r => r.id.replace('ema-', '')));

  // 2. Situation engine active situations (add geo-located risk)
  const situations = situationEngine.getActionableSituations();
  for (const sit of situations) {
 if (!sit.geo || sit.confidence < 0.3) continue;
 const riskScore = Math.round(sit.confidence * 100);
 if (riskScore < 20) continue;

 const key = sit.geo.label.toLowerCase();
 // If we already have an EMA region for this area, merge risk upward
 const existing = regions.find(r => r.id === `ema-${key}`);
 if (existing) {
 existing.riskScore = Math.min(100, Math.max(existing.riskScore, riskScore));
 if (!existing.domains.includes(sit.domain)) {
 existing.domains.push(sit.domain);
 }
 continue;
 }

 // Avoid duplicates from multiple situations at same location
 const sitKey = `sit-${sit.id}`;
 if (seen.has(sitKey)) continue;
 seen.add(sitKey);

 const scenarioTrend = phaseToTrend(sit.phase);

 regions.push({
 id: sitKey,
 center: [sit.geo.lon, sit.geo.lat],
 riskScore,
 velocity: sit.domainDiversity * 0.5, // proxy for cross-domain escalation
 trend: scenarioTrend,
 domains: [sit.domain],
 label: sit.geo.label,
 radius: sit.geo.radiusKm || DEFAULT_RADIUS_KM,
 });
  }

  // Sort by risk descending for rendering priority
  return regions.sort((a, b) => b.riskScore - a.riskScore);
}

/**
 * Format a label string for map display: "⚠ Risk: 73 ↑"
 */
export function formatRegionLabel(region: ForecastRegion): string {
  return `\u26A0 ${region.label}: ${region.riskScore} ${trendArrow(region.trend)}`;
}

// ── Singleton ─────────────────────────────────────────────────────────────────

class ForecastOverlayService {
  private cachedRegions: ForecastRegion[] = [];
  private lastBuild = 0;
  private readonly CACHE_TTL_MS = 30_000; // 30 seconds

  /** Get forecast regions, rebuilding if cache is stale */
  getRegions(): ForecastRegion[] {
 const now = Date.now();
 if (now - this.lastBuild > this.CACHE_TTL_MS) {
 this.cachedRegions = buildForecastOverlay();
 this.lastBuild = now;
 }
 return this.cachedRegions;
  }

  /** Force a rebuild on next access */
  invalidate(): void {
 this.lastBuild = 0;
  }
}

export const forecastOverlay = new ForecastOverlayService();
