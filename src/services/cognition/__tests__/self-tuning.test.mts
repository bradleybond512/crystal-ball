/**
 * Cognition PR 12 — Self-Tuning Cognition tests.
 *
 * Covers:
 *   1. The 8 declared cognition tunables (defaults, bounds, clamping).
 *   2. get-with-default reads inside the cognition modules (an empty store
 *      is byte-identical to the pre-PR-12 constants; a tuned store moves
 *      the math in hand-verified ways).
 *   3. The 5 registered cognition algorithms.
 *   4. The episodic-analog:minSim safety-fixture suite (set-wise
 *      non-regression discriminates in both directions).
 *   5. The deterministic grading pass (episodic-analog, recalibration,
 *      superforecast, entity-trajectory) with watermarks.
 *   6. Operator-ranking grading at hypothesis resolution.
 *   7. The drift watch over the graded ledger.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  getTunedParam,
  setTunedParam,
  getTunings,
  _resetTunedParamsForTests,
} from '../../algorithms/tunable-params-store.js';
import { getAlgorithm } from '../../algorithms/algorithm-registry.js';
import {
  scoreTuningSafety,
  proposeTuningSafety,
  hasTuningSafetyFixtures,
} from '../../algorithms/tuning-safety-fixtures.js';
import type { EvaluationRecord, EvaluationOutcome } from '../../algorithms/algorithm-evaluation-ledger.js';

import { blendWithEpisodic, type ReferenceClass } from '../base-rates.js';
import { extremize, DEFAULT_K } from '../probability-aggregation.js';
import { buildCurve } from '../recalibration.js';
import type { PredictionRecord } from '../../intelligence/forecast-calibration.js';
import { analogScoreFor, type Recall, type Episode } from '../episodic-memory.js';
import { computeHeat, type DossierEvent } from '../entity-dossier.js';
import { decayWeight } from '../operator-model.js';

import {
  COGNITION_ALGORITHM_IDS,
  runCognitionGradingPass,
  gradeOperatorRankingOnResolution,
  runCognitionDriftWatch,
  shouldRunSelfTuning,
  SELF_TUNING_INTERVAL_MS,
  type SelfTuningStorageLike,
} from '../self-tuning.js';

// ── localStorage shim (the tunable store reads the global) ────────────────────

function installLocalStorage(): () => void {
  const data = new Map<string, string>();
  const shim = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
  };
  (globalThis as Record<string, unknown>).localStorage = shim;
  return () => { delete (globalThis as Record<string, unknown>).localStorage; };
}

function makeStorage(): SelfTuningStorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
  };
}

// ── Fixture builders ──────────────────────────────────────────────────────────

function makeEpisode(over: Partial<Episode>): Episode {
  return {
    id: 'ep-1',
    kind: 'hypothesis',
    signature: 'sig-1',
    summary: 'fixture episode',
    domains: ['conflict'],
    entities: ['XX'],
    createdAt: 0,
    vector: [],
    tier: 'hashed',
    ...over,
  };
}

function makeRecall(similarity: number, outcome: Episode['outcome']): Recall {
  return {
    episode: makeEpisode({ outcome, resolvedAt: 1000 }),
    similarity,
    ageDays: 1,
    explanation: 'fixture',
  };
}

function makePrediction(over: Partial<PredictionRecord>): PredictionRecord {
  return {
    id: 'p-1',
    sourceId: 'analyst-loop',
    domain: 'other',
    claim: 'fixture claim',
    probability: 0.7,
    predictedAt: 0,
    resolveBy: 1000,
    status: 'resolved_true',
    resolvedAt: 500,
    ...over,
  };
}

interface CapturedEvaluation {
  algorithmId: string;
  score?: number;
  label?: string;
  at?: number;
}

interface CapturedOutcome {
  recordId: string;
  outcome: EvaluationOutcome;
  reason: string;
}

function makeRecorder(): {
  evaluations: CapturedEvaluation[];
  outcomes: CapturedOutcome[];
  recordEvaluation: (algorithmId: string, input: { score?: number; label?: string; at?: number }) => { id: string };
  recordOutcome: (recordId: string, outcome: EvaluationOutcome, reason: string) => void;
} {
  const evaluations: CapturedEvaluation[] = [];
  const outcomes: CapturedOutcome[] = [];
  return {
    evaluations,
    outcomes,
    recordEvaluation: (algorithmId, input) => {
      evaluations.push({ algorithmId, score: input.score, label: input.label, at: input.at });
      return { id: `r-${evaluations.length}` };
    },
    recordOutcome: (recordId, outcome, reason) => {
      outcomes.push({ recordId, outcome, reason });
    },
  };
}

// ── 1. Tunable declarations ───────────────────────────────────────────────────

describe('PR 12 tunable declarations', () => {
  let uninstall: () => void;
  beforeEach(() => { uninstall = installLocalStorage(); _resetTunedParamsForTests(); });
  afterEach(() => { uninstall(); });

  const expectedKnobs: Array<[string, string, number, number, number]> = [
    // [algorithmId, parameterId, default, min, max]
    ['episodic-analog', 'minSim', 0.45, 0.3, 0.6],
    ['episodic-analog', 'analogBlendK', 5, 3, 10],
    ['recalibration', 'shrinkPrior', 10, 5, 20],
    ['superforecast', 'extremizeK', 1.3, 1, 1.8],
    ['superforecast', 'spreadSkipThreshold', 0.25, 0.15, 0.4],
    ['entity-trajectory', 'heatHalfLifeHours', 72, 24, 168],
    ['operator-ranking', 'interestHalfLifeHours', 168, 72, 336],
    ['consolidation', 'clusterSimThreshold', 0.6, 0.5, 0.75],
  ];

  it('declares all 8 cognition knobs with the historical defaults and plan bounds', () => {
    const tunings = getTunings();
    for (const [algo, param, def, min, max] of expectedKnobs) {
      const tuning = tunings.find((t) => t.algorithmId === algo);
      assert.ok(tuning, `tuning group for ${algo}`);
      const p = tuning!.parameters.find((x) => x.parameterId === param);
      assert.ok(p, `${algo}:${param} declared`);
      assert.equal(p!.current, def, `${algo}:${param} default`);
      assert.equal(p!.min, min, `${algo}:${param} min`);
      assert.equal(p!.max, max, `${algo}:${param} max`);
      assert.ok(p!.description.length > 0, `${algo}:${param} description`);
    }
  });

  it('clamps out-of-range writes to the declared bounds', () => {
    setTunedParam('episodic-analog', 'minSim', 0.9);
    assert.equal(getTunedParam('episodic-analog', 'minSim', 0.45), 0.6);
    setTunedParam('episodic-analog', 'minSim', 0.1);
    assert.equal(getTunedParam('episodic-analog', 'minSim', 0.45), 0.3);
    setTunedParam('entity-trajectory', 'heatHalfLifeHours', 10_000);
    assert.equal(getTunedParam('entity-trajectory', 'heatHalfLifeHours', 72), 168);
  });
});

// ── 2. get-with-default reads inside cognition modules ────────────────────────

describe('cognition modules read tuned values with hardcoded defaults', () => {
  let uninstall: () => void;
  beforeEach(() => { uninstall = installLocalStorage(); _resetTunedParamsForTests(); });
  afterEach(() => { uninstall(); });

  const rc: ReferenceClass = {
    id: 'test-class',
    label: 'Test class',
    baseRate: 0.2,
    source: 'fixture',
    matchers: [],
  } as unknown as ReferenceClass;

  it('blendWithEpisodic uses the tuned analogBlendK', () => {
    // Default k=5: weight = 5/(5+5) = 0.5 → blended = 0.2*0.5 + 0.8*0.5 = 0.5
    const before = blendWithEpisodic(rc, 0.8, 5);
    assert.ok(Math.abs(before.rate - 0.5) < 1e-9);
    // Tuned k=10: weight = 5/15 = 1/3 → blended = 0.2*(2/3) + 0.8*(1/3) = 0.4
    setTunedParam('episodic-analog', 'analogBlendK', 10);
    const after = blendWithEpisodic(rc, 0.8, 5);
    assert.ok(Math.abs(after.rate - 0.4) < 1e-9);
  });

  it('extremize resolves k from the store when omitted', () => {
    const sharpened = extremize(0.7, undefined, 0, 5);
    assert.ok(sharpened > 0.7, 'default k=1.3 sharpens');
    setTunedParam('superforecast', 'extremizeK', 1.0);
    const identity = extremize(0.7, undefined, 0, 5);
    assert.ok(Math.abs(identity - 0.7) < 1e-9, 'tuned k=1 is the identity');
    // An explicit k always wins over the store.
    const explicit = extremize(0.7, DEFAULT_K, 0, 5);
    assert.ok(Math.abs(explicit - sharpened) < 1e-9);
  });

  it('extremize resolves the spread-skip threshold from the store', () => {
    // spread 0.2 < default threshold 0.25 → extremizes.
    const sharpened = extremize(0.7, undefined, 0.2, 5);
    assert.ok(sharpened > 0.7);
    setTunedParam('superforecast', 'extremizeK', 1.3); // keep k sharp
    setTunedParam('superforecast', 'spreadSkipThreshold', 0.15);
    // Now spread 0.2 > tuned threshold 0.15 → skipped.
    const skipped = extremize(0.7, undefined, 0.2, 5);
    assert.ok(Math.abs(skipped - 0.7) < 1e-9);
  });

  it('buildCurve applies the tuned shrinkage prior (hand-verified bin math)', () => {
    // 10 resolved records at p=0.75, 3 true → predictedMean 0.75, raw rate 0.3,
    // raw correction −0.45.
    const records: PredictionRecord[] = Array.from({ length: 10 }, (_, i) =>
      makePrediction({
        id: `p-${i}`,
        probability: 0.75,
        status: i < 3 ? 'resolved_true' : 'resolved_false',
      }));
    // Default prior 10: shrinkage 10/20 = 0.5 → calibrated 0.75 − 0.225 = 0.525.
    const def = buildCurve(records);
    assert.ok(Math.abs(def.bins[7]!.observedRate - 0.525) < 0.002, `got ${def.bins[7]!.observedRate}`);
    // Tuned prior 5: shrinkage 10/15 = 2/3 → calibrated 0.75 − 0.30 = 0.45.
    setTunedParam('recalibration', 'shrinkPrior', 5);
    const tuned = buildCurve(records);
    assert.ok(Math.abs(tuned.bins[7]!.observedRate - 0.45) < 0.002, `got ${tuned.bins[7]!.observedRate}`);
  });

  it('analogScoreFor honors both the tuned minSim and an explicit override', () => {
    const recalls = [
      makeRecall(0.5, 'materialized'),
      makeRecall(0.52, 'materialized'),
      makeRecall(0.55, 'materialized'),
    ];
    assert.equal(analogScoreFor(recalls), 1, 'default 0.45 qualifies all three');
    setTunedParam('episodic-analog', 'minSim', 0.6);
    assert.equal(analogScoreFor(recalls), null, 'tuned 0.60 disqualifies them');
    assert.equal(analogScoreFor(recalls, { minSim: 0.45 }), 1, 'explicit override wins');
  });

  it('computeHeat honors the tuned heat half-life (hand-verified decay)', () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const timeline: DossierEvent[] = [{ ts: 0, kind: 'k', refId: 'r', label: 'l' }];
    // Default 72h half-life, age 24h → 2^(−1/3)/100.
    const def = computeHeat(timeline, dayMs);
    assert.ok(Math.abs(def - Math.pow(2, -1 / 3) / 100) < 1e-9);
    // Tuned 24h half-life, age 24h → 2^(−1)/100.
    setTunedParam('entity-trajectory', 'heatHalfLifeHours', 24);
    const tuned = computeHeat(timeline, dayMs);
    assert.ok(Math.abs(tuned - 0.5 / 100) < 1e-9);
  });

  it('decayWeight honors the tuned interest half-life', () => {
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    assert.ok(Math.abs(decayWeight(1, 0, weekMs) - 0.5) < 1e-9, 'default 168h halves in a week');
    setTunedParam('operator-ranking', 'interestHalfLifeHours', 336);
    assert.ok(Math.abs(decayWeight(1, 0, weekMs) - Math.SQRT1_2) < 1e-9, 'tuned 336h → 2^(−0.5)');
  });
});

// ── 3. Registered cognition algorithms ────────────────────────────────────────

describe('cognition algorithms are registered', () => {
  it('registers all five with the plan criticalities and output kinds', () => {
    const expected: Array<[string, string, string]> = [
      ['episodic-analog', 'risk_score', 'medium'],
      ['recalibration', 'forecast', 'medium'],
      ['superforecast', 'forecast', 'medium'],
      ['operator-ranking', 'ranking', 'low'],
      ['entity-trajectory', 'risk_score', 'medium'],
    ];
    assert.deepEqual([...COGNITION_ALGORITHM_IDS], expected.map(([id]) => id));
    for (const [id, output, criticality] of expected) {
      const def = getAlgorithm(id);
      assert.ok(def, `${id} registered`);
      assert.ok(def!.outputs.includes(output as never), `${id} outputs ${output}`);
      assert.equal(def!.criticality, criticality, `${id} criticality`);
      assert.equal(def!.domain, 'cognition');
    }
  });
});

// ── 4. episodic-analog:minSim safety fixtures ─────────────────────────────────

describe('episodic-analog minSim safety fixtures', () => {
  it('has a declared suite that scores clean at the default', () => {
    assert.equal(hasTuningSafetyFixtures('episodic-analog', 'minSim'), true);
    const score = scoreTuningSafety('episodic-analog', 'minSim', 0.45);
    assert.ok(score);
    assert.equal(score!.hitRate, 1, 'all cases pass at the default 0.45');
    assert.equal(score!.cases, 5);
  });

  it('blocks regressions in both directions, allows one safe step up', () => {
    // Decrease toward the noise band breaks F3 → blocked.
    assert.equal(proposeTuningSafety('episodic-analog', 'minSim', 0.45, 0.4), false);
    assert.equal(proposeTuningSafety('episodic-analog', 'minSim', 0.45, 0.3), false);
    // One step up keeps every passing case → allowed.
    assert.equal(proposeTuningSafety('episodic-analog', 'minSim', 0.45, 0.5), true);
    // A larger increase disqualifies the genuine pattern (T1) → blocked.
    assert.equal(proposeTuningSafety('episodic-analog', 'minSim', 0.45, 0.55), false);
  });
});

// ── 5. Grading pass ───────────────────────────────────────────────────────────

describe('runCognitionGradingPass', () => {
  it('grades resolved episodes against their analog score (hit/miss/partial, skips)', () => {
    const rec = makeRecorder();
    const episodes: Episode[] = [
      // Elevated analog + materialized → hit.
      makeEpisode({ id: 'e1', signature: 's1', outcome: 'materialized', resolvedAt: 100 }),
      // Elevated analog + fizzled → miss.
      makeEpisode({ id: 'e2', signature: 's2', outcome: 'fizzled', resolvedAt: 200 }),
      // Partial outcome → partial.
      makeEpisode({ id: 'e3', signature: 's3', outcome: 'partial', resolvedAt: 300 }),
      // No analog score attached → skipped.
      makeEpisode({ id: 'e4', signature: 's4', outcome: 'materialized', resolvedAt: 400 }),
      // Unknown outcome → skipped.
      makeEpisode({ id: 'e5', signature: 's5', outcome: 'unknown', resolvedAt: 500 }),
      // Unresolved → skipped.
      makeEpisode({ id: 'e6', signature: 's6' }),
    ];
    const analogs = new Map<string, number>([['s1', 0.8], ['s2', 0.7], ['s3', 0.6]]);
    const result = runCognitionGradingPass({
      episodes,
      analogScoreForSignature: (sig) => analogs.get(sig) ?? null,
      calibrationRecords: [],
      dossiers: [],
      recordEvaluation: rec.recordEvaluation,
      recordOutcome: rec.recordOutcome,
      storage: makeStorage(),
      now: () => 1_000_000,
    });
    assert.equal(result.graded['episodic-analog'], 3);
    assert.deepEqual(rec.outcomes.map((o) => o.outcome), ['hit', 'miss', 'partial']);
    assert.ok(rec.evaluations.every((e) => e.algorithmId === 'episodic-analog'));
    assert.ok(rec.outcomes[0]!.reason.includes('elevated'));
  });

  it('does not double-grade across passes (episodic watermark)', () => {
    const rec = makeRecorder();
    const storage = makeStorage();
    const deps = {
      episodes: [makeEpisode({ id: 'e1', signature: 's1', outcome: 'materialized' as const, resolvedAt: 100 })],
      analogScoreForSignature: () => 0.9,
      calibrationRecords: [] as PredictionRecord[],
      dossiers: [],
      recordEvaluation: rec.recordEvaluation,
      recordOutcome: rec.recordOutcome,
      storage,
      now: () => 1_000_000,
    };
    assert.equal(runCognitionGradingPass(deps).graded['episodic-analog'], 1);
    assert.equal(runCognitionGradingPass(deps).graded['episodic-analog'], 0, 'second pass grades nothing');
    assert.equal(rec.evaluations.length, 1);
  });

  it('routes resolved calibration records to recalibration vs superforecast by sourceId', () => {
    const rec = makeRecorder();
    const records: PredictionRecord[] = [
      // Recalibrator (below) shifts 0.7 → 0.4: reads "unlikely", claim
      // materialized → miss for recalibration.
      makePrediction({ id: 'p1', sourceId: 'analyst-loop', probability: 0.7, status: 'resolved_true', resolvedAt: 100 }),
      // Superforecast graded on its RAW probability: 0.7 ≥ 0.5 and
      // materialized → hit (recalibrator must NOT apply).
      makePrediction({ id: 'p2', sourceId: 'superforecast', probability: 0.7, status: 'resolved_true', resolvedAt: 200 }),
      // Pending → skipped.
      makePrediction({ id: 'p3', status: 'pending', resolvedAt: undefined }),
    ];
    const result = runCognitionGradingPass({
      episodes: [],
      analogScoreForSignature: () => null,
      calibrationRecords: records,
      recalibratorFor: () => (p: number) => ({ p: p - 0.3 }),
      dossiers: [],
      recordEvaluation: rec.recordEvaluation,
      recordOutcome: rec.recordOutcome,
      storage: makeStorage(),
      now: () => 1_000_000,
    });
    assert.equal(result.graded['recalibration'], 1);
    assert.equal(result.graded['superforecast'], 1);
    const recal = rec.evaluations.find((e) => e.algorithmId === 'recalibration');
    const sf = rec.evaluations.find((e) => e.algorithmId === 'superforecast');
    assert.ok(Math.abs(recal!.score! - 0.4) < 1e-9, 'recalibrated probability recorded');
    assert.ok(Math.abs(sf!.score! - 0.7) < 1e-9, 'raw superforecast probability recorded');
    const outcomeByIdx = new Map(rec.outcomes.map((o) => [o.recordId, o.outcome]));
    assert.equal(outcomeByIdx.get('r-1'), 'miss');
    assert.equal(outcomeByIdx.get('r-2'), 'hit');
  });

  it('grades entity trajectories retrospectively and skips stable predictions', () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const now = 60 * dayMs;
    const cutoff = now - 7 * dayMs;
    const ev = (ts: number): DossierEvent => ({ ts, kind: 'k', refId: 'r', label: 'l' });

    // Heating at cutoff: 6 events in the 7d before cutoff vs 3 in the prior
    // 21d (ratio 6). Activity kept rising afterwards (8 events) → hit.
    const heatingHit = {
      entity: 'country:AAA',
      timeline: [
        ...[25, 30, 35].map((d) => ev(cutoff - d * dayMs + dayMs)), // prior window
        ...Array.from({ length: 6 }, (_, i) => ev(cutoff - (i + 1) * 0.9 * dayMs)), // recent 7d
        ...Array.from({ length: 8 }, (_, i) => ev(cutoff + (i + 1) * 0.8 * dayMs)), // after cutoff
      ].sort((a, b) => a.ts - b.ts),
    };
    // Heating at cutoff but activity collapsed afterwards (1 event) → miss.
    const heatingMiss = {
      entity: 'country:BBB',
      timeline: [
        ...[25, 30, 35].map((d) => ev(cutoff - d * dayMs + dayMs)),
        ...Array.from({ length: 6 }, (_, i) => ev(cutoff - (i + 1) * 0.9 * dayMs)),
        ev(cutoff + dayMs),
      ].sort((a, b) => a.ts - b.ts),
    };
    // Steady rate at cutoff → stable → skipped entirely.
    const stable = {
      entity: 'country:CCC',
      timeline: Array.from({ length: 28 }, (_, i) => ev(cutoff - (i + 0.5) * dayMs)),
    };

    const rec = makeRecorder();
    const storage = makeStorage();
    const deps = {
      episodes: [] as Episode[],
      analogScoreForSignature: () => null,
      calibrationRecords: [] as PredictionRecord[],
      dossiers: [heatingHit, heatingMiss, stable],
      recordEvaluation: rec.recordEvaluation,
      recordOutcome: rec.recordOutcome,
      storage,
      now: () => now,
    };
    const result = runCognitionGradingPass(deps);
    assert.equal(result.graded['entity-trajectory'], 2, 'stable prediction not graded');
    assert.deepEqual(rec.outcomes.map((o) => o.outcome).sort(), ['hit', 'miss']);
    assert.ok(rec.outcomes[0]!.reason.includes('predicted heating'));

    // Second pass at the same clock: per-entity watermark prevents re-grading.
    const again = runCognitionGradingPass(deps);
    assert.equal(again.graded['entity-trajectory'], 0);
  });
});

// ── 6. Operator-ranking grading ───────────────────────────────────────────────

describe('gradeOperatorRankingOnResolution', () => {
  it('boost on a hypothesis that panned out is a hit; on a fizzle, a miss', () => {
    const rec = makeRecorder();
    const deps = {
      interestMultiplierFn: () => 1.15,
      recordEvaluation: rec.recordEvaluation,
      recordOutcome: rec.recordOutcome,
      now: () => 42,
    };
    assert.equal(gradeOperatorRankingOnResolution('wheat escalation', true, deps), 'hit');
    assert.equal(gradeOperatorRankingOnResolution('wheat escalation', false, deps), 'miss');
    assert.equal(rec.evaluations.length, 2);
    assert.ok(rec.evaluations.every((e) => e.algorithmId === 'operator-ranking'));
    assert.equal(rec.evaluations[0]!.label, 'boosted');
  });

  it('demotion on a fizzle is a hit', () => {
    const rec = makeRecorder();
    const outcome = gradeOperatorRankingOnResolution('noise topic', false, {
      interestMultiplierFn: () => 0.85,
      recordEvaluation: rec.recordEvaluation,
      recordOutcome: rec.recordOutcome,
    });
    assert.equal(outcome, 'hit');
    assert.equal(rec.evaluations[0]!.label, 'demoted');
  });

  it('neutral multipliers and missing statements carry no signal', () => {
    const rec = makeRecorder();
    const deps = {
      interestMultiplierFn: () => 1.0,
      recordEvaluation: rec.recordEvaluation,
      recordOutcome: rec.recordOutcome,
    };
    assert.equal(gradeOperatorRankingOnResolution('anything', true, deps), null);
    assert.equal(gradeOperatorRankingOnResolution(undefined, true, deps), null);
    assert.equal(rec.evaluations.length, 0, 'nothing recorded');
  });
});

// ── 7. Drift watch ────────────────────────────────────────────────────────────

describe('runCognitionDriftWatch', () => {
  function gradedRecord(algorithmId: string, at: number, outcome: EvaluationOutcome): EvaluationRecord {
    return {
      id: `${algorithmId}-${at}`,
      algorithmId,
      domain: 'forecast_calibration',
      at,
      durationMs: 0,
      outcome,
      outcomeAt: at,
      outcomeReason: 'fixture',
    };
  }

  it('returns a status per cognition algorithm and alerts on sustained degradation', () => {
    // 5 one-second buckets ending at t=10000: hits early, misses late.
    // buildF1Buckets windows are lower-bounded (each bucket sees records
    // from its cutoff onward), giving the series [0.75, 0.667, 0.5, 0, 0]
    // with rolling threshold ≈0.479 → Page-Hinkley statistic ≈0.958 > λ=0.5
    // → sustained-degradation alert.
    const superforecastRecords = [
      gradedRecord('superforecast', 5_500, 'hit'),
      gradedRecord('superforecast', 6_500, 'hit'),
      gradedRecord('superforecast', 7_500, 'hit'),
      gradedRecord('superforecast', 8_500, 'miss'),
      gradedRecord('superforecast', 9_500, 'miss'),
    ];
    const alerts: string[] = [];
    const statuses = runCognitionDriftWatch({
      ledger: {
        byAlgorithm: (id: string) => (id === 'superforecast' ? superforecastRecords : []),
      },
      options: { lambda: 0.5, bucketMs: 1_000, windowBuckets: 5, now: () => 10_000 },
      onAlert: (a) => alerts.push(a.algorithmId),
    });
    assert.equal(statuses.length, COGNITION_ALGORITHM_IDS.length);
    const sf = statuses.find((s) => s.algorithmId === 'superforecast');
    assert.ok(sf!.alerting, 'superforecast drift detected');
    assert.deepEqual(alerts, ['superforecast'], 'only the degraded algorithm alerts');
    const others = statuses.filter((s) => s.algorithmId !== 'superforecast');
    assert.ok(others.every((s) => !s.alerting), 'ungraded algorithms do not alert');
  });
});

// ── 8. Cadence gate ───────────────────────────────────────────────────────────

describe('shouldRunSelfTuning', () => {
  it('runs when never run, waits inside the interval, runs after it', () => {
    assert.equal(shouldRunSelfTuning(null, 0), true);
    assert.equal(shouldRunSelfTuning(1_000, 1_000 + SELF_TUNING_INTERVAL_MS - 1), false);
    assert.equal(shouldRunSelfTuning(1_000, 1_000 + SELF_TUNING_INTERVAL_MS), true);
  });
});
