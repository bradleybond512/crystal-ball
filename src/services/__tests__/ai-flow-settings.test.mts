import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { shouldInitializeBrowserMl } from '../ai-flow-settings.ts';

test('browser ML remains off until the user enables it', () => {
  assert.equal(shouldInitializeBrowserMl(false, { browserModel: false }), false);
  assert.equal(shouldInitializeBrowserMl(false, { browserModel: true }), true);
});

test('UI-only E2E never initializes browser ML', () => {
  assert.equal(shouldInitializeBrowserMl(true, { browserModel: true }), false);
});
