/**
 * Adaptive Parameter Tuning — PR 15.
 *
 * After each grading batch, attempt to improve algorithm parameters
 * automatically using a simplified Tree-structured Parzen Estimator
 * (TPE): sample 50 random configurations, evaluate on the most-recent
 * 100 graded fixtures, keep the top 5, then hill-climb around the
 * best.
 *
 * Safety rails:
 *   - Never change a parameter by more than 20% per cycle.
 *   - Require >=5% F1 improvement before accepting a new config.
 *   - Refuse to act below the configured minimum new-grade count.
 *
 * The cycle is pure deterministic given an injectable evaluator and
 * RNG. Production code wires Math.random + a real evaluator.
 */

import type { TunableParameter } from './safe-adjustment.ts';

// ── Public types ──────────────────────────────────────────────────────

export type ParamConfig = Record<string, number>;

/** Evaluate a parameter configuration against the provided fixture
 *  set. Higher F1 is better; must be deterministic for a fixed
 *  config. */
export type TuningEvaluator = (config: ParamConfig) => number;

export interface TuningRunInput {
  algorithmId: string;
  /** Tunable parameters declared in the algorithm registry. */
  parameters: readonly TunableParameter[];
  /** F1 score the algorithm currently runs at. */
  currentF1: number;
  /** Number of new grades since the last tuning run. */
  newGrades: number;
  /** Fixtures to evaluate against. The TPE sampler does not look at
   *  fixtures directly — they are passed to the evaluator opaquely. */
  evaluator: TuningEvaluator;
  rng?: () => number;
  now?: () => number;
}

export type TuningVerdict =
  | 'applied'
  | 'rejected_no_improvement'
  | 'rejected_safety_bound'
  | 'rejected_too_few_grades'
  | 'no_tunable';

export interface TuningRunResult {
  algorithmId: string;
  verdict: TuningVerdict;
  /** Best new config the search produced. Undefined when no_tunable
   *  or no candidate beat the safety bound. */
  bestConfig?: ParamConfig;
  /** Best F1 the search achieved on the fixtures. */
  bestF1: number;
  /** F1 improvement over currentF1 in absolute points. */
  improvement: number;
  /** Audit: the prior config (before the run). */
  priorConfig: ParamConfig;
  /** Audit: per-parameter delta (new - prior). */
  paramDelta: Record<string, number>;
  /** Plain-English notes about the run. */
  notes: readonly string[];
  generatedAt: number;
}

export interface TunerOptions {
  /** Minimum new-grade count required to attempt a run. Default 20. */
  minNewGrades?: number;
  /** Random search sample count. Default 50. */
  sampleCount?: number;
  /** Top-k configs kept for hill-climbing. Default 5. */
  topK?: number;
  /** Hill-climb iterations. Default 10. */
  hillClimbIterations?: number;
  /** Maximum fractional change per parameter per cycle. Default 0.2. */
  maxRelativeChange?: number;
  /** Required absolute F1 improvement to accept. Default 0.05. */
  improvementThreshold?: number;
}

const DEFAULTS: Required<TunerOptions> = {
  minNewGrades: 20,
  sampleCount: 50,
  topK: 5,
  hillClimbIterations: 10,
  maxRelativeChange: 0.2,
  improvementThreshold: 0.05,
};

// ── Sampling ──────────────────────────────────────────────────────────

/** Snap a value to the parameter's grid (min..max in steps of step). */
export function snapToGrid(value: number, p: TunableParameter): number {
  if (value < p.min) return p.min;
  if (value > p.max) return p.max;
  if (p.step <= 0) return value;
  const offset = value - p.min;
  const snapped = p.min + Math.round(offset / p.step) * p.step;
  if (snapped < p.min) return p.min;
  if (snapped > p.max) return p.max;
  return snapped;
}

/** Sample a uniformly-random value within the parameter's bounds,
 *  snapped to the step grid. */
export function sampleParam(p: TunableParameter, rng: () => number): number {
  const raw = p.min + rng() * (p.max - p.min);
  return snapToGrid(raw, p);
}

/** Sample one full configuration. */
export function sampleConfig(
  parameters: readonly TunableParameter[],
  rng: () => number,
): ParamConfig {
  const out: ParamConfig = {};
  for (const p of parameters) out[p.parameterId] = sampleParam(p, rng);
  return out;
}

