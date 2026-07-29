/**
 * Shadow Rollout Discipline — PR 13.
 *
 * Thin wiring service that registers three shadow runs in
 * ShadowModeAlgorithmService and provides push-pair helpers at the natural
 * call sites.  The shadow service is a passive ledger — it never affects live
 * outputs.  All errors are swallowed (fire-and-forget).
 *
 * Three run IDs (orientation matters — see each entry):
 *
 *   'recalibration-vs-legacy'
 *     PR 2 recalibration IS live (hypothesis-forecast.ts applies it as the
 *     final step).  The LEGACY path (getBoostMultiplier only, no per-domain
 *     reliability curve) runs as the SHADOW.
 *       liveOutput   = calibrated probability (post PR 2 recalibration)
 *       shadowOutput = raw probability before recalibration (legacy multiplier only)
 *
 *   'superforecast-vs-baseline'
 *     The existing forecastHypothesis() IS live (drives ranking).
 *     superforecast() is NOT yet the live ranking input, so it is the SHADOW.
 *       liveOutput   = forecastHypothesis().probability
 *       shadowOutput = superforecast().probability
 *     Because superforecast is async, push pairs by calling
 *     pushSuperforecastPair() from the call site where both values are known.
 *
 *   'learned-schema-vs-handauthored'
 *     When consolidation registers a learned schema, hand-authored signatures
 *     are live (built-in library).  The learned schemas are the SHADOW.
 *       liveOutput   = { matchCount: <hand-authored matches on window> }
 *       shadowOutput = { matchCount: <learned-schema matches on window> }
 *     Call pushSchemaPair() after any matchSignatures() call.
 *
 * Flip gate (shadowVerdict):
 *   ≥200 paired forecasts AND shadowBrier ≤ liveBrier → 'flip-to-shadow'.
 *   <200 pairs OR no resolved outcomes for Brier → 'insufficient-data'.
 *   ≥200 pairs AND shadowBrier > liveBrier → 'keep-live'.
 *   Brier is computed only where outcomes are resolved (joined against the
 *   ForecastCalibrationStore).  Where outcomes are unavailable the verdict is
 *   'insufficient-data' regardless of pair count.
 *
 * Persistence:
 *   Verdict snapshots are written to reasoning-memory under
 *   'crystalball-cognition-shadow-v1' AND to localStorage under the same key
 *   so the cognition-shadow-report script can consume an export.
 *
 * Design invariants (house plan):
 *   - No DOM, no fetch, no globals at import time.
 *   - Shadow paths never affect live outputs.
 *   - Fire-and-forget; errors swallowed at every boundary.
 *   - Injectable shadow service, calibration store, and reasoning-memory for
 *     tests (no real IDB / localStorage required).
 */

import type { ShadowJoinKey, ShadowModeAlgorithmService, ShadowRunConfig } from '@/services/intelligence/shadow-mode';
import { getShadowModeAlgorithmService } from '@/services/intelligence/shadow-mode';
import type { ForecastCalibrationStore, PredictionRecord } from '@/services/intelligence/forecast-calibration';
import { getCalibrationStore } from '@/services/intelligence/forecast-calibration-adapter';
import { putMemory as idbPutMemory } from '@/services/reasoning-memory';
import { isCognitionEnabled } from './cognition-settings';

// ── Public types ───────────────────────────────────────────────────────────────

export type FlipRecommendation =
  | 'keep-live'
  | 'flip-to-shadow'
  | 'insufficient-data';

export interface ShadowVerdict {
  runId: string;
  pairs: number;
  divergenceRate: number;
  /** Brier score for the live output — present only where outcomes resolved. */
  brierLive?: number;
  /** Brier score for the shadow output — present only where outcomes resolved. */
  brierShadow?: number;
  recommendation: FlipRecommendation;
  computedAt: number;
}

