/**
 * EMA-based threat forecasting — pure TypeScript, fully offline
 *
 * Tracks event counts per region over a rolling 24-session window.
 * Computes exponential moving average (EMA) to detect velocity spikes and
 * forecast escalation risk. No external dependencies, no network calls.
 *
 * Integration: called from data-loader after each conflict data refresh.
 * High-risk regions produce 'velocity_spike' correlation signals that feed
 * the signal history, situation engine, and alert center.
 */

export interface ForecastResult {
  region: string;
  currentCount: number;
  ema: number;
  deviation: number; // standard deviations above/below EMA
  risk24h: number; // 0\u2013100 risk score for next 24 hours
  trending: 'up' | 'stable' | 'down';
  seasonalAnomaly: boolean;
}

export interface SeasonalBaseline {
  hourOfWeek: number; // 0\u2013167 (day * 24 + hour)
  mean: number;
  count: number;
}

// \u2500\u2500 State \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

/** Rolling window of event counts per region (last N sessions = ~24h if hourly) */
const regionSeries = new Map<string, number[]>();

/** Maximum number of data points per region */
const MAX_WINDOW = 24;

/** EMA alpha \u2014 higher = more weight to recent data */
const DEFAULT_ALPHA = 0.3;

/** Adaptive alpha range: volatile regions get higher alpha, stable regions lower */
const ALPHA_MIN = 0.15;
const ALPHA_MAX = 0.5;

/** Coefficient of variation thresholds for alpha mapping */
const CV_LOW = 0.2; // below this \u2192 ALPHA_MIN (stable)
const CV_HIGH = 1; // above this \u2192 ALPHA_MAX (volatile)

/** Risk threshold above which a region is flagged as high-risk */
const HIGH_RISK_THRESHOLD = 75;

/** Seasonal deviation threshold: 50% above seasonal norm \u2192 anomaly */
const SEASONAL_DEVIATION_THRESHOLD = 0.5;

/** Minimum observations for a seasonal slot to be considered sufficient */
const SEASONAL_MIN_COUNT = 4;

const SEASONAL_STORAGE_KEY = 'crystalball-ema-seasonal-v1';

const HOURS_PER_WEEK = 168; // 7 \u00d7 24

// \u2500\u2500 Core EMA math \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

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
 * High volatility \u2192 higher alpha (more responsive to recent data).
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
  // Simple linear regression: slope = \u03a3((i - i\u0305)(y - \u0233)) / \u03a3((i - i\u0305)\u00b2)
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

// \u2500\u2500 Seasonal baselines (hour-of-week) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

function hourOfWeek(ts: number): number {
  const d = new Date(ts);
  return d.getDay() * 24 + d.getHours();
}

function loadSeasonalBaselines(): Map<string, SeasonalBaseline[]> {
  try {
    const raw = localStorage.getItem(SEASONAL_STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as [string, SeasonalBaseline[]][];
    return new Map(parsed);
  } catch {
    return new Map();
  }
}

function saveSeasonalBaselines(baselines: Map<string, SeasonalBaseline[]>): void {
  try {
    localStorage.setItem(SEASONAL_STORAGE_KEY, JSON.stringify([...baselines.entries()]));
  } catch { /* storage full or unavailable \u2014 non-critical */ }
}

function ensureSlots(baselines: Map<string, SeasonalBaseline[]>, regionId: string): SeasonalBaseline[] {
  let slots = baselines.get(regionId);
  if (!slots) {
    slots = Array.from({ length: HOURS_PER_WEEK }, (_, i) => ({ hourOfWeek: i, mean: 0, count: 0 }));
    baselines.set(regionId, slots);
  }
  return slots;
}

export function recordSeasonalObservation(regionId: string, value: number, timestamp?: number): void {
  const baselines = loadSeasonalBaselines();
  const slots = ensureSlots(baselines, regionId);
  const slot = slots[hourOfWeek(timestamp ?? Date.now())]!;
  // Incremental mean update: mean' = mean + (value - mean) / (count + 1)
  slot.count += 1;
  slot.mean += (value - slot.mean) / slot.count;
  saveSeasonalBaselines(baselines);
}

export function getSeasonalExpected(regionId: string, timestamp?: number): { mean: number; sufficient: boolean } {
  const baselines = loadSeasonalBaselines();
  const slots = baselines.get(regionId);
  if (!slots) return { mean: 0, sufficient: false };
  const slot = slots[hourOfWeek(timestamp ?? Date.now())]!;
  return { mean: slot.mean, sufficient: slot.count >= SEASONAL_MIN_COUNT };
}

// \u2500\u2500 Region time-series management \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

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

// \u2500\u2500 Forecast computation \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

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

    // Seasonal baseline: record observation and check for anomaly
    recordSeasonalObservation(region, currentCount);
    const seasonal = getSeasonalExpected(region);
    const seasonalAnomaly = seasonal.sufficient && seasonal.mean > 0
      ? (currentEMA - seasonal.mean) / seasonal.mean > SEASONAL_DEVIATION_THRESHOLD
      : false;

    results.push({ region, currentCount, ema: currentEMA, deviation, risk24h, trending, seasonalAnomaly });
  }

  return results.sort((a, b) => b.risk24h - a.risk24h);
}

/**
 * Return only high-risk regions (risk24h >= HIGH_RISK_THRESHOLD).
 */
export function getHighRiskRegions(): ForecastResult[] {
  return forecastRegions().filter(r => r.risk24h >= HIGH_RISK_THRESHOLD);
}

/**
 * Strict-monotonic trend over the last three EMA samples.
 * Returns 'up' only when v[-3] < v[-2] < v[-1], 'down' only when reversed, 'stable' otherwise.
 * Use this when you want a tighter "three consecutive moves in the same direction" signal
 * than {@link forecastRegions}' slope-regression trend.
 */
export function strictMonotonicTrend(emaValues: number[]): ForecastResult['trending'] {
  if (emaValues.length < 3) return 'stable';
  const a = emaValues[emaValues.length - 3]!;
  const b = emaValues[emaValues.length - 2]!;
  const c = emaValues[emaValues.length - 1]!;
  if (c > b && b > a) return 'up';
  if (c < b && b < a) return 'down';
  return 'stable';
}
