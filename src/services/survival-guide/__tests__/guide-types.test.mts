import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SurvivalGuide, GuideId } from '../guide-types.ts';

test('SurvivalGuide type accepts a well-formed guide', () => {
  const g: SurvivalGuide = {
    id: 'tornado',
    kind: 'hazard',
    title: 'Tornado',
    summary: 's',
    signs: ['a'],
    prepare: [{ label: 'p' }],
    during: [{ label: 'd' }],
    after: [{ label: 'a' }],
    recovery: ['r'],
    mistakes: ['m'],
    checklist: [{ id: 'tornado.x', label: 'x', weight: 2 }],
    relatedGuides: [],
    sources: ['NWS'],
  };
  const id: GuideId = g.id;
  assert.equal(id, 'tornado');
});
