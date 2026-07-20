import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SOURCE_TO_PANEL } from '../alert-routing';
import { PANEL_METADATA } from '@/config/panel-metadata';

test('every SOURCE_TO_PANEL target is a real panel key', () => {
  for (const [source, panelId] of Object.entries(SOURCE_TO_PANEL)) {
    assert.ok(
      Object.hasOwn(PANEL_METADATA, panelId),
      `alert source '${source}' routes to unknown panel '${panelId}'`,
    );
  }
});
