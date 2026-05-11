/**
 * Tests for the diagnostics self-test classifier. The fan-out probe is
 * exercised end-to-end via the live server tests; here we lock the pure
 * verdict / summary helpers so future tweaks can't drift silently.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  SELF_TEST_TARGETS,
  classifySelfTestResult,
  summarizeSelfTest,
} from '../local-api-server.mjs';

test('SELF_TEST_TARGETS exposes the spec-mandated ≥ 10 routes', () => {
  assert.ok(SELF_TEST_TARGETS.length >= 10, `expected ≥10 targets, got ${SELF_TEST_TARGETS.length}`);
});

test('SELF_TEST_TARGETS each define route / method / domain / timeoutMs', () => {
  for (const t of SELF_TEST_TARGETS) {
    assert.match(t.route, /^\/api\//);
    assert.equal(t.method, 'GET');
    assert.ok(t.domain.length > 0);
    assert.ok(t.timeoutMs > 0 && t.timeoutMs <= 10_000);
  }
});

test('classifySelfTestResult flags any error as fail', () => {
  assert.equal(classifySelfTestResult(0, 100, 'ECONNREFUSED'), 'fail');
  assert.equal(classifySelfTestResult(200, 100, 'timeout after 1500ms'), 'fail');
});

test('classifySelfTestResult flags 4xx/5xx responses as fail', () => {
  assert.equal(classifySelfTestResult(404, 100, null), 'fail');
  assert.equal(classifySelfTestResult(503, 100, null), 'fail');
});

test('classifySelfTestResult flags slow-but-2xx responses as degraded', () => {
  assert.equal(classifySelfTestResult(200, 6000, null), 'degraded');
  assert.equal(classifySelfTestResult(200, 3000, null), 'degraded');
});

test('classifySelfTestResult flags fast 2xx responses as ok', () => {
  assert.equal(classifySelfTestResult(200, 50, null), 'ok');
  assert.equal(classifySelfTestResult(204, 800, null), 'ok');
});

test('summarizeSelfTest rolls up per-verdict counts', () => {
  const results = [
    { verdict: 'ok' }, { verdict: 'ok' }, { verdict: 'degraded' },
    { verdict: 'fail' }, { verdict: 'fail' },
  ];
  assert.deepEqual(summarizeSelfTest(results), { total: 5, ok: 2, degraded: 1, fail: 2 });
});

test('summarizeSelfTest copes with an empty result set', () => {
  assert.deepEqual(summarizeSelfTest([]), { total: 0, ok: 0, degraded: 0, fail: 0 });
});
