/**
 * Escalation Timeline Forecasting Service
 *
 * Computes per-theater escalation scores (0-100) and estimates days to
 * potential conflict using an exponential decay model. Consumes data from
 * military-surge (theater posture), EMA forecast (event velocity), and
 * cross-module-integration (alerts).
 *
 * Weight breakdown:
 * 40% — military concentration deviation (aircraft + vessel counts vs baseline)
 * 25% — ACLED / event velocity trend (from EMA forecast)
 * 20% — cross-domain signals (situation clusters, convergence alerts)
 * 15% — recent escalation rate (score momentum over last 5 points)
 *
 * Exported API:
 * getEscalationForecasts() — current snapshot for all 9 theaters
 * getTheaterHistory(theaterId) — last 30 score points for sparklines
 * subscribeEscalation(cb) — push-based notifications
 * updateEscalationForecasts() — recalculate (call from data-loader)
 */

import type { TheaterPostureSummary } from './military-surge';
import { forecastRegions, type ForecastResult } from './ema-forecast';
import { getRecentAlerts, type UnifiedAlert } from './cross-module-integration';

// ── Types ─────────────────────────────────────────────────────────────────

export interface EscalationFactor {
  name: string;
  weight: number; // 0-1
  rawValue: number;  // component score 0-100
  contribution: number; // weight × rawValue
  detail: string;
}

export interface EscalationForecast {
  theaterId: string;
  name: string;
  region: string;
  score: number; // 0-100
  trend: 'rising' | 'stable' | 'falling';
  estimatedDays: number | null;  // null if score < 40 (stable)
  factors: EscalationFactor[];
  lastUpdated: number; // epoch ms
}

export interface ScorePoint {
  timestamp: number;
  score: number;
}

// ── Theater Definitions ───────────────────────────────────────────────────

interface TheaterDef {
  id: string;
  name: string;
  region: string;
  postureTheaterId: string; // maps to military-surge PostureTheater.id
  emaRegions: string[]; // EMA forecast region keys to aggregate
  baselineTension: number; // 0-100 historical baseline (higher = chronically tense)
  aircraftBaseline: number; // typical total aircraft count
  vesselBaseline: number; // typical total vessel count
}

const THEATER_DEFS: TheaterDef[] = [
  {
 id: 'iran',
 name: 'Iran Theater',
 region: 'Middle East',
 postureTheaterId: 'iran-theater',
 emaRegions: ['persian-gulf', 'strait-hormuz', 'iran-border', 'Iran'],
 baselineTension: 55,
 aircraftBaseline: 8,
 vesselBaseline: 4,
  },
  {
 id: 'taiwan',
 name: 'Taiwan Strait',
 region: 'Indo-Pacific',
 postureTheaterId: 'taiwan-theater',
 emaRegions: ['taiwan-strait', 'south-china-sea', 'Taiwan'],
 baselineTension: 50,
 aircraftBaseline: 6,
 vesselBaseline: 5,
  },
  {
 id: 'baltic',
 name: 'Baltic Theater',
 region: 'Europe',
 postureTheaterId: 'baltic-theater',
 emaRegions: ['baltics', 'poland-border', 'kaliningrad', 'Baltic'],
 baselineTension: 40,
 aircraftBaseline: 5,
 vesselBaseline: 3,
  },
  {
 id: 'blacksea',
 name: 'Black Sea',
 region: 'Europe',
 postureTheaterId: 'blacksea-theater',
 emaRegions: ['black-sea', 'Black Sea'],
 baselineTension: 60,
 aircraftBaseline: 4,
 vesselBaseline: 3,
  },
  {
 id: 'korea',
 name: 'Korean Peninsula',
 region: 'Indo-Pacific',
 postureTheaterId: 'korea-theater',
 emaRegions: ['korean-dmz', 'sea-of-japan', 'Korea'],
 baselineTension: 45,
 aircraftBaseline: 5,
 vesselBaseline: 3,
  },
  {
 id: 'scs',
 name: 'South China Sea',
 region: 'Indo-Pacific',
 postureTheaterId: 'south-china-sea',
 emaRegions: ['south-china-sea', 'South China Sea'],
 baselineTension: 45,
 aircraftBaseline: 6,
 vesselBaseline: 5,
  },
  {
 id: 'eastmed',
 name: 'Eastern Mediterranean',
 region: 'Middle East',
 postureTheaterId: 'east-med-theater',
 emaRegions: ['east-med', 'eastern-med', 'Eastern Mediterranean'],
 baselineTension: 40,
 aircraftBaseline: 4,
 vesselBaseline: 3,
  },
  {
 id: 'gaza',
 name: 'Israel / Gaza',
 region: 'Middle East',
 postureTheaterId: 'israel-gaza-theater',
 emaRegions: ['israel', 'gaza', 'Israel', 'Gaza'],
 baselineTension: 70,
 aircraftBaseline: 3,
 vesselBaseline: 2,
  },
  {
 id: 'redsea',
 name: 'Yemen / Red Sea',
 region: 'Middle East',
 postureTheaterId: 'yemen-redsea-theater',
 emaRegions: ['yemen', 'red-sea', 'bab-el-mandeb', 'Yemen', 'Red Sea'],
 baselineTension: 55,
 aircraftBaseline: 4,
 vesselBaseline: 3,
  },
];

