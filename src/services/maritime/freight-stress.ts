/**
 * Freight stress signal (pure-deterministic).
 *
 * The Baltic Dry Index proper is no longer freely accessible. We use the
 * FRED CSV proxy of broad commodity-price indicators as a freight-cost
 * proxy: the producer-price index for all commodities (PPIACO) tracks
 * the input cost of moving and producing goods globally. Deviation from
 * the trailing 12-month average is the stress signal — short-horizon
 * spikes flag transport-cost pressure even when the BDI itself is dark.
 */

export interface FredObservation {
  date: string;
  value: number;
}

export type FreightStressLevel = 'low' | 'medium' | 'high' | 'critical';

export interface FreightStressResult {
  series: string;
  current: number | null;
  avg12m: number | null;
  stdev12m: number | null;
  deviationPct: number | null;
  zScore: number | null;
  trend: 'rising' | 'falling' | 'stable';
  stressScore: number;
  stressLevel: FreightStressLevel;
  observationCount: number;
  asOf: string | null;
}

// ── CSV parser ───────────────────────────────────────────────────────────────

/**
 * Parse a FRED CSV download (header row "DATE,SERIES_ID" or "observation_date,...").
 * Discards rows where value is "." (FRED's missing-value marker) or non-numeric.
 */
export function parseFredCsv(csv: string): FredObservation[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = lines[0]!.split(',');
  if (header.length < 2) return [];
  const out: FredObservation[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split(',');
    if (cols.length < 2) continue;
    const date = cols[0]!.trim();
    const raw = cols[1]!.trim();
    if (!date || raw === '' || raw === '.') continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    out.push({ date, value });
  }
  return out;
}

// ── Math helpers ─────────────────────────────────────────────────────────────

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let sq = 0;
  for (const x of xs) sq += (x - m) ** 2;
  return Math.sqrt(sq / (xs.length - 1));
}

function trendFromTail(xs: number[]): 'rising' | 'falling' | 'stable' {
  if (xs.length < 3) return 'stable';
  const tail = xs.slice(-3);
  const slope = (tail[2]! - tail[0]!) / 2;
  const ref = Math.abs(mean(tail)) || 1;
  if (slope > 0.005 * ref) return 'rising';
  if (slope < -0.005 * ref) return 'falling';
  return 'stable';
}

// ── Stress level mapping ─────────────────────────────────────────────────────

function stressLevelFor(score: number): FreightStressLevel {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

/**
 * Score is 0..100, derived from |z-score|:
 *   |z| ≥ 3.0 → 100   (extreme)
 *   |z| = 2.0 → 75    (>=2σ = "stressed" per spec)
 *   |z| = 1.0 → 35
 *   |z| = 0.0 → 0
 * Linear-interpolated between knots, clamped.
 */
export function stressScoreFromZ(z: number | null): number {
  if (z === null || !Number.isFinite(z)) return 0;
  const abs = Math.abs(z);
  if (abs >= 3) return 100;
  if (abs >= 2) return 75 + (abs - 2) * 25;
  if (abs >= 1) return 35 + (abs - 1) * 40;
  return abs * 35;
}

// ── Core ────────────────────────────────────────────────────────────────────

export function computeFreightStress(
  series: string,
  observations: FredObservation[],
): FreightStressResult {
  if (observations.length === 0) {
    return emptyResult(series);
  }

  const sorted = [...observations].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1]!;
  const current = last.value;

  // Last 12 observations BEFORE the current point form the rolling baseline.
  const window = sorted.slice(Math.max(0, sorted.length - 13), - 1);
  if (window.length < 3) {
    return {
      series,
      current,
      avg12m: null,
      stdev12m: null,
      deviationPct: null,
      zScore: null,
      trend: trendFromTail(sorted.map((o) => o.value)),
      stressScore: 0,
      stressLevel: 'low',
      observationCount: sorted.length,
      asOf: last.date,
    };
  }

  const values = window.map((o) => o.value);
  const avg12m = mean(values);
  const stdev12m = stdev(values);
  const deviationPct = avg12m === 0 ? null : ((current - avg12m) / avg12m) * 100;
  const zScore = stdev12m === 0 ? null : (current - avg12m) / stdev12m;
  const stressScore = Math.round(stressScoreFromZ(zScore));

  return {
    series,
    current,
    avg12m,
    stdev12m,
    deviationPct,
    zScore,
    trend: trendFromTail(sorted.map((o) => o.value)),
    stressScore,
    stressLevel: stressLevelFor(stressScore),
    observationCount: sorted.length,
    asOf: last.date,
  };
}

function emptyResult(series: string): FreightStressResult {
  return {
    series,
    current: null,
    avg12m: null,
    stdev12m: null,
    deviationPct: null,
    zScore: null,
    trend: 'stable',
    stressScore: 0,
    stressLevel: 'low',
    observationCount: 0,
    asOf: null,
  };
}

// ── Multi-series aggregate ───────────────────────────────────────────────────

export interface FreightStressAggregate {
  components: FreightStressResult[];
  overallScore: number;
  overallLevel: FreightStressLevel;
  asOf: string | null;
}

/**
 * Combine multiple freight-stress series into one overall reading.
 * Overall score is the max of component scores (worst-component-wins),
 * because shipping bottlenecks are dominated by the tightest constraint
 * rather than averaged across them.
 */
export function aggregateFreightStress(
  components: FreightStressResult[],
): FreightStressAggregate {
  if (components.length === 0) {
    return { components: [], overallScore: 0, overallLevel: 'low', asOf: null };
  }
  let max = 0;
  let asOf: string | null = null;
  for (const c of components) {
    if (c.stressScore > max) max = c.stressScore;
    if (c.asOf && (!asOf || c.asOf > asOf)) asOf = c.asOf;
  }
  return {
    components,
    overallScore: max,
    overallLevel: stressLevelFor(max),
    asOf,
  };
}
