import assert from 'node:assert/strict';
import test from 'node:test';

import {
  recordTuningDecision,
  getTuningDecisions,
  _resetTuningDecisionsForTests,
  type TuningDecision,
} from '../tuning-decision-log.ts';

// jsdom-free: provide a minimal localStorage shim for the node test runner.
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

function decision(over: Partial<TuningDecision> = {}): TuningDecision {
  return {
    at: 1,
    algorithmId: 'a',
    parameterId: 'p',
    priorValue: 10,
    nextValue: 12,
    kind: 'applied',
    ruleId: 'algo_tuning_gate_lowmed_ready',
    reason: 'test',
    ...over,
  };
}

test('records are returned newest-first', () => {
  _resetTuningDecisionsForTests();
  recordTuningDecision(decision({ at: 1 }));
  recordTuningDecision(decision({ at: 2 }));
  const log = getTuningDecisions();
  assert.equal(log.length, 2);
  assert.equal(log[0]?.at, 2);
  assert.equal(log[1]?.at, 1);
});

test('the log is capped at 100 entries', () => {
  _resetTuningDecisionsForTests();
  for (let i = 0; i < 130; i += 1) recordTuningDecision(decision({ at: i }));
  const log = getTuningDecisions();
  assert.equal(log.length, 100);
  // newest kept, oldest dropped
  assert.equal(log[0]?.at, 129);
  assert.equal(log.at(-1)?.at, 30);
});

test('malformed stored entries are filtered out on read', () => {
  _resetTuningDecisionsForTests();
  globalThis.localStorage.setItem(
    'crystalball-tuning-decisions-v1',
    JSON.stringify([decision(), { at: 'nope' }, null, 42]),
  );
  const log = getTuningDecisions();
  assert.equal(log.length, 1);
  assert.equal(log[0]?.algorithmId, 'a');
});
