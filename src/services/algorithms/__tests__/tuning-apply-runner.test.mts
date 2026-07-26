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

/** B2-enable: the REAL safety check (no injected replayPassed) drives a
 *  live auto-apply for negative-evidence.maxPenalty. Proves the loop now
 *  acts in production when a change clears the honest safety fixtures. */
const NEGEV_DEF: AlgorithmDefinition = {
  algorithmId: 'negative-evidence',
  label: 'Negative evidence engine',
  domain: 'negative_evidence',
  criticality: 'medium',
  minWeightedHitRate: 0.9,
  minGradedSamples: 20,
};

const NEGEV_TUNING: AlgorithmAdjustmentTuning = {
  algorithmId: 'negative-evidence',
  parameters: [{
    parameterId: 'maxPenalty',
    current: 0.6,
    min: 0.2,
    max: 0.9,
    step: 0.1,
    fixDirection: 'decrease',
    description: 'max absence penalty',
  }],
};

function degradedNegEvLedger() {
  const ledger = createAlgorithmEvaluationLedger({ now: () => 1 });
  for (let i = 0; i < 20; i += 1) {
    const rec = ledger.recordEvaluation({
      algorithmId: 'negative-evidence',
      domain: 'negative_evidence',
      at: i,
      durationMs: 5,
    });
    ledger.recordOutcome(rec.id, i < 17 ? 'hit' : 'miss', 'test', i);
  }
  return ledger;
}

test('the real safety check auto-applies a non-regressing negative-evidence step', () => {
  _resetTuningDecisionsForTests();
  const captured: Array<[string, string, number]> = [];
  const res = runTuningApply({
    ledger: degradedNegEvLedger(),
    definitions: [NEGEV_DEF],
    tunings: [NEGEV_TUNING],
    // NO replayPassed override — the runner computes it from the real
    // tuning-safety fixtures. 0.6 → 0.5 is a non-regressing step → safe.
    apply: (a, p, v) => captured.push([a, p, v]),
  });
  assert.equal(res.applied, 1, 'safe non-regressing step auto-applied');
  assert.equal(captured.length, 1);
  assert.equal(captured[0]?.[0], 'negative-evidence');
  assert.equal(captured[0]?.[1], 'maxPenalty');
  assert.ok(Math.abs((captured[0]?.[2] ?? 0) - 0.5) < 1e-6, 'applied ~0.5');
  assert.equal(getTuningDecisions()[0]?.kind, 'applied');
});

