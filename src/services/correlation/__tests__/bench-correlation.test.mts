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
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  runCorrelationBenchmark, gradeEnginePairs, enginePairPrecision,
  type BenchLearnedPairRow,
  type BenchPairRow, type CorrelationBenchReport,
} from '../bench-correlation.ts';
import {
  compareCorrelationBenchToBaseline,
  CORRELATION_BENCH_SCHEMA_VERSION,
  DEFAULT_CORRELATION_BENCH_TOLERANCES,
  type CorrelationBenchBaseline,
} from '../bench-correlation-baseline.ts';
import {
  GOLDEN_STREAMS,
  PLANTED_COUPLINGS,
  allGoldenObservations,
  corpusDomains,
  decoyEventIds,
  digestRecords,
  pairKeyFor,
  plantedTruePairKeys,
} from '../__bench__/golden-streams.ts';
import { learnedRuleId } from '../learned-rules.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = path.join(here, '..', '__bench__', 'bench-correlation-baseline.json');

function loadBaseline(): CorrelationBenchBaseline {
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as CorrelationBenchBaseline;
}

const round4 = (v: number): number => Math.round(v * 10_000) / 10_000;

/**
 * Swaps a report's pair ledger and re-derives all six pair summaries from it.
 *
 * Every fixture below that changes a pair number has to change the rows that
 * witness it — that is the whole point of the ledger. Doing it by hand means a
 * fixture trips a reconciliation reason instead of the gate it was written to
 * prove, so the arithmetic lives here once, in the same direction the
 * production assembly computes it.
 */
function withPairLedger(
  report: CorrelationBenchReport,
  pairs: readonly BenchPairRow[],
): CorrelationBenchReport {
  const trueRows = pairs.filter((p) => p.isTruePair);
  const trueConfidences = trueRows.flatMap((p) => p.confidences);
  const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
  return {
    ...report,
    pairs: [...pairs],
    enginePairCount: sum(pairs.map((p) => p.ruleIds.length)),
    distinctEnginePairCount: pairs.length,
    pairPrecision: pairs.length === 0 ? 0 : round4(trueRows.length / pairs.length),
    pairRecall: report.truePairUniverse === 0
      ? 0
      : round4(trueRows.length / report.truePairUniverse),
    decoyPairsEmitted: sum(pairs.map((p) => p.decoyEmissions)),
    meanTruePairConfidence: trueConfidences.length === 0
      ? 0
      : round4(sum(trueConfidences) / trueConfidences.length),
  };
}

/**
 * A baseline whose miner graded `causalEdges` of its `significantEdgeCount` as
 * causal — precision and the five-way false-positive breakdown moved together,
 * because a baseline that could not have come from a run is now rejected before
 * any gate is reached.
 */
function baselineWithCausalEdges(
  baseline: CorrelationBenchBaseline,
  causalEdges: number,
  live?: CorrelationBenchReport,
): CorrelationBenchBaseline {
  const falseEdges = baseline.significantEdgeCount - causalEdges;
  // Each category is now gated for growth on its own, so a "worse everywhere"
  // baseline has to stay at or above the live count in EVERY category or it
  // reports a per-category regression the test never meant to make. Where the
  // budget allows it, the live breakdown is the floor and the surplus lands in
  // the unplanted bucket; where it does not, the whole budget is confounded.
  const floors = live && falseEdges >= live.falseEdgeCount
    ? {
      confoundedFalsePositives: live.confoundedFalsePositives,
      mediatedFalsePositives: live.mediatedFalsePositives,
      independentFalsePositives: live.independentFalsePositives,
      inhibitoryEdgesReported: live.inhibitoryEdgesReported,
      unplantedFalsePositives:
        live.unplantedFalsePositives + (falseEdges - live.falseEdgeCount),
    }
    : {
      confoundedFalsePositives: falseEdges,
      mediatedFalsePositives: 0,
      independentFalsePositives: 0,
      inhibitoryEdgesReported: 0,
      unplantedFalsePositives: 0,
    };
  return {
    ...baseline,
    couplingPrecision: round4(causalEdges / baseline.significantEdgeCount),
    falseEdgeCount: falseEdges,
    ...floors,
  };
}

/**
 * A report whose learned-pair ledger IS the four pass-B counters.
 *
 * Same reason as `withPairLedger`: the counters are derived from the rows now,
 * so a fixture that edits one without the other trips a reconciliation reason
 * instead of the gate it was written to prove. The causal roster comes from the
 * report (which derives it from the graded edge rows), so rows attributed to a
 * non-causal learned rule move the volume total only.
 */
function withLearnedPairRows(
  report: CorrelationBenchReport,
  rows: readonly BenchLearnedPairRow[],
): CorrelationBenchReport {
  const perRule = new Map<string, number>();
  for (const id of report.causalLearnedRuleIds) perRule.set(id, 0);
  let total = 0;
  for (const r of rows) {
    total += r.emissions;
    const tally = perRule.get(r.ruleId);
    if (tally !== undefined) perRule.set(r.ruleId, tally + r.emissions);
  }
  const per = [...perRule.values()].sort((a, b) => b - a);
  return {
    ...report,
    learnedPairs: [...rows],
    learnedRulePairCount: total,
    causalLearnedRulePairCount: per.reduce((a, b) => a + b, 0),
    causalLearnedRulePairsPerRule: per,
    minCausalLearnedRulePairCount: per.length === 0 ? 0 : per[per.length - 1]!,
  };
}

/**
 * Learned-pair rows carrying `count` emissions for each named rule, keyed off
 * real corpus pairs so every row-shape check (distinct endpoints, key derived
 * from those endpoints, one row per rule/pair) reconciles.
 */
function learnedRowsFor(
  report: CorrelationBenchReport,
  counts: readonly (readonly [string, number])[],
): BenchLearnedPairRow[] {
  const rows: BenchLearnedPairRow[] = [];
  let i = 0;
  for (const [ruleId, count] of counts) {
    for (let n = 0; n < count; n += 1) {
      const src = report.pairs[i % report.pairs.length]!;
      i += 1;
      rows.push({
        ruleId,
        key: src.key,
        eventIdA: src.eventIdA,
        eventIdB: src.eventIdB,
        emissions: 1,
      });
    }
  }
  return rows;
}

/**
 * Ordered domain pairs the corpus could have produced but this run did not
 * emit. Fixtures that need an extra edge row use these: an invented domain name
 * is rejected as a stray endpoint before any verdict or count check is reached.
 */
