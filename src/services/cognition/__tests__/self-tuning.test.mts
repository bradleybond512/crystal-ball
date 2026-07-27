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
 *   5. The deterministic grading pass (recalibration, superforecast,
 *      entity-trajectory) with success-only watermark advancement.
 *   6. Resolution-time grading from EMIT-TIME stamped values
 *      (episodic-analog + operator-ranking).
 *   7. The drift watch under its PRODUCTION options (reachable λ,
 *      count-based buckets immune to sparse grading) + alert dedupe.
 *   8. A suite-less cognition knob lands held_for_approval end-to-end
 *      through runTuningApply (operator approves; nothing self-applies).
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
import { createAlgorithmEvaluationLedger } from '../../algorithms/algorithm-evaluation-ledger.js';
import { runTuningApply } from '../../algorithms/tuning-apply-runner.js';
import type { AlgorithmDefinition } from '../../algorithms/algorithm-health.js';
import type { AlgorithmAdjustmentTuning } from '../../algorithms/safe-adjustment.js';

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
  gradeEpisodicAnalogOnResolution,
  gradeOperatorRankingOnResolution,
  runCognitionDriftWatch,
  shouldRunSelfTuning,
  SELF_TUNING_INTERVAL_MS,
  DRIFT_MIN_GRADED,
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
    // Resolution-graded algorithms are named in the map with count 0.
    assert.equal(result.graded['episodic-analog'], 0);
    assert.equal(result.graded['operator-ranking'], 0);
    const recal = rec.evaluations.find((e) => e.algorithmId === 'recalibration');
    const sf = rec.evaluations.find((e) => e.algorithmId === 'superforecast');
    assert.ok(Math.abs(recal!.score! - 0.4) < 1e-9, 'recalibrated probability recorded');
    assert.ok(Math.abs(sf!.score! - 0.7) < 1e-9, 'raw superforecast probability recorded');
    const outcomeByIdx = new Map(rec.outcomes.map((o) => [o.recordId, o.outcome]));
    assert.equal(outcomeByIdx.get('r-1'), 'miss');
    assert.equal(outcomeByIdx.get('r-2'), 'hit');
  });

  it('does not double-grade across passes (calibration watermark)', () => {
    const rec = makeRecorder();
    const storage = makeStorage();
    const deps = {
      calibrationRecords: [makePrediction({ id: 'p1', probability: 0.8, status: 'resolved_true' as const, resolvedAt: 100 })],
      recalibratorFor: () => (p: number) => ({ p }),
      dossiers: [],
      recordEvaluation: rec.recordEvaluation,
      recordOutcome: rec.recordOutcome,
      storage,
      now: () => 1_000_000,
    };
    assert.equal(runCognitionGradingPass(deps).graded['recalibration'], 1);
    assert.equal(runCognitionGradingPass(deps).graded['recalibration'], 0, 'second pass grades nothing');
    assert.equal(rec.evaluations.length, 1);
  });

  it('leaves exact target/version forecasts to authoritative grading', () => {
    const rec = makeRecorder();
    const result = runCognitionGradingPass({
      calibrationRecords: [makePrediction({
        id: 'structured',
        targetKey: 'hypothesis:structured',
        algorithmVersion: '2.0.0',
        status: 'resolved_true',
        resolvedAt: 100,
      })],
      recalibratorFor: () => (p: number) => ({ p }),
      dossiers: [],
      recordEvaluation: rec.recordEvaluation,
      recordOutcome: rec.recordOutcome,
      storage: makeStorage(),
      now: () => 1_000_000,
    });

    assert.equal(result.graded['recalibration'], 0);
    assert.equal(result.graded['superforecast'], 0);
    assert.equal(rec.evaluations.length, 0);
  });

  it('retries failed grades: the watermark only advances past recorded samples', () => {
    const storage = makeStorage();
    const records = [makePrediction({ id: 'p1', probability: 0.8, status: 'resolved_true' as const, resolvedAt: 100 })];
    // First pass: the ledger throws → nothing recorded, watermark must NOT advance.
    const failing = runCognitionGradingPass({
      calibrationRecords: records,
      recalibratorFor: () => (p: number) => ({ p }),
      dossiers: [],
      recordEvaluation: () => { throw new Error('ledger unavailable'); },
      recordOutcome: () => { /* unreachable */ },
      storage,
      now: () => 1_000_000,
    });
    assert.equal(failing.graded['recalibration'], 0);
    // Second pass with a working ledger: the same record is graded now.
    const rec = makeRecorder();
    const retried = runCognitionGradingPass({
      calibrationRecords: records,
      recalibratorFor: () => (p: number) => ({ p }),
      dossiers: [],
      recordEvaluation: rec.recordEvaluation,
      recordOutcome: rec.recordOutcome,
      storage,
      now: () => 1_000_000,
    });
    assert.equal(retried.graded['recalibration'], 1, 'failed grade retried on the next pass');
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

// ── 6. Resolution-time grading from emit-time stamped values ──────────────────

describe('gradeEpisodicAnalogOnResolution', () => {
  it('grades the stamped emit-time analog against the resolution', () => {
    const rec = makeRecorder();
    const deps = {
      recordEvaluation: rec.recordEvaluation,
      recordOutcome: rec.recordOutcome,
      now: () => 42,
    };
    // Elevated analog (0.8) + hypothesis panned out → hit.
    assert.equal(gradeEpisodicAnalogOnResolution(0.8, true, deps), 'hit');
    // Elevated analog + fizzle → miss.
    assert.equal(gradeEpisodicAnalogOnResolution(0.8, false, deps), 'miss');
    // Quiet analog (0.2) + fizzle → hit (the quiet read was right).
    assert.equal(gradeEpisodicAnalogOnResolution(0.2, false, deps), 'hit');
    assert.equal(rec.evaluations.length, 3);
    assert.ok(rec.evaluations.every((e) => e.algorithmId === 'episodic-analog'));
    assert.equal(rec.evaluations[0]!.label, 'analog-elevated');
    assert.equal(rec.evaluations[2]!.label, 'analog-quiet');
    assert.ok(rec.outcomes[0]!.reason.includes('emit-time analog score 0.80'));
  });

  it('unstamped legacy pendings (null/undefined analog) are skipped', () => {
    const rec = makeRecorder();
    const deps = { recordEvaluation: rec.recordEvaluation, recordOutcome: rec.recordOutcome };
    assert.equal(gradeEpisodicAnalogOnResolution(null, true, deps), null);
    assert.equal(gradeEpisodicAnalogOnResolution(undefined, true, deps), null);
    assert.equal(gradeEpisodicAnalogOnResolution(Number.NaN, true, deps), null);
    assert.equal(rec.evaluations.length, 0, 'nothing recorded');
  });
});

describe('gradeOperatorRankingOnResolution', () => {
  it('stamped boost on a hypothesis that panned out is a hit; on a fizzle, a miss', () => {
    const rec = makeRecorder();
    const deps = {
      recordEvaluation: rec.recordEvaluation,
      recordOutcome: rec.recordOutcome,
      now: () => 42,
    };
    assert.equal(gradeOperatorRankingOnResolution(1.15, true, deps), 'hit');
    assert.equal(gradeOperatorRankingOnResolution(1.15, false, deps), 'miss');
    assert.equal(rec.evaluations.length, 2);
    assert.ok(rec.evaluations.every((e) => e.algorithmId === 'operator-ranking'));
    assert.equal(rec.evaluations[0]!.label, 'boosted');
    assert.ok(rec.outcomes[0]!.reason.includes('at emit time'));
  });

  it('stamped demotion on a fizzle is a hit', () => {
    const rec = makeRecorder();
    const outcome = gradeOperatorRankingOnResolution(0.85, false, {
      recordEvaluation: rec.recordEvaluation,
      recordOutcome: rec.recordOutcome,
    });
    assert.equal(outcome, 'hit');
    assert.equal(rec.evaluations[0]!.label, 'demoted');
  });

  it('neutral multipliers and unstamped legacy pendings carry no signal', () => {
    const rec = makeRecorder();
    const deps = { recordEvaluation: rec.recordEvaluation, recordOutcome: rec.recordOutcome };
    assert.equal(gradeOperatorRankingOnResolution(1.0, true, deps), null);
    assert.equal(gradeOperatorRankingOnResolution(1.01, true, deps), null, 'inside the ±2% neutral band');
    assert.equal(gradeOperatorRankingOnResolution(undefined, true, deps), null);
    assert.equal(rec.evaluations.length, 0, 'nothing recorded');
  });
});

// ── 7. Drift watch (PRODUCTION options) ───────────────────────────────────────

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

  const HOUR = 60 * 60 * 1000;

  /** 35 hits then 25 consecutive misses, one grade per hour — ≈5 fully
   *  degraded count-buckets, which must trip the production λ. */
  function degradedStream(algorithmId: string): EvaluationRecord[] {
    const out: EvaluationRecord[] = [];
    for (let i = 0; i < 60; i += 1) {
      out.push(gradedRecord(algorithmId, (i + 1) * HOUR, i < 35 ? 'hit' : 'miss'));
    }
    return out;
  }

  it('alerts on sustained degradation with the PRODUCTION options (reachable λ)', () => {
    const alerts: string[] = [];
    // No `options` injected — this pins that the real defaults alert.
    const statuses = runCognitionDriftWatch({
      ledger: {
        byAlgorithm: (id: string) => (id === 'superforecast' ? degradedStream('superforecast') : []),
      },
      storage: makeStorage(),
      now: () => 100 * HOUR,
      onAlert: (a) => alerts.push(a.algorithmId),
    });
    assert.equal(statuses.length, COGNITION_ALGORITHM_IDS.length);
    const sf = statuses.find((s) => s.algorithmId === 'superforecast');
    assert.ok(sf!.alerting, 'sustained degradation alerts under production defaults');
    assert.deepEqual(alerts, ['superforecast'], 'only the degraded algorithm alerts');
    const others = statuses.filter((s) => s.algorithmId !== 'superforecast');
    assert.ok(others.every((s) => !s.alerting), 'thin-data algorithms do not alert');
  });

  it('sparse-but-healthy grading does NOT alert (count-based buckets)', () => {
    // 25 hits spread one per 3.5 days over ~3 months — calendar-time
    // bucketing would read the gaps as F1=0 degradation; the count-based
    // compaction must not.
    const DAY = 24 * HOUR;
    const sparseHits = Array.from({ length: 25 }, (_, i) =>
      gradedRecord('recalibration', (i + 1) * 3.5 * DAY, 'hit'));
    const alerts: string[] = [];
    const statuses = runCognitionDriftWatch({
      ledger: { byAlgorithm: (id: string) => (id === 'recalibration' ? sparseHits : []) },
      storage: makeStorage(),
      now: () => 100 * DAY,
      onAlert: (a) => alerts.push(a.algorithmId),
    });
    assert.ok(statuses.every((s) => !s.alerting), 'no algorithm alerts');
    assert.deepEqual(alerts, []);
  });

  it('below DRIFT_MIN_GRADED records the algorithm reports a non-alerting status', () => {
    // Even an all-miss stream is too thin to trust below the floor.
    const fewMisses = Array.from({ length: DRIFT_MIN_GRADED - 1 }, (_, i) =>
      gradedRecord('superforecast', (i + 1) * HOUR, 'miss'));
    const statuses = runCognitionDriftWatch({
      ledger: { byAlgorithm: (id: string) => (id === 'superforecast' ? fewMisses : []) },
      storage: makeStorage(),
      now: () => 100 * HOUR,
      onAlert: () => { assert.fail('must not alert on thin data'); },
    });
    const sf = statuses.find((s) => s.algorithmId === 'superforecast');
    assert.equal(sf!.alerting, false);
  });

  it('dedupes: a persistent degradation alerts once, and recovery re-arms', () => {
    const storage = makeStorage();
    const alerts: string[] = [];
    const degradedLedger = {
      byAlgorithm: (id: string) => (id === 'superforecast' ? degradedStream('superforecast') : []),
    };
    const deps = {
      ledger: degradedLedger,
      storage,
      now: () => 100 * HOUR,
      onAlert: (a: { algorithmId: string }) => alerts.push(a.algorithmId),
    };
    runCognitionDriftWatch(deps);
    assert.deepEqual(alerts, ['superforecast'], 'first pass alerts');
    runCognitionDriftWatch(deps);
    runCognitionDriftWatch(deps);
    assert.deepEqual(alerts, ['superforecast'], 'still-degraded passes do not re-alert');
    // Recovery: a healthy stream clears the dedupe flag…
    const healthy = Array.from({ length: 60 }, (_, i) =>
      gradedRecord('superforecast', (i + 1) * HOUR, 'hit'));
    runCognitionDriftWatch({ ...deps, ledger: { byAlgorithm: (id: string) => (id === 'superforecast' ? healthy : []) } });
    // …so a later degradation alerts again.
    runCognitionDriftWatch(deps);
    assert.deepEqual(alerts, ['superforecast', 'superforecast'], 'post-recovery degradation re-alerts');
  });
});

