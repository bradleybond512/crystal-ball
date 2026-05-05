import assert from 'node:assert/strict';
import test from 'node:test';

import {
  snapToGrid,
  sampleParam,
  sampleConfig,
  hillClimb,
  clampConfigToSafetyBound,
  runTuningCycle,
  recordTuningRun,
  getTuningHistory,
  _resetTuningHistoryForTests,
  type ParamConfig,
  type TuningEvaluator,
} from '../adaptive-tuner.ts';
import type { TunableParameter } from '../safe-adjustment.ts';

const NOW = 1_745_000_000_000;

const params: TunableParameter[] = [
  { parameterId: 'threshold', current: 0.5, min: 0, max: 1, step: 0.01, fixDirection: 'decrease', description: 't' },
  { parameterId: 'buffer-km', current: 10, min: 0, max: 50, step: 1, fixDirection: 'increase', description: 'b' },
];

// Deterministic RNG (linear congruential).
function makeRng(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 0x1_0000_0000;
    return s / 0x1_0000_0000;
  };
}

// ── Snapping & sampling ──────────────────────────────────────────────

test('snapToGrid: clamps below min', () => {
  assert.equal(snapToGrid(-5, params[0]!), 0);
});

test('snapToGrid: clamps above max', () => {
  assert.equal(snapToGrid(99, params[0]!), 1);
});

test('snapToGrid: rounds to nearest step', () => {
  assert.equal(snapToGrid(0.123, params[0]!), 0.12);
  assert.equal(snapToGrid(0.127, params[0]!), 0.13);
});

test('sampleParam: stays within bounds', () => {
  const rng = makeRng(42);
  for (let i = 0; i < 20; i += 1) {
    const v = sampleParam(params[0]!, rng);
    assert.ok(v >= 0 && v <= 1);
  }
});

test('sampleConfig: produces an entry for every parameter', () => {
  const rng = makeRng();
  const c = sampleConfig(params, rng);
  assert.ok('threshold' in c);
  assert.ok('buffer-km' in c);
});

// ── Hill climb ────────────────────────────────────────────────────────

test('hillClimb: improves toward optimum', () => {
  // Evaluator with global max at threshold=0.7
  const evaluator: TuningEvaluator = (c) => 1 - Math.abs((c.threshold ?? 0) - 0.7);
  const start: ParamConfig = { threshold: 0.5, 'buffer-km': 10 };
  const out = hillClimb(start, [params[0]!], evaluator, { iterations: 200, rng: makeRng(7) });
  assert.ok(out.f1 >= 1 - Math.abs(0.5 - 0.7) - 1e-9);
});

// ── Safety rails ──────────────────────────────────────────────────────

test('clampConfigToSafetyBound: clamps deltas above maxRelativeChange', () => {
  const prior: ParamConfig = { threshold: 0.5, 'buffer-km': 10 };
  const proposed: ParamConfig = { threshold: 0.9, 'buffer-km': 10 };
  const r = clampConfigToSafetyBound(proposed, prior, params, 0.2);
  // 20% of 0.5 = 0.1 → max threshold = 0.6 (snapped to grid step 0.01)
  assert.ok((r.clamped.threshold ?? 0) <= 0.6 + 1e-9);
  assert.deepEqual(r.clamped_params, ['threshold']);
});

test('clampConfigToSafetyBound: leaves small deltas alone', () => {
  const prior: ParamConfig = { threshold: 0.5, 'buffer-km': 10 };
  const proposed: ParamConfig = { threshold: 0.55, 'buffer-km': 11 };
  const r = clampConfigToSafetyBound(proposed, prior, params, 0.2);
  assert.equal(r.clamped.threshold, 0.55);
  assert.equal(r.clamped_params.length, 0);
});

// ── End-to-end runs ──────────────────────────────────────────────────

test('runTuningCycle: rejects too few grades', () => {
  const result = runTuningCycle({
    algorithmId: 'a',
    parameters: params,
    currentF1: 0.5,
    newGrades: 5,
    evaluator: () => 0.9,
    rng: makeRng(1),
    now: () => NOW,
  });
  assert.equal(result.verdict, 'rejected_too_few_grades');
});

test('runTuningCycle: no_tunable when parameters empty', () => {
  const result = runTuningCycle({
    algorithmId: 'a',
    parameters: [],
    currentF1: 0.5,
    newGrades: 100,
    evaluator: () => 0.9,
    rng: makeRng(1),
    now: () => NOW,
  });
  assert.equal(result.verdict, 'no_tunable');
});

test('runTuningCycle: rejects when no improvement above threshold', () => {
  const result = runTuningCycle({
    algorithmId: 'a',
    parameters: params,
    currentF1: 0.99,
    newGrades: 100,
    evaluator: () => 0.5, // worse than current
    rng: makeRng(1),
    now: () => NOW,
  });
  assert.equal(result.verdict, 'rejected_no_improvement');
});

test('runTuningCycle: applies when search finds improvement', () => {
  // Evaluator that rewards threshold close to 0.6 (within safety bound 20% of 0.5)
  const evaluator: TuningEvaluator = (c) => 1 - Math.abs((c.threshold ?? 0) - 0.6);
  const result = runTuningCycle({
    algorithmId: 'a',
    parameters: params,
    currentF1: 0.5,
    newGrades: 100,
    evaluator,
    rng: makeRng(11),
    now: () => NOW,
    sampleCount: 80,
    hillClimbIterations: 20,
  });
  assert.equal(result.verdict, 'applied');
  assert.ok(result.bestConfig);
  assert.ok((result.bestConfig!.threshold ?? 0) >= 0.4);
  assert.ok((result.bestConfig!.threshold ?? 0) <= 0.6 + 1e-9);
});

test('runTuningCycle: enforces 20% relative-change bound', () => {
  // Evaluator strongly prefers threshold=1.0 (way outside the bound)
  const evaluator: TuningEvaluator = (c) => (c.threshold ?? 0);
  const result = runTuningCycle({
    algorithmId: 'a',
    parameters: params,
    currentF1: 0.5,
    newGrades: 100,
    evaluator,
    rng: makeRng(3),
    now: () => NOW,
  });
  // Even though evaluator wants 1.0, safety bound caps threshold at 0.6.
  if (result.bestConfig) {
    assert.ok((result.bestConfig.threshold ?? 0) <= 0.6 + 1e-9);
  }
});

// ── Audit trail ──────────────────────────────────────────────────────

test('recordTuningRun + getTuningHistory: round-trip', () => {
  _resetTuningHistoryForTests();
  recordTuningRun({
    algorithmId: 'x',
    verdict: 'applied',
    bestF1: 0.8,
    improvement: 0.1,
    priorConfig: { threshold: 0.5 },
    paramDelta: { threshold: 0.05 },
    notes: ['ok'],
    generatedAt: NOW,
  });
  const list = getTuningHistory('x');
  assert.equal(list.length, 1);
  assert.equal(list[0]!.verdict, 'applied');
});

test('recordTuningRun: trims to maxPerAlgorithm', () => {
  _resetTuningHistoryForTests();
  for (let i = 0; i < 10; i += 1) {
    recordTuningRun({
      algorithmId: 'y',
      verdict: 'applied',
      bestF1: 0.8,
      improvement: 0.1,
      priorConfig: {},
      paramDelta: {},
      notes: [`run-${i}`],
      generatedAt: NOW + i,
    }, { maxPerAlgorithm: 3 });
  }
  assert.equal(getTuningHistory('y').length, 3);
});
