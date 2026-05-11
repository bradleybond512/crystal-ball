import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VERDICT_BADGE,
  formatLatency,
  overallVerdict,
  type SidecarSelfTestSummary,
} from '../sidecar-self-test.ts';

test('VERDICT_BADGE covers ok / degraded / fail with icon + colour + label', () => {
  assert.equal(VERDICT_BADGE.ok.icon, '✓');
  assert.equal(VERDICT_BADGE.degraded.icon, '⚠');
  assert.equal(VERDICT_BADGE.fail.icon, '✗');
  for (const v of ['ok', 'degraded', 'fail'] as const) {
    assert.match(VERDICT_BADGE[v].color, /^#[0-9a-f]{6}$/i);
    assert.ok(VERDICT_BADGE[v].label.length > 0);
  }
});

test('formatLatency renders ms below 1s, seconds above', () => {
  assert.equal(formatLatency(0), '0 ms');
  assert.equal(formatLatency(123), '123 ms');
  assert.equal(formatLatency(999), '999 ms');
  assert.equal(formatLatency(1500), '1.50 s');
  assert.equal(formatLatency(4321), '4.32 s');
});

test('formatLatency returns "—" for NaN / Infinity', () => {
  assert.equal(formatLatency(Number.NaN), '—');
  assert.equal(formatLatency(Number.POSITIVE_INFINITY), '—');
});

test('overallVerdict reports fail when any probe failed', () => {
  const summary: SidecarSelfTestSummary = { total: 5, ok: 3, degraded: 1, fail: 1 };
  assert.equal(overallVerdict(summary), 'fail');
});

test('overallVerdict reports degraded when probes are slow but none failed', () => {
  const summary: SidecarSelfTestSummary = { total: 5, ok: 3, degraded: 2, fail: 0 };
  assert.equal(overallVerdict(summary), 'degraded');
});

test('overallVerdict reports ok when every probe passed', () => {
  const summary: SidecarSelfTestSummary = { total: 5, ok: 5, degraded: 0, fail: 0 };
  assert.equal(overallVerdict(summary), 'ok');
});
