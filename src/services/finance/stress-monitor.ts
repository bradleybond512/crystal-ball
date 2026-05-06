/**
 * Financial Stress + Commodity Stress monitor — per Batch 3 of the
 * economic-intel plan.
 *
 * Pure deterministic engine. Accepts pre-fetched series from OFR FSI
 * and World Bank commodity prices, normalises into typed alerts +
 * stress scores. Sidecar fetcher is a follow-up.
 *
 * Plan invariants:
 *   - Pure functions are unit-testable on static fixtures.
 *   - Alert thresholds are constants (FSI > 1.5 elevated, > 3.0 severe)
 *     so the user sees consistent labels across builds.
 *   - Commodity stress uses 12-month + 24-month standard-deviation
 *     bands — surfaces deviation, not absolute price, so it works
 *     across goods with very different scales.
 */

// ── Public types ───────────────────────────────────────────────────────

export type FsiTier = 'low' | 'normal' | 'elevated' | 'severe';

export interface FsiObservation {
  /** ISO 8601 (date or datetime). */
  date: string;
  index: number;
  /** Optional component breakdown the OFR API returns. */
  components?: Readonly<Record<string, number>>;
}

export interface FsiAlert {
  date: string;
  index: number;
  tier: FsiTier;
  message: string;
}

export type CommodityKey =
  | 'wheat' | 'rice' | 'oil' | 'natural_gas' | 'fertilizer'
  | 'corn' | 'soybeans' | 'gold';

export interface CommodityObservation {
  /** ISO 8601 (typically a month boundary). */
  date: string;
  price: number;
}

export interface CommoditySeries {
  commodity: CommodityKey;
  /** Monthly observations in chronological order. */
  observations: readonly CommodityObservation[];
  /** Display unit ("USD/MT", "USD/bbl", …). */
  unit: string;
}

export type CommodityRiskTier = 'low' | 'medium' | 'high' | 'critical';

export interface CommodityAlert {
  commodity: CommodityKey;
  unit: string;
  /** Most recent observed price. */
  currentPrice: number;
  /** σ-deviation against the trailing 12-month series. */
  deviation12mSigma: number;
  /** σ-deviation against the trailing 24-month series. */
  deviation24mSigma: number;
  /** "rising" / "falling" / "stable" — derived from 3-month slope sign. */
  trend: 'rising' | 'falling' | 'stable';
  overallRisk: CommodityRiskTier;
  message: string;
}

// ── FSI tiering ────────────────────────────────────────────────────────

export const FSI_THRESHOLDS = {
  elevated: 1.5,
  severe: 3,
} as const;

export function tierForFsi(index: number): FsiTier {
  if (!Number.isFinite(index)) return 'normal';
  if (index >= FSI_THRESHOLDS.severe) return 'severe';
  if (index >= FSI_THRESHOLDS.elevated) return 'elevated';
  if (index <= -FSI_THRESHOLDS.elevated) return 'low';
  return 'normal';
}

export function buildFsiAlert(obs: FsiObservation): FsiAlert {
  const tier = tierForFsi(obs.index);
  return {
    date: obs.date,
    index: obs.index,
    tier,
    message: messageForFsi(obs, tier),
  };
}

function messageForFsi(obs: FsiObservation, tier: FsiTier): string {
  const indexStr = obs.index.toFixed(2);
  switch (tier) {
    case 'severe': {
      return `OFR FSI ${indexStr} — severe systemic stress; equity / credit / FX dislocation likely.`;
    }
    case 'elevated': {
      return `OFR FSI ${indexStr} — elevated stress; watch credit spreads + funding markets.`;
    }
    case 'low': {
      return `OFR FSI ${indexStr} — markets unusually calm; tail-risk premia compressed.`;
    }
    default: {
      return `OFR FSI ${indexStr} — normal range.`;
    }
  }
}

// ── Series statistics ──────────────────────────────────────────────────

/** Compute mean of finite numeric values. NaN when empty. */
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

