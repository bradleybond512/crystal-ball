import assert from 'node:assert/strict';
import test from 'node:test';

import { createAlgorithmEvaluationLedger } from '../algorithm-evaluation-ledger.ts';
import { runTuningApply } from '../tuning-apply-runner.ts';
import type { AlgorithmDefinition } from '../algorithm-health.ts';

const BED_DEF: AlgorithmDefinition = {
  algorithmId: 'big-event-detector',
  label: 'Big Event Detector',
  domain: 'reasoning_hypothesis',
  criticality: 'low',
};

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
