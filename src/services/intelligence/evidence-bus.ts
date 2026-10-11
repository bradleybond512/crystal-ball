export { captureEvidence } from './evidence-outbox';
/**
 * Evidence change bus (R4-LOW-008).
 *
 * The calibration ledgers call `notifyEvidenceChanged` after each successful
 * persist. The evidence journal client registers the handler and schedules a
 * debounced reconcile to the sidecar journal. Keeping this module
 * free of runtime ledger imports lets producers capture before their caps and
 * announce persisted changes without importing the journal or its wiring. The
 * outbox re-export depends only on runtime guards and type-only ledger shapes.
 */

export type EvidenceSourceKind = 'forecast' | 'alert-outcome' | 'ema-forecast';

type EvidenceChangeHandler = (kind: EvidenceSourceKind) => void;

let handler: EvidenceChangeHandler | null = null;

export function notifyEvidenceChanged(kind: EvidenceSourceKind): void {
  if (!handler) return;
  try {
    handler(kind);
  } catch {
    // The journal is best-effort; a handler failure never breaks a ledger write.
  }
}

/** Register the single change handler. Returns an unregister function. */
export function setEvidenceChangeHandler(next: EvidenceChangeHandler | null): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}
