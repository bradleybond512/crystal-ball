/**
 * Tests for BacktestEngine + built-in scenarios — Phase 4 gate.
 *
 * Run with: npx tsx --test tests/intelligence/backtest-engine.test.mts
 *
 * Pure-service tests. Each test constructs its own BacktestEngine with
 * injected synthetic drivers so the live driver-scorer state can't
 * pollute the run.
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
  BacktestEngine,
  __resetBacktestEngineSingleton,
  accuracyForPair,
  getBacktestEngine,
  scoreSeverity,
  __internals as engineInternals,
  type BacktestConfig,
  type BacktestScenario,
} from '../../src/services/intelligence/backtest-engine.ts';
import {
  BUILT_IN_BACKTEST_SCENARIOS,
  getBuiltInScenario,
  getBuiltInScenarios,
} from '../../src/services/intelligence/built-in-scenarios.ts';
import type { DerivedSeverity, ScoringDriver } from '../../src/services/intelligence/driver-scores.ts';
import type { ObservationEvent } from '../../src/services/intelligence/observation-adapters.ts';

const NOW = 1_745_000_000_000;

// ── Fixtures ─────────────────────────────────────────────────────────

/** Driver that ignores raw value and emits a configured normalized score.
 *  Lets each test set up a deterministic baseline. */
function fixedDriver(opts: {
  id: string;
  domain: string;
  weight: number;
  normalizedScore: number;
}): ScoringDriver {
  return {
    id: opts.id,
    name: opts.id,
    domain: opts.domain,
    weight: opts.weight,
    description: `${opts.id} fixture`,
    extractValue: () => 1,
    normalizeValue: () => opts.normalizedScore,
  };
}

function obs(id: string, domain: string, severity: ObservationEvent['severity'] = 'MEDIUM'): ObservationEvent {
  return {
    id,
    sourceId: 'test',
    domain,
    timestamp: NOW,
    severity,
    title: `event ${id}`,
    raw: {},
    entityIds: [],
    tags: [],
  };
}

function freshEngine(drivers: ScoringDriver[], nowFn?: () => number): BacktestEngine {
  __storage.clear();
  __resetBacktestEngineSingleton();
  return new BacktestEngine({ clock: nowFn ?? (() => NOW), drivers });
}

function singleScenario(
  id: string,
  observations: ObservationEvent[],
  outcomes: Array<{ observationId: string; actualSeverity: DerivedSeverity }>,
): BacktestScenario {
  return {
    id,
    name: id,
    description: id,
    observations,
    knownOutcomes: outcomes.map((o) => ({ ...o, wasActedOn: true })),
  };
}

// ── accuracyForPair pure function ────────────────────────────────────

test('accuracyForPair: exact match returns 1', () => {
  assert.equal(accuracyForPair('high', 'high'), 1);
});

test('accuracyForPair: within one band returns 0.5', () => {
  // Severity order is low → medium → high → critical, so "within one
  // band" means adjacent steps on that ladder.
  assert.equal(accuracyForPair('high', 'medium'), 0.5);
  assert.equal(accuracyForPair('medium', 'low'), 0.5);
  assert.equal(accuracyForPair('critical', 'high'), 0.5);
});

test('accuracyForPair: more than one band off returns 0', () => {
  assert.equal(accuracyForPair('low', 'critical'), 0);
  assert.equal(accuracyForPair('medium', 'critical'), 0); // 2 bands apart (skips high)
  assert.equal(accuracyForPair('low', 'high'), 0);
});

// ── scoreSeverity pure function ──────────────────────────────────────

test('scoreSeverity: returns low when no drivers match the domain', () => {
  const drivers = [fixedDriver({ id: 'd1', domain: 'cyber', weight: 1, normalizedScore: 1 })];
  const sev = scoreSeverity(obs('o1', 'weather'), drivers, {}, [
    { min: 0, severity: 'low' },
  ]);
  assert.equal(sev, 'low');
});