// ── 8. Suite-less knob is held for operator approval ──────────────────────────

describe('safe-adjustment loop on a suite-less cognition knob', () => {
  let uninstall: () => void;
  beforeEach(() => { uninstall = installLocalStorage(); });
  afterEach(() => { uninstall(); });

  it('episodic-analog:analogBlendK lands held_for_approval through runTuningApply', () => {
    // Degraded health: 20 graded, 17 hits / 3 misses → weightedHitRate 0.85
    // under a 0.9 floor.
    const ledger = createAlgorithmEvaluationLedger({ now: () => 1 });
    for (let i = 0; i < 20; i += 1) {
      const rec = ledger.recordEvaluation({
        algorithmId: 'episodic-analog',
        domain: 'reasoning_hypothesis',
        at: i,
        durationMs: 1,
      });
      ledger.recordOutcome(rec.id, i < 17 ? 'hit' : 'miss', 'test', i);
    }
    const def: AlgorithmDefinition = {
      algorithmId: 'episodic-analog',
      label: 'Episodic analog scoring',
      domain: 'reasoning_hypothesis',
      criticality: 'medium',
      minWeightedHitRate: 0.9,
      minGradedSamples: 20,
    };
    // Only the suite-less knob is offered (parameters[0] is what the engine
    // proposes), so the proposal must fail closed on safety + backtest and
    // be held for the operator — never auto-applied.
    const tuning: AlgorithmAdjustmentTuning = {
      algorithmId: 'episodic-analog',
      parameters: [{
        parameterId: 'analogBlendK',
        current: 5,
        min: 3,
        max: 10,
        step: 1,
        fixDirection: 'increase',
        description: 'episodic blend pseudo-count',
      }],
    };
    const applied: unknown[] = [];
    const result = runTuningApply({
      ledger,
      definitions: [def],
      tunings: [tuning],
      apply: (...args) => applied.push(args),
      now: () => 1_000,
    });
    assert.equal(result.proposed, 1, 'a bounded proposal was generated');
    assert.equal(result.applied, 0, 'nothing self-applies');
    assert.equal(result.heldForApproval, 1, 'held for operator approval');
    assert.equal(applied.length, 0);
  });
});

// ── 9. Cadence gate ───────────────────────────────────────────────────────────

describe('shouldRunSelfTuning', () => {
  it('runs when never run, waits inside the interval, runs after it', () => {
    assert.equal(shouldRunSelfTuning(null, 0), true);
    assert.equal(shouldRunSelfTuning(1_000, 1_000 + SELF_TUNING_INTERVAL_MS - 1), false);
    assert.equal(shouldRunSelfTuning(1_000, 1_000 + SELF_TUNING_INTERVAL_MS), true);
  });
});
