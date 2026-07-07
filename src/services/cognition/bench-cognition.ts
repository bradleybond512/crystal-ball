/**
 * Cognition Benchmark — "is the brain getting better?" (PR 16, last PR in
 * docs/COGNITIVE_ENHANCEMENT_PLAN.md Part D).
 *
 * Replays the frozen golden-window fixture corpus
 * (`__bench__/golden-windows.ts`) through the full deterministic cognition
 * pipeline:
 *
 *   episodic recall → base rate (outside view, blended with episodic) →
 *   aggregation → recalibration → conformal interval
 *
 * plus a held-out schema-matching stage (a self-contained, pure
 * reimplementation of PR 8 consolidation's clustering call — see the note
 * on `runSchemaStage` below for why this doesn't import the live
 * `consolidation.ts` singleton directly).
 *
 * Deliberately excludes the LLM-gated stages (decomposition, persona
 * elicitation) that `superforecast.ts` adds on top of the deterministic
 * floor: PR 3's own degradation ladder guarantees "base rate + episodic +
 * model-forecast" always works with the cloud budget at 0, and a CI gate
 * must be able to run fully offline, deterministically, and fast — so the
 * benchmark exercises exactly that deterministic floor. This is the same
 * reasoning documented in superforecast.test.mts's
 * budget-exhausted→deterministic-only case; the benchmark simply always
 * takes that path.
 *
 * Pure deterministic. No DOM, no fetch, no real IDB, no globals at import
 * time, no timers. Every stage is the same production function the live app
 * calls (matchReferenceClass, blendWithEpisodic, aggregate, buildCurve,
 * recalibrate, conformalInterval, analogScoreFor, runConsolidation) — the
 * benchmark is not a reimplementation of the algorithms, only of the
 * orchestration.
 */

import { matchReferenceClass, blendWithEpisodic } from './base-rates';
import { aggregate, type Estimate } from './probability-aggregation';
import { analogScoreFor } from './episodic-memory';
import { buildCurve, recalibrate } from './recalibration';
import { conformalInterval, type ForecastInterval, DEFAULT_ALPHA } from './conformal';
import {
  runConsolidation,
  resetConsolidationForTests,
  getAllSchemas,
  type LearnedSchema,
} from './consolidation';
import {
  GOLDEN_WINDOWS,
  CALIBRATION_POOL,
  TRAINING_EPISODES,
  type GoldenWindow,
} from './__bench__/golden-windows';
import type { PredictionRecord } from '@/services/intelligence/forecast-calibration';

// ── Public types ─────────────────────────────────────────────────────────────

export interface WindowBenchResult {
  windowId: string;
  factDomain: string;
  groundTruthOutcome: 0 | 1;
  referenceClassId: string | null;
  analogScore: number | null;
  aggregatedP: number;
  recalibratedP: number;
  interval: ForecastInterval;
  coveredByInterval: boolean;
  brierComponent: number;
  precisionAt5: number;
  schemaMatched: boolean;
  schemaPredictedMaterialize: boolean | null;
  latencyMs: number;
  explanation: string[];
}

export interface BenchReport {
  generatedAt: number;
  windowCount: number;
  alpha: number;
  targetCoverage: number;
  /** Mean squared error of recalibrated probability vs. ground truth (0..1, lower is better). */
  brier: number;
  /** Fraction of windows whose conformal interval contains the ground-truth outcome. */
  coverageRate: number;
  /** Mean fraction of each window's top-5 analog recalls whose implied outcome matches ground truth. */
  analogPrecisionAt5: number;
  /** Recall (TP / actual positives) of the schema stage, restricted to windows a learned schema matched. null when no matched window is an actual positive. */
  schemaTruePositiveRate: number | null;
  schemaMatchedCount: number;
  schemaTotalCount: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  results: WindowBenchResult[];
}

export interface BenchOptions {
  windows?: readonly GoldenWindow[];
  calibrationPool?: readonly PredictionRecord[];
  alpha?: number;
  now?: () => number;
  /** Injectable high-resolution clock for latency measurement (defaults to Date.now, ms resolution is enough at this scale). */
  clock?: () => number;
}

// ── Schema stage ─────────────────────────────────────────────────────────────

/**
 * Runs PR 8's consolidation clustering over the held-out training corpus and
 * returns the resulting LearnedSchema list.
 *
 * Calls `runConsolidation()` — the same public, fully-injectable entry point
 * `consolidation-cadence.ts` calls in production — with `storage: null` and
 * stub IDB functions, exactly the pattern `consolidation.test.mts` already
 * uses, so this never touches real localStorage/IndexedDB. `resetConsolidationForTests()`
 * is called first: it is the module's sanctioned way to get a clean,
 * repeatable pass (the benchmark needs byte-identical output on every run,
 * the same requirement any of its unit tests have) and does not touch the
 * live app's singleton state — this module only imports `consolidation.ts`
 * for the duration of the benchmark run.
 */
async function runSchemaStage(now: () => number): Promise<readonly LearnedSchema[]> {
  resetConsolidationForTests();
  await runConsolidation({
    episodeSource: () => TRAINING_EPISODES,
    registrar: { addSignature: (sig) => sig, removeSignature: () => true },
    storage: null,
    getMemoryFn: () => Promise.resolve(null),
    putMemoryFn: () => Promise.resolve(undefined),
    now,
  });
  return getAllSchemas();
}

function findMatchingSchema(window: GoldenWindow, schemas: readonly LearnedSchema[]): LearnedSchema | undefined {
  const windowDomains = window.hypothesis.domains ?? [];
  return schemas.find(s => !s.retired && s.domains.some(d => windowDomains.includes(d)));
}