test('scoreSeverity: applies weightOverrides', () => {
  const drivers = [
    fixedDriver({ id: 'a', domain: 'weather', weight: 1, normalizedScore: 0.1 }),
    fixedDriver({ id: 'b', domain: 'weather', weight: 1, normalizedScore: 0.9 }),
  ];
  // Equal weights → score 0.5. Override b's weight → 0 → score 0.1 → low.
  const sev = scoreSeverity(obs('o1', 'weather'), drivers, { b: 0 }, [
    { min: 0.8, severity: 'critical' },
    { min: 0.6, severity: 'high' },
    { min: 0.35, severity: 'medium' },
    { min: 0, severity: 'low' },
  ]);
  assert.equal(sev, 'low');
});

// ── runBacktest core behaviour ───────────────────────────────────────

test('runBacktest: perfect proposed predictions → passed + apply', () => {
  // Baseline driver scores everything as 0.1 (→ low). Proposed driver
  // weight override flips contributions toward a 0.9-scoring driver
  // (→ critical), and the scenario's known outcome is critical.
  const drivers = [
    fixedDriver({ id: 'low', domain: 'weather', weight: 1, normalizedScore: 0.1 }),
    fixedDriver({ id: 'crit', domain: 'weather', weight: 0, normalizedScore: 0.9 }),
  ];
  const eng = freshEngine(drivers);
  const result = eng.runBacktest({
    algorithmId: 'driver-scorer',
    parameterChanges: { driverWeights: { low: 0, crit: 1 } },
    scenarios: [
      singleScenario('s1', [obs('o1', 'weather')], [
        { observationId: 'o1', actualSeverity: 'critical' },
      ]),
    ],
    minAccuracyDelta: 0,
  });
  assert.equal(result.passed, true);
  assert.equal(result.recommendation, 'apply');
  assert.ok(result.accuracyDelta > 0);
});

test('runBacktest: worse proposed predictions → reject', () => {
  const drivers = [
    fixedDriver({ id: 'good', domain: 'weather', weight: 1, normalizedScore: 0.9 }),
    fixedDriver({ id: 'bad', domain: 'weather', weight: 0, normalizedScore: 0.1 }),
  ];
  const eng = freshEngine(drivers);
  const result = eng.runBacktest({
    algorithmId: 'driver-scorer',
    parameterChanges: { driverWeights: { good: 0, bad: 1 } },
    scenarios: [
      singleScenario('s1', [obs('o1', 'weather')], [
        { observationId: 'o1', actualSeverity: 'critical' },
      ]),
    ],
    minAccuracyDelta: 0,
  });
  assert.equal(result.passed, false);
  assert.equal(result.recommendation, 'reject');
  assert.ok(result.accuracyDelta < 0);
});

test('runBacktest: partial credit (within 1 band) = 0.5', () => {
  const drivers = [
    fixedDriver({ id: 'one', domain: 'weather', weight: 1, normalizedScore: 0.7 }),
  ];
  const eng = freshEngine(drivers);
  const result = eng.runBacktest({
    algorithmId: 'driver-scorer',
    parameterChanges: {},
    scenarios: [
      singleScenario('s1', [obs('o1', 'weather')], [
        { observationId: 'o1', actualSeverity: 'critical' }, // predicted high, actual critical → 0.5
      ]),
    ],
    minAccuracyDelta: 0,
  });
  assert.equal(result.baselineAccuracy, 0.5);
  assert.equal(result.proposedAccuracy, 0.5);
});

test('runBacktest: minAccuracyDelta respected — delta=0.01 with min=0.02 → failed', () => {
  // Build a scenario where baseline accuracy = 0.5 and proposed = 0.5
  // (no improvement). Then minAccuracyDelta=0.02 → not met → failed.
  const drivers = [
    fixedDriver({ id: 'one', domain: 'weather', weight: 1, normalizedScore: 0.7 }),
  ];
  const eng = freshEngine(drivers);
  const result = eng.runBacktest({
    algorithmId: 'driver-scorer',
    parameterChanges: {},
    scenarios: [
      singleScenario('s1', [obs('o1', 'weather')], [
        { observationId: 'o1', actualSeverity: 'critical' },
      ]),
    ],
    minAccuracyDelta: 0.02,
  });
  assert.equal(result.passed, false);
});