function freeDomainPairs(report: CorrelationBenchReport, n: number): [string, string][] {
  const domains = [...corpusDomains()].sort();
  const used = new Set(report.edges.map((e) => `${e.from}->${e.to}`));
  const out: [string, string][] = [];
  for (const a of domains) {
    for (const b of domains) {
      if (out.length >= n) return out;
      if (a === b || used.has(`${a}->${b}`)) continue;
      used.add(`${a}->${b}`);
      out.push([a, b]);
    }
  }
  return out;
}

describe('golden-streams corpus integrity', () => {
  it('is deterministic across runs', () => {
    const a = runCorrelationBenchmark();
    const b = runCorrelationBenchmark();
    assert.deepEqual(a, b);
  });

  it('is deterministic across a fresh module registry, not just a warm one', () => {
    // Two calls in ONE process share every module-level cache the corpus or the
    // miner holds, so they agree even if the first call is what fixed the
    // answer. CI runs the benchmark in its own process; this reproduces that.
    const child = spawnSync(
      process.execPath,
      [
        '--import', 'tsx',
        '-e',
        "import('./src/services/correlation/bench-correlation.ts')" +
        '.then((m) => console.log(JSON.stringify(m.runCorrelationBenchmark())))',
      ],
      { cwd: path.join(here, '..', '..', '..', '..'), encoding: 'utf8' },
    );
    assert.equal(child.status, 0, `cold-start benchmark failed: ${child.stderr}`);
    assert.deepEqual(
      JSON.parse(child.stdout) as CorrelationBenchReport,
      JSON.parse(JSON.stringify(runCorrelationBenchmark())) as CorrelationBenchReport,
      'the benchmark depends on process state — the baseline would drift under CI',
    );
  });

  it('keys event pairs injectively, so two pairs cannot share one key', () => {
    // A bare separator is not a boundary: with `${a}::${b}`, the pair
    // ('a', 'b::c') and the pair ('a::b', 'c') collide into one key, and the
    // ledger silently merges two distinct pairs into one row. Length-prefixing
    // each id makes the encoding uniquely decodable.
    assert.notEqual(pairKeyFor('a', 'b::c'), pairKeyFor('a::b', 'c'));
    // Order must still not matter — the key names an unordered pair.
    assert.equal(pairKeyFor('a', 'b::c'), pairKeyFor('b::c', 'a'));
    const keys = new Set<string>();
    const ids = ['x', 'x:', 'x::', ':x', '::x', 'xx', ''];
    let pairs = 0;
    for (const a of ids) {
      for (const b of ids) {
        if (a >= b) continue;
        keys.add(pairKeyFor(a, b));
        pairs += 1;
      }
    }
    assert.equal(keys.size, pairs, 'two distinct event pairs collided onto one key');
  });

  it('emits observations in a stable total order with unique ids', () => {
    const obs = allGoldenObservations();
    const ids = new Set(obs.map((o) => o.id));
    assert.equal(ids.size, obs.length, 'duplicate observation id in the corpus');
    let ties = 0;
    for (let i = 1; i < obs.length; i++) {
      const prev = obs[i - 1]!;
      const cur = obs[i]!;
      assert.ok(prev.timestamp <= cur.timestamp, `corpus not time-sorted at index ${i}`);
      // Timestamp order alone leaves same-millisecond records free to permute
      // between runs, which is exactly what would move the digest under a
      // different sort implementation. The id is the tiebreak.
      if (prev.timestamp === cur.timestamp) {
        ties += 1;
        assert.ok(
          prev.id < cur.id,
          `equal timestamps at index ${i} are not id-ordered (${prev.id}, ${cur.id})`,
        );
      }
    }
    assert.ok(ties > 0, 'no equal-timestamp records left — the tiebreak is no longer exercised');
  });

  it('digests the corpus at 128 bits, not at a brute-forceable width', () => {
    // A 32-bit digest was preimaged in seconds during review: a 7-character
    // replacement for a decoy id reproduced the committed hash exactly, so the
    // corpus could be made easier without invalidating the baseline.
    const digest = runCorrelationBenchmark().corpusDigest;
    assert.match(digest, /^[0-9a-f]{32}$/, `corpus digest ${digest} is not 128 bits of hex`);
  });

  it('frames each record by length, so a regrouping of the corpus is not free', () => {
    // A separator byte is just another code unit: hashing `decoy:first` then
    // `decoy:second` with a `_` between them reaches exactly the state of
    // hashing the single record `decoy:first_decoy:second`, at ANY digest
    // width. That collision lets two real decoy ids be replaced by one
    // synthetic id — removing both traps from grading — without moving the
    // digest. Length-prefixing makes the ENCODING uniquely decodable, which
    // closes that structural route; the hash is a custom FNV-like recurrence,
    // not a cryptographic digest, so nothing here claims collision resistance.
    assert.notEqual(
      digestRecords(['decoy:first', 'decoy:second']),
      digestRecords(['decoy:first_decoy:second']),
    );
    assert.notEqual(digestRecords(['ab', 'c']), digestRecords(['a', 'bc']));
    // Same records, same digest — framing must not be order- or run-sensitive.
    assert.equal(digestRecords(['ab', 'c']), digestRecords(['ab', 'c']));
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

  it('still exposes the confounded burst pair', () => {
    // Load-bearing for ACC-504: the fixture has to keep CONFOUNDING, so this
    // asserts the defect is still reachable rather than pinning its exact size.
    // `test:renderer` runs before `bench:correlation` in smoke.yml, so an exact
    // `=== 2` here would fail an ACC-504 improvement before the one-sided
    // benchmark gate could pass it — the "improvements pass silently" property
    // has to hold for the whole CI path, not just for the gate in isolation.
    assert.ok(
      report.confoundedFalsePositives > 0,
      'the confounded burst pair vanished — either ACC-504 landed (re-seed the baseline and '
      + 'delete this test) or the fixture stopped confounding',
    );
  });

  it('still exposes the transitive mediated edge', () => {
    // Load-bearing for ACC-503 in exactly the same way, and one-sided for the
    // same CI-ordering reason.
    assert.ok(
      report.mediatedFalsePositives > 0,
      'the transitive mediated edge vanished — either ACC-503 landed (re-seed the baseline and '
      + 'delete this test) or the fixture stopped mediating',
    );
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
    // Bounding the two counts says nothing about which one the rate divided by.
    // The ledger names every distinct pair and flags the true ones, so the
    // denominator is checkable rather than assumed.
    assert.equal(report.distinctEnginePairCount, report.pairs.length);
    const trueRows = report.pairs.filter((p) => p.isTruePair).length;
    assert.equal(
      report.pairPrecision,
      Math.round((trueRows / report.pairs.length) * 10_000) / 10_000,
      'reported pair precision does not divide the ledger by the distinct denominator',
    );
  });

  it('does not double-count one event pair matched by two rules', () => {
    // The live corpus emits exactly one pair per distinct key, so it cannot
    // tell the two denominators apart. This drives the grader directly with a
    // pair matched twice: distinct must stay 1 while the raw count reaches 2.
    // The key is length-prefixed and deliberately not splittable, so the two
    // endpoints come from the ledger row that carries them.
    const seed = report.pairs.find((p) => p.isTruePair)!;
    const twice = ['rule-one', 'rule-two'].map((ruleId) => ({
      ruleId,
      eventA: { id: seed.eventIdA },
      eventB: { id: seed.eventIdB },
      confidence: 0.5,
    })) as unknown as Parameters<typeof gradeEnginePairs>[0];

    const graded = gradeEnginePairs(twice, plantedTruePairKeys(), decoyEventIds());
    assert.equal(graded.pairCount, 2, 'both emissions should be counted raw');
    assert.equal(graded.distinctPairCount, 1, 'one event pair, matched twice');
    // Precision on the distinct denominator is 1/1; on the raw one it would be
    // 1/2 — a phantom 50% regression for recognising a true pair twice. This
    // asserts the field the grader itself computed, not a re-derivation: the
    // report reads `graded.pairPrecision`, so a denominator swap inside
    // `gradeEnginePairs` has to fail here.
    assert.equal(graded.pairPrecision, 1);
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
    // …and the assembly really routes through it: the same function, fed the
    // report's OWN ledger, has to reproduce the number the report published.
    assert.equal(
      enginePairPrecision({
        ...graded,
        emittedTrueKeys: new Set(report.pairs.filter((p) => p.isTruePair).map((p) => p.key)),
        distinctPairCount: report.pairs.length,
      }),
      report.pairPrecision,
      'the report published a precision this function would not have produced',
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
    assert.equal(baseline.schemaVersion, CORRELATION_BENCH_SCHEMA_VERSION);
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
    // The baseline also carries a metric regression the gate would otherwise
    // report, so "nothing else" is a claim about the short-circuit rather than
    // about a baseline that had nothing else to say.
    const drifted = {
      ...baselineWithCausalEdges(baseline, baseline.significantEdgeCount),
      observationCount: baseline.observationCount + 1,
    };
    assert.ok(drifted.couplingPrecision - report.couplingPrecision > 0.5);
    const { ok, reasons } = compareCorrelationBenchToBaseline(report, drifted);
    assert.equal(ok, false);
    assert.equal(reasons.length, 1, 'metric noise leaked past a corpus-identity failure');
    assert.match(reasons[0]!, /observation count changed/);
    assert.match(reasons[0]!, /reviewed diff/);
  });

  it('fails on a coupling-precision regression past tolerance', () => {
    // 17/22 causal is precision 0.7727 — half a point above the live 0.2273,
    // and coherent with its own breakdown so the gate is what rejects the run.
    const strict = baselineWithCausalEdges(baseline, 17);
    assert.ok(strict.couplingPrecision - report.couplingPrecision > 0.5);
    const { ok, reasons } = compareCorrelationBenchToBaseline(report, strict);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('miner coupling precision regressed')));
  });

  it('passes silently on improvement — tolerances are one-sided', () => {
    // Worse on every axis, but still a baseline a real (bad) run could have
    // produced: one causal edge out of 22, one recovered coupling, one true
    // pair emitted. An incoherent "worse" baseline — 99 false-positive rules
    // out of 12 rules — proves nothing about one-sidedness, because the gate
    // now rejects it before any tolerance is spent.
    const worse: CorrelationBenchBaseline = {
      ...baselineWithCausalEdges(baseline, 1, report),
      couplingRecall: round4(1 / baseline.plantedCausalCount),
      pairPrecision: round4(1 / baseline.distinctEnginePairCount),
      pairRecall: round4(1 / baseline.truePairUniverse),
      edgeEvidenceSeparation: 1.5,
      meanTruePairConfidence: 0.1,
      learnedRulePairCount: 9999,
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(report, worse);
    assert.deepEqual(reasons, []);
    assert.equal(ok, true);
  });

  it('treats decoy leakage as zero-tolerance', () => {
    // A decoy emission the corpus AGREES with: a real near-miss decoy event
    // paired with a real event, keyed the way `pairKeyFor` keys it, so every
    // row-level derivation reconciles and the zero-tolerance gate is the only
    // thing left to reject it. Hand-setting `decoyEmissions` on a row that
    // touches no decoy would trip the reconciliation instead and prove nothing.
    const decoy = [...decoyEventIds()][0]!;
    const partner = report.pairs[0]!.eventIdA;
    const leaked = withPairLedger(report, [
      ...report.pairs,
      {
        key: pairKeyFor(decoy, partner),
        eventIdA: decoy < partner ? decoy : partner,
        eventIdB: decoy < partner ? partner : decoy,
        ruleIds: [report.pairs[0]!.ruleIds[0]!],
        confidences: [0.5],
        isTruePair: false,
        decoyEmissions: 1,
      },
    ]);
    const { ok, reasons } = compareCorrelationBenchToBaseline(leaked, baseline);
    assert.equal(ok, false);
    assert.ok(
      reasons.some((r) => r.includes('near-miss decoy pair')),
      `expected a decoy-leak reason, got: ${reasons.join(' | ')}`,
    );
  });

  it('fails when learned rules spray more pairs than the tolerance allows', () => {
    // Volume lives in the ledger now, so the spray is extra emissions on a
    // NON-causal learned rule — the causal tallies stay put and the growth gate
    // is the only thing the fixture moves.
    const target =
      baseline.learnedRulePairCount + baseline.tolerances.learnedRulePairGrowth + 1;
    const causal = new Set(report.causalLearnedRuleIds);
    const idx = report.learnedPairs.findIndex((r) => !causal.has(r.ruleId));
    assert.ok(idx >= 0, 'no non-causal learned rule to spray from');
    const noisy = withLearnedPairRows(
      report,
      report.learnedPairs.map((r, i) => (
        i === idx
          ? { ...r, emissions: r.emissions + (target - report.learnedRulePairCount) }
          : r
      )),
    );
    assert.equal(noisy.learnedRulePairCount, target);
    const { ok, reasons } = compareCorrelationBenchToBaseline(noisy, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('learned-rule pair volume grew')));
  });

  it('fails closed when a corpus edit leaves the three counts intact', () => {
    // The whole point of the digest: an edited timestamp, domain, severity or
    // truth label changes nothing about stream/observation/coupling COUNTS, so
    // a counts-only identity check would compare incomparable numbers and call
    // the easier corpus an improvement.
    const restyled = { ...baseline, corpusDigest: 'deadbeef'.repeat(4) };
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
    // Collapsed, not degenerate: an exact 0 (or one constant across the whole
    // ledger) is rejected as a placeholder before any gate is reached, so the
    // scores stay distinct and merely worthless.
    const flat = withPairLedger(
      report,
      report.pairs.map((p, i) => ({
        ...p,
        confidences: p.confidences.map(() => 0.01 + (i % 5) / 10_000),
      })),
    );
    assert.ok(flat.meanTruePairConfidence < 0.02);
    assert.equal(flat.pairPrecision, report.pairPrecision);
    const { ok, reasons } = compareCorrelationBenchToBaseline(flat, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('mean true-pair confidence regressed')));
  });

  it('fails when the learned-rule pipeline disappears entirely', () => {
    // Zero rules means zero false positives and zero blast radius: perfect on
    // every "lower is better" gate, and a dead feature.
    const deadCounters = {
      ...report,
      learnedRuleCount: 0,
      learnedRuleFalsePositives: 0,
      causalLearnedRuleCount: 0,
      learnedRulePairCount: 0,
      causalLearnedRulePairCount: 0,
      // Dead means dead all the way down: no rule rows in the ledger and no
      // per-rule tallies. Leaving those behind trips the reconciliation checks
      // instead, and this test stops proving anything about the shrink gate.
      causalLearnedRuleIds: [],
      edges: report.edges.map((e) => ({ ...e, becameLearnedRule: false })),
    };
    const dead = withLearnedPairRows(deadCounters, []);
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
      // first and this test stops proving anything about the growth gate. The
      // fillers carry distinct endpoints (a cloned row is padding) and sit at
      // the existing false-edge z mean, so the derived separation is unmoved
      // and this stays a test of the false-edge count alone.
      edges: [
        ...report.edges,
        ...freeDomainPairs(report, 2).map(([from, to]) => ({
          from,
          to,
          verdict: 'unplanted' as const,
          support: 3,
          antecedents: 10,
          lift: 2.5,
          zScore: report.meanFalseEdgeZ ?? 2,
          strength: 0.5,
          windowHours: 6,
          becameLearnedRule: false,
        })),
      ],
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(looser, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('graded false edges grew')));
  });

  it('scores a perfect miner as an improvement, not as the largest regression', () => {
    // Zero false edges makes separation undefined. Coercing that to 0 would
    // report an 8.49 regression for achieving exactly what ACC-502..504 exist
    // to achieve — the fastest way to get a gate deleted.
    const causalEdgeRows = report.edges
      .filter((e) => e.verdict === 'causal')
      .map((e) => ({ ...e, becameLearnedRule: true }));
    const causalRuleIds = causalEdgeRows.map((e) => learnedRuleId({ from: e.from, to: e.to }));
    const perfectCounters = {
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
      causalLearnedRuleIds: causalRuleIds,
      edges: causalEdgeRows,
    };
    // Five causal rules now, so the ledger has to witness five live rules
    // summing to the unchanged 19 — and none of them below the per-rule floor,
    // or the liveness gate would fire instead of the run passing.
    const perfect = withLearnedPairRows(
      perfectCounters,
      learnedRowsFor(
        perfectCounters,
        causalRuleIds.map((id, i) => [id, [5, 4, 4, 3, 3][i]!] as const),
      ),
    );
    assert.deepEqual(perfect.causalLearnedRulePairsPerRule, [5, 4, 4, 3, 3]);
    const { ok, reasons } = compareCorrelationBenchToBaseline(perfect, baseline);
    assert.deepEqual(reasons, []);
    assert.equal(ok, true);
  });

  it('rejects a null separation that is NOT explained by zero false edges', () => {
    // A run where the miner recovered NOTHING causal: separation is legitimately
    // null (the causal z bucket is empty) while every false edge still stands.
    // The verdicts stay corpus-true — the causal rows are simply absent, which
    // is what "recovered nothing" means — so the gate, not the reconciliation,
    // is what has to catch the unearned exemption.
    const falseEdges = report.edges.filter((e) => e.verdict !== 'causal');
    const byVerdict = (v: string): number =>
      falseEdges.filter((e) => e.verdict === v).length;
    const brokenCounters = {
      ...report,
      edges: falseEdges.map((e) => ({ ...e, becameLearnedRule: false })),
      significantEdgeCount: falseEdges.length,
      edgeEvidenceSeparation: null,
      couplingPrecision: 0,
      couplingRecall: 0,
      missingCouplings: Array.from(
        { length: report.plantedCausalCount },
        (_, i) => `missing-${i}`,
      ),
      falseEdgeCount: falseEdges.length,
      confoundedFalsePositives: byVerdict('confounded'),
      mediatedFalsePositives: byVerdict('mediated'),
      independentFalsePositives: byVerdict('independent'),
      inhibitoryEdgesReported: byVerdict('inhibitory'),
      unplantedFalsePositives: byVerdict('unplanted'),
      learnedRuleCount: 0,
      causalLearnedRuleCount: 0,
      learnedRuleFalsePositives: 0,
      learnedRulePairCount: 0,
      causalLearnedRulePairCount: 0,
      causalLearnedRuleIds: [],
    };
    const broken = withLearnedPairRows(brokenCounters, []);
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
    const dark = withLearnedPairRows(report, []);
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
    const nearlyDark = withLearnedPairRows(
      report,
      learnedRowsFor(report, [[report.causalLearnedRuleIds[0]!, 1]]),
    );
    assert.deepEqual(nearlyDark.causalLearnedRulePairsPerRule, [1, 0, 0]);
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
    // Dropping the rows is what drops the counts: every pair summary is
    // re-derived from the shortened ledger, so this stays a test of the shrink
    // gate rather than of the reconciliation that now precedes it.
    const fewer = withPairLedger(report, report.pairs.slice(0, -4));
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

  it('rejects a tolerance wide enough to absorb the whole measurement', () => {
    // Each of these is finite and non-negative, so type validation passes them
    // all. Together they disarm every liveness gate at once while the baseline
    // still LOOKS armed — the widest PASS-on-nothing path of the fourth round.
    const wide = {
      ...baseline,
      tolerances: {
        ...baseline.tolerances,
        couplingPrecisionDrop: 1,
        couplingRecallDrop: 1,
        pairRecallDrop: 1,
        causalLearnedRulePairShrinkRatio: 1,
        enginePairShrink: 22,
      },
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(report, wide);
    assert.equal(ok, false);
    assert.equal(reasons.length, 5, 'every over-wide tolerance should be named');
    for (const reason of reasons) assert.match(reason, /above its .* ceiling/);
  });

  it('rejects positive miner rates carried by an empty edge ledger', () => {
    // Clearing the rows takes the row-level reconciliations with it, and the
    // summary fields are all mutually consistent at zero — but a miner that
    // reported no edges cannot have scored 22.7% precision on them.
    const cleared = {
      ...report,
      edges: [],
      significantEdgeCount: 0,
      falseEdgeCount: 0,
      confoundedFalsePositives: 0,
      mediatedFalsePositives: 0,
      independentFalsePositives: 0,
      inhibitoryEdgesReported: 0,
      unplantedFalsePositives: 0,
      learnedRuleCount: 0,
      causalLearnedRuleCount: 0,
      edgeEvidenceSeparation: null,
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(cleared, baseline);
    assert.equal(ok, false);
    assert.ok(
      reasons.some((r) => r.includes('the miner produced zero significant edges')),
      `expected a zero-edge reason, got ${JSON.stringify(reasons)}`,
    );
  });

  it('reconciles the learned-rule summaries against the edge rows that claim them', () => {
    // learnedRuleCount is a summary; edges[].becameLearnedRule is the ledger.
    // Only cross-checking them catches a rule count invented out of nothing.
    const unbacked = {
      ...report,
      edges: report.edges.map((e) => ({ ...e, becameLearnedRule: false })),
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(unbacked, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('becameLearnedRule')));
  });

  it('reconciles coupling recall against the couplings it names as missing', () => {
    // Recall 1.0 while naming missing couplings is a contradiction the
    // summary-only checks accepted, because both fields were self-consistent.
    const contradictory = {
      ...report,
      missingCouplings: [{ from: 'nope-a', to: 'nope-b', kind: 'causal' as const }],
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(contradictory, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('couplingRecall')));
  });

  it('rejects pair rates whose two routes to the true-emission count disagree', () => {
    // `precision × distinct` and `recall × truePairUniverse` are independent
    // routes to the same quantity. Inflating the denominator while holding both
    // rates at 1.0 is arithmetically impossible, but each rate on its own still
    // reads as a perfect pass.
    const impossible = { ...report, distinctEnginePairCount: report.truePairUniverse + 1 };
    const { ok, reasons } = compareCorrelationBenchToBaseline(impossible, baseline);
    assert.equal(ok, false);
    assert.ok(
      reasons.some((r) => r.includes('implies')),
      `expected a pair-arithmetic reason, got ${JSON.stringify(reasons)}`,
    );
  });

  it('bounds the evidence separation instead of scoring a fabricated one', () => {
    // z-scores are clamped to [2,50], so a separation of means lives in
    // [-48,48]. 1e300 is not a large separation, it is a fabricated one — and
    // higher-is-better, so every directional check reads it as an improvement.
    const fabricated = { ...report, edgeEvidenceSeparation: 1e300 };
    const { ok, reasons } = compareCorrelationBenchToBaseline(fabricated, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('outside [−48,48]')));
  });

  it('range-checks each false-positive component, not just their sum', () => {
    // -1 confounded against +3 unplanted preserves falseEdgeCount exactly, so
    // the sum reconciliation is satisfied by a negative count.
    const offsetting = {
      ...report,
      confoundedFalsePositives: -1,
      unplantedFalsePositives: report.unplantedFalsePositives + 3,
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(offsetting, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('not a non-negative integer count')));
  });

  it('fails when one causal rule goes dark inside a healthy aggregate', () => {
    // Per-rule volumes are 7/6/6 = 19. A 0.5 aggregate shrink ratio floors at
    // 9.5, so 7/6/0 = 13 sails past it: sums hide their own zeros.
    const emissionsFor = (id: string): number => report.learnedPairs
      .filter((r) => r.ruleId === id)
      .reduce((a, r) => a + r.emissions, 0);
    const silenced = [...report.causalLearnedRuleIds]
      .sort((a, b) => emissionsFor(a) - emissionsFor(b))[0]!;
    const oneDead = withLearnedPairRows(
      report,
      report.learnedPairs.filter((r) => r.ruleId !== silenced),
    );
    assert.deepEqual(oneDead.causalLearnedRulePairsPerRule, [7, 6, 0]);
    const { ok, reasons } = compareCorrelationBenchToBaseline(oneDead, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('a causal learned rule went dark')));
  });

  it('rejects a baseline that re-seeds the separation gate at zero', () => {
    // The 8.49 -> 0 collapse is only visible because the baseline arms the
    // gate. Re-seeding both sides at 0 while 17 false edges remain retires it.
    const disarmed = { ...baseline, edgeEvidenceSeparation: 0 };
    const { ok, reasons } = compareCorrelationBenchToBaseline(report, disarmed);
    assert.equal(ok, false);
    assert.match(reasons[0]!, /edgeEvidenceSeparation/);
    assert.match(reasons[0]!, /permanently disarms the gate it feeds/);
  });

  it('rejects a per-rule tally that does not add up to its own summary', () => {
    const mismatched = { ...report, causalLearnedRulePairsPerRule: [7, 6, 7] };
    const { ok, reasons } = compareCorrelationBenchToBaseline(mismatched, baseline);
    assert.equal(ok, false);
    assert.ok(
      reasons.some((r) => r.includes('per-rule causal pair tallies sum to 20')),
      `expected a per-rule tally reason, got ${JSON.stringify(reasons)}`,
    );
  });

  it('accumulates every independent regression rather than short-circuiting', () => {
    // A perfect-miner baseline — coherent with its own breakdown, so it clears
    // reconciliation and every gate below it gets to fire independently.
    const strict: CorrelationBenchBaseline = {
      ...baselineWithCausalEdges(baseline, baseline.significantEdgeCount),
      meanTruePairConfidence: 0.99,
      learnedRuleFalsePositives: 0,
      learnedRuleCount: baseline.causalLearnedRuleCount,
    };
    const { reasons } = compareCorrelationBenchToBaseline(report, strict);
    assert.ok(reasons.length >= 3, `expected several reasons, got ${reasons.length}`);
  });
});

/**
 * The gate reached PASS six review rounds running by measuring nothing: the
 * summaries it read were produced by one pass and only ever checked against
 * each other, and a baseline that no run could have produced still spent its
 * tolerances. These are the reconciliation checks that close that route — each
 * one is a fixture that USED to pass.
 */
describe('the gate rejects a run or a baseline that could not have happened', () => {
  const report = runCorrelationBenchmark();
  const baseline = loadBaseline();

  it('rejects a baseline written against an older schema', () => {
    // Fields the gate now reads did not exist at v4, so every check that
    // touches one would read `undefined` and quietly pass.
    const stale = { ...baseline, schemaVersion: CORRELATION_BENCH_SCHEMA_VERSION - 1 };
    const { ok, reasons } = compareCorrelationBenchToBaseline(report, stale);
    assert.equal(ok, false);
    assert.equal(reasons.length, 1, 'a stale schema must stop the gate, not annotate it');
    assert.match(reasons[0]!, /predates fields this gate reads/);
  });

  it('rejects a corpus digest missing from BOTH operands', () => {
    // `undefined === undefined` is the identity check passing on the absence of
    // identity — the one comparison that must never be satisfiable by deletion.
    const { corpusDigest: _a, ...blindReport } = report;
    const { corpusDigest: _b, ...blindBaseline } = baseline;
    const { ok, reasons } = compareCorrelationBenchToBaseline(
      blindReport as typeof report,
      blindBaseline as typeof baseline,
    );
    assert.equal(ok, false);
    assert.equal(reasons.length, 2, 'both sides are unidentified, both must say so');
    for (const r of reasons) assert.match(r, /not a 32-character hex digest/);
  });

  it('rejects a malformed digest before comparing it', () => {
    const short = { ...baseline, corpusDigest: 'deadbeef' };
    const { ok, reasons } = compareCorrelationBenchToBaseline(report, short);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('not a 32-character hex digest')));
  });

  it('rejects a baseline metric sitting at or below its own tolerance', () => {
    // 0.05 confidence under a 0.05 drop allowance accepts a live 0 — a kernel
    // that stopped scoring anything would be graded as no regression. Positive
    // is not the bar; the bar is the tolerance the gate will spend.
    const tol = baseline.tolerances.meanTruePairConfidenceDrop;
    const disarmed = { ...baseline, meanTruePairConfidence: tol };
    const { ok, reasons } = compareCorrelationBenchToBaseline(report, disarmed);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('scoring a metric that measured nothing')));
  });

  it('rejects a baseline whose learned-rule split exceeds its own rule count', () => {
    // 99 false-positive rules out of 12 rules is not a worse run, it is not a
    // run — and it was accepted, because reconciliation only ever ran on the
    // live report.
    const impossible = { ...baseline, learnedRuleFalsePositives: 99 };
    const { ok, reasons } = compareCorrelationBenchToBaseline(report, impossible);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('baseline is internally inconsistent')));
  });

  it('rejects a rate that no whole number of hits could produce', () => {
    // A rate is a ratio of two integers. 0.5 over 22 distinct pairs implies 11
    // true pairs; 0.5123 implies 11.27 of them, which is a hand-typed number.
    const fractional = { ...baseline, pairPrecision: 0.5123 };
    const { ok, reasons } = compareCorrelationBenchToBaseline(report, fractional);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('implies')));
  });

  it('rejects a report claiming fewer mined edges than it called significant', () => {
    // `minedEdgeCount: 0` beside 22 significant edges says the filter admitted
    // more than it was given.
    const unmined = { ...report, minedEdgeCount: 0 };
    const { ok, reasons } = compareCorrelationBenchToBaseline(unmined, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('minedEdgeCount=0')));
  });

  it('rejects stub edge rows that only carry the two fields the gate used to read', () => {
    // Rows keeping `verdict` + `becameLearnedRule` reconciled against every
    // summary while describing edges `significantEdges()` would have filtered.
    const stubbed = {
      ...report,
      edges: report.edges.map((e) => ({ ...e, support: 1, lift: 0.5, zScore: 0.1 })),
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(stubbed, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('below the minimum 3 that significantEdges()')));
    assert.ok(reasons.some((r) => r.includes('below the minimum 2 that significantEdges()')));
  });

  it('rejects a separation the edge rows do not derive', () => {
    // The gate spends its largest budget on this number; before the ledger it
    // was simply asserted next to the rows rather than computed from them.
    const inflated = { ...report, edgeEvidenceSeparation: (report.edgeEvidenceSeparation ?? 0) + 5 };
    const { ok, reasons } = compareCorrelationBenchToBaseline(inflated, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('z-score(s) derive')));
  });

  it('rejects a pair ledger padded with a duplicate key', () => {
    // Distinct pairs are the precision denominator, so a repeated key inflates
    // the count the gate divides by.
    const padded = {
      ...report,
      pairs: [...report.pairs, { ...report.pairs[0]!, isTruePair: false }],
      distinctEnginePairCount: report.distinctEnginePairCount + 1,
      enginePairCount: report.enginePairCount + 1,
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(padded, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('internally inconsistent')));
  });

  it('rejects pair summaries the ledger does not reproduce', () => {
    // The six pair numbers agreeing with each other is not evidence; the rows
    // that produced them are.
    const lying = { ...report, meanTruePairConfidence: 0.99 };
    const { ok, reasons } = compareCorrelationBenchToBaseline(lying, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('internally inconsistent')));
  });

  // ── Sixth round: the ledgers used to carry their own conclusions. A row that
  // states its own verdict, its own `isTruePair`, and its own decoy count is the
  // report grading itself — rewrite every endpoint to a fabricated id and the
  // rows still agree with the summaries they were generated alongside. Each
  // fixture below rewrites truth and USED to return PASS.

  it('rejects a pair ledger whose keys name pairs that do not exist', () => {
    // Codex's proof: replace every key with a fabricated unique string. The six
    // pair summaries still reconcile — they only ever counted rows — so nothing
    // but a re-derivation from the corpus can notice.
    const fabricated = withPairLedger(
      report,
      report.pairs.map((p, i) => ({ ...p, key: `fabricated-pair-${i}` })),
    );
    const { ok, reasons } = compareCorrelationBenchToBaseline(fabricated, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('does not name the pair the row claims')));
  });

  it('rejects a pair row whose endpoints do not build its key', () => {
    // The endpoints are what make the key checkable. Swapping one for another
    // real event id keeps the row well-formed and the totals intact.
    const swapped = withPairLedger(
      report,
      report.pairs.map((p, i) => (i === 0 ? { ...p, eventIdA: report.pairs[1]!.eventIdA } : p)),
    );
    const { ok, reasons } = compareCorrelationBenchToBaseline(swapped, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('does not name the pair the row claims')));
  });

  it('rejects a pair row that relabels a true pair as a miss', () => {
    // `isTruePair` came from the same grading pass as `pairPrecision`, so the
    // two agree by construction. Planted truth is the only outside witness.
    const relabelled = withPairLedger(
      report,
      report.pairs.map((p, i) => (i === 0 ? { ...p, isTruePair: !p.isTruePair } : p)),
    );
    const { ok, reasons } = compareCorrelationBenchToBaseline(relabelled, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('but the planted corpus says')));
  });

  it('rejects an edge row whose verdict contradicts the planted corpus', () => {
    // Promoting one false edge to `causal` moves precision in the direction the
    // gate rewards, and every FP category still sums to `falseEdgeCount`.
    const promoted = report.edges.map((e, i) => (
      i === report.edges.findIndex((x) => x.verdict !== 'causal')
        ? { ...e, verdict: 'causal' as const }
        : e
    ));
    const { ok, reasons } = compareCorrelationBenchToBaseline(
      { ...report, edges: promoted }, baseline,
    );
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('the planted corpus grades')));
  });

  it('rejects an edge row pointing at events the corpus never coupled', () => {
    // Real domains the corpus never coupled grade as `unplanted` no matter what
    // the row claims, so a re-pointed causal edge cannot keep its verdict.
    // (Invented names are rejected one check earlier, as stray endpoints.)
    const [from, to] = freeDomainPairs(report, 1)[0]!;
    const renamed = report.edges.map((e, i) => (i === 0 ? { ...e, from, to } : e));
    const { ok, reasons } = compareCorrelationBenchToBaseline(
      { ...report, edges: renamed }, baseline,
    );
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('the planted corpus grades')));
  });

  it('rejects the same directed pair reported twice at two lag windows', () => {
    // The miner emits one edge per directed pair. A second row for the same
    // pair is padding: it inflates the causal count, and under a z-keyed dedupe
    // it slips through by carrying a different lag.
    const causal = report.edges.find((e) => e.verdict === 'causal')!;
    const padded = {
      ...report,
      significantEdgeCount: report.significantEdgeCount + 1,
      edges: [...report.edges, { ...causal, windowHours: causal.windowHours + 1 }],
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(padded, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('repeats an earlier row for the same')));
  });

  it('rejects a false-positive breakdown that reassigns rows between categories', () => {
    // The five categories summing to `falseEdgeCount` is the check the report
    // already satisfied. Moving one row from `confounded` to `mediated` keeps
    // the sum and hides which trap the miner actually fell into.
    const moved = {
      ...report,
      confoundedFalsePositives: report.confoundedFalsePositives - 1,
      mediatedFalsePositives: report.mediatedFalsePositives + 1,
    };
    assert.ok(report.confoundedFalsePositives > 0, 'fixture needs a confounded row to move');
    const { ok, reasons } = compareCorrelationBenchToBaseline(moved, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('confounded')));
  });

  it('rejects a baseline that drops rules out of the pinned inventory', () => {
    // Deleting a built-in rule deletes the pairs it would have emitted, which
    // reads as a smaller — and therefore "improved" — denominator. The rule set
    // is pinned by exact set equality, not by a count or a floor.
    const empty = compareCorrelationBenchToBaseline(report, { ...baseline, builtInRuleIds: [] });
    assert.equal(empty.ok, false);
    assert.ok(empty.reasons.some((r) => r.includes('builtInRuleIds is missing')));

    const thinned = compareCorrelationBenchToBaseline(
      report, { ...baseline, builtInRuleIds: baseline.builtInRuleIds.slice(1) },
    );
    assert.equal(thinned.ok, false);
    assert.ok(thinned.reasons.some((r) => r.includes('built-in correlation rule set changed')));
  });

  it('gates the mined-candidate count, so a collapsed miner cannot read as clean', () => {
    // Precision and separation both IMPROVE when the miner stops mining: fewer
    // candidates, fewer false positives. Only the candidate count itself falls.
    const collapsed = { ...report, minedEdgeCount: Math.floor(report.minedEdgeCount / 2) };
    const { ok, reasons } = compareCorrelationBenchToBaseline(collapsed, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('mined candidate edges')));
  });

  it('rejects a baseline that seeds a decoy emission as acceptable', () => {
    // The decoy gate used to compare live against baseline, so a baseline that
    // admitted one leak licensed one leak forever. Zero is the only value.
    const seeded = { ...baseline, decoyPairsEmitted: 1 };
    const { ok, reasons } = compareCorrelationBenchToBaseline(report, seeded);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('baseline emits')));
  });

  it('accepts the committed baseline against a live run', () => {
    // Every check above is a rejection; this is the one that proves the gate
    // still has a passing state, so a stricter gate cannot be mistaken for a
    // working one.
    const { ok, reasons } = compareCorrelationBenchToBaseline(report, baseline);
    assert.deepEqual(reasons, []);
    assert.equal(ok, true);
  });
});

