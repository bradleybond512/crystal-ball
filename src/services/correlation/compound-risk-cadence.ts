/**
 * Live compound risk — wakes the dormant compound-risk engine on a
 * cadence fed by active situations, and keeps a warm snapshot that the
 * survival correlation contributor (and any panel) can read
 * synchronously. See docs/CORRELATION_NEXTGEN_PLAN.md §D6.
 */

import type { CompoundRiskInput, CompoundRiskResult } from '../intelligence/compound-risk';
import { trackedComputeCompoundRisk } from '../algorithms/tracked-algorithms';
import { factDomainFor } from './correlation-outcomes';
import { getInhibitorySnapshot } from './inhibition';
import {
  getSituationStoreV2,
  type Situation,
  type SituationSeverity,
} from '../intelligence/situation-store-v2';

const SEVERITY_SCORE: Record<SituationSeverity, number> = {
  low: 30,
  medium: 55,
  high: 75,
  critical: 92,
};

/** Pure mapper: open situations → compound-risk inputs. Resolved
 *  situations are history, not risk. */
export function situationsToCompoundInputs(
  situations: readonly Situation[],
): CompoundRiskInput[] {
  return situations
    .filter((s) => s.status !== 'resolved')
    .map((s) => ({
      id: s.id,
      title: s.name,
      domain: factDomainFor(s.domain),
      domains: [...new Set([s.domain, ...s.relatedDomains].map((d) => factDomainFor(d)))],
      sourceDomains: [...new Set([s.domain, ...s.relatedDomains])],
      severityScore: SEVERITY_SCORE[s.severity] ?? 30,
      confidence: s.confidence,
      entities: [...s.entityIds],
      centroid: s.location ? { lat: s.location.lat, lon: s.location.lon } : undefined,
    }));
}

export interface CompoundRiskSnapshot {
  results: CompoundRiskResult[];
  computedAt: number;
}

type SnapshotListener = (snapshot: CompoundRiskSnapshot) => void;

let latest: CompoundRiskSnapshot | null = null;
const listeners = new Set<SnapshotListener>();
let timerId: ReturnType<typeof setInterval> | null = null;

const DEFAULT_INTERVAL_MS = 15 * 60_000;
/** A snapshot older than this is stale — a wedged/crashed cadence must
 *  not leave old correlation heat on the posture board forever. */
export const SNAPSHOT_STALE_AFTER_MS = 3 * DEFAULT_INTERVAL_MS;

/** Warm synchronous read for contributors/panels. Null until the first
 *  cadence tick, and null again once the snapshot goes stale. */
export function latestCompoundRisk(
  now: number = Date.now(),
  maxAgeMs: number = SNAPSHOT_STALE_AFTER_MS,
): CompoundRiskSnapshot | null {
  if (!latest) return null;
  if (now - latest.computedAt > maxAgeMs) return null;
  return latest;
}

export function subscribeCompoundRisk(listener: SnapshotListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Recompute once from the given situations. Exported for tests and
 *  on-demand refresh. */
export function recomputeCompoundRisk(
  situations: readonly Situation[],
  now: number = Date.now(),
): CompoundRiskSnapshot {
  const results = trackedComputeCompoundRisk(situationsToCompoundInputs(situations), {
    inhibitorySnapshot: getInhibitorySnapshot(now),
  });
  latest = { results, computedAt: now };
  for (const l of listeners) {
    try { l(latest); } catch { /* listener crash isolation */ }
  }
  return latest;
}

/** Test hook. */
export function resetCompoundRiskCadence(): void {
  latest = null;
  listeners.clear();
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
}

/** Start the cadence: one immediate compute + periodic refresh.
 *  Idempotent; returns a stop function. */
export function startCompoundRiskCadence(options: {
  intervalMs?: number;
  store?: Pick<ReturnType<typeof getSituationStoreV2>, 'list'>;
} = {}): () => void {
  if (timerId !== null) return stopCadence;
  const store = options.store ?? getSituationStoreV2();
  const tick = (): void => {
    try {
      recomputeCompoundRisk(store.list());
    } catch { /* never let the cadence crash the app */ }
  };
  tick();
  timerId = setInterval(tick, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  return stopCadence;
}

function stopCadence(): void {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
}
