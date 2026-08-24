/**
 * Correlation calibration — the stateful adapter that closes the loop
 * between the correlate stage and the calibration spine.
 *
 * Owns a DEDICATED ForecastCalibrationStore instance (own persist key,
 * own cap) so correlation volume never crowds the shared forecast
 * singleton. Per-rule reliability multipliers fall out of the existing
 * pure perSourceMultipliers math (rule-as-source), and are injected back
 * into the live CorrelateEngine via SituationStoreV2's provider seam.
 *
 * See docs/CORRELATION_NEXTGEN_PLAN.md §D3 / PR 2.
 */

import {
  createForecastCalibrationStore,
  type ForecastCalibrationStore,
  type PredictionRecord,
} from '../intelligence/forecast-calibration';
import type { CorrelatedPair } from '../intelligence/correlate-engine';
import type { Situation } from '../intelligence/situation-store-v2';
import { getSituationStoreV2 } from '../intelligence/situation-store-v2';
import {
  assessPairOutcome,
  buildPairPrediction,
  CORR_RULE_SOURCE_PREFIX,
  shouldRecordPair,
  type SituationLite,
} from './correlation-outcomes';

const STORAGE_KEY = 'crystalball-correlation-calibration-v1';
const MAX_RECORDS = 400;
const RELIABILITY_CACHE_TTL_MS = 60_000;
const RESOLVE_THROTTLE_MS = 60_000;

let _store: ForecastCalibrationStore | null = null;

function loadPersisted(store: ForecastCalibrationStore): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) store.loadJson(parsed as PredictionRecord[]);
  } catch { /* corrupted store — start fresh */ }
}

function persist(store: ForecastCalibrationStore): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const all = store.all().sort((a, b) => a.predictedAt - b.predictedAt);
    const trimmed = all.slice(Math.max(0, all.length - MAX_RECORDS));
    if (trimmed.length < all.length) store.loadJson(trimmed);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch { /* quota — calibration is best-effort */ }
}

export function getCorrelationCalibrationStore(): ForecastCalibrationStore {
  if (!_store) {
    _store = createForecastCalibrationStore();
    loadPersisted(_store);
  }
  return _store;
}

/** Test hook — drop the singleton (and cached multipliers). */
export function resetCorrelationCalibration(): void {
  _store = null;
  reliabilityCache = null;
}

/** Record one emitted pair as a pending prediction, subject to per-rule
 *  flood control. Returns true when a record was actually added. */
export function recordPairPrediction(pair: CorrelatedPair, now: number = Date.now()): boolean {
  const store = getCorrelationCalibrationStore();
  if (store.get(buildPairPrediction(pair, now).id)) return false;
  if (!shouldRecordPair(store.all(), pair.ruleId, now)) return false;
  store.record(buildPairPrediction(pair, now));
  persist(store);
  reliabilityCache = null;
  return true;
}

// ── Per-rule reliability ─────────────────────────────────────────────────

let reliabilityCache: { at: number; byRule: Map<string, number> } | null = null;

/** Learned reliability multiplier for a correlation rule, in [0.5, 1.5].
 *  Neutral 1.0 until the rule has ≥5 resolved outcomes. Cached 60 s. */
export function reliabilityForRule(ruleId: string, now: number = Date.now()): number {
  if (!reliabilityCache || now - reliabilityCache.at > RELIABILITY_CACHE_TTL_MS) {
    const byRule = new Map<string, number>();
    for (const m of getCorrelationCalibrationStore().bySource()) {
      if (m.sourceId.startsWith(CORR_RULE_SOURCE_PREFIX)) {
        byRule.set(m.sourceId.slice(CORR_RULE_SOURCE_PREFIX.length), m.multiplier);
      }
    }
    reliabilityCache = { at: now, byRule };
  }
  return reliabilityCache.byRule.get(ruleId) ?? 1;
}

