/**
 * Wastewater Genomics Surveillance — site-level + state-level NWSS view.
 *
 * Pure parsers + a thin fetcher facade. The sidecar (/api/biosurveillance/wastewater)
 * proxies the CDC NWSS Socrata endpoint and runs the aggregation logic
 * here, then the front end consumes a typed `WastewaterSurveillance`
 * payload.
 *
 * Data source: CDC NWSS public dataset 2ew6-ywp6
 *   https://data.cdc.gov/resource/2ew6-ywp6.json
 *
 * About the "concentration" field:
 *   CDC stopped publishing copies/mL in 2023. The current public-dataset
 *   exposure is `percentile` (the 15-day percentile vs the site's own
 *   historical baseline) and `ptc_15d` (15-day percent change). The UI
 *   labels it "concentration" colloquially but the underlying number is
 *   the WVAL/percentile value [0..100]. This file documents the
 *   semantics so downstream code doesn't claim more precision than the
 *   CDC actually publishes.
 */

import { getApiBaseUrl } from '@/services/runtime';

// ── Public types ──────────────────────────────────────────────────────

export type WwTrend = 'rising' | 'falling' | 'stable';
export type WwLevel = 'low' | 'moderate' | 'elevated' | 'high';

export interface NwssSiteSnapshot {
  /** Stable site identifier (NWSS `key_plot_id`). */
  siteId: string;
  /** Plant name when available (NWSS exposes `wwtp_name` only on a few rows). */
  siteName: string;
  /** Two-letter USPS state code, normalized from `wwtp_jurisdiction`. */
  stateCode: string;
  /** Original full-name jurisdiction string ("California"). */
  state: string;
  county?: string;
  populationServed?: number;
  /** Date_end of the most recent sample (ISO yyyy-mm-dd). */
  lastReport: string;
  /** WVAL/percentile in [0..100]. Null when CDC didn't publish one. */
  percentile15d: number | null;
  /** 15-day percent change in raw concentration. */
  ptc15d: number | null;
  trend: WwTrend;
  level: WwLevel;
}

export interface NwssStateRollup {
  state: string;
  stateCode: string;
  siteCount: number;
  /** Median percentile across the state's reporting sites. */
  medianPercentile15d: number | null;
  /** Median 15-day percent change. */
  medianPtc15d: number | null;
  trend: WwTrend;
  level: WwLevel;
  /** 4-week sparkline of weekly median percentile. Most-recent week last. */
  sparkline4w: number[];
  populationCovered: number;
}

export interface NwssNationalSummary {
  trend: WwTrend;
  medianPercentile15d: number | null;
  /** Number of states with at least one reporting site. */
  activeStates: number;
  /** Number of states classified as 'rising'. */
  risingStates: number;
}

export interface WastewaterSurveillance {
  national: NwssNationalSummary;
  states: NwssStateRollup[];
  topSites: NwssSiteSnapshot[];
  /** ISO yyyy-mm-dd of the latest date_end seen across all rows. */
  asOfDate: string | null;
  fetchedAt: string;
  degraded?: boolean;
  reason?: string;
}

// ── Constants ─────────────────────────────────────────────────────────

const TREND_PCT_THRESHOLD = 25;
const LEVEL_PERCENTILE = { high: 80, elevated: 60, moderate: 40 } as const;

const STATE_NAME_TO_CODE: Readonly<Record<string, string>> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'puerto rico': 'PR',
};

// ── Helpers ───────────────────────────────────────────────────────────

function toFinite(x: unknown): number | null {
  if (x === null || x === undefined) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function toStr(x: unknown, fallback = ''): string {
  if (typeof x === 'string') return x;
  if (typeof x === 'number' || typeof x === 'boolean') return String(x);
  return fallback;
}

export function normalizeStateCode(jurisdiction: string): string {
  const trimmed = jurisdiction.trim();
  if (trimmed.length === 2 && /^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  const code = STATE_NAME_TO_CODE[trimmed.toLowerCase()];
  return code ?? trimmed;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1]! + sorted[mid]!) / 2;
  return sorted[mid]!;
}

export function classifyLevel(percentile: number | null): WwLevel {
  if (percentile === null || !Number.isFinite(percentile)) return 'low';
  if (percentile >= LEVEL_PERCENTILE.high) return 'high';
  if (percentile >= LEVEL_PERCENTILE.elevated) return 'elevated';
  if (percentile >= LEVEL_PERCENTILE.moderate) return 'moderate';
  return 'low';
}

export function classifyTrend(ptc15d: number | null): WwTrend {
  if (ptc15d === null || !Number.isFinite(ptc15d)) return 'stable';
  if (ptc15d > TREND_PCT_THRESHOLD) return 'rising';
  if (ptc15d < -TREND_PCT_THRESHOLD) return 'falling';
  return 'stable';
}

// ── Site parser ───────────────────────────────────────────────────────

