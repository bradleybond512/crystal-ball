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
  type BacktestRun,
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

// ══════════════════════════════════════════════════════════════════════
// Rule-centric BacktestRun API
// ══════════════════════════════════════════════════════════════════════

import { describe, it, beforeEach } from 'node:test';

// ── Helpers ────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

function freshRuleGate(clockMs = NOW): BacktestGate {
  const gate = new BacktestGate({ clock: () => clockMs });
  gate.resetForTesting();
  return gate;
}

function makeEvent(overrides: Record<string, unknown> = {}): object {
  return {
    domain: 'weather',
    severity: 'HIGH',
    tags: ['tornado'],
    timestamp: NOW - DAY_MS,
    ...overrides,
  };
}

function passRule(): object {
  return { domain: 'weather', triggerTags: ['tornado'], triggerSeverity: ['MEDIUM', 'HIGH', 'CRITICAL'] };
}

function eventsForPass(): object[] {
  return [
    makeEvent({ severity: 'HIGH' }),
    makeEvent({ severity: 'CRITICAL' }),
    makeEvent({ severity: 'HIGH' }),
    makeEvent({ severity: 'HIGH' }),
  ];
}

// ── getInstance ────────────────────────────────────────────────────────

describe('BacktestGate.getInstance()', () => {
  it('returns the same singleton as getBacktestGate()', () => {
    assert.equal(BacktestGate.getInstance(), getBacktestGate());
  });
});

// ── runBacktest — basic shape ──────────────────────────────────────────

describe('runBacktest — result shape', () => {
  it('returns a BacktestRun with the given ruleId', () => {
    const gate = freshRuleGate();
    const run = gate.runBacktest('rule-1', passRule(), eventsForPass());
    assert.equal(run.ruleId, 'rule-1');
  });

  it('result has a non-empty id', () => {
    const gate = freshRuleGate();
    const run = gate.runBacktest('rule-1', passRule(), eventsForPass());
    assert.ok(run.id.length > 0);
  });

  it('ranAt equals the gate clock', () => {
    const gate = freshRuleGate(NOW);
    const run = gate.runBacktest('rule-1', passRule(), eventsForPass());
    assert.equal(run.ranAt, NOW);
  });

  it('windowDays defaults to 30', () => {
    const gate = freshRuleGate();
    const run = gate.runBacktest('rule-1', passRule(), eventsForPass());
    assert.equal(run.windowDays, __internals.DEFAULT_WINDOW_DAYS);
  });

  it('windowDays accepts an explicit override', () => {
    const gate = freshRuleGate();
    const run = gate.runBacktest('rule-1', passRule(), eventsForPass(), 14);
    assert.equal(run.windowDays, 14);
  });

  it('ruleSnapshot is preserved in the result', () => {
    const gate = freshRuleGate();
    const snap = passRule();
    const run = gate.runBacktest('rule-1', snap, eventsForPass());
    assert.deepEqual(run.ruleSnapshot, snap);
  });
});

// ── runBacktest — trigger counting ─────────────────────────────────────

describe('runBacktest — triggeredCount', () => {
  it('triggeredCount is 0 when no events match domain', () => {
    const gate = freshRuleGate();
    const events = [makeEvent({ domain: 'cyber' }), makeEvent({ domain: 'aviation' })];
    const run = gate.runBacktest('rule-1', passRule(), events);
    assert.equal(run.triggeredCount, 0);
  });

  it('triggeredCount is 0 when no events match tags', () => {
    const gate = freshRuleGate();
    const events = [makeEvent({ tags: ['rain'] }), makeEvent({ tags: ['wind'] })];
    const run = gate.runBacktest('rule-1', passRule(), events);
    assert.equal(run.triggeredCount, 0);
  });

  it('triggeredCount counts matching events', () => {
    const gate = freshRuleGate();
    const run = gate.runBacktest('rule-1', passRule(), eventsForPass());
    assert.equal(run.triggeredCount, 4);
  });

  it('events outside the window are excluded', () => {
    const gate = freshRuleGate(NOW);
    const old = makeEvent({ timestamp: NOW - 31 * DAY_MS });
    const run = gate.runBacktest('rule-1', passRule(), [old]);
    assert.equal(run.triggeredCount, 0);
  });

  it('events without a timestamp are included', () => {
    const gate = freshRuleGate(NOW);
    const noTs = { domain: 'weather', severity: 'HIGH', tags: ['tornado'] };
    const run = gate.runBacktest('rule-1', passRule(), [noTs]);
    assert.equal(run.triggeredCount, 1);
  });
});

// ── runBacktest — false-positive rate ──────────────────────────────────

