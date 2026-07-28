/**
 * Forecast calibration adapter.
 *
 * Wraps the ForecastCalibrationStore singleton and exposes two APIs:
 *
 *   getBoostMultiplier() — kept for back-compat; returns the legacy global
 *     Brier-derived multiplier. Consumers should migrate to getRecalibrator().
 *
 *   getRecalibrator(domain?) — returns a closure over the freshest per-domain
 *     (or global) reliability curve, rebuilt lazily at most every 10 minutes.
 *     Curves are persisted via reasoning-memory under 'crystalball-cognition-curves'.
 *
 * Lazy rebuild strategy: curves are expensive to build from scratch on every
 * call, but also should not be stale for arbitrarily long. The 10-minute TTL
 * is a pragmatic balance (analyst cycle is 5 min; curves are thus at most
 * ~2 cycles behind). On first call curves are built immediately.
 *
 * Persistence: curves survive page reloads via reasoning-memory IDB store.
 * On startup, the cached curves are loaded; any domain not yet in the cache
 * falls back to the global curve or identity.
 */

import {
  brierScore,
  createForecastCalibrationStore,
  perDomainAccuracy,
} from './forecast-calibration';
import type {
  ForecastCalibrationStore,
  PredictionRecord,
  ResolutionMetadata,
} from './forecast-calibration';
import {
  buildCurve,
  pooledCurve,
  identityCurve,
  recalibrate,
  MIN_DOMAIN_N,
  MIN_GLOBAL_N,
} from '@/services/cognition/recalibration';
import type { ReliabilityCurve, RecalibrationResult } from '@/services/cognition/recalibration';
import type { FactDomain } from './types';
import { getMemory as idbGetMemory, putMemory as idbPutMemory } from '@/services/reasoning-memory';
import {
  runOutcomeResolvers,
  type OutcomeResolver,
  type ResolverContext,
} from './outcome-resolvers';
import {
  ensureForecastEvaluation,
  gradeForecastOutcome,
  syncForecastEvaluations,
} from '@/services/algorithms/forecast-outcome-grading';
import { buildHierarchicalBaseRatePrediction } from './hierarchical-base-rate';
import { buildPersistenceBaselinePrediction } from './persistence-baseline';
import {
  buildMomentumBaselinePrediction,
  type MomentumSample,
} from './momentum-baseline';
import { getSpotPriceHistory } from '@/services/market/spot-price-store';

// ── Calibration store singleton ───────────────────────────────────────────────

let _calibrationStore: ForecastCalibrationStore | null = null;

const STORAGE_KEY = 'crystalball-forecast-calibration-v1';
const MAX_RECORDS = 500;

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

export function getCalibrationStore(): ForecastCalibrationStore {
  if (!_calibrationStore) {
    _calibrationStore = createForecastCalibrationStore();
    loadPersisted(_calibrationStore);
  }
  return _calibrationStore;
}

/** Lookback the momentum baseline's spot-price accessor covers. Matches
 *  the model's own LOOKBACK_MS window so no extra data is fetched. */
const MOMENTUM_ACCESSOR_LOOKBACK_MS = 6 * 3_600_000;

/** Pre-forecast price samples for a market_move target, bounded at the
 *  prediction time — the model re-filters, but the accessor never even
 *  fetches post-cutoff samples (ACC-302 lookahead discipline). */
function momentumSamplesFor(p: PredictionRecord): MomentumSample[] {
  if (p.criteria?.kind !== 'market_move') return [];
  try {
    return getSpotPriceHistory(p.criteria.symbol, {
      sinceExclusive: p.predictedAt - MOMENTUM_ACCESSOR_LOOKBACK_MS,
      untilInclusive: p.predictedAt,
    }).map((o) => ({ observedAt: o.observedAt, price: o.price }));
  } catch {
    return [];
  }
}

/** Fire-and-forget ACC-303 pairing push — lazy import breaks the
 *  adapter ↔ shadow-rollout store cycle. The import promise is memoized
 *  so only the FIRST push races module loading; pairs are best-effort
 *  telemetry (ACC-401's authoritative joins re-derive from the
 *  calibration store), so a lost boot-window pair is acceptable and a
 *  failed chunk load is silent by design. */
let _shadowRolloutModule: Promise<typeof import('@/services/cognition/shadow-rollout')> | null = null;