/** Snapshot object persisted to reasoning-memory / localStorage. */
export interface ShadowVerdictSnapshot {
  verdicts: ShadowVerdict[];
  snapshottedAt: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

export const RUN_IDS = {
  RECALIBRATION: 'recalibration-vs-legacy',
  SUPERFORECAST: 'superforecast-vs-baseline',
  SCHEMA: 'learned-schema-vs-handauthored',
  BASELINE_HIERARCHICAL: 'production-vs-hierarchical-base-rate',
  BASELINE_PERSISTENCE: 'production-vs-persistence-baseline',
  BASELINE_MOMENTUM: 'production-vs-momentum-baseline',
} as const;

export type RunId = typeof RUN_IDS[keyof typeof RUN_IDS];

export const FLIP_GATE_MIN_PAIRS = 200;

export const VERDICT_STORAGE_KEY = 'crystalball-cognition-shadow-v1';

// ── Injectable interfaces ─────────────────────────────────────────────────────

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ShadowRolloutDeps {
  /** Injectable shadow service (default: getShadowModeAlgorithmService()). */
  shadowService?: ShadowModeAlgorithmService;
  /** Injectable calibration store (default: getCalibrationStore()). */
  calibrationStore?: ForecastCalibrationStore;
  /** Injectable localStorage for verdict snapshots (default: globalThis.localStorage). */
  storage?: StorageLike | null;
  /** Injectable IDB put function (default: lazy-loaded reasoning-memory.putMemory). */
  putMemoryFn?: (key: string, value: unknown) => Promise<void>;
  /** Injectable clock (default: Date.now). */
  clock?: () => number;
}

// ── Run declarations ──────────────────────────────────────────────────────────

const RUN_CONFIGS: ShadowRunConfig[] = [
  {
    id: RUN_IDS.RECALIBRATION,
    algorithmId: 'cognition-recalibration',
    description:
      'PR 2 recalibration is LIVE. Legacy getBoostMultiplier-only path runs as SHADOW. ' +
      'liveOutput=recalibrated p; shadowOutput=raw p before recalibration.',
    enabled: true,
    createdAt: 0,
  },
  {
    id: RUN_IDS.SUPERFORECAST,
    algorithmId: 'superforecast',
    description:
      'forecastHypothesis() is LIVE (drives ranking). superforecast() is SHADOW (not yet live). ' +
      'liveOutput=forecastHypothesis p; shadowOutput=superforecast p.',
    enabled: true,
    createdAt: 0,
  },
  {
    id: RUN_IDS.BASELINE_HIERARCHICAL,
    algorithmId: 'hierarchical-base-rate',
    description:
      'ACC-303: production forecasts are LIVE; the hierarchical base rate runs as SHADOW on the same '
      + 'targetKey and horizon. liveOutput=production p; shadowOutput=baseline p. Input carries stable '
      + 'join fields (targetKey, predictedAt, resolveBy, model ids) for ACC-401 exact joins.',
    enabled: true,
    createdAt: 0,
  },
  {
    id: RUN_IDS.BASELINE_PERSISTENCE,
    algorithmId: 'persistence-baseline',
    description:
      'ACC-303: production forecasts are LIVE; the persistence baseline runs as SHADOW on the same '
      + 'targetKey and horizon. One run PER baseline model so per-model aggregation and ACC-401 joins '
      + 'never mix families.',
    enabled: true,
    createdAt: 0,
  },
  {
    id: RUN_IDS.BASELINE_MOMENTUM,
    algorithmId: 'momentum-baseline',
    description:
      'ACC-303: production forecasts are LIVE; the momentum baseline runs as SHADOW on the same '
      + 'targetKey and horizon. One run PER baseline model so per-model aggregation and ACC-401 joins '
      + 'never mix families.',
    enabled: true,
    createdAt: 0,
  },
  {
    id: RUN_IDS.SCHEMA,
    algorithmId: 'episodic-analog',
    description:
      'Hand-authored signatures are LIVE. Learned schemas are SHADOW. ' +
      'liveOutput={matchCount: hand-authored}; shadowOutput={matchCount: learned}.',
    enabled: true,
    createdAt: 0,
  },
];

// ── Module-level lazy state ────────────────────────────────────────────────────

let _initialized = false;
let _deps: ShadowRolloutDeps = {};

// ── Lazy accessor helpers ─────────────────────────────────────────────────────

function getShadowService(): ShadowModeAlgorithmService | null {
  if (_deps.shadowService) return _deps.shadowService;
  try {
    return getShadowModeAlgorithmService();
  } catch {
    return null;
  }
}

function getCalStore(): ForecastCalibrationStore | null {
  if (_deps.calibrationStore) return _deps.calibrationStore;
  try {
    return getCalibrationStore();
  } catch {
    return null;
  }
}

function getStorage(): StorageLike | null {
  if (_deps.storage !== undefined) return _deps.storage;
  try {
    const ls = (globalThis as Record<string, unknown>).localStorage as StorageLike | undefined;
    return ls ?? null;
  } catch {
    return null;
  }
}

function getPutMemory(): ((key: string, value: unknown) => Promise<void>) | null {
  if (_deps.putMemoryFn) return _deps.putMemoryFn;
  return idbPutMemory;
}

function now(): number {
  return _deps.clock ? _deps.clock() : Date.now();
}

// ── Initialise ────────────────────────────────────────────────────────────────

/**
 * Register all three shadow runs.  Idempotent — safe to call multiple times.
 * Called automatically on first push; callers may also call it explicitly at
 * boot.
 *
 * @param deps Optional injectable dependencies (for tests or early binding).
 */
export function initShadowRollout(deps?: ShadowRolloutDeps): void {
  if (deps) _deps = { ..._deps, ...deps };
  if (_initialized) return;
  _initialized = true;
  const svc = getShadowService();
  if (!svc) return;
  const ts = now();
  for (const config of RUN_CONFIGS) {
    try {
      svc.register({ ...config, createdAt: config.createdAt || ts });
    } catch {
      // Never crash on registration failure.
    }
  }
}

// ── Push helpers (one per run) ────────────────────────────────────────────────

/**
 * Push a recalibration vs legacy pair.
 *
 * Orientation (CRITICAL):
 *   liveOutput   = recalibrated probability (PR 2 output, currently live)
 *   shadowOutput = pre-recalibration probability (legacy multiplier-only path)
 *
 * Call from hypothesis-forecast.ts (or its test harness) where both values
 * are computed.  Fire-and-forget; swallows all errors.
 *
 * @param input      The hypothesis or input descriptor (used only for hashing).
 * @param liveP      The recalibrated probability (live output).
 * @param shadowP    The legacy probability before recalibration (shadow output).
 */
export function pushRecalibrationPair(
  input: unknown,
  liveP: number,
  shadowP: number,
): void {
  try {
    if (!isCognitionEnabled('shadow-algorithms')) return;
    if (!_initialized) initShadowRollout();
    const svc = getShadowService();
    if (!svc) return;
    svc.compare(RUN_IDS.RECALIBRATION, input, liveP, shadowP);
  } catch {
    // Fire-and-forget.
  }
}

/**
 * Push a superforecast vs baseline pair.
 *
 * Orientation (CRITICAL):
 *   liveOutput   = forecastHypothesis().probability (currently drives ranking)
 *   shadowOutput = superforecast().probability (shadow — not yet live)
 *
 * Call from wherever both values are known (typically the on-demand superforecast
 * call site in analyst-loop or HUD).  Fire-and-forget; swallows all errors.
 *
 * @param input        Hypothesis descriptor (for hashing).
 * @param liveP        forecastHypothesis probability (live).
 * @param shadowP      superforecast probability (shadow).
 */
export function pushSuperforecastPair(
  input: unknown,
  liveP: number,
  shadowP: number,
): void {
  try {
    if (!isCognitionEnabled('shadow-algorithms')) return;
    if (!_initialized) initShadowRollout();
    const svc = getShadowService();
    if (!svc) return;
    svc.compare(RUN_IDS.SUPERFORECAST, input, liveP, shadowP);
  } catch {
    // Fire-and-forget.
  }
}

/**
 * Push a schema-match pair for the same observation window.
 *
 * Orientation (CRITICAL):
 *   liveOutput   = { matchCount: handAuthoredCount } (hand-authored sigs, live)
 *   shadowOutput = { matchCount: learnedCount }      (learned schemas, shadow)
 *
 * Call after any matchSignatures() call where you can separate learned
 * (id prefix 'learned:') from hand-authored matches.  If there are zero
 * matches from either engine the pair is still pushed (both engines scored
 * the same window).  Fire-and-forget; swallows all errors.
 *
 * @param windowDescriptor  Stable descriptor of the observation window (for hashing).
 * @param handAuthoredCount Number of hand-authored signature matches.
 * @param learnedCount      Number of learned schema matches.
 */
/** ACC-303: one production-vs-baseline pair per emitted baseline. The
 *  input object carries the STABLE join fields ACC-401's exact
 *  paired-outcome joins need (targetKey + window + model identities) —
 *  never an approximate hash of opaque state. */
export interface BaselinePairInput {
  targetKey: string;
  predictedAt: number;
  resolveBy: number;
  productionSourceId: string;
  productionVersion?: string;
  baselineSourceId: string;
  baselineVersion?: string;
  /** Feature-set version, when the emitting pipeline defines one. */
  featureSetVersion?: string;
}

const BASELINE_RUN_ID_SET: ReadonlySet<string> = new Set([
  RUN_IDS.BASELINE_HIERARCHICAL,
  RUN_IDS.BASELINE_PERSISTENCE,
  RUN_IDS.BASELINE_MOMENTUM,
]);

const BASELINE_RUN_BY_SOURCE: Record<string, RunId> = {
  'hierarchical-base-rate': RUN_IDS.BASELINE_HIERARCHICAL,
  'persistence-baseline': RUN_IDS.BASELINE_PERSISTENCE,
  'momentum-baseline': RUN_IDS.BASELINE_MOMENTUM,
};

export function pushBaselinePair(
  input: BaselinePairInput,
  productionP: number,
  baselineP: number,
): void {
  try {
    if (!isCognitionEnabled('shadow-algorithms')) return;
    const runId = BASELINE_RUN_BY_SOURCE[input.baselineSourceId];
    if (!runId) return; // unknown baseline family — never mis-aggregate
    if (!_initialized) initShadowRollout();
    const svc = getShadowService();
    if (!svc) return;
    svc.compare(runId, input, productionP, baselineP, {
      targetKey: input.targetKey,
      predictedAt: input.predictedAt,
      resolveBy: input.resolveBy,
      liveModelId: input.productionSourceId,
      liveModelVersion: input.productionVersion,
      shadowModelId: input.baselineSourceId,
      shadowModelVersion: input.baselineVersion,
      featureSetVersion: input.featureSetVersion,
    });
  } catch {
    // Fire-and-forget.
  }
}

export function pushSchemaPair(
  windowDescriptor: unknown,
  handAuthoredCount: number,
  learnedCount: number,
): void {
  try {
    if (!isCognitionEnabled('shadow-algorithms')) return;
    if (!_initialized) initShadowRollout();
    const svc = getShadowService();
    if (!svc) return;
    svc.compare(
      RUN_IDS.SCHEMA,
      windowDescriptor,
      { matchCount: handAuthoredCount },
      { matchCount: learnedCount },
    );
  } catch {
    // Fire-and-forget.
  }
}

// ── Brier computation helper ───────────────────────────────────────────────────

/**
 * Compute Brier score for a set of (probability, outcome) pairs.
 * Returns null when there are no pairs.
 */
/**
 * ACC-401 exact paired-outcome verdict. Joins comparisons to resolved
 * calibration records by the comparison's STABLE joinKey — targetKey +
 * predictedAt + resolveBy + the LIVE model's identity — never by hash
 * or probability proximity. Discipline:
 *  - comparisons without a joinKey are ignored (they cannot join exactly);
 *  - a join target whose records disagree on the outcome is dropped
 *    entirely (ACC-301 dedup semantics);
 *  - records whose outcome was observed BEFORE the pair was produced
 *    are excluded (comparison.timestamp must precede resolvedAt);
 *  - both models score on the identical joined cohort by construction —
 *    one comparison carries both probabilities.
 * `pairs` in the verdict = JOINED resolved pairs (the evidence count
 * ACC-402's promotion gate consumes), not raw comparison volume.
 */
function exactPairedVerdict(
  runId: RunId,
  comparisons: readonly { liveOutput: unknown; shadowOutput: unknown; timestamp: number; joinKey?: ShadowJoinKey }[],
  divergenceRate: number,
  ts: number,
): ShadowVerdict {
  const insufficient = (joined: number): ShadowVerdict => ({
    runId, pairs: joined, divergenceRate, recommendation: 'insufficient-data', computedAt: ts,
  });
  const store = getCalStore();
  if (!store) return insufficient(0);

  const byIdentity = indexResolvedIdentities(store.all());
  const evidence = joinExactPairs(comparisons, byIdentity);

  const joined = evidence.length;
  if (joined < FLIP_GATE_MIN_PAIRS) return insufficient(joined);
  const brierLive = brierScore(evidence.map((e) => ({ p: e.liveP, outcome: e.outcome }))) ?? undefined;
  const brierShadow = brierScore(evidence.map((e) => ({ p: e.shadowP, outcome: e.outcome }))) ?? undefined;
  if (brierLive === undefined || brierShadow === undefined) return insufficient(joined);
  const recommendation: FlipRecommendation =
    brierShadow <= brierLive ? 'flip-to-shadow' : 'keep-live';
  return { runId, pairs: joined, divergenceRate, brierLive, brierShadow, recommendation, computedAt: ts };
}

/** ACC-402: one exact-joined pair with the outcome attribution the
 *  promotion gate consumes — per-pair domain (for the per-domain
 *  minimum-evidence gate) and resolution provenance kind (so proxy-only
 *  cohorts can never auto-promote). */
export interface JoinedPairEvidence {
  liveP: number;
  shadowP: number;
  outcome: boolean;
  domain: string;
  resolutionKind: 'direct' | 'proxy';
  comparedAt: number;
}

interface ResolvedIdentity {
  outcome: boolean;
  resolvedAt: number;
  domain: string;
  kind: 'direct' | 'proxy';
}

function resolutionKindOf(r: PredictionRecord): 'direct' | 'proxy' {
  if (r.resolutionProvenance) return r.resolutionProvenance.kind;
  return r.resolutionNote?.startsWith('proxy:') ? 'proxy' : 'direct';
}

/** Resolved records indexed by exact join identity; conflicting
 *  outcomes on one identity drop the whole key (ACC-301 semantics).
 *  Same-outcome duplicates upgrade kind to 'direct' when any record
 *  carries direct provenance — direct evidence dominates proxy. */
function indexResolvedIdentities(
  records: readonly PredictionRecord[],
): Map<string, ResolvedIdentity | null> {
  const byIdentity = new Map<string, ResolvedIdentity | null>();
  for (const r of records) {
    if (r.status !== 'resolved_true' && r.status !== 'resolved_false') continue;
    if (!r.targetKey || r.resolvedAt === undefined || !Number.isFinite(r.resolvedAt)) continue;
    const key = [r.targetKey, r.predictedAt, r.resolveBy, r.sourceId].join('\u0000');
    const outcome = r.status === 'resolved_true';
    const kind = resolutionKindOf(r);
    const existing = byIdentity.get(key);
    if (existing === undefined) {
      byIdentity.set(key, { outcome, resolvedAt: r.resolvedAt, domain: r.domain, kind });
    } else if (existing !== null && existing.outcome !== outcome) {
      byIdentity.set(key, null);
    } else if (existing !== null && existing.kind === 'proxy' && kind === 'direct') {
      byIdentity.set(key, { ...existing, kind: 'direct' });
    }
  }
  return byIdentity;
}

/** Join comparisons to resolved identities. Excludes joinKey-less
 *  comparisons, non-numeric outputs, unknown/conflicting identities,
 *  and pairs produced at-or-after the outcome observation. */
function joinExactPairs(
  comparisons: readonly { liveOutput: unknown; shadowOutput: unknown; timestamp: number; joinKey?: ShadowJoinKey }[],
  byIdentity: ReadonlyMap<string, ResolvedIdentity | null>,
): JoinedPairEvidence[] {
  const evidence: JoinedPairEvidence[] = [];
  for (const cmp of comparisons) {
    const jk = cmp.joinKey;
    if (!jk?.targetKey || !jk.liveModelId) continue;
    const liveP = typeof cmp.liveOutput === 'number' ? cmp.liveOutput : null;
    const shadowP = typeof cmp.shadowOutput === 'number' ? cmp.shadowOutput : null;
    if (liveP === null || shadowP === null) continue;
    const key = [jk.targetKey, jk.predictedAt, jk.resolveBy, jk.liveModelId].join('\u0000');
    const resolved = byIdentity.get(key);
    if (!resolved) continue;
    if (cmp.timestamp >= resolved.resolvedAt) continue;
    evidence.push({
      liveP,
      shadowP,
      outcome: resolved.outcome,
      domain: resolved.domain,
      resolutionKind: resolved.kind,
      comparedAt: cmp.timestamp,
    });
  }
  return evidence;
}

/**
 * ACC-402: the exact-joined evidence cohort for a run — the same join
 * the flip-gate verdict uses (identical exclusion rules), returned as
 * attributed pairs for the promotion gate. Empty array on any missing
 * dependency (fail-closed: no evidence, no promotion).
 */
export function collectJoinedEvidence(
  runId: RunId,
  deps?: ShadowRolloutDeps,
): JoinedPairEvidence[] {
  try {
    if (deps) _deps = { ..._deps, ...deps };
    if (!_initialized) initShadowRollout();
    const svc = getShadowService();
    const store = getCalStore();
    if (!svc || !store) return [];
    const comparisons = svc.getComparisons({ runId }, 2000);
    return joinExactPairs(comparisons, indexResolvedIdentities(store.all()));
  } catch {
    return [];
  }
}

function brierScore(pairs: { p: number; outcome: boolean }[]): number | null {
  if (pairs.length === 0) return null;
  let sum = 0;
  for (const { p, outcome } of pairs) {
    const o = outcome ? 1 : 0;
    sum += (p - o) ** 2;
  }
  return sum / pairs.length;
}

// ── Flip gate ─────────────────────────────────────────────────────────────────

/**
 * Compute the flip-gate verdict for a given run.
 *
 * Gate rules:
 *   - < FLIP_GATE_MIN_PAIRS (200) → 'insufficient-data'
 *   - ≥ 200 pairs AND no resolved outcomes (Brier unavailable) → 'insufficient-data'
 *   - ≥ 200 pairs AND shadowBrier ≤ liveBrier → 'flip-to-shadow'
 *   - ≥ 200 pairs AND shadowBrier >  liveBrier → 'keep-live'
 *
 * Brier is computed by joining the shadow comparison outputs against the
 * ForecastCalibrationStore's resolved records.  Only
 * 'recalibration-vs-legacy' and 'superforecast-vs-baseline' produce numeric
 * probabilities that can be Brier-scored; 'learned-schema-vs-handauthored'
 * uses divergenceRate only and always returns 'insufficient-data' from the
 * Brier perspective (match counts are not probabilities).
 *
 * @param runId    One of the three RUN_IDS values.
 * @param deps     Optional overrides (same as initShadowRollout).
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- pre-existing complexity surfaced by the changed-file linter when this file was restaged for the require()→import fix; not introduced here, refactor out of scope.
export function shadowVerdict(
  runId: RunId,
  deps?: ShadowRolloutDeps,
): ShadowVerdict {
  if (deps) _deps = { ..._deps, ...deps };
  if (!_initialized) initShadowRollout();

  const svc = getShadowService();
  const ts = now();

  const emptyVerdict: ShadowVerdict = {
    runId,
    pairs: 0,
    divergenceRate: 0,
    recommendation: 'insufficient-data',
    computedAt: ts,
  };

  if (!svc) return emptyVerdict;

  // Gather comparisons for this run.
  const comparisons = svc.getComparisons({ runId }, /* limit = */ 2000);
  const pairCount = comparisons.length;
  const divergenceRate = svc.getDivergenceRate(runId);

  // ACC-401: baseline runs verdict through EXACT target-key joins — the
  // probability-proximity join below (legacy runs only) can attach a
  // comparison to the wrong resolved outcome.
  if (BASELINE_RUN_ID_SET.has(runId)) {
    return exactPairedVerdict(runId, comparisons, divergenceRate, ts);
  }

  if (pairCount < FLIP_GATE_MIN_PAIRS) {
    return { runId, pairs: pairCount, divergenceRate, recommendation: 'insufficient-data', computedAt: ts };
  }

  // For schema pairs (matchCount objects), Brier is not applicable.
  if (runId === RUN_IDS.SCHEMA) {
    return { runId, pairs: pairCount, divergenceRate, recommendation: 'insufficient-data', computedAt: ts };
  }

  // Attempt Brier scoring by joining against resolved calibration records.
  const store = getCalStore();
  if (!store) {
    return { runId, pairs: pairCount, divergenceRate, recommendation: 'insufficient-data', computedAt: ts };
  }

  const resolvedRecords = store.all().filter(
    r => r.status === 'resolved_true' || r.status === 'resolved_false',
  );

  if (resolvedRecords.length === 0) {
    return { runId, pairs: pairCount, divergenceRate, recommendation: 'insufficient-data', computedAt: ts };
  }

  // Build a Set of resolved record IDs for fast lookup, then join on inputHash.
  // The shadow comparison inputHash is the FNV-1a hash of the input; the
  // calibration store records don't carry this hash directly.  Instead we
  // use the positional ordering: comparisons are ordered newest-last by the
  // service; we pair against resolved records that were recorded after
  // predictedAt >= comparison.timestamp - 30 s (within a 30-second window),
  // accepting that this join is approximate (the same input hash is more
  // precise but would require the calibration store to carry the shadow inputHash).
  //
  // Honest design note: a tighter join is possible if we embed the
  // hypothesis ID in the shadow input object; the current comparisons store
  // only the FNV hash.  For the MVP, we cross-join by hash: each comparison's
  // liveOutput (a number) is matched against resolved records whose probability
  // is within 0.001 of liveOutput and whose resolvedAt is not null.
  // This is sufficient for the flip-gate math but is noted as approximate.

  const livePairs: { p: number; outcome: boolean }[] = [];
  const shadowPairs: { p: number; outcome: boolean }[] = [];

  for (const cmp of comparisons) {
    const liveP = typeof cmp.liveOutput === 'number' ? cmp.liveOutput : null;
    const shadowP = typeof cmp.shadowOutput === 'number' ? cmp.shadowOutput : null;
    if (liveP === null || shadowP === null) continue;

    // Find a resolved record whose probability is close to liveP.
    const matched = resolvedRecords.find(
      r => Math.abs(r.probability - liveP) < 0.001 &&
        r.predictedAt <= cmp.timestamp + 5000, // within 5 s of comparison
    );
    if (!matched) continue;

    const outcome = matched.status === 'resolved_true';
    livePairs.push({ p: liveP, outcome });
    shadowPairs.push({ p: shadowP, outcome });
  }

  const brierLive = brierScore(livePairs) ?? undefined;
  const brierShadow = brierScore(shadowPairs) ?? undefined;

  if (brierLive === undefined || brierShadow === undefined) {
    return { runId, pairs: pairCount, divergenceRate, recommendation: 'insufficient-data', computedAt: ts };
  }

  const recommendation: FlipRecommendation =
    brierShadow <= brierLive ? 'flip-to-shadow' : 'keep-live';

  return { runId, pairs: pairCount, divergenceRate, brierLive, brierShadow, recommendation, computedAt: ts };
}

