import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getTunedParam,
  setTunedParam,
  getTunings,
  tunableAffectsNotifications,
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

test('a stored "null" / non-object value does not throw and falls back to default', () => {
  _resetTunedParamsForTests();
  globalThis.localStorage.setItem('crystalball-tunable-params-v1', 'null');
  assert.equal(getTunedParam('negative-evidence', 'maxPenalty', 0.6), 0.6);
  globalThis.localStorage.setItem('crystalball-tunable-params-v1', '[1,2,3]');
  assert.equal(getTunedParam('big-event-detector', 'threshold', 40), 40);
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

test('getTunings exposes all declared algorithms', () => {
  _resetTunedParamsForTests();
  const tunings = getTunings();
  const ids = tunings.map((t) => t.algorithmId).sort();
  // Cognition PR 12 declared knobs for: consolidation, entity-trajectory,
  // episodic-analog, operator-ranking, recalibration (+ 2 more on superforecast).
  assert.deepEqual(ids, [
    'big-event-detector', 'consolidation', 'correlation-feedback', 'entity-trajectory',
    'episodic-analog', 'hypothesis-feedback', 'negative-evidence', 'operator-ranking',
    'recalibration', 'superforecast',
  ]);
  const negEv = tunings.find((t) => t.algorithmId === 'negative-evidence');
  const maxPenalty = negEv!.parameters.find((p) => p.parameterId === 'maxPenalty');
  assert.equal(maxPenalty!.current, 0.6);
  assert.equal(maxPenalty!.fixDirection, 'decrease');
  const correl = tunings.find((t) => t.algorithmId === 'correlation-feedback');
  const ft = correl!.parameters.find((p) => p.parameterId === 'feedbackThreshold');
  assert.ok(Math.abs((ft!.current ?? 0) - 0.55) < 0.001);
  assert.equal(ft!.fixDirection, 'increase');
});

// ── New knobs: rapidJumpDelta, exposureFloor, downPenalty ────────────────

test('new knobs are declared with clamped bounds', () => {
  _resetTunedParamsForTests();
  assert.equal(getTunedParam('big-event-detector', 'rapidJumpDelta', 25), 25);
  assert.equal(getTunedParam('big-event-detector', 'exposureFloor', 70), 70);
  assert.equal(getTunedParam('hypothesis-feedback', 'downPenalty', 0.5), 0.5);
  setTunedParam('big-event-detector', 'rapidJumpDelta', 999);
  assert.equal(getTunedParam('big-event-detector', 'rapidJumpDelta', 25), 40); // clamped to max
});

test('detector knobs are notification-affecting; downPenalty is not', () => {
  assert.equal(tunableAffectsNotifications('big-event-detector', 'rapidJumpDelta'), true);
  assert.equal(tunableAffectsNotifications('big-event-detector', 'exposureFloor'), true);
  assert.equal(tunableAffectsNotifications('hypothesis-feedback', 'downPenalty'), false);
});
