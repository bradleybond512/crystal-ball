/**
 * Mode-forecast advisory → calibration ledger bridge.
 *
 * `mode-forecast.ts` emits per-domain posture advisories with a 0-1 `pressure`
 * level, but nothing grades whether an advisory's escalation call was right — so
 * the measurement spine has no read on whether the posture forecaster is
 * calibrated. This bridge logs each advisory as a pending `PredictionRecord`
 * (roadmap §8.3: "wire existing forecasters' outputs into forecast-calibration
 * so the spine has live data to score") and resolves it against an observed
 * outcome.
 *
 * Design mirrors `shortage/shortage-calibration-bridge.ts` and
 * `hypothesis-prediction-bridge.ts`:
 *   - `toPredictionRecord` is a pure function — fully fixture-testable.
 *   - `recordAdvisoryPredictions` wraps it with the singleton store's dedupe.
 *   - `pressure` is the model's own escalation likelihood, so it is used
 *     directly as the probability (clamped) — no separate confidence to fold in.
 *
 * Pure module: no DOM, no fetch, no globals beyond the shared calibration store.
 */

import { ADVISORY_THRESHOLD, type ForecastDomain, type ModeAdvisory } from '../mode-forecast';
import {
  getCalibrationStore,
  recordPrediction,
  resolvePrediction,
} from './forecast-calibration-adapter';
import type { FactDomain } from './types';
import type { PredictionRecord } from './forecast-calibration';

const HOUR_MS = 60 * 60 * 1000;
/** Dedupe bucket. Advisories re-emit every forecast cycle (~2 min); one logged
 *  prediction per domain per hour is the right cadence for grading. */
const WINDOW_MS = HOUR_MS;
/** How long until an unresolved advisory prediction's window closes. */
const RESOLVE_HORIZON_MS = 24 * HOUR_MS;

/** The binary event the ledger grades: "did domain pressure reach the advisory
 *  escalation threshold?". Reuses mode-forecast's own threshold so a logged
 *  prediction and an emitted advisory mean the same escalation. */
export const MODE_ESCALATION_THRESHOLD = ADVISORY_THRESHOLD;

/** True when an observed pressure counts as the escalation event. */
export function isEscalated(pressure: number): boolean {
  return pressure >= MODE_ESCALATION_THRESHOLD;
}

/** mode-forecast's ForecastDomain has no direct FactDomain twin; map each onto
 *  the closest existing ledger bucket. */
const DOMAIN_MAP: Record<ForecastDomain, FactDomain> = {
  finance: 'markets',
  security: 'conflict',
  disaster: 'humanitarian',
  cyber: 'cyber',
};

export function domainForForecast(domain: ForecastDomain): FactDomain {
  return DOMAIN_MAP[domain] ?? 'other';
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** The advisory's pressure is already a 0-1 escalation likelihood, so it is the
 *  probability directly (clamped to [0,1]; non-finite → 0). */
export function advisoryProbability(a: Pick<ModeAdvisory, 'pressure'>): number {
  return clamp01(a.pressure);
}

/** Stable id prefix for a domain, shared by id-build and resolve so the
 *  prefixes match. */
export function advisoryKeyPrefix(domain: ForecastDomain): string {
  return `mode:${domain}:`;
}

export function advisoryPredictionId(domain: ForecastDomain, now: number): string {
  const bucket = Math.floor(now / WINDOW_MS);
  return `${advisoryKeyPrefix(domain)}${bucket}`;
}

export function advisoryPredictionClaim(a: Pick<ModeAdvisory, 'domain'>): string {
  return `${a.domain} posture escalation (pressure ≥${MODE_ESCALATION_THRESHOLD}) within 24h`;
}

export function sourceIdForForecast(domain: ForecastDomain): string {
  return `mode-forecast:${domain}`;
}

/** Pure map: advisory → pending PredictionRecord. */
export function toPredictionRecord(a: ModeAdvisory, now: number): PredictionRecord {
  return {
    id: advisoryPredictionId(a.domain, now),
    sourceId: sourceIdForForecast(a.domain),
    domain: domainForForecast(a.domain),
    claim: advisoryPredictionClaim(a),
    probability: advisoryProbability(a),
    predictedAt: now,
    resolveBy: now + RESOLVE_HORIZON_MS,
    status: 'pending',
    algorithmVersion: `mode-forecast-${a.domain}-v1`,
  };
}

/** Log a batch of advisories as pending predictions, skipping any already
 *  logged for the same domain in the current hourly window. */
export function recordAdvisoryPredictions(
  advisories: readonly ModeAdvisory[],
  now: number = Date.now(),
): void {
  const store = getCalibrationStore();
  for (const a of advisories) {
    const id = advisoryPredictionId(a.domain, now);
    if (store.get(id)) continue;
    recordPrediction(toPredictionRecord(a, now));
  }
}

/** A pending prediction is "open" at time `now` when the observation falls
 *  inside its claim window [predictedAt, resolveBy]. Observations after the
 *  window closes must not resolve it. */
function isOpenAt(r: PredictionRecord, now: number): boolean {
  return r.status === 'pending' && r.predictedAt <= now && now <= r.resolveBy;
}

/** Ground-truth resolve: grade EVERY still-open in-window advisory prediction
 *  for this domain to `materialized`. Returns the count resolved. Use only with
 *  a real outcome; for self-grading off later pressure readings use
 *  resolveAdvisoryFromObservation. */
export function resolveAdvisoryPrediction(
  domain: ForecastDomain,
  materialized: boolean,
  now: number = Date.now(),
): number {
  const store = getCalibrationStore();
  const prefix = advisoryKeyPrefix(domain);
  const open = store.all().filter((r) => r.id.startsWith(prefix) && isOpenAt(r, now));
  let n = 0;
  for (const r of open) if (resolvePrediction(r.id, materialized, now)) n += 1;
  return n;
}

/** Proxy resolution off a later observed pressure. An escalated reading
 *  confirms every open in-window claim TRUE. A subthreshold reading proves
 *  nothing — pressure can still escalate before the window closes — so it never
 *  resolves anything false; window-close negatives are handled by
 *  settleExpiredAdvisoryPredictions. Returns the count resolved. */
export function resolveAdvisoryFromObservation(
  domain: ForecastDomain,
  observedPressure: number,
  now: number = Date.now(),
): number {
  if (!isEscalated(observedPressure)) return 0;
  return resolveAdvisoryPrediction(domain, true, now);
}

/** Window-close negatives. An advisory prediction whose horizon elapsed with no
 *  observed escalation resolves FALSE — the "no" outcome the Brier score needs
 *  so calibration sees false positives, not just hits. Scoped to mode-forecast
 *  records (id prefix "mode:") so it never reinterprets another domain's expiry.
 *  Run this before the generic expirePendingPredictions cadence, which would
 *  otherwise mark the same records 'expired' (uncounted). Returns the count
 *  resolved false. */
export function settleExpiredAdvisoryPredictions(now: number = Date.now()): number {
  const store = getCalibrationStore();
  // Strict `<`: at exactly resolveBy the window is still open (isOpenAt treats
  // `now <= resolveBy` as in-window), so an on-the-deadline escalated
  // observation can still grade it TRUE. Only strictly past the deadline does an
  // ungraded claim settle FALSE.
  const overdue = store.all().filter(
    (r) => r.id.startsWith('mode:') && r.status === 'pending' && r.resolveBy < now,
  );
  let n = 0;
  for (const r of overdue) if (resolvePrediction(r.id, false, now)) n += 1;
  return n;
}
