/**
 * Self-Tuning Cognition — Cognitive Enhancement PR 12 (Part D).
 *
 * Plugs the cognition layer into the existing self-improvement machinery:
 *
 *   1. Every cognition constant is a declared tunable (see the PR 12 block
 *      in `algorithms/tunable-params-store.ts`); the cognition modules read
 *      via `getTunedParam` with the historical hardcoded value as default.
 *   2. The five cognition outputs (episodic-analog, recalibration,
 *      superforecast, operator-ranking, entity-trajectory) are registered
 *      algorithms (`algorithms/algorithm-registry.ts`).
 *   3. THIS MODULE grades them: deterministic hit/miss/partial
 *      evaluation-ledger records derived from ground truth the app already
 *      collects (resolved calibration-store predictions, dossier timelines,
 *      hypothesis-accuracy resolutions) — no LLM, no fabricated outcomes.
 *   4. THIS MODULE watches for drift: once graded, `evaluateDrift`
 *      (Page-Hinkley on rolling F1) runs over each cognition algorithm's
 *      ledger records with reachable production options; a sustained
 *      degradation transition records a DriftAlert and emits
 *      `cb:cognition-drift`. Below-floor algorithms then flow through the
 *      existing safe-adjustment → policy-gate loop, whose fail-closed
 *      safety/backtest signals hold cognition proposals for OPERATOR
 *      APPROVAL (plan: "the operator approves; nothing self-applies").
 *
 * Grading semantics (all deterministic, all explained):
 *   - episodic-analog: graded at hypothesis resolution time from the
 *     EMIT-TIME analog score stamped onto the pending hypothesis by
 *     hypothesis-accuracy (`gradeEpisodicAnalogOnResolution`). Grading from
 *     the stamped value — never the live cache — avoids outcome leakage:
 *     post-resolution cache refreshes would include the resolved episode
 *     itself (self-similarity ≈ 1).
 *   - recalibration: each resolved (non-superforecast) calibration record
 *     is replayed through the CURRENT per-domain recalibrator; hit when the
 *     recalibrated probability lands on the correct side of 50%.
 *   - superforecast: resolved calibration records with sourceId
 *     'superforecast' (their probability IS the pipeline output); hit when
 *     the forecast lands on the correct side of 50%.
 *   - entity-trajectory: retrospective replay — recompute the trajectory as
 *     of 7 days ago from the timeline events known THEN, and check whether
 *     activity in the 7 days since actually rose (heating) or fell
 *     (cooling). 'stable' predictions are uninformative and skipped.
 *   - operator-ranking: graded at hypothesis resolution time from the
 *     EMIT-TIME interest multiplier stamped onto the pending hypothesis
 *     (`gradeOperatorRankingOnResolution`); a boost pointing at a
 *     hypothesis that panned out = hit, a boost on a fizzle (or a demotion
 *     on a hit) = miss. Stamping avoids the bias where in-window engagement
 *     reinforcement would tilt a grade-time recomputation toward hit.
 *
 * Pass-based graders advance their persisted watermarks ONLY for samples
 * that were actually recorded, so a transient ledger failure retries on
 * the next pass instead of silently losing the grade. State (watermarks +
 * drift-alert dedupe) persists to localStorage under
 * `crystalball-cognition-selftune-v1`.
 *
 * Pure deterministic with injectable deps (records / dossiers / recorder /
 * storage / clock). No DOM, no fetch, no globals at import time.
 */

import { getAllDossiers, computeTrajectory, type EntityDossier } from './entity-dossier';
import type { PredictionRecord } from '@/services/intelligence/forecast-calibration';
import { getCalibrationStore, getRecalibrator } from '@/services/intelligence/forecast-calibration-adapter';
import type { FactDomain } from '@/services/intelligence/types';
import {
  recordAlgorithmEvaluation,
  recordAlgorithmOutcome,
  type RecordEvaluationInput,
} from '@/services/algorithms/record-evaluation';
import type { EvaluationOutcome, AlgorithmEvaluationLedger, EvaluationRecord } from '@/services/algorithms/algorithm-evaluation-ledger';
import { getAlgorithmEvaluationLedger } from '@/services/algorithms/algorithms-state';
import {
  evaluateDrift,
  recordDriftAlert,
  type DriftDetectorOptions,
  type DriftStatus,
  type DriftAlert,
} from '@/services/algorithms/drift-detector';
import { isGhostMode } from '@/services/mode-manager';

