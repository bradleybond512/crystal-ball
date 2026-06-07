import assert from 'node:assert/strict';
import test from 'node:test';

import { createAlgorithmEvaluationLedger } from '../algorithm-evaluation-ledger.ts';
import { runTuningApply } from '../tuning-apply-runner.ts';
import { getTuningDecisions, _resetTuningDecisionsForTests } from '../tuning-decision-log.ts';
import type { AlgorithmDefinition } from '../algorithm-health.ts';
import type { AlgorithmAdjustmentTuning } from '../safe-adjustment.ts';

// jsdom-free: provide a minimal localStorage shim so the decision log persists
// within the node test process.
function installLocalStorage() {
  const map = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
  };
}
installLocalStorage();

const BED_DEF: AlgorithmDefinition = {
  algorithmId: 'big-event-detector',
  label: 'Big Event Detector',
  domain: 'reasoning_hypothesis',
  criticality: 'low',
};

/** A synthetic low-criticality, NON-notification algorithm with a tunable
 *  knob, used to exercise the auto-apply path without touching production
 *  declarations. */
const KNOB_DEF: AlgorithmDefinition = {
  algorithmId: 'test-knob-algo',
  label: 'Test Knob Algo',
  domain: 'reasoning_hypothesis',
  criticality: 'low',
  minWeightedHitRate: 0.9,
  minGradedSamples: 20,
};

const KNOB_TUNING: AlgorithmAdjustmentTuning = {
  algorithmId: 'test-knob-algo',
  parameters: [{
    parameterId: 'p',
    current: 10,
    min: 0,
    max: 20,
    step: 2,
    fixDirection: 'increase',
    description: 'test knob',
  }],
};

/** Build a ledger whose calibration for KNOB_DEF lands on 'degraded':
 *  20 graded, weightedHitRate 0.85 (17 hits + 3 misses) — just under the
 *  0.9 floor, gap 0.05 < 0.1. */
function degradedLedger() {
  const ledger = createAlgorithmEvaluationLedger({ now: () => 1 });
  for (let i = 0; i < 20; i += 1) {
    const rec = ledger.recordEvaluation({
      algorithmId: 'test-knob-algo',
      domain: 'reasoning_hypothesis',
      at: i,
      durationMs: 5,
    });
    ledger.recordOutcome(rec.id, i < 17 ? 'hit' : 'miss', 'test', i);
  }
  return ledger;
}

/** Ledger with no graded data → health 'unknown' → no proposals. */
test('no proposals when there is no graded evidence', () => {
  const ledger = createAlgorithmEvaluationLedger({ now: () => 1 });
  const captured: Array<[string, string, number]> = [];
  const res = runTuningApply({
    ledger,
    definitions: [BED_DEF],
    replayPassed: true,
    apply: (a, p, v) => captured.push([a, p, v]),
  });
  assert.deepEqual(res, { proposed: 0, applied: 0, heldForApproval: 0 });
  assert.equal(captured.length, 0);
});

/** Smoke: runs against the live singletons without throwing and returns a
 *  well-formed result. */
test('runs against live singletons without throwing', () => {
  const res = runTuningApply();
  assert.equal(typeof res.proposed, 'number');
  assert.equal(typeof res.applied, 'number');
  assert.equal(typeof res.heldForApproval, 'number');
  // Conservative default (no replay/backtest evidence wired) never auto-applies.
  assert.equal(res.applied, 0);
});

/** Held path: a degraded low-criticality knob with no replay evidence is
 *  proposed but held for approval, and the decision is logged. */
test('a proposal without replay evidence is held and logged', () => {
  _resetTuningDecisionsForTests();
  const captured: Array<[string, string, number]> = [];
  const res = runTuningApply({
    ledger: degradedLedger(),
    definitions: [KNOB_DEF],
    tunings: [KNOB_TUNING],
    // replayPassed defaults to false
    apply: (a, p, v) => captured.push([a, p, v]),
  });
  assert.deepEqual(res, { proposed: 1, applied: 0, heldForApproval: 1 });
  assert.equal(captured.length, 0, 'nothing applied');

  const log = getTuningDecisions();
  assert.equal(log.length, 1);
  assert.equal(log[0]?.kind, 'held_for_approval');
  assert.equal(log[0]?.algorithmId, 'test-knob-algo');
  assert.equal(log[0]?.priorValue, 10);
  assert.equal(log[0]?.nextValue, 12);
  assert.equal(log[0]?.ruleId, 'algo_tuning_gate_lowmed_pending');
});

/** Applied path: with an honest replay pass + ≥20 graded samples on a
 *  low-criticality, non-notification knob, the loop auto-applies and logs
 *  the change. Proves the act-path end-to-end. */
test('a proposal with replay pass + evidence auto-applies and logs', () => {
  _resetTuningDecisionsForTests();
  const captured: Array<[string, string, number]> = [];
  const res = runTuningApply({
    ledger: degradedLedger(),
    definitions: [KNOB_DEF],
    tunings: [KNOB_TUNING],
    replayPassed: true,
    apply: (a, p, v) => captured.push([a, p, v]),
  });
  assert.deepEqual(res, { proposed: 1, applied: 1, heldForApproval: 0 });
  assert.deepEqual(captured, [['test-knob-algo', 'p', 12]]);

  const log = getTuningDecisions();
  assert.equal(log.length, 1);
  assert.equal(log[0]?.kind, 'applied');
  assert.equal(log[0]?.nextValue, 12);
  assert.equal(log[0]?.ruleId, 'algo_tuning_gate_lowmed_ready');
});
