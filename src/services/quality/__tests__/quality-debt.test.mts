/**
 * Coverage for quality-debt.ts — verifies append-only registry,
 * status transitions, impact-score sorting, and resolution-with-
 * evidence enforcement.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createQualityDebtRegistry,
  debtImpactScore,
  type DebtEvidence,
} from '../quality-debt.ts';

const sampleEvidence: DebtEvidence = {
  sourceId: 'algorithm-health',
  detail: { algorithmId: 'truth-score', sampleCount: 5 },
  at: 1_000,
};

test('record creates an open item with assigned id', () => {
  const r = createQualityDebtRegistry();
  const item = r.record({
    category: 'unknown_algorithm_health',
    severity: 'high',
    ownerArea: 'algorithms',
    impact: 'truth-score in unknown status',
    recommendedFix: 'Bump sample-size threshold',
    evidence: sampleEvidence,
  });
  assert.match(item.id, /^debt-\d+$/);
  assert.equal(item.status, 'open');
});

test('acknowledge → in_progress → resolved status flow', () => {
  const r = createQualityDebtRegistry();
  const a = r.record({
    category: 'noisy_algorithms',
    severity: 'medium',
    ownerArea: 'algorithms',
    impact: 'High false-positive rate on big-event-detector',
    recommendedFix: 'Tighten the trigger threshold',
    evidence: sampleEvidence,
  });
  const ack = r.acknowledge(a.id);
  assert.equal(ack.status, 'acknowledged');
  const inProg = r.startWork(a.id);
  assert.equal(inProg.status, 'in_progress');
  const resolved = r.resolve(a.id, 'claude-session-x', {
    sourceId: 'algorithm-health',
    detail: { newFalsePositiveRate: 0.1 },
    at: 2_000,
  });
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.resolvedBy, 'claude-session-x');
});

test('cannot resolve without evidence', () => {
  const r = createQualityDebtRegistry();
  const a = r.record({
    category: 'missing_sources',
    severity: 'critical',
    ownerArea: 'providers',
    impact: 'No backup provider for NWS',
    recommendedFix: 'Add MeteoAlarm or NOAA SWPC fallback',
    evidence: sampleEvidence,
  });
  assert.throws(
    () => r.resolve(a.id, 'claude', { sourceId: '', detail: {}, at: 0 }),
    /without evidence/,
  );
});

test('cannot acknowledge / start a resolved item', () => {
  const r = createQualityDebtRegistry();
  const a = r.record({
    category: 'stale_baselines',
    severity: 'low',
    ownerArea: 'ops',
    impact: 'Baseline cache hasn\'t refreshed in 7 days',
    recommendedFix: 'Run rebuild job',
    evidence: sampleEvidence,
  });
  r.resolve(a.id, 'claude', sampleEvidence);
  assert.throws(() => r.acknowledge(a.id), /already resolved/);
  assert.throws(() => r.startWork(a.id), /already resolved/);
});

test('active() returns only non-resolved items, sorted by impact desc', () => {
  const r = createQualityDebtRegistry();
  r.record({
    category: 'noisy_algorithms', severity: 'low', ownerArea: 'diagnostics',
    impact: 'Minor noise', recommendedFix: 'tune', evidence: sampleEvidence,
  });
  r.record({
    category: 'missing_sources', severity: 'critical', ownerArea: 'providers',
    impact: 'No backup', recommendedFix: 'add fallback', evidence: sampleEvidence,
  });
  r.record({
    category: 'unknown_algorithm_health', severity: 'high', ownerArea: 'algorithms',
    impact: 'Unknown', recommendedFix: 'sample more', evidence: sampleEvidence,
  });
  const active = r.active();
  // Critical/providers (12 × 1.4 = 16.8) > High/algorithms (7 × 1.5 = 10.5) >
  // Low/diagnostics (1 × 1.0 = 1.0)
  assert.equal(active.length, 3);
  assert.equal(active[0]!.severity, 'critical');
  assert.equal(active[1]!.severity, 'high');
  assert.equal(active[2]!.severity, 'low');
});

test('id collision throws', () => {
  const r = createQualityDebtRegistry();
  r.record({
    id: 'fixed', category: 'noisy_algorithms', severity: 'low', ownerArea: 'algorithms',
    impact: 'x', recommendedFix: 'y', evidence: sampleEvidence,
  });
  assert.throws(() => r.record({
    id: 'fixed', category: 'noisy_algorithms', severity: 'low', ownerArea: 'algorithms',
    impact: 'x2', recommendedFix: 'y2', evidence: sampleEvidence,
  }), /already recorded/);
});

test('debtImpactScore exposed for external sorting', () => {
  const a = debtImpactScore({ severity: 'critical', ownerArea: 'providers' });
  const b = debtImpactScore({ severity: 'low', ownerArea: 'diagnostics' });
  assert.ok(a > b);
});

test('toJson is round-trippable + deterministic', () => {
  const r = createQualityDebtRegistry({ now: (() => { let t = 0; return () => ++t; })() });
  r.record({
    category: 'noisy_algorithms', severity: 'medium', ownerArea: 'algorithms',
    impact: 'x', recommendedFix: 'y', evidence: sampleEvidence,
  });
  const json = r.toJson();
  const round = JSON.parse(JSON.stringify(json));
  assert.equal(JSON.stringify(round), JSON.stringify(json));
});
