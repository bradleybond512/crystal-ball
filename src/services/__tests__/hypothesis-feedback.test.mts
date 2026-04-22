import assert from 'node:assert/strict';
import test from 'node:test';

// Minimal stubs. hypothesis-feedback uses localStorage + document.dispatchEvent.
const storage = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => { storage.set(k, v); },
  removeItem: (k: string) => { storage.delete(k); },
  clear: () => { storage.clear(); },
  get length() { return storage.size; },
  key: (i: number) => [...storage.keys()][i] ?? null,
} as Storage;
(globalThis as unknown as { document: { dispatchEvent: () => boolean } }).document = {
  dispatchEvent: () => true,
};
// Stub CustomEvent so feedback's dispatchEvent call doesn't ReferenceError.
class StubCE<T = unknown> {
  detail: T | undefined;
  type: string;
  constructor(type: string, init?: { detail?: T }) { this.type = type; this.detail = init?.detail; }
}
(globalThis as unknown as { CustomEvent: unknown }).CustomEvent = StubCE;

import {
  signatureFor, thumbsUp, thumbsDown, getHypothesisFeedbackMult, resetHypothesisFeedback,
} from '../hypothesis-feedback.ts';

function makeHyp(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'h-1',
    kind: 'cross-domain-cluster' as const,
    statement: 'x',
    confidence: 0.5,
    risk: 'moderate' as const,
    region: 'Taiwan',
    evidence: [
      { source: 'situation-engine' as const, id: 's1', label: 'S1' },
      { source: 'unified-alerts' as const, id: 'a1', label: 'A1' },
    ],
    timestamp: Date.now(),
    ...overrides,
  };
}

test('signatureFor is stable across timestamps + IDs', () => {
  const a = makeHyp({ id: 'a', timestamp: 1 });
  const b = makeHyp({ id: 'b', timestamp: 2 });
  assert.equal(signatureFor(a), signatureFor(b));
});

test('signatureFor differs for different regions', () => {
  const a = makeHyp({ region: 'Taiwan' });
  const b = makeHyp({ region: 'Iran' });
  assert.notEqual(signatureFor(a), signatureFor(b));
});

test('signatureFor differs for different evidence source sets', () => {
  const a = makeHyp({ evidence: [{ source: 'situation-engine', id: 's1', label: 'S1' }] });
  const b = makeHyp({ evidence: [{ source: 'unified-alerts', id: 's1', label: 'S1' }] });
  assert.notEqual(signatureFor(a), signatureFor(b));
});

test('signatureFor is order-insensitive for evidence sources', () => {
  const a = makeHyp({
    evidence: [
      { source: 'situation-engine', id: 's1', label: 'S1' },
      { source: 'unified-alerts', id: 'a1', label: 'A1' },
    ],
  });
  const b = makeHyp({
    evidence: [
      { source: 'unified-alerts', id: 'a1', label: 'A1' },
      { source: 'situation-engine', id: 's1', label: 'S1' },
    ],
  });
  assert.equal(signatureFor(a), signatureFor(b));
});

test('getHypothesisFeedbackMult returns 1 with no samples', () => {
  resetHypothesisFeedback();
  const h = makeHyp({ region: 'NoSamples' });
  assert.equal(getHypothesisFeedbackMult(h), 1);
});

test('thumbsUp nudges multiplier above 1 after MIN_SAMPLES', () => {
  resetHypothesisFeedback();
  const h = makeHyp({ region: 'TestUp' });
  thumbsUp(h); // 1
  assert.equal(getHypothesisFeedbackMult(h), 1, 'below min samples');
  thumbsUp(h); // 2 → hits MIN_SAMPLES (2)
  const mult = getHypothesisFeedbackMult(h);
  assert.ok(mult > 1, `expected >1, got ${mult}`);
});

test('thumbsDown drops multiplier below 1 after MIN_SAMPLES', () => {
  resetHypothesisFeedback();
  const h = makeHyp({ region: 'TestDown' });
  thumbsDown(h);
  thumbsDown(h);
  const mult = getHypothesisFeedbackMult(h);
  assert.ok(mult < 1, `expected <1, got ${mult}`);
});