/** Expire overdue pending predictions — persists and refreshes
 *  reliability. Safe to call from any producer's cadence. */
export function expireCalibrationPredictions(now: number = Date.now()): number {
  const store = getCorrelationCalibrationStore();
  const expired = store.expirePending(now);
  if (expired > 0) {
    persist(store);
    reliabilityCache = null;
  }
  return expired;
}

/** Resolved-outcome count for one rule — lets callers gate on whether
 *  ledger evidence exists before trusting the multiplier. */
export function resolvedCountForRule(ruleId: string): number {
  const sourceId = `${CORR_RULE_SOURCE_PREFIX}${ruleId}`;
  let n = 0;
  for (const r of getCorrelationCalibrationStore().all()) {
    if (r.sourceId === sourceId && (r.status === 'resolved_true' || r.status === 'resolved_false')) n += 1;
  }
  return n;
}

/** Resolve one prediction by id (used by non-situation producers such
 *  as the alert-correlator island) — persists and refreshes reliability. */
export function resolveCalibrationPrediction(
  id: string,
  outcome: boolean,
  when: number = Date.now(),
): boolean {
  const store = getCorrelationCalibrationStore();
  const ok = store.resolve(id, outcome, when);
  if (ok) {
    persist(store);
    reliabilityCache = null;
  }
  return ok;
}

/** Record an arbitrary prediction (id/sourceId chosen by the caller) —
 *  persists and refreshes reliability. Skips duplicates. */
export function recordCalibrationPrediction(prediction: PredictionRecord): boolean {
  const store = getCorrelationCalibrationStore();
  if (store.get(prediction.id)) return false;
  store.record(prediction);
  persist(store);
  reliabilityCache = null;
  return true;
}

// ── Resolution ───────────────────────────────────────────────────────────

function toLite(situations: readonly Situation[]): SituationLite[] {
  return situations.map((s) => ({
    observationIds: s.observations.map((o) => o.id),
    edgeCount: s.edges.length,
    status: s.status,
  }));
}

/** Assess every pending pair prediction against current situations;
 *  resolve the decided ones and expire the overdue. Returns counts. */
export function resolvePairPredictions(
  situations: readonly Situation[],
  now: number = Date.now(),
): { resolved: number; expired: number } {
  const store = getCorrelationCalibrationStore();
  const lites = toLite(situations);
  let resolved = 0;
  for (const r of store.all()) {
    if (r.status !== 'pending') continue;
    const outcome = assessPairOutcome(r.id, lites);
    if (outcome === null) continue;
    if (store.resolve(r.id, outcome, now)) resolved += 1;
  }
  const expired = store.expirePending(now);
  if (resolved > 0 || expired > 0) {
    persist(store);
    reliabilityCache = null;
  }
  return { resolved, expired };
}

// ── Live wiring ──────────────────────────────────────────────────────────

let started = false;

/** Wire the correlation calibration loop into the live situation store:
 *  new pairs are recorded as predictions, the engine's confidence starts
 *  consulting per-rule reliability, and situation updates drive a
 *  throttled resolution pass. Idempotent. Returns a cleanup function. */
export function startCorrelationCalibration(
  store = getSituationStoreV2(),
): () => void {
  if (started) return noop;
  started = true;
  store.setReliabilityProvider((ruleId) => reliabilityForRule(ruleId));
  store.setPairListener((pairs) => {
    for (const p of pairs) recordPairPrediction(p);
  });
  let lastResolveAt = 0;
  const unsubscribe = store.subscribeMutations(() => {
    const now = Date.now();
    if (now - lastResolveAt < RESOLVE_THROTTLE_MS) return;
    lastResolveAt = now;
    resolvePairPredictions(store.list(), now);
  });
  return () => {
    started = false;
    store.setReliabilityProvider();
    store.setPairListener();
    unsubscribe();
  };
}

function noop(): void {
  // second start is a no-op; nothing to clean up
}
