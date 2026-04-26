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

/** Adaptive alpha range: volatile regions get higher alpha, stable regions lower */
const ALPHA_MIN = 0.15;
const ALPHA_MAX = 0.5;

/** Coefficient of variation thresholds for alpha mapping */
const CV_LOW = 0.2; // below this → ALPHA_MIN (stable)
const CV_HIGH = 1; // above this → ALPHA_MAX (volatile)

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

/**
 * Compute adaptive alpha based on coefficient of variation.
 * High volatility → higher alpha (more responsive to recent data).
 */
function adaptiveAlpha(series: number[]): number {
  if (series.length < 3) return DEFAULT_ALPHA;
  const m = series.reduce((s, v) => s + v, 0) / series.length;
  if (m <= 0) return DEFAULT_ALPHA;
  const sd = stdDev(series);
  const cv = sd / m; // coefficient of variation
  // Linear interpolation between ALPHA_MIN and ALPHA_MAX
  const t = Math.min(1, Math.max(0, (cv - CV_LOW) / (CV_HIGH - CV_LOW)));
  return ALPHA_MIN + t * (ALPHA_MAX - ALPHA_MIN);
}

/**
 * Detect trend via linear regression slope over the last N EMA values.
 * Returns 'up' if slope is positive and meaningful, 'down' if negative, else 'stable'.
 */
function slopeTrend(emaValues: number[], sd: number): ForecastResult['trending'] {
  const n = Math.min(emaValues.length, 5);
  if (n < 3) return 'stable';
  const tail = emaValues.slice(-n);
  // Simple linear regression: slope = Σ((i - i̅)(y - ȳ)) / Σ((i - i̅)²)
  const iMean = (n - 1) / 2;
  const yMean = tail.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - iMean) * (tail[i]! - yMean);
    den += (i - iMean) ** 2;
  }
  if (den === 0) return 'stable';
  const slope = num / den;
  // Normalize slope by sd to determine significance
  const threshold = sd > 0 ? sd * 0.1 : 0.5;
  if (slope > threshold) return 'up';
  if (slope < -threshold) return 'down';
  return 'stable';
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

 const alpha = adaptiveAlpha(series);
 const emaValues = computeEMA(series, alpha);
 const currentEMA = emaValues[emaValues.length - 1]!;
 const currentCount = series[series.length - 1]!;
 const sd = stdDev(series);

 // Deviation from EMA in standard deviations
 const deviation = sd > 0 ? (currentCount - currentEMA) / sd : 0;

 // Risk score: logistic-style transform on deviation
 // 0 SD = 50% risk base, +2 SD = ~90%, +3 SD = ~97%
 const risk24h = Math.min(100, Math.max(0, Math.round(50 + deviation * 20)));

 // Trend: slope-based regression over last 5 EMA values
 const trending = slopeTrend(emaValues, sd);

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
