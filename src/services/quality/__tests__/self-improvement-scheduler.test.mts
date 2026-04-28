/**
 * Coverage for self-improvement-scheduler.ts — verifies the
 * deterministic ranker produces a valid weekly improvement report.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { planImprovements, type SchedulerInput } from '../self-improvement-scheduler.ts';
import type { DebtItem } from '../quality-debt.ts';

const NOW = 1_745_000_000_000;

function debt(overrides: Partial<DebtItem> = {}): DebtItem {
  return {
    id: 'd1',
    category: 'noisy_algorithms',
    severity: 'medium',
    ownerArea: 'algorithms',
    impact: 'Big-event-detector noisy on weather_safety',
    recommendedFix: 'Tune the trigger threshold',
    evidence: { sourceId: 'algorithm-health', detail: { rate: 0.4 }, at: NOW - 1_000 },
    status: 'open',
    recordedAt: NOW - 24 * 60 * 60 * 1000,
    ...overrides,
  };
}

function input(overrides: Partial<SchedulerInput> = {}): SchedulerInput {
  return {
    activeDebt: [],
    algorithmHealth: [],
    systemHealth: { unsafeDomains: [], sidecarUnreachable: false },
    generatedAt: NOW,
    ...overrides,
  };
}

test('empty debt → empty plan + summary explains', () => {
  const r = planImprovements(input());
  assert.equal(r.ranked.length, 0);
  assert.equal(r.handoff, undefined);
  assert.match(r.summary, /No improvement candidates/);
});

test('single high-severity small-effort item ranks #1', () => {
  const r = planImprovements(input({
    activeDebt: [debt({ severity: 'high', category: 'unknown_algorithm_health' })],
  }));
  assert.equal(r.ranked.length, 1);
  assert.equal(r.ranked[0]!.priority, 'now');
  assert.ok(r.handoff);
});

test('high-severity small-effort outranks high-severity large-effort', () => {
  const small = debt({
    id: 'small',
    severity: 'high',
    category: 'unknown_algorithm_health', // small effort
  });
  const large = debt({
    id: 'large',
    severity: 'high',
    category: 'missing_sources',          // large effort
  });
  const r = planImprovements(input({ activeDebt: [large, small] }));
  assert.equal(r.ranked[0]!.debtItemId, 'small');
});

test('aged debt boosts above fresh debt of same severity', () => {
  const fresh = debt({ id: 'fresh', recordedAt: NOW - 1 });
  const aged = debt({ id: 'aged', recordedAt: NOW - 30 * 24 * 60 * 60 * 1000 });
  const r = planImprovements(input({ activeDebt: [fresh, aged] }));
  assert.equal(r.ranked[0]!.debtItemId, 'aged');
});

test('handoff outline mentions the debt item id + verification commands', () => {
  const r = planImprovements(input({
    activeDebt: [debt({ id: 'd-test', severity: 'critical' })],
  }));
  assert.ok(r.handoff);
  assert.ok(r.handoff!.steps.some((s) => s.includes('d-test')));
  assert.ok(r.handoff!.verificationCommands.some((c) => c.includes('typecheck')));
  assert.ok(r.handoff!.notesForAgent.some((n) => /SAFETY-CRITICAL/.test(n)));
});

test('topN cutoff defers lower-ranked items with reasons', () => {
  const items: DebtItem[] = [];
  for (let i = 0; i < 8; i++) {
    items.push(debt({ id: `d${i}`, severity: 'medium' }));
  }
  const r = planImprovements(input({ activeDebt: items, topN: 3 }));
  assert.equal(r.ranked.length, 3);
  assert.equal(r.deferred.length, 5);
  for (const d of r.deferred) {
    assert.match(d.reason, /Outranked/);
  }
});

test('unsafe-domain match boosts a candidate', () => {
  const matched = debt({
    id: 'matched',
    impact: 'Weather safety polygon match disabled',
    severity: 'high',
  });
  const unrelated = debt({
    id: 'unrelated',
    impact: 'Coffee shortage forecast lacks samples',
    severity: 'high',
  });
  const r = planImprovements(input({
    activeDebt: [unrelated, matched],
    systemHealth: { unsafeDomains: ['weather_safety'], sidecarUnreachable: false },
  }));
  assert.equal(r.ranked[0]!.debtItemId, 'matched');
});

test('output is JSON-serializable + deterministic', () => {
  const i = input({ activeDebt: [debt(), debt({ id: 'd2', severity: 'critical' })] });
  const a = planImprovements(i);
  const b = planImprovements(i);
  assert.deepEqual(a, b);
  const round = JSON.parse(JSON.stringify(a));
  assert.equal(JSON.stringify(round), JSON.stringify(a));
});