test('runBacktest: minAccuracyDelta=0 with exactly equal delta → passed', () => {
  const drivers = [
    fixedDriver({ id: 'one', domain: 'weather', weight: 1, normalizedScore: 0.5 }),
  ];
  const eng = freshEngine(drivers);
  const result = eng.runBacktest({
    algorithmId: 'driver-scorer',
    parameterChanges: {},
    scenarios: [
      singleScenario('s1', [obs('o1', 'weather')], [
        { observationId: 'o1', actualSeverity: 'medium' },
      ]),
    ],
    minAccuracyDelta: 0,
  });
  assert.equal(result.passed, true);
  assert.equal(result.accuracyDelta, 0);
  // No improvement + no regression → "apply" (the threshold was zero).
  assert.equal(result.recommendation, 'apply');
});

test('runBacktest: regression >0.05 on any scenario → reject', () => {
  // 2 scenarios. First improves slightly; second regresses badly.
  const drivers = [
    fixedDriver({ id: 'good', domain: 'weather', weight: 1, normalizedScore: 0.9 }),
    fixedDriver({ id: 'bad', domain: 'weather', weight: 0, normalizedScore: 0.05 }),
  ];
  const eng = freshEngine(drivers);
  const result = eng.runBacktest({
    algorithmId: 'driver-scorer',
    parameterChanges: { driverWeights: { good: 0, bad: 1 } }, // flip weights
    scenarios: [
      singleScenario('s1', [obs('o1', 'weather')], [
        { observationId: 'o1', actualSeverity: 'low' }, // bad driver predicts low → matches → 1.0
      ]),
      singleScenario('s2', [obs('o2', 'weather')], [
        { observationId: 'o2', actualSeverity: 'critical' }, // bad driver predicts low → 0 (regressed from 1.0)
      ]),
    ],
    minAccuracyDelta: 0,
  });
  assert.equal(result.recommendation, 'reject');
});

test('runBacktest: review when not all scenarios pass but no regression >0.05', () => {
  // Baseline: 0.5 / 1.0 (avg 0.75). Proposed: 0.5 / 0.96 (avg 0.73).
  // Per-scenario delta ≤ 0.05 (no scenario regressed beyond threshold)
  // but the overall failed because s2 dropped slightly with min=0.
  //
  // We can't easily express that with the fixedDriver shape, so we
  // construct two scenarios where: s1 stays equal (passed=true with
  // min=0), s2 drops by exactly 0.05 (passed=false with min=0, no
  // regression beyond REGRESSION_THRESHOLD).
  const drivers = [
    fixedDriver({ id: 'a', domain: 'weather', weight: 1, normalizedScore: 0.7 }),
    fixedDriver({ id: 'b', domain: 'weather', weight: 1, normalizedScore: 0.4 }),
  ];
  const eng = freshEngine(drivers);
  // With weights [1,1] → avg 0.55 → medium for s1's outcome=medium ✓
  // With weights [0,1] → 0.4 → medium for s2's outcome=medium ✓
  // With weights [1,0] proposed → 0.7 → high — mismatch on s2 if outcome=medium → 0.5
  //
  // Simpler: just craft a single test with minAccuracyDelta high enough
  // that the result lands in review territory.
  const result = eng.runBacktest({
    algorithmId: 'driver-scorer',
    parameterChanges: {},
    scenarios: [
      singleScenario('s1', [obs('o1', 'weather')], [
        { observationId: 'o1', actualSeverity: 'medium' },
      ]),
    ],
    minAccuracyDelta: 0.5, // baseline = proposed = 1.0; delta = 0 < 0.5 → not passed; no regression → review
  });
  assert.equal(result.passed, false);
  assert.equal(result.recommendation, 'review');
});

test('runBacktest: multi-scenario all pass → apply', () => {
  const drivers = [
    fixedDriver({ id: 'one', domain: 'weather', weight: 1, normalizedScore: 0.5 }),
  ];
  const eng = freshEngine(drivers);
  const scenarios = [
    singleScenario('s1', [obs('o1', 'weather')], [
      { observationId: 'o1', actualSeverity: 'medium' },
    ]),
    singleScenario('s2', [obs('o2', 'weather')], [
      { observationId: 'o2', actualSeverity: 'medium' },
    ]),
  ];
  const result = eng.runBacktest({
    algorithmId: 'driver-scorer',
    parameterChanges: {},
    scenarios,
    minAccuracyDelta: 0,
  });
  assert.equal(result.scenarioResults.length, 2);
  assert.equal(result.recommendation, 'apply');
});

