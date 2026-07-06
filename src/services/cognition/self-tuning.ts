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
 *   3. THIS MODULE grades them: a deterministic grading pass derives
 *      hit/miss/partial evaluation-ledger records from ground truth the app
 *      already collects (resolved episodes, resolved calibration-store
 *      predictions, dossier timelines, hypothesis-accuracy resolutions) —
 *      no LLM, no fabricated outcomes.
 *   4. THIS MODULE watches for drift: once graded, `evaluateDrift`
 *      (Page-Hinkley on rolling F1) runs over each cognition algorithm's
 *      ledger records; sustained degradation records a DriftAlert and emits
 *      `cb:cognition-drift`. Below-floor algorithms then flow through the
 *      existing safe-adjustment → policy-gate loop, whose fail-closed
 *      safety/backtest signals hold cognition proposals for OPERATOR
 *      APPROVAL (plan: "the operator approves; nothing self-applies").
 *
 * Grading semantics (all deterministic, all explained):
 *   - episodic-analog: an episode that resolves is a graded sample when an
 *     analog score was attached to its signature. Elevated (≥ 0.5) analog +
 *     materialized outcome = hit; partial outcomes grade 'partial'.
 *   - recalibration: each resolved (non-superforecast) calibration record
 *     is replayed through the CURRENT per-domain recalibrator; hit when the
 *     recalibrated probability lands on the correct side of 50%. Grades the
 *     curve in force against recent resolved reality — exactly the signal
 *     drift detection needs.
 *   - superforecast: resolved calibration records with sourceId
 *     'superforecast' (their probability IS the pipeline output); hit when
 *     the forecast lands on the correct side of 50%.
 *   - entity-trajectory: retrospective replay — recompute the trajectory as
 *     of 7 days ago from the timeline events known THEN, and check whether
 *     activity in the 7 days since actually rose (heating) or fell
 *     (cooling). 'stable' predictions are uninformative and skipped.
 *   - operator-ranking: graded at hypothesis resolution time
 *     (hypothesis-accuracy calls `gradeOperatorRankingOnResolution`): a
 *     personalization boost pointing at a hypothesis that panned out = hit;
 *     a boost on a fizzle (or a demotion on a hit) = miss. Neutral
 *     multipliers (±2%) carry no signal and are skipped.
 *
 * Watermarks prevent double-grading across passes and are persisted to
 * localStorage under `crystalball-cognition-selftune-v1`.
 *
 * Pure deterministic with injectable deps (episodes / records / dossiers /
 * recorder / storage / clock). No DOM, no fetch, no globals at import time.
 */

import type { Episode } from './episodic-memory';
import { getAllEpisodes, getCachedAnalogScore } from './episodic-memory';
import { getAllDossiers, computeTrajectory, type EntityDossier } from './entity-dossier';
import { interestMultiplier } from './operator-model';
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

const WATERMARK_STORAGE_KEY = 'crystalball-cognition-selftune-v1';

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

// ── Watermark persistence ─────────────────────────────────────────────────────

export interface SelfTuningStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface GradingWatermarks {
  /** Newest episode `resolvedAt` already graded (episodic-analog). */
  episodicResolvedThrough: number;
  /** Newest calibration-record `resolvedAt` already graded
   *  (recalibration + superforecast share the store). */
  calibrationResolvedThrough: number;
  /** entity → last graded trajectory cutoff (ms). */
  trajectoryGradedThrough: Record<string, number>;
}

