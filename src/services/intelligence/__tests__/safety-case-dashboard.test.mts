import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSafetyCaseDashboardService,
  _resetSafetyCaseDashboardSingletonForTests,
} from '../safety-case-dashboard.js';

test.beforeEach(() => {
  _resetSafetyCaseDashboardSingletonForTests();
});

test('stubbed safety checks report not_implemented, never passed', () => {
  const svc = createSafetyCaseDashboardService({ storage: null });
  const results = svc.runChecks({
    id: 'test-sit-1',
    severity: 'medium',
    domain: 'system',
    // signals omitted so BIAS-FREE stub path triggers
  });
  for (const r of results) {
    if (r.evidence.includes('no real check wired yet') || r.status === 'not_implemented') {
      assert.equal(
        r.status,
        'not_implemented',
        `${r.propertyId} is a stub but claims status=${r.status}`,
      );
      assert.equal(
        r.passed,
        false,
        `${r.propertyId} stub should have passed=false`,
      );
    }
  }
});

test('FEED-COVERAGE passes when signals present', () => {
  const svc = createSafetyCaseDashboardService({ storage: null });
  const results = svc.runChecks({
    id: 'sit-2',
    severity: 'low',
    domain: 'weather',
    signals: [{ sourceId: 'nws' }],
  });
  const fc = results.find((r) => r.propertyId === 'FEED-COVERAGE');
  assert.ok(fc, 'FEED-COVERAGE result present');
  assert.equal(fc!.status, 'passed');
  assert.equal(fc!.passed, true);
});

test('FEED-COVERAGE fails when signals absent', () => {
  const svc = createSafetyCaseDashboardService({ storage: null });
  const results = svc.runChecks({ id: 'sit-3', severity: 'low', domain: 'weather' });
  const fc = results.find((r) => r.propertyId === 'FEED-COVERAGE');
  assert.ok(fc);
  assert.equal(fc!.status, 'failed');
  assert.equal(fc!.passed, false);
});

test('BIAS-FREE passes with 2+ distinct sources', () => {
  const svc = createSafetyCaseDashboardService({ storage: null });
  const results = svc.runChecks({
    id: 'sit-4',
    severity: 'low',
    domain: 'weather',
    signals: [{ sourceId: 'nws' }, { sourceId: 'noaa' }],
  });
  const bf = results.find((r) => r.propertyId === 'BIAS-FREE');
  assert.ok(bf);
  assert.equal(bf!.status, 'passed');
});

test('stub properties all return not_implemented with signals present', () => {
  const STUB_IDS = ['FALSE-POSITIVE-RATE', 'ASSUMPTIONS-DISCLOSED', 'ALGORITHM-STABLE', 'ALERT-BUDGET', 'HUMAN-IN-LOOP'];
  const svc = createSafetyCaseDashboardService({ storage: null });
  const results = svc.runChecks({
    id: 'sit-5',
    severity: 'low',
    domain: 'system',
    signals: [{ sourceId: 'self' }],
  });
  for (const id of STUB_IDS) {
    const r = results.find((x) => x.propertyId === id);
    assert.ok(r, `${id} result present`);
    assert.equal(r!.status, 'not_implemented', `${id} should be not_implemented`);
    assert.equal(r!.passed, false, `${id} stub should have passed=false`);
  }
});