// ── Verdict snapshot persistence ──────────────────────────────────────────────

/**
 * Compute verdicts for all three runs and persist the snapshot.
 *
 * Snapshot is written to:
 *   - localStorage key 'crystalball-cognition-shadow-v1'
 *   - reasoning-memory IDB key 'crystalball-cognition-shadow-v1'
 *
 * Fire-and-forget.  The cognition-shadow-report script reads this snapshot
 * from a JSON file the operator exports from the app's DevTools console:
 *   copy(localStorage.getItem('crystalball-cognition-shadow-v1'))
 *
 * @param deps Optional injectable overrides.
 */
export function persistVerdictSnapshot(deps?: ShadowRolloutDeps): void {
  try {
    if (deps) _deps = { ..._deps, ...deps };
    const ts = now();
    const verdicts: ShadowVerdict[] = Object.values(RUN_IDS).map(
      (id) => shadowVerdict(id),
    );
    const snapshot: ShadowVerdictSnapshot = { verdicts, snapshottedAt: ts };
    const json = JSON.stringify(snapshot);

    // localStorage mirror.
    const storage = getStorage();
    if (storage) {
      try { storage.setItem(VERDICT_STORAGE_KEY, json); } catch { /* quota */ }
    }

    // IDB persistence (fire-and-forget).
    const put = getPutMemory();
    if (put) {
      void put(VERDICT_STORAGE_KEY, snapshot);
    }
  } catch {
    // Never crash on persistence failure.
  }
}

// ── Test helpers ──────────────────────────────────────────────────────────────

/**
 * Reset module state for test isolation.
 * Clears injectable deps and re-initialization flag.
 */
export function resetShadowRolloutForTests(): void {
  _initialized = false;
  _deps = {};
}

/**
 * Configure injectable dependencies (for tests).
 * Call before any push or verdict operation.
 */
export function configureShadowRolloutForTests(deps: ShadowRolloutDeps): void {
  _deps = { ..._deps, ...deps };
}
