import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runCounterfactual,
  shouldRunCounterfactual,
  recordCounterfactualResult,
  getCounterfactualsForEvent,
  listAllCounterfactuals,
  _resetCounterfactualCacheForTests,
  type AlgorithmRunner,
  type CounterfactualEvent,
} from '../counterfactual-engine.ts';

const NOW = 1_745_000_000_000;

const fireRunner: AlgorithmRunner = () => ({ wouldHaveDecided: 'fire', confidence: 0.9 });
const holdRunner: AlgorithmRunner = () => ({ wouldHaveDecided: 'hold', confidence: 0.6 });
const lowConfFireRunner: AlgorithmRunner = () => ({ wouldHaveDecided: 'fire', confidence: 0.3 });
const throwingRunner: AlgorithmRunner = () => {
  throw new Error('runner error');
};

const baseEvent: CounterfactualEvent = {
  eventId: 'evt-1',
  groundTruth: 'fire',
  payload: { kind: 'tornado-warning' },
  at: NOW,
};

// ── Replay mechanics ──────────────────────────────────────────────────

test('runCounterfactual: excludes the false-decision algorithm', () => {
  const runners = new Map<string, AlgorithmRunner>([
    ['a', fireRunner],
    ['b', holdRunner],
  ]);
  const r = runCounterfactual({
    event: baseEvent,
    falseDecisionAlgorithmId: 'a',
    falseDecisionWas: 'hold',
    runners,
    generatedAt: NOW,
  });
  assert.equal(r.alternativeAlgorithms.length, 1);
  assert.equal(r.alternativeAlgorithms[0]!.id, 'b');
});

test('runCounterfactual: classifies false_negative when groundTruth=fire', () => {
  const r = runCounterfactual({
    event: baseEvent,
    falseDecisionAlgorithmId: 'a',
    falseDecisionWas: 'hold',
    runners: new Map([['b', fireRunner]]),
    generatedAt: NOW,
  });
  assert.equal(r.outcomeKind, 'false_negative');
});

test('runCounterfactual: classifies false_positive when groundTruth=hold', () => {
  const r = runCounterfactual({
    event: { ...baseEvent, groundTruth: 'hold' },
    falseDecisionAlgorithmId: 'a',
    falseDecisionWas: 'fire',
    runners: new Map([['b', holdRunner]]),
    generatedAt: NOW,
  });
  assert.equal(r.outcomeKind, 'false_positive');
});

// ── Best alternative selection ────────────────────────────────────────

test('runCounterfactual: bestAlternative picks highest-confidence match', () => {
  const r = runCounterfactual({
    event: baseEvent,
    falseDecisionAlgorithmId: 'orig',
    falseDecisionWas: 'hold',
    runners: new Map([
      ['a', fireRunner],
      ['b', holdRunner],
      ['c', lowConfFireRunner],
    ]),
    generatedAt: NOW,
  });
  assert.equal(r.bestAlternative?.id, 'a');
  assert.equal(r.bestAlternative?.confidence, 0.9);
});

test('runCounterfactual: bestAlternative undefined when no alternative agrees with ground truth', () => {
  const r = runCounterfactual({
    event: baseEvent, // groundTruth='fire'
    falseDecisionAlgorithmId: 'orig',
    falseDecisionWas: 'hold',
    runners: new Map([
      ['a', holdRunner],
      ['b', holdRunner],
    ]),
    generatedAt: NOW,
  });
  assert.equal(r.bestAlternative, undefined);
});

test('runCounterfactual: tie-break by lexicographic id at equal confidence', () => {
  const sameConf: AlgorithmRunner = () => ({ wouldHaveDecided: 'fire', confidence: 0.7 });
  const r = runCounterfactual({
    event: baseEvent,
    falseDecisionAlgorithmId: 'orig',
    falseDecisionWas: 'hold',
    runners: new Map([
      ['z-late', sameConf],
      ['a-early', sameConf],
    ]),
    generatedAt: NOW,
  });
  assert.equal(r.bestAlternative?.id, 'a-early');
});

// ── Throwing runner ───────────────────────────────────────────────────

test('runCounterfactual: throwing runner is degraded gracefully', () => {
  const r = runCounterfactual({
    event: baseEvent,
    falseDecisionAlgorithmId: 'orig',
    falseDecisionWas: 'hold',
    runners: new Map([
      ['boom', throwingRunner],
      ['ok', fireRunner],
    ]),
    generatedAt: NOW,
  });
  assert.equal(r.alternativeAlgorithms.length, 2);
  const boom = r.alternativeAlgorithms.find((v) => v.id === 'boom');
  assert.equal(boom?.confidence, 0);
  // Best should still be the working runner, not the broken one.
  assert.equal(r.bestAlternative?.id, 'ok');
});

// ── Insight generation ────────────────────────────────────────────────

test('runCounterfactual: insight names the best alternative when one exists', () => {
  const r = runCounterfactual({
    event: baseEvent,
    falseDecisionAlgorithmId: 'orig',
    falseDecisionWas: 'hold',
    runners: new Map([['a', fireRunner]]),
    generatedAt: NOW,
  });
  assert.match(r.insight, /Algorithm "a" would have caught this/);
});

test('runCounterfactual: insight signals "all wrong" when no match', () => {
  const r = runCounterfactual({
    event: baseEvent,
    falseDecisionAlgorithmId: 'orig',
    falseDecisionWas: 'hold',
    runners: new Map([['a', holdRunner], ['b', holdRunner]]),
    generatedAt: NOW,
  });
  assert.match(r.insight, /All 2 alternative algorithms also got event evt-1 wrong/);
});

test('runCounterfactual: insight handles empty alternatives', () => {
  const r = runCounterfactual({
    event: baseEvent,
    falseDecisionAlgorithmId: 'orig',
    falseDecisionWas: 'hold',
    runners: new Map([['orig', fireRunner]]), // only the false-decision algorithm
    generatedAt: NOW,
  });
  assert.match(r.insight, /no alternative algorithms registered/);
});

// ── Auto-trigger ──────────────────────────────────────────────────────

test('shouldRunCounterfactual: true for miss', () => {
  assert.equal(shouldRunCounterfactual('miss'), true);
  assert.equal(shouldRunCounterfactual('hit'), false);
  assert.equal(shouldRunCounterfactual('partial'), false);
  assert.equal(shouldRunCounterfactual('inconclusive'), false);
});

// ── Cache ─────────────────────────────────────────────────────────────

test('record / get / listAll: round-trip', () => {
  _resetCounterfactualCacheForTests();
  const r = runCounterfactual({
    event: baseEvent,
    falseDecisionAlgorithmId: 'a',
    falseDecisionWas: 'hold',
    runners: new Map([['b', fireRunner]]),
    generatedAt: NOW,
  });
  recordCounterfactualResult(r);
  const back = getCounterfactualsForEvent('evt-1');
  assert.equal(back.length, 1);
  const all = listAllCounterfactuals();
  assert.ok(all['evt-1']);
});
