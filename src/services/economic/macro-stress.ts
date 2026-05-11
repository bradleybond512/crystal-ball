/**
 * Macro stress signals — pure helpers for VIX and FX deviation.
 *
 * Sidecar endpoint: /api/macro-stress (FRED CSV proxy, no key required).
 *
 * Pure-deterministic. No fetch, no globals.
 */

export type VixGauge = 'calm' | 'elevated' | 'stress' | 'crisis';

export interface FredObservation {
  date: string;
  value: number;
}

export interface MacroSeriesSnapshot {
  series: string;
  current: number | null;
  asOf: string | null;
  /** Mean of the trailing 30 valid observations. */
  mean30: number | null;
  /** Stddev of the trailing 30 valid observations. */
  stddev30: number | null;
  /** (current - mean30) / stddev30, or null if insufficient. */
  zScore: number | null;
  trend: 'rising' | 'falling' | 'stable';
  /** For VIX: gauge label; null for FX series. */
  vixGauge: VixGauge | null;
  error?: string;
}

export interface MacroStressResponse {
  components: MacroSeriesSnapshot[];
  asOf: string | null;
}

/** Map a VIX value to one of four gauge bands. */
export function vixGaugeFor(value: number | null): VixGauge | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (value < 20) return 'calm';
  if (value < 30) return 'elevated';
  if (value < 40) return 'stress';
  return 'crisis';
}

/** Parse a FRED CSV download (date,value rows; "." = missing). */
export function parseFredCsv(csv: string): FredObservation[] {
  const out: FredObservation[] = [];
  const lines = csv.split(/\r?\n/);
  // Skip header
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const [date, raw] = line.split(',');
    if (!date || !raw || raw === '.') continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    out.push({ date, value });
  }
  return out;
}

/** Build a per-series snapshot from a sorted (oldest→newest) FRED observation list. */
export function buildSeriesSnapshot(
  series: string,
  observations: readonly FredObservation[],
  options: { isVix?: boolean } = {},
): MacroSeriesSnapshot {
  if (observations.length === 0) {
    return {
      series,
      current: null,
      asOf: null,
      mean30: null,
      stddev30: null,
      zScore: null,
      trend: 'stable',
      vixGauge: null,
    };
  }
  const last = observations[observations.length - 1]!;
  const recent = observations.slice(-30);
  let mean30: number | null = null;
  let stddev30: number | null = null;
  let zScore: number | null = null;
  if (recent.length >= 5) {
    const sum = recent.reduce((s, o) => s + o.value, 0);
    mean30 = sum / recent.length;
    const variance = recent.reduce((s, o) => s + (o.value - mean30!) ** 2, 0) / recent.length;
    stddev30 = Math.sqrt(variance);
    if (stddev30 > 0) {
      zScore = (last.value - mean30) / stddev30;
    }
  }
  const trend = computeTrend(observations);
  return {
    series,
    current: last.value,
    asOf: last.date,
    mean30,
    stddev30,
    zScore,
    trend,
    vixGauge: options.isVix ? vixGaugeFor(last.value) : null,
  };
}

/** Compare last 5 observations against the prior 5 to call rising / falling / stable. */
function computeTrend(observations: readonly FredObservation[]): 'rising' | 'falling' | 'stable' {
  if (observations.length < 10) return 'stable';
  const recent = observations.slice(-5);
  const prior = observations.slice(-10, -5);
  const recentAvg = recent.reduce((s, o) => s + o.value, 0) / recent.length;
  const priorAvg = prior.reduce((s, o) => s + o.value, 0) / prior.length;
  if (priorAvg === 0) return 'stable';
  const pct = (recentAvg - priorAvg) / Math.abs(priorAvg);
  if (pct > 0.05) return 'rising';
  if (pct < -0.05) return 'falling';
  return 'stable';
}
