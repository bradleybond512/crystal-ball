import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyProviderHealthState,
  recordFetchOutcome,
  deriveProviderHealth,
  OUTCOME_RING_LIMIT,
} from '../provider-health.ts';

const T0 = 1_750_000_000_000; // fixed epoch base — no Date.now() anywhere
const ok = (at: number, latencyMs = 100) => ({ ok: true, latencyMs, httpStatus: 200, at });
const fail = (at: number, httpStatus = 500) => ({ ok: false, latencyMs: 0, httpStatus, at, errorMessage: `http ${httpStatus}` });

test('healthy after recent successes', () => {
  let s = emptyProviderHealthState();
  s = recordFetchOutcome(s, 'nws-alerts', ok(T0));
  s = recordFetchOutcome(s, 'nws-alerts', ok(T0 + 1000, 200));
  const h = deriveProviderHealth(s, 'nws-alerts', T0 + 2000);
  assert.equal(h.status, 'healthy');
  assert.equal(h.successRate, 1);
  assert.equal(h.p50LatencyMs, 150);
  assert.equal(h.lastSuccessAt, T0 + 1000);
});

test('down after 3 consecutive failures', () => {
  let s = emptyProviderHealthState();
  s = recordFetchOutcome(s, 'nws-alerts', ok(T0));
  for (let i = 1; i <= 3; i++) s = recordFetchOutcome(s, 'nws-alerts', fail(T0 + i * 1000));
  const h = deriveProviderHealth(s, 'nws-alerts', T0 + 4000);
  assert.equal(h.status, 'down');
  assert.equal(h.lastError, 'http 500');
});

test('degraded when success rate below 0.7', () => {
  let s = emptyProviderHealthState();
  // alternate so there are never 3 consecutive failures: F ok F ok F → 2/5 = 0.4
  s = recordFetchOutcome(s, 'nws-alerts', fail(T0));
  s = recordFetchOutcome(s, 'nws-alerts', ok(T0 + 1000));
  s = recordFetchOutcome(s, 'nws-alerts', fail(T0 + 2000));
  s = recordFetchOutcome(s, 'nws-alerts', ok(T0 + 3000));
  s = recordFetchOutcome(s, 'nws-alerts', fail(T0 + 4000));
  const h = deriveProviderHealth(s, 'nws-alerts', T0 + 5000);
  assert.equal(h.status, 'degraded');
});

test('stale when last success older than provider TTL', () => {
  let s = emptyProviderHealthState();
  s = recordFetchOutcome(s, 'nws-alerts', ok(T0)); // nws TTL = 10 min
  const h = deriveProviderHealth(s, 'nws-alerts', T0 + 11 * 60_000);
  assert.equal(h.status, 'stale');
});

test('quota suspected on recent 429', () => {
  let s = emptyProviderHealthState();
  s = recordFetchOutcome(s, 'nws-alerts', ok(T0));
  s = recordFetchOutcome(s, 'nws-alerts', fail(T0 + 1000, 429));
  const h = deriveProviderHealth(s, 'nws-alerts', T0 + 2000);
  assert.equal(h.quotaSuspected, true);
});

test('ring buffer is bounded', () => {
  let s = emptyProviderHealthState();
  for (let i = 0; i < OUTCOME_RING_LIMIT + 25; i++) {
    s = recordFetchOutcome(s, 'nws-alerts', ok(T0 + i * 1000));
  }
  assert.equal(s.outcomes['nws-alerts'].length, OUTCOME_RING_LIMIT);
});

test('unknown provider: derive returns unknown_provider, record is a no-op', () => {
  const s0 = emptyProviderHealthState();
  const s1 = recordFetchOutcome(s0, 'made-up', ok(T0));
  assert.deepEqual(s1.outcomes, {});
  assert.equal(deriveProviderHealth(s1, 'made-up', T0).status, 'unknown_provider');
});

test('no outcomes yet: stale with explanation', () => {
  const h = deriveProviderHealth(emptyProviderHealthState(), 'nws-alerts', T0);
  assert.equal(h.status, 'stale');
  assert.match(h.reason, /no fetch outcomes/i);
});