/**
 * Round 7. Every case below is a mutation that PASSED the round-6 gate and was
 * demonstrated against it read-only. They share one shape: a conclusion the
 * report authored about itself, accepted because nothing independent had to
 * agree with it.
 */
describe('the gate rejects a conclusion the report authored about itself', () => {
  const report = runCorrelationBenchmark();
  const baseline = loadBaseline();

  it('rejects a dead pass B that kept its four counters', () => {
    // The demonstrated mutation exactly: force the second engine pass to emit
    // nothing, restore 101 / 19 / [7,6,6] / 6 into the report, PASS.
    const dead = { ...report, learnedPairs: [] };
    const { ok, reasons } = compareCorrelationBenchToBaseline(dead, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('accounts for 0 emission(s)')));
  });

  it('rejects a learned-pair row attributed to a rule pass B never installed', () => {
    const [first, ...rest] = report.learnedPairs;
    const forged = {
      ...report,
      learnedPairs: [{ ...first!, ruleId: 'earthquake-tsunami' }, ...rest],
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(forged, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('is not a learned:* rule')));
  });

  it('rejects a learned-pair row whose key does not match its own endpoints', () => {
    const [first, ...rest] = report.learnedPairs;
    const forged = {
      ...report,
      learnedPairs: [{ ...first!, eventIdA: 'fabricated-event-id' }, ...rest],
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(forged, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('does not match its own endpoints')));
  });

  it('rejects a causal-rule roster widened past the causal edge rows', () => {
    // The roster decides which learned emissions count as causal volume, so
    // authoring it separately from the grading launders a false rule's pairs.
    const widened = {
      ...report,
      causalLearnedRuleIds: [...report.causalLearnedRuleIds, 'learned:bursty-a->bursty-b'],
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(widened, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('cannot be authored separately from the grading')));
  });

  it('rejects pair emissions attributed to a rule the graded pass never registered', () => {
    // Appended rather than substituted: relabelling every emission would empty
    // the DERIVED coverage set and trip the coverage reconciliation first, which
    // short-circuits before the pair rows are ever read.
    const [first, ...rest] = report.pairs;
    const relabelled = {
      ...report,
      pairs: [
        {
          ...first!,
          ruleIds: [...first!.ruleIds, 'not-a-rule'],
          confidences: [...first!.confidences, 0.5],
        },
        ...rest,
      ],
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(relabelled, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('the graded pass never registered')));
  });

  it('rejects a run that ships a built-in rule with no coverage probe', () => {
    // Inventory equality proves the ID exists. Five of the nine rules are dark
    // over this corpus, so without a probe their matchers could be permanently
    // false and every number in the report would be unchanged.
    const unprobed = { ...report, ruleProbes: report.ruleProbes.slice(1) };
    const { ok, reasons } = compareCorrelationBenchToBaseline(unprobed, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('ship without a coverage probe')));
  });

  it('rejects a probe whose positive fixture did not match', () => {
    const broken = {
      ...report,
      ruleProbes: report.ruleProbes.map((p, i) => (i === 0 ? { ...p, positiveMatched: false } : p)),
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(broken, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('did not match its positive fixture')));
  });

  it('rejects a probe whose near-miss was accepted', () => {
    // A matcher that says yes to everything passes every positive fixture.
    const permissive = {
      ...report,
      ruleProbes: report.ruleProbes.map((p, i) => (
        i === 0 ? { ...p, nearMissRejected: false } : p
      )),
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(permissive, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('matched its near-miss fixture')));
  });

  it('rejects a ledger whose confidences are all a saturated constant', () => {
    const flat = {
      ...report,
      pairs: report.pairs.map((p) => ({ ...p, confidences: p.confidences.map(() => 1) })),
      meanTruePairConfidence: 1,
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(flat, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('saturated confidence')));
    assert.ok(reasons.some((r) => r.includes('identical confidence')));
  });

  it('rejects a baseline that moves false positives between categories', () => {
    // 2/1/0/0/14 rewritten to 0/0/0/0/17 keeps the total the gate used to read,
    // and retires the confounded and mediated traps in silence.
    const laundered = {
      ...baseline,
      confoundedFalsePositives: 0,
      mediatedFalsePositives: 0,
      unplantedFalsePositives: baseline.unplantedFalsePositives
        + baseline.confoundedFalsePositives + baseline.mediatedFalsePositives,
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(report, laundered);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('confounded false positives')));
    assert.ok(reasons.some((r) => r.includes('mediated false positives')));
  });

  it('rejects an edge row at a window the miner is not configured for', () => {
    const [first, ...rest] = report.edges;
    const impossible = { ...report, edges: [{ ...first!, windowHours: -999 }, ...rest] };
    const { ok, reasons } = compareCorrelationBenchToBaseline(impossible, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('not one of the miner')));
  });

  it('rejects a null lift reported alongside a finite z-score', () => {
    // Both are the same zero-chance-rate division. Nulling every lift while
    // keeping the z-scores buys the infinity exemption on 22 finite rows.
    const nulled = { ...report, edges: report.edges.map((e) => ({ ...e, lift: null })) };
    const { ok, reasons } = compareCorrelationBenchToBaseline(nulled, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('the same zero-chance-rate division')));
  });

  it('rejects a coverage claim that does not match the pair ledger', () => {
    const dropped = { ...report, ruleCoverage: report.ruleCoverage.slice(1) };
    const { ok, reasons } = compareCorrelationBenchToBaseline(dropped, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('built-in rule coverage over the corpus')));
  });
});