/** Parse a single NWSS row into a site snapshot. Returns null for rows
 *  with no usable identity / date / metric. */
export function parseNwssRow(row: unknown): NwssSiteSnapshot | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const dateEnd = toStr(r.date_end);
  if (!dateEnd) return null;
  const stateRaw = toStr(r.wwtp_jurisdiction);
  if (!stateRaw) return null;
  const siteId = toStr(r.key_plot_id) || `${stateRaw}-${toStr(r.county_names)}-${dateEnd}`;
  const percentile = toFinite(r.percentile);
  const ptc = toFinite(r.ptc_15d);
  if (percentile === null && ptc === null) return null;
  const stateCode = normalizeStateCode(stateRaw);
  return {
    siteId,
    siteName: toStr(r.wwtp_name) || siteId,
    stateCode,
    state: stateRaw,
    county: toStr(r.county_names) || undefined,
    populationServed: toFinite(r.population_served) ?? undefined,
    lastReport: dateEnd,
    percentile15d: percentile,
    ptc15d: ptc,
    trend: classifyTrend(ptc),
    level: classifyLevel(percentile),
  };
}

/** Parse a batch of rows; keep only the most-recent row per
 *  `key_plot_id` (NWSS publishes one record per 15-day window). */
export function parseNwssRows(rows: unknown): NwssSiteSnapshot[] {
  if (!Array.isArray(rows)) return [];
  const bySite = new Map<string, NwssSiteSnapshot>();
  for (const raw of rows) {
    const snap = parseNwssRow(raw);
    if (!snap) continue;
    const existing = bySite.get(snap.siteId);
    if (!existing || snap.lastReport > existing.lastReport) {
      bySite.set(snap.siteId, snap);
    }
  }
  return [...bySite.values()];
}

// ── State rollups ─────────────────────────────────────────────────────

/** Group sites by state code, compute medians, derive trend + level. */
export function rollupByState(sites: readonly NwssSiteSnapshot[]): NwssStateRollup[] {
  const byState = new Map<string, NwssSiteSnapshot[]>();
  for (const s of sites) {
    const list = byState.get(s.stateCode) ?? [];
    list.push(s);
    byState.set(s.stateCode, list);
  }
  const out: NwssStateRollup[] = [];
  for (const [stateCode, list] of byState) {
    const percentiles = list.map((s) => s.percentile15d).filter((v): v is number => v !== null);
    const ptcs = list.map((s) => s.ptc15d).filter((v): v is number => v !== null);
    const medianPercentile = median(percentiles);
    const medianPtc = median(ptcs);
    let populationCovered = 0;
    for (const s of list) populationCovered += s.populationServed ?? 0;
    out.push({
      state: list[0]!.state,
      stateCode,
      siteCount: list.length,
      medianPercentile15d: medianPercentile,
      medianPtc15d: medianPtc,
      trend: classifyTrend(medianPtc),
      level: classifyLevel(medianPercentile),
      sparkline4w: [],
      populationCovered,
    });
  }
  out.sort((a, b) => (b.medianPercentile15d ?? -1) - (a.medianPercentile15d ?? -1));
  return out;
}

// ── 4-week weekly sparkline (per state) ───────────────────────────────

/** Build a per-state sparkline of weekly median percentile for the
 *  trailing 4 weeks (28 days) ending at `now`. Each value is the
 *  median percentile across all sites in that state with a date_end
 *  in the bucket. Buckets without data emit `0` (so renderers always
 *  get a 4-element array). */
export function computeWeeklySparklines(
  rows: unknown,
  now: number = Date.now(),
): Map<string, number[]> {
  if (!Array.isArray(rows)) return new Map();
  const buckets = bucketBoundaries(now, 4, 7);
  const collector = new Map<string, number[][]>();

  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const dateStr = toStr(r.date_end);
    const ts = parseIsoDateOrNull(dateStr);
    if (ts === null) continue;
    const bucketIdx = bucketIndex(ts, buckets);
    if (bucketIdx < 0) continue;
    const stateCode = normalizeStateCode(toStr(r.wwtp_jurisdiction));
    if (!stateCode) continue;
    const percentile = toFinite(r.percentile);
    if (percentile === null) continue;
    const stateBuckets = collector.get(stateCode) ?? Array.from({ length: 4 }, () => [] as number[]);
    stateBuckets[bucketIdx]!.push(percentile);
    collector.set(stateCode, stateBuckets);
  }

  const out = new Map<string, number[]>();
  for (const [stateCode, bucketArr] of collector) {
    const series: number[] = [];
    for (const bucket of bucketArr) {
      const m = median(bucket);
      series.push(m ?? 0);
    }
    out.set(stateCode, series);
  }
  return out;
}

/** Compute the boundary timestamps for `numBuckets` rolling windows of
 *  `daysPerBucket` days each, ending at `now`. Returned as an array of
 *  [startMs, endMs] pairs in chronological order (oldest first). */
