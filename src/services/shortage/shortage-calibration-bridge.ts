/**
 * Shortage forecast → calibration ledger bridge.
 *
 * The 8 deterministic commodity models each emit a `ShortageForecast` with a
 * 0-100 `riskScore` and a low/medium/high `confidence`, but nothing ever
 * grades those calls — so the measurement spine has no idea whether the
 * shortage layer is well-calibrated. This bridge logs each forecast as a
 * pending `PredictionRecord` (roadmap §8.3: "wire existing forecasters'
 * outputs into forecast-calibration so the spine has live data to score"),
 * and resolves it later against an observed outcome.
 *
 * Design (mirrors `intelligence/hypothesis-prediction-bridge.ts`):
 *   - `toPredictionRecord` is a pure function — fully fixture-testable.
 *   - `recordShortagePredictions` wraps it with the singleton store's dedupe.
 *   - Probabilities are shrunk toward the 0.5 prior by a confidence weight so a
 *     data-starved forecast can't assert a confident probability into the
 *     ledger (plan anti-pattern: "overconfidence theater"; design principle:
 *     "uncertainty flows end to end").
 *
 * Pure module: no DOM, no fetch, no globals beyond the shared calibration store.
 */

import { SHORTAGE_HIGH_THRESHOLD } from './shortage-alert-emitter';
import type { ShortageConfidence, ShortageDomain, ShortageForecast } from './shortage-types';
import {
  getCalibrationStore,
  recordPrediction,
  resolvePrediction,
} from '../intelligence/forecast-calibration-adapter';
import type { FactDomain } from '../intelligence/types';
import type { PredictionRecord } from '../intelligence/forecast-calibration';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Dedupe bucket. Shortage forecasts move over days, not minutes, so one
 *  logged prediction per commodity+region per day is the right cadence. */
const WINDOW_MS = DAY_MS;

/** The binary event the ledger grades: "did shortage risk exceed the HIGH
 *  band?". Reuses the alert emitter's threshold — and its strictly-greater
 *  comparison (`riskScore > threshold`) — so a logged prediction and a fired
 *  alert mean the same "elevated" event. */
export const SHORTAGE_ELEVATED_THRESHOLD = SHORTAGE_HIGH_THRESHOLD;

/** True when an observed riskScore counts as the elevated event. Matches the
 *  alert emitter's `> SHORTAGE_HIGH_THRESHOLD`, not `>=`. */
export function isElevated(riskScore: number): boolean {
  return riskScore > SHORTAGE_ELEVATED_THRESHOLD;
}

/** How much of a forecast's distance from the 0.5 prior survives into the
 *  logged probability, by stated confidence. A low-confidence "70" becomes a
 *  hedged ~0.61, not a confident 0.70. */
export const CONFIDENCE_WEIGHT: Record<ShortageConfidence, number> = {
  low: 0.55,
  medium: 0.8,
  high: 1,
};

/** The ledger's FactDomain has no food/energy/fertilizer/water members, so
 *  map the shortage domains onto the closest existing bucket. Energy
 *  commodity stress surfaces first as market price signals; the rest are
 *  macro-supply stories. Per-commodity granularity is preserved via
 *  `sourceId`, not this field. */
const DOMAIN_MAP: Record<ShortageDomain, FactDomain> = {
  food: 'macro',
  energy: 'markets',
  fertilizer: 'macro',
  water: 'macro',
};

export function domainForShortage(domain: ShortageDomain): FactDomain {
  return DOMAIN_MAP[domain] ?? 'macro';
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Convert a forecast's 0-100 riskScore into a calibrated probability of the
 *  elevated-shortage event, shrunk toward 0.5 by the confidence weight. */
export function shortagePredictionProbability(f: Pick<ShortageForecast, 'riskScore' | 'confidence'>): number {
  const raw = clamp01(f.riskScore / 100);
  const w = CONFIDENCE_WEIGHT[f.confidence] ?? CONFIDENCE_WEIGHT.medium;
  const shrunk = 0.5 + (raw - 0.5) * w;
  return Math.round(clamp01(shrunk) * 1e4) / 1e4;
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '-');
}

/** Stable id prefix for a commodity+region, shared by id-build and resolve so
 *  the prefixes match. */
export function shortageKeyPrefix(commodity: string, region: string): string {
  return `shortage:${normalize(commodity)}:${normalize(region)}:`;
}

export function shortagePredictionId(
  f: Pick<ShortageForecast, 'commodity' | 'region'>,
  now: number,
): string {
  const bucket = Math.floor(now / WINDOW_MS);
  return `${shortageKeyPrefix(f.commodity, f.region)}${bucket}`;
}

