/**
 * Pair persistence — the live correlate path's emitted pairs land in the
 * shared correlation-store ring buffer, so crisis-signature (and any
 * other reader) sees the SAME pairs the situations were built from.
 * Kills the G5 divergence where the persisted store was populated by a
 * different path than the live correlate.
 */

import { getCorrelationStore } from '../intelligence/correlation-store';
import { getSituationStoreV2 } from '../intelligence/situation-store-v2';

let started = false;

/** Idempotent; returns a cleanup function. */
export function startPairPersistence(store = getSituationStoreV2()): () => void {
  if (started) return noop;
  started = true;
  const remove = store.addPairListener((pairs) => {
    const target = getCorrelationStore();
    // add() dedupes on (ruleId, minId, maxId) — re-emissions are no-ops.
    for (const pair of pairs) target.add(pair);
  });
  return () => {
    started = false;
    remove();
  };
}

function noop(): void {
  // second start is a no-op; nothing to clean up
}
