/**
 * Cross-Domain Leading Indicator Engine — per Batch 1 of the
 * synthesis plan.
 *
 * Detects time-lagged correlations between signals from different
 * domains. The classic example: a sustained Baltic Dry Index drop
 * tends to precede food-inflation upticks by ~8 weeks.
 *
 * Pure deterministic. No DOM, no fetch, no globals. The sidecar
 * pulls real time series and feeds them in here; this module is the
 * statistical core.
 *
 * Plan invariants:
 *   - Granger causality F-test at lags 1..maxLag with linear regression.
 *   - Significant pairs surface with their lag and strength so the user
 *     sees WHICH signal predicts WHICH and BY HOW LONG.
 *   - Zero hidden state — every function is testable on a fixed series.
 *   - Outputs are JSON-serializable.
 */

// ── Public types ───────────────────────────────────────────────────────

export type SignalKey =
  | 'bdi'
  | 'commodity_wheat'
  | 'commodity_oil'
  | 'commodity_gold'
  | 'acled_event_rate'
  | 'promed_alert_rate'
  | 'usgs_quake_rate'
  | 'cisa_kev_weekly';

export interface TimeSeries {
  key: SignalKey;
  /** Daily samples in chronological order. NaN means missing. */
  values: readonly number[];
  /** ISO date of values[0]. */
  startDate: string;
}

export interface GrangerResult {
  cause: SignalKey;
  effect: SignalKey;
  lagDays: number;
  /** F-statistic (≥ 0). */
  fStatistic: number;
  /** Approximate p-value via the F-distribution survival function. */
  pValue: number;
  /** Strength = (RSS_restricted − RSS_full) / RSS_restricted in [0, 1]. */
  strength: number;
  /** Number of effective observations after lag-trimming + NaN drops. */
  observations: number;
}

export interface LeadingIndicatorAlert {
  causeSignal: SignalKey;
  effectSignal: SignalKey;
  lagDays: number;
  strength: number;
  /** Human-readable narrative. Pure function of inputs. */
  message: string;
}

export interface AnalyzeOptions {
  /** Lags to scan (inclusive). Defaults to 1..90. */
  minLag?: number;
  maxLag?: number;
  /** Significance floor on the p-value. Default 0.05. */
  pValueThreshold?: number;
  /** Min effective observations required to even attempt the F-test.
   *  Default 60 (about 2 months of daily data). */
  minObservations?: number;
}

// ── Linear algebra primitives ──────────────────────────────────────────

/** Compute the mean of a finite-only array. Returns NaN when empty. */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (Number.isFinite(v)) {
      sum += v;
      n += 1;
    }
  }
  return n === 0 ? Number.NaN : sum / n;
}

/** Sum of squared residuals between observed `y` and predicted `yhat`. */
export function rss(y: readonly number[], yhat: readonly number[]): number {
  if (y.length !== yhat.length) throw new Error('rss: length mismatch');
  let s = 0;
  for (const [i, yi] of y.entries()) {
    const e = yi - yhat[i]!;
    s += e * e;
  }
  return s;
}

/** Build the augmented [X^T X | X^T y] matrix for the normal equations. */
function buildNormalEquations(
  X: readonly (readonly number[])[],
  y: readonly number[],
  k: number,
  n: number,
): number[][] {
  const xtx: number[][] = Array.from({ length: k }, () => Array.from({ length: k }, () => 0));
  const xty: number[] = Array.from({ length: k }, () => 0);
  for (let i = 0; i < n; i += 1) {
    const row = X[i]!;
    for (let a = 0; a < k; a += 1) {
      xty[a]! += row[a]! * y[i]!;
      for (let b = 0; b < k; b += 1) xtx[a]![b]! += row[a]! * row[b]!;
    }
  }
  return xtx.map((r, i) => [...r, xty[i]!]);
}

/** In-place: find the row with the largest |aug[r][i]| and swap it to row i.
 *  Returns the magnitude of the chosen pivot. */
