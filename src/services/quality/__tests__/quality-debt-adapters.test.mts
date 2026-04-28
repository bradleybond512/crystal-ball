/**
 * Coverage for quality-debt-adapters.ts — verifies that real
 * diagnostic snapshots map deterministically to debt-seed lists.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  debtFromSmokeOutcomes,
  debtFromProviderSnapshots,
  debtFromAlgorithmHealth,
  debtFromFailurePrediction,
  type SmokePanelOutcome,
} from '../quality-debt-adapters.ts';
import type { ProviderSnapshot } from '@/services/diagnostics/provider-redundancy';
import type { AlgorithmHealth } from '@/services/algorithms/algorithm-health';
import type { PredictedRiskReport } from '@/services/diagnostics/failure-prediction';

const NOW = 1_745_000_000_000;

// ── Smoke-outcomes adapter ─────────────────────────────────────────────

test('smoke: rendered/degraded/skipped → no debt', () => {
  const outcomes: SmokePanelOutcome[] = [
    { panelId: 'a', state: 'rendered', reason: '' },
    { panelId: 'b', state: 'degraded', reason: 'banner shown' },
    { panelId: 'c', state: 'skipped', reason: 'WebGL' },
  ];
  assert.equal(debtFromSmokeOutcomes(outcomes, NOW).length, 0);
});

test('smoke: silent → medium debt; errored → high', () => {
  const outcomes: SmokePanelOutcome[] = [
    { panelId: 'silent-panel', state: 'silent', reason: 'no DOM written' },
    { panelId: 'crashy-panel', state: 'errored', reason: 'TypeError' },
  ];
  const debt = debtFromSmokeOutcomes(outcomes, NOW);
  assert.equal(debt.length, 2);
  const silent = debt.find((d) => d.id.includes('silent-panel'))!;
  const errored = debt.find((d) => d.id.includes('crashy-panel'))!;
  assert.equal(silent.severity, 'medium');
  assert.equal(errored.severity, 'high');
});

test('smoke: ids are deterministic across runs (so dedup works)', () => {
  const outcomes: SmokePanelOutcome[] = [
    { panelId: 'p1', state: 'errored', reason: 'X' },
  ];
  const a = debtFromSmokeOutcomes(outcomes, NOW);
  const b = debtFromSmokeOutcomes(outcomes, NOW);
  assert.equal(a[0]!.id, b[0]!.id);
});

// ── Provider-redundancy adapter ───────────────────────────────────────

const providerBase: Omit<ProviderSnapshot, 'level'> = {
  providerId: 'nws',
  domain: 'weather',
  label: 'NWS',
  primary: true,
};

test('provider: silent → critical debt (missing_sources)', () => {
  const debt = debtFromProviderSnapshots([{ ...providerBase, level: 'silent' }], NOW);
  assert.equal(debt.length, 1);
  assert.equal(debt[0]!.severity, 'critical');
  assert.equal(debt[0]!.category, 'missing_sources');
});

test('provider: failing → high; degraded → medium', () => {
  const debt = debtFromProviderSnapshots([
    { ...providerBase, providerId: 'p1', level: 'failing' },
    { ...providerBase, providerId: 'p2', level: 'degraded' },
  ], NOW);
  assert.equal(debt.length, 2);
  const failing = debt.find((d) => d.id.includes('p1'))!;
  const degraded = debt.find((d) => d.id.includes('p2'))!;
  assert.equal(failing.severity, 'high');
  assert.equal(degraded.severity, 'medium');
  assert.equal(failing.category, 'insufficient_provider_redundancy');
});

test('provider: healthy → no debt', () => {
  const debt = debtFromProviderSnapshots([{ ...providerBase, level: 'healthy' }], NOW);
  assert.equal(debt.length, 0);
});

// ── Algorithm-health adapter ──────────────────────────────────────────

test('algo: healthy → no debt', () => {
  const row: AlgorithmHealth = {
    algorithmId: 'truth-score',
    label: 'Truth scoring',
    domain: 'truth_score',
    criticality: 'high',
    status: 'healthy',
    reason: 'OK',
    explanation: ['Hit rate 0.85'],
  };
  assert.equal(debtFromAlgorithmHealth([row], NOW).length, 0);
});

test('algo: unknown safety-critical → high debt; unknown low-crit → low', () => {
  const safety: AlgorithmHealth = {
    algorithmId: 'weather-urgency',
    label: 'Weather urgency',
    domain: 'weather_urgency',
    criticality: 'safety',
    status: 'unknown',
    reason: 'Insufficient samples',
    explanation: [],
  };
  const minor: AlgorithmHealth = {
    algorithmId: 'truth-score',
    label: 'Truth scoring',
    domain: 'truth_score',
    criticality: 'low',
    status: 'unknown',
    reason: 'Insufficient samples',
    explanation: [],
  };
  const debt = debtFromAlgorithmHealth([safety, minor], NOW);
  const safetyDebt = debt.find((d) => d.id.includes('weather-urgency'))!;
  const minorDebt = debt.find((d) => d.id.includes('truth-score'))!;
  assert.equal(safetyDebt.severity, 'high');
  assert.equal(minorDebt.severity, 'low');
});

test('algo: failing safety → critical debt; failing high → high', () => {
  const rows: AlgorithmHealth[] = [
    { algorithmId: 'a', label: 'A', domain: 'truth_score', criticality: 'safety', status: 'failing', reason: '', explanation: [] },
    { algorithmId: 'b', label: 'B', domain: 'truth_score', criticality: 'high', status: 'unsafe', reason: '', explanation: [] },
  ];
  const debt = debtFromAlgorithmHealth(rows, NOW);
  const a = debt.find((d) => d.id.includes(':a:'))!;
  const b = debt.find((d) => d.id.includes(':b:'))!;
  assert.equal(a.severity, 'critical');
  assert.equal(b.severity, 'high');
});

// ── Failure-prediction adapter ────────────────────────────────────────

test('failure-prediction: only unsafe / high produce debt', () => {
  const report: PredictedRiskReport = {
    generatedAt: NOW,
    worst: 'unsafe',
    summary: 'Worst: unsafe',
    predictions: [
      {
        capabilityId: 'cap-low',
        domain: 'weather_safety',
        level: 'low',
        score: 0.1,
        reasons: [],
        recommendations: [],
      },
      {
        capabilityId: 'cap-elevated',
        domain: 'weather_safety',
        level: 'elevated',
        score: 0.3,
        reasons: [],
        recommendations: [],
      },
      {
        capabilityId: 'cap-high',
        domain: 'weather_safety',
        level: 'high',
        score: 0.55,
        reasons: [{ id: 'algo_failing', text: 'algo failing', weight: 0.5 }],
        recommendations: [{ id: 'fix', text: 'Fix it', needsUser: false }],
      },
      {
        capabilityId: 'cap-unsafe',
        domain: 'cyber_exposure',
        level: 'unsafe',
        score: 0.9,
        reasons: [{ id: 'capability_not_ready', text: 'not ready', weight: 0.6 }],
        recommendations: [],
      },
    ],
  };
  const debt = debtFromFailurePrediction(report, NOW);
  assert.equal(debt.length, 2);
  const unsafe = debt.find((d) => d.id.includes('cap-unsafe'))!;
  const high = debt.find((d) => d.id.includes('cap-high'))!;
  assert.equal(unsafe.severity, 'critical');
  assert.equal(high.severity, 'high');
  // unsafe has capability_not_ready → maps to missing_mission_bridges
  assert.equal(unsafe.category, 'missing_mission_bridges');
  // high has algo_failing → maps to noisy_algorithms
  assert.equal(high.category, 'noisy_algorithms');
});

test('failure-prediction: empty report → no debt', () => {
  const report: PredictedRiskReport = {
    generatedAt: NOW,
    worst: 'low',
    summary: 'All clear',
    predictions: [],
  };
  assert.equal(debtFromFailurePrediction(report, NOW).length, 0);
});

// ── Determinism ───────────────────────────────────────────────────────

test('determinism: same snapshot produces identical debt-seed list', () => {
  const outcomes: SmokePanelOutcome[] = [
    { panelId: 'p1', state: 'silent', reason: 'X' },
    { panelId: 'p2', state: 'errored', reason: 'Y' },
  ];
  const a = debtFromSmokeOutcomes(outcomes, NOW);
  const b = debtFromSmokeOutcomes(outcomes, NOW);
  assert.deepEqual(a, b);
});