// ── Constants ─────────────────────────────────────────────────────────────────

/** The registered cognition algorithms this module grades + drift-watches. */
export const COGNITION_ALGORITHM_IDS = [
  'episodic-analog',
  'recalibration',
  'superforecast',
  'operator-ranking',
  'entity-trajectory',
] as const;

export type CognitionAlgorithmId = (typeof COGNITION_ALGORITHM_IDS)[number];

const STATE_STORAGE_KEY = 'crystalball-cognition-selftune-v1';

/** Elevated-analog decision bar (matches the analog-score semantics: the
 *  similarity-weighted materialization rate of past analogs). */
const ELEVATED_BAR = 0.5;

/** Operator multipliers within ±NEUTRAL_BAND of 1.0 carry no ranking
 *  signal and are not graded. */
const NEUTRAL_BAND = 0.02;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Retrospective trajectory window: predict at (now − 7d), verify against
 *  the 7 days since. Matches the dossier's recent-window length. */
const TRAJECTORY_LOOKBACK_MS = 7 * MS_PER_DAY;

/** Per-entity trajectory gradings must not overlap: at least 7 days between
 *  graded cutoffs so verification windows are disjoint. */
const TRAJECTORY_MIN_GAP_MS = 7 * MS_PER_DAY;

/** Cap on the per-entity watermark map (matches MAX_DOSSIERS). */
const MAX_TRAJECTORY_WATERMARKS = 500;

// ── Persistent state (watermarks + drift dedupe) ──────────────────────────────

export interface SelfTuningStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface SelfTuningState {
  /** Newest calibration-record `resolvedAt` successfully graded
   *  (recalibration + superforecast share the store). */
  calibrationResolvedThrough: number;
  /** entity → last successfully graded trajectory cutoff (ms). */
  trajectoryGradedThrough: Record<string, number>;
  /** algorithmId → currently in an alerting drift state. Dedupe: the alert
   *  sink fires only on the false→true transition, not on every pass. */
  driftAlerting: Record<string, boolean>;
}

function emptyState(): SelfTuningState {
  return {
    calibrationResolvedThrough: 0,
    trajectoryGradedThrough: {},
    driftAlerting: {},
  };
}