function pivotInPlace(aug: number[][], i: number, k: number): number {
  let pivot = i;
  let pivotMag = Math.abs(aug[i]![i]!);
  for (let r = i + 1; r < k; r += 1) {
    const m = Math.abs(aug[r]![i]!);
    if (m > pivotMag) { pivot = r; pivotMag = m; }
  }
  if (pivot !== i) {
    const tmp = aug[i]!;
    aug[i] = aug[pivot]!;
    aug[pivot] = tmp;
  }
  return pivotMag;
}

/** In-place row reduction on column i of an augmented matrix. */
function eliminateColumn(aug: number[][], i: number, k: number): void {
  const pivVal = aug[i]![i]!;
  for (let c = i; c <= k; c += 1) aug[i]![c]! /= pivVal;
  for (let r = 0; r < k; r += 1) {
    if (r === i) continue;
    const factor = aug[r]![i]!;
    if (factor === 0) continue;
    for (let c = i; c <= k; c += 1) aug[r]![c]! -= factor * aug[i]![c]!;
  }
}

/**
 * Multivariate OLS via the normal equations: (X^T X) β = X^T y.
 * Implemented with Gauss-Jordan inversion on the (k+1)×(k+1) matrix.
 * Returns the coefficient vector β (length k); the first element is
 * the intercept when X already includes a leading 1s column.
 */
export function ols(X: readonly (readonly number[])[], y: readonly number[]): number[] {
  const n = X.length;
  if (n !== y.length) throw new Error('ols: row count mismatch');
  if (n === 0) return [];
  const k = X[0]!.length;
  const aug = buildNormalEquations(X, y, k, n);
  for (let i = 0; i < k; i += 1) {
    const pivotMag = pivotInPlace(aug, i, k);
    if (pivotMag < 1e-12) {
      // Singular or near-singular — caller treats as "no fit possible".
      return Array.from({ length: k }, () => 0);
    }
    eliminateColumn(aug, i, k);
  }
  return aug.map((r) => r[k]!);
}

// ── Granger F-test ─────────────────────────────────────────────────────

/** Build the design matrix for the restricted (autoregressive-only) and
 *  unrestricted (autoregressive + lagged-cause) models. Both use a
 *  leading 1s column for the intercept.
 *
 *  Returns null when the series can't support the requested lag (too
 *  few effective observations after trimming + NaN drops). */
export function buildGrangerDesign(
  cause: readonly number[],
  effect: readonly number[],
  lag: number,
): { y: number[]; restricted: number[][]; unrestricted: number[][] } | null {
  if (cause.length !== effect.length) {
    throw new Error('buildGrangerDesign: cause/effect length mismatch');
  }
  if (lag < 1) throw new Error('buildGrangerDesign: lag must be >= 1');

  const y: number[] = [];
  const restricted: number[][] = [];
  const unrestricted: number[][] = [];

  for (let t = lag; t < effect.length; t += 1) {
    const yt = effect[t]!;
    if (!Number.isFinite(yt)) continue;
    const yLagged: number[] = [];
    const xLagged: number[] = [];
    let allFinite = true;
    for (let p = 1; p <= lag; p += 1) {
      const yp = effect[t - p]!;
      const xp = cause[t - p]!;
      if (!Number.isFinite(yp) || !Number.isFinite(xp)) { allFinite = false; break; }
      yLagged.push(yp);
      xLagged.push(xp);
    }
    if (!allFinite) continue;
    y.push(yt);
    restricted.push([1, ...yLagged]);
    unrestricted.push([1, ...yLagged, ...xLagged]);
  }
  if (y.length === 0) return null;
  return { y, restricted, unrestricted };
}

/** Predict ŷ given a design matrix and a coefficient vector. */
function predict(X: readonly (readonly number[])[], beta: readonly number[]): number[] {
  const out: number[] = [];
  for (const row of X) {
    let v = 0;
    for (let i = 0; i < row.length; i += 1) v += row[i]! * beta[i]!;
    out.push(v);
  }
  return out;
}