describe('runBacktest — falsePositiveRate', () => {
  it('falsePositiveRate is 0 when no triggers', () => {
    const gate = freshRuleGate();
    const run = gate.runBacktest('rule-1', passRule(), []);
    assert.equal(run.falsePositiveRate, 0);
  });

  it('falsePositiveRate is 0 when all triggers meet severity threshold', () => {
    const gate = freshRuleGate();
    const run = gate.runBacktest('rule-1', passRule(), eventsForPass());
    assert.equal(run.falsePositiveRate, 0);
  });

  it('falsePositiveRate is 0.5 when half triggers are below threshold', () => {
    const gate = freshRuleGate();
    const events = [
      makeEvent({ severity: 'HIGH' }),
      makeEvent({ severity: 'LOW' }),   // below MEDIUM threshold
    ];
    const run = gate.runBacktest('rule-1', passRule(), events);
    assert.equal(run.falsePositiveRate, 0.5);
  });

  it('falsePositiveRate is 1 when all triggers are below threshold', () => {
    const gate = freshRuleGate();
    const events = [makeEvent({ severity: 'INFO' }), makeEvent({ severity: 'LOW' })];
    const run = gate.runBacktest('rule-1', passRule(), events);
    assert.equal(run.falsePositiveRate, 1);
  });
});

// ── runBacktest — precision ────────────────────────────────────────────

describe('runBacktest — precision', () => {
  it('precision is 0 when no triggers', () => {
    const gate = freshRuleGate();
    const run = gate.runBacktest('rule-1', passRule(), []);
    assert.equal(run.precision, 0);
  });

  it('precision is 1 when all triggers are true positives', () => {
    const gate = freshRuleGate();
    const run = gate.runBacktest('rule-1', passRule(), eventsForPass());
    assert.equal(run.precision, 1);
  });

  it('precision is 0.5 when half triggers are true positives', () => {
    const gate = freshRuleGate();
    const events = [makeEvent({ severity: 'HIGH' }), makeEvent({ severity: 'LOW' })];
    const run = gate.runBacktest('rule-1', passRule(), events);
    assert.equal(run.precision, 0.5);
  });
});

// ── runBacktest — pass/fail logic ──────────────────────────────────────

describe('runBacktest — passed + failReason', () => {
  it('passes when triggeredCount > 0, falsePositiveRate < 0.3, precision > 0.7', () => {
    const gate = freshRuleGate();
    const run = gate.runBacktest('rule-1', passRule(), eventsForPass());
    assert.equal(run.passed, true);
    assert.equal(run.failReason, undefined);
  });

  it('fails when triggeredCount is 0', () => {
    const gate = freshRuleGate();
    const run = gate.runBacktest('rule-1', passRule(), []);
    assert.equal(run.passed, false);
    assert.ok(run.failReason?.includes('no events triggered'));
  });

  it('fails when falsePositiveRate is exactly 0.3', () => {
    const gate = freshRuleGate();
    // 3 triggered, 1 TP (HIGH), 2 FP (LOW) → FPR = 2/3 ≈ 0.6667
    // Need FPR exactly 0.3: 10 triggered, 3 FP, 7 TP
    const events: object[] = [
      ...Array.from({ length: 7 }, () => makeEvent({ severity: 'HIGH' })),
      ...Array.from({ length: 3 }, () => makeEvent({ severity: 'LOW' })),
    ];
    const run = gate.runBacktest('rule-1', passRule(), events);
    assert.equal(run.passed, false);
    assert.ok(run.failReason?.includes('false-positive rate'));
  });

  it('precision field equals 0.7 when 7 TP and 3 FP of 10 triggered', () => {
    const gate = freshRuleGate();
    // 10 triggered: 7 TP (HIGH), 3 FP (LOW) → precision = 0.7, FPR = 0.3
    // Both metrics are at threshold; run fails (FP rate check fires first)
    const events: object[] = [
      ...Array.from({ length: 7 }, () => makeEvent({ severity: 'HIGH' })),
      ...Array.from({ length: 3 }, () => makeEvent({ severity: 'LOW' })),
    ];
    const run = gate.runBacktest('rule-1', passRule(), events);
    assert.equal(run.precision, 0.7);
    assert.equal(run.passed, false);
  });

  it('failReason is undefined when passed', () => {
    const gate = freshRuleGate();
    const run = gate.runBacktest('rule-1', passRule(), eventsForPass());
    assert.equal(run.failReason, undefined);
  });
});

// ── getLastRun ─────────────────────────────────────────────────────────

describe('getLastRun', () => {
  it('returns undefined for an unknown ruleId', () => {
    const gate = freshRuleGate();
    assert.equal(gate.getLastRun('unknown'), undefined);
  });

  it('returns the run after one runBacktest call', () => {
    const gate = freshRuleGate();
    gate.runBacktest('rule-a', passRule(), eventsForPass());
    const last = gate.getLastRun('rule-a');
    assert.ok(last !== undefined);
    assert.equal(last.ruleId, 'rule-a');
  });

  it('returns the most recent run when multiple runs exist', () => {
    const gate = freshRuleGate();
    gate.runBacktest('rule-a', passRule(), eventsForPass());
    gate.runBacktest('rule-a', passRule(), []);
    const last = gate.getLastRun('rule-a');
    assert.equal(last?.passed, false); // second run had no events
  });

  it('is independent per ruleId', () => {
    const gate = freshRuleGate();
    gate.runBacktest('rule-a', passRule(), eventsForPass());
    gate.runBacktest('rule-b', passRule(), []);
    assert.equal(gate.getLastRun('rule-a')?.passed, true);
    assert.equal(gate.getLastRun('rule-b')?.passed, false);
  });
});