// ── Hill climb ────────────────────────────────────────────────────────

/** Move one step on the parameter grid (up or down). */
function neighborStep(p: TunableParameter, current: number, rng: () => number): number {
  const direction = rng() < 0.5 ? -1 : 1;
  const next = current + direction * (p.step || (p.max - p.min) / 50);
  return snapToGrid(next, p);
}

export function hillClimb(
  start: ParamConfig,
  parameters: readonly TunableParameter[],
  evaluator: TuningEvaluator,
  options: { iterations: number; rng: () => number },
): { config: ParamConfig; f1: number } {
  let best = { ...start };
  let bestF1 = evaluator(best);
  for (let i = 0; i < options.iterations; i += 1) {
    const candidate = { ...best };
    // Perturb one random parameter.
    const idx = Math.floor(options.rng() * parameters.length);
    const target = parameters[idx];
    if (!target) continue;
    candidate[target.parameterId] = neighborStep(
      target,
      candidate[target.parameterId] ?? target.current,
      options.rng,
    );
    const score = evaluator(candidate);
    if (score > bestF1) {
      best = candidate;
      bestF1 = score;
    }
  }
  return { config: best, f1: bestF1 };
}

// ── Safety rails ──────────────────────────────────────────────────────

/** Clamp the proposed config so no parameter shifts by more than
 *  maxRelativeChange. Returns the clamped config plus a list of
 *  parameters whose proposal was clamped. */
export function clampConfigToSafetyBound(
  proposed: ParamConfig,
  prior: ParamConfig,
  parameters: readonly TunableParameter[],
  maxRelativeChange: number,
): { clamped: ParamConfig; clamped_params: string[] } {
  const out: ParamConfig = { ...proposed };
  const clampedParams: string[] = [];
  for (const p of parameters) {
    const before = prior[p.parameterId] ?? p.current;
    const after = proposed[p.parameterId] ?? before;
    if (before === 0) {
      // Cannot compute a relative bound on zero — fall back to step-based.
      const limit = p.step * 5;
      if (Math.abs(after - before) > limit) {
        out[p.parameterId] = snapToGrid(before + Math.sign(after - before) * limit, p);
        clampedParams.push(p.parameterId);
      }
      continue;
    }
    const maxDelta = Math.abs(before) * maxRelativeChange;
    const delta = after - before;
    if (Math.abs(delta) > maxDelta) {
      out[p.parameterId] = snapToGrid(before + Math.sign(delta) * maxDelta, p);
      clampedParams.push(p.parameterId);
    }
  }
  return { clamped: out, clamped_params: clampedParams };
}

// ── Top-level cycle ───────────────────────────────────────────────────

/** Run one TPE-flavored tuning cycle. */
export function runTuningCycle(
  input: TuningRunInput,
  options: TunerOptions = {},
): TuningRunResult {
  const opts = { ...DEFAULTS, ...options };
  const rng = input.rng ?? Math.random;
  const generatedAt = (input.now ?? (() => Date.now()))();

  const priorConfig: ParamConfig = {};
  for (const p of input.parameters) priorConfig[p.parameterId] = p.current;

  const baseResult: Pick<TuningRunResult, 'algorithmId' | 'priorConfig' | 'generatedAt'> = {
    algorithmId: input.algorithmId,
    priorConfig,
    generatedAt,
  };

  if (input.parameters.length === 0) {
    return {
      ...baseResult,
      verdict: 'no_tunable',
      bestF1: input.currentF1,
      improvement: 0,
      paramDelta: {},
      notes: ['no tunable parameters declared for algorithm'],
    };
  }

  if (input.newGrades < opts.minNewGrades) {
    return {
      ...baseResult,
      verdict: 'rejected_too_few_grades',
      bestF1: input.currentF1,
      improvement: 0,
      paramDelta: {},
      notes: [
        `only ${input.newGrades} new grades — need at least ${opts.minNewGrades} before tuning`,
      ],
    };
  }

  // Step 1: random search.
  const samples: { config: ParamConfig; f1: number }[] = [];
  for (let i = 0; i < opts.sampleCount; i += 1) {
    const config = sampleConfig(input.parameters, rng);
    const f1 = input.evaluator(config);
    samples.push({ config, f1 });
  }
  samples.sort((a, b) => b.f1 - a.f1);

  // Step 2: hill-climb from each top-k seed.
  const topSeeds = samples.slice(0, opts.topK);
  let best = { config: { ...priorConfig }, f1: input.evaluator(priorConfig) };
  for (const seed of topSeeds) {
    const climbed = hillClimb(seed.config, input.parameters, input.evaluator, {
      iterations: opts.hillClimbIterations,
      rng,
    });
    if (climbed.f1 > best.f1) best = climbed;
  }

  // Step 3: enforce safety rails (max-relative-change).
  const { clamped, clamped_params } = clampConfigToSafetyBound(
    best.config,
    priorConfig,
    input.parameters,
    opts.maxRelativeChange,
  );
  const clampedF1 = input.evaluator(clamped);

  const improvement = clampedF1 - input.currentF1;
  const paramDelta = computeParamDelta(input.parameters, priorConfig, clamped);
  return finalizeVerdict({
    base: baseResult,
    clamped,
    clampedF1,
    clampedParams: clamped_params,
    improvement,
    improvementThreshold: opts.improvementThreshold,
    currentF1: input.currentF1,
    paramDelta,
  });
}

