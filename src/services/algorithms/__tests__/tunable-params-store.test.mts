import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getTunedParam,
  setTunedParam,
  getTunings,
  _resetTunedParamsForTests,
} from '../tunable-params-store.ts';

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

test('getTunedParam returns the declared default when unset', () => {
  _resetTunedParamsForTests();
  assert.equal(getTunedParam('big-event-detector', 'threshold', 40), 40);
});

test('set then get round-trips a value within bounds', () => {
  _resetTunedParamsForTests();
  setTunedParam('big-event-detector', 'threshold', 45);
  assert.equal(getTunedParam('big-event-detector', 'threshold', 40), 45);
});

test('values are clamped to the declared [min,max] on write', () => {
  _resetTunedParamsForTests();
  setTunedParam('big-event-detector', 'threshold', 999); // max is 60
  assert.equal(getTunedParam('big-event-detector', 'threshold', 40), 60);
  setTunedParam('big-event-detector', 'threshold', -5); // min is 20
  assert.equal(getTunedParam('big-event-detector', 'threshold', 40), 20);
});

test('a corrupted/out-of-range stored value is clamped on read', () => {
  _resetTunedParamsForTests();
  globalThis.localStorage.setItem(
    'crystalball-tunable-params-v1',
    JSON.stringify({ 'big-event-detector:threshold': 5000 }),
  );
  assert.equal(getTunedParam('big-event-detector', 'threshold', 40), 60); // clamped to max
});

test('unknown param falls back to the caller default (no declaration to clamp to)', () => {
  _resetTunedParamsForTests();
  assert.equal(getTunedParam('no-such-algo', 'no-such-param', 7), 7);
});

test('getTunings exposes declared knobs with current values from the store', () => {
  _resetTunedParamsForTests();
  setTunedParam('big-event-detector', 'threshold', 50);
  const tunings = getTunings();
  const bed = tunings.find((t) => t.algorithmId === 'big-event-detector');
  assert.ok(bed, 'big-event-detector tuning present');
  const threshold = bed!.parameters.find((p) => p.parameterId === 'threshold');
  assert.equal(threshold!.current, 50);
  assert.equal(threshold!.min, 20);
  assert.equal(threshold!.max, 60);
});

// ── negative-evidence.maxPenalty (B2-replicate: second declared knob) ──

test('negative-evidence.maxPenalty defaults to 0.6 when unset', () => {
  _resetTunedParamsForTests();
  assert.equal(getTunedParam('negative-evidence', 'maxPenalty', 0.6), 0.6);
});

test('negative-evidence.maxPenalty round-trips and clamps to [0.2, 0.9]', () => {
  _resetTunedParamsForTests();
  setTunedParam('negative-evidence', 'maxPenalty', 0.4);
  assert.equal(getTunedParam('negative-evidence', 'maxPenalty', 0.6), 0.4);
  setTunedParam('negative-evidence', 'maxPenalty', 5); // above max
  assert.equal(getTunedParam('negative-evidence', 'maxPenalty', 0.6), 0.9);
  setTunedParam('negative-evidence', 'maxPenalty', 0); // below min
  assert.equal(getTunedParam('negative-evidence', 'maxPenalty', 0.6), 0.2);
});

test('getTunings exposes both declared algorithms', () => {
  _resetTunedParamsForTests();
  const tunings = getTunings();
  const ids = tunings.map((t) => t.algorithmId).sort();
  assert.deepEqual(ids, ['big-event-detector', 'negative-evidence']);
  const negEv = tunings.find((t) => t.algorithmId === 'negative-evidence');
  const maxPenalty = negEv!.parameters.find((p) => p.parameterId === 'maxPenalty');
  assert.equal(maxPenalty!.current, 0.6);
  assert.equal(maxPenalty!.fixDirection, 'decrease');
});
