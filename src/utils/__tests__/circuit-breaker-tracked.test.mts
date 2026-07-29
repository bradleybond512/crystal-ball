import assert from 'node:assert/strict';
import test from 'node:test';

import { CircuitBreaker } from '../circuit-breaker.ts';

// ── executeTracked: data paired ATOMICALLY with its own outcome state ─────────
// `lastDataState` is a single-slot mutable shared by every caller of one breaker.
// `execute` sets it synchronously in each branch, but a consumer that reads it via
// getDataState() in a LATER microtask than the one that produced its data can see
// a concurrent call's state instead — the TOCTOU behind the weather "all clear"
// fail-open (a failed loader fetch reading a concurrent consumer's fresh `live`).
// executeTracked closes it: it returns { data, dataState } where dataState is a
// snapshot captured in the SAME synchronous branch as the data — bound to THIS
// call's outcome, immune to any later breaker activity.

test('executeTracked pairs data with its own outcome (success → live + finite ts)', async () => {
  const breaker = new CircuitBreaker<number[]>({ name: 'tracked-success', cacheTtlMs: 0 });
  const { data, dataState } = await breaker.executeTracked(async () => [1, 2, 3], []);
  assert.deepEqual(data, [1, 2, 3]);
  assert.equal(dataState.mode, 'live');
  assert.ok(Number.isFinite(dataState.timestamp), 'a live success carries a finite data timestamp');
});

test('executeTracked pairs a failed fetch with unavailable state (fail-closed currency)', async () => {
  const breaker = new CircuitBreaker<number[]>({ name: 'tracked-fail', cacheTtlMs: 0 });
  const { data, dataState } = await breaker.executeTracked(async () => { throw new Error('boom'); }, []);
  assert.deepEqual(data, [], 'a failed fetch yields the default value');
  assert.equal(dataState.mode, 'unavailable');
  assert.equal(dataState.timestamp, null);
});

test('the returned dataState is a frozen snapshot, not a live view of the mutable global', async () => {
  const breaker = new CircuitBreaker<number[]>({ name: 'tracked-snapshot', cacheTtlMs: 0 });
  const failed = await breaker.executeTracked(async () => { throw new Error('boom'); }, []);
  assert.equal(failed.dataState.mode, 'unavailable');
  // A later success moves the SHARED breaker on to `live` (a concurrent consumer)…
  await breaker.execute(async () => [9], []);
  assert.equal(breaker.getDataState().mode, 'live', 'the mutable global moved on');
  // …but the earlier call's captured currency is unchanged — no TOCTOU.
  assert.equal(failed.dataState.mode, 'unavailable');
  assert.equal(failed.dataState.timestamp, null);
});
