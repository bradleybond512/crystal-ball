/**
 * Prediction resolution loop — closes the calibration mission's open end.
 *
 * The driver-scorer (and other producers) record a prediction into the
 * AlgoEvalLedger for every scored observation, but nothing ever filled in the
 * outcome, so the AlgoEval panel showed thousands pending / 0% resolved. This
 * module defines the observable that settles a severity prediction and a pure
 * pass that resolves or expires each pending prediction:
 *
 *   - A prediction "domain X will be <severity>" made at T is settled by the
 *     PEAK alert severity actually seen in domain X during [T, T+resolveAfter].
 *     No alerts in a domain that WAS being observed ⇒ it stayed 'low'.
 *   - A prediction still unresolved past `expireAfter` (the app was closed
 *     across its whole window, so the alert history for that window is gone and
 *     "no alerts" can't be trusted) is EXPIRED — marked, excluded from
 *     accuracy, never counted as a hit or miss.
 *
 * Pure + injectable (no DOM/fetch/globals) so it is fully fixture-testable; the
 * live wiring (real ledger + alert store + cadence) lives at the bottom.
 */

import type { AlgorithmPrediction, PredictionValue } from './algo-eval-ledger';

/** low < medium < high < critical — the driver-scorer's DerivedSeverity ladder. */
export const SEVERITY_LADDER = ['low', 'medium', 'high', 'critical'] as const;
export type LadderSeverity = typeof SEVERITY_LADDER[number];
const SEVERITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/** Map an alert severity (`info|low|medium|high|critical`) onto the ladder. */
export function toLadderSeverity(sev: string): LadderSeverity {
  if (sev === 'critical') return 'critical';
  if (sev === 'high') return 'high';
  if (sev === 'medium') return 'medium';
  return 'low'; // 'low' + 'info' + anything else
}

/**
 * The observable that settles a prediction: the peak severity actually seen in
 * `domain` during [fromMs, toMs]. Returns a ladder severity, or `null` when the
 * outcome cannot be determined yet (caller leaves the prediction pending).
 */
export type SeverityObservable = (domain: string, fromMs: number, toMs: number) => LadderSeverity | null;

export interface ResolutionOptions {
  /** How long after a prediction to wait before observing its outcome. */
  resolveAfterMs: number;
  /** Age past which an unresolved prediction is expired (its window's evidence
   *  is gone — e.g. the app was closed across it). Must be > resolveAfterMs. */
  expireAfterMs: number;
  now: number;
}

export interface ResolutionPass {
  resolutions: { id: string; value: PredictionValue }[];
  expirations: string[];
}

/**
 * Decide, for each pending prediction, whether it can be resolved now, should
 * be expired, or should stay pending. Pure — the caller applies the results.
 */
export function runResolutionPass(
  pending: readonly AlgorithmPrediction[],
  observe: SeverityObservable,
  opts: ResolutionOptions,
): ResolutionPass {
  const resolutions: { id: string; value: PredictionValue }[] = [];
  const expirations: string[] = [];
  for (const p of pending) {
    if (p.resolvedAt || p.expiredAt) continue;
    const t = p.predictedAt.getTime();
    const age = opts.now - t;
    if (age < opts.resolveAfterMs) continue; // too early — outcome window not closed
    if (age >= opts.expireAfterMs) { expirations.push(p.id); continue; } // evidence gone
    const actual = observe(p.domain, t, t + opts.resolveAfterMs);
    if (actual !== null) resolutions.push({ id: p.id, value: actual });
    // actual === null ⇒ evidence temporarily unavailable; retry next pass.
  }
  return { resolutions, expirations };
}

// ── Alert-backed observable ────────────────────────────────────────────────

interface AlertLike { source: string; severity: string; timestamp: number }

/**
 * Build a SeverityObservable from a snapshot of alerts. Peak severity of alerts
 * whose source maps to `domain` within the window; 'low' when the domain was
 * quiet across a window we have data for. `domainOfSource` folds an alert
 * source onto the driver-scorer domain vocabulary.
 */
export function alertSeverityObservable(
  getAlerts: () => readonly AlertLike[],
  domainOfSource: (source: string) => string,
): SeverityObservable {
  return (domain, fromMs, toMs) => {
    let peak = -1;
    for (const a of getAlerts()) {
      if (a.timestamp < fromMs || a.timestamp > toMs) continue;
      if (domainOfSource(a.source) !== domain && a.source !== domain) continue;
      const r = SEVERITY_RANK[toLadderSeverity(a.severity)] ?? 0;
      if (r > peak) peak = r;
    }
    return peak < 0 ? 'low' : (SEVERITY_LADDER[peak] ?? 'low');
  };
}