function computeParamDelta(
  parameters: readonly TunableParameter[],
  priorConfig: ParamConfig,
  clamped: ParamConfig,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of parameters) {
    const before = priorConfig[p.parameterId] ?? 0;
    const after = clamped[p.parameterId] ?? before;
    if (before !== after) out[p.parameterId] = after - before;
  }
  return out;
}

function finalizeVerdict(args: {
  base: Pick<TuningRunResult, 'algorithmId' | 'priorConfig' | 'generatedAt'>;
  clamped: ParamConfig;
  clampedF1: number;
  clampedParams: string[];
  improvement: number;
  improvementThreshold: number;
  currentF1: number;
  paramDelta: Record<string, number>;
}): TuningRunResult {
  const { base, clamped, clampedF1, clampedParams, improvement, improvementThreshold, currentF1, paramDelta } = args;
  const clampNote = clampedParams.length > 0 ? [`clamped params: ${clampedParams.join(', ')}`] : [];

  if (improvement < improvementThreshold) {
    return {
      ...base,
      verdict: 'rejected_no_improvement',
      bestConfig: clamped,
      bestF1: clampedF1,
      improvement,
      paramDelta,
      notes: [
        `best candidate yielded F1 ${clampedF1.toFixed(3)} vs current ${currentF1.toFixed(3)} — below threshold ${improvementThreshold}`,
        ...clampNote,
      ],
    };
  }
  if (clampedParams.length > 0 && Object.keys(paramDelta).length === 0) {
    return {
      ...base,
      verdict: 'rejected_safety_bound',
      bestConfig: clamped,
      bestF1: clampedF1,
      improvement,
      paramDelta,
      notes: [`every parameter pinned by safety bound; refusing to apply`],
    };
  }
  return {
    ...base,
    verdict: 'applied',
    bestConfig: clamped,
    bestF1: clampedF1,
    improvement,
    paramDelta,
    notes: [
      `applied: F1 ${currentF1.toFixed(3)} → ${clampedF1.toFixed(3)} (Δ +${improvement.toFixed(3)})`,
      ...clampNote,
    ],
  };
}

// ── Audit trail ───────────────────────────────────────────────────────

const tuningHistory = new Map<string, TuningRunResult[]>();

export function recordTuningRun(result: TuningRunResult, options: { maxPerAlgorithm?: number } = {}): void {
  const max = options.maxPerAlgorithm ?? 100;
  const list = tuningHistory.get(result.algorithmId) ?? [];
  list.push({ ...result, paramDelta: { ...result.paramDelta } });
  while (list.length > max) list.shift();
  tuningHistory.set(result.algorithmId, list);
}

export function getTuningHistory(algorithmId: string): TuningRunResult[] {
  return [...(tuningHistory.get(algorithmId) ?? [])];
}

export function listAllTuningHistory(): Record<string, TuningRunResult[]> {
  const out: Record<string, TuningRunResult[]> = {};
  for (const [id, list] of tuningHistory) out[id] = [...list];
  return out;
}

export function _resetTuningHistoryForTests(): void {
  tuningHistory.clear();
}