function resolveStorage(injected: SelfTuningStorageLike | null | undefined): SelfTuningStorageLike | null {
  if (injected !== undefined) return injected;
  if (typeof globalThis !== 'undefined') {
    const ls = (globalThis as unknown as Record<string, unknown>).localStorage as SelfTuningStorageLike | undefined;
    if (ls && typeof ls.getItem === 'function') return ls;
  }
  return null;
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function loadState(storage: SelfTuningStorageLike | null): SelfTuningState {
  if (!storage) return emptyState();
  try {
    const raw = storage.getItem(STATE_STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainRecord(parsed)) return emptyState();
    const p = parsed as Partial<SelfTuningState>;
    return {
      calibrationResolvedThrough: typeof p.calibrationResolvedThrough === 'number' ? p.calibrationResolvedThrough : 0,
      trajectoryGradedThrough: isPlainRecord(p.trajectoryGradedThrough)
        ? (p.trajectoryGradedThrough as Record<string, number>)
        : {},
      driftAlerting: isPlainRecord(p.driftAlerting)
        ? (p.driftAlerting as Record<string, boolean>)
        : {},
    };
  } catch {
    return emptyState();
  }
}

function saveState(storage: SelfTuningStorageLike | null, state: SelfTuningState): void {
  if (!storage) return;
  // Cap the per-entity map — drop the oldest cutoffs first.
  const entries = Object.entries(state.trajectoryGradedThrough);
  if (entries.length > MAX_TRAJECTORY_WATERMARKS) {
    entries.sort((a, b) => b[1] - a[1]);
    state.trajectoryGradedThrough = Object.fromEntries(entries.slice(0, MAX_TRAJECTORY_WATERMARKS));
  }
  try {
    storage.setItem(STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota — next pass may re-grade; the ledger tolerates duplicates */
  }
}

// ── Grading pass ──────────────────────────────────────────────────────────────

type RecordEvaluationFn = (algorithmId: string, input: RecordEvaluationInput) => { id: string };
type RecordOutcomeFn = (recordId: string, outcome: EvaluationOutcome, reason: string, at?: number) => unknown;

export interface CognitionGradingDeps {
  /** Calibration records (default: the calibration-store singleton). */
  calibrationRecords?: readonly PredictionRecord[];
  /** Recalibrator factory (default: the live per-domain curve cache). */
  recalibratorFor?: (domain: FactDomain) => (p: number) => { p: number };
  /** Dossier source (default: entity-dossier singleton). */
  dossiers?: readonly Pick<EntityDossier, 'entity' | 'timeline'>[];
  /** Evaluation recorder (default: the singleton evaluation ledger). */
  recordEvaluation?: RecordEvaluationFn;
  /** Outcome recorder (default: the singleton evaluation ledger). */
  recordOutcome?: RecordOutcomeFn;
  /** State storage (default: localStorage; pass null to disable). */
  storage?: SelfTuningStorageLike | null;
  now?: () => number;
}

export interface CognitionGradingResult {
  /** Graded sample count per cognition algorithm this pass. episodic-analog
   *  and operator-ranking are graded at hypothesis resolution time (see the
   *  `*OnResolution` helpers), so their pass counts are always 0 — the keys
   *  are present so the result shape names every cognition algorithm. */
  graded: Record<string, number>;
}

/** Recording context shared by the per-algorithm graders. */
interface GradingContext {
  record: RecordEvaluationFn;
  recordOutcome: RecordOutcomeFn;
  graded: Record<string, number>;
}

/** Record one evaluation + its outcome. Best-effort: a ledger failure never
 *  aborts the pass. Returns true when the sample was recorded — callers
 *  advance their watermark only on true, so failed grades retry next pass. */
function recordGrade(
  ctx: GradingContext,
  algorithmId: string,
  input: RecordEvaluationInput,
  outcome: EvaluationOutcome,
  reason: string,
  outcomeAt: number,
): boolean {
  try {
    const rec = ctx.record(algorithmId, input);
    ctx.recordOutcome(rec.id, outcome, reason, outcomeAt);
    ctx.graded[algorithmId] = (ctx.graded[algorithmId] ?? 0) + 1;
    return true;
  } catch {
    return false;
  }
}

/** Which algorithm a calibration record grades, and with what probability.
 *  Superforecast records already carry the pipeline's final output; every
 *  other record is replayed through the recalibration curve currently in
 *  force (grades the live curve against recent resolved reality). Returns
 *  null when the recalibrator is unavailable for the record's domain.
 *
 *  KNOWN BIAS (accepted for now): the current curve was built partly from
 *  the very records being graded, so this replay is in-sample and the
 *  resulting hit rate is OPTIMISTIC — the curve has already "seen" these
 *  outcomes. The bias direction is stable (never pessimistic), and drift
 *  detection compares the series against its own rolling baseline, so a
 *  real degradation still surfaces; out-of-sample grading would require
 *  persisting the curve generation used at prediction time. */
function forecastGradeTarget(
  r: PredictionRecord,
  recalibratorFor: (domain: FactDomain) => (p: number) => { p: number },
): { algorithmId: 'recalibration' | 'superforecast'; p: number } | null {
  if (r.sourceId === 'superforecast') {
    return { algorithmId: 'superforecast', p: r.probability };
  }
  try {
    return { algorithmId: 'recalibration', p: recalibratorFor(r.domain)(r.probability).p };
  } catch {
    return null;
  }
}

/** The record's resolvedAt when it is resolved AND newer than the
 *  watermark; null otherwise. */
function resolvedAfter(r: PredictionRecord, through: number): number | null {
  if (r.status !== 'resolved_true' && r.status !== 'resolved_false') return null;
  if (typeof r.resolvedAt !== 'number' || r.resolvedAt <= through) return null;
  return r.resolvedAt;
}

function hasAuthoritativeForecastLink(record: PredictionRecord): boolean {
  return Boolean(record.targetKey && record.algorithmVersion);
}

/** recalibration + superforecast: resolved calibration-store records,
 *  routed by sourceId. Returns the new calibration watermark — advanced
 *  only past records whose grade was actually recorded. */
function gradeCalibrationForecasts(
  ctx: GradingContext,
  records: readonly PredictionRecord[],
  recalibratorFor: (domain: FactDomain) => (p: number) => { p: number },
  resolvedThrough: number,
): number {
  let maxRecorded = resolvedThrough;
  for (const r of records) {
    const resolvedAt = resolvedAfter(r, resolvedThrough);
    if (resolvedAt === null) continue;
    if (hasAuthoritativeForecastLink(r)) {
      // ACC-104 owns structured forecasts through their exact emit-time
      // target/version link. Replaying them through today's recalibrator
      // would duplicate the grade and can grade a different model version.
      maxRecorded = Math.max(maxRecorded, resolvedAt);
      continue;
    }
    const materialized = r.status === 'resolved_true';

    const target = forecastGradeTarget(r, recalibratorFor);
    if (target === null || !Number.isFinite(target.p)) continue;
    const { algorithmId, p } = target;
    const fires = p >= 0.5;
    const outcome: EvaluationOutcome = fires === materialized ? 'hit' : 'miss';
    const reason = `${algorithmId} said ${(p * 100).toFixed(0)}% (raw ${(r.probability * 100).toFixed(0)}%); claim ${materialized ? 'materialized' : 'did not materialize'}`;
    const recorded = recordGrade(ctx, algorithmId, {
      durationMs: 0,
      at: resolvedAt,
      score: p,
      label: fires ? 'forecast-likely' : 'forecast-unlikely',
      inputHash: r.id.slice(0, 120),
      detail: { domain: r.domain, rawP: Math.round(r.probability * 1000) / 1000 },
    }, outcome, reason, resolvedAt);
    if (recorded) maxRecorded = Math.max(maxRecorded, resolvedAt);
  }
  return maxRecorded;
}

/** entity-trajectory outcome vs what actually happened after the cutoff. */
function trajectoryOutcome(
  predicted: 'heating' | 'cooling',
  recentAtCutoff: number,
  subsequent: number,
): EvaluationOutcome {
  if (subsequent === recentAtCutoff) return 'partial'; // activity held level — half credit either way
  if (predicted === 'heating') return subsequent > recentAtCutoff ? 'hit' : 'miss';
  return subsequent < recentAtCutoff ? 'hit' : 'miss';
}

/** entity-trajectory: retrospective replay 7 days back. Mutates the
 *  per-entity watermark map only for entities whose grade was recorded. */
function gradeEntityTrajectories(
  ctx: GradingContext,
  dossiers: readonly Pick<EntityDossier, 'entity' | 'timeline'>[],
  gradedThrough: Record<string, number>,
  nowMs: number,
): void {
  const cutoff = nowMs - TRAJECTORY_LOOKBACK_MS;
  for (const d of dossiers) {
    const last = gradedThrough[d.entity];
    if (last !== undefined && cutoff - last < TRAJECTORY_MIN_GAP_MS) continue;
    const past = d.timeline.filter((ev) => ev.ts <= cutoff);
    if (past.length === 0) continue;
    const { trajectory: predicted, evidence } = computeTrajectory(past, cutoff);
    if (predicted === 'stable') continue; // uninformative — do not fabricate a grade
    const subsequent = d.timeline.filter((ev) => ev.ts > cutoff && ev.ts <= cutoff + TRAJECTORY_LOOKBACK_MS).length;
    const recentAtCutoff = evidence.recent7dCount;
    const outcome = trajectoryOutcome(predicted, recentAtCutoff, subsequent);
    const reason = `predicted ${predicted} at cutoff (${recentAtCutoff} events/7d); observed ${subsequent} events in the following 7d`;
    const recorded = recordGrade(ctx, 'entity-trajectory', {
      durationMs: 0,
      at: cutoff,
      score: predicted === 'heating' ? 1 : 0,
      label: predicted,
      inputHash: d.entity.slice(0, 120),
      detail: { recentAtCutoff, subsequent },
    }, outcome, reason, nowMs);
    if (recorded) gradedThrough[d.entity] = cutoff;
  }
}

/**
 * Run one deterministic grading pass: derive hit/miss/partial evaluation
 * records for the pass-graded cognition algorithms (recalibration,
 * superforecast, entity-trajectory) from already-resolved ground truth.
 * episodic-analog and operator-ranking grade at hypothesis resolution time
 * instead (see the `*OnResolution` helpers). Safe to call repeatedly —
 * watermarks prevent double-grading. Synchronous.
 */
export function runCognitionGradingPass(deps: CognitionGradingDeps = {}): CognitionGradingResult {
  const records = deps.calibrationRecords ?? getCalibrationStore().all();
  const recalibratorFor = deps.recalibratorFor ?? ((domain: FactDomain) => getRecalibrator(domain));
  const dossiers = deps.dossiers ?? getAllDossiers();
  const storage = resolveStorage(deps.storage);
  const now = deps.now ?? Date.now;

  const state = loadState(storage);
  const ctx: GradingContext = {
    record: deps.recordEvaluation ?? (recordAlgorithmEvaluation as RecordEvaluationFn),
    recordOutcome: deps.recordOutcome ?? (recordAlgorithmOutcome as RecordOutcomeFn),
    graded: {
      'episodic-analog': 0,
      'recalibration': 0,
      'superforecast': 0,
      'operator-ranking': 0,
      'entity-trajectory': 0,
    },
  };

  state.calibrationResolvedThrough = gradeCalibrationForecasts(ctx, records, recalibratorFor, state.calibrationResolvedThrough);
  gradeEntityTrajectories(ctx, dossiers, state.trajectoryGradedThrough, now());

  saveState(storage, state);
  return { graded: ctx.graded };
}

// ── Resolution-time grading (called from hypothesis-accuracy.gradeOne) ────────

export interface ResolutionGradeDeps {
  recordEvaluation?: RecordEvaluationFn;
  recordOutcome?: RecordOutcomeFn;
  now?: () => number;
}

/**
 * Grade the episodic analog engine when a hypothesis resolves. `analogScore`
 * MUST be the EMIT-TIME value stamped onto the pending hypothesis (not a
 * grade-time cache read — the post-resolution cache includes the resolved
 * episode itself, which would leak the outcome into the grade). Legacy
 * pendings without a stamped score return null (no grade). Outcomes here
 * are binary (hypothesis-accuracy grades hit/fizzle), so no 'partial'.
 */
export function gradeEpisodicAnalogOnResolution(
  analogScore: number | null | undefined,
  hypothesisHit: boolean,
  deps: ResolutionGradeDeps = {},
): EvaluationOutcome | null {
  if (analogScore === null || analogScore === undefined || !Number.isFinite(analogScore)) return null;
  const record = deps.recordEvaluation ?? (recordAlgorithmEvaluation as RecordEvaluationFn);
  const recordOutcome = deps.recordOutcome ?? (recordAlgorithmOutcome as RecordOutcomeFn);
  const now = deps.now ?? Date.now;

  const elevated = analogScore >= ELEVATED_BAR;
  const outcome: EvaluationOutcome = elevated === hypothesisHit ? 'hit' : 'miss';
  const reason = `emit-time analog score ${analogScore.toFixed(2)} read ${elevated ? 'elevated' : 'quiet'}; hypothesis ${hypothesisHit ? 'panned out' : 'fizzled'}`;
  const at = now();
  const rec = record('episodic-analog', {
    durationMs: 0,
    at,
    score: analogScore,
    label: elevated ? 'analog-elevated' : 'analog-quiet',
  });
  recordOutcome(rec.id, outcome, reason, at);
  return outcome;
}

/**
 * Grade the operator-model's ranking personalization when a hypothesis
 * resolves. `operatorMult` MUST be the EMIT-TIME interest multiplier
 * stamped onto the pending hypothesis — recomputing at grade time would
 * bias toward hit, because engagement with the hypothesis inside the
 * grading window reinforces the very interests being graded.
 *
 * A boost (multiplier > 1) pointing at a hypothesis that panned out is a
 * hit; a boost on a fizzle — or a demotion on a hit — is a miss. Neutral
 * multipliers (within ±2% of 1.0) and unstamped legacy pendings carry no
 * ranking signal → null.
 */
export function gradeOperatorRankingOnResolution(
  operatorMult: number | undefined,
  hypothesisHit: boolean,
  deps: ResolutionGradeDeps = {},
): EvaluationOutcome | null {
  if (operatorMult === undefined || !Number.isFinite(operatorMult)) return null;
  if (Math.abs(operatorMult - 1) <= NEUTRAL_BAND) return null;
  const record = deps.recordEvaluation ?? (recordAlgorithmEvaluation as RecordEvaluationFn);
  const recordOutcome = deps.recordOutcome ?? (recordAlgorithmOutcome as RecordOutcomeFn);
  const now = deps.now ?? Date.now;

  const boosted = operatorMult > 1;
  const outcome: EvaluationOutcome = boosted === hypothesisHit ? 'hit' : 'miss';
  const reason = `operator model ${boosted ? 'boosted' : 'demoted'} at emit time (×${operatorMult.toFixed(2)}); hypothesis ${hypothesisHit ? 'panned out' : 'fizzled'}`;
  const at = now();
  const rec = record('operator-ranking', {
    durationMs: 0,
    at,
    score: operatorMult,
    label: boosted ? 'boosted' : 'demoted',
  });
  recordOutcome(rec.id, outcome, reason, at);
  return outcome;
}

// ── Drift watch ───────────────────────────────────────────────────────────────

/** Fixed acceptable-F1 floor used as the Page-Hinkley reference. A rolling
 *  mean self-lowers as degradation fills the window (total degradation would
 *  never alert), so the reference is explicit: sustained F1 below 0.5 is
 *  degradation regardless of history. */
export const DRIFT_F1_FLOOR = 0.5;

/** Grading is sparse and irregular, so drift buckets are COUNT-based, not
 *  calendar-based: the algorithm's graded records are compacted onto a
 *  synthetic timeline with DRIFT_RECORDS_PER_BUCKET per bucket. A quiet
 *  week therefore never reads as an F1=0 bucket (which would fake
 *  degradation), and the newest bucket always contains the newest grades. */
const DRIFT_RECORDS_PER_BUCKET = 5;
const DRIFT_WINDOW_BUCKETS = 12;
const DRIFT_BUCKET_MS = 60_000; // synthetic spacing — any positive value works

/** Below this many graded records the F1 series is too thin for Page-
 *  Hinkley; the algorithm reports a non-alerting status instead. */
export const DRIFT_MIN_GRADED = 20;

/**
 * Production drift options. λ is deliberately reachable: with the fixed
 * 0.5 floor and δ=0.05, one fully-degraded bucket (F1=0) contributes 0.45,
 * so λ=2 trips after ~5 sustained fully-degraded buckets (≈25 consecutive
 * miss-grades) and cannot trip on 4 or fewer. (The stock evaluateDrift
 * default λ=50 is UNREACHABLE here — the statistic is bounded by
 * windowBuckets × 1.)
 */
export const COGNITION_DRIFT_OPTIONS: DriftDetectorOptions = {
  lambda: 2,
  delta: 0.05,
  threshold: DRIFT_F1_FLOOR,
  bucketMs: DRIFT_BUCKET_MS,
  windowBuckets: DRIFT_WINDOW_BUCKETS,
};

/** Compact an algorithm's graded records onto the synthetic count-based
 *  bucket timeline (newest record → newest bucket). */
function compactForDrift(records: readonly EvaluationRecord[], nowMs: number): EvaluationRecord[] {
  const graded = records.filter((r) => r.outcome !== undefined);
  graded.sort((a, b) => b.at - a.at);
  return graded
    .slice(0, DRIFT_RECORDS_PER_BUCKET * DRIFT_WINDOW_BUCKETS)
    .map((r, j) => ({
      ...r,
      at: nowMs - Math.floor(j / DRIFT_RECORDS_PER_BUCKET) * DRIFT_BUCKET_MS - DRIFT_BUCKET_MS / 2,
    }));
}

export interface CognitionDriftDeps {
  ledger?: Pick<AlgorithmEvaluationLedger, 'byAlgorithm'>;
  /** Drift options (default: COGNITION_DRIFT_OPTIONS). Merged over the
   *  production defaults, so a test can override just λ or `now`. */
  options?: DriftDetectorOptions;
  /** Alert sink (default: recordDriftAlert + cb:cognition-drift event).
   *  Fired only on the not-alerting → alerting TRANSITION per algorithm
   *  (deduped via persisted state), not on every pass while degraded. */
  onAlert?: (alert: DriftAlert) => void;
  /** Dedupe-state storage (default: localStorage; pass null to disable). */
  storage?: SelfTuningStorageLike | null;
  now?: () => number;
}

/** Default alert sink: drift history + `cb:cognition-drift` + desktop log. */
function defaultDriftAlertSink(alert: DriftAlert): void {
  recordDriftAlert(alert);
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('cb:cognition-drift', { detail: alert }));
    } catch { /* non-browser */ }
  }
  // eslint-disable-next-line no-console -- bridged to the desktop log; sustained cognition drift must be auditable
  console.warn(
    `[cognition-drift] ${alert.algorithmId}: F1 ${alert.lastStableF1.toFixed(2)} → ${alert.currentF1.toFixed(2)}`
    + ` (statistic ${alert.statistic.toFixed(1)}) — recommended action: ${alert.recommendedAction}`,
  );
}