// ── State ─────────────────────────────────────────────────────────────────

const MAX_HISTORY = 30;
const scoreHistory = new Map<string, ScorePoint[]>();
const latestForecasts = new Map<string, EscalationForecast>();
let cachedPostures: TheaterPostureSummary[] = [];
type EscalationCallback = (forecasts: EscalationForecast[]) => void;
const subscribers = new Set<EscalationCallback>();

// ── Score computation helpers ─────────────────────────────────────────────

/**
 * Military concentration deviation score (0-100).
 * Compares current aircraft + vessel counts against theater baselines.
 */
function computeMilitaryScore(posture: TheaterPostureSummary | undefined, def: TheaterDef): { score: number; detail: string } {
  if (!posture) {
 return { score: 0, detail: 'No posture data available' };
  }

  const aircraftRatio = def.aircraftBaseline > 0
 ? posture.totalAircraft / def.aircraftBaseline
 : 0;
  const vesselRatio = def.vesselBaseline > 0
 ? posture.totalVessels / def.vesselBaseline
 : 0;

  // Weighted 60/40 air vs naval
  const combinedRatio = aircraftRatio * 0.6 + vesselRatio * 0.4;

  // Map ratio to 0-100 using logistic curve (1x = 30, 2x = 60, 3x = 85, 4x+ = 95+)
  const score = Math.min(100, Math.round(100 / (1 + Math.exp(-1.5 * (combinedRatio - 2)))));

  let postureLabel = 'Normal';
  if (posture.postureLevel === 'critical') postureLabel = 'CRITICAL';
  else if (posture.postureLevel === 'elevated') postureLabel = 'Elevated';

  const detail = `${posture.totalAircraft} aircraft (baseline ${def.aircraftBaseline}), `
 + `${posture.totalVessels} vessels (baseline ${def.vesselBaseline}), `
 + `posture: ${postureLabel}`;

  // Boost if posture is elevated/critical
  let postureBoost = 0;
  if (posture.postureLevel === 'critical') postureBoost = 20;
  else if (posture.postureLevel === 'elevated') postureBoost = 10;

  return { score: Math.min(100, score + postureBoost), detail };
}

/**
 * Event velocity score (0-100) from EMA forecast.
 * Aggregates matching regions and maps risk24h to our scale.
 */
