import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSafetyCaseDashboardService,
  STORAGE_KEY,
  MAX_CHECKS,
  ALL_SAFETY_PROPERTY_IDS,
  type SafetyCheckResult,
  type SituationInput,
} from '../../src/services/intelligence/safety-case-dashboard.ts';
import type { SafetyPropertyId } from '../../src/services/intelligence/repair-engine.ts';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem(key: string) { return store.get(key) ?? null; },
    setItem(key: string, value: string) { store.set(key, String(value)); },
    removeItem(key: string) { store.delete(key); },
    clear() { store.clear(); },
    key(i: number) { return [...store.keys()][i] ?? null; },
    get length() { return store.size; },
  };
}

const NOW = new Date('2026-05-17T12:00:00Z').getTime();

// ── Constants ────────────────────────────────────────────────────────────

test('STORAGE_KEY is "wm-safety-case"', () => {
  assert.equal(STORAGE_KEY, 'wm-safety-case');
});

test('MAX_CHECKS is 2000', () => {
  assert.equal(MAX_CHECKS, 2000);
});

test('ALL_SAFETY_PROPERTY_IDS has all 8 properties', () => {
  assert.equal(ALL_SAFETY_PROPERTY_IDS.length, 8);
  const ids = new Set(ALL_SAFETY_PROPERTY_IDS);
  assert.ok(ids.has('ACCURACY'));
  assert.ok(ids.has('BIAS-FREE'));
  assert.ok(ids.has('ASSUMPTIONS-DISCLOSED'));
  assert.ok(ids.has('ALERT-BUDGET'));
  assert.ok(ids.has('FEED-COVERAGE'));
  assert.ok(ids.has('FALSE-POSITIVE-RATE'));
  assert.ok(ids.has('HUMAN-IN-LOOP'));
  assert.ok(ids.has('ALGORITHM-STABLE'));
});

// ── recordCheck ──────────────────────────────────────────────────────────

test('recordCheck assigns id and checkedAt, returns full SafetyCheckResult', () => {
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => NOW });
  const rec = svc.recordCheck({
    propertyId: 'FEED-COVERAGE',
    situationId: 'sit-1',
    passed: true,
    evidence: 'has 3 signals',
  });
  assert.ok(rec.id);
  assert.equal(rec.checkedAt, NOW);
  assert.equal(rec.propertyId, 'FEED-COVERAGE');
  assert.equal(rec.passed, true);
});

test('recordCheck ids are unique across calls', () => {
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => NOW });
  const ids = new Set<string>();
  for (let i = 0; i < 5; i++) {
    ids.add(svc.recordCheck({ propertyId: 'ACCURACY', situationId: 's', passed: true, evidence: '' }).id);
  }
  assert.equal(ids.size, 5);
});

// ── runChecks: returns 8 results ─────────────────────────────────────────

test('runChecks returns 8 results, one per SafetyPropertyId', () => {
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.runChecks({ id: 'sit-1', severity: 'medium', domain: 'earthquake' });
  assert.equal(results.length, 8);
  const props = new Set(results.map((r) => r.propertyId));
  assert.equal(props.size, 8);
});

test('runChecks tags every result with the situation id', () => {
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.runChecks({ id: 'sit-X', severity: 'medium', domain: 'earthquake' });
  for (const r of results) {
    assert.equal(r.situationId, 'sit-X');
  }
});

test('runChecks persists every result to history', () => {
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => NOW });
  svc.runChecks({ id: 'sit-1', severity: 'medium', domain: 'earthquake' });
  for (const id of ALL_SAFETY_PROPERTY_IDS) {
    assert.equal(svc.getChecksForProperty(id).length, 1);
  }
});

// ── FEED-COVERAGE heuristic ──────────────────────────────────────────────

test('FEED-COVERAGE passes when signals has at least 1 entry', () => {
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.runChecks({
    id: 'sit-1', severity: 'medium', domain: 'earthquake',
    signals: [{ sourceId: 'a' }],
  });
  const cov = results.find((r) => r.propertyId === 'FEED-COVERAGE')!;
  assert.equal(cov.passed, true);
});

test('FEED-COVERAGE fails when signals is empty', () => {
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.runChecks({
    id: 'sit-1', severity: 'medium', domain: 'earthquake',
    signals: [],
  });
  const cov = results.find((r) => r.propertyId === 'FEED-COVERAGE')!;
  assert.equal(cov.passed, false);
});

