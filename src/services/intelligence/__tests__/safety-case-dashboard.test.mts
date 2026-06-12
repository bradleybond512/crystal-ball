import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSafetyCaseDashboardService,
  getSafetyCaseDashboardService,
  _resetSafetyCaseDashboardSingletonForTests,
} from '../safety-case-dashboard.js';
import {
  buildDefaultProbes,
  __resetIntelligenceHealthMonitorSingleton,
} from '../intelligence-health-monitor.js';

test.beforeEach(() => {
  _resetSafetyCaseDashboardSingletonForTests();
  __resetIntelligenceHealthMonitorSingleton();
});

test('stubbed safety checks report not_implemented, never passed', () => {
  const svc = createSafetyCaseDashboardService({ storage: null });
  const results = svc.runChecks({
    id: 'test-sit-1',
    severity: 'medium',
    domain: 'system',
    // signals omitted so BIAS-FREE stub path triggers
  });
  // A stub that falsely claims 'passed' would slip through a filter on
  // r.status === 'not_implemented', so we gate on evidence text only.
  for (const r of results) {
    if (r.evidence.includes('no real check wired yet')) {
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

test('summary excludes not_implemented from failCount and criticalFailures', () => {
  const svc = createSafetyCaseDashboardService({ storage: null });
  // Run checks: 3 real properties checked (FEED-COVERAGE pass, ACCURACY pass,
  // BIAS-FREE pass with 2 sources), plus 5 stubs → not_implemented.
  svc.runChecks({
    id: 'sit-6',
    severity: 'low',
    domain: 'system',
    signals: [{ sourceId: 'nws' }, { sourceId: 'noaa' }],
  });
  const summary = svc.getSummary();

  // not_implemented count must equal the 5 stub properties (+ BIAS-FREE never,
  // since signals provided → BIAS-FREE runs real check above).
  assert.equal(summary.notImplementedCount, 5, 'exactly 5 not_implemented stubs');

  // criticalFailures must be empty — no actual failed checks.
  assert.equal(summary.criticalFailures.length, 0, 'no criticalFailures from stubs');

  // overallPassRate should be computed over implemented checks only (3/3 = 1.0).
  assert.equal(summary.overallPassRate, 1.0, 'pass rate over implemented checks only');

  // Per-property: each stub should have failCount=0 and notImplementedCount>0.
  for (const ps of summary.propertySummaries) {
    if (ps.notImplementedCount === ps.totalChecks && ps.totalChecks > 0) {
      assert.equal(ps.failCount, 0, `${ps.propertyId} stub should have failCount=0`);
      assert.equal(ps.passRate, 0, `${ps.propertyId} stub passRate is 0 (no implemented checks)`);
    }
  }
});

test('summary notImplementedCount field exists and counts stubs correctly', () => {
  const svc = createSafetyCaseDashboardService({ storage: null });
  const summary = svc.getSummary();
  // No checks run yet.
  assert.equal(summary.notImplementedCount, 0, 'zero before any checks');

  svc.runChecks({ id: 'sit-7', severity: 'low', domain: 'system' });
  const after = svc.getSummary();
  // 5 explicit stubs + BIAS-FREE (signals absent) = 6 not_implemented.
  assert.equal(after.notImplementedCount, 6, '6 not_implemented after one runChecks with no signals');
});

// ── Health monitor safety-case probe tests ────────────────────────────────────
// These tests use getSafetyCaseDashboardService() (the singleton) so that
// buildDefaultProbes() — which calls getSafetyCaseDashboardService() internally —
// sees the same instance.

test('health monitor safety-case probe returns unknown when all checks are not_implemented', () => {
  // Force all checks to be not_implemented by injecting a fake getSummary result.
  // We test the probe by replacing the singleton with a mock that returns
  // notImplementedCount === totalChecks > 0, overallPassRate = 0.
  const probes = buildDefaultProbes();
  const safetyProbe = probes.find((p) => p.componentId === 'safety-case');
  assert.ok(safetyProbe, 'safety-case probe present in buildDefaultProbes');

  // The singleton was reset in beforeEach → getSafetyCaseDashboardService() creates
  // a fresh one with no checks run → notImplementedCount=0, totalChecks=0.
  // We need totalChecks > 0 with all not_implemented. Achieve this by running
  // checks with no signals on a fresh singleton (6 not_implemented, 2 failed).
  // That doesn't give all-not-implemented, so we can't rely on the real service
  // for this edge case. Instead, swap the singleton out with a stub by calling
  // createSafetyCaseDashboardService with a custom getSummary override via monkey-patch.
  // Simpler: test the logic directly via a custom probe that mirrors the fix.
  //
  // The probe reads getSafetyCaseDashboardService().getSummary().
  // We verify the FIXED behaviour: a real summary where all N checks are
  // not_implemented must not return status='error'. We do this by making the
  // fresh singleton return a known all-not-implemented summary by forcing
  // the stub service to override getSummary.

  // Use the singleton returned by getSafetyCaseDashboardService().
  const svc = getSafetyCaseDashboardService();
  // Patch getSummary to simulate all-not-implemented with totalChecks=5.
  const origGetSummary = svc.getSummary.bind(svc);
  (svc as unknown as Record<string, unknown>)['getSummary'] = () => ({
    overallPassRate: 0,
    totalChecks: 5,
    notImplementedCount: 5,
    failCount: 0,
    criticalFailures: [],
    propertySummaries: [],
  });

  try {
    const result = safetyProbe!.run(Date.now());
    assert.equal(result.status, 'unknown', 'should be unknown when all checks are not_implemented');
    assert.ok(
      typeof result.detail === 'string' && result.detail.includes('no implemented safety checks'),
      `detail should mention no implemented checks; got: ${result.detail}`,
    );
  } finally {
    (svc as unknown as Record<string, unknown>)['getSummary'] = origGetSummary;
  }
});

test('health monitor safety-case probe scores normally when at least one implemented check exists', () => {
  // Use the real singleton with 2-source checks so FEED-COVERAGE + BIAS-FREE + ACCURACY pass.
  const svc = getSafetyCaseDashboardService();
  svc.runChecks({
    id: 'probe-sit-2',
    severity: 'low',
    domain: 'weather',
    signals: [{ sourceId: 'nws' }, { sourceId: 'noaa' }],
  });
  const summary = svc.getSummary();
  // Precondition: some checks are implemented.
  assert.ok(
    summary.notImplementedCount < summary.totalChecks,
    'precondition: at least one implemented check',
  );

  const probes = buildDefaultProbes();
  const safetyProbe = probes.find((p) => p.componentId === 'safety-case')!;
  const result = safetyProbe.run(Date.now());

  assert.notEqual(result.status, 'unknown', 'should not be unknown when implemented checks exist');
  assert.ok(
    typeof result.detail === 'string' && result.detail.includes('passRate='),
    `detail should include passRate; got: ${result.detail}`,
  );
});