export function shortagePredictionClaim(
  f: Pick<ShortageForecast, 'commodity' | 'region' | 'horizonDays'>,
): string {
  return `${f.commodity} shortage risk elevated (>${SHORTAGE_ELEVATED_THRESHOLD}) in ${f.region} within ${f.horizonDays}d`;
}

export function sourceIdForShortage(commodity: string): string {
  return `shortage:${normalize(commodity)}`;
}

/** Pure map: forecast → pending PredictionRecord. */
export function toPredictionRecord(f: ShortageForecast, now: number): PredictionRecord {
  return {
    id: shortagePredictionId(f, now),
    sourceId: sourceIdForShortage(f.commodity),
    domain: domainForShortage(f.domain),
    claim: shortagePredictionClaim(f),
    probability: shortagePredictionProbability(f),
    predictedAt: now,
    resolveBy: now + f.horizonDays * DAY_MS,
    status: 'pending',
    algorithmVersion: `shortage-${normalize(f.commodity)}-v1`,
  };
}

/** Log a batch of forecasts as pending predictions, skipping any already
 *  logged in the current daily window. */
export function recordShortagePredictions(
  forecasts: readonly ShortageForecast[],
  now: number = Date.now(),
): void {
  const store = getCalibrationStore();
  for (const f of forecasts) {
    const id = shortagePredictionId(f, now);
    if (store.get(id)) continue;
    recordPrediction(toPredictionRecord(f, now));
  }
}

/** A pending prediction is "open" at time `now` when the observation falls
 *  inside its claim window [predictedAt, resolveBy]. Observations after the
 *  window closes must not resolve it — the window has already expired. */
function isOpenAt(r: PredictionRecord, now: number): boolean {
  return r.status === 'pending' && r.predictedAt <= now && now <= r.resolveBy;
}

/** Ground-truth resolve: grade EVERY still-open in-window prediction for this
 *  commodity+region to `materialized`. Daily dedupe + multi-week horizons mean
 *  many overlapping claims are open at once — a single observed outcome grades
 *  all of them, not just the newest. Returns the count resolved. Use only with
 *  a real outcome; for self-grading off later readings use
 *  resolveShortageFromObservation. */
export function resolveShortagePrediction(
  commodity: string,
  region: string,
  materialized: boolean,
  now: number = Date.now(),
): number {
  const store = getCalibrationStore();
  const prefix = shortageKeyPrefix(commodity, region);
  const open = store.all().filter((r) => r.id.startsWith(prefix) && isOpenAt(r, now));
  let n = 0;
  for (const r of open) if (resolvePrediction(r.id, materialized, now)) n += 1;
  return n;
}

/** Proxy resolution off a later observed forecast. An elevated reading
 *  confirms every open in-window claim TRUE. A subthreshold reading proves
 *  nothing — the event can still occur before the window closes — so it never
 *  resolves anything false; window-close negatives are handled by
 *  settleExpiredShortagePredictions. Returns the count resolved. */
export function resolveShortageFromObservation(
  observed: Pick<ShortageForecast, 'commodity' | 'region' | 'riskScore'>,
  now: number = Date.now(),
): number {
  if (!isElevated(observed.riskScore)) return 0;
  return resolveShortagePrediction(observed.commodity, observed.region, true, now);
}

/** Window-close negatives. A shortage prediction whose horizon elapsed with no
 *  elevated observation resolves FALSE — the "no" outcome the Brier score needs
 *  so calibration sees false positives, not just hits. Scoped to shortage-owned
 *  records (id prefix "shortage:") so it never reinterprets another domain's
 *  expiry. Run this before the generic expirePendingPredictions cadence, which
 *  would otherwise mark the same records 'expired' (uncounted). Returns the
 *  count resolved false. */
export function settleExpiredShortagePredictions(now: number = Date.now()): number {
  const store = getCalibrationStore();
  // Strict `<`: at exactly resolveBy the window is still open (isOpenAt treats
  // `now <= resolveBy` as in-window), so an on-the-deadline elevated
  // observation can still grade it TRUE. Only strictly past the deadline does
  // an ungraded claim settle FALSE.
  const overdue = store.all().filter(
    (r) => r.id.startsWith('shortage:') && r.status === 'pending' && r.resolveBy < now,
  );
  let n = 0;
  for (const r of overdue) if (resolvePrediction(r.id, false, now)) n += 1;
  return n;
}
