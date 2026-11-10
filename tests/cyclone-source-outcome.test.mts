import assert from 'node:assert/strict';
import test from 'node:test';
import { dataFreshness } from '../src/services/data-freshness.ts';
import { fetchTropicalCyclones } from '../src/services/tropical-cyclones.ts';

test('cyclone cold dual HTTP failure is unavailable, never fresh empty evidence', async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let calls = 0;
  const updates: unknown[][] = [];
  const originalUpdate = dataFreshness.recordUpdate;
  dataFreshness.recordUnknown('tropical-cyclones', 'isolated fixture');
  try {
    Date.now = () => 1_793_000_000_000;
    dataFreshness.recordUpdate = function (...args: Parameters<typeof originalUpdate>) {
      updates.push(args);
      return originalUpdate.apply(this, args);
    };
    globalThis.fetch = async () => {
      calls += 1;
      return new Response('', { status: 503 });
    };
    const storms = await fetchTropicalCyclones();
    assert.deepEqual(storms, []);
    assert.equal(calls, 2, 'both original transports must be attempted');
    const state = dataFreshness.getSource('tropical-cyclones');
    assert.equal(state?.status, 'error', 'dual provider failure must remain unavailable');
    assert.equal(state?.lastUpdate, null, 'failure must not invent successful observation time');
    assert.equal(updates.length, 0, 'no transient successful update may precede error');
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    dataFreshness.recordUpdate = originalUpdate;
    dataFreshness.recordUnknown('tropical-cyclones', 'fixture restored');
  }
});

// Keep the complete matrix executable through the existing providers entrypoint.
import './cyclone-source-outcome-matrix.test.mts';