function bucketBoundaries(now: number, numBuckets: number, daysPerBucket: number): [number, number][] {
  const dayMs = 24 * 60 * 60 * 1000;
  const out: [number, number][] = [];
  for (let i = numBuckets - 1; i >= 0; i -= 1) {
    const end = now - i * daysPerBucket * dayMs;
    const start = end - daysPerBucket * dayMs;
    out.push([start, end]);
  }
  return out;
}

function bucketIndex(ts: number, buckets: readonly [number, number][]): number {
  for (const [i, [start, end]] of buckets.entries()) {
    if (ts >= start && ts < end) return i;
  }
  return -1;
}

function parseIsoDateOrNull(s: string): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

// ── National summary ──────────────────────────────────────────────────

export function computeNational(rollups: readonly NwssStateRollup[]): NwssNationalSummary {
  const percentiles = rollups
    .map((r) => r.medianPercentile15d)
    .filter((v): v is number => v !== null);
  const med = median(percentiles);
  let rising = 0;
  let falling = 0;
  for (const r of rollups) {
    if (r.trend === 'rising') rising += 1;
    if (r.trend === 'falling') falling += 1;
  }
  let trend: WwTrend = 'stable';
  if (rising >= rollups.length * 0.4 && rising > falling) trend = 'rising';
  else if (falling >= rollups.length * 0.4 && falling > rising) trend = 'falling';
  return {
    trend,
    medianPercentile15d: med,
    activeStates: rollups.length,
    risingStates: rising,
  };
}

// ── Top sites ─────────────────────────────────────────────────────────

/** Top N sites by percentile (or by ptc15d when percentile missing).
 *  Default N=10. */
export function pickTopSites(sites: readonly NwssSiteSnapshot[], n = 10): NwssSiteSnapshot[] {
  const scored = [...sites]
    .filter((s) => s.percentile15d !== null || s.ptc15d !== null)
    .sort((a, b) => {
      const ap = a.percentile15d ?? -Infinity;
      const bp = b.percentile15d ?? -Infinity;
      if (bp !== ap) return bp - ap;
      const at = a.ptc15d ?? -Infinity;
      const bt = b.ptc15d ?? -Infinity;
      return bt - at;
    });
  return scored.slice(0, n);
}

// ── Top-level aggregation ─────────────────────────────────────────────

/** Run the full parse → rollup → sparkline → national pipeline. */
export function buildWastewaterSurveillance(
  rawRows: unknown,
  now: number = Date.now(),
): WastewaterSurveillance {
  const sites = parseNwssRows(rawRows);
  const rollups = rollupByState(sites);
  const sparklines = computeWeeklySparklines(rawRows, now);
  for (const r of rollups) {
    const series = sparklines.get(r.stateCode);
    r.sparkline4w = series?.length === 4 ? series : [0, 0, 0, 0];
  }
  let asOfDate: string | null = null;
  for (const s of sites) if (asOfDate === null || s.lastReport > asOfDate) asOfDate = s.lastReport;
  return {
    national: computeNational(rollups),
    states: rollups,
    topSites: pickTopSites(sites, 10),
    asOfDate,
    fetchedAt: new Date(now).toISOString(),
  };
}

// ── Fetcher facade ────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 25_000;

/** Fetch the surveillance snapshot via the sidecar. Returns a degraded
 *  empty payload on any failure rather than throwing. */
export async function fetchWastewaterSurveillance(): Promise<WastewaterSurveillance> {
  const url = `${getApiBaseUrl()}/api/biosurveillance/wastewater`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      return degradedPayload(`HTTP ${resp.status}`);
    }
    const data = (await resp.json()) as Partial<WastewaterSurveillance>;
    return {
      national: data.national ?? { trend: 'stable', medianPercentile15d: null, activeStates: 0, risingStates: 0 },
      states: Array.isArray(data.states) ? data.states : [],
      topSites: Array.isArray(data.topSites) ? data.topSites : [],
      asOfDate: data.asOfDate ?? null,
      fetchedAt: data.fetchedAt ?? new Date().toISOString(),
      ...(data.degraded ? { degraded: true, reason: data.reason } : {}),
    };
  } catch (error) {
    return degradedPayload(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}

function degradedPayload(reason: string): WastewaterSurveillance {
  return {
    national: { trend: 'stable', medianPercentile15d: null, activeStates: 0, risingStates: 0 },
    states: [],
    topSites: [],
    asOfDate: null,
    fetchedAt: new Date().toISOString(),
    degraded: true,
    reason,
  };
}

// ── Color ramp (shared with globe layer + panel) ──────────────────────

export const WW_LEVEL_COLOR: Readonly<Record<WwLevel, string>> = {
  low: '#10b981',       // emerald 500
  moderate: '#fbbf24',  // amber 400
  elevated: '#fb923c',  // orange 400
  high: '#dc2626',      // red 600
};
