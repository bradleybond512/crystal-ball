import { test } from 'node:test';
import assert from 'node:assert/strict';

import { suggestQuestionsRanked } from '../question-suggester';
import type { Hypothesis } from '../analyst-loop';

function fakeHypothesis(over: Partial<Hypothesis> = {}): Hypothesis {
  return {
    id: 'h1',
    kind: 'alert-burst',
    risk: 'high',
    confidence: 0.7,
    statement: 'baseline',
    region: 'US',
    evidence: [],
    timestamp: 1_000_000,
    ...over,
  };
}

test('an EVOI action outranks heuristic chips (0.4 bits vs the 0.1 prior)', () => {
  const h = fakeHypothesis();
  const ranked = suggestQuestionsRanked(h, {
    heuristics: () => ['What second-order effects should I watch for?'],
    evoiActions: () => [{ label: 'Check alternate-source feed X', expectedInfoGainBits: 0.4 }],
  });
  assert.equal(ranked[0]!.question, 'Check alternate-source feed X');
  assert.equal(ranked[0]!.bits, 0.4);
  assert.equal(ranked[0]!.fromEvoi, true);
  assert.equal(ranked[1]!.question, 'What second-order effects should I watch for?');
  assert.equal(ranked[1]!.bits, 0.1);
  assert.equal(ranked[1]!.fromEvoi, false);
});

test('dedupes case-insensitively across heuristic and EVOI sources', () => {
  const h = fakeHypothesis();
  const ranked = suggestQuestionsRanked(h, {
    heuristics: () => ['Check Alternate-Source Feed X', 'Something else entirely'],
    evoiActions: () => [{ label: 'check alternate-source feed x', expectedInfoGainBits: 0.4 }],
  });
  const matches = ranked.filter((r) => r.question.toLowerCase() === 'check alternate-source feed x');
  assert.equal(matches.length, 1);
  // The higher-bits (EVOI) copy wins since EVOI entries are concatenated first.
  assert.equal(matches[0]!.fromEvoi, true);
  assert.equal(matches[0]!.bits, 0.4);
});

test('caps at 3 questions even when more are available', () => {
  const h = fakeHypothesis();
  const ranked = suggestQuestionsRanked(h, {
    heuristics: () => ['H1', 'H2', 'H3'],
    evoiActions: () => [
      { label: 'E1', expectedInfoGainBits: 0.9 },
      { label: 'E2', expectedInfoGainBits: 0.8 },
      { label: 'E3', expectedInfoGainBits: 0.7 },
    ],
  });
  assert.equal(ranked.length, 3);
  assert.deepEqual(ranked.map((r) => r.question), ['E1', 'E2', 'E3']);
});

test('empty EVOI (kill-switch off) falls back to pure heuristic passthrough at the prior', () => {
  const h = fakeHypothesis();
  const ranked = suggestQuestionsRanked(h, {
    heuristics: () => ['Only heuristic one', 'Only heuristic two'],
    evoiActions: () => [],
  });
  assert.equal(ranked.length, 2);
  for (const r of ranked) {
    assert.equal(r.fromEvoi, false);
    assert.equal(r.bits, 0.1);
  }
  assert.deepEqual(ranked.map((r) => r.question), ['Only heuristic one', 'Only heuristic two']);
});

test('default deps wire into the real suggestQuestions + buildCheckNextItems (kill-switch off by default env) → heuristic passthrough', () => {
  const h = fakeHypothesis({
    risk: 'critical',
    region: 'Eastern Europe',
    evidence: [
      { source: 'situation-engine', id: 'e1', label: 'l1' },
      { source: 'anomaly-detection', id: 'e2', label: 'l2' },
    ],
  });
  const ranked = suggestQuestionsRanked(h);
  assert.ok(ranked.length > 0 && ranked.length <= 3);
  for (const r of ranked) assert.equal(typeof r.question, 'string');
});