/** Non-alerting placeholder status for algorithms below DRIFT_MIN_GRADED. */
function thinDataStatus(algorithmId: string): DriftStatus {
  return {
    algorithmId,
    statistic: 0,
    threshold: DRIFT_F1_FLOOR,
    currentF1: Number.NaN,
    alerting: false,
  };
}

/**
 * Evaluate Page-Hinkley drift for every cognition algorithm over its graded
 * ledger records (count-compacted; see compactForDrift). An algorithm
 * TRANSITIONING into sustained degradation gets a DriftAlert recorded in
 * the drift history and a `cb:cognition-drift` window event; while it stays
 * degraded, subsequent passes do not re-alert. Recovery clears the dedupe
 * flag so a later degradation alerts again. Returns all statuses.
 */
export function runCognitionDriftWatch(deps: CognitionDriftDeps = {}): DriftStatus[] {
  const ledger = deps.ledger ?? getAlgorithmEvaluationLedger();
  const onAlert = deps.onAlert ?? defaultDriftAlertSink;
  const storage = resolveStorage(deps.storage);
  const state = loadState(storage);
  const nowMs = deps.options?.now ? deps.options.now() : (deps.now ?? Date.now)();
  const options: DriftDetectorOptions = { ...COGNITION_DRIFT_OPTIONS, ...deps.options, now: () => nowMs };

  const out: DriftStatus[] = [];
  for (const id of COGNITION_ALGORITHM_IDS) {
    let records: readonly EvaluationRecord[];
    try {
      records = ledger.byAlgorithm(id);
    } catch {
      continue;
    }
    const compacted = compactForDrift(records, nowMs);
    const status = compacted.length < DRIFT_MIN_GRADED
      ? thinDataStatus(id)
      : evaluateDrift(compacted, id, options);
    out.push(status);

    const wasAlerting = state.driftAlerting[id] === true;
    if (status.alerting && status.alert) {
      if (!wasAlerting) onAlert(status.alert);
      state.driftAlerting[id] = true;
    } else {
      state.driftAlerting[id] = false;
    }
  }
  saveState(storage, state);
  return out;
}