function emptyWatermarks(): GradingWatermarks {
  return {
    episodicResolvedThrough: 0,
    calibrationResolvedThrough: 0,
    trajectoryGradedThrough: {},
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

function loadWatermarks(storage: SelfTuningStorageLike | null): GradingWatermarks {
  if (!storage) return emptyWatermarks();
  try {
    const raw = storage.getItem(WATERMARK_STORAGE_KEY);
    if (!raw) return emptyWatermarks();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyWatermarks();
    const p = parsed as Partial<GradingWatermarks>;
    return {
      episodicResolvedThrough: typeof p.episodicResolvedThrough === 'number' ? p.episodicResolvedThrough : 0,
      calibrationResolvedThrough: typeof p.calibrationResolvedThrough === 'number' ? p.calibrationResolvedThrough : 0,
      trajectoryGradedThrough:
        p.trajectoryGradedThrough && typeof p.trajectoryGradedThrough === 'object' && !Array.isArray(p.trajectoryGradedThrough)
          ? (p.trajectoryGradedThrough as Record<string, number>)
          : {},
    };
  } catch {
    return emptyWatermarks();
  }
}

function saveWatermarks(storage: SelfTuningStorageLike | null, wm: GradingWatermarks): void {
  if (!storage) return;
  // Cap the per-entity map — drop the oldest cutoffs first.
  const entries = Object.entries(wm.trajectoryGradedThrough);
  if (entries.length > MAX_TRAJECTORY_WATERMARKS) {
    entries.sort((a, b) => b[1] - a[1]);
    wm.trajectoryGradedThrough = Object.fromEntries(entries.slice(0, MAX_TRAJECTORY_WATERMARKS));
  }
  try {
    storage.setItem(WATERMARK_STORAGE_KEY, JSON.stringify(wm));
  } catch {
    /* quota — next pass may re-grade; the ledger tolerates duplicates */
  }
}

// ── Grading pass ──────────────────────────────────────────────────────────────

type RecordEvaluationFn = (algorithmId: string, input: RecordEvaluationInput) => { id: string };
type RecordOutcomeFn = (recordId: string, outcome: EvaluationOutcome, reason: string, at?: number) => unknown;

export interface CognitionGradingDeps {
  /** Episode source (default: episodic-memory singleton). */
  episodes?: readonly Episode[];
  /** Analog score lookup by signature (default: the analyst-cycle cache). */
  analogScoreForSignature?: (signature: string) => number | null;
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
  /** Watermark storage (default: localStorage; pass null to disable). */
  storage?: SelfTuningStorageLike | null;
  now?: () => number;
}

export interface CognitionGradingResult {
  /** Graded sample count per cognition algorithm this pass. */
  graded: Record<string, number>;
}

/** Recording context shared by the per-algorithm graders. */
interface GradingContext {
  record: RecordEvaluationFn;
  recordOutcome: RecordOutcomeFn;
  graded: Record<string, number>;
}

/** Record one evaluation + its outcome. Best-effort: a ledger failure never
 *  aborts the pass. Returns true when the sample was recorded. */
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

/** Grade decision for one resolved episode with an attached analog score. */
function episodicGradeFor(
  ep: Episode,
  analog: number,
): { outcome: EvaluationOutcome; reason: string; elevated: boolean } {
  const elevated = analog >= ELEVATED_BAR;
  const read = elevated ? 'elevated' : 'quiet';
  if (ep.outcome === 'partial') {
    return { outcome: 'partial', reason: `analog score ${analog.toFixed(2)} (${read}); episode partially materialized`, elevated };
  }
  const materialized = ep.outcome === 'materialized';
  return {
    outcome: elevated === materialized ? 'hit' : 'miss',
    reason: `analog score ${analog.toFixed(2)} read ${read}; episode ${String(ep.outcome)}`,
    elevated,
  };
}

/** episodic-analog: resolved episodes vs their attached analog score.
 *  Returns the new episodic watermark. */
function gradeEpisodicAnalog(
  ctx: GradingContext,
  episodes: readonly Episode[],
  analogFor: (signature: string) => number | null,
  resolvedThrough: number,
): number {
  let maxResolved = resolvedThrough;
  for (const ep of episodes) {
    if (ep.resolvedAt === undefined || ep.resolvedAt <= resolvedThrough) continue;
    maxResolved = Math.max(maxResolved, ep.resolvedAt);
    if (ep.outcome === undefined || ep.outcome === 'unknown') continue;
    const analog = analogFor(ep.signature);
    if (analog === null || !Number.isFinite(analog)) continue; // no analog decision was attached — nothing to grade
    const { outcome, reason, elevated } = episodicGradeFor(ep, analog);
    recordGrade(ctx, 'episodic-analog', {
      durationMs: 0,
      at: ep.resolvedAt,
      score: analog,
      label: elevated ? 'analog-elevated' : 'analog-quiet',
      inputHash: ep.signature.slice(0, 120),
    }, outcome, reason, ep.resolvedAt);
  }
  return maxResolved;
}

/** Which algorithm a calibration record grades, and with what probability.
 *  Superforecast records already carry the pipeline's final output; every
 *  other record is replayed through the recalibration curve currently in
 *  force (grades the live curve against recent resolved reality). Returns
 *  null when the recalibrator is unavailable for the record's domain. */
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

/** recalibration + superforecast: resolved calibration-store records,
 *  routed by sourceId. Returns the new calibration watermark. */
function gradeCalibrationForecasts(
  ctx: GradingContext,
  records: readonly PredictionRecord[],
  recalibratorFor: (domain: FactDomain) => (p: number) => { p: number },
  resolvedThrough: number,
): number {
  let maxResolved = resolvedThrough;
  for (const r of records) {
    if (r.status !== 'resolved_true' && r.status !== 'resolved_false') continue;
    if (typeof r.resolvedAt !== 'number' || r.resolvedAt <= resolvedThrough) continue;
    maxResolved = Math.max(maxResolved, r.resolvedAt);
    const materialized = r.status === 'resolved_true';

    const target = forecastGradeTarget(r, recalibratorFor);
    if (target === null || !Number.isFinite(target.p)) continue;
    const { algorithmId, p } = target;
    const fires = p >= 0.5;
    const outcome: EvaluationOutcome = fires === materialized ? 'hit' : 'miss';
    const reason = `${algorithmId} said ${(p * 100).toFixed(0)}% (raw ${(r.probability * 100).toFixed(0)}%); claim ${materialized ? 'materialized' : 'did not materialize'}`;
    recordGrade(ctx, algorithmId, {
      durationMs: 0,
      at: r.resolvedAt,
      score: p,
      label: fires ? 'forecast-likely' : 'forecast-unlikely',
      inputHash: r.id.slice(0, 120),
      detail: { domain: r.domain, rawP: Math.round(r.probability * 1000) / 1000 },
    }, outcome, reason, r.resolvedAt);
  }
  return maxResolved;
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
 *  per-entity watermark map for entities it grades. */
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
 * records for the cognition algorithms from already-resolved ground truth.
 * Safe to call repeatedly — watermarks prevent double-grading. Synchronous.
 */
export function runCognitionGradingPass(deps: CognitionGradingDeps = {}): CognitionGradingResult {
  const episodes = deps.episodes ?? getAllEpisodes();
  const analogFor = deps.analogScoreForSignature ?? getCachedAnalogScore;
  const records = deps.calibrationRecords ?? getCalibrationStore().all();
  const recalibratorFor = deps.recalibratorFor ?? ((domain: FactDomain) => getRecalibrator(domain));
  const dossiers = deps.dossiers ?? getAllDossiers();
  const storage = resolveStorage(deps.storage);
  const now = deps.now ?? Date.now;

  const wm = loadWatermarks(storage);
  const ctx: GradingContext = {
    record: deps.recordEvaluation ?? (recordAlgorithmEvaluation as RecordEvaluationFn),
    recordOutcome: deps.recordOutcome ?? (recordAlgorithmOutcome as RecordOutcomeFn),
    graded: {
      'episodic-analog': 0,
      'recalibration': 0,
      'superforecast': 0,
      'entity-trajectory': 0,
    },
  };

  wm.episodicResolvedThrough = gradeEpisodicAnalog(ctx, episodes, analogFor, wm.episodicResolvedThrough);
  wm.calibrationResolvedThrough = gradeCalibrationForecasts(ctx, records, recalibratorFor, wm.calibrationResolvedThrough);
  gradeEntityTrajectories(ctx, dossiers, wm.trajectoryGradedThrough, now());

  saveWatermarks(storage, wm);
  return { graded: ctx.graded };
}

// ── Operator-ranking grading (resolution-driven) ──────────────────────────────

export interface OperatorRankingGradeDeps {
  interestMultiplierFn?: (text: string) => number;
  recordEvaluation?: RecordEvaluationFn;
  recordOutcome?: RecordOutcomeFn;
  now?: () => number;
}

/**
 * Grade the operator-model's ranking personalization when a hypothesis
 * resolves (called from hypothesis-accuracy.gradeOne, fire-and-forget).
 *
 * A boost (multiplier > 1) pointing at a hypothesis that panned out is a
 * hit; a boost on a fizzle — or a demotion on a hit — is a miss. Neutral
 * multipliers (within ±2% of 1.0) carry no ranking signal → null.
 *
 * NOTE: the multiplier is recomputed at grade time (the value applied at
 * ranking time is not retained); interests decay on a half-life ≥ 3 days
 * while the grading window is 2 h, so the drift between the two is small.
 */
export function gradeOperatorRankingOnResolution(
  statement: string | undefined,
  hypothesisHit: boolean,
  deps: OperatorRankingGradeDeps = {},
): EvaluationOutcome | null {
  if (!statement) return null;
  const multFn = deps.interestMultiplierFn ?? interestMultiplier;
  const record = deps.recordEvaluation ?? (recordAlgorithmEvaluation as RecordEvaluationFn);
  const recordOutcome = deps.recordOutcome ?? (recordAlgorithmOutcome as RecordOutcomeFn);
  const now = deps.now ?? Date.now;

  const mult = multFn(statement);
  if (!Number.isFinite(mult) || Math.abs(mult - 1) <= NEUTRAL_BAND) return null;
  const boosted = mult > 1;
  const outcome: EvaluationOutcome = boosted === hypothesisHit ? 'hit' : 'miss';
  const reason = `operator model ${boosted ? 'boosted' : 'demoted'} (×${mult.toFixed(2)}); hypothesis ${hypothesisHit ? 'panned out' : 'fizzled'}`;
  const at = now();
  const rec = record('operator-ranking', {
    durationMs: 0,
    at,
    score: mult,
    label: boosted ? 'boosted' : 'demoted',
  });
  recordOutcome(rec.id, outcome, reason, at);
  return outcome;
}

// ── Drift watch ───────────────────────────────────────────────────────────────

export interface CognitionDriftDeps {
  ledger?: Pick<AlgorithmEvaluationLedger, 'byAlgorithm'>;
  options?: DriftDetectorOptions;
  /** Alert sink (default: recordDriftAlert + cb:cognition-drift event). */
  onAlert?: (alert: DriftAlert) => void;
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

/**
 * Evaluate Page-Hinkley drift for every cognition algorithm over its graded
 * ledger records. Alerting algorithms get a DriftAlert recorded in the
 * drift history and a `cb:cognition-drift` window event so the diagnostics
 * surface can pick it up. Returns all statuses (alerting or not).
 */
export function runCognitionDriftWatch(deps: CognitionDriftDeps = {}): DriftStatus[] {
  const ledger = deps.ledger ?? getAlgorithmEvaluationLedger();
  const onAlert = deps.onAlert ?? defaultDriftAlertSink;
  const out: DriftStatus[] = [];
  for (const id of COGNITION_ALGORITHM_IDS) {
    let records: readonly EvaluationRecord[];
    try {
      records = ledger.byAlgorithm(id);
    } catch {
      continue;
    }
    const status = evaluateDrift(records, id, deps.options ?? {});
    out.push(status);
    if (status.alerting && status.alert) onAlert(status.alert);
  }
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