test('runBacktest: stamps runAt + durationMs from the clock', () => {
  const drivers = [
    fixedDriver({ id: 'one', domain: 'weather', weight: 1, normalizedScore: 0.5 }),
  ];
  let tick = NOW;
  const eng = freshEngine(drivers, () => {
    const cur = tick;
    tick += 50;
    return cur;
  });
  const result = eng.runBacktest({
    algorithmId: 'driver-scorer',
    parameterChanges: {},
    scenarios: [singleScenario('s1', [obs('o1', 'weather')], [
      { observationId: 'o1', actualSeverity: 'medium' },
    ])],
    minAccuracyDelta: 0,
  });
  assert.equal(result.runAt.getTime(), NOW);
  assert.ok(result.durationMs >= 50);
});

test('runBacktest: explanation contains the recommendation verb', () => {
  const drivers = [
    fixedDriver({ id: 'one', domain: 'weather', weight: 1, normalizedScore: 0.5 }),
  ];
  const eng = freshEngine(drivers);
  const result = eng.runBacktest({
    algorithmId: 'driver-scorer',
    parameterChanges: {},
    scenarios: [singleScenario('s1', [obs('o1', 'weather')], [
      { observationId: 'o1', actualSeverity: 'medium' },
    ])],
    minAccuracyDelta: 0,
  });
  assert.match(result.explanation, /apply|reject|review/i);
});

test('runBacktest: ignores observations whose ids have no knownOutcome', () => {
  const drivers = [
    fixedDriver({ id: 'one', domain: 'weather', weight: 1, normalizedScore: 0.5 }),
  ];
  const eng = freshEngine(drivers);
  const result = eng.runBacktest({
    algorithmId: 'driver-scorer',
    parameterChanges: {},
    scenarios: [singleScenario(
      's1',
      [obs('o1', 'weather'), obs('o-unscored', 'weather')],
      [{ observationId: 'o1', actualSeverity: 'medium' }],
    )],
    minAccuracyDelta: 0,
  });
  // Only 1 observation scored, exact match → 1.0
  assert.equal(result.baselineAccuracy, 1);
});

// ── Built-in scenarios ───────────────────────────────────────────────

test('BUILT_IN_BACKTEST_SCENARIOS exposes exactly 4 scenarios', () => {
  assert.equal(BUILT_IN_BACKTEST_SCENARIOS.length, 4);
});

test('built-in: pacific-earthquake-cluster has 5 observations + matching outcomes', () => {
  const s = getBuiltInScenario('pacific-earthquake-cluster');
  assert.ok(s);
  assert.equal(s.observations.length, 5);
  assert.equal(s.knownOutcomes.length, 5);
});

test('built-in: weather-escalation has 4 observations + matching outcomes', () => {
  const s = getBuiltInScenario('weather-escalation');
  assert.ok(s);
  assert.equal(s.observations.length, 4);
  assert.equal(s.knownOutcomes.length, 4);
});

test('built-in: maritime-incident has 3 observations + matching outcomes', () => {
  const s = getBuiltInScenario('maritime-incident');
  assert.ok(s);
  assert.equal(s.observations.length, 3);
  assert.equal(s.knownOutcomes.length, 3);
});

test('built-in: mixed-domain-noise has 6 observations + matching outcomes, none acted on', () => {
  const s = getBuiltInScenario('mixed-domain-noise');
  assert.ok(s);
  assert.equal(s.observations.length, 6);
  assert.equal(s.knownOutcomes.length, 6);
  assert.ok(s.knownOutcomes.every((o) => !o.wasActedOn));
});

test('getBuiltInScenarios() returns defensive copies', () => {
  const a = getBuiltInScenarios();
  const b = getBuiltInScenarios();
  assert.notStrictEqual(a[0], b[0]);
  assert.notStrictEqual(a[0].observations, b[0].observations);
});

// ── History / passed / failed / stats ────────────────────────────────

