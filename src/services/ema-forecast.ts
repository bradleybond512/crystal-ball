/**
 * EMA-based threat forecasting — pure TypeScript, fully offline
 *
 * Tracks event counts per region over a rolling 24-session window.
 * Computes exponential moving average (EMA) to detect velocity spikes and
 * forecast escalation risk. No external dependencies, no network calls.
 *
 * Integration: called from data-loader after each conflict data refresh.
 * High-risk regions produce 'velocity_spike' correlation signals that feed
 * into evaluateWarThreat().
 */

export interface ForecastResult {
  region: string;
  currentCount: number;
  ema: number;
  deviation: number; // standard deviations above/below EMA
  risk24h: number; // 0–100 risk score for next 24 hours
  trending: 'up' | 'stable' | 'down';
}

// ── State ──────────────────────────────────────────────────────────────────

/** Rolling window of event counts per region (last N sessions = ~24h if hourly) */
const regionSeries = new Map<string, number[]>();

/** Maximum number of data points per region */
const MAX_WINDOW = 24;

/** EMA alpha — higher = more weight to recent data */
const DEFAULT_ALPHA = 0.3;

/** Risk threshold above which a region is flagged as high-risk */
const HIGH_RISK_THRESHOLD = 75;

// ── Core EMA math ──────────────────────────────────────────────────────────

/**
 * Compute exponential moving average for a data series.
 * First EMA value = first data point (no smoothing possible).
 */
export function computeEMA(series: number[], alpha: number = DEFAULT_ALPHA): number[] {
  if (series.length === 0) return [];
  const ema = [series[0]!];
  for (let i = 1; i < series.length; i++) {
 ema.push(alpha * series[i]! + (1 - alpha) * ema[i - 1]!);
  }
  return ema;
}

/** Standard deviation of an array */
function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

// ── Region time-series management ──────────────────────────────────────────

/**
 * Record the latest event count for a region.
 * Call once per data refresh cycle (e.g., after each ACLED or GDELT load).
 */
export function updateRegionCount(region: string, count: number): void {
  if (!region || count < 0) return;
  const series = regionSeries.get(region) ?? [];
  series.push(count);
  if (series.length > MAX_WINDOW) series.shift();
  regionSeries.set(region, series);
}

/**
 * Reset all regional data (e.g., on session start or manual clear).
 */
export function resetForecast(): void {
  regionSeries.clear();
}

// ── Forecast computation ──────────────────────────────────────────────────

/**
 * Compute forecast results for all tracked regions.
 * Returns results sorted by risk24h descending.
 */
export function forecastRegions(): ForecastResult[] {
  const results: ForecastResult[] = [];

  for (const [region, series] of regionSeries.entries()) {
 if (series.length < 3) continue; // need at least 3 points for meaningful EMA

 const emaValues = computeEMA(series);
 const currentEMA = emaValues[emaValues.length - 1]!;
 const currentCount = series[series.length - 1]!;
 const sd = stdDev(series);

 // Deviation from EMA in standard deviations
 const deviation = sd > 0 ? (currentCount - currentEMA) / sd : 0;

 // Risk score: logistic-style transform on deviation
 // 0 SD = 50% risk base, +2 SD = ~90%, +3 SD = ~97%
 const risk24h = Math.min(100, Math.max(0, Math.round(50 + deviation * 20)));

 // Trend: compare last 3 EMA values
 let trending: ForecastResult['trending'] = 'stable';
 if (emaValues.length >= 3) {
 const prev2 = emaValues[emaValues.length - 3]!;
 const prev1 = emaValues[emaValues.length - 2]!;
 if (currentEMA > prev1 && prev1 > prev2) trending = 'up';
 else if (currentEMA < prev1 && prev1 < prev2) trending = 'down';
 }

 results.push({ region, currentCount, ema: currentEMA, deviation, risk24h, trending });
  }

  return results.sort((a, b) => b.risk24h - a.risk24h);
}

/**
 * Return only high-risk regions (risk24h >= HIGH_RISK_THRESHOLD).
 */
export function getHighRiskRegions(): ForecastResult[] {
  return forecastRegions().filter(r => r.risk24h >= HIGH_RISK_THRESHOLD);
}
