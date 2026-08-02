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

import {
  runCorrelationBenchmark, gradeEnginePairs, enginePairPrecision,
} from '../bench-correlation.ts';
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

  it('digests the corpus at 128 bits, not at a brute-forceable width', () => {
    // A 32-bit digest was preimaged in seconds during review: a 7-character
    // replacement for a decoy id reproduced the committed hash exactly, so the
    // corpus could be made easier without invalidating the baseline.
    const digest = runCorrelationBenchmark().corpusDigest;
    assert.match(digest, /^[0-9a-f]{32}$/, `corpus digest ${digest} is not 128 bits of hex`);
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

  it('does not double-count one event pair matched by two rules', () => {
    // The live corpus emits exactly one pair per distinct key, so it cannot
    // tell the two denominators apart. This drives the grader directly with a
    // pair matched twice: distinct must stay 1 while the raw count reaches 2.
    const key = [...plantedTruePairKeys()][0]!;
    const [a, b] = key.split('::') as [string, string];
    const twice = ['rule-one', 'rule-two'].map((ruleId) => ({
      ruleId,
      eventA: { id: a },
      eventB: { id: b },
      confidence: 0.5,
    })) as unknown as Parameters<typeof gradeEnginePairs>[0];

    const graded = gradeEnginePairs(twice, plantedTruePairKeys(), decoyEventIds());
    assert.equal(graded.pairCount, 2, 'both emissions should be counted raw');
    assert.equal(graded.distinctPairCount, 1, 'one event pair, matched twice');
    // Precision on the distinct denominator is 1/1; on the raw one it would be
    // 1/2 — a phantom 50% regression for recognising a true pair twice.
    assert.equal(graded.emittedTrueKeys.size / graded.distinctPairCount, 1);
  });

  it('computes pair precision through the production denominator selection', () => {
    // The live corpus emits 22 raw / 22 distinct, so an end-to-end assertion
    // cannot tell the two denominators apart — reverting the report assembly to
    // `graded.pairCount` would leave every other test green. This drives the
    // exported function the assembly actually calls, on a graded set where the
    // counts differ.
    const graded = {
      pairCount: 4,
      distinctPairCount: 2,
      emittedTrueKeys: new Set(['a::b']),
      truePairConfidences: [0.5],
      falsePairConfidences: [0.4],
      decoyPairsEmitted: 0,
    };
    assert.equal(enginePairPrecision(graded), 0.5, 'precision must divide by distinct pairs');
    assert.notEqual(
      enginePairPrecision(graded),
      graded.emittedTrueKeys.size / graded.pairCount,
      'the raw-emission denominator must not be what production uses',
    );
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
    assert.equal(baseline.schemaVersion, 4);
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
      causalLearnedRulePairCount: 0,
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
      // The ledger has to grow with the summary or the consistency check fires
      // first and this test stops proving anything about the growth gate.
      edges: [...report.edges, ...report.edges.slice(0, 2)],
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
      learnedRuleCount: report.plantedCausalCount,
      causalLearnedRuleCount: report.plantedCausalCount,
      edges: report.edges.filter((e) => e.verdict === 'causal'),
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

  it('fails closed when a gated metric is missing outright, not just null', () => {
    // `null` separation is a legitimate perfect-miner state; a MISSING field is
    // a report that never measured it. `?? 0` cannot tell them apart.
    const { edgeEvidenceSeparation: _gone, ...partial } = report;
    const { ok, reasons } = compareCorrelationBenchToBaseline(
      partial as typeof report, baseline,
    );
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('separation: live value is not a finite')));
  });

  it('rejects a perfect-miner claim its own breakdown contradicts', () => {
    // Zeroing only the summary field buys the separation exemption while the
    // per-kind counts still report 17 false edges.
    const lying = { ...report, falseEdgeCount: 0, edgeEvidenceSeparation: null };
    const { ok, reasons } = compareCorrelationBenchToBaseline(lying, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('internally inconsistent')));
    assert.ok(reasons.some((r) => r.includes('breakdown sums to')));
  });

  it('fails when learned rules are synthesized but never fire', () => {
    // Volume shrinking is a GOAL, so no shrink tolerance catches this: the
    // rules still exist, the install/match path is simply dead.
    const dark = { ...report, learnedRulePairCount: 0, causalLearnedRulePairCount: 0 };
    const { ok, reasons } = compareCorrelationBenchToBaseline(dark, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('causal learned rules went quiet')));
  });

  it('fails closed on a non-numeric tolerance instead of disarming its gate', () => {
    // A string tolerance makes `delta > tol` NaN-false, which passes every
    // directional check on the gate it was supposed to tighten.
    const sabotaged = {
      ...baseline,
      tolerances: { ...baseline.tolerances, couplingRecallDrop: 'garbage' },
    } as unknown as CorrelationBenchBaseline;
    const { ok, reasons } = compareCorrelationBenchToBaseline(report, sabotaged);
    assert.equal(ok, false);
    assert.equal(reasons.length, 1, 'tolerance validation must short-circuit');
    assert.match(reasons[0]!, /tolerance "couplingRecallDrop" is not a finite/);
  });

  it('rejects an unknown tolerance key rather than ignoring it', () => {
    const stale = {
      ...baseline,
      tolerances: { ...baseline.tolerances, pairPrecisionTolerance: 0.5 },
    } as unknown as CorrelationBenchBaseline;
    const { ok, reasons } = compareCorrelationBenchToBaseline(report, stale);
    assert.equal(ok, false);
    assert.match(reasons[0]!, /not a known gate/);
  });

  it('rejects an inherited-property tolerance key, which `in` would have accepted', () => {
    // `'constructor' in tol` is true via the prototype chain, so a membership
    // test written with `in` would wave this through as a known gate.
    const polluted = {
      ...baseline,
      tolerances: { ...baseline.tolerances, constructor: 0.5, toString: 1 },
    } as unknown as CorrelationBenchBaseline;
    const { ok, reasons } = compareCorrelationBenchToBaseline(report, polluted);
    assert.equal(ok, false);
    assert.equal(reasons.length, 2, 'both inherited keys should be rejected');
    for (const reason of reasons) assert.match(reason, /not a known gate/);
  });

  it('fails when the causal rules go nearly quiet, not just exactly silent', () => {
    // 19 -> 1 is the same broken install/match path as 19 -> 0, with one
    // survivor. An exactly-zero liveness check waves it straight through.
    const nearlyDark = { ...report, causalLearnedRulePairCount: 1 };
    const { ok, reasons } = compareCorrelationBenchToBaseline(nearlyDark, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('causal learned rules went quiet')));
  });

  it('rejects a perfect-miner claim that zeroes the breakdown too', () => {
    // Zeroing the summary AND all five breakdown fields makes the report agree
    // with itself, so only the row-level ledger still knows the truth.
    const coordinated = {
      ...report,
      falseEdgeCount: 0,
      confoundedFalsePositives: 0,
      mediatedFalsePositives: 0,
      independentFalsePositives: 0,
      inhibitoryEdgesReported: 0,
      unplantedFalsePositives: 0,
      edgeEvidenceSeparation: null,
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(coordinated, baseline);
    assert.equal(ok, false);
    assert.ok(
      reasons.some((r) => r.includes('non-causal verdict')),
      `expected an edge-ledger reason, got ${JSON.stringify(reasons)}`,
    );
  });

  it('rejects a coupling precision its own edge counts contradict', () => {
    const inflated = { ...report, couplingPrecision: 0.9 };
    const { ok, reasons } = compareCorrelationBenchToBaseline(inflated, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('couplingPrecision=0.9')));
  });

  it('rejects perfect pair rates emitted over zero pairs', () => {
    // precision 1.0 / recall 1.0 with nothing behind them is a flawless pass
    // over a measurement that never happened.
    const hollow = { ...report, enginePairCount: 0, distinctEnginePairCount: 0 };
    const { ok, reasons } = compareCorrelationBenchToBaseline(hollow, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('zero distinct')));
  });

  it('fails when built-in pair emissions shrink at all', () => {
    // Deterministic corpus: a built-in rule that stops matching is a defect,
    // and the ratio gates cannot see it because they divide by the new total.
    const fewer = {
      ...report,
      enginePairCount: report.enginePairCount - 4,
      distinctEnginePairCount: report.distinctEnginePairCount - 4,
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(fewer, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('distinct built-in pair emissions regressed')));
  });

  it('rejects impossible metric values instead of scoring them as improvements', () => {
    // Every one of these is finite, and every directional check reads it as
    // better than the baseline.
    const impossible = {
      ...report, pairPrecision: 2, pairRecall: 2, meanTruePairConfidence: 2,
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(impossible, baseline);
    assert.equal(ok, false);
    assert.equal(reasons.length, 3, `expected one reason per rate, got ${reasons.length}`);
    for (const reason of reasons) assert.match(reason, /outside \[0,1\]/);
  });

  it('rejects a fractional count', () => {
    const fractional = { ...report, falseEdgeCount: 16.5 };
    const { ok, reasons } = compareCorrelationBenchToBaseline(fractional, baseline);
    assert.equal(ok, false);
    assert.match(reasons[0]!, /not a non-negative integer count/);
  });

  it('rejects a baseline that seeds a gate at zero', () => {
    // A zero seed does not fail the run — it permanently disarms the gate it
    // feeds, which is worse, because the gate keeps reporting PASS.
    const disarmed = { ...baseline, causalLearnedRulePairCount: 0 };
    const { ok, reasons } = compareCorrelationBenchToBaseline(report, disarmed);
    assert.equal(ok, false);
    assert.match(reasons[0]!, /permanently disarms the gate it feeds/);
  });

  it('rejects a tolerance block that is not an object', () => {
    for (const bad of [null, 3, 'none', []]) {
      const sabotaged = { ...baseline, tolerances: bad } as unknown as CorrelationBenchBaseline;
      const { ok, reasons } = compareCorrelationBenchToBaseline(report, sabotaged);
      assert.equal(ok, false, `tolerances=${JSON.stringify(bad)} should be rejected`);
      assert.match(reasons[0]!, /is not an object|is missing gate/);
    }
  });

  it('rejects a tolerance block missing a gate rather than defaulting it', () => {
    const { causalLearnedRulePairShrinkRatio: _gone, ...partial } = baseline.tolerances;
    const stale = { ...baseline, tolerances: partial } as unknown as CorrelationBenchBaseline;
    const { ok, reasons } = compareCorrelationBenchToBaseline(report, stale);
    assert.equal(ok, false);
    assert.match(reasons[0]!, /missing gate "causalLearnedRulePairShrinkRatio"/);
  });

  it('accumulates every independent regression rather than short-circuiting', () => {
    const strict: CorrelationBenchBaseline = {
      ...baseline,
      couplingPrecision: 1,
      meanTruePairConfidence: 0.99,
      learnedRuleFalsePositives: 0,
    };
    const { reasons } = compareCorrelationBenchToBaseline(report, strict);
    assert.ok(reasons.length >= 3, `expected several reasons, got ${reasons.length}`);
  });
});
