/**
 * Tests for src/services/cognition/shadow-rollout.ts — PR 13 (Shadow Rollout Discipline)
 *
 * Coverage (plan-mandated):
 *   1. Orientation correctness — live vs shadow fields for all three runs.
 *   2. Flip gate math — 200-pair threshold, Brier comparison.
 *   3. Insufficient-data path — fewer than 200 pairs, no resolved outcomes.
 *   4. Verdict snapshot persistence — storage key written.
 *   5. Schema-pair orientation — matchCount objects, always 'insufficient-data' for Brier.
 *   6. pushRecalibrationPair, pushSuperforecastPair, pushSchemaPair are fire-and-forget
 *      (no throw on service absence).
 *   7. initShadowRollout is idempotent (second call no-ops).
 *
 * Design: injectable ShadowModeAlgorithmService + ForecastCalibrationStore.
 * No DOM, no real IDB, no real localStorage.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  ShadowModeAlgorithmService,
} from '../../intelligence/shadow-mode.js';

import {
  initShadowRollout,
  pushRecalibrationPair,
  pushSuperforecastPair,
  pushSchemaPair,
  shadowVerdict,
  persistVerdictSnapshot,
  resetShadowRolloutForTests,
  configureShadowRolloutForTests,
  FLIP_GATE_MIN_PAIRS,
  VERDICT_STORAGE_KEY,
  RUN_IDS,
} from '../shadow-rollout.js';
import type { FlipRecommendation, StorageLike } from '../shadow-rollout.js';

// ── Minimal in-memory storage ──────────────────────────────────────────────────

function makeStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
  };
}

// ── Minimal calibration store stub ────────────────────────────────────────────

function makeCalibrationStore(records: Array<{
  id: string;
  probability: number;
  status: 'resolved_true' | 'resolved_false' | 'pending' | 'expired';
  predictedAt: number;
  resolvedAt?: number;
}>) {
  return {
    all: () => records.map(r => ({
      id: r.id,
      sourceId: 'test',
      domain: 'other' as const,
      claim: 'test claim',
      probability: r.probability,
      predictedAt: r.predictedAt,
      resolveBy: r.predictedAt + 86_400_000,
      status: r.status,
      resolvedAt: r.resolvedAt,
      algorithmVersion: 'test-v1',
    })),
    record: () => {},
    resolve: () => false,
    expirePending: () => 0,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Push N identical comparison pairs into the given run. */