function computeVelocityScore(emaResults: ForecastResult[], def: TheaterDef): { score: number; detail: string } {
  const matching = emaResults.filter(r =>
 def.emaRegions.some(er => r.region.toLowerCase().includes(er.toLowerCase()))
  );

  if (matching.length === 0) {
 return { score: 0, detail: 'No event velocity data' };
  }

  // Take the highest risk region
  const peak = matching.reduce((best, r) => r.risk24h > best.risk24h ? r : best, matching[0]!);
  const score = Math.min(100, peak.risk24h);

  let trendLabel = 'steady';
  if (peak.trending === 'up') trendLabel = 'accelerating';
  else if (peak.trending === 'down') trendLabel = 'decelerating';

  return {
 score,
 detail: `Peak event velocity: ${peak.region} (${peak.currentCount} events, ${trendLabel}, ${peak.deviation.toFixed(1)}σ)`,
  };
}

/**
 * Cross-domain signal score (0-100).
 * Counts recent alerts referencing this theater's region/name.
 */
function computeCrossDomainScore(alerts: UnifiedAlert[], def: TheaterDef): { score: number; detail: string } {
  const theatrKeywords = [def.name.toLowerCase(), def.region.toLowerCase(), def.id];

  const relevant = alerts.filter(a => {
 const text = `${a.title} ${a.summary}`.toLowerCase();
 return theatrKeywords.some(kw => text.includes(kw));
  });

  if (relevant.length === 0) {
 return { score: 0, detail: 'No cross-domain signals' };
  }

  // Score based on count and priority
  let rawScore = 0;
  for (const alert of relevant) {
 switch (alert.priority) {
 case 'critical': { rawScore += 30; break;
 }
 case 'high': { rawScore += 20; break;
 }
 case 'medium': { rawScore += 10; break;
 }
 case 'low': { rawScore += 5; break;
 }
 }
  }

  const score = Math.min(100, rawScore);
  const critCount = relevant.filter(a => a.priority === 'critical').length;
  const highCount = relevant.filter(a => a.priority === 'high').length;

  return {
 score,
 detail: `${relevant.length} signals (${critCount} critical, ${highCount} high)`,
  };
}

/**
 * Recent escalation rate (0-100).
 * Measures score momentum over the last 5 history points.
 */
function computeMomentumScore(theaterId: string): { score: number; detail: string } {
  const history = scoreHistory.get(theaterId) ?? [];
  if (history.length < 3) {
 return { score: 0, detail: 'Insufficient history for momentum' };
  }

  const recent = history.slice(-5);
  const first = recent[0]!.score;
  const last = recent[recent.length - 1]!.score;
  const delta = last - first;

  // Positive delta = rising tension. Map -50..+50 to 0..100
  const score = Math.min(100, Math.max(0, Math.round(50 + delta)));

  let direction = 'stable';
  if (delta > 5) direction = 'rising';
  else if (delta < -5) direction = 'falling';
  return {
 score,
 detail: `${direction} (${delta > 0 ? '+' : ''}${delta.toFixed(1)} over ${recent.length} samples)`,
  };
}

/**
 * Estimate days to potential conflict using exponential decay model.
 */
function estimateDaysToConflict(score: number): number | null {
  if (score < 40) return null; // stable — no meaningful estimate

  if (score >= 80) {
 // 1-7 days, inversely proportional to score above 80
 return Math.max(1, Math.round(7 - ((score - 80) / 20) * 6));
  }
  if (score >= 60) {
 // 7-30 days (weeks)
 return Math.round(30 - ((score - 60) / 20) * 23);
  }
  // 40-60: 30-90 days (months)
  return Math.round(90 - ((score - 40) / 20) * 60);
}

/**
 * Determine trend from recent history.
 */