test('FEED-COVERAGE fails when signals is absent', () => {
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.runChecks({ id: 'sit-1', severity: 'medium', domain: 'earthquake' });
  const cov = results.find((r) => r.propertyId === 'FEED-COVERAGE')!;
  assert.equal(cov.passed, false);
});

// ── BIAS-FREE / source-diversity heuristic ───────────────────────────────

test('BIAS-FREE passes when signals has 2+ distinct sources', () => {
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.runChecks({
    id: 'sit-1', severity: 'medium', domain: 'earthquake',
    signals: [{ sourceId: 'a' }, { sourceId: 'b' }],
  });
  const bias = results.find((r) => r.propertyId === 'BIAS-FREE')!;
  assert.equal(bias.passed, true);
});

test('BIAS-FREE fails when only one distinct source', () => {
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.runChecks({
    id: 'sit-1', severity: 'medium', domain: 'earthquake',
    signals: [{ sourceId: 'a' }, { sourceId: 'a' }, { sourceId: 'a' }],
  });
  const bias = results.find((r) => r.propertyId === 'BIAS-FREE')!;
  assert.equal(bias.passed, false);
});

test('BIAS-FREE stub-passes when signals are absent', () => {
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.runChecks({ id: 'sit-1', severity: 'medium', domain: 'earthquake' });
  const bias = results.find((r) => r.propertyId === 'BIAS-FREE')!;
  assert.equal(bias.passed, true);
});

// ── ACCURACY / confidence-calibration heuristic ──────────────────────────

test('ACCURACY passes when severity is not critical (regardless of signal count)', () => {
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.runChecks({ id: 'sit-1', severity: 'high', domain: 'earthquake', signals: [] });
  const acc = results.find((r) => r.propertyId === 'ACCURACY')!;
  assert.equal(acc.passed, true);
});

test('ACCURACY passes when critical AND signals count >= 3', () => {
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.runChecks({
    id: 'sit-1', severity: 'critical', domain: 'earthquake',
    signals: [{ sourceId: 'a' }, { sourceId: 'b' }, { sourceId: 'c' }],
  });
  const acc = results.find((r) => r.propertyId === 'ACCURACY')!;
  assert.equal(acc.passed, true);
});

test('ACCURACY fails when critical AND signals count < 3', () => {
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.runChecks({
    id: 'sit-1', severity: 'critical', domain: 'earthquake',
    signals: [{ sourceId: 'a' }],
  });
  const acc = results.find((r) => r.propertyId === 'ACCURACY')!;
  assert.equal(acc.passed, false);
});

// ── Stub passes (TODO heuristics) ───────────────────────────────────────

test('stub-only properties always pass with "not evaluated" evidence', () => {
  const stubs: SafetyPropertyId[] = [
    'FALSE-POSITIVE-RATE',
    'ASSUMPTIONS-DISCLOSED',
    'ALGORITHM-STABLE',
    'ALERT-BUDGET',
    'HUMAN-IN-LOOP',
  ];
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.runChecks({ id: 'sit-1', severity: 'critical', domain: 'earthquake' });
  for (const id of stubs) {
    const r = results.find((res) => res.propertyId === id)!;
    assert.equal(r.passed, true);
    assert.match(r.evidence, /not evaluated/i);
  }
});

// ── getSummary ──────────────────────────────────────────────────────────

test('getSummary returns 8 propertySummaries', () => {
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => NOW });
  svc.runChecks({ id: 'sit-1', severity: 'medium', domain: 'earthquake', signals: [{ sourceId: 'a' }] });
  const summary = svc.getSummary();
  assert.equal(summary.propertySummaries.length, 8);
});

test('overallPassRate is total passes / total checks', () => {
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => NOW });
  svc.runChecks({ id: 'sit-1', severity: 'medium', domain: 'earthquake' }); // FEED-COVERAGE + BIAS-FREE handled separately; 7 pass + 1 fail (FEED-COVERAGE absent → fail)
  const summary = svc.getSummary();
  // 7/8 should pass given default heuristics + stubs (FEED-COVERAGE fails when no signals)
  assert.ok(Math.abs(summary.overallPassRate - 7 / 8) < 0.0001);
});

test('totalChecks reflects the total count across all properties', () => {
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => NOW });
  svc.runChecks({ id: 'sit-1', severity: 'medium', domain: 'earthquake' });
  svc.runChecks({ id: 'sit-2', severity: 'medium', domain: 'earthquake' });
  assert.equal(svc.getSummary().totalChecks, 16);
});

