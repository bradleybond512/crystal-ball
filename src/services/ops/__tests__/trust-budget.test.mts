/**
 * Coverage for trust-budget.ts — verifies per-domain ledger
 * accumulation, verdict bucketing, top-concerns/strengths
 * surfacing, and JSON-serialization invariant.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeTrustBudget,
  isPositiveTrustEvent,
  type TrustEvent,
} from '../trust-budget.ts';

test('empty events → neutral across all domains', () => {
  const r = computeTrustBudget({ events: [] });
  // balance=0 falls in [-10, 20) → neutral, not positive.
  // worst is the worst across all domains, which is also neutral.
  assert.equal(r.worst, 'neutral');
  for (const dom of Object.keys(r.byDomain)) {
    const s = r.byDomain[dom as keyof typeof r.byDomain];
    assert.equal(s.balance, 0);
    assert.equal(s.verdict, 'neutral');
  }
});

test('single positive event lifts a domain to positive verdict (weight 12)', () => {
  const r = computeTrustBudget({
    events: [{ domain: 'weather_safety', kind: 'warned_early', at: 1 }],
  });
  // warned_early = +12, balance 12 ∈ [-10, 20) → still neutral
  assert.equal(r.byDomain.weather_safety.balance, 12);
  assert.equal(r.byDomain.weather_safety.verdict, 'neutral');
});

test('multiple positive events push verdict to positive', () => {
  const events: TrustEvent[] = [
    { domain: 'weather_safety', kind: 'warned_early', at: 1 },
    { domain: 'weather_safety', kind: 'resolved_accurately', at: 2 },
    { domain: 'weather_safety', kind: 'explained_clearly', at: 3 },
  ];
  const r = computeTrustBudget({ events });
  assert.equal(r.byDomain.weather_safety.balance, 12 + 8 + 4);
  assert.equal(r.byDomain.weather_safety.verdict, 'positive');
});

test('wrong_resolution + late_warning push domain to negative', () => {
  const events: TrustEvent[] = [
    { domain: 'cyber_exposure', kind: 'wrong_resolution', at: 1 },
    { domain: 'cyber_exposure', kind: 'late_warning', at: 2 },
  ];
  const r = computeTrustBudget({ events });
  assert.equal(r.byDomain.cyber_exposure.balance, -22);
  assert.equal(r.byDomain.cyber_exposure.verdict, 'negative');
});

test('extreme negative balance flips to critical_debt', () => {
  const events: TrustEvent[] = [];
  for (let i = 0; i < 5; i++) {
    events.push({ domain: 'weather_safety', kind: 'wrong_resolution', at: i });
  }
  const r = computeTrustBudget({ events });
  assert.equal(r.byDomain.weather_safety.verdict, 'critical_debt');
});

test('balance is clamped to [-100, +100]', () => {
  const events: TrustEvent[] = [];
  for (let i = 0; i < 100; i++) {
    events.push({ domain: 'weather_safety', kind: 'warned_early', at: i });
  }
  const r = computeTrustBudget({ events });
  assert.equal(r.byDomain.weather_safety.balance, 100);
});

test('topConcerns surfaces highest-weight negatives, sorted', () => {
  const events: TrustEvent[] = [
    { domain: 'weather_safety', kind: 'noisy', at: 1 },           // -5
    { domain: 'weather_safety', kind: 'wrong_resolution', at: 2 }, // -12
    { domain: 'weather_safety', kind: 'unclear_explanation', at: 3 }, // -3
    { domain: 'weather_safety', kind: 'late_warning', at: 4 },     // -10
  ];
  const r = computeTrustBudget({ events });
  const kinds = r.byDomain.weather_safety.topConcerns.map((e) => e.kind);
  assert.deepEqual(kinds, ['wrong_resolution', 'late_warning', 'noisy']);
});

test('topStrengths surfaces highest-weight positives', () => {
  const events: TrustEvent[] = [
    { domain: 'weather_safety', kind: 'explained_clearly', at: 1 }, // +4
    { domain: 'weather_safety', kind: 'warned_early', at: 2 },       // +12
    { domain: 'weather_safety', kind: 'useful_action', at: 3 },      // +5
    { domain: 'weather_safety', kind: 'resolved_accurately', at: 4 },// +8
  ];
  const r = computeTrustBudget({ events });
  const kinds = r.byDomain.weather_safety.topStrengths.map((e) => e.kind);
  assert.deepEqual(kinds, ['warned_early', 'resolved_accurately', 'useful_action']);
});

test('weightOverride takes precedence over default', () => {
  const r = computeTrustBudget({
    events: [{ domain: 'weather_safety', kind: 'noisy', at: 1, weightOverride: -50 }],
  });
  assert.equal(r.byDomain.weather_safety.balance, -50);
  assert.equal(r.byDomain.weather_safety.spent, 50);
});

test('worst verdict spans all domains', () => {
  const r = computeTrustBudget({
    events: [
      { domain: 'cyber_exposure', kind: 'wrong_resolution', at: 1 },
      { domain: 'weather_safety', kind: 'warned_early', at: 2 },
    ],
  });
  // cyber: -12 (negative) ; weather: +12 (neutral, since +12 < 20)
  assert.equal(r.worst, 'negative');
});

test('output is JSON-serializable', () => {
  const r = computeTrustBudget({
    events: [{ domain: 'weather_safety', kind: 'warned_early', at: 1 }],
  });
  const round = JSON.parse(JSON.stringify(r));
  assert.deepEqual(round, r);
});

test('determinism: same events → same report', () => {
  const events: TrustEvent[] = [
    { domain: 'weather_safety', kind: 'warned_early', at: 1 },
    { domain: 'weather_safety', kind: 'noisy', at: 2 },
  ];
  const a = computeTrustBudget({ events, generatedAt: 100 });
  const b = computeTrustBudget({ events, generatedAt: 100 });
  assert.deepEqual(a, b);
});

test('isPositiveTrustEvent classifier', () => {
  assert.equal(isPositiveTrustEvent('warned_early'), true);
  assert.equal(isPositiveTrustEvent('wrong_resolution'), false);
});