function pushNPairs(
  svc: ShadowModeAlgorithmService,
  runId: string,
  n: number,
  liveP = 0.6,
  shadowP = 0.55,
  tBase = 1_000_000,
): void {
  for (let i = 0; i < n; i++) {
    svc.compare(runId, { seq: i }, liveP, shadowP);
    // Simulate slight variation so the service doesn't de-dup naively.
    // (Shadow service does not de-dup — all pushes are stored.)
    void i;
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('shadow-rollout — orientation correctness', () => {
  let svc: ShadowModeAlgorithmService;
  let storage: ReturnType<typeof makeStorage>;
  const FIXED_NOW = 1_700_000_000_000;

  beforeEach(() => {
    resetShadowRolloutForTests();
    storage = makeStorage();
    svc = new ShadowModeAlgorithmService({ storage, clock: () => FIXED_NOW });
    configureShadowRolloutForTests({ shadowService: svc, storage, clock: () => FIXED_NOW });
    initShadowRollout();
  });

  it('registers three runs with correct IDs', () => {
    const runs = svc.getAllRuns();
    const ids = runs.map(r => r.id);
    assert.ok(ids.includes(RUN_IDS.RECALIBRATION), 'recalibration run registered');
    assert.ok(ids.includes(RUN_IDS.SUPERFORECAST), 'superforecast run registered');
    assert.ok(ids.includes(RUN_IDS.SCHEMA), 'schema run registered');
  });

  it('initShadowRollout is idempotent — second call does not duplicate runs', () => {
    initShadowRollout(); // second call
    const runs = svc.getAllRuns();
    const recalRuns = runs.filter(r => r.id === RUN_IDS.RECALIBRATION);
    assert.strictEqual(recalRuns.length, 1, 'no duplicate recalibration runs');
  });

  it('pushRecalibrationPair stores live=recalibrated, shadow=legacy', () => {
    pushRecalibrationPair({ hypothesisId: 'h1' }, 0.65, 0.70);
    const cmps = svc.getComparisons({ runId: RUN_IDS.RECALIBRATION });
    assert.strictEqual(cmps.length, 1);
    const cmp = cmps[0]!;
    assert.strictEqual(cmp.liveOutput, 0.65, 'liveOutput is recalibrated p');
    assert.strictEqual(cmp.shadowOutput, 0.70, 'shadowOutput is legacy p');
  });

  it('pushSuperforecastPair stores live=baseline, shadow=superforecast', () => {
    pushSuperforecastPair({ hypothesisId: 'h2' }, 0.50, 0.72);
    const cmps = svc.getComparisons({ runId: RUN_IDS.SUPERFORECAST });
    assert.strictEqual(cmps.length, 1);
    const cmp = cmps[0]!;
    assert.strictEqual(cmp.liveOutput, 0.50, 'liveOutput is forecastHypothesis p');
    assert.strictEqual(cmp.shadowOutput, 0.72, 'shadowOutput is superforecast p');
  });

  it('pushSchemaPair stores live=handAuthored matchCount, shadow=learned matchCount', () => {
    pushSchemaPair({ windowTs: 100_000 }, 3, 1);
    const cmps = svc.getComparisons({ runId: RUN_IDS.SCHEMA });
    assert.strictEqual(cmps.length, 1);
    const cmp = cmps[0]!;
    assert.deepStrictEqual(cmp.liveOutput, { matchCount: 3 }, 'live = hand-authored count');
    assert.deepStrictEqual(cmp.shadowOutput, { matchCount: 1 }, 'shadow = learned count');
  });

  it('all push functions are fire-and-forget — do not throw when service absent', () => {
    resetShadowRolloutForTests();
    // No service configured — all pushes should swallow errors.
    assert.doesNotThrow(() => pushRecalibrationPair({}, 0.5, 0.5));
    assert.doesNotThrow(() => pushSuperforecastPair({}, 0.5, 0.5));
    assert.doesNotThrow(() => pushSchemaPair({}, 1, 0));
  });
});

describe('shadow-rollout — flip gate math', () => {
  let svc: ShadowModeAlgorithmService;
  const FIXED_NOW = 2_000_000_000;

  beforeEach(() => {
    resetShadowRolloutForTests();
    svc = new ShadowModeAlgorithmService({ storage: null, clock: () => FIXED_NOW });
    configureShadowRolloutForTests({ shadowService: svc, storage: null, clock: () => FIXED_NOW });
    initShadowRollout();
  });

  it('returns insufficient-data when pair count < FLIP_GATE_MIN_PAIRS', () => {
    pushNPairs(svc, RUN_IDS.RECALIBRATION, FLIP_GATE_MIN_PAIRS - 1, 0.6, 0.65);
    const v = shadowVerdict(RUN_IDS.RECALIBRATION);
    assert.strictEqual(v.recommendation, 'insufficient-data');
    assert.strictEqual(v.pairs, FLIP_GATE_MIN_PAIRS - 1);
  });

  it('returns insufficient-data when calibration store has no resolved records', () => {
    pushNPairs(svc, RUN_IDS.RECALIBRATION, FLIP_GATE_MIN_PAIRS, 0.6, 0.65);
    // calibrationStore with only pending records → no Brier possible
    configureShadowRolloutForTests({
      calibrationStore: makeCalibrationStore([
        { id: 'r1', probability: 0.6, status: 'pending', predictedAt: FIXED_NOW },
      ]) as unknown as import('@/services/intelligence/forecast-calibration').ForecastCalibrationStore,
    });
    const v = shadowVerdict(RUN_IDS.RECALIBRATION);
    assert.strictEqual(v.recommendation, 'insufficient-data');
    assert.strictEqual(v.brierLive, undefined);
    assert.strictEqual(v.brierShadow, undefined);
  });

  it('returns keep-live when shadowBrier > liveBrier', () => {
    const liveP = 0.8;    // lives close to outcome=true → low Brier for live
    const shadowP = 0.3;  // shadow far from outcome=true → high Brier for shadow
    const tBase = FIXED_NOW - 1000;

    // Push 200 pairs.
    for (let i = 0; i < FLIP_GATE_MIN_PAIRS; i++) {
      svc.compare(RUN_IDS.RECALIBRATION, { seq: i }, liveP, shadowP);
    }

    // One resolved_true record whose probability matches liveP.
    configureShadowRolloutForTests({
      calibrationStore: makeCalibrationStore([
        { id: 'rec1', probability: liveP, status: 'resolved_true', predictedAt: tBase, resolvedAt: tBase + 1000 },
      ]) as unknown as import('@/services/intelligence/forecast-calibration').ForecastCalibrationStore,
    });

    const v = shadowVerdict(RUN_IDS.RECALIBRATION);
    assert.ok(v.brierLive !== undefined, 'brierLive defined');
    assert.ok(v.brierShadow !== undefined, 'brierShadow defined');
    // live: (0.8 - 1)^2 = 0.04; shadow: (0.3 - 1)^2 = 0.49 → keep-live
    assert.ok(v.brierShadow! > v.brierLive!, `shadow Brier (${v.brierShadow}) > live Brier (${v.brierLive})`);
    assert.strictEqual(v.recommendation, 'keep-live');
  });

  it('returns flip-to-shadow when shadowBrier ≤ liveBrier', () => {
    const liveP = 0.3;   // live far from outcome=true → high Brier for live
    const shadowP = 0.8; // shadow close to outcome=true → low Brier for shadow
    const tBase = FIXED_NOW - 1000;

    for (let i = 0; i < FLIP_GATE_MIN_PAIRS; i++) {
      svc.compare(RUN_IDS.SUPERFORECAST, { seq: i }, liveP, shadowP);
    }

    configureShadowRolloutForTests({
      calibrationStore: makeCalibrationStore([
        { id: 'rec2', probability: liveP, status: 'resolved_true', predictedAt: tBase, resolvedAt: tBase + 500 },
      ]) as unknown as import('@/services/intelligence/forecast-calibration').ForecastCalibrationStore,
    });

    const v = shadowVerdict(RUN_IDS.SUPERFORECAST);
    // live: (0.3 - 1)^2 = 0.49; shadow: (0.8 - 1)^2 = 0.04 → flip-to-shadow
    assert.ok(v.brierShadow! <= v.brierLive!, `shadow Brier (${v.brierShadow}) ≤ live Brier (${v.brierLive})`);
    assert.strictEqual(v.recommendation, 'flip-to-shadow');
  });

  it('schema run returns insufficient-data regardless of pair count (Brier N/A)', () => {
    for (let i = 0; i < FLIP_GATE_MIN_PAIRS; i++) {
      svc.compare(RUN_IDS.SCHEMA, { window: i }, { matchCount: 3 }, { matchCount: 1 });
    }
    const v = shadowVerdict(RUN_IDS.SCHEMA);
    assert.strictEqual(v.pairs, FLIP_GATE_MIN_PAIRS);
    assert.strictEqual(v.recommendation, 'insufficient-data', 'schema Brier is N/A');
  });

  it('verdict includes divergenceRate', () => {
    // Push 200 pairs: 100 matching, 100 diverging.
    for (let i = 0; i < 100; i++) svc.compare(RUN_IDS.RECALIBRATION, { i }, 0.5, 0.5);
    for (let i = 0; i < 100; i++) svc.compare(RUN_IDS.RECALIBRATION, { i: i + 100 }, 0.5, 0.9);
    const v = shadowVerdict(RUN_IDS.RECALIBRATION);
    assert.strictEqual(v.pairs, 200);
    // 100 of 200 are diverging → ~0.5
    assert.ok(v.divergenceRate >= 0.4 && v.divergenceRate <= 0.6, `divergenceRate ${v.divergenceRate} in range`);
  });
});

describe('shadow-rollout — verdict snapshot persistence', () => {
  let svc: ShadowModeAlgorithmService;
  let storage: ReturnType<typeof makeStorage>;
  let putCalls: Array<[string, unknown]>;
  const FIXED_NOW = 3_000_000_000;

  beforeEach(() => {
    resetShadowRolloutForTests();
    storage = makeStorage();
    putCalls = [];
    svc = new ShadowModeAlgorithmService({ storage, clock: () => FIXED_NOW });
    configureShadowRolloutForTests({
      shadowService: svc,
      storage,
      clock: () => FIXED_NOW,
      putMemoryFn: async (key, value) => { putCalls.push([key, value]); },
    });
    initShadowRollout();
  });

  it('persistVerdictSnapshot writes to localStorage', () => {
    persistVerdictSnapshot();
    const raw = storage.data.get(VERDICT_STORAGE_KEY);
    assert.ok(raw, 'snapshot written to localStorage');
    const parsed = JSON.parse(raw!) as { verdicts: unknown[]; snapshottedAt: number };
    assert.strictEqual(
      parsed.verdicts.length,
      Object.values(RUN_IDS).length,
      'every registered run has a verdict in the snapshot (ACC-303 added the three baseline runs)',
    );
    assert.strictEqual(parsed.snapshottedAt, FIXED_NOW);
  });

  it('persistVerdictSnapshot calls putMemory with the correct key', async () => {
    persistVerdictSnapshot();
    // Give the async put a tick.
    await new Promise<void>(resolve => setImmediate(resolve));
    const keyCall = putCalls.find(([k]) => k === VERDICT_STORAGE_KEY);
    assert.ok(keyCall, 'putMemory called with shadow verdict key');
  });

  it('persistVerdictSnapshot snapshot contains all three run IDs', () => {
    persistVerdictSnapshot();
    const raw = storage.data.get(VERDICT_STORAGE_KEY)!;
    const parsed = JSON.parse(raw) as { verdicts: Array<{ runId: string }> };
    const runIds = parsed.verdicts.map(v => v.runId);
    assert.ok(runIds.includes(RUN_IDS.RECALIBRATION));
    assert.ok(runIds.includes(RUN_IDS.SUPERFORECAST));
    assert.ok(runIds.includes(RUN_IDS.SCHEMA));
  });

  it('persistVerdictSnapshot is fire-and-forget — does not throw on storage failure', () => {
    configureShadowRolloutForTests({
      storage: {
        getItem: () => null,
        setItem: () => { throw new Error('quota exceeded'); },
      },
    });
    assert.doesNotThrow(() => persistVerdictSnapshot());
  });
});

describe('shadow-rollout — recommendation field is the correct union type', () => {
  beforeEach(() => {
    resetShadowRolloutForTests();
    const svc = new ShadowModeAlgorithmService({ storage: null });
    configureShadowRolloutForTests({ shadowService: svc, storage: null });
    initShadowRollout();
  });

  it('recommendation is one of the three valid literals', () => {
    const valid: FlipRecommendation[] = ['keep-live', 'flip-to-shadow', 'insufficient-data'];
    const v = shadowVerdict(RUN_IDS.RECALIBRATION);
    assert.ok(valid.includes(v.recommendation), `recommendation '${v.recommendation}' is valid`);
  });
});

// ── ACC-303: baseline runs are fenced from the probability-proximity verdict ──

it('baseline runs without joinable outcomes report zero joined pairs and no Brier (ACC-401 semantics)', () => {
  resetShadowRolloutForTests();
  const comparisons = Array.from({ length: 300 }, (_, i) => ({
    runId: 'production-vs-persistence-baseline',
    liveOutput: 0.6,
    shadowOutput: 0.55,
    timestamp: 1_000 + i,
  }));
  const fakeSvc = {
    registerRun: () => {},
    compare: () => {},
    getComparisons: () => comparisons,
    getDivergenceRate: () => 0.2,
  } as never;
  const verdict = shadowVerdict(RUN_IDS.BASELINE_PERSISTENCE, { shadowService: fakeSvc, clock: () => 5_000 });
  // ACC-401: pairs = JOINED resolved pairs. These comparisons carry no
  // joinKey, so nothing joins — and no Brier can come from proximity.
  assert.equal(verdict.pairs, 0);
  assert.equal(verdict.recommendation, 'insufficient-data');
  assert.equal(verdict.brierLive, undefined, 'no Brier without exact joins');
  assert.equal(verdict.brierShadow, undefined);
  resetShadowRolloutForTests();
});

it('persistVerdictSnapshot covers every registered run including the three baseline runs', () => {
  resetShadowRolloutForTests();
  const written: Record<string, string> = {};
  const fakeSvc = {
    registerRun: () => {},
    compare: () => {},
    getComparisons: () => [],
    getDivergenceRate: () => 0,
  } as never;
  persistVerdictSnapshot({
    shadowService: fakeSvc,
    storage: { getItem: () => null, setItem: (k, v) => { written[k] = v; } },
    putMemoryFn: async () => {},
    clock: () => 9_000,
  });
  const snapshot = JSON.parse(written[VERDICT_STORAGE_KEY]!) as { verdicts: { runId: string }[] };
  const ids = snapshot.verdicts.map((v) => v.runId).sort();
  assert.equal(ids.length, Object.values(RUN_IDS).length);
  for (const id of Object.values(RUN_IDS)) {
    assert.ok(ids.includes(id), `snapshot missing run ${id}`);
  }
  resetShadowRolloutForTests();
});

// ── ACC-401: exact paired-outcome joins ──────────────────────────────────

const J_T = Date.UTC(2026, 6, 1, 12, 0, 0);
const J_H = 3_600_000;

function joinComparison(
  targetKey: string,
  liveP: number,
  shadowP: number,
  overrides: Record<string, unknown> = {},
): never {
  return {
    runId: 'production-vs-persistence-baseline',
    liveOutput: liveP,
    shadowOutput: shadowP,
    timestamp: J_T + 60_000,
    joinKey: {
      targetKey,
      predictedAt: J_T,
      resolveBy: J_T + 24 * J_H,
      liveModelId: 'mode-forecast',
      liveModelVersion: '1.0.0',
      shadowModelId: 'persistence-baseline',
      shadowModelVersion: '1.0.0',
    },
    ...overrides,
  } as never;
}

function joinResolved(
  targetKey: string,
  outcome: boolean,
  overrides: Record<string, unknown> = {},
): PredictionRecord {
  return {
    id: `jr-${targetKey}-${outcome}`,
    sourceId: 'mode-forecast',
    targetKey,
    domain: 'markets',
    claim: 'j',
    probability: 0.6,
    predictedAt: J_T,
    resolveBy: J_T + 24 * J_H,
    status: outcome ? 'resolved_true' : 'resolved_false',
    resolvedAt: J_T + 12 * J_H,
    resolutionNote: 'direct:j',
    ...overrides,
  } as PredictionRecord;
}

function fakeJoinStore(records: PredictionRecord[]): never {
  return { all: () => records } as never;
}

function fakeJoinSvc(comparisons: unknown[]): never {
  return {
    registerRun: () => {},
    compare: () => {},
    getComparisons: () => comparisons,
    getDivergenceRate: () => 0.1,
  } as never;
}

it('REGRESSION (round-2 P1): two p=0.6 forecasts resolving oppositely join to their OWN outcomes', () => {
  resetShadowRolloutForTests();
  // 200+ joined pairs split across two targets with opposite outcomes,
  // every comparison at the same probability — proximity would mix them.
  const comparisons: unknown[] = [];
  const records: PredictionRecord[] = [];
  for (let i = 0; i < 120; i++) {
    const kTrue = `mode:true-${i}`;
    const kFalse = `mode:false-${i}`;
    comparisons.push(joinComparison(kTrue, 0.6, 0.9));
    comparisons.push(joinComparison(kFalse, 0.6, 0.9));
    records.push(joinResolved(kTrue, true), joinResolved(kFalse, false));
  }
  const verdict = shadowVerdict(RUN_IDS.BASELINE_PERSISTENCE, {
    shadowService: fakeJoinSvc(comparisons),
    calibrationStore: fakeJoinStore(records),
    clock: () => J_T + 24 * J_H,
  });
  assert.equal(verdict.pairs, 240);
  // live 0.6 on half-true cohort → Brier 0.5*(0.16)+0.5*(0.36)=0.26;
  // shadow 0.9 → 0.5*(0.01)+0.5*(0.81)=0.41. Exact joins keep them honest.
  assert.ok(Math.abs(verdict.brierLive! - 0.26) < 1e-9);
  assert.ok(Math.abs(verdict.brierShadow! - 0.41) < 1e-9);
  assert.equal(verdict.recommendation, 'keep-live');
  resetShadowRolloutForTests();
});

it('exact joins exclude pairs produced at-or-after the outcome observation', () => {
  resetShadowRolloutForTests();
  const late = joinComparison('mode:late', 0.6, 0.5, { timestamp: J_T + 13 * J_H }) as Record<string, unknown>;
  const verdict = shadowVerdict(RUN_IDS.BASELINE_PERSISTENCE, {
    shadowService: fakeJoinSvc([late]),
    calibrationStore: fakeJoinStore([joinResolved('mode:late', true)]),
    clock: () => J_T + 24 * J_H,
  });
  assert.equal(verdict.pairs, 0, 'resolvedAt (T+12h) precedes the pair timestamp (T+13h)');
  resetShadowRolloutForTests();
});

it('exact joins drop identities whose records disagree on the outcome', () => {
  resetShadowRolloutForTests();
  const verdict = shadowVerdict(RUN_IDS.BASELINE_PERSISTENCE, {
    shadowService: fakeJoinSvc([joinComparison('mode:conflict', 0.6, 0.5)]),
    calibrationStore: fakeJoinStore([
      joinResolved('mode:conflict', true, { id: 'c1' }),
      joinResolved('mode:conflict', false, { id: 'c2' }),
    ]),
    clock: () => J_T + 24 * J_H,
  });
  assert.equal(verdict.pairs, 0, 'conflicting identity dropped entirely');
  resetShadowRolloutForTests();
});

it('exact joins require the LIVE model identity to match the resolved record source', () => {
  resetShadowRolloutForTests();
  const wrongModel = joinComparison('mode:wm', 0.6, 0.5);
  const verdict = shadowVerdict(RUN_IDS.BASELINE_PERSISTENCE, {
    shadowService: fakeJoinSvc([wrongModel]),
    calibrationStore: fakeJoinStore([
      joinResolved('mode:wm', true, { sourceId: 'superforecast' }),
    ]),
    clock: () => J_T + 24 * J_H,
  });
  assert.equal(verdict.pairs, 0, 'different producing model = different identity');
  resetShadowRolloutForTests();
});

it('below the min-pairs gate joined evidence reports insufficient-data with the honest joined count', () => {
  resetShadowRolloutForTests();
  const verdict = shadowVerdict(RUN_IDS.BASELINE_PERSISTENCE, {
    shadowService: fakeJoinSvc([joinComparison('mode:few', 0.6, 0.5)]),
    calibrationStore: fakeJoinStore([joinResolved('mode:few', true)]),
    clock: () => J_T + 24 * J_H,
  });
  assert.equal(verdict.pairs, 1);
  assert.equal(verdict.recommendation, 'insufficient-data');
  resetShadowRolloutForTests();
});