function computeTrend(theaterId: string, currentScore: number): 'rising' | 'stable' | 'falling' {
  const history = scoreHistory.get(theaterId) ?? [];
  if (history.length < 3) return 'stable';

  const recent = history.slice(-5);
  const avgRecent = recent.reduce((s, p) => s + p.score, 0) / recent.length;

  if (currentScore > avgRecent + 3) return 'rising';
  if (currentScore < avgRecent - 3) return 'falling';
  return 'stable';
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Inject fresh theater posture data. Call from data-loader after each
 * military data refresh.
 */
export function setPostureData(postures: TheaterPostureSummary[]): void {
  cachedPostures = postures;
}

/**
 * Recalculate escalation forecasts for all 9 theaters.
 * Should be called periodically from data-loader.
 */
export function updateEscalationForecasts(): void {
  const emaResults = forecastRegions();
  const alerts = getRecentAlerts(24);
  const now = Date.now();
  const results: EscalationForecast[] = [];

  for (const def of THEATER_DEFS) {
 const posture = cachedPostures.find(p => p.theaterId === def.postureTheaterId);

 const military = computeMilitaryScore(posture, def);
 const velocity = computeVelocityScore(emaResults, def);
 const crossDomain = computeCrossDomainScore(alerts, def);
 const momentum = computeMomentumScore(def.id);

 const factors: EscalationFactor[] = [
 { name: 'Military Concentration', weight: 0.4, rawValue: military.score, contribution: military.score * 0.4, detail: military.detail },
 { name: 'Event Velocity', weight: 0.25, rawValue: velocity.score, contribution: velocity.score * 0.25, detail: velocity.detail },
 { name: 'Cross-Domain Signals', weight: 0.2, rawValue: crossDomain.score, contribution: crossDomain.score * 0.2, detail: crossDomain.detail },
 { name: 'Escalation Momentum', weight: 0.15, rawValue: momentum.score, contribution: momentum.score * 0.15, detail: momentum.detail },
 ];

 const rawScore = factors.reduce((s, f) => s + f.contribution, 0);
 // Blend with baseline tension (10% baseline, 90% computed)
 const score = Math.min(100, Math.max(0, Math.round(rawScore * 0.9 + def.baselineTension * 0.1)));

 const trend = computeTrend(def.id, score);
 const estimatedDays = estimateDaysToConflict(score);

 // Update history
 const hist = scoreHistory.get(def.id) ?? [];
 hist.push({ timestamp: now, score });
 if (hist.length > MAX_HISTORY) hist.shift();
 scoreHistory.set(def.id, hist);

 const forecast: EscalationForecast = {
 theaterId: def.id,
 name: def.name,
 region: def.region,
 score,
 trend,
 estimatedDays,
 factors,
 lastUpdated: now,
 };

 latestForecasts.set(def.id, forecast);
 results.push(forecast);
  }

  // Notify subscribers
  for (const cb of subscribers) {
 try {
 cb(results);
 } catch {
 // subscriber callback failed — silently ignore
 }
  }
}

/**
 * Get current escalation forecasts for all theaters, sorted by score descending.
 */
export function getEscalationForecasts(): EscalationForecast[] {
  return [...latestForecasts.values()].sort((a, b) => b.score - a.score);
}

/**
 * Get historical score points for a specific theater (up to 30 points).
 */
export function getTheaterHistory(theaterId: string): ScorePoint[] {
  return scoreHistory.get(theaterId) ?? [];
}

/**
 * Subscribe to escalation forecast updates.
 * Returns an unsubscribe function.
 */
export function subscribeEscalation(cb: EscalationCallback): () => void {
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}

/**
 * Compute the Global Tension Index — weighted average of all theater scores.
 * Theaters with higher scores are weighted more heavily (quadratic weighting).
 */
export function getGlobalTensionIndex(): number {
  const forecasts = getEscalationForecasts();
  if (forecasts.length === 0) return 0;

  let weightedSum = 0;
  let totalWeight = 0;
  for (const f of forecasts) {
 // Quadratic weight: high-tension theaters pull the index up more
 const w = 1 + (f.score / 100) ** 2;
 weightedSum += f.score * w;
 totalWeight += w;
  }

  return Math.round(weightedSum / totalWeight);
}