function shadowRolloutModule(): Promise<typeof import('@/services/cognition/shadow-rollout')> {
  _shadowRolloutModule ??= import('@/services/cognition/shadow-rollout');
  return _shadowRolloutModule;
}

function pushBaselinePairs(production: PredictionRecord, baselines: readonly PredictionRecord[]): void {
  if (baselines.length === 0 || !production.targetKey) return;
  void shadowRolloutModule()
    .then((m) => {
      for (const baseline of baselines) {
        m.pushBaselinePair(
          {
            targetKey: production.targetKey!,
            predictedAt: production.predictedAt,
            resolveBy: production.resolveBy,
            productionSourceId: production.sourceId,
            productionVersion: production.algorithmVersion,
            baselineSourceId: baseline.sourceId,
            baselineVersion: baseline.algorithmVersion,
          },
          production.probability,
          baseline.probability,
        );
      }
    })
    .catch(() => { /* pairing telemetry is best-effort */ });
}

/** ACC-301/ACC-302 baseline family — ordered; each returns null when
 *  not applicable to the target (the roadmap's `not_applicable`). */
function buildBaselinePredictions(
  p: PredictionRecord,
  history: readonly PredictionRecord[],
): PredictionRecord[] {
  const baselines: PredictionRecord[] = [];
  const hierarchical = buildHierarchicalBaseRatePrediction(p, history);
  if (hierarchical) baselines.push(hierarchical);
  const persistence = buildPersistenceBaselinePrediction(p, history);
  if (persistence) baselines.push(persistence);
  const momentum = buildMomentumBaselinePrediction(p, momentumSamplesFor(p));
  if (momentum) baselines.push(momentum);
  return baselines;
}

/** For each applicable baseline: reuse the stored record when the id
 *  already exists (a second producer on the same target/window still
 *  gets its pair against the EXISTING baseline), record it otherwise.
 *  Returns both the newly recorded set (for evaluations) and the full
 *  pairable set (for ACC-303 shadow pairs). Exported for tests. */
export function collectBaselines(
  store: ForecastCalibrationStore,
  p: PredictionRecord,
  history: readonly PredictionRecord[],
): { recorded: PredictionRecord[]; pairable: PredictionRecord[] } {
  const recorded: PredictionRecord[] = [];
  const pairable: PredictionRecord[] = [];
  for (const baseline of buildBaselinePredictions(p, history)) {
    const existing = store.get(baseline.id);
    if (existing) {
      pairable.push(existing);
      continue;
    }
    store.record(baseline);
    recorded.push(baseline);
    pairable.push(baseline);
  }
  return { recorded, pairable };
}

/** Record + persist in one call. */
export function recordPrediction(p: PredictionRecord): void {
  const store = getCalibrationStore();
  store.record(p);
  // One snapshot serves every baseline builder (store.all clones).
  const history = store.all();
  const { recorded, pairable } = collectBaselines(store, p, history);
  persist(store);
  ensureForecastEvaluation(p);
  for (const baseline of recorded) ensureForecastEvaluation(baseline);
  pushBaselinePairs(p, pairable);
}

/** Record a snapshot batch and persist once. Two passes so baseline
 *  emission is INDEPENDENT of batch order: every production record
 *  lands first, then each baseline builds against the full post-batch
 *  snapshot (the estimators' own predictedAt cutoffs keep temporal
 *  correctness — a batch-mate from the future never enters training). */
export function recordPredictions(predictions: readonly PredictionRecord[]): void {
  if (predictions.length === 0) return;
  const store = getCalibrationStore();
  for (const prediction of predictions) {
    store.record(prediction);
    ensureForecastEvaluation(prediction);
  }
  const history = store.all();
  for (const prediction of predictions) {
    const { recorded, pairable } = collectBaselines(store, prediction, history);
    for (const baseline of recorded) ensureForecastEvaluation(baseline);
    pushBaselinePairs(prediction, pairable);
  }
  persist(store);
}

/** Resolve + persist. Returns false when the id is unknown/already resolved. */
export function resolvePrediction(
  id: string,
  outcome: boolean,
  when?: number,
  metadata?: ResolutionMetadata,
): boolean {
  const store = getCalibrationStore();
  const ok = store.resolve(id, outcome, when, metadata);
  if (ok) {
    persist(store);
    const resolved = store.get(id);
    if (resolved) gradeForecastOutcome(resolved);
  }
  return ok;
}

