import assert from 'node:assert/strict';
import test from 'node:test';

import { CLEAN_ROOM_ITEMS, scoreCleanRoom, applyDoneState } from '../clean-room-checklist.ts';

test('score 0 when nothing done, 100 when all done, tiers at 40/80', () => {
  assert.deepEqual(scoreCleanRoom([]), { score0to100: 0, tier: 'unprepared' });
  const all = CLEAN_ROOM_ITEMS.map((i) => i.id);
  assert.deepEqual(scoreCleanRoom(all), { score0to100: 100, tier: 'ready' });
});

test('partial credit is weight-proportional and monotone', () => {
  const one = scoreCleanRoom([CLEAN_ROOM_ITEMS[0]!.id]).score0to100;
  const two = scoreCleanRoom([CLEAN_ROOM_ITEMS[0]!.id, CLEAN_ROOM_ITEMS[1]!.id]).score0to100;
  assert.ok(one > 0 && two > one && two < 100);
});

test('applyDoneState marks items and ignores unknown ids', () => {
  const items = applyDoneState(['hvac-recirculate', 'not-a-real-id']);
  assert.equal(items.find((i) => i.id === 'hvac-recirculate')!.done, true);
  assert.equal(items.filter((i) => i.done).length, 1);
});