/**
 * Round 8. Same reviewer, one layer deeper: every case below is a number the
 * round-7 gate carried through without ever re-deriving it from the corpus, the
 * inventory, or the row it claims to summarize.
 */
describe('the gate re-derives the numbers it used to take on the report\'s word', () => {
  const report = runCorrelationBenchmark();
  const baseline = loadBaseline();

  it('rejects a mined-candidate count the corpus could not have produced', () => {
    // The candidate population was gated for SHRINK only, so its ceiling was
    // unbounded: MAX_SAFE_INTEGER passed. The miner tests each ordered pair of
    // OBSERVED domains at each configured window, and that product is a hard cap.
    for (const inflated of [1_000_000, Number.MAX_SAFE_INTEGER]) {
      const { ok, reasons } = compareCorrelationBenchToBaseline(
        { ...report, minedEdgeCount: inflated }, baseline,
      );
      assert.equal(ok, false);
      assert.ok(reasons.some((r) => r.includes('ordered domain-pair/window candidates')));
    }
  });

  it('rejects a padded rule inventory', () => {
    // Set equality is symmetric-difference, so a repeat is invisible to it. The
    // inventory is what the per-rule counters are denominated in.
    const padded = { ...report, builtInRuleIds: [...report.builtInRuleIds, report.builtInRuleIds[0]!] };
    const { ok, reasons } = compareCorrelationBenchToBaseline(padded, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('builtInRuleIds repeats')));
  });

  it('rejects a coverage probe for a rule the engine never registered', () => {
    // Probes are counted, so an invented passing probe was free coverage.
    const probes = [...report.ruleProbes, {
      ...report.ruleProbes[0]!, ruleId: 'fabricated-rule',
    }];
    const { ok, reasons } = compareCorrelationBenchToBaseline(
      { ...report, ruleProbes: probes }, baseline,
    );
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes("probe names 'fabricated-rule'")));
  });

  it('rejects edge evidence filled with one admissible constant', () => {
    // Every threshold on a row is a per-row FLOOR, so a single admissible value
    // repeated across all 22 rows cleared all of them — and separation, derived
    // from those same z-scores, agreed. A miner that ranks nothing is not mining.
    const stubbed = {
      ...report,
      edges: report.edges.map((e) => ({
        ...e, support: 3, antecedents: 3, lift: 2,
        zScore: e.verdict === 'causal' ? 10.4898 : 2, strength: 0.5, windowHours: 1,
      })),
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(stubbed, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('carry the identical support')));
  });

  it('rejects an edge between domains the corpus never observed', () => {
    // 'not in the planted index' and 'not in the corpus' used to be the same
    // answer, so renaming the false-positive rows to invented domains kept them
    // graded as 'unplanted' and reconciled against every summary.
    const invented = {
      ...report,
      edges: report.edges.map((e, i) => (e.verdict === 'unplanted'
        ? { ...e, from: `fabricated-${i}`, to: `fabricated-sink-${i}` }
        : e)),
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(invented, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('the corpus never observed')));
  });

  it('still accepts the untouched live run', () => {
    // Five new rejections, and the passing state survives all of them.
    const { ok, reasons } = compareCorrelationBenchToBaseline(report, baseline);
    assert.deepEqual(reasons, []);
    assert.equal(ok, true);
  });
});