/** Run the Granger F-test for `cause → effect` at the given lag. */
export function grangerTest(
  cause: readonly number[],
  effect: readonly number[],
  lag: number,
  options: { minObservations?: number } = {},
): GrangerResult | null {
  const minObs = options.minObservations ?? 60;
  const design = buildGrangerDesign(cause, effect, lag);
  if (!design) return null;
  const n = design.y.length;
  if (n < minObs) return null;

  const betaR = ols(design.restricted, design.y);
  const betaU = ols(design.unrestricted, design.y);
  const yhatR = predict(design.restricted, betaR);
  const yhatU = predict(design.unrestricted, betaU);
  const rssR = rss(design.y, yhatR);
  const rssU = rss(design.y, yhatU);

  // F = ((rssR - rssU) / lag) / (rssU / (n - 2*lag - 1))
  const dfNum = lag;
  const dfDen = n - (2 * lag) - 1;
  if (dfDen <= 0) return null;
  if (rssU < 1e-12) return null;
  const fStatistic = ((rssR - rssU) / dfNum) / (rssU / dfDen);
  const strength = rssR > 0 ? Math.max(0, (rssR - rssU) / rssR) : 0;
  const pValue = fSurvival(fStatistic, dfNum, dfDen);
  return {
    cause: 'bdi',         // overwritten by analyzePairs caller
    effect: 'bdi',
    lagDays: lag,
    fStatistic,
    pValue,
    strength,
    observations: n,
  };
}

// ── F-distribution survival (1 - CDF) ──────────────────────────────────

/**
 * Approximate p-value via the regularised incomplete beta function. For
 * the F(d1, d2) distribution, P(F > x) = I_z(d2/2, d1/2) where
 * z = d2 / (d2 + d1*x).
 *
 * Continued-fraction implementation; not as precise as a stats library
 * but plenty accurate for ranking pairs at p < 0.05 / p < 0.01.
 */
export function fSurvival(f: number, d1: number, d2: number): number {
  if (!Number.isFinite(f) || f <= 0) return 1;
  const z = d2 / (d2 + d1 * f);
  return regularizedIncompleteBeta(z, d2 / 2, d1 / 2);
}

function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta) / a;
  const cf = continuedFractionBeta(x, a, b);
  const value = front * cf;
  // Symmetry: I_x(a,b) = 1 - I_{1-x}(b,a). Use the smaller-x branch for
  // numerical stability when x > (a+1)/(a+b+2).
  if (x > (a + 1) / (a + b + 2)) {
    // Symmetry identity I_x(a,b) = 1 - I_{1-x}(b,a). The argument
    // reorder is intentional and required.
    // eslint-disable-next-line sonarjs/arguments-order -- intentional: I_x(a,b) symmetry identity
    return 1 - regularizedIncompleteBeta(1 - x, b, a);
  }
  return value;
}

/** One Lentz-style iteration step of the continued-fraction expansion
 *  for the regularised incomplete beta. Pure: takes the rolling state
 *  and the iteration index, returns the next state. */
function cfBetaStep(
  state: { am: number; bm: number; az: number; bz: number },
  m: number,
  x: number,
  a: number,
  b: number,
): { am: number; bm: number; az: number; bz: number; aold: number } {
  const qab = a + b, qap = a + 1, qam = a - 1;
  const tem = m + m;
  const d1 = (m * (b - m) * x) / ((qam + tem) * (a + tem));
  const ap = state.az + d1 * state.am;
  const bp = state.bz + d1 * state.bm;
  const d2 = -((a + m) * (qab + m) * x) / ((a + tem) * (qap + tem));
  const app = ap + d2 * state.az;
  const bpp = bp + d2 * state.bz;
  return { am: ap / bpp, bm: bp / bpp, az: app / bpp, bz: 1, aold: state.az };
}

