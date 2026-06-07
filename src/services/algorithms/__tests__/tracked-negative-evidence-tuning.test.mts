/**
 * B2-replicate coverage: trackedEvaluateNegativeEvidence reads its
 * `maxPenalty` from the tunable-params store (so the tuning loop can
 * actually move this knob), while an explicit caller override still wins.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { trackedEvaluateNegativeEvidence } from '../tracked-algorithms.ts';
import { setTunedParam, _resetTunedParamsForTests } from '../tunable-params-store.ts';
import { resetAlgorithmsState } from '../algorithms-state.ts';
import type { NormalizedFact } from '@/services/intelligence/types';
import type { ExpectedSignal } from '@/services/intelligence/negative-evidence';

// jsdom-free: minimal localStorage shim so the store persists in-process.
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

const PARENT: NormalizedFact = {
  id: 'parent',
  domain: 'weather',
  eventType: 'earthquake',
  claim: 'M6.2 near Tokyo',
  severity: 'medium',
  occurredAt: 0,
  ingestedAt: 0,
  precision: 'point',
  entities: ['JP'],
  sources: [{ providerId: 'p0', reliability: 0.8, observedAt: 0, rawId: 'r0' }],
};

// Two expected-but-missing signals worth 0.3 each → rawPenalty 0.6.
const EXPECTED: ExpectedSignal[] = [
  { id: 's1', label: 'Aftershock', domain: 'weather', windowStartMs: 0, windowEndMs: 1000, absencePenalty: 0.3 },
  { id: 's2', label: 'Tsunami advisory', domain: 'weather', windowStartMs: 0, windowEndMs: 1000, absencePenalty: 0.3 },
];

// now well past both windows → both signals count as missing.
const NOW = 10_000;

test.beforeEach(() => {
  resetAlgorithmsState();
  _resetTunedParamsForTests();
});

test('a low tuned maxPenalty caps the absence penalty', () => {
  setTunedParam('negative-evidence', 'maxPenalty', 0.2);
  const result = trackedEvaluateNegativeEvidence(PARENT, EXPECTED, [], 0.9, { now: NOW });
  // rawPenalty 0.6, capped to the tuned 0.2.
  assert.equal(result.totalAbsencePenalty, 0.2);
});

test('a high tuned maxPenalty lets the full raw penalty through', () => {
  setTunedParam('negative-evidence', 'maxPenalty', 0.9);
  const result = trackedEvaluateNegativeEvidence(PARENT, EXPECTED, [], 0.9, { now: NOW });
  // rawPenalty 0.6 < tuned 0.9 → not capped.
  assert.equal(result.totalAbsencePenalty, 0.6);
});

test('default (store unset) caps at the engine default 0.6', () => {
  const result = trackedEvaluateNegativeEvidence(PARENT, EXPECTED, [], 0.9, { now: NOW });
  assert.equal(result.totalAbsencePenalty, 0.6);
});

test('an explicit caller maxPenalty overrides the store', () => {
  setTunedParam('negative-evidence', 'maxPenalty', 0.9);
  const result = trackedEvaluateNegativeEvidence(PARENT, EXPECTED, [], 0.9, { now: NOW, maxPenalty: 0.1 });
  assert.equal(result.totalAbsencePenalty, 0.1);
});