test('criticalFailures returns last 10 failed checks (LIFO)', () => {
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => NOW });
  // 12 runs without signals → 12 FEED-COVERAGE failures
  for (let i = 0; i < 12; i++) {
    svc.runChecks({ id: `sit-${i}`, severity: 'medium', domain: 'earthquake' });
  }
  const summary = svc.getSummary();
  assert.equal(summary.criticalFailures.length, 10);
  // Newest first
  for (const f of summary.criticalFailures) {
    assert.equal(f.passed, false);
  }
});

test('propertySummary passRate computes pass / total per property', () => {
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => NOW });
  for (let i = 0; i < 4; i++) {
    svc.runChecks({
      id: `sit-${i}`, severity: 'medium', domain: 'earthquake',
      signals: i < 2 ? [{ sourceId: 'a' }] : [],
    });
  }
  const summary = svc.getSummary();
  const cov = summary.propertySummaries.find((p) => p.propertyId === 'FEED-COVERAGE')!;
  assert.ok(Math.abs(cov.passRate - 0.5) < 0.0001);
});

test('lastCheckedAt is the timestamp of the most recent check', () => {
  let clock = NOW;
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => clock });
  svc.runChecks({ id: 'sit-1', severity: 'medium', domain: 'earthquake', signals: [{ sourceId: 'a' }] });
  clock = NOW + 60_000;
  svc.runChecks({ id: 'sit-2', severity: 'medium', domain: 'earthquake', signals: [{ sourceId: 'a' }] });
  const cov = svc.getSummary().propertySummaries.find((p) => p.propertyId === 'FEED-COVERAGE')!;
  assert.equal(cov.lastCheckedAt, NOW + 60_000);
});

test('lastCheckedAt is null when no checks have been recorded for a property', () => {
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => NOW });
  const cov = svc.getSummary().propertySummaries.find((p) => p.propertyId === 'FEED-COVERAGE')!;
  assert.equal(cov.lastCheckedAt, null);
});

// ── Trend calculation ───────────────────────────────────────────────────

test('trend: stable when < 20 checks accumulated', () => {
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => NOW });
  for (let i = 0; i < 5; i++) {
    svc.recordCheck({ propertyId: 'ACCURACY', situationId: 's', passed: true, evidence: '' });
  }
  const acc = svc.getSummary().propertySummaries.find((p) => p.propertyId === 'ACCURACY')!;
  assert.equal(acc.trend, 'stable');
});

test('trend: improving when last 10 pass-rate > prior 10 by > 0.05', () => {
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => NOW });
  // Prior 10: 3 passes
  for (let i = 0; i < 7; i++) {
    svc.recordCheck({ propertyId: 'ACCURACY', situationId: 's', passed: false, evidence: '' });
  }
  for (let i = 0; i < 3; i++) {
    svc.recordCheck({ propertyId: 'ACCURACY', situationId: 's', passed: true, evidence: '' });
  }
  // Last 10: 9 passes
  for (let i = 0; i < 9; i++) {
    svc.recordCheck({ propertyId: 'ACCURACY', situationId: 's', passed: true, evidence: '' });
  }
  svc.recordCheck({ propertyId: 'ACCURACY', situationId: 's', passed: false, evidence: '' });
  const acc = svc.getSummary().propertySummaries.find((p) => p.propertyId === 'ACCURACY')!;
  assert.equal(acc.trend, 'improving');
});

test('trend: degrading when last 10 pass-rate < prior 10 by > 0.05', () => {
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => NOW });
  // Prior 10: 9 passes
  for (let i = 0; i < 9; i++) {
    svc.recordCheck({ propertyId: 'ACCURACY', situationId: 's', passed: true, evidence: '' });
  }
  svc.recordCheck({ propertyId: 'ACCURACY', situationId: 's', passed: false, evidence: '' });
  // Last 10: 2 passes
  for (let i = 0; i < 8; i++) {
    svc.recordCheck({ propertyId: 'ACCURACY', situationId: 's', passed: false, evidence: '' });
  }
  for (let i = 0; i < 2; i++) {
    svc.recordCheck({ propertyId: 'ACCURACY', situationId: 's', passed: true, evidence: '' });
  }
  const acc = svc.getSummary().propertySummaries.find((p) => p.propertyId === 'ACCURACY')!;
  assert.equal(acc.trend, 'degrading');
});

test('trend: stable when delta within ±0.05', () => {
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => NOW });
  // 20 checks all pass → delta = 0 → stable
  for (let i = 0; i < 20; i++) {
    svc.recordCheck({ propertyId: 'ACCURACY', situationId: 's', passed: true, evidence: '' });
  }
  const acc = svc.getSummary().propertySummaries.find((p) => p.propertyId === 'ACCURACY')!;
  assert.equal(acc.trend, 'stable');
});