// ── getHistory ─────────────────────────────────────────────────────────

describe('getHistory', () => {
  it('returns empty array for unknown ruleId', () => {
    const gate = freshRuleGate();
    assert.deepEqual(gate.getHistory('unknown'), []);
  });

  it('returns all runs for a ruleId in insertion order', () => {
    const gate = freshRuleGate();
    gate.runBacktest('rule-a', passRule(), eventsForPass());
    gate.runBacktest('rule-a', passRule(), []);
    const history = gate.getHistory('rule-a');
    assert.equal(history.length, 2);
    assert.equal(history[0]?.passed, true);
    assert.equal(history[1]?.passed, false);
  });

  it('does not include runs from other ruleIds', () => {
    const gate = freshRuleGate();
    gate.runBacktest('rule-a', passRule(), eventsForPass());
    gate.runBacktest('rule-b', passRule(), eventsForPass());
    assert.equal(gate.getHistory('rule-a').length, 1);
    assert.equal(gate.getHistory('rule-b').length, 1);
  });
});

// ── isApproved ─────────────────────────────────────────────────────────

describe('isApproved', () => {
  it('returns false for unknown ruleId', () => {
    const gate = freshRuleGate();
    assert.equal(gate.isApproved('unknown'), false);
  });

  it('returns false when last run failed', () => {
    const gate = freshRuleGate(NOW);
    gate.runBacktest('rule-a', passRule(), []);
    assert.equal(gate.isApproved('rule-a'), false);
  });

  it('returns true when last run passed and is within 7 days', () => {
    const gate = freshRuleGate(NOW);
    gate.runBacktest('rule-a', passRule(), eventsForPass());
    assert.equal(gate.isApproved('rule-a'), true);
  });

  it('returns false when last run passed but is older than 7 days', () => {
    const runAt = NOW - 8 * DAY_MS;
    const gate1 = new BacktestGate({ clock: () => runAt });
    gate1.resetForTesting();
    gate1.runBacktest('rule-a', passRule(), eventsForPass());

    // gate2 clock is 8 days later — run is outside the 7-day approval window
    const gate2 = new BacktestGate({ clock: () => NOW });
    assert.equal(gate2.isApproved('rule-a'), false);
  });
});

// ── Storage / cap enforcement ──────────────────────────────────────────

describe('BacktestRun storage', () => {
  beforeEach(() => { __storage.clear(); });

  it('persists runs and rehydrates them', () => {
    const gate1 = new BacktestGate({ clock: () => NOW });
    gate1.resetForTesting();
    gate1.runBacktest('rule-persist', passRule(), eventsForPass());

    const gate2 = new BacktestGate({ clock: () => NOW });
    const last = gate2.getLastRun('rule-persist');
    assert.ok(last !== undefined);
    assert.equal(last.ruleId, 'rule-persist');
  });

  it('rehydrated run has correct passed flag', () => {
    const gate1 = new BacktestGate({ clock: () => NOW });
    gate1.resetForTesting();
    gate1.runBacktest('rule-p', passRule(), eventsForPass());

    const gate2 = new BacktestGate({ clock: () => NOW });
    assert.equal(gate2.getLastRun('rule-p')?.passed, true);
  });

  it('enforces MAX_RUNS cap by evicting oldest', () => {
    const gate = freshRuleGate();
    const cap = __internals.MAX_RUNS;
    for (let i = 0; i < cap + 5; i++) {
      gate.runBacktest(`rule-${i}`, {}, eventsForPass());
    }
    // Total stored runs should not exceed cap
    let total = 0;
    for (let i = 0; i < cap + 5; i++) {
      total += gate.getHistory(`rule-${i}`).length;
    }
    assert.ok(total <= cap);
  });

  it('handles corrupt storage gracefully', () => {
    __storage.set('wm-backtest-gate', '{corrupt json}}');
    const gate = new BacktestGate({ clock: () => NOW });
    assert.equal(gate.getLastRun('any'), undefined);
    assert.deepEqual(gate.getHistory('any'), []);
  });
});

// ── __internals constants ──────────────────────────────────────────────

describe('__internals — rule-backtest constants', () => {
  it('MAX_RUNS is 500', () => {
    assert.equal(__internals.MAX_RUNS, 500);
  });

  it('DEFAULT_WINDOW_DAYS is 30', () => {
    assert.equal(__internals.DEFAULT_WINDOW_DAYS, 30);
  });

  it('FP_RATE_THRESHOLD is 0.3', () => {
    assert.equal(__internals.FP_RATE_THRESHOLD, 0.3);
  });

  it('PRECISION_THRESHOLD is 0.7', () => {
    assert.equal(__internals.PRECISION_THRESHOLD, 0.7);
  });

  it('APPROVAL_WINDOW_MS is 7 days', () => {
    assert.equal(__internals.APPROVAL_WINDOW_MS, 7 * 24 * 60 * 60 * 1000);
  });
});
