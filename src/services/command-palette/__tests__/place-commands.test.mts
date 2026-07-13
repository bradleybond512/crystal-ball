import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPlaceCommands } from '../place-commands.ts';
import type { PlaceLike } from '../place-commands.ts';

function place(overrides: Partial<PlaceLike> = {}): PlaceLike {
  return { id: 'p1', name: 'Home', lat: 41.6, lon: -86.7, primary: true, ...overrides };
}

test('builds one navigation command per place with stable ids', () => {
  const dispatched: Array<{ name: string; detail?: unknown }> = [];
  const cmds = buildPlaceCommands([place(), place({ id: 'p2', name: 'Work', primary: false })], (name, detail) =>
    dispatched.push({ name, detail }),
  );
  assert.deepEqual(cmds.map((c) => c.id), ['place:p1', 'place:p2']);
  assert.equal(cmds[0]!.title, 'Go to Home');
  assert.equal(cmds[0]!.category, 'navigation');
  assert.ok(cmds[0]!.keywords.includes('home'));
  assert.ok(cmds[0]!.keywords.includes('place'));
  cmds[1]!.action();
  assert.deepEqual(dispatched, [{ name: 'cb:focus-place', detail: { placeId: 'p2', lat: 41.6, lon: -86.7 } }]);
});

test('primary place gets a small positive weight', () => {
  const cmds = buildPlaceCommands([place(), place({ id: 'p2', primary: false })], () => {});
  assert.ok((cmds[0]!.weight ?? 0) > (cmds[1]!.weight ?? 0));
});