// ── getChecksForProperty ────────────────────────────────────────────────

test('getChecksForProperty returns LIFO (newest first)', () => {
  let clock = NOW;
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => clock });
  svc.recordCheck({ propertyId: 'FEED-COVERAGE', situationId: 's-1', passed: true, evidence: 'a' });
  clock = NOW + 1000;
  svc.recordCheck({ propertyId: 'FEED-COVERAGE', situationId: 's-2', passed: false, evidence: 'b' });
  const checks = svc.getChecksForProperty('FEED-COVERAGE');
  assert.equal(checks[0]!.situationId, 's-2');
  assert.equal(checks[1]!.situationId, 's-1');
});

test('getChecksForProperty respects limit', () => {
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => NOW });
  for (let i = 0; i < 5; i++) {
    svc.recordCheck({ propertyId: 'FEED-COVERAGE', situationId: `s-${i}`, passed: true, evidence: '' });
  }
  assert.equal(svc.getChecksForProperty('FEED-COVERAGE', 3).length, 3);
});

test('getChecksForProperty returns empty array when no checks exist', () => {
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => NOW });
  assert.deepEqual(svc.getChecksForProperty('HUMAN-IN-LOOP'), []);
});

// ── Persistence / ring buffer / subscribe ───────────────────────────────

test('persist + rehydrate round-trip preserves checks', () => {
  const storage = createMemoryStorage();
  const svc1 = createSafetyCaseDashboardService({ storage, now: () => NOW });
  svc1.recordCheck({ propertyId: 'ACCURACY', situationId: 'sit-1', passed: false, evidence: 'fail' });
  const svc2 = createSafetyCaseDashboardService({ storage, now: () => NOW });
  const checks = svc2.getChecksForProperty('ACCURACY');
  assert.equal(checks.length, 1);
  assert.equal(checks[0]!.passed, false);
  assert.equal(checks[0]!.evidence, 'fail');
});

test('ring buffer caps at MAX_CHECKS, evicts oldest', () => {
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => NOW });
  for (let i = 0; i < MAX_CHECKS + 10; i++) {
    svc.recordCheck({ propertyId: 'ACCURACY', situationId: `s-${i}`, passed: true, evidence: '' });
  }
  assert.equal(svc.getSummary().totalChecks, MAX_CHECKS);
});

test('subscribe fires on recordCheck and runChecks', () => {
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => NOW });
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  svc.recordCheck({ propertyId: 'ACCURACY', situationId: 's', passed: true, evidence: '' });
  svc.runChecks({ id: 'sit-1', severity: 'medium', domain: 'earthquake' });
  assert.equal(calls, 2);
});

test('unsubscribe stops further callbacks', () => {
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => NOW });
  let calls = 0;
  const cb = (): void => { calls += 1; };
  svc.subscribe(cb);
  svc.recordCheck({ propertyId: 'ACCURACY', situationId: 's', passed: true, evidence: '' });
  svc.unsubscribe(cb);
  svc.recordCheck({ propertyId: 'ACCURACY', situationId: 's', passed: true, evidence: '' });
  assert.equal(calls, 1);
});

// ── Shape integrity ─────────────────────────────────────────────────────

test('getChecksForProperty returns immutable snapshots', () => {
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => NOW });
  svc.recordCheck({ propertyId: 'ACCURACY', situationId: 's', passed: true, evidence: 'a' });
  const snap = svc.getChecksForProperty('ACCURACY');
  snap[0]!.evidence = 'mutated';
  assert.notEqual(svc.getChecksForProperty('ACCURACY')[0]!.evidence, 'mutated');
});

test('runChecks records carry full evidence strings', () => {
  const svc = createSafetyCaseDashboardService({ storage: createMemoryStorage(), now: () => NOW });
  const results: SafetyCheckResult[] = svc.runChecks({
    id: 'sit-1', severity: 'medium', domain: 'earthquake',
    signals: [{ sourceId: 'a' }, { sourceId: 'b' }, { sourceId: 'c' }],
  });
  for (const r of results) {
    assert.ok(r.evidence.length > 0);
  }
});

test('SituationInput type accepts the spec shape', () => {
  const sit: SituationInput = { id: 'x', severity: 'high', domain: 'cyber', signals: [] };
  assert.equal(sit.id, 'x');
});
