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
  perSourceMultipliers,
  type SourceMultiplier,
  type ForecastCalibrationStore,
  type PredictionRecord,
} from '../intelligence/forecast-calibration';
import type { CorrelatedPair } from '../intelligence/correlate-engine';
import { getCorrelationRegime } from '../cognition/regime-monitor';
import type { CorrelationRegime } from '../cognition/regime-scan';
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

export const MIN_REGIME_RESOLVED = 5;

interface RuleCohorts { overall: SourceMultiplier; calm: SourceMultiplier; shifted: SourceMultiplier }

export interface CorrelationReliabilityDiagnostics extends RuleCohorts {
  currentRegime: CorrelationRegime | undefined;
  selected: CorrelationRegime | 'pooled' | 'neutral';
  reason: 'regime' | 'sparse-regime' | 'unknown-regime' | 'insufficient-outcomes';
  multiplier: number;
}

let reliabilityCache: { at: number; revision: number; nextOutcomeAt: number; byRule: Map<string, RuleCohorts> } | null = null;

function emptyScore(sourceId: string): SourceMultiplier {
  return { sourceId, predictionCount: 0, resolvedCount: 0, brier: 0, multiplier: 1 };
}

function refreshReliability(now: number): Map<string, RuleCohorts> {
  const store = getCorrelationCalibrationStore();
  if (reliabilityCache && Number.isFinite(now) && now >= reliabilityCache.at
    && now - reliabilityCache.at < RELIABILITY_CACHE_TTL_MS
    && now < reliabilityCache.nextOutcomeAt && store.revision() === reliabilityCache.revision) return reliabilityCache.byRule;
  let nextOutcomeAt = Infinity;
  const eligible = store.all().filter((r) => {
    if (!r.sourceId.startsWith(CORR_RULE_SOURCE_PREFIX) || !Number.isFinite(now) || now <= 0) return false;
    const availableAt = Math.max(r.predictedAt, Number.isFinite(r.resolvedAt) ? r.resolvedAt! : 0);
    if (availableAt > now) { nextOutcomeAt = Math.min(nextOutcomeAt, availableAt); return false; }
    return true;
  });
  const byRule = new Map<string, RuleCohorts>();
  for (const overall of perSourceMultipliers(eligible, { minResolvedForMultiplier: MIN_REGIME_RESOLVED })) {
    byRule.set(overall.sourceId.slice(CORR_RULE_SOURCE_PREFIX.length), {
      overall, calm: emptyScore(overall.sourceId), shifted: emptyScore(overall.sourceId),
    });
  }
  for (const regime of ['calm', 'shifted'] as const) {
    const tagged = eligible.filter((r) => r.outcomeRegime === regime);
    for (const score of perSourceMultipliers(tagged, { minResolvedForMultiplier: MIN_REGIME_RESOLVED })) {
      byRule.get(score.sourceId.slice(CORR_RULE_SOURCE_PREFIX.length))![regime] = score;
    }
  }
  reliabilityCache = { at: now, revision: store.revision(), nextOutcomeAt, byRule };
  return byRule;
}

export function reliabilityDiagnosticsForRule(ruleId: string, now: number = Date.now()): CorrelationReliabilityDiagnostics {
  const sourceId = `${CORR_RULE_SOURCE_PREFIX}${ruleId}`;
  const cohorts = refreshReliability(now).get(ruleId)
    ?? { overall: emptyScore(sourceId), calm: emptyScore(sourceId), shifted: emptyScore(sourceId) };
  const currentRegime = getCorrelationRegime(now);
  const preferred = currentRegime ? cohorts[currentRegime] : undefined;
  const enoughOverall = cohorts.overall.resolvedCount >= MIN_REGIME_RESOLVED;
  const enoughRegime = preferred && preferred.resolvedCount >= MIN_REGIME_RESOLVED;
  let selected: CorrelationReliabilityDiagnostics['selected'] = 'neutral';
  let reason: CorrelationReliabilityDiagnostics['reason'] = 'insufficient-outcomes';
  let multiplier = cohorts.overall.multiplier;
  if (enoughRegime) {
    selected = currentRegime!;
    reason = 'regime';
    multiplier = preferred.multiplier;
  } else if (enoughOverall) {
    selected = 'pooled';
    reason = currentRegime ? 'sparse-regime' : 'unknown-regime';
  }
  return {
    overall: { ...cohorts.overall }, calm: { ...cohorts.calm }, shifted: { ...cohorts.shifted }, currentRegime,
    selected, reason, multiplier,
  };
}

/** Regime-conditional reliability after five tagged outcomes; sparse or unknown regimes retain the pooled score. */
export function reliabilityForRule(ruleId: string, now: number = Date.now()): number {
  return reliabilityDiagnosticsForRule(ruleId, now).multiplier;
}

function outcomeRegime(when: number): CorrelationRegime | undefined {
  return when <= Date.now() ? getCorrelationRegime(when) : undefined;
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
export function resolvedCountForRule(ruleId: string, now: number = Date.now()): number {
  return refreshReliability(now).get(ruleId)?.overall.resolvedCount ?? 0;
}

/** Resolve one prediction by id (used by non-situation producers such
 *  as the alert-correlator island) — persists and refreshes reliability. */
export function resolveCalibrationPrediction(
  id: string,
  outcome: boolean,
  when: number = Date.now(),
): boolean {
  const store = getCorrelationCalibrationStore();
  const ok = store.resolve(id, outcome, when, undefined, outcomeRegime(when));
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
  const regime = outcomeRegime(now);
  for (const r of store.all()) {
    if (r.status !== 'pending') continue;
    const outcome = assessPairOutcome(r.id, lites);
    if (outcome === null) continue;
    if (store.resolve(r.id, outcome, now, undefined, regime)) resolved += 1;
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