/** Expire one prediction with a resolver note and persist it. */
export function expirePrediction(
  id: string,
  when?: number,
  note?: string,
): boolean {
  const store = getCalibrationStore();
  const ok = store.expire(id, when, note);
  if (ok) persist(store);
  return ok;
}

/** Expire overdue pending predictions + persist. Returns expired count. */
export function expirePendingPredictions(now?: number): number {
  const store = getCalibrationStore();
  const n = store.expirePending(now);
  if (n > 0) persist(store);
  return n;
}

/** Run pure outcome resolvers against the singleton and durably flush every
 *  resulting resolution or resolver-owned expiry before returning. */
export function dispatchOutcomeResolvers(
  context: ResolverContext,
  resolvers: readonly OutcomeResolver[],
): number {
  const store = getCalibrationStore();
  const resolved = runOutcomeResolvers(store, context, resolvers);
  persist(store);
  syncForecastEvaluations(store.all());
  return resolved;
}

const MIN_RESOLVED_FOR_DOMAIN_MULT = 10;

/** Per-domain ranking multiplier in [0.7, 1.2] derived from Brier score.
 *  Neutral until ≥10 resolved predictions exist — never punish a cold start. */
export function getDomainCalibrationMult(domain: FactDomain): number {
  const records = getCalibrationStore().all().filter((r) => r.domain === domain);
  const resolved = records.filter(
    (r) => r.status === 'resolved_true' || r.status === 'resolved_false',
  );
  if (resolved.length < MIN_RESOLVED_FOR_DOMAIN_MULT) return 1;
  const acc = perDomainAccuracy(resolved).find((d) => d.domain === domain);
  if (!acc) return 1;
  // brier 0 → 1.2, brier 0.25 → 1.0, brier ≥0.625 → 0.7
  return Math.max(0.7, Math.min(1.2, 1.2 - 0.8 * acc.brier));
}

// ── Legacy boost multiplier (back-compat) ─────────────────────────────────────

/**
 * @deprecated Prefer getRecalibrator(domain) for per-domain recalibration.
 *
 * Returns a global Brier-derived multiplier in [0.4, 1.2]. Still used by
 * the legacy path in hypothesis-forecast.ts until fully superseded.
 */
export function getBoostMultiplier(): number {
  const store = getCalibrationStore();
  const records = store.all();
  const resolvedRecs = records.filter(r => r.status === 'resolved_true' || r.status === 'resolved_false');
  if (resolvedRecs.length < 5) return 1;
  const result = brierScore(resolvedRecs);
  if (result.score <= 0.1) return 1.2;
  if (result.score <= 0.2) return 1;
  if (result.score <= 0.3) return 0.7;
  return 0.4;
}

export function _resetCalibrationForTests(): void { _calibrationStore = null; }

// ── Curve cache ───────────────────────────────────────────────────────────────

/** Rebuild curves at most once per CURVE_TTL_MS (10 minutes). */
const CURVE_TTL_MS = 10 * 60 * 1000;

/** In-memory curve store: domain → curve. 'global' key = pooled global curve. */
const _curveCache = new Map<string, ReliabilityCurve>();
let _lastBuiltAt = 0;

/** IDB/LS key for curve persistence. */
const CURVES_STORAGE_KEY = 'crystalball-cognition-curves';

// Lazy IDB references (same pattern as episodic-memory.ts — injectable for tests).
let _getMemory: (<T>(key: string) => Promise<T | null>) | null = null;
let _putMemory: (<T>(key: string, value: T) => Promise<void>) | null = null;

function lazyLoadIdb(): void {
  if (_getMemory !== null) return;
  _getMemory = idbGetMemory;
  _putMemory = idbPutMemory;
}

/** Persist the current curve cache to IDB. Fire-and-forget. */
function persistCurves(): void {
  const snapshot = Object.fromEntries(_curveCache.entries()) as Record<string, ReliabilityCurve>;
  lazyLoadIdb();
  void _putMemory!(CURVES_STORAGE_KEY, snapshot);
}

/** Load curves from IDB on first call (async bootstrap). */
let _bootstrapped = false;
function bootstrapFromIdb(): void {
  if (_bootstrapped) return;
  _bootstrapped = true;
  lazyLoadIdb();
  void _getMemory!<Record<string, ReliabilityCurve>>(CURVES_STORAGE_KEY).then(stored => {
    if (!stored || typeof stored !== 'object') return;
    // Only load if we haven't already rebuilt since boot.
    if (_lastBuiltAt > 0) return;
    for (const [key, curve] of Object.entries(stored)) {
      if (isCurveShape(curve)) _curveCache.set(key, curve);
    }
  });
}

