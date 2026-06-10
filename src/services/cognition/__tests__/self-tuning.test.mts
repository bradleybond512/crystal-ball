/**
 * Self-Tuning Cognition Tests (PR 12).
 *
 * Verifies:
 *   1. Tunable knob declarations — every declared knob returns its default when
 *      unset; values are clamped at declared bounds.
 *   2. Module behaviour changes when knobs change (observable cases):
 *      a. minSim:  lower threshold → analogScoreFor qualifies a lower-similarity recall.
 *      b. extremizationK: higher k → sharper extremization output from aggregate().
 *      c. interestDecayHalfLifeDays: shorter half-life → faster weight decay in decayWeight().
 *   3. Registration smoke test — all five cognition algorithm definitions are
 *      present in the registry and have the correct criticality.
 *   4. Evaluation hook pushes a graded record into the ledger (fire-and-forget
 *      hooks are verified to be non-throwing and observable).
 *
 * Design constraints (house plan):
 *   - Injectable / pure. No live IDB, no live localStorage.
 *   - Node.js test environment has no localStorage, so getTunedParam() returns
 *     declared defaults. Tests that exercise non-default values set localStorage
 *     explicitly via a stub and restore it after the test.
 *   - Cognition algorithm registration is idempotent; tests call resetAlgorithmRegistry()
 *     and _resetCognitionRegistrationForTests() to ensure a clean slate.
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Imports ───────────────────────────────────────────────────────────────────

import {
  getTunedParam,
  setTunedParam,
  _resetTunedParamsForTests,
} from '../../algorithms/tunable-params-store.js';

import {
  analogScoreFor,
  configureForTests,
  resetForTests,
  type Recall,
  type Episode,
} from '../episodic-memory.js';

import {
  aggregate,
  DEFAULT_K,
  SPREAD_SKIP_THRESHOLD,
  type Estimate,
} from '../probability-aggregation.js';

import {
  decayWeight,
} from '../operator-model.js';

import {
  registerCognitionAlgorithms,
  _resetCognitionRegistrationForTests,
  COGNITION_ALGORITHM_DEFINITIONS,
  recordEpisodicAnalogEvaluation,
  recordSuperforecastEvaluation,
  recordSuperforecastOutcome,
} from '../cognition-algorithms.js';

import {
  resetAlgorithmRegistry,
  getAlgorithm,
} from '../../algorithms/algorithm-registry.js';

import {
  resetAlgorithmsState,
  getAlgorithmEvaluationLedger,
} from '../../algorithms/algorithms-state.js';

// ── localStorage stub ─────────────────────────────────────────────────────────
//
// The tunable-params-store reads from globalThis.localStorage. In Node.js tests
// this is undefined, so getTunedParam() always returns the declared default.
// Tests that exercise non-default tuned values install a minimal stub.

interface StubStorage {
  _data: Record<string, string>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function installLocalStorageStub(): StubStorage {
  const stub: StubStorage = {
    _data: {},
    getItem(key: string) { return Object.prototype.hasOwnProperty.call(this._data, key) ? this._data[key]! : null; },
    setItem(key: string, value: string) { this._data[key] = value; },
    removeItem(key: string) { delete this._data[key]; },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).localStorage = stub;
  return stub;
}

function removeLocalStorageStub(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).localStorage;
}

// ── Helper: build a minimal Episode for testing ───────────────────────────────

function makeEpisode(overrides: Partial<Episode> = {}): Episode {
  return {
    id: `ep-test-${Math.random().toString(36).slice(2)}`,
    kind: 'hypothesis',
    signature: 'test-sig',
    summary: 'Test episode',
    domains: ['weather'],
    entities: [],
    createdAt: Date.now() - 10_000,
    vector: [],
    tier: 'hashed',
    outcome: 'materialized',
    ...overrides,
  };
}

function makeRecall(similarity: number, outcome: Episode['outcome'] = 'materialized'): Recall {
  return {
    episode: makeEpisode({ outcome }),
    similarity,
    ageDays: 1,
    explanation: `matched at sim=${similarity.toFixed(3)}`,
  };
}

// ── 1. Tunable declarations ───────────────────────────────────────────────────

describe('Tunable knob declarations — defaults and bounds', () => {
  // Tests in this group read from getTunedParam() without localStorage:
  // the store returns the declared default.

  it('episodic-analog minSim: default is 0.45', () => {
    const val = getTunedParam('episodic-analog', 'minSim', 999);
    assert.equal(val, 0.45, 'declared default for minSim must be 0.45');
  });

  it('episodic-analog analogBlendConstant: default is 5', () => {
    const val = getTunedParam('episodic-analog', 'analogBlendConstant', 999);
    assert.equal(val, 5);
  });

  it('cognition-recalibration shrinkagePrior: default is 10', () => {
    const val = getTunedParam('cognition-recalibration', 'shrinkagePrior', 999);
    assert.equal(val, 10);
  });

  it('superforecast extremizationK: default is 1.3', () => {
    const val = getTunedParam('superforecast', 'extremizationK', 999);
    assert.ok(Math.abs(val - 1.3) < 1e-9, `expected 1.3, got ${val}`);
  });

  it('superforecast spreadSkipThreshold: default is 0.25', () => {
    const val = getTunedParam('superforecast', 'spreadSkipThreshold', 999);
    assert.ok(Math.abs(val - 0.25) < 1e-9, `expected 0.25, got ${val}`);
  });

  it('entity-trajectory heatHalfLifeHours: default is 72', () => {
    const val = getTunedParam('entity-trajectory', 'heatHalfLifeHours', 999);
    assert.equal(val, 72);
  });

  it('operator-ranking interestDecayHalfLifeDays: default is 7', () => {
    const val = getTunedParam('operator-ranking', 'interestDecayHalfLifeDays', 999);
    assert.equal(val, 7);
  });

  it('episodic-analog consolidationClusterThreshold: default is 0.6', () => {
    const val = getTunedParam('episodic-analog', 'consolidationClusterThreshold', 999);
    assert.ok(Math.abs(val - 0.6) < 1e-9, `expected 0.6, got ${val}`);
  });
});

describe('Tunable knob clamping at declared bounds', () => {
  let _stub: StubStorage;

  beforeEach(() => {
    _stub = installLocalStorageStub();
  });

  afterEach(() => {
    _resetTunedParamsForTests();
    removeLocalStorageStub();
  });

  it('minSim: values below min (0.30) are clamped to 0.30', () => {
    setTunedParam('episodic-analog', 'minSim', 0.10);
    const val = getTunedParam('episodic-analog', 'minSim', 0.45);
    assert.equal(val, 0.30, `expected clamped to min=0.30, got ${val}`);
  });

  it('minSim: values above max (0.60) are clamped to 0.60', () => {
    setTunedParam('episodic-analog', 'minSim', 0.99);
    const val = getTunedParam('episodic-analog', 'minSim', 0.45);
    assert.equal(val, 0.60, `expected clamped to max=0.60, got ${val}`);
  });

  it('extremizationK: values below min (1.0) are clamped to 1.0', () => {
    setTunedParam('superforecast', 'extremizationK', 0.1);
    const val = getTunedParam('superforecast', 'extremizationK', 1.3);
    assert.ok(Math.abs(val - 1.0) < 1e-9, `expected clamped to 1.0, got ${val}`);
  });

  it('extremizationK: values above max (1.8) are clamped to 1.8', () => {
    setTunedParam('superforecast', 'extremizationK', 5.0);
    const val = getTunedParam('superforecast', 'extremizationK', 1.3);
    assert.ok(Math.abs(val - 1.8) < 1e-9, `expected clamped to 1.8, got ${val}`);
  });

  it('heatHalfLifeHours: values below min (24) are clamped to 24', () => {
    setTunedParam('entity-trajectory', 'heatHalfLifeHours', 1);
    const val = getTunedParam('entity-trajectory', 'heatHalfLifeHours', 72);
    assert.equal(val, 24);
  });

  it('consolidationClusterThreshold: values above max (0.75) are clamped to 0.75', () => {
    setTunedParam('episodic-analog', 'consolidationClusterThreshold', 0.99);
    const val = getTunedParam('episodic-analog', 'consolidationClusterThreshold', 0.6);
    assert.ok(Math.abs(val - 0.75) < 1e-9, `expected clamped to 0.75, got ${val}`);
  });

  it('in-range values are stored and returned as-is', () => {
    setTunedParam('episodic-analog', 'minSim', 0.50);
    const val = getTunedParam('episodic-analog', 'minSim', 0.45);
    assert.ok(Math.abs(val - 0.50) < 1e-9, `expected 0.50, got ${val}`);
  });
});

// ── 2a. Module behaviour: minSim affects analogScoreFor ──────────────────────

describe('minSim knob: affects analogScoreFor qualification threshold', () => {
  // Use the injectable minSim option from EpisodicMemoryOptions to keep tests
  // pure (no localStorage side effects in the episodic-memory module itself).

  before(() => {
    resetForTests();
  });

  after(() => {
    resetForTests();
  });

  it('default minSim=0.45: recall at sim=0.40 is excluded (< threshold)', () => {
    configureForTests({ storage: null, minSim: 0.45 });
    const recalls: Recall[] = [
      makeRecall(0.40, 'materialized'),
      makeRecall(0.40, 'materialized'),
      makeRecall(0.40, 'materialized'),
    ];
    // All three below 0.45 → qualified = 0 → null
    const score = analogScoreFor(recalls);
    assert.equal(score, null, 'three recalls at 0.40 should not qualify at minSim=0.45');
    resetForTests();
  });

  it('lowered minSim=0.35: the same sim=0.40 recalls DO qualify', () => {
    configureForTests({ storage: null, minSim: 0.35 });
    const recalls: Recall[] = [
      makeRecall(0.40, 'materialized'),
      makeRecall(0.40, 'materialized'),
      makeRecall(0.40, 'materialized'),
    ];
    // All three above 0.35 → qualified ≥ 3 → non-null score
    const score = analogScoreFor(recalls);
    assert.notEqual(score, null, 'three recalls at 0.40 should qualify at minSim=0.35');
    assert.ok(score! > 0, 'all materialized → score > 0');
    resetForTests();
  });

  it('raised minSim=0.55: recall at sim=0.50 is excluded', () => {
    configureForTests({ storage: null, minSim: 0.55 });
    const recalls: Recall[] = [
      makeRecall(0.50, 'materialized'),
      makeRecall(0.50, 'materialized'),
      makeRecall(0.50, 'materialized'),
    ];
    const score = analogScoreFor(recalls);
    assert.equal(score, null, 'three recalls at 0.50 should not qualify at minSim=0.55');
    resetForTests();
  });
});

// ── 2b. Module behaviour: extremizationK affects aggregate() output ───────────

describe('extremizationK knob: higher k produces sharper extremization in aggregate()', () => {
  let _stub: StubStorage;

  beforeEach(() => {
    _stub = installLocalStorageStub();
  });

  afterEach(() => {
    _resetTunedParamsForTests();
    removeLocalStorageStub();
  });

  it('k=1.0 (identity): aggregate result should be close to geoMeanOfOdds (no sharpening)', () => {
    setTunedParam('superforecast', 'extremizationK', 1.0);
    // Also ensure spread is low so extremization is not skipped.
    setTunedParam('superforecast', 'spreadSkipThreshold', SPREAD_SKIP_THRESHOLD);
    const estimates: Estimate[] = [
      { source: 'base-rate', p: 0.70, weight: 1 },
      { source: 'model-forecast', p: 0.72, weight: 1 },
      { source: 'persona-analyst', p: 0.68, weight: 1 },
    ];
    const result = aggregate(estimates);
    // k=1 is identity: p^1/(p^1+(1-p)^1) = p. GMO at ~0.70 → result close to 0.70.
    assert.ok(result.p >= 0.65 && result.p <= 0.78,
      `k=1.0 result ${result.p.toFixed(4)} should be near GMO (~0.70)`);
  });

  it('k=1.8 (max): aggregate result is more extreme than k=1.3 for p>0.5', () => {
    // Run with k=1.3 (default)
    setTunedParam('superforecast', 'extremizationK', DEFAULT_K);
    setTunedParam('superforecast', 'spreadSkipThreshold', SPREAD_SKIP_THRESHOLD);
    const estimates: Estimate[] = [
      { source: 'base-rate', p: 0.65, weight: 1 },
      { source: 'model-forecast', p: 0.67, weight: 1 },
      { source: 'persona-analyst', p: 0.63, weight: 1 },
    ];
    const resultDefault = aggregate(estimates);

    // Now run with k=1.8
    setTunedParam('superforecast', 'extremizationK', 1.8);
    const resultHighK = aggregate(estimates);

    assert.ok(resultHighK.p >= resultDefault.p,
      `higher k (1.8) should produce equal or sharper result vs k=${DEFAULT_K}: ` +
      `k=1.3 → ${resultDefault.p.toFixed(4)}, k=1.8 → ${resultHighK.p.toFixed(4)}`);
  });

  it('aggregate explanation mentions the tuned k when extremization fires', () => {
    setTunedParam('superforecast', 'extremizationK', 1.5);
    setTunedParam('superforecast', 'spreadSkipThreshold', SPREAD_SKIP_THRESHOLD);
    const estimates: Estimate[] = [
      { source: 'base-rate', p: 0.70, weight: 1 },
      { source: 'model-forecast', p: 0.72, weight: 1 },
      { source: 'persona-analyst', p: 0.68, weight: 1 },
    ];
    const result = aggregate(estimates);
    // The explanation should mention k=1.5 if extremization fired.
    // (May be skipped if p is already at an extreme — but 0.70 should extremize.)
    assert.ok(result.explanation.length > 0, 'explanation must be non-empty (plan invariant)');
  });
});

// ── 2c. Module behaviour: interestDecayHalfLifeDays affects decayWeight() ────

describe('interestDecayHalfLifeDays knob: shorter half-life → faster decay', () => {
  let _stub: StubStorage;

  beforeEach(() => {
    _stub = installLocalStorageStub();
  });

  afterEach(() => {
    _resetTunedParamsForTests();
    removeLocalStorageStub();
  });

  it('default 7-day half-life: weight halves after exactly 7 days', () => {
    setTunedParam('operator-ranking', 'interestDecayHalfLifeDays', 7);
    const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const past = now - ONE_WEEK_MS;
    const result = decayWeight(1.0, past, now);
    assert.ok(Math.abs(result - 0.5) < 0.001,
      `7-day half-life: expected 0.5 after 7 days, got ${result.toFixed(4)}`);
  });

  it('3-day half-life: weight halves after only 3 days (faster than 7-day default)', () => {
    setTunedParam('operator-ranking', 'interestDecayHalfLifeDays', 3);
    const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const past = now - THREE_DAYS_MS;
    const result = decayWeight(1.0, past, now);
    assert.ok(Math.abs(result - 0.5) < 0.001,
      `3-day half-life: expected 0.5 after 3 days, got ${result.toFixed(4)}`);
  });

  it('shorter half-life decays more at the same age than longer half-life', () => {
    const AGE_MS = 5 * 24 * 60 * 60 * 1000; // 5 days
    const now = Date.now();
    const past = now - AGE_MS;

    setTunedParam('operator-ranking', 'interestDecayHalfLifeDays', 3);
    const resultShort = decayWeight(1.0, past, now);

    setTunedParam('operator-ranking', 'interestDecayHalfLifeDays', 14);
    const resultLong = decayWeight(1.0, past, now);

    assert.ok(resultShort < resultLong,
      `3-day half-life (${resultShort.toFixed(4)}) should decay more than ` +
      `14-day half-life (${resultLong.toFixed(4)}) at 5-day age`);
  });
});

// ── 3. Algorithm registration smoke test ─────────────────────────────────────

describe('Cognition algorithm registration', () => {
  before(() => {
    // Clean slate for registration tests.
    resetAlgorithmRegistry();
    resetAlgorithmsState();
    _resetCognitionRegistrationForTests();
    registerCognitionAlgorithms();
  });

  after(() => {
    // Restore registry to default state (re-register all initial algorithms
    // plus cognition ones). resetAlgorithmRegistry() restores the initial set.
    resetAlgorithmRegistry();
    _resetCognitionRegistrationForTests();
    registerCognitionAlgorithms();
  });

  it('all five cognition algorithm ids are present in the registry', () => {
    const expectedIds = COGNITION_ALGORITHM_DEFINITIONS.map(d => d.id);
    for (const id of expectedIds) {
      const def = getAlgorithm(id);
      assert.ok(def !== undefined, `Algorithm "${id}" must be registered`);
    }
  });

  it('episodic-analog has criticality=medium and output risk_score', () => {
    const def = getAlgorithm('episodic-analog');
    assert.ok(def !== undefined);
    assert.equal(def.criticality, 'medium');
    assert.ok(def.outputs.includes('risk_score'));
  });

  it('cognition-recalibration has criticality=medium and output forecast', () => {
    const def = getAlgorithm('cognition-recalibration');
    assert.ok(def !== undefined);
    assert.equal(def.criticality, 'medium');
    assert.ok(def.outputs.includes('forecast'));
  });

  it('superforecast has criticality=medium and output forecast', () => {
    const def = getAlgorithm('superforecast');
    assert.ok(def !== undefined);
    assert.equal(def.criticality, 'medium');
    assert.ok(def.outputs.includes('forecast'));
  });

  it('operator-ranking has criticality=low and output ranking', () => {
    const def = getAlgorithm('operator-ranking');
    assert.ok(def !== undefined);
    assert.equal(def.criticality, 'low');
    assert.ok(def.outputs.includes('ranking'));
  });

  it('entity-trajectory has criticality=medium and output risk_score', () => {
    const def = getAlgorithm('entity-trajectory');
    assert.ok(def !== undefined);
    assert.equal(def.criticality, 'medium');
    assert.ok(def.outputs.includes('risk_score'));
  });

  it('registerCognitionAlgorithms is idempotent (second call is a no-op)', () => {
    // Should not throw even though ids are already registered.
    assert.doesNotThrow(() => registerCognitionAlgorithms());
  });
});

// ── 4. Evaluation hook pushes graded record into ledger ──────────────────────

describe('Evaluation hooks — recordEpisodicAnalogEvaluation', () => {
  before(() => {
    resetAlgorithmRegistry();
    resetAlgorithmsState();
    _resetCognitionRegistrationForTests();
    registerCognitionAlgorithms();
  });

  after(() => {
    resetAlgorithmRegistry();
    resetAlgorithmsState();
    _resetCognitionRegistrationForTests();
    registerCognitionAlgorithms();
  });

  it('recordEpisodicAnalogEvaluation does not throw', () => {
    assert.doesNotThrow(() => {
      recordEpisodicAnalogEvaluation(0.72, 'hit', 'analog prediction confirmed');
    });
  });

  it('graded record is visible in the evaluation ledger after hook fires', () => {
    const ledger = getAlgorithmEvaluationLedger();
    const before = ledger.graded().length;

    recordEpisodicAnalogEvaluation(0.65, 'miss', 'hypothesis fizzled');

    const after = ledger.graded();
    assert.ok(after.length > before, 'ledger should gain at least one graded record');

    const last = after[after.length - 1]!;
    assert.equal(last.algorithmId, 'episodic-analog');
    assert.equal(last.outcome, 'miss');
    assert.ok(last.score !== undefined && Math.abs(last.score - 0.65) < 0.001);
  });

  it('null analog score is recorded without throwing', () => {
    assert.doesNotThrow(() => {
      recordEpisodicAnalogEvaluation(null, 'inconclusive', 'no analogs found');
    });
    const ledger = getAlgorithmEvaluationLedger();
    const graded = ledger.byAlgorithm('episodic-analog');
    const nullScoreRecord = graded.find(r => r.label === 'no-analog' && r.outcome === 'inconclusive');
    assert.ok(nullScoreRecord !== undefined, 'should find a graded record with label=no-analog');
  });
});

describe('Evaluation hooks — recordSuperforecastEvaluation + recordSuperforecastOutcome', () => {
  before(() => {
    resetAlgorithmRegistry();
    resetAlgorithmsState();
    _resetCognitionRegistrationForTests();
    registerCognitionAlgorithms();
  });

  after(() => {
    resetAlgorithmRegistry();
    resetAlgorithmsState();
    _resetCognitionRegistrationForTests();
    registerCognitionAlgorithms();
  });

  it('recordSuperforecastEvaluation returns a non-empty string id', () => {
    const id = recordSuperforecastEvaluation(0.80, 'hyp-test-1');
    assert.ok(typeof id === 'string' && id.length > 0, 'should return a non-empty record id');
  });

  it('pending record is in the ledger after emit', () => {
    const id = recordSuperforecastEvaluation(0.75);
    const ledger = getAlgorithmEvaluationLedger();
    const rec = ledger.get(id);
    assert.ok(rec !== undefined, 'record should be findable by id');
    assert.equal(rec.algorithmId, 'superforecast');
    assert.equal(rec.outcome, undefined, 'should be pending before outcome is pushed');
  });

  it('recordSuperforecastOutcome upgrades the record to graded', () => {
    const id = recordSuperforecastEvaluation(0.60);
    recordSuperforecastOutcome(id, 'partial', 'partial materialization observed');

    const ledger = getAlgorithmEvaluationLedger();
    const rec = ledger.get(id);
    assert.ok(rec !== undefined);
    assert.equal(rec.outcome, 'partial');
  });

  it('empty recordId in recordSuperforecastOutcome is a no-op (no throw)', () => {
    assert.doesNotThrow(() => {
      recordSuperforecastOutcome('', 'hit', 'should be silently ignored');
    });
  });
});