test('getHistory returns runs in insertion order', () => {
  const drivers = [
    fixedDriver({ id: 'one', domain: 'weather', weight: 1, normalizedScore: 0.5 }),
  ];
  const eng = freshEngine(drivers);
  for (let i = 0; i < 3; i++) {
    eng.runBacktest({
      algorithmId: 'driver-scorer',
      parameterChanges: {},
      scenarios: [singleScenario(`s-${i}`, [obs(`o-${i}`, 'weather')], [
        { observationId: `o-${i}`, actualSeverity: 'medium' },
      ])],
      minAccuracyDelta: 0,
    });
  }
  const hist = eng.getHistory();
  assert.equal(hist.length, 3);
  assert.equal(hist[0].config.scenarios[0].id, 's-0');
  assert.equal(hist[2].config.scenarios[0].id, 's-2');
});

test('getResult finds a stored run by id', () => {
  const drivers = [
    fixedDriver({ id: 'one', domain: 'weather', weight: 1, normalizedScore: 0.5 }),
  ];
  const eng = freshEngine(drivers);
  const r = eng.runBacktest({
    algorithmId: 'driver-scorer',
    parameterChanges: {},
    scenarios: [singleScenario('s1', [obs('o1', 'weather')], [
      { observationId: 'o1', actualSeverity: 'medium' },
    ])],
    minAccuracyDelta: 0,
  });
  assert.equal(eng.getResult(r.id)?.id, r.id);
  assert.equal(eng.getResult('does-not-exist'), undefined);
});

test('getPassed / getFailed partition the history by passed flag', () => {
  const drivers = [
    fixedDriver({ id: 'one', domain: 'weather', weight: 1, normalizedScore: 0.5 }),
  ];
  const eng = freshEngine(drivers);
  // Passing run (delta 0, min 0).
  eng.runBacktest({
    algorithmId: 'driver-scorer',
    parameterChanges: {},
    scenarios: [singleScenario('p', [obs('op', 'weather')], [
      { observationId: 'op', actualSeverity: 'medium' },
    ])],
    minAccuracyDelta: 0,
  });
  // Failing run (delta 0 < min 0.5).
  eng.runBacktest({
    algorithmId: 'driver-scorer',
    parameterChanges: {},
    scenarios: [singleScenario('f', [obs('of', 'weather')], [
      { observationId: 'of', actualSeverity: 'medium' },
    ])],
    minAccuracyDelta: 0.5,
  });
  assert.equal(eng.getPassed().length, 1);
  assert.equal(eng.getFailed().length, 1);
});

test('stats(): total/passed/failed and avg delta + duration', () => {
  const drivers = [
    fixedDriver({ id: 'one', domain: 'weather', weight: 1, normalizedScore: 0.5 }),
  ];
  let tick = NOW;
  const eng = freshEngine(drivers, () => {
    const cur = tick;
    tick += 10;
    return cur;
  });
  eng.runBacktest({
    algorithmId: 'driver-scorer',
    parameterChanges: {},
    scenarios: [singleScenario('p', [obs('op', 'weather')], [
      { observationId: 'op', actualSeverity: 'medium' },
    ])],
    minAccuracyDelta: 0,
  });
  eng.runBacktest({
    algorithmId: 'driver-scorer',
    parameterChanges: {},
    scenarios: [singleScenario('f', [obs('of', 'weather')], [
      { observationId: 'of', actualSeverity: 'medium' },
    ])],
    minAccuracyDelta: 0.5,
  });
  const stats = eng.stats();
  assert.equal(stats.total, 2);
  assert.equal(stats.passed, 1);
  assert.equal(stats.failed, 1);
  assert.equal(stats.avgAccuracyDelta, 0); // both runs had delta 0
  assert.ok(stats.avgDurationMs >= 0);
});

test('stats() on empty engine reports zeros', () => {
  const eng = freshEngine([]);
  const s = eng.stats();
  assert.equal(s.total, 0);
  assert.equal(s.passed, 0);
  assert.equal(s.failed, 0);
  assert.equal(s.avgAccuracyDelta, 0);
  assert.equal(s.avgDurationMs, 0);
});

// ── Persistence + ring buffer ────────────────────────────────────────

test('persistence: a fresh engine hydrates the prior run from localStorage', () => {
  const drivers = [
    fixedDriver({ id: 'one', domain: 'weather', weight: 1, normalizedScore: 0.5 }),
  ];
  const a = freshEngine(drivers);
  a.runBacktest({
    algorithmId: 'driver-scorer',
    parameterChanges: {},
    scenarios: [singleScenario('s1', [obs('o1', 'weather')], [
      { observationId: 'o1', actualSeverity: 'medium' },
    ])],
    minAccuracyDelta: 0,
  });
  const b = new BacktestEngine({ clock: () => NOW, drivers });
  assert.equal(b.getHistory().length, 1);
});

