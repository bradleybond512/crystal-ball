/**
 * ACC-302 persistence baseline — "the current state continues."
 *
 * Applicable ONLY to state-like advisory targets (mode:* and shortage:*
 * targetKey prefixes, criteria-less): the same target resolves
 * repeatedly over time, so its own recent resolutions are a defensible
 * naive forecast. Event-occurrence, warning-verification, market, and
 * hypothesis targets return null — the roadmap's `not_applicable`.
 *
 * Estimate: Laplace-smoothed frequency of `true` over the most recent
 * K=5 usable resolutions on the SAME targetKey — with one prior
 * resolution this is 2/3 (or 1/3), converging toward the observed local
 * rate as the streak grows. History passes the exact ACC-301 leakage
 * filter (resolved before the target was predicted, non-proxy evidence
 * observable before the cutoff, never baseline-sourced).
 *
 * Pure: target + history in, PredictionRecord | null out.
 */

import type { PredictionRecord } from './forecast-calibration';
import { fnv1a64 } from './hierarchical-base-rate';
import { isBaselineSourceId, PERSISTENCE_BASELINE_SOURCE_ID } from './baseline-model-ids';


export const PERSISTENCE_BASELINE_VERSION = '1.0.0';

const RECENT_WINDOW = 5;
const STATE_LIKE_PREFIXES = ['mode:', 'shortage:'] as const;

export interface PersistenceBaselineEstimate {
  probability: number;
  /** Usable prior resolutions on this targetKey that informed it. */
  sampleCount: number;
}

function isStateLikeTarget(target: PredictionRecord): boolean {
  if (target.criteria) return false;
  const key = target.targetKey ?? '';
  return STATE_LIKE_PREFIXES.some((p) => key.startsWith(p));
}

function resolvedOutcome(record: PredictionRecord): boolean | null {
  if (record.status === 'resolved_true') return true;
  if (record.status === 'resolved_false') return false;
  return null;
}

function isProxyResolution(record: PredictionRecord): boolean {
  if (record.resolutionProvenance?.kind === 'proxy') return true;
  return record.resolutionNote?.startsWith('proxy:') ?? false;
}

function evidenceAvailableBefore(record: PredictionRecord, cutoff: number): boolean {
  const evidence = record.resolutionProvenance?.evidence;
  if (!evidence) return true;
  if (evidence.length === 0) return false;
  return evidence.every((e) => Number.isFinite(e.observedAt) && e.observedAt < cutoff);
}

/** ACC-301's leakage filter, narrowed to the target's own key. */
function usablePriorResolutions(
  target: PredictionRecord,
  history: readonly PredictionRecord[],
): PredictionRecord[] {
  const cutoff = target.predictedAt;
  return history.filter((r) => {
    if (r.targetKey !== target.targetKey) return false;
    if (isBaselineSourceId(r.sourceId)) return false;
    if (resolvedOutcome(r) === null) return false;
    if (isProxyResolution(r)) return false;
    if (!Number.isFinite(r.predictedAt) || !Number.isFinite(r.resolveBy)) return false;
    if (r.resolveBy <= r.predictedAt) return false;
    if (r.predictedAt >= cutoff) return false;
    if (r.resolvedAt === undefined || !Number.isFinite(r.resolvedAt)) return false;
    if (r.resolvedAt < r.predictedAt || r.resolvedAt >= cutoff) return false;
    return evidenceAvailableBefore(r, cutoff);
  });
}

export function estimatePersistenceBaseline(
  target: PredictionRecord,
  history: readonly PredictionRecord[],
): PersistenceBaselineEstimate | null {
  if (target.status !== 'pending') return null;
  if (!target.targetKey) return null;
  if (isBaselineSourceId(target.sourceId)) return null;
  if (!Number.isFinite(target.predictedAt) || !Number.isFinite(target.resolveBy)) return null;
  if (target.resolveBy <= target.predictedAt) return null;
  if (!isStateLikeTarget(target)) return null;

  // ACC-301's window dedup: multiple forecasts on the same resolveBy
  // window are ONE observation, and a window whose records disagree on
  // the outcome is dropped entirely. Five same-window forecasts must
  // not count as five outcomes.
  const byWindow = new Map<number, { record: PredictionRecord; outcome: boolean } | null>();
  for (const r of usablePriorResolutions(target, history)) {
    const outcome = resolvedOutcome(r)!;
    const existing = byWindow.get(r.resolveBy);
    if (existing === undefined) {
      byWindow.set(r.resolveBy, { record: r, outcome });
    } else if (existing !== null && existing.outcome !== outcome) {
      byWindow.set(r.resolveBy, null);
    }
  }
  const usable = [...byWindow.values()]
    .filter((e): e is { record: PredictionRecord; outcome: boolean } => e !== null)
    .sort((a, b) => b.record.resolvedAt! - a.record.resolvedAt!)
    .slice(0, RECENT_WINDOW);
  if (usable.length === 0) return null;

  const trues = usable.filter((e) => e.outcome).length;
  // Laplace smoothing: never certain, converges with evidence.
  const probability = (trues + 1) / (usable.length + 2);
  return { probability, sampleCount: usable.length };
}

export function buildPersistenceBaselinePrediction(
  target: PredictionRecord,
  history: readonly PredictionRecord[],
): PredictionRecord | null {
  const estimate = estimatePersistenceBaseline(target, history);
  if (!estimate) return null;
  return {
    ...target,
    id: `persistence:${fnv1a64([
      target.targetKey!,
      target.domain,
      String(target.predictedAt),
      String(target.resolveBy),
    ].join('\u0000'))}`,
    sourceId: PERSISTENCE_BASELINE_SOURCE_ID,
    probability: estimate.probability,
    algorithmVersion: PERSISTENCE_BASELINE_VERSION,
  };
}

export {PERSISTENCE_BASELINE_SOURCE_ID} from './baseline-model-ids';