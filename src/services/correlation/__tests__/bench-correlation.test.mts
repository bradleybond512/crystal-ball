/**
 * ACC-501 — frozen correlation benchmark.
 *
 * Two things are under test here and they are not the same thing:
 *
 *   1. the CORPUS is what it claims to be (the base-rate trap really traps,
 *      the decoys really miss, the confounder really confounds), and
 *   2. the GATE really gates (one-sided tolerances, exact corpus identity).
 *
 * A benchmark whose fixtures quietly stop stressing the thing they were built
 * to stress is worse than no benchmark, so (1) is asserted structurally rather
 * than by pinning the numbers the seed run happened to produce.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCorrelationBenchmark } from '../bench-correlation.ts';
import {
  compareCorrelationBenchToBaseline,
  DEFAULT_CORRELATION_BENCH_TOLERANCES,
  type CorrelationBenchBaseline,
} from '../bench-correlation-baseline.ts';
import {
  GOLDEN_STREAMS,
  PLANTED_COUPLINGS,
  allGoldenObservations,
  decoyEventIds,
  pairKeyFor,
  plantedTruePairKeys,
} from '../__bench__/golden-streams.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = path.join(here, '..', '__bench__', 'bench-correlation-baseline.json');

function loadBaseline(): CorrelationBenchBaseline {
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as CorrelationBenchBaseline;
}

describe('golden-streams corpus integrity', () => {
  it('is deterministic across runs', () => {
    const a = runCorrelationBenchmark();
    const b = runCorrelationBenchmark();
    assert.deepEqual(a, b);
  });

  it('emits observations in a stable total order with unique ids', () => {
    const obs = allGoldenObservations();
    const ids = new Set(obs.map((o) => o.id));
    assert.equal(ids.size, obs.length, 'duplicate observation id in the corpus');
    for (let i = 1; i < obs.length; i++) {
      assert.ok(
        obs[i - 1]!.timestamp <= obs[i]!.timestamp,
        `corpus not time-sorted at index ${i}`,
      );
    }
  });

  it('never plants a true pair on a decoy event', () => {
    const decoys = decoyEventIds();
    assert.ok(decoys.size > 0, 'the decoy stream vanished');
    for (const key of plantedTruePairKeys()) {
      for (const id of key.split('::')) {
        assert.ok(!decoys.has(id), `decoy ${id} appears in planted true pair ${key}`);
      }
    }
  });

  it('uses a pair key that survives the correlation-outcomes id split', () => {
    // correlation-outcomes.ts splits prediction ids on `|`; a `|`-separated
    // pair key would be silently torn in half downstream.
    assert.ok(!pairKeyFor('a', 'b').includes('|'));
    assert.equal(pairKeyFor('b', 'a'), pairKeyFor('a', 'b'), 'pair key is not direction-free');
  });
});

describe('what the corpus is built to stress', () => {
  const report = runCorrelationBenchmark();

  it('recovers every planted causal coupling', () => {
    assert.deepEqual(report.missingCouplings, []);
    assert.equal(report.couplingRecall, 1);
  });

  it('resists the base-rate trap (chatty independent stream)', () => {
    // S6 fires a newswire event every 3h for 30 days. Naive follow-counting
    // sees a perfect coupling; Poisson normalization must not.
    assert.equal(
      report.independentFalsePositives, 0,
      'a planted-independent pair became significant — the base-rate normalization broke',
    );
  });

  it('still exposes the confounded burst pair in both directions', () => {
    // Load-bearing for ACC-504: if this drops to 0 without ACC-504 landing,
    // the fixture stopped confounding rather than the miner getting smarter.
    assert.equal(report.confoundedFalsePositives, 2);
  });

  it('still exposes the transitive mediated edge', () => {
    // Load-bearing for ACC-503 in exactly the same way.
    assert.equal(report.mediatedFalsePositives, 1);
  });

  it('reports no positive edge on the inhibitory pair', () => {
    // A lift-only miner cannot see suppression at all. ACC-502 adds the
    // negative-edge channel; until then this must stay 0, and it must never
    // become a POSITIVE edge, which would be actively wrong.
    assert.equal(report.inhibitoryEdgesReported, 0);
  });

  it('leaks zero near-miss decoy pairs', () => {
    assert.equal(report.decoyPairsEmitted, 0);
  });

  it('grades every significant edge against planted truth', () => {
    const graded = report.confoundedFalsePositives + report.mediatedFalsePositives
      + report.independentFalsePositives + report.inhibitoryEdgesReported
      + report.unplantedFalsePositives;
    const causal = Math.round(report.couplingPrecision * report.significantEdgeCount);
    assert.equal(graded + causal, report.significantEdgeCount, 'an edge escaped grading');
  });

  it('separates real couplings from noise on evidence, not on strength', () => {
    // `strength` is a bounded blend that saturates at 1.0, so it barely
    // discriminates; the z-score does. This asymmetry is the documented
    // reason two real couplings lost their learned-rule slot.
    // A null separation would mean zero false edges — a perfect miner, and a
    // legitimate future state — so it is not asserted away here; it is simply
    // not the state this rationale is about.
    if (report.edgeEvidenceSeparation === null) {
      assert.equal(report.falseEdgeCount, 0, 'separation is null but false edges exist');
      return;
    }
    assert.ok(
      report.edgeEvidenceSeparation > report.edgeStrengthSeparation!,
      'strength unexpectedly out-separates evidence — re-derive the cap rationale',
    );
  });

  it('counts every non-causal significant edge as a false edge', () => {
    const named = report.confoundedFalsePositives + report.mediatedFalsePositives
      + report.independentFalsePositives + report.inhibitoryEdgesReported
      + report.unplantedFalsePositives;
    assert.equal(report.falseEdgeCount, named);
  });

  it('measures pair precision on distinct pairs, not on raw emissions', () => {
    assert.ok(report.distinctEnginePairCount <= report.enginePairCount);
    assert.ok(report.distinctEnginePairCount > 0);
  });

  it('scores true pairs with a real confidence, not a placeholder', () => {
    assert.ok(
      report.meanTruePairConfidence > 0 && report.meanTruePairConfidence <= 1,
      `mean true-pair confidence ${report.meanTruePairConfidence} is not a live score`,
    );
  });
});

describe('planted-coupling bookkeeping', () => {
  it('declares at least one coupling of every kind the grader can emit', () => {
    const kinds = new Set(PLANTED_COUPLINGS.map((c) => c.kind));
    for (const kind of ['causal', 'independent', 'confounded', 'mediated', 'inhibitory']) {
      assert.ok(kinds.has(kind as never), `no planted coupling of kind ${kind}`);
    }
  });

  it('gives every planted coupling a rationale and a unique direction', () => {
    const seen = new Set<string>();
    for (const c of PLANTED_COUPLINGS) {
      assert.ok(c.rationale.length > 0, `${c.from}->${c.to} has no rationale`);
      const key = `${c.from}->${c.to}`;
      assert.ok(!seen.has(key), `duplicate planted coupling ${key}`);
      seen.add(key);
    }
  });

  it('describes every golden stream', () => {
    assert.ok(GOLDEN_STREAMS.length >= 8, 'the corpus shrank below the planned stream count');
    for (const s of GOLDEN_STREAMS) {
      assert.ok(s.description.length > 0, `stream ${s.id} has no description`);
      assert.ok(s.observations.length > 0, `stream ${s.id} is empty`);
    }
  });
});

describe('the committed baseline', () => {
  it('passes against a live run', () => {
    const { ok, reasons } = compareCorrelationBenchToBaseline(
      runCorrelationBenchmark(), loadBaseline(),
    );
    assert.deepEqual(reasons, []);
    assert.equal(ok, true);
  });

  it('carries its own tolerance block', () => {
    const baseline = loadBaseline();
    assert.equal(baseline.schemaVersion, 2);
    for (const key of Object.keys(DEFAULT_CORRELATION_BENCH_TOLERANCES)) {
      assert.ok(
        key in baseline.tolerances,
        `baseline tolerances missing ${key} — it would silently fall back to the module default`,
      );
    }
  });

  it('records why the numbers look the way they do', () => {
    assert.ok(loadBaseline().note.length > 100, 'baseline note is not a real explanation');
  });
});

describe('the gate', () => {
  const report = runCorrelationBenchmark();
  const baseline = loadBaseline();

  it('fails closed on corpus drift and reports nothing else', () => {
    const drifted = { ...baseline, observationCount: baseline.observationCount + 1 };
    const { ok, reasons } = compareCorrelationBenchToBaseline(report, drifted);
    assert.equal(ok, false);
    assert.equal(reasons.length, 1, 'metric noise leaked past a corpus-identity failure');
    assert.match(reasons[0]!, /observation count changed/);
    assert.match(reasons[0]!, /reviewed diff/);
  });

  it('fails on a coupling-precision regression past tolerance', () => {
    const strict = { ...baseline, couplingPrecision: report.couplingPrecision + 0.5 };
    const { ok, reasons } = compareCorrelationBenchToBaseline(report, strict);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('miner coupling precision regressed')));
  });

  it('passes silently on improvement — tolerances are one-sided', () => {
    const worse: CorrelationBenchBaseline = {
      ...baseline,
      couplingPrecision: 0.01,
      couplingRecall: 0.1,
      pairPrecision: 0.1,
      pairRecall: 0.1,
      edgeEvidenceSeparation: 0.1,
      learnedRuleFalsePositives: 99,
      learnedRulePairCount: 9999,
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(report, worse);
    assert.deepEqual(reasons, []);
    assert.equal(ok, true);
  });

  it('treats decoy leakage as zero-tolerance', () => {
    const leaked = { ...report, decoyPairsEmitted: 1 };
    const { ok, reasons } = compareCorrelationBenchToBaseline(leaked, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('near-miss decoy pairs emitted')));
  });

  it('fails when learned rules spray more pairs than the tolerance allows', () => {
    const noisy = {
      ...report,
      learnedRulePairCount:
        baseline.learnedRulePairCount + baseline.tolerances.learnedRulePairGrowth + 1,
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(noisy, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('learned-rule pair volume grew')));
  });

  it('fails closed when a corpus edit leaves the three counts intact', () => {
    // The whole point of the digest: an edited timestamp, domain, severity or
    // truth label changes nothing about stream/observation/coupling COUNTS, so
    // a counts-only identity check would compare incomparable numbers and call
    // the easier corpus an improvement.
    const restyled = { ...baseline, corpusDigest: 'deadbeef' };
    const { ok, reasons } = compareCorrelationBenchToBaseline(report, restyled);
    assert.equal(ok, false);
    assert.equal(reasons.length, 1);
    assert.match(reasons[0]!, /corpus content digest changed/);
  });

  it('fails closed on a NaN metric instead of passing every directional check', () => {
    // `NaN > tolerance` is false, so an unvalidated gate reports PASS on a
    // benchmark that measured nothing.
    const corrupt = { ...report, couplingPrecision: Number.NaN, pairRecall: Number.NaN };
    const { ok, reasons } = compareCorrelationBenchToBaseline(corrupt, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('miner coupling precision: live value is not a finite')));
    assert.ok(reasons.some((r) => r.includes('built-in pair recall: live value is not a finite')));
  });

  it('fails closed when the committed baseline is missing a gated field', () => {
    const { couplingRecall: _dropped, ...partial } = baseline;
    const { ok, reasons } = compareCorrelationBenchToBaseline(
      report, partial as CorrelationBenchBaseline,
    );
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('miner coupling recall: baseline value is not a finite')));
  });

  it('fails when the confidence kernel collapses under passing membership gates', () => {
    // Precision and recall stay at 1.0 — the right pairs are still emitted,
    // just scored worthlessly.
    const flat = { ...report, meanTruePairConfidence: 0 };
    const { ok, reasons } = compareCorrelationBenchToBaseline(flat, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('mean true-pair confidence regressed')));
  });

  it('fails when the learned-rule pipeline disappears entirely', () => {
    // Zero rules means zero false positives and zero blast radius: perfect on
    // every "lower is better" gate, and a dead feature.
    const dead = {
      ...report,
      learnedRuleCount: 0,
      learnedRuleFalsePositives: 0,
      causalLearnedRuleCount: 0,
      learnedRulePairCount: 0,
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(dead, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('causal learned rules regressed')));
  });

  it('fails on discrete false-edge growth the precision ratio would absorb', () => {
    // 22 → 24 significant edges moves precision 0.2273 → 0.2083, inside the
    // 0.02 tolerance. On a deterministic corpus that is still two new lies.
    const looser = {
      ...report,
      significantEdgeCount: report.significantEdgeCount + 2,
      falseEdgeCount: report.falseEdgeCount + 2,
      unplantedFalsePositives: report.unplantedFalsePositives + 2,
      couplingPrecision: 0.2083,
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(looser, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('graded false edges grew')));
  });

  it('scores a perfect miner as an improvement, not as the largest regression', () => {
    // Zero false edges makes separation undefined. Coercing that to 0 would
    // report an 8.49 regression for achieving exactly what ACC-502..504 exist
    // to achieve — the fastest way to get a gate deleted.
    const perfect = {
      ...report,
      couplingPrecision: 1,
      significantEdgeCount: report.plantedCausalCount,
      falseEdgeCount: 0,
      confoundedFalsePositives: 0,
      mediatedFalsePositives: 0,
      independentFalsePositives: 0,
      inhibitoryEdgesReported: 0,
      unplantedFalsePositives: 0,
      meanFalseEdgeZ: null,
      edgeEvidenceSeparation: null,
      learnedRuleFalsePositives: 0,
      causalLearnedRuleCount: report.plantedCausalCount,
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(perfect, baseline);
    assert.deepEqual(reasons, []);
    assert.equal(ok, true);
  });

  it('rejects a null separation that is NOT explained by zero false edges', () => {
    const broken = { ...report, edgeEvidenceSeparation: null };
    const { ok, reasons } = compareCorrelationBenchToBaseline(broken, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('separation is null while false edges exist')));
  });

  it('accumulates every independent regression rather than short-circuiting', () => {
    const strict: CorrelationBenchBaseline = {
      ...baseline,
      couplingPrecision: 1,
      pairPrecision: 1.5,
      learnedRuleFalsePositives: 0,
    };
    const { reasons } = compareCorrelationBenchToBaseline(report, strict);
    assert.ok(reasons.length >= 3, `expected several reasons, got ${reasons.length}`);
  });
});