function isCurveShape(v: unknown): v is ReliabilityCurve {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return Array.isArray(c.bins) && typeof c.sampleSize === 'number';
}

// ── Curve rebuild ─────────────────────────────────────────────────────────────

/** All FactDomain values known to the calibration store. */
const ALL_DOMAINS: readonly FactDomain[] = [
  'weather', 'cyber', 'aviation', 'maritime', 'markets',
  'conflict', 'humanitarian', 'space', 'infra', 'macro', 'other',
];

function rebuildCurves(): void {
  const store = getCalibrationStore();
  const records = store.all();
  _curveCache.clear();

  const domainCurves: ReliabilityCurve[] = [];

  for (const domain of ALL_DOMAINS) {
    const domainResolved = records.filter(
      r => r.domain === domain && (r.status === 'resolved_true' || r.status === 'resolved_false'),
    );
    if (domainResolved.length >= MIN_DOMAIN_N) {
      const curve = buildCurve(records, domain);
      _curveCache.set(domain, curve);
      domainCurves.push(curve);
    }
  }

  // Build global curve from all resolved records.
  const allResolved = records.filter(
    r => r.status === 'resolved_true' || r.status === 'resolved_false',
  );
  if (allResolved.length >= MIN_GLOBAL_N) {
    const global = domainCurves.length > 0
      ? pooledCurve(domainCurves)
      : buildCurve(records);
    _curveCache.set('global', global);
  }

  _lastBuiltAt = Date.now();
  persistCurves();
}

function maybeRebuild(): void {
  bootstrapFromIdb();
  const now = Date.now();
  if (now - _lastBuiltAt >= CURVE_TTL_MS) {
    rebuildCurves();
  }
}

// ── getRecalibrator ───────────────────────────────────────────────────────────

/**
 * Returns a recalibration closure for the given domain (or global if omitted).
 *
 * The closure captures the freshest available curve at call time (rebuilt lazily
 * at most every 10 minutes). Curve selection follows the fallback ladder:
 *   1. Per-domain curve if n ≥ MIN_DOMAIN_N.
 *   2. Global pooled curve if n ≥ MIN_GLOBAL_N.
 *   3. Identity (adjustment = 0, explanation notes insufficient history).
 *
 * @example
 * const recalibrator = getRecalibrator('finance');
 * const { p, adjustment, explanation } = recalibrator(0.7);
 * // → { p: 0.58, adjustment: -0.12,
 * //     explanation: "finance forecasts at ~70% have materialized 54% of the time (n=41) → adjusted to 58%" }
 */
export function getRecalibrator(domain?: FactDomain): (p: number) => RecalibrationResult {
  maybeRebuild();

  let curve: ReliabilityCurve | undefined;
  if (domain !== undefined) {
    curve = _curveCache.get(domain);
  }
  curve ??= _curveCache.get('global');
  // Identity: no data yet.
  curve ??= identityCurve(domain ?? 'global');

  // Capture curve at closure-creation time.
  const capturedCurve = curve;
  return (p: number) => recalibrate(p, capturedCurve);
}

// ── Test helpers (injectable) ─────────────────────────────────────────────────

/**
 * Override the IDB functions for tests. Pass null to disable persistence.
 * Must be called before any curve operations in the test.
 */
export function _configureAdapterForTests(opts: {
  getMemoryFn?: <T>(key: string) => Promise<T | null>;
  putMemoryFn?: <T>(key: string, value: T) => Promise<void>;
}): void {
  _getMemory = opts.getMemoryFn ?? (() => Promise.resolve(null));
  _putMemory = opts.putMemoryFn ?? (() => Promise.resolve());
  _bootstrapped = true; // Skip the async bootstrap in tests.
}

/** Reset curve cache for test isolation. */
export function _resetAdapterForTests(): void {
  _curveCache.clear();
  _lastBuiltAt = 0;
  _bootstrapped = false;
  _getMemory = null;
  _putMemory = null;
}

/** Force an immediate curve rebuild (for tests that populate the store). */
export function _rebuildCurvesForTests(): void {
  rebuildCurves();
}