test('a throwing safetyCheck fails closed for that proposal (no abort, no apply)', () => {
  _resetTuningDecisionsForTests();
  const captured: Array<[string, string, number]> = [];
  const res = runTuningApply({
    ledger: degradedNegEvLedger(),
    definitions: [NEGEV_DEF],
    tunings: [NEGEV_TUNING],
    safetyCheck: () => { throw new Error('scorer blew up'); },
    apply: (a, p, v) => captured.push([a, p, v]),
  });
  // The pass completes; the proposal is held (replayPassed forced false).
  assert.deepEqual(res, { proposed: 1, applied: 0, heldForApproval: 1 });
  assert.equal(captured.length, 0);
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

test('historical algorithm versions cannot drive tuning of the active version', () => {
  _resetTuningDecisionsForTests();
  const ledger = degradedLedger();
  const current = ledger.recordEvaluation({
    algorithmId: 'test-knob-algo',
    domain: 'reasoning_hypothesis',
    version: '2.0.0',
    at: 21,
    durationMs: 5,
  });
  ledger.recordOutcome(current.id, 'miss', 'current-version fixture', 21);

  const res = runTuningApply({
    ledger,
    definitions: [{ ...KNOB_DEF, version: '2.0.0' }],
    tunings: [KNOB_TUNING],
    replayPassed: true,
    apply: () => { throw new Error('insufficient current-version evidence must not tune'); },
  });

  assert.deepEqual(res, { proposed: 0, applied: 0, heldForApproval: 0 });
  assert.equal(getTuningDecisions().length, 0);
});

// ── Backtest-before-apply gate (Phase 4) ───────────────────────────────────

/** High-criticality, non-notification knob with a degraded calibration over
 *  ≥30 graded samples — the high tuning gate needs replay + backtest + 30
 *  samples. */
const HIGHCRIT_DEF: AlgorithmDefinition = {
  algorithmId: 'test-highcrit-algo',
  label: 'High-criticality test knob',
  domain: 'other',
  criticality: 'high',
  minWeightedHitRate: 0.9,
  minGradedSamples: 20,
};

const HIGHCRIT_TUNING: AlgorithmAdjustmentTuning = {
  algorithmId: 'test-highcrit-algo',
  parameters: [{
    parameterId: 'p',
    current: 10,
    min: 0,
    max: 20,
    step: 2,
    fixDirection: 'increase',
    description: 'high-crit test knob',
  }],
};

/** 30 graded (26 hit + 4 miss) → weightedHitRate 0.867, gap 0.033 < 0.1 →
 *  'degraded' → an 'apply' proposal. evidenceCount 30 clears the high gate's
 *  sample floor, isolating the backtest signal as the deciding factor. */
function degradedHighcritLedger() {
  const ledger = createAlgorithmEvaluationLedger({ now: () => 1 });
  for (let i = 0; i < 30; i += 1) {
    const r = ledger.recordEvaluation({
      algorithmId: 'test-highcrit-algo',
      domain: 'other',
      at: i,
      durationMs: 5,
    });
    ledger.recordOutcome(r.id, i < 26 ? 'hit' : 'miss', 'test', i);
  }
  return ledger;
}

test('high-criticality knob is HELD when the computed backtest fails closed (not backtestable)', () => {
  _resetTuningDecisionsForTests();
  const captured: Array<[string, string, number]> = [];
  const res = runTuningApply({
    ledger: degradedHighcritLedger(),
    definitions: [HIGHCRIT_DEF],
    tunings: [HIGHCRIT_TUNING],
    replayPassed: true,
    // backtestPassed UNSET → runner computes it. 'test-highcrit-algo:p' is not
    // a backtestable knob, so the honest backtest fails closed → held.
    apply: (a, p, v) => captured.push([a, p, v]),
  });
  assert.deepEqual(res, { proposed: 1, applied: 0, heldForApproval: 1 });
  assert.equal(captured.length, 0);
  assert.equal(getTuningDecisions()[0]?.ruleId, 'algo_tuning_gate_high_pending');
});

test('high-criticality knob auto-applies once backtestPassed clears (signal is load-bearing)', () => {
  _resetTuningDecisionsForTests();
  const captured: Array<[string, string, number]> = [];
  const res = runTuningApply({
    ledger: degradedHighcritLedger(),
    definitions: [HIGHCRIT_DEF],
    tunings: [HIGHCRIT_TUNING],
    replayPassed: true,
    backtestPassed: true, // injected pass → high gate clears
    apply: (a, p, v) => captured.push([a, p, v]),
  });
  assert.deepEqual(res, { proposed: 1, applied: 1, heldForApproval: 0 });
  assert.deepEqual(captured, [['test-highcrit-algo', 'p', 12]]);
  assert.equal(getTuningDecisions()[0]?.ruleId, 'algo_tuning_gate_high_ready');
});

// ── P1: hard backtest enforcement, independent of criticality ──────────────
// The policy gate only consults `backtestPassed` for high-criticality tunings.
// A LOW-criticality, backtestable knob whose replay REGRESSES accuracy must
// still be blocked — otherwise it would auto-apply (it clears replay + the
// low/med gate). The runner enforces this before the gate.

const DAY = 24 * 60 * 60 * 1000;
const BT_NOW = 100 * DAY;

/** big-event-detector is the one backtestable knob. Build a LOW-criticality
 *  definition + a threshold tuning that increases (40 → 45), and a ledger whose
 *  records make that increase a measurable regression: 26 genuine hits and 4
 *  false positives all firing at score 42 (label 'big-event'), so raising the
 *  threshold to 45 stops the real hits firing. The 26/30 hit rate also lands
 *  the calibration on 'degraded', producing the 'apply' proposal. */
const BED_LOW_DEF: AlgorithmDefinition = {
  algorithmId: 'big-event-detector',
  label: 'Big Event Detector',
  domain: 'reasoning_hypothesis',
  criticality: 'low',
  minWeightedHitRate: 0.9,
  minGradedSamples: 20,
};

const BED_THRESHOLD_TUNING: AlgorithmAdjustmentTuning = {
  algorithmId: 'big-event-detector',
  parameters: [{
    parameterId: 'threshold',
    current: 40,
    min: 20,
    max: 60,
    step: 5,
    fixDirection: 'increase',
    description: 'big-event total-score threshold',
  }],
};

function regressingBedLedger() {
  const ledger = createAlgorithmEvaluationLedger({ now: () => 1 });
  for (let i = 0; i < 30; i += 1) {
    const r = ledger.recordEvaluation({
      algorithmId: 'big-event-detector',
      domain: 'reasoning_hypothesis',
      at: BT_NOW - DAY,
      durationMs: 5,
      score: 0.42,        // comparable 42 — fires at prior 40, stops firing at 45
      label: 'big-event', // recorded as FIRED
    });
    ledger.recordOutcome(r.id, i < 26 ? 'hit' : 'miss', 'test', BT_NOW - DAY);
  }
  return ledger;
}

function mixedVersionBedLedger() {
  const ledger = regressingBedLedger();
  for (let i = 0; i < 30; i += 1) {
    const hit = i < 26;
    const record = ledger.recordEvaluation({
      algorithmId: 'big-event-detector',
      domain: 'reasoning_hypothesis',
      version: '2.0.0',
      at: BT_NOW - DAY,
      durationMs: 5,
      score: hit ? 0.5 : 0.42,
      label: 'big-event',
    });
    ledger.recordOutcome(record.id, hit ? 'hit' : 'miss', 'current-version test', BT_NOW - DAY);
  }
  return ledger;
}

test('a LOW-criticality backtestable knob that regresses is hard-held before the gate', () => {
  _resetTuningDecisionsForTests();
  const captured: Array<[string, string, number]> = [];
  const res = runTuningApply({
    ledger: regressingBedLedger(),
    definitions: [BED_LOW_DEF],
    tunings: [BED_THRESHOLD_TUNING],
    replayPassed: true,          // replay would clear it…
    now: () => BT_NOW,           // anchor the 30-day backtest window to the records
    // backtestPassed UNSET → runner replays 40 → 45 against the ledger and finds
    // a regression. Without the hard enforcement this would auto-apply (low gate
    // ignores backtestPassed); with it, the change is held.
    apply: (a, p, v) => captured.push([a, p, v]),
  });
  assert.deepEqual(res, { proposed: 1, applied: 0, heldForApproval: 1 });
  assert.equal(captured.length, 0, 'regressing change must not be applied');
  const log = getTuningDecisions();
  assert.equal(log.length, 1);
  assert.equal(log[0]?.kind, 'held_for_approval');
  assert.equal(log[0]?.ruleId, 'backtest_blocked');
  assert.match(log[0]?.reason ?? '', /regress|blocked/);
});

test('historical versions cannot contaminate an active-version backtest', () => {
  _resetTuningDecisionsForTests();
  const result = runTuningApply({
    ledger: mixedVersionBedLedger(),
    definitions: [{ ...BED_LOW_DEF, version: '2.0.0' }],
    tunings: [BED_THRESHOLD_TUNING],
    replayPassed: true,
    now: () => BT_NOW,
    apply: () => {},
  });

  assert.equal(result.proposed, 1);
  assert.notEqual(getTuningDecisions()[0]?.ruleId, 'backtest_blocked');
});

test('a LOW-criticality backtestable knob that does NOT regress is not hard-held', () => {
  _resetTuningDecisionsForTests();
  const captured: Array<[string, string, number]> = [];
  // Same ledger, but a tuning that DECREASES the threshold (40 → 35). The 26
  // real hits still fire and the 4 false positives also still fire, so accuracy
  // is unchanged (no regression) → the backtest passes and the runner does NOT
  // short-circuit; the proposal flows to the gate like any other.
  const res = runTuningApply({
    ledger: regressingBedLedger(),
    definitions: [BED_LOW_DEF],
    tunings: [{
      algorithmId: 'big-event-detector',
      parameters: [{
        parameterId: 'threshold',
        current: 40,
        min: 20,
        max: 60,
        step: 5,
        fixDirection: 'decrease',
        description: 'big-event total-score threshold',
      }],
    }],
    replayPassed: true,
    now: () => BT_NOW,
    apply: (a, p, v) => captured.push([a, p, v]),
  });
  assert.equal(res.proposed, 1);
  // Not hard-held by the backtest guard: the decision is whatever the gate says
  // (big-event-detector.threshold affectsNotifications → held for approval), but
  // crucially NOT via 'backtest_blocked'.
  assert.notEqual(getTuningDecisions()[0]?.ruleId, 'backtest_blocked');
});
