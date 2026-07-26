import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeSidecarHealth } from './sidecar-health-contract.mjs';

test('summarizes the canonical sidecar /api/health schema', () => {
  const summary = summarizeSidecarHealth({
    ok: true,
    keys_configured: 3,
    keys_total: 5,
    feeds: [
      { id: 'nws', status: 'ok' },
      { id: 'usgs', status: 'degraded' },
    ],
  });

  assert.deepEqual(summary, {
    feedCount: 2,
    keysConfigured: 3,
    keysTotal: 5,
  });
});

test('rejects malformed health payloads instead of reporting zero activity', () => {
  assert.equal(summarizeSidecarHealth(null), null);
  assert.equal(summarizeSidecarHealth({ ok: true, feeds: 'not-an-array' }), null);
});