function continuedFractionBeta(x: number, a: number, b: number): number {
  const maxIter = 200;
  const eps = 1e-12;
  const qab = a + b, qap = a + 1;
  let bz0 = 1 - (qab * x) / qap;
  if (Math.abs(bz0) < 1e-30) bz0 = 1e-30;
  let state = { am: 1, bm: 1, az: 1, bz: bz0 };
  for (let m = 1; m <= maxIter; m += 1) {
    const next = cfBetaStep(state, m, x, a, b);
    state = { am: next.am, bm: next.bm, az: next.az, bz: next.bz };
    if (Math.abs(state.az - next.aold) < eps * Math.abs(state.az)) return state.az;
  }
  return state.az;
}

/** Lanczos approximation for ln(Γ(z)). Accurate to ~14 digits for z>0. */
function lnGamma(z: number): number {
  const g = 7;
  const c = [
    0.999_999_999_999_809_93,
    676.520_368_121_885_1,
    -1259.139_216_722_402_8,
    771.323_428_777_653_13,
    -176.615_029_162_140_59,
    12.507_343_278_686_905,
    -0.138_571_095_265_720_12,
    9.984_369_578_019_571_6e-6,
    1.505_632_735_149_311_6e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  const zm1 = z - 1;
  let x = c[0]!;
  for (let i = 1; i < g + 2; i += 1) x += c[i]! / (zm1 + i);
  const t = zm1 + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (zm1 + 0.5) * Math.log(t) - t + Math.log(x);
}

// ── Top-level analysis ─────────────────────────────────────────────────

/** Find the best (lowest p) significant lag for one cause→effect pair. */
function bestSignificantLag(
  a: TimeSeries,
  b: TimeSeries,
  minLag: number,
  maxLag: number,
  pThreshold: number,
  minObs: number,
): GrangerResult | null {
  let best: GrangerResult | null = null;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    const result = grangerTest(a.values, b.values, lag, { minObservations: minObs });
    if (!result || result.pValue >= pThreshold) continue;
    if (!best || result.pValue < best.pValue) {
      best = { ...result, cause: a.key, effect: b.key };
    }
  }
  return best;
}

/** Run the F-test across every cause→effect pair (cause ≠ effect) at
 *  every lag in [minLag..maxLag]. Returns the best (lowest p-value)
 *  significant lag per pair. */
export function analyzeAllPairs(
  series: readonly TimeSeries[],
  options: AnalyzeOptions = {},
): GrangerResult[] {
  const minLag = options.minLag ?? 1;
  const maxLag = options.maxLag ?? 90;
  const pThreshold = options.pValueThreshold ?? 0.05;
  const minObs = options.minObservations ?? 60;

  const out: GrangerResult[] = [];
  for (const a of series) {
    for (const b of series) {
      if (a.key === b.key) continue;
      const best = bestSignificantLag(a, b, minLag, maxLag, pThreshold, minObs);
      if (best) out.push(best);
    }
  }
  out.sort((p, q) => p.pValue - q.pValue);
  return out;
}

/** Translate a GrangerResult into a user-facing alert. Pure. */
export function buildAlert(result: GrangerResult): LeadingIndicatorAlert {
  const strengthPct = (result.strength * 100).toFixed(1);
  const message =
    `Based on historical patterns, ${humanLabel(result.effect)} likely to shift in `
    + `${result.lagDays} days following ${humanLabel(result.cause)} `
    + `(strength ${strengthPct}%, p=${result.pValue.toExponential(2)}).`;
  return {
    causeSignal: result.cause,
    effectSignal: result.effect,
    lagDays: result.lagDays,
    strength: result.strength,
    message,
  };
}

const HUMAN_LABELS: Record<SignalKey, string> = {
  bdi: 'Baltic Dry Index',
  commodity_wheat: 'wheat prices',
  commodity_oil: 'oil prices',
  commodity_gold: 'gold prices',
  acled_event_rate: 'conflict event rate',
  promed_alert_rate: 'ProMED disease alert rate',
  usgs_quake_rate: 'M5+ seismic rate',
  cisa_kev_weekly: 'CISA KEV additions',
};

function humanLabel(key: SignalKey): string {
  return HUMAN_LABELS[key] ?? String(key);
}
