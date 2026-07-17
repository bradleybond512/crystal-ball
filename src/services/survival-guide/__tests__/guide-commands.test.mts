import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGuideCommands } from '../../command-palette/guide-commands.ts';

test('one command per guide, dispatches deep-link event', () => {
  const dispatched: Array<{ name: string; detail: unknown }> = [];
  const cmds = buildGuideCommands((name, detail) => dispatched.push({ name, detail }));
  assert.equal(cmds.length, 24);
  assert.ok(cmds.every((c) => c.id.startsWith('guide:')));
  const tornado = cmds.find((c) => c.id === 'guide:tornado');
  assert.ok(tornado);
  tornado!.action();
  assert.deepEqual(dispatched[0], { name: 'cb:open-survival-guide', detail: { guideId: 'tornado' } });
});