/** Sample standard deviation (N-1 denominator). NaN when n < 2. */
export function stdev(values: readonly number[]): number {
  if (values.length < 2) return Number.NaN;
  const mu = mean(values);
  if (!Number.isFinite(mu)) return Number.NaN;
  let s = 0;
  let n = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    const d = v - mu;
    s += d * d;
    n += 1;
  }
  return n < 2 ? Number.NaN : Math.sqrt(s / (n - 1));
}

/** σ-deviation of `current` from a window of past observations. Returns
 *  0 when stdev is degenerate. */
export function sigmaDeviation(current: number, window: readonly number[]): number {
  const sd = stdev(window);
  if (!Number.isFinite(sd) || sd === 0) return 0;
  return (current - mean(window)) / sd;
}

// ── Commodity stress ──────────────────────────────────────────────────

/** Compute the trend sign over the last `n` observations: +1 rising,
 *  -1 falling, 0 stable. Uses linear regression slope sign with a
 *  ±1 % cutoff on relative slope to mark "stable". */
export function trendSign(
  observations: readonly CommodityObservation[],
  n = 3,
): 'rising' | 'falling' | 'stable' {
  if (observations.length < 2) return 'stable';
  const slice = observations.slice(-n);
  if (slice.length < 2) return 'stable';
  // Slope via least-squares on (i, price).
  let xMean = 0; for (let i = 0; i < slice.length; i += 1) xMean += i;
  xMean /= slice.length;
  const yMean = mean(slice.map((o) => o.price));
  let num = 0;
  let den = 0;
  for (const [i, element] of slice.entries()) {
    const dx = i - xMean;
    num += dx * (element!.price - yMean);
    den += dx * dx;
  }
  if (den === 0) return 'stable';
  const slope = num / den;
  const rel = Math.abs(slope) / Math.max(1, Math.abs(yMean));
  if (rel < 0.01) return 'stable';
  return slope > 0 ? 'rising' : 'falling';
}

/** Map combined 12m/24m σ-deviations to a tier. Always rounds away
 *  from "low" when in doubt — better to over-warn than miss. */
export function riskTierForDeviation(d12: number, d24: number): CommodityRiskTier {
  const mag = Math.max(Math.abs(d12), Math.abs(d24));
  if (mag >= 3) return 'critical';
  if (mag >= 2) return 'high';
  if (mag >= 1) return 'medium';
  return 'low';
}

/** Build a commodity alert given a series with enough history. Returns
 *  null when the series is too short to evaluate (need at least 12
 *  observations). */
export function buildCommodityAlert(series: CommoditySeries): CommodityAlert | null {
  const obs = series.observations;
  if (obs.length < 12) return null;
  const current = obs[obs.length - 1]!.price;
  const window12 = obs.slice(-13, -1).map((o) => o.price); // 12 prior obs
  const window24 = obs.length >= 25
    ? obs.slice(-25, -1).map((o) => o.price)               // 24 prior obs
    : window12;
  const d12 = sigmaDeviation(current, window12);
  const d24 = sigmaDeviation(current, window24);
  const trend = trendSign(obs, 3);
  const tier = riskTierForDeviation(d12, d24);
  const direction = d12 >= 0 ? 'above' : 'below';
  return {
    commodity: series.commodity,
    unit: series.unit,
    currentPrice: current,
    deviation12mSigma: d12,
    deviation24mSigma: d24,
    trend,
    overallRisk: tier,
    message: `${series.commodity}: ${current.toFixed(2)} ${series.unit} — ${Math.abs(d12).toFixed(1)}σ ${direction} 12-month mean (${trend}).`,
  };
}

/** Roll up a list of commodity alerts into the snapshot the panel
 *  consumes. Sorts by overallRisk descending, then by |12m σ|. */
export function rankCommodityAlerts(alerts: readonly CommodityAlert[]): CommodityAlert[] {
  const tierRank: Record<CommodityRiskTier, number> = {
    low: 0, medium: 1, high: 2, critical: 3,
  };
  return [...alerts].sort((a, b) => {
    const dt = tierRank[b.overallRisk] - tierRank[a.overallRisk];
    if (dt !== 0) return dt;
    return Math.abs(b.deviation12mSigma) - Math.abs(a.deviation12mSigma);
  });
}
