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

import type { ShadowModeAlgorithmService, ShadowRunConfig } from '@/services/intelligence/shadow-mode';
import type { ForecastCalibrationStore } from '@/services/intelligence/forecast-calibration';

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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@/services/intelligence/shadow-mode') as {
      getShadowModeAlgorithmService: () => ShadowModeAlgorithmService;
    };
    return mod.getShadowModeAlgorithmService();
  } catch {
    return null;
  }
}

function getCalStore(): ForecastCalibrationStore | null {
  if (_deps.calibrationStore) return _deps.calibrationStore;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@/services/intelligence/forecast-calibration-adapter') as {
      getCalibrationStore: () => ForecastCalibrationStore;
    };
    return mod.getCalibrationStore();
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
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@/services/reasoning-memory') as {
      putMemory: <T>(key: string, value: T) => Promise<void>;
    };
    return mod.putMemory;
  } catch {
    return null;
  }
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
export function pushSchemaPair(
  windowDescriptor: unknown,
  handAuthoredCount: number,
  learnedCount: number,
): void {
  try {
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
    const verdicts: ShadowVerdict[] = [
      shadowVerdict(RUN_IDS.RECALIBRATION),
      shadowVerdict(RUN_IDS.SUPERFORECAST),
      shadowVerdict(RUN_IDS.SCHEMA),
    ];
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
