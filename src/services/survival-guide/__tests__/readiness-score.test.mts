import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SurvivalGuide } from '../guide-types.ts';
import { computeGuideReadiness, computeOverallReadiness } from '../readiness-score.ts';

function guide(id: string, checklist: SurvivalGuide['checklist']): SurvivalGuide {
  return {
    id: id as SurvivalGuide['id'], kind: 'hazard', title: id, summary: 's',
    signs: ['a'], prepare: [{ label: 'p' }], during: [{ label: 'd' }],
    after: [{ label: 'a' }], recovery: ['r'], mistakes: ['m'],
    checklist, relatedGuides: [], sources: ['x'],
  };
}

const g = guide('tornado', [
  { id: 'tornado.a', label: 'a', weight: 3 },
  { id: 'tornado.b', label: 'b', weight: 1 },
]);

test('empty checklist -> null', () => {
  assert.equal(computeGuideReadiness(guide('flood', []), new Set()), null);
});

test('0 checked -> 0%', () => {
  const r = computeGuideReadiness(g, new Set());
  assert.equal(r?.percent, 0);
});

test('all checked -> 100%', () => {
  const r = computeGuideReadiness(g, new Set(['tornado.a', 'tornado.b']));
  assert.equal(r?.percent, 100);
});

test('weights respected (weight-3 of 4 total = 75%)', () => {
  const r = computeGuideReadiness(g, new Set(['tornado.a']));
  assert.equal(r?.percent, 75);
  assert.equal(r?.checkedCount, 1);
});

test('unknown checked ids ignored', () => {
  const r = computeGuideReadiness(g, new Set(['tornado.a', 'not-a-real-id']));
  assert.equal(r?.checkedCount, 1);
});

test('overall = mean of per-guide, weakest = lowest', () => {
  const a = guide('tornado', [{ id: 'tornado.a', label: 'a', weight: 1 }]);
  const b = guide('flood', [{ id: 'flood.a', label: 'a', weight: 1 }, { id: 'flood.b', label: 'b', weight: 1 }]);
  const overall = computeOverallReadiness([a, b], new Set(['tornado.a', 'flood.a']));
  assert.equal(overall.percent, 75);
  assert.equal(overall.weakest, 'flood');
});

test('overall ignores checklist-less guides', () => {
  const a = guide('tornado', [{ id: 'tornado.a', label: 'a', weight: 1 }]);
  const none = guide('civil_unrest', []);
  const overall = computeOverallReadiness([a, none], new Set(['tornado.a']));
  assert.equal(overall.percent, 100);
  assert.equal(overall.weakest, 'tornado');
});
