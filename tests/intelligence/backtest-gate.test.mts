/**
 * Tests for BacktestGate — the pre-apply safety gate.
 *
 * Each test builds a fresh gate via the injectable constructor and
 * uses a deterministic fake BacktestEngine + AlgoEvalLedger so the
 * accuracy/regression math is fully controllable.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const __storage = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => __storage.get(k) ?? null,
  setItem: (k: string, v: string) => { __storage.set(k, v); },
  removeItem: (k: string) => { __storage.delete(k); },
  clear: () => { __storage.clear(); },
  get length() { return __storage.size; },
  key: (i: number) => [...__storage.keys()][i] ?? null,
} as Storage;

import {
  BacktestGate,
  CHANGE_TEMPLATES,
  __internals,
  __resetBacktestGateSingleton,
  getBacktestGate,
  type GateVerdict,
  type ProposedChange,
} from '../../src/services/intelligence/backtest-gate.ts';
import type {
  BacktestConfig,
  BacktestResult,
  BacktestScenario,
  SeverityBand,
} from '../../src/services/intelligence/backtest-engine.ts';
import type { AlgorithmStats } from '../../src/services/intelligence/algo-eval-ledger.ts';

// ── Fakes ─────────────────────────────────────────────────────────────

const NOW = 1_745_000_000_000;

interface FakeBacktestEngineOptions {
  baselineAccuracy?: number;
  proposedAccuracy?: number;
  scenarioCount?: number;
  durationMs?: number;
}

function makeFakeBacktestEngine(
  options: FakeBacktestEngineOptions = {},
): { runBacktest: (config: BacktestConfig) => BacktestResult; lastConfig: () => BacktestConfig | null } {
  let counter = 0;
  let lastConfig: BacktestConfig | null = null;
  return {
    lastConfig: () => lastConfig,
    runBacktest(config: BacktestConfig): BacktestResult {
      lastConfig = config;
      counter += 1;
      const baseline = options.baselineAccuracy ?? 0.6;
      const proposed = options.proposedAccuracy ?? 0.7;
      const scenarioCount = options.scenarioCount ?? config.scenarios.length;
      const scenarioResults = Array.from({ length: scenarioCount }, (_, i) => ({
        scenarioId: `s-${i}`,
        scenarioName: `Scenario ${i}`,
        baselineAccuracy: baseline,
        proposedAccuracy: proposed,
        passed: proposed - baseline >= config.minAccuracyDelta,
      }));
      return {
        id: `bt-${counter}`,
        config,
        baselineAccuracy: baseline,
        proposedAccuracy: proposed,
        accuracyDelta: proposed - baseline,
        passed: proposed - baseline >= config.minAccuracyDelta,
        scenarioResults,
        recommendation: proposed - baseline >= 0.05 ? 'apply' : 'review',
        explanation: 'fake',
        runAt: new Date(NOW),
        durationMs: options.durationMs ?? 1,
      };
    },
  };
}

function makeFakeEvalLedger(stats: Partial<AlgorithmStats> = {}): { getStats: () => AlgorithmStats } {
  return {
    getStats: () => ({
      algorithmId: stats.algorithmId ?? 'driver-scorer',
      domain: stats.domain ?? '*',
      totalPredictions: stats.totalPredictions ?? 50,
      resolvedCount: stats.resolvedCount ?? 40,
      meanAbsoluteError: stats.meanAbsoluteError,
      accuracy: stats.accuracy ?? 0.62,
      trend: stats.trend ?? 'stable',
      lastEvaluated: stats.lastEvaluated ?? new Date(NOW),
    }),
  };
}

function makeChange(overrides: Partial<ProposedChange> = {}): ProposedChange {
  return {
    algoId: 'driver-scorer',
    paramName: 'severityBands.shift',
    currentValue: 0,
    proposedValue: 0.05,
    rationale: 'tighten thresholds',
    proposedAt: NOW,
    ...overrides,
  };
}

const fakeScenarios: BacktestScenario[] = [
  { id: 's-fixture-1', name: 'fixture-1', description: 'x', observations: [], knownOutcomes: [] },
  { id: 's-fixture-2', name: 'fixture-2', description: 'x', observations: [], knownOutcomes: [] },
  { id: 's-fixture-3', name: 'fixture-3', description: 'x', observations: [], knownOutcomes: [] },
];

function freshGate(
  engineOpts: FakeBacktestEngineOptions = {},
  statsOpts: Partial<AlgorithmStats> = {},
): { gate: BacktestGate; engine: ReturnType<typeof makeFakeBacktestEngine> } {
  __storage.clear();
  const engine = makeFakeBacktestEngine(engineOpts);
  const evalLedger = makeFakeEvalLedger(statsOpts);
  const gate = new BacktestGate({
    backtestEngine: engine as unknown as Parameters<typeof BacktestGate.prototype.submitChange>[0] extends never ? never : never as never,
    evalLedger: evalLedger as never,
    scenarios: fakeScenarios,
    clock: () => NOW,
  });
  return { gate, engine };
}

// ── submitChange / getPending ─────────────────────────────────────────

test('submitChange stores the change and returns an id', () => {
  const { gate } = freshGate();
  const id = gate.submitChange(makeChange());
  assert.ok(id.startsWith('chg-'));
  assert.equal(gate.getPending().length, 1);
});

test('submitChange preserves a caller-provided id', () => {
  const { gate } = freshGate();
  const id = gate.submitChange(makeChange({ id: 'custom-123' }));
  assert.equal(id, 'custom-123');
  assert.ok(gate.getPending().some((c) => c.id === 'custom-123'));
});

test('submitChange ordering matches insertion order', () => {
  const { gate } = freshGate();
  gate.submitChange(makeChange({ id: 'a' }));
  gate.submitChange(makeChange({ id: 'b' }));
  gate.submitChange(makeChange({ id: 'c' }));
  assert.deepEqual(gate.getPending().map((c) => c.id), ['a', 'b', 'c']);
});

// ── evaluate(): approval rule ───────────────────────────────────────

test('evaluate approves when delta > -0.05 AND simulated > 0.5', () => {
  const { gate } = freshGate({ baselineAccuracy: 0.55, proposedAccuracy: 0.7 });
  const verdict = gate.evaluate(makeChange({ id: 'c1' }));
  assert.equal(verdict.approved, true);
  assert.equal(verdict.simulatedAccuracy, 0.7);
});

test('evaluate rejects when simulated accuracy drops below the 50% floor', () => {
  const { gate } = freshGate({ baselineAccuracy: 0.45, proposedAccuracy: 0.4 });
  const verdict = gate.evaluate(makeChange({ id: 'c2' }));
  assert.equal(verdict.approved, false);
  assert.match(verdict.reason, /50% floor/);
});

test('evaluate rejects when accuracy delta regresses past -0.05', () => {
  // Sim 0.6 > 0.5 floor, but current 0.8 → delta -0.2 → reject.
  const { gate } = freshGate(
    { baselineAccuracy: 0.55, proposedAccuracy: 0.6 },
    { accuracy: 0.8 },
  );
  const verdict = gate.evaluate(makeChange({ id: 'c3' }));
  assert.equal(verdict.approved, false);
  assert.match(verdict.reason, /regress/);
});

test('evaluate approves when delta is exactly at the boundary', () => {
  // delta = 0.55 - 0.6 = -0.05 → not > -0.05 → reject
  const { gate } = freshGate(
    { baselineAccuracy: 0.55, proposedAccuracy: 0.55 },
    { accuracy: 0.6 },
  );
  const verdict = gate.evaluate(makeChange({ id: 'c4' }));
  assert.equal(verdict.approved, false);
});

test('evaluate populates simulatedAccuracy + currentAccuracy + delta', () => {
  const { gate } = freshGate({ proposedAccuracy: 0.72 }, { accuracy: 0.6 });
  const verdict = gate.evaluate(makeChange({ id: 'c5' }));
  assert.equal(verdict.simulatedAccuracy, 0.72);
  assert.equal(verdict.currentAccuracy, 0.6);
  assert.equal(verdict.delta, 0.12);
});

test('evaluate records a backtestResultId', () => {
  const { gate, engine } = freshGate();
  const verdict = gate.evaluate(makeChange({ id: 'c6' }));
  const lastConfig = engine.lastConfig();
  assert.ok(lastConfig);
  assert.ok(verdict.backtestResultId);
});

test('evaluate removes the change from the pending queue', () => {
  const { gate } = freshGate();
  gate.submitChange(makeChange({ id: 'c7' }));
  assert.equal(gate.getPending().length, 1);
  gate.evaluate({ ...makeChange({ id: 'c7' }) });
  assert.equal(gate.getPending().length, 0);
});

test('evaluate persists verdict on getVerdict() lookup', () => {
  const { gate } = freshGate();
  gate.evaluate(makeChange({ id: 'c8' }));
  const fetched = gate.getVerdict('c8');
  assert.ok(fetched);
  assert.equal(fetched!.changeId, 'c8');
});

test('evaluate with no scenarios yields a low-confidence rejection', () => {
  __storage.clear();
  const engine = makeFakeBacktestEngine();
  const evalLedger = makeFakeEvalLedger();
  const gate = new BacktestGate({
    backtestEngine: engine as never,
    evalLedger: evalLedger as never,
    scenarios: [],
    clock: () => NOW,
  });
  const verdict = gate.evaluate(makeChange({ id: 'c9' }));
  assert.equal(verdict.approved, false);
  assert.equal(verdict.confidenceLevel, 'low');
  assert.match(verdict.reason, /No backtest scenarios/);
});

// ── confidenceLevel derivation ──────────────────────────────────────

test('confidenceLevel = high when resolvedCount ≥ 30 AND ≥ 3 scenarios', () => {
  const { gate } = freshGate({ scenarioCount: 4 }, { resolvedCount: 40 });
  const verdict = gate.evaluate(makeChange({ id: 'c10' }));
  assert.equal(verdict.confidenceLevel, 'high');
});

test('confidenceLevel = medium when resolvedCount in [10, 30)', () => {
  const { gate } = freshGate({ scenarioCount: 2 }, { resolvedCount: 12 });
  const verdict = gate.evaluate(makeChange({ id: 'c11' }));
  assert.equal(verdict.confidenceLevel, 'medium');
});

test('confidenceLevel = low when resolvedCount < 10', () => {
  const { gate } = freshGate({ scenarioCount: 1 }, { resolvedCount: 3 });
  const verdict = gate.evaluate(makeChange({ id: 'c12' }));
  assert.equal(verdict.confidenceLevel, 'low');
});

// ── Parameter mapping ───────────────────────────────────────────────

test('paramName "severityBands.shift" maps to BacktestParameterChanges.severityBands', () => {
  const params = __internals.mapChangeToParameters(makeChange({
    paramName: 'severityBands.shift', proposedValue: 0.1,
  }));
  assert.ok(params.severityBands);
  assert.equal(params.severityBands!.length, 4);
});

test('paramName "driverWeights.<id>" maps to driverWeights record keyed by id', () => {
  const params = __internals.mapChangeToParameters(makeChange({
    paramName: 'driverWeights.magnitude', proposedValue: 1.5,
  }));
  assert.deepEqual(params.driverWeights, { magnitude: 1.5 });
});

test('numeric proposedValue without a known param prefix → uniform weight scaler', () => {
  const params = __internals.mapChangeToParameters(makeChange({
    paramName: 'correlation.radiusKm', proposedValue: 250,
  }));
  assert.deepEqual(params.driverWeights, { '*': 250 });
});

test('non-numeric proposedValue without a known prefix → empty mapping', () => {
  const params = __internals.mapChangeToParameters(makeChange({
    paramName: 'feature.toggle', proposedValue: 'on',
  }));
  assert.deepEqual(params, {});
});

test('shiftSeverityBands clamps band min into [0, 1]', () => {
  const bands: SeverityBand[] = [
    { min: 0.9, severity: 'critical' },
    { min: 0.1, severity: 'low' },
  ];
  const shifted = __internals.shiftSeverityBands(bands, 0.5);
  assert.equal(shifted[0]!.min, 1);
  assert.equal(shifted[1]!.min, 0.6);
});

// ── Built-in templates ─────────────────────────────────────────────

test('CHANGE_TEMPLATES exposes the three documented templates', () => {
  const ids = CHANGE_TEMPLATES.map((t) => t.id).sort();
  assert.deepEqual(ids, [
    'confidence-threshold-raise',
    'correlation-radius-expand',
    'severity-weight-shift',
  ]);
});

test('every template builds a well-formed ProposedChange', () => {
  for (const template of CHANGE_TEMPLATES) {
    const change = template.build({ algoId: 'algo-x', proposedValue: 0.5 });
    assert.equal(change.algoId, 'algo-x');
    assert.equal(typeof change.paramName, 'string');
    assert.ok(change.rationale.length > 0);
  }
});

test('templates honor a caller-supplied rationale', () => {
  const change = CHANGE_TEMPLATES[0]!.build({
    algoId: 'algo-x',
    proposedValue: 0.5,
    rationale: 'custom because reasons',
  });
  assert.equal(change.rationale, 'custom because reasons');
});

// ── getVerdicts / getVerdict / subscribe ────────────────────────────

test('getVerdicts returns verdicts in insertion order', () => {
  const { gate } = freshGate();
  gate.evaluate(makeChange({ id: 'v1' }));
  gate.evaluate(makeChange({ id: 'v2' }));
  gate.evaluate(makeChange({ id: 'v3' }));
  assert.deepEqual(gate.getVerdicts().map((v) => v.changeId), ['v1', 'v2', 'v3']);
});

test('getVerdict(unknown) returns undefined', () => {
  const { gate } = freshGate();
  assert.equal(gate.getVerdict('does-not-exist'), undefined);
});

test('getVerdict returns a defensive copy', () => {
  const { gate } = freshGate();
  gate.evaluate(makeChange({ id: 'vx' }));
  const v = gate.getVerdict('vx')!;
  v.approved = !v.approved;
  assert.notEqual(gate.getVerdict('vx')!.approved, v.approved);
});

test('subscribe fires on every evaluation', () => {
  const { gate } = freshGate();
  let calls = 0;
  gate.subscribe(() => { calls += 1; });
  gate.evaluate(makeChange({ id: 'va' }));
  gate.evaluate(makeChange({ id: 'vb' }));
  assert.equal(calls, 2);
});

test('subscribe returns an unsubscribe fn', () => {
  const { gate } = freshGate();
  let calls = 0;
  const off = gate.subscribe(() => { calls += 1; });
  gate.evaluate(makeChange({ id: 'vc' }));
  off();
  gate.evaluate(makeChange({ id: 'vd' }));
  assert.equal(calls, 1);
});

test('subscribe listener exception is isolated', () => {
  const { gate } = freshGate();
  let second = false;
  gate.subscribe(() => { throw new Error('boom'); });
  gate.subscribe(() => { second = true; });
  gate.evaluate(makeChange({ id: 've' }));
  assert.equal(second, true);
});

// ── Capacity + persistence ──────────────────────────────────────────

test('verdict history caps at MAX_HISTORY (oldest evicted)', () => {
  const { gate } = freshGate();
  // Push slightly over the cap and assert size respected.
  const cap = __internals.MAX_HISTORY;
  for (let i = 0; i < cap + 5; i += 1) {
    gate.evaluate(makeChange({ id: `v-${i}` }));
  }
  assert.equal(gate.getVerdicts().length, cap);
});

test('pending + verdict snapshot persists across gate instances', () => {
  __storage.clear();
  const engine = makeFakeBacktestEngine();
  const evalLedger = makeFakeEvalLedger();
  const a = new BacktestGate({
    backtestEngine: engine as never,
    evalLedger: evalLedger as never,
    scenarios: fakeScenarios,
    clock: () => NOW,
  });
  a.submitChange(makeChange({ id: 'persist-pending' }));
  a.evaluate(makeChange({ id: 'persist-verdict' }));
  // Pending entry should still be pending; verdict should be re-read.
  const b = new BacktestGate({
    backtestEngine: engine as never,
    evalLedger: evalLedger as never,
    scenarios: fakeScenarios,
    clock: () => NOW,
  });
  assert.ok(b.getPending().some((c) => c.id === 'persist-pending'));
  assert.ok(b.getVerdict('persist-verdict'));
});

test('corrupt persisted payload is ignored without throwing', () => {
  __storage.clear();
  __storage.set('wm-backtest-gate', 'not-json');
  const gate = new BacktestGate({ clock: () => NOW });
  assert.doesNotThrow(() => gate.getVerdicts());
  assert.equal(gate.getVerdicts().length, 0);
});

// ── Singleton ────────────────────────────────────────────────────────

test('getBacktestGate returns a stable singleton', () => {
  __resetBacktestGateSingleton();
  const a = getBacktestGate();
  const b = getBacktestGate();
  assert.equal(a, b);
});

// ── Verdict body details ────────────────────────────────────────────

test('approved verdict reason mentions the simulated accuracy + delta', () => {
  const { gate } = freshGate({ proposedAccuracy: 0.75 }, { accuracy: 0.6 });
  const verdict = gate.evaluate(makeChange({ id: 'reason-1' }));
  assert.match(verdict.reason, /Approved/);
  assert.match(verdict.reason, /75%/);
});

test('rejected verdict reason for low accuracy mentions the 50% floor', () => {
  const { gate } = freshGate({ proposedAccuracy: 0.4 });
  const verdict = gate.evaluate(makeChange({ id: 'reason-2' }));
  assert.match(verdict.reason, /50% floor/);
});

// Teardown
test('teardown clears singleton + storage', () => {
  __resetBacktestGateSingleton();
  __storage.clear();
  const _v: GateVerdict | undefined = undefined;
  void _v;
  assert.ok(true);
});

// ═══════════════════════════════════════════════════════════════════════
// Proposal API — `BacktestProposal` / `BacktestResult` (precision-recall
// gate against historical observation fixtures).
// ═══════════════════════════════════════════════════════════════════════

import type {
  BacktestProposal,
  BacktestResult as ProposalBacktestResult,
} from '../../src/services/intelligence/backtest-gate.ts';
import type { ObservationEvent, ObservationSeverity } from '../../src/types/intelligence';

function freshProposalGate(): BacktestGate {
  __storage.clear();
  __resetBacktestGateSingleton();
  const gate = new BacktestGate({ clock: () => 1_780_000_000_000 });
  gate.resetForTesting();
  return gate;
}

function obs(id: string, severity: ObservationSeverity, tags: string[] = [], domain = 'maritime'): ObservationEvent {
  return {
    id,
    sourceId: 'fixture',
    domain,
    timestamp: 0,
    severity,
    title: id,
    raw: {},
    entityIds: [],
    tags,
  };
}

function balancedFixture(): ObservationEvent[] {
  return [
    obs('h1', 'HIGH', ['storm']),
    obs('h2', 'CRITICAL', ['storm']),
    obs('h3', 'HIGH', ['storm']),
    obs('h4', 'HIGH', ['storm']),
    obs('l1', 'LOW', ['noise']),
    obs('l2', 'MEDIUM', ['noise']),
    obs('l3', 'INFO', ['noise']),
    obs('l4', 'LOW', ['noise']),
  ];
}

// ── submitProposal ────────────────────────────────────────────────────

test('submitProposal: stores a pending proposal with defaults', () => {
  const gate = freshProposalGate();
  const p = gate.submitProposal({
    description: 'Tighten threshold',
    changeType: 'threshold',
    proposedChange: { threshold: 4 },
    currentValue: { threshold: 3 },
  });
  assert.equal(p.status, 'pending');
  assert.equal(p.description, 'Tighten threshold');
  assert.equal(p.changeType, 'threshold');
  assert.ok(p.id.startsWith('prop-'));
  assert.equal(p.createdAt, 1_780_000_000_000);
  assert.equal(p.completedAt, undefined);
  assert.equal(p.result, undefined);
});

test('submitProposal: preserves caller-supplied id', () => {
  const gate = freshProposalGate();
  const p = gate.submitProposal({
    id: 'manual-1',
    description: 'd',
    changeType: 'weight',
    proposedChange: { weight: 1.5 },
    currentValue: { weight: 1 },
  });
  assert.equal(p.id, 'manual-1');
});

test('submitProposal: returns a defensive copy (mutating proposedChange has no effect)', () => {
  const gate = freshProposalGate();
  const p = gate.submitProposal({
    description: '',
    changeType: 'config',
    proposedChange: { threshold: 3 },
    currentValue: { threshold: 2 },
  });
  (p.proposedChange as Record<string, unknown>).threshold = 99;
  const stored = gate.getProposal(p.id)!;
  assert.equal(stored.proposedChange.threshold, 3);
});

test('submitProposal: shows up in getProposals() in insertion order', () => {
  const gate = freshProposalGate();
  const a = gate.submitProposal({ description: 'a', changeType: 'rule', proposedChange: { tag: 'x' }, currentValue: { tag: 'y' } });
  const b = gate.submitProposal({ description: 'b', changeType: 'rule', proposedChange: { tag: 'x' }, currentValue: { tag: 'y' } });
  const list = gate.getProposals();
  assert.equal(list.length, 2);
  assert.equal(list[0]!.id, a.id);
  assert.equal(list[1]!.id, b.id);
});

test('submitProposal: re-submitting with the same id updates in place (no duplicate row)', () => {
  const gate = freshProposalGate();
  const a = gate.submitProposal({ id: 'dupe', description: 'first', changeType: 'config', proposedChange: { threshold: 1 }, currentValue: { threshold: 1 } });
  const b = gate.submitProposal({ id: 'dupe', description: 'second', changeType: 'config', proposedChange: { threshold: 2 }, currentValue: { threshold: 1 } });
  assert.equal(a.id, b.id);
  assert.equal(gate.getProposals().length, 1);
  assert.equal(gate.getProposals()[0]!.description, 'second');
});

// ── runBacktest: math ─────────────────────────────────────────────────

test('runBacktest: threshold change with no precision/recall regression is approved', () => {
  const gate = freshProposalGate();
  // proposedChange threshold = currentValue threshold = baseline.
  // identical params ⇒ delta = 0 ⇒ approved.
  const proposal = gate.submitProposal({
    description: 'no-op',
    changeType: 'threshold',
    proposedChange: { threshold: 3 },
    currentValue: { threshold: 3 },
  });
  const result = gate.runBacktest(proposal.id, balancedFixture());
  assert.equal(result.precisionDelta, 0);
  assert.equal(result.recallDelta, 0);
  assert.equal(result.approved, true);
  assert.match(result.reason, /Approved/);
});

test('runBacktest: raising threshold past every positive label tanks recall → rejected', () => {
  const gate = freshProposalGate();
  const proposal = gate.submitProposal({
    description: 'too tight',
    changeType: 'threshold',
    proposedChange: { threshold: 9 },
    currentValue: { threshold: 3 },
  });
  const result = gate.runBacktest(proposal.id, balancedFixture());
  // proposed picks 0 positives → recall=0; baseline at 3 picks all HIGH/CRIT → recall=1
  assert.equal(result.historicalRecall, 0);
  assert.equal(result.baselineRecall, 1);
  assert.equal(result.recallDelta, -1);
  assert.equal(result.approved, false);
  assert.match(result.reason, /recall/);
});

test('runBacktest: lowering threshold to floor picks every event → precision crashes → rejected', () => {
  const gate = freshProposalGate();
  const proposal = gate.submitProposal({
    description: 'too loose',
    changeType: 'threshold',
    proposedChange: { threshold: 0 },
    currentValue: { threshold: 3 },
  });
  const result = gate.runBacktest(proposal.id, balancedFixture());
  // proposed picks all 8 → 4 TP + 4 FP → precision=0.5
  // baseline picks 4 HIGH/CRIT → 4 TP + 0 FP → precision=1
  assert.equal(result.historicalPrecision, 0.5);
  assert.equal(result.baselinePrecision, 1);
  assert.equal(result.precisionDelta, -0.5);
  assert.equal(result.approved, false);
  assert.match(result.reason, /precision/);
});

test('runBacktest: weight change uses weight*severity vs cutoff', () => {
  const gate = freshProposalGate();
  const proposal = gate.submitProposal({
    description: 'weight tweak',
    changeType: 'weight',
    proposedChange: { weight: 2, cutoff: 5 },
    currentValue: { weight: 1, cutoff: 3 },
  });
  const result = gate.runBacktest(proposal.id, balancedFixture());
  // baseline picks rank ≥ 3 (HIGH/CRIT) → 4 TP, precision=1, recall=1
  // proposed picks rank*2 ≥ 5 → CRIT(8), HIGH(6), MEDIUM(4 < 5 skip), LOW(2 skip)
  //   ⇒ 4 TP (3 HIGH + 1 CRIT), precision=1, recall=1
  assert.equal(result.historicalPrecision, 1);
  assert.equal(result.historicalRecall, 1);
  assert.equal(result.approved, true);
});

test('runBacktest: rule change predicts positive when tag matches', () => {
  const gate = freshProposalGate();
  const proposal = gate.submitProposal({
    description: 'storm rule',
    changeType: 'rule',
    proposedChange: { tag: 'storm' },
    currentValue: { tag: 'storm' },
  });
  const result = gate.runBacktest(proposal.id, balancedFixture());
  // tag='storm' is exactly on the positive examples ⇒ precision=recall=1.
  assert.equal(result.historicalPrecision, 1);
  assert.equal(result.historicalRecall, 1);
  assert.equal(result.approved, true);
});

test('runBacktest: rule change with empty tag predicts nothing → recall 0', () => {
  const gate = freshProposalGate();
  const proposal = gate.submitProposal({
    description: 'empty rule',
    changeType: 'rule',
    proposedChange: { tag: '' },
    currentValue: { tag: 'storm' },
  });
  const result = gate.runBacktest(proposal.id, balancedFixture());
  assert.equal(result.historicalPrecision, 0);
  assert.equal(result.historicalRecall, 0);
  assert.equal(result.approved, false);
});

test('runBacktest: config change behaves like threshold', () => {
  const gate = freshProposalGate();
  const proposal = gate.submitProposal({
    description: 'config tweak',
    changeType: 'config',
    proposedChange: { threshold: 3 },
    currentValue: { threshold: 3 },
  });
  const result = gate.runBacktest(proposal.id, balancedFixture());
  assert.equal(result.precisionDelta, 0);
  assert.equal(result.recallDelta, 0);
  assert.equal(result.approved, true);
});

test('runBacktest: empty observation set yields zeroed precision/recall, still approved (no regression)', () => {
  const gate = freshProposalGate();
  const proposal = gate.submitProposal({
    description: 'empty',
    changeType: 'threshold',
    proposedChange: { threshold: 4 },
    currentValue: { threshold: 3 },
  });
  const result = gate.runBacktest(proposal.id, []);
  assert.equal(result.historicalPrecision, 0);
  assert.equal(result.baselinePrecision, 0);
  assert.equal(result.precisionDelta, 0);
  assert.equal(result.recallDelta, 0);
  assert.equal(result.approved, true);
});

test('runBacktest: precision drop within −0.05 floor is approved', () => {
  const gate = freshProposalGate();
  // 4 positives, 16 negatives. proposed adds 1 FP → precision = 4/5 = 0.8.
  // baseline picks only positives → precision = 1. Delta = −0.2 ⇒ rejected.
  // Use a milder shape: 1 added FP among 20 baseline-correct cases.
  const events: ObservationEvent[] = [
    ...Array.from({ length: 20 }, (_, i) => obs(`h${i}`, 'CRITICAL', ['p'])),
    obs('edge', 'MEDIUM', ['p']), // proposed catches this when threshold drops to 2
  ];
  const proposal = gate.submitProposal({
    description: 'mild',
    changeType: 'threshold',
    proposedChange: { threshold: 2 },
    currentValue: { threshold: 3 },
  });
  const result = gate.runBacktest(proposal.id, events);
  // proposed: 20 TP + 1 FP = 21 predicted, precision 20/21 ≈ 0.9524, recall 1
  // baseline: 20 TP + 0 FP = 20 predicted, precision 1, recall 1
  // precisionDelta ≈ −0.0476  → above −0.05 floor → approved
  assert.ok(Math.abs(result.precisionDelta + 0.0476) < 0.0005);
  assert.equal(result.recallDelta, 0);
  assert.equal(result.approved, true);
});

test('runBacktest: precision drop beyond −0.05 floor is rejected', () => {
  const gate = freshProposalGate();
  const events: ObservationEvent[] = [
    ...Array.from({ length: 10 }, (_, i) => obs(`h${i}`, 'CRITICAL', [])),
    ...Array.from({ length: 2 }, (_, i) => obs(`m${i}`, 'MEDIUM', [])),
  ];
  const proposal = gate.submitProposal({
    description: 'too lossy',
    changeType: 'threshold',
    proposedChange: { threshold: 2 },
    currentValue: { threshold: 3 },
  });
  const result = gate.runBacktest(proposal.id, events);
  // proposed: 10 TP + 2 FP = 12 predictions, precision = 10/12 ≈ 0.833
  // baseline: 10 TP + 0 FP, precision = 1; delta ≈ −0.167 < −0.05 → rejected
  assert.ok(result.precisionDelta < -0.05);
  assert.equal(result.approved, false);
});

test('runBacktest: result.proposalId matches the proposal id', () => {
  const gate = freshProposalGate();
  const proposal = gate.submitProposal({
    description: '',
    changeType: 'threshold',
    proposedChange: { threshold: 3 },
    currentValue: { threshold: 3 },
  });
  const result = gate.runBacktest(proposal.id, balancedFixture());
  assert.equal(result.proposalId, proposal.id);
});

test('runBacktest: result is attached to the proposal record', () => {
  const gate = freshProposalGate();
  const proposal = gate.submitProposal({
    description: '',
    changeType: 'threshold',
    proposedChange: { threshold: 3 },
    currentValue: { threshold: 3 },
  });
  gate.runBacktest(proposal.id, balancedFixture());
  const stored = gate.getProposal(proposal.id)!;
  assert.ok(stored.result);
  assert.equal(stored.result!.proposalId, proposal.id);
  assert.ok(stored.completedAt !== undefined);
});

test('runBacktest: status transitions to approved on success', () => {
  const gate = freshProposalGate();
  const p = gate.submitProposal({
    description: '',
    changeType: 'threshold',
    proposedChange: { threshold: 3 },
    currentValue: { threshold: 3 },
  });
  gate.runBacktest(p.id, balancedFixture());
  assert.equal(gate.getProposal(p.id)!.status, 'approved');
});

test('runBacktest: status transitions to rejected on regression', () => {
  const gate = freshProposalGate();
  const p = gate.submitProposal({
    description: '',
    changeType: 'threshold',
    proposedChange: { threshold: 9 },
    currentValue: { threshold: 3 },
  });
  gate.runBacktest(p.id, balancedFixture());
  assert.equal(gate.getProposal(p.id)!.status, 'rejected');
});

test('runBacktest: throws on unknown proposal id', () => {
  const gate = freshProposalGate();
  assert.throws(() => gate.runBacktest('nope', balancedFixture()), /not found/);
});

// ── approve / reject ─────────────────────────────────────────────────

test('approve: flips status to approved + stamps completedAt', () => {
  const gate = freshProposalGate();
  const p = gate.submitProposal({
    description: '',
    changeType: 'threshold',
    proposedChange: { threshold: 3 },
    currentValue: { threshold: 3 },
  });
  const updated = gate.approve(p.id);
  assert.equal(updated?.status, 'approved');
  assert.ok(updated?.completedAt !== undefined);
});

test('approve: returns undefined for unknown id', () => {
  const gate = freshProposalGate();
  assert.equal(gate.approve('ghost'), undefined);
});

test('reject: stores the reason on the proposal result', () => {
  const gate = freshProposalGate();
  const p = gate.submitProposal({
    description: '',
    changeType: 'threshold',
    proposedChange: { threshold: 3 },
    currentValue: { threshold: 3 },
  });
  const updated = gate.reject(p.id, 'manual operator veto');
  assert.equal(updated?.status, 'rejected');
  assert.equal(updated?.result?.approved, false);
  assert.match(updated!.result!.reason, /operator veto/);
});

test('reject: preserves a prior result snapshot when overriding', () => {
  const gate = freshProposalGate();
  const p = gate.submitProposal({
    description: '',
    changeType: 'threshold',
    proposedChange: { threshold: 3 },
    currentValue: { threshold: 3 },
  });
  gate.runBacktest(p.id, balancedFixture());
  const before = gate.getProposal(p.id)!.result!;
  const updated = gate.reject(p.id, 'overruled');
  // Numeric precision/recall numbers carry over from the prior backtest.
  assert.equal(updated?.result?.historicalPrecision, before.historicalPrecision);
  assert.equal(updated?.result?.approved, false);
});

test('reject: returns undefined for unknown id', () => {
  const gate = freshProposalGate();
  assert.equal(gate.reject('ghost', 'whatever'), undefined);
});

// ── getProposals / getProposal ───────────────────────────────────────

test('getProposals: empty registry returns []', () => {
  const gate = freshProposalGate();
  assert.deepEqual(gate.getProposals(), []);
});

test('getProposal: returns undefined when id is unknown', () => {
  const gate = freshProposalGate();
  assert.equal(gate.getProposal('nope'), undefined);
});

test('getProposal: returns a defensive copy (mutation does not bleed)', () => {
  const gate = freshProposalGate();
  const p = gate.submitProposal({
    description: 'mut',
    changeType: 'config',
    proposedChange: { threshold: 1 },
    currentValue: { threshold: 1 },
  });
  const snap = gate.getProposal(p.id)!;
  snap.description = 'mutated';
  assert.equal(gate.getProposal(p.id)!.description, 'mut');
});

// ── Persistence ──────────────────────────────────────────────────────

test('proposals survive across BacktestGate instances via localStorage', () => {
  __storage.clear();
  __resetBacktestGateSingleton();
  const a = new BacktestGate({ clock: () => 1 });
  a.resetForTesting();
  a.submitProposal({
    description: 'across',
    changeType: 'rule',
    proposedChange: { tag: 't' },
    currentValue: { tag: 'u' },
  });
  const b = new BacktestGate({ clock: () => 2 });
  assert.equal(b.getProposals().length, 1);
  assert.equal(b.getProposals()[0]!.description, 'across');
});

test('cap: proposal history evicts oldest beyond 200', () => {
  const gate = freshProposalGate();
  for (let i = 0; i < 205; i += 1) {
    gate.submitProposal({
      id: `p-${i}`,
      description: '',
      changeType: 'config',
      proposedChange: {},
      currentValue: {},
    });
  }
  const list = gate.getProposals();
  assert.equal(list.length, 200);
  assert.equal(list[0]!.id, 'p-5');
  assert.equal(list[199]!.id, 'p-204');
});

test('corrupted proposal blob is dropped without throwing', () => {
  __storage.clear();
  __resetBacktestGateSingleton();
  __storage.set('wm-backtest-gate', JSON.stringify({ proposals: [{ id: '', changeType: 'bogus' }] }));
  const gate = new BacktestGate();
  assert.deepEqual(gate.getProposals(), []);
});

// ── Singleton ────────────────────────────────────────────────────────

test('BacktestGate.getInstance() returns the same singleton as getBacktestGate()', () => {
  __resetBacktestGateSingleton();
  const a = BacktestGate.getInstance();
  const b = getBacktestGate();
  assert.equal(a, b);
});

test('typed BacktestResult mirrors the proposal id', () => {
  const gate = freshProposalGate();
  const p = gate.submitProposal({
    description: 'shape',
    changeType: 'threshold',
    proposedChange: { threshold: 3 },
    currentValue: { threshold: 3 },
  });
  const r: ProposalBacktestResult = gate.runBacktest(p.id, balancedFixture());
  assert.equal(r.proposalId, p.id);
  const stored: BacktestProposal | undefined = gate.getProposal(p.id);
  assert.ok(stored !== undefined);
});
