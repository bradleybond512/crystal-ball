/**
 * Aftershock Watch — Layer 6 of the Seismic Intelligence System.
 *
 * Pure deterministic. No DOM, no fetch, no globals at import time.
 * Two responsibilities:
 *
 *   1. `forecastAftershocks(mainshock, options?)` — given a mainshock
 *      magnitude + origin time, produce expected aftershock counts at
 *      [24, 72, 168] hour horizons, the Omori-Utsu rate parameters,
 *      Bath's-law largest-aftershock magnitude, and a per-horizon
 *      Poisson 90% confidence interval + P(M ≥ 5).
 *
 *   2. `summarizeKnownAftershocks(mainshock, observed, radiusKm?)` —
 *      filter a USGS ComCat aftershock cloud to events within
 *      `radiusKm` (default 100 km) of the mainshock and within +14
 *      days. Returns a structured summary that pairs with the forecast
 *      so the renderer can show "expected N, observed M, ratio R".
 *
 * Plan invariants:
 *   - Omori-Utsu integrated over [t1, t2] with K, c, p chosen as:
 *       K = 10^(1.5 + 1.0*(M_main - 2.0))
 *       c = 0.1 (hr)
 *       p = 1.1
 *     Closed-form for the expected count is K*((c+t1)^(1-p) -
 *     (c+t2)^(1-p))/(p-1).
 *   - Bath's law: largest expected aftershock = M_main - 1.2.
 *   - Poisson 90% CI is reported via a Wilson-approximated
 *     symmetric range around the expected count when expected ≥ 5,
 *     and via an exact-tabulated lower/upper for small expected.
 *   - P(M ≥ 5) uses the Gutenberg-Richter relation N(≥M) = K*10^(-b*M)
 *     with b = 1.0, anchored to the integrated count for M ≥ 0 across
 *     the horizon → P(at least one M≥5) = 1 - exp(-λ_M5).
 */

import type { CanonicalSeismicEvent } from './seismic-types';

// ─── Tuning constants ─────────────────────────────────────────────────

export const OMORI_UTSU_DEFAULTS = {
  /** Productivity exponent. K = 10^(a + b*(M_main - M_ref)). */
  a: 1.5,
  /** b-value (slope) — set to 1.0 (Reasenberg-Jones default). */
  b: 1,
  /** Reference magnitude M_ref. */
  mRef: 2,
  /** Decay offset (hours). */
  c: 0.1,
  /** Decay exponent. */
  p: 1.1,
  /** Bath's law magnitude offset. */
  bathDelta: 1.2,
} as const;

export const DEFAULT_HORIZONS_HOURS = [24, 72, 168] as const;
export type AftershockHorizon = typeof DEFAULT_HORIZONS_HOURS[number];

// ─── Public types ─────────────────────────────────────────────────────

export interface AftershockHorizonForecast {
  horizonHours: number;
  expectedCount: number;
  /** Poisson 90% confidence interval [lower, upper]. */
  ci90: { lower: number; upper: number };
  /** Probability of at least one M ≥ 5 aftershock within the horizon. */
  probAtLeastOneM5: number;
  /** Probability of at least one aftershock larger than the Bath
   *  expectation (= M_main - 1.2) within the horizon. */
  probAtLeastOneLargerThanBath: number;
}

export interface AftershockForecast {
  mainshockMagnitude: number;
  mainshockTime: number;
  /** K productivity (events per hour at the t→0 limit, formally
   *  K/(c+t)^p — reported here so the renderer can show the rate
   *  parameter without recomputing it). */
  K: number;
  c: number;
  p: number;
  bValue: number;
  /** Bath's-law largest-aftershock expectation. */
  largestExpected: number;
  horizons: AftershockHorizonForecast[];
}

export interface AftershockObservedSummary {
  /** Number of events in window + radius. */
  count: number;
  /** Largest magnitude observed (null if none). */
  largestMagnitude: number | null;
  /** Time of the largest observed aftershock (ms epoch, null if none). */
  largestAt: number | null;
  /** Latest event time (ms epoch, null if none). */
  latestAt: number | null;
  /** Subset of the input events that passed the radius + time filter,
   *  sorted ascending by time. */
  events: CanonicalSeismicEvent[];
}

export interface AftershockReport {
  forecast: AftershockForecast;
  observed: AftershockObservedSummary;
  /** Ratio of observed-to-expected at the longest horizon. */
  observedToExpectedRatio: number | null;
  /** Largest observed minus Bath's-law expectation. Negative means
   *  observed < expected; positive means we've already exceeded the
   *  classic single-event expectation. */
  bathDelta: number | null;
}

// ─── Forecast ─────────────────────────────────────────────────────────

export interface ForecastOptions {
  /** Override horizons. Hours from mainshock origin. */
  horizonsHours?: readonly number[];
}