// ── Per-window pipeline ────────────────────────────────────────────────────

const MIN_ANALOG_SIM = 0.45;

function runWindow(
  window: GoldenWindow,
  calibrationPool: readonly PredictionRecord[],
  alpha: number,
  schemas: readonly LearnedSchema[],
  clock: () => number,
): WindowBenchResult {
  const t0 = clock();
  const explanation: string[] = [];

  // Stage 1: episodic recall.
  const analogScore = analogScoreFor(window.analogRecalls);
  const analogN = window.analogRecalls.filter(
    r => r.similarity >= MIN_ANALOG_SIM && r.episode.outcome !== undefined,
  ).length;

  // Stage 2: base rate (outside view, blended with episodic).
  const rc = matchReferenceClass(window.hypothesis);
  const blended = rc
    ? blendWithEpisodic(rc, analogScore, analogN)
    : { rate: 0.3, explanation: 'no reference class matched — defaulting to 30% uninformative prior' };
  explanation.push(blended.explanation);

  // Stage 3: aggregation (base rate + deterministic model-forecast floor —
  // the same two estimates superforecast.ts's deterministic-only tier uses).
  const estimates: Estimate[] = [
    { source: 'base-rate', p: blended.rate, weight: 1 },
    { source: 'model-forecast', p: window.modelForecastP, weight: 1 },
  ];
  const agg = aggregate(estimates);
  explanation.push(agg.explanation);

  // Stage 4: recalibration.
  const curve = buildCurve(calibrationPool, window.factDomain);
  const recal = recalibrate(agg.p, curve);
  explanation.push(recal.explanation);

  // Stage 5: conformal interval.
  const interval = conformalInterval(recal.p, window.factDomain, calibrationPool, alpha);
  explanation.push(interval.explanation);
  const coveredByInterval = window.groundTruthOutcome >= interval.lo && window.groundTruthOutcome <= interval.hi;

  const brierComponent = (recal.p - window.groundTruthOutcome) ** 2;

  // Analog-recall precision@5: does each recalled analog's own outcome
  // direction (materialized/partial ⇒ "predicts materializes") agree with
  // this window's actual ground truth?
  const top5 = [...window.analogRecalls].sort((a, b) => b.similarity - a.similarity).slice(0, 5);
  const predictsMaterialize = (outcome: typeof top5[number]['episode']['outcome']): boolean =>
    outcome === 'materialized' || outcome === 'partial';
  const hits = top5.filter(r => (predictsMaterialize(r.episode.outcome) ? 1 : 0) === window.groundTruthOutcome).length;
  const precisionAt5 = top5.length > 0 ? hits / top5.length : 0;

  // Schema stage (held-out consolidation match).
  const schema = findMatchingSchema(window, schemas);
  const schemaPredictedMaterialize = schema ? schema.materializationRate >= 0.5 : null;

  const t1 = clock();

  return {
    windowId: window.id,
    factDomain: window.factDomain,
    groundTruthOutcome: window.groundTruthOutcome,
    referenceClassId: rc?.id ?? null,
    analogScore,
    aggregatedP: agg.p,
    recalibratedP: recal.p,
    interval,
    coveredByInterval,
    brierComponent,
    precisionAt5,
    schemaMatched: schema !== undefined,
    schemaPredictedMaterialize,
    latencyMs: t1 - t0,
    explanation,
  };
}

// ── Aggregate report ─────────────────────────────────────────────────────────

function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

/**
 * Run the full cognition benchmark over the golden-window corpus.
 *
 * Fully synchronous math wrapped in a Promise only because the schema stage
 * calls `runConsolidation()` (which returns a Promise, but resolves
 * synchronously with `storage: null` + stub IDB functions — no real I/O, no
 * timers). Typical wall time is low single-digit milliseconds for 12
 * windows; there is no unbounded work anywhere in this function.
 */
export async function runCognitionBenchmark(opts: BenchOptions = {}): Promise<BenchReport> {
  const windows = opts.windows ?? GOLDEN_WINDOWS;
  const calibrationPool = opts.calibrationPool ?? CALIBRATION_POOL;
  const alpha = opts.alpha ?? DEFAULT_ALPHA;
  const now = opts.now ?? (() => 1_700_000_000_000);
  const clock = opts.clock ?? (() => Date.now());

  const schemas = await runSchemaStage(now);

  const results = windows.map(w => runWindow(w, calibrationPool, alpha, schemas, clock));

  const brier = mean(results.map(r => r.brierComponent));
  const coverageRate = mean(results.map(r => (r.coveredByInterval ? 1 : 0)));
  const analogPrecisionAt5 = mean(results.map(r => r.precisionAt5));

  const matched = results.filter(r => r.schemaMatched);
  const matchedPositives = matched.filter(r => r.groundTruthOutcome === 1);
  const matchedTruePositives = matchedPositives.filter(r => r.schemaPredictedMaterialize === true);
  const schemaTruePositiveRate = matchedPositives.length > 0
    ? matchedTruePositives.length / matchedPositives.length
    : null;

  const latencies = results.map(r => r.latencyMs).sort((a, b) => a - b);

  return {
    generatedAt: now(),
    windowCount: results.length,
    alpha,
    targetCoverage: 1 - alpha,
    brier: Math.round(brier * 10_000) / 10_000,
    coverageRate: Math.round(coverageRate * 10_000) / 10_000,
    analogPrecisionAt5: Math.round(analogPrecisionAt5 * 10_000) / 10_000,
    schemaTruePositiveRate: schemaTruePositiveRate === null ? null : Math.round(schemaTruePositiveRate * 10_000) / 10_000,
    schemaMatchedCount: matched.length,
    schemaTotalCount: results.length,
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    results,
  };
}
