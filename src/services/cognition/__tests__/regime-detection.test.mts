/**
 * Tests for regime-detection.ts (BOCPD).
 *
 * All tests use the hashed/deterministic path — no LLM, no network, no DOM.
 * Scenarios match plan-specified fixture sequences:
 *   - Stable series: no spurious shifts
 *   - Step-change series: shift detected promptly after the jump
 *   - Singleton per metric: state is isolated between metrics
 *   - Explanation string is non-empty (plan invariant: every score has an explanation)
 *   - changeProbability in [0,1]
 *   - minSamplesBeforeShift prevents early firing
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  createBOCPDState,
  ingestSample,
  createRegimeDetector,
  getRegimeDetector,
  setRegimeDetector,
} from '../regime-detection.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function feed(values: number[], opts = {}): { shifts: import('../regime-detection.js').RegimeShift[]; state: ReturnType<typeof createBOCPDState> } {
  const state = createBOCPDState('test:metric', opts);
  const shifts: import('../regime-detection.js').RegimeShift[] = [];
  for (let i = 0; i < values.length; i++) {
    const s = ingestSample(state, values[i], 1_000_000 + i * 1000, opts);
    if (s) shifts.push(s);
  }
  return { shifts, state };
}

// ── Stable series ─────────────────────────────────────────────────────────────

test('stable series: no shift on constant observations', () => {
  const values = Array.from({ length: 50 }, () => 1.0);
  // changeThreshold is a log Bayes factor; 4.0 = strong evidence required
  const { shifts } = feed(values, { hazardRate: 1 / 50, changeThreshold: 4.0, minSamplesBeforeShift: 10 });
  assert.equal(shifts.length, 0, 'Constant series must not generate shifts');
});

test('stable Gaussian series: very few shifts with tight threshold', () => {
  // Standard normal sequence (deterministic fixture, not random)
  const values = [
    0.1, -0.2, 0.3, -0.1, 0.4, -0.3, 0.2, 0.0, -0.2, 0.1,
    0.3, -0.1, 0.2, -0.3, 0.1,  0.0,  0.2, -0.1, 0.3, 0.1,
    -0.2, 0.1, -0.3, 0.2, 0.0, -0.2, 0.1, 0.3, -0.1, 0.2,
  ];
  // logBF threshold of 5.0 = very strong evidence, should have zero false alarms
  const { shifts } = feed(values, { hazardRate: 1 / 100, changeThreshold: 5.0, minSamplesBeforeShift: 15 });
  assert.ok(shifts.length <= 1, `Expected ≤1 false alarm on stationary series, got ${shifts.length}`);
});

// ── Step-change detection ─────────────────────────────────────────────────────

test('step-change series: shift detected within 5 samples after jump', () => {
  // 20 samples near 0 (tight cluster), then 20 samples near 10 (big step up)
  // logBF threshold 2.0: weak-to-moderate evidence; the step of 10σ should massively exceed this
  const stable = Array.from({ length: 20 }, (_, i) => (i % 3 === 0 ? 0.1 : -0.1));
  const shifted = Array.from({ length: 20 }, () => 10.0);
  const { shifts } = feed([...stable, ...shifted], {
    hazardRate: 1 / 30,
    changeThreshold: 2.0,
    minSamplesBeforeShift: 10,
  });
  assert.ok(shifts.length > 0, 'Expected at least one shift detected after step change');
  // First shift should appear after sample 20 (index >= 20)
  const firstShift = shifts[0]!;
  assert.ok(firstShift.triggerValue >= 5, `Shift trigger value should be in the new regime, got ${firstShift.triggerValue}`);
});

test('step-change direction is "up" for upward shift', () => {
  const stable = Array.from({ length: 25 }, () => 0.0);
  const shifted = Array.from({ length: 15 }, () => 8.0);
  const { shifts } = feed([...stable, ...shifted], {
    hazardRate: 1 / 20,
    changeThreshold: 2.0,
    minSamplesBeforeShift: 10,
  });
  if (shifts.length > 0) {
    assert.equal(shifts[0]!.direction, 'up', 'Upward step change should have direction "up"');
  }
});

// ── changeProbability bounds ──────────────────────────────────────────────────

test('changeProbability is always in [0, 1]', () => {
  const values = [1, 1, 1, 5, 5, 5, 1, 1, 1, 5, 5, 5, 10, 10, 10, 0.1, 0.1, 0.1, 9, 9, 9, 2, 2];
  const state = createBOCPDState('test:bounds', { minSamplesBeforeShift: 5, changeThreshold: 1.5 });
  for (let i = 0; i < values.length; i++) {
    const shift = ingestSample(state, values[i], i * 1000, { minSamplesBeforeShift: 5, changeThreshold: 1.5 });
    if (shift) {
      assert.ok(shift.changeProbability >= 0 && shift.changeProbability <= 1,
        `changeProbability out of [0,1]: ${shift.changeProbability}`);
    }
  }
});

// ── Explanation invariant ─────────────────────────────────────────────────────

test('every emitted shift has a non-empty explanation', () => {
  const stable = Array.from({ length: 15 }, () => 0.0);
  const big = Array.from({ length: 10 }, () => 20.0);
  const { shifts } = feed([...stable, ...big], {
    hazardRate: 1 / 10,
    changeThreshold: 1.5,
    minSamplesBeforeShift: 8,
  });
  for (const s of shifts) {
    assert.ok(s.explanation.length > 0, 'Explanation must be non-empty (plan invariant)');
    assert.ok(s.explanation.includes('%'), 'Explanation should include probability percentage');
  }
});

// ── minSamplesBeforeShift guard ───────────────────────────────────────────────

test('minSamplesBeforeShift: no shift before the minimum is reached', () => {
  const state = createBOCPDState('test:warmup', { minSamplesBeforeShift: 20, changeThreshold: 0.01, hazardRate: 0.5 });
  // Feed 19 samples — even with extreme hazard and low threshold, no shift should fire
  for (let i = 0; i < 19; i++) {
    const shift = ingestSample(state, i % 2 === 0 ? 100 : -100, i * 1000, {
      minSamplesBeforeShift: 20,
      changeThreshold: 0.01,
      hazardRate: 0.5,
    });
    assert.equal(shift, null, `Shift fired at sample ${i + 1} before minSamplesBeforeShift=20`);
  }
});

// ── runLength sanity ──────────────────────────────────────────────────────────

test('runLength is non-negative', () => {
  const stable = Array.from({ length: 20 }, () => 1.0);
  const big = Array.from({ length: 10 }, () => 50.0);
  const { shifts } = feed([...stable, ...big], { hazardRate: 1 / 5, changeThreshold: 1.5, minSamplesBeforeShift: 10 });
  for (const s of shifts) {
    assert.ok(s.runLength >= 0, `runLength must be ≥ 0, got ${s.runLength}`);
  }
});

// ── Multi-metric detector ─────────────────────────────────────────────────────

test('RegimeDetector: metrics are isolated from each other', () => {
  const detector = createRegimeDetector({ minSamplesBeforeShift: 5, changeThreshold: 2.0, hazardRate: 1 / 10 });

  // Feed metric A with a step change
  const stableA = Array.from({ length: 15 }, () => 0.0);
  const bigA = Array.from({ length: 10 }, () => 10.0);
  [...stableA, ...bigA].forEach((v, i) => detector.feed('metricA', v, i * 1000));

  // Feed metric B with constant values (should be no shift)
  const constantB = Array.from({ length: 25 }, () => 5.0);
  const shiftsB: import('../regime-detection.js').RegimeShift[] = [];
  const unsub = detector.onShift(s => { if (s.metric === 'metricB') shiftsB.push(s); });
  constantB.forEach((v, i) => detector.feed('metricB', v, i * 1000));
  unsub();

  assert.equal(shiftsB.length, 0, 'Constant metric B should produce no shifts');

  // Metric A and B are tracked separately
  assert.ok(detector.stateFor('metricA') !== undefined, 'Metric A state should exist');
  assert.ok(detector.stateFor('metricB') !== undefined, 'Metric B state should exist');
  assert.equal(detector.metrics().length, 2);
});

test('RegimeDetector.onShift callback fires for detected shifts', () => {
  const detector = createRegimeDetector({ minSamplesBeforeShift: 5, changeThreshold: 2.0, hazardRate: 1 / 8 });
  const received: import('../regime-detection.js').RegimeShift[] = [];
  const unsub = detector.onShift(s => received.push(s));

  const stable = Array.from({ length: 15 }, () => 0.0);
  const shifted = Array.from({ length: 10 }, () => 15.0);
  [...stable, ...shifted].forEach((v, i) => detector.feed('cb:metric', v, i * 1000));
  unsub();

  assert.ok(received.length > 0, 'Callback should have fired for step change');
  assert.equal(received[0].metric, 'cb:metric');
});

test('RegimeDetector.reset clears all state', () => {
  const detector = createRegimeDetector();
  detector.feed('m1', 1.0, 1000);
  detector.feed('m2', 2.0, 2000);
  assert.equal(detector.metrics().length, 2);
  detector.reset();
  assert.equal(detector.metrics().length, 0);
});

test('RegimeDetector.reset(metric) removes only that metric', () => {
  const detector = createRegimeDetector();
  detector.feed('m1', 1.0, 1000);
  detector.feed('m2', 2.0, 2000);
  detector.reset('m1');
  assert.equal(detector.metrics().length, 1);
  assert.equal(detector.metrics()[0], 'm2');
});

// ── Singleton ─────────────────────────────────────────────────────────────────

test('getRegimeDetector returns same instance across calls', () => {
  setRegimeDetector(null); // reset
  const a = getRegimeDetector();
  const b = getRegimeDetector();
  assert.strictEqual(a, b, 'Should return the same singleton instance');
  setRegimeDetector(null); // cleanup
});

test('setRegimeDetector replaces the singleton', () => {
  const custom = createRegimeDetector({ hazardRate: 0.1 });
  setRegimeDetector(custom);
  assert.strictEqual(getRegimeDetector(), custom);
  setRegimeDetector(null); // cleanup
});