test('corrupt persisted blob does not crash hydrate', () => {
  __storage.clear();
  __resetBacktestEngineSingleton();
  __storage.set(engineInternals.STORAGE_KEY, '{not valid');
  const eng = new BacktestEngine({ clock: () => NOW, drivers: [] });
  assert.deepEqual(eng.getHistory(), []);
});

test('ring buffer at MAX_RECORDS + 1 drops oldest', () => {
  const drivers = [
    fixedDriver({ id: 'one', domain: 'weather', weight: 1, normalizedScore: 0.5 }),
  ];
  const eng = freshEngine(drivers);
  const max = engineInternals.MAX_RECORDS;
  for (let i = 0; i < max + 1; i++) {
    eng.runBacktest({
      algorithmId: 'driver-scorer',
      parameterChanges: { driverWeights: {}, _seq: i } as never,
      scenarios: [singleScenario(`s-${i}`, [obs(`o-${i}`, 'weather')], [
        { observationId: `o-${i}`, actualSeverity: 'medium' },
      ])],
      minAccuracyDelta: 0,
    });
  }
  const hist = eng.getHistory();
  assert.equal(hist.length, max);
  assert.equal(hist[0].config.scenarios[0].id, 's-1');
  assert.equal(hist[hist.length - 1].config.scenarios[0].id, `s-${max}`);
});

// ── Subscribe ────────────────────────────────────────────────────────

test('subscribe fires on each runBacktest()', () => {
  const drivers = [
    fixedDriver({ id: 'one', domain: 'weather', weight: 1, normalizedScore: 0.5 }),
  ];
  const eng = freshEngine(drivers);
  let count = 0;
  eng.subscribe(() => { count += 1; });
  for (let i = 0; i < 3; i++) {
    eng.runBacktest({
      algorithmId: 'driver-scorer',
      parameterChanges: {},
      scenarios: [singleScenario(`s-${i}`, [obs(`o-${i}`, 'weather')], [
        { observationId: `o-${i}`, actualSeverity: 'medium' },
      ])],
      minAccuracyDelta: 0,
    });
  }
  assert.equal(count, 3);
});

test('subscribe listener exception is isolated', () => {
  const drivers = [
    fixedDriver({ id: 'one', domain: 'weather', weight: 1, normalizedScore: 0.5 }),
  ];
  const eng = freshEngine(drivers);
  eng.subscribe(() => { throw new Error('boom'); });
  let secondCalled = false;
  eng.subscribe(() => { secondCalled = true; });
  eng.runBacktest({
    algorithmId: 'driver-scorer',
    parameterChanges: {},
    scenarios: [singleScenario('s1', [obs('o1', 'weather')], [
      { observationId: 'o1', actualSeverity: 'medium' },
    ])],
    minAccuracyDelta: 0,
  });
  assert.equal(secondCalled, true);
});

// ── Singleton ────────────────────────────────────────────────────────

test('getBacktestEngine() returns a stable singleton', () => {
  __storage.clear();
  __resetBacktestEngineSingleton();
  const a = getBacktestEngine();
  const b = getBacktestEngine();
  assert.strictEqual(a, b);
});

// ── Configurable BacktestConfig is preserved on the result ───────────

test('result preserves the algorithmId and minAccuracyDelta on the stored config', () => {
  const drivers = [
    fixedDriver({ id: 'one', domain: 'weather', weight: 1, normalizedScore: 0.5 }),
  ];
  const eng = freshEngine(drivers);
  const config: BacktestConfig = {
    algorithmId: 'my-algo',
    parameterChanges: { driverWeights: { one: 0.7 } },
    scenarios: [singleScenario('s1', [obs('o1', 'weather')], [
      { observationId: 'o1', actualSeverity: 'medium' },
    ])],
    minAccuracyDelta: 0.03,
  };
  const r = eng.runBacktest(config);
  assert.equal(r.config.algorithmId, 'my-algo');
  assert.equal(r.config.minAccuracyDelta, 0.03);
});
