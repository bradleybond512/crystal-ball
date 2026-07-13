import assert from 'node:assert/strict';
import test from 'node:test';

import { computeShellGate } from '../shell-gate.ts';

const BASE = { variant: 'full', viewportWidth: 1280, classicFlag: null as string | null, legacyOptIn: null as string | null };

test('default-on for full variant on desktop width', () => {
  assert.equal(computeShellGate(BASE), true);
});

test('classic-view flag opts out', () => {
  assert.equal(computeShellGate({ ...BASE, classicFlag: '1' }), false);
});

test('non-full variants stay classic even with legacy opt-in', () => {
  for (const variant of ['tech', 'finance', 'happy']) {
    assert.equal(computeShellGate({ ...BASE, variant }), false);
    assert.equal(computeShellGate({ ...BASE, variant, legacyOptIn: '1' }), false);
  }
});

test('mobile viewport stays classic', () => {
  assert.equal(computeShellGate({ ...BASE, viewportWidth: 768 }), false);
  assert.equal(computeShellGate({ ...BASE, viewportWidth: 769 }), true);
});

test('unmeasurable viewport (width 0, window not laid out at boot) is not inferred as mobile', () => {
  assert.equal(computeShellGate({ ...BASE, viewportWidth: 0 }), true);
  assert.equal(computeShellGate({ ...BASE, viewportWidth: 0, classicFlag: '1' }), false);
});

test('legacy opt-in key is ignored when classic flag set (classic wins)', () => {
  assert.equal(computeShellGate({ ...BASE, legacyOptIn: '1', classicFlag: '1' }), false);
});
