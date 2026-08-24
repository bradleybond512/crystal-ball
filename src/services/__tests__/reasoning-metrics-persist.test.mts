/**
 * Tests for reasoning-metrics persistent counter hydration.
 * Uses a fake store injected via the test-only API.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// We test the store injection via the exported initCountersForTest helper.
import {
  incrementCounter,
  getCounters,
  resetMetrics,
  initCountersForTest,
  flushCountersForTest,
} from '../reasoning-metrics.ts';

test('initCountersForTest: hydrates counters additively from fake store', async () => {
  resetMetrics();
  // Pretend we already had 10 from a previous session
  await initCountersForTest({ 'some.counter': 10, 'other.counter': 3 });
  incrementCounter('some.counter', 5);
  const c = getCounters();
  assert.equal(c['some.counter'], 15, 'must add live increments to restored value');
  assert.equal(c['other.counter'], 3, 'other counter must be restored');
});

test('flushCountersForTest: calls persist once for a burst of increments', async () => {
  resetMetrics();
  const persisted: Array<Record<string, number>> = [];
  for (let i = 0; i < 10; i++) incrementCounter('burst.op');
  await flushCountersForTest((counters) => { persisted.push({ ...counters }); });
  // Only one persist call regardless of how many increments happened
  assert.equal(persisted.length, 1, 'must persist exactly once');
  assert.ok((persisted[0]?.['burst.op'] ?? 0) >= 10, 'persisted value must include all increments');
});

test('resetMetrics: clears persisted counters', async () => {
  await initCountersForTest({ x: 5 });
  resetMetrics();
  const c = getCounters();
  assert.equal(c['x'], undefined, 'reset must clear hydrated counters');
});

test('counter persistence and hydration bypass their own IDB instrumentation', () => {
  const metricsSource = readFileSync(new URL('../reasoning-metrics.ts', import.meta.url), 'utf8');
  assert.match(metricsSource, /putMemory\(COUNTERS_KEY, snap, \{ instrument: false \}\)/);
  assert.match(metricsSource, /getMemory<Record<string, number>>\(COUNTERS_KEY, \{ instrument: false \}\)/);
});
