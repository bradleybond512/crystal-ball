/**
 * Live wiring for the prediction resolution loop (see prediction-resolver.ts
 * for the pure core). Runs a resolution pass over the AlgoEvalLedger's pending
 * predictions on a cadence, settling each against the alert store or expiring
 * ones whose window's evidence is gone. Kept separate from the pure resolver so
 * that module stays DOM/singleton-free and fixture-testable.
 */

import { getAlgoEvalLedger } from './algo-eval-ledger';
import { unifiedAlertStore } from '../unified-alerts';
import { runResolutionPass, alertSeverityObservable } from './prediction-resolver';

/** Observe 12h of outcome before settling a prediction. */
const RESOLVE_AFTER_MS = 12 * 60 * 60 * 1000;
/** Expire predictions older than this — the unified-alert store only retains
 *  48h, so beyond ~44h "no alerts" can't be trusted (the app may have been
 *  closed across the window). Must be < the alert retention. */
const EXPIRE_AFTER_MS = 44 * 60 * 60 * 1000;
const CADENCE_MS = 30 * 60 * 1000;
const INITIAL_DELAY_MS = 20 * 1000;

let _timer: ReturnType<typeof setInterval> | null = null;

/** Run one resolution pass now. Exposed for tests / manual trigger. */
export function runLivePredictionResolution(now: number = Date.now()): { resolved: number; expired: number } {
  const ledger = getAlgoEvalLedger();
  const pending = ledger.getUnresolved();
  if (pending.length === 0) return { resolved: 0, expired: 0 };
  const observe = alertSeverityObservable(
    () => unifiedAlertStore.getAll().map((a) => ({ source: a.source, severity: a.severity, timestamp: a.timestamp })),
    (source) => source, // AlertSource is already the domain vocabulary (earthquake/weather/…)
  );
  const pass = runResolutionPass(pending, observe, {
    resolveAfterMs: RESOLVE_AFTER_MS,
    expireAfterMs: EXPIRE_AFTER_MS,
    now,
  });
  for (const r of pass.resolutions) ledger.resolve(r.id, r.value);
  for (const id of pass.expirations) ledger.expire(id);
  if (pass.resolutions.length > 0 || pass.expirations.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[PREDICTION-RESOLVE] settled ${pass.resolutions.length} predictions, expired ${pass.expirations.length} (of ${pending.length} pending)`);
  }
  return { resolved: pass.resolutions.length, expired: pass.expirations.length };
}

function runQuietly(): void {
  try { runLivePredictionResolution(); } catch { /* best-effort */ }
}

export function startPredictionResolutionCadence(): void {
  if (_timer !== null) return;
  setTimeout(runQuietly, INITIAL_DELAY_MS);
  _timer = setInterval(runQuietly, CADENCE_MS) as unknown as ReturnType<typeof setInterval>;
}

export function stopPredictionResolutionCadence(): void {
  if (_timer !== null) { clearInterval(_timer); _timer = null; }
}