export function forecastAftershocks(
  mainshock: { magnitude: number; occurredAt: number },
  options: ForecastOptions = {},
): AftershockForecast {
  const { a, b, mRef, c, p, bathDelta } = OMORI_UTSU_DEFAULTS;
  const M = mainshock.magnitude;
  const K = Math.pow(10, a + b * (M - mRef));
  const horizons = options.horizonsHours ?? DEFAULT_HORIZONS_HOURS;

  const horizonForecasts: AftershockHorizonForecast[] = [];
  for (const h of horizons) {
    const expected = integrateOmoriUtsu(K, c, p, 0, h);
    const ci = poissonCI90(expected);
    // Gutenberg-Richter scaling: N(≥M) = N(≥0) * 10^(-b*M). The K above
    // is anchored at M_ref, so to scale to M ≥ 5 we multiply by
    // 10^(-b*(5 - M_ref)).
    const lambdaM5 = expected * Math.pow(10, -b * (5 - mRef));
    const probM5 = 1 - Math.exp(-Math.max(lambdaM5, 0));
    const bathTarget = M - bathDelta;
    const lambdaBath = expected * Math.pow(10, -b * (bathTarget - mRef));
    const probBath = 1 - Math.exp(-Math.max(lambdaBath, 0));
    horizonForecasts.push({
      horizonHours: h,
      expectedCount: round3(expected),
      ci90: { lower: round3(ci.lower), upper: round3(ci.upper) },
      probAtLeastOneM5: round3(probM5),
      probAtLeastOneLargerThanBath: round3(probBath),
    });
  }

  return {
    mainshockMagnitude: M,
    mainshockTime: mainshock.occurredAt,
    K: round3(K),
    c,
    p,
    bValue: b,
    largestExpected: round3(M - bathDelta),
    horizons: horizonForecasts,
  };
}

/**
 * ∫ K/(c+t)^p dt from t1 to t2 (hours). Closed-form for p ≠ 1:
 *   K * [(c+t1)^(1-p) - (c+t2)^(1-p)] / (p - 1)
 */
function integrateOmoriUtsu(K: number, c: number, p: number, t1: number, t2: number): number {
  if (t2 <= t1) return 0;
  if (Math.abs(p - 1) < 1e-9) {
    return K * Math.log((c + t2) / (c + t1));
  }
  const num = Math.pow(c + t1, 1 - p) - Math.pow(c + t2, 1 - p);
  return K * num / (p - 1);
}

/**
 * Poisson 90% CI. Uses the chi-square approximation:
 *   lower = ½ * χ²(0.05, 2k)
 *   upper = ½ * χ²(0.95, 2k+2)
 * Implemented via Wilson-Hilferty for large k and a small-table for
 * k = 0..9 to keep the implementation self-contained and deterministic.
 */
function poissonCI90(expected: number): { lower: number; upper: number } {
  if (!Number.isFinite(expected) || expected < 0) return { lower: 0, upper: 0 };
  const k = expected;
  // Small-k regime: use a closed-form approximation that hugs the
  // Garwood exact intervals for integer k = 0..9.
  if (k < 10) {
    const lower = k > 0 ? k * Math.pow(1 - 1 / (9 * k) - 1.6449 / (3 * Math.sqrt(k)), 3) : 0;
    const upper = (k + 1) * Math.pow(1 - 1 / (9 * (k + 1)) + 1.6449 / (3 * Math.sqrt(k + 1)), 3);
    return { lower: Math.max(0, lower), upper: Math.max(upper, k) };
  }
  // Large-k regime: normal approximation with √k variance.
  const sd = Math.sqrt(k);
  return { lower: Math.max(0, k - 1.6449 * sd), upper: k + 1.6449 * sd };
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

// ─── Observed summary ─────────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

/** Great-circle distance in km. */
export function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Filter a USGS ComCat aftershock cloud to events within `radiusKm` of
 * the mainshock and within [mainshock.occurredAt + 1ms, mainshock +
 * 14 days]. Returns a structured summary.
 */
export function summarizeKnownAftershocks(
  mainshock: { lat: number; lon: number; occurredAt: number; id?: string },
  observed: readonly CanonicalSeismicEvent[],
  radiusKm = 100,
): AftershockObservedSummary {
  const start = mainshock.occurredAt;
  const end = start + FOURTEEN_DAYS_MS;
  const filtered = observed.filter((e) => {
    if (e.id === mainshock.id) return false;
    if (e.occurredAt <= start || e.occurredAt > end) return false;
    if (!Number.isFinite(e.lat) || !Number.isFinite(e.lon)) return false;
    return haversineKm({ lat: mainshock.lat, lon: mainshock.lon }, e) <= radiusKm;
  });

  const sorted = [...filtered].sort((a, b) => a.occurredAt - b.occurredAt);
  let largestMagnitude: number | null = null;
  let largestAt: number | null = null;
  for (const e of sorted) {
    if (e.magnitude === null) continue;
    if (largestMagnitude === null || e.magnitude > largestMagnitude) {
      largestMagnitude = e.magnitude;
      largestAt = e.occurredAt;
    }
  }
  const latest = sorted.length > 0 ? sorted[sorted.length - 1] : undefined;
  return {
    count: sorted.length,
    largestMagnitude,
    largestAt,
    latestAt: latest ? latest.occurredAt : null,
    events: sorted,
  };
}

// ─── Combined report ──────────────────────────────────────────────────

export function buildAftershockReport(
  mainshock: { magnitude: number; lat: number; lon: number; occurredAt: number; id?: string },
  observed: readonly CanonicalSeismicEvent[],
  options: ForecastOptions & { radiusKm?: number } = {},
): AftershockReport {
  const forecast = forecastAftershocks(mainshock, options);
  const summary = summarizeKnownAftershocks(mainshock, observed, options.radiusKm ?? 100);
  const longest = forecast.horizons.length > 0 ? forecast.horizons[forecast.horizons.length - 1] : undefined;
  const expectedAtLongest = longest?.expectedCount ?? 0;
  const ratio = expectedAtLongest > 0 ? summary.count / expectedAtLongest : null;
  const bathDelta = summary.largestMagnitude === null
    ? null
    : round3(summary.largestMagnitude - forecast.largestExpected);
  return {
    forecast,
    observed: summary,
    observedToExpectedRatio: ratio === null ? null : round3(ratio),
    bathDelta,
  };
}
