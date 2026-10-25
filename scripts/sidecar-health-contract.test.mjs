import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeSidecarHealth } from './sidecar-health-contract.mjs';

test('summarizes the canonical sidecar /api/health schema', () => {
  const summary = summarizeSidecarHealth({
    ok: true,
    authenticated: true,
    keys_configured: 3,
    keys_total: 5,
    feeds: [
      { key: 'nws', lastError: null },
      { key: 'usgs', lastError: 'fixture error that must not enter the summary' },
    ],
  });

  assert.deepEqual(summary, {
    authenticated: true,
    feedCount: 2,
    failedFeedCount: 1,
    keysConfigured: 3,
    keysTotal: 5,
    keysMissing: 2,
  });
});

test('public liveness is distinguished from authenticated diagnostic availability', () => {
  assert.deepEqual(summarizeSidecarHealth({ ok: true }), { authenticated: false });
  assert.equal(summarizeSidecarHealth({ ok: false }), null);
  assert.equal(summarizeSidecarHealth({ ok: true, feeds: [] }), null,
    'inventory without an explicit authenticated marker is never accepted');
});

test('authenticated summaries expose aggregate degradation without inventory or raw errors', () => {
  const payload = { ok: true, authenticated: true, keys_configured: 0, keys_total: 1,
    feeds: [{ key: 'private-feed-canary', lastError: 'private-error-canary' }] };
  const summary = summarizeSidecarHealth(payload);
  assert.equal(summary.failedFeedCount, 1);
  assert.equal(summary.keysMissing, 1);
  assert.equal(JSON.stringify(summary).includes('canary'), false);
  assert.equal(summarizeSidecarHealth({ ...payload, keys_configured: -1 }), null);
  assert.equal(summarizeSidecarHealth({ ...payload, keys_configured: 2 }), null);
  assert.equal(summarizeSidecarHealth({ ...payload, feeds: [null] }), null);
});

test('rejects malformed health payloads instead of reporting zero activity', () => {
  assert.equal(summarizeSidecarHealth(null), null);
  assert.equal(summarizeSidecarHealth({ ok: true, feeds: 'not-an-array' }), null);
});
