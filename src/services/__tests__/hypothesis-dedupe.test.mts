import assert from 'node:assert/strict';
import test from 'node:test';

// Stub DOM + localStorage + IDB minimally; hypothesis-dedupe imports
// hypothesis-entities which touches `document.addEventListener` at startup,
// but the test only calls dedupeHypotheses() which doesn't trigger it.
(globalThis as unknown as { document: { addEventListener: () => void } }).document = {
  addEventListener: () => { /* noop */ },
};

import { dedupeHypotheses } from '../hypothesis-dedupe.ts';

// Minimal Hypothesis mock that matches the shape used by dedupe.
function makeHyp(overrides: Partial<Record<string, unknown>> = {}): Parameters<typeof dedupeHypotheses>[0][number] {
  return {
    id: 'h-' + Math.random().toString(36).slice(2, 7),
    kind: 'cross-domain-cluster',
    statement: 'default statement',
    confidence: 0.5,
    risk: 'moderate',
    evidence: [],
    timestamp: Date.now(),
    ...overrides,
  } as Parameters<typeof dedupeHypotheses>[0][number];
}

test('dedupeHypotheses: passes through singletons', () => {
  const h = makeHyp();
  const out = dedupeHypotheses([h]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.id, h.id);
});

test('dedupeHypotheses: merges hypotheses sharing an evidence ID', () => {
  const a = makeHyp({
    id: 'a',
    kind: 'cross-domain-cluster',
    risk: 'high',
    confidence: 0.8,
    evidence: [{ source: 'situation-engine', id: 'sit-1', label: 'Sit' }],
  });
  const b = makeHyp({
    id: 'b',
    kind: 'situation-escalation',
    risk: 'moderate',
    confidence: 0.6,
    evidence: [{ source: 'situation-engine', id: 'sit-1', label: 'Sit' }],
  });
  const out = dedupeHypotheses([a, b]);
  assert.equal(out.length, 1);
  // Winner should be `a` (higher risk tier).
  assert.equal(out[0]?.id, 'a');
  const fused = (out[0] as unknown as { fusedFrom?: string[] }).fusedFrom;
  assert.deepEqual(fused, ['situation-escalation']);
});

test('dedupeHypotheses: keeps distinct hypotheses separate', () => {
  const a = makeHyp({
    id: 'a',
    region: 'Taiwan',
    evidence: [{ source: 'situation-engine', id: 'sit-1', label: 'Sit' }],
  });
  const b = makeHyp({
    id: 'b',
    region: 'Middle East',
    evidence: [{ source: 'unified-alerts', id: 'al-1', label: 'Alert' }],
  });
  const out = dedupeHypotheses([a, b]);
  assert.equal(out.length, 2);
});

test('dedupeHypotheses: preserves position of winners', () => {
  const a = makeHyp({ id: 'a', risk: 'low', confidence: 0.3 });
  const b = makeHyp({
    id: 'b',
    risk: 'high',
    confidence: 0.8,
    evidence: [{ source: 'situation-engine', id: 'sit-9', label: 'Sit' }],
  });
  const c = makeHyp({
    id: 'c',
    risk: 'moderate',
    confidence: 0.6,
    evidence: [{ source: 'situation-engine', id: 'sit-9', label: 'Sit' }],
  });
  const out = dedupeHypotheses([a, b, c]);
  assert.equal(out.length, 2);
  // Order preserved: `a` still first, winner of b+c second.
  assert.equal(out[0]?.id, 'a');
  assert.equal(out[1]?.id, 'b');
});
