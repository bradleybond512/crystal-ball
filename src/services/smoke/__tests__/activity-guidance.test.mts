import assert from 'node:assert/strict';
import test from 'node:test';

import { adviseActivities, ACTIVITY_LABELS } from '../activity-guidance.ts';

test('every activity gets a verdict + reason for every category × sensitivity', () => {
  const cats = ['good', 'moderate', 'usg', 'unhealthy', 'very_unhealthy', 'hazardous', 'unknown'] as const;
  for (const cat of cats) {
    for (const sensitive of [false, true]) {
      const advice = adviseActivities(cat, sensitive);
      assert.equal(advice.length, Object.keys(ACTIVITY_LABELS).length, `${cat}/${sensitive}`);
      for (const a of advice) {
        assert.ok(['ok', 'caution', 'avoid'].includes(a.verdict));
        assert.ok(a.reason.length > 0, `${cat}/${sensitive}/${a.activity} needs a reason`);
      }
    }
  }
});

test('sensitivity escalates: sensitive verdicts are never more permissive', () => {
  const rank = { ok: 0, caution: 1, avoid: 2 } as const;
  for (const cat of ['moderate', 'usg', 'unhealthy'] as const) {
    const normal = adviseActivities(cat, false);
    const sensitive = adviseActivities(cat, true);
    for (const [i, a] of normal.entries()) {
      assert.ok(rank[sensitive[i]!.verdict] >= rank[a.verdict], `${cat}/${a.activity}`);
    }
  }
});

test('spot checks match EPA guidance shape', () => {
  const usgSensitive = adviseActivities('usg', true);
  assert.equal(usgSensitive.find((a) => a.activity === 'exercise_outdoors')!.verdict, 'avoid');
  const good = adviseActivities('good', false);
  assert.ok(good.every((a) => a.verdict === 'ok'));
  const unknown = adviseActivities('unknown', false);
  assert.ok(unknown.every((a) => a.verdict === 'caution'));
});
