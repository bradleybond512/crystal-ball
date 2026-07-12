import assert from 'node:assert/strict';
import test from 'node:test';

import { buildStatusRibbon } from '../status-ribbon-view.ts';

const NOW = 1_752_000_000_000;

test('healthy system renders ok tone with sweep age', () => {
  const view = buildStatusRibbon(
    { systemStatus: 'healthy', summary: '61/63 feeds healthy', lastSweepAt: NOW - 32_000 },
    NOW,
  );
  assert.equal(view.tone, 'ok');
  assert.equal(view.text, '61/63 feeds healthy · updated 32s ago');
});

test('degraded and stale map to warn', () => {
  for (const status of ['degraded', 'stale', 'unknown']) {
    assert.equal(buildStatusRibbon({ systemStatus: status, summary: 's' }, NOW).tone, 'warn');
  }
});

test('failing, blind, unsafe map to bad', () => {
  for (const status of ['failing', 'blind', 'unsafe']) {
    assert.equal(buildStatusRibbon({ systemStatus: status, summary: 's' }, NOW).tone, 'bad');
  }
});

test('missing sweep timestamp omits the suffix', () => {
  const view = buildStatusRibbon({ systemStatus: 'healthy', summary: 'all good' }, NOW);
  assert.equal(view.text, 'all good');
});