// ── Cadence ───────────────────────────────────────────────────────────────────

export const SELF_TUNING_INTERVAL_MS = 6 * 60 * 60 * 1000;

const LAST_RUN_KEY = 'cb:cognition-selftune-last';
const TICK_MS = 30 * 60 * 1000;

export function shouldRunSelfTuning(lastRunMs: number | null, nowMs: number): boolean {
  if (lastRunMs === null) return true;
  return nowMs - lastRunMs >= SELF_TUNING_INTERVAL_MS;
}

/**
 * Start the periodic grading + drift-watch cadence (same shape as
 * consolidation-cadence.ts): checks every 30 min, runs at most every 6 h,
 * skipped in Ghost Mode. Never throws into the timer.
 */
export function startCognitionSelfTuningCadence(): void {
  setInterval(() => {
    try {
      if (isGhostMode()) return;
      const raw = localStorage.getItem(LAST_RUN_KEY);
      const lastRunMs = raw === null ? null : Number(raw);
      if (!shouldRunSelfTuning(Number.isFinite(lastRunMs) ? lastRunMs : null, Date.now())) return;
      runCognitionGradingPass();
      runCognitionDriftWatch();
      localStorage.setItem(LAST_RUN_KEY, String(Date.now()));
    } catch {
      // Never let the cadence timer crash the app.
    }
  }, TICK_MS);
}
