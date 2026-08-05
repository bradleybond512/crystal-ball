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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as correlationBaseline from '../bench-correlation-baseline.ts';

import {
  runCorrelationBenchmark, gradeEnginePairs, enginePairPrecision,
  type BenchLearnedPairRow,
  type BenchPairRow, type CorrelationBenchReport,
} from '../bench-correlation.ts';
import {
  benchReportDigest,
  benchWitnessedFields,
  compareCorrelationBenchToBaseline,
  CORRELATION_BENCH_SCHEMA_VERSION,
  DEFAULT_CORRELATION_BENCH_TOLERANCES,
  seedCorrelationBenchBaseline,
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
import {
  RULE_FIXTURES,
  digestRuleFixture,
  nearMissEvents,
  positiveEvents,
} from '../__bench__/rule-probes.ts';
import { verifyRuleProbes } from '../__bench__/rule-probe-verify.ts';
import { pairToEdge } from '../../intelligence/situation-store-v2.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..', '..', '..');
const BASELINE_PATH = path.join(here, '..', '__bench__', 'bench-correlation-baseline.json');

function loadBaseline(): CorrelationBenchBaseline {
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as CorrelationBenchBaseline;
}

const round4 = (v: number): number => Math.round(v * 10_000) / 10_000;

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Drop one own key, returning a report a producer could plausibly have emitted. */
function omit<K extends keyof CorrelationBenchReport>(
  report: CorrelationBenchReport, key: K,
): CorrelationBenchReport {
  const copy = { ...report };
  delete copy[key];
  return copy;
}

/** Every leaf position in the report, as a path of keys and array indices. */
function leafPaths(value: Json, prefix: (string | number)[] = []): (string | number)[][] {
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => leafPaths(v, [...prefix, i]));
  }
  if (value !== null && typeof value === 'object') {
    return Object.keys(value).flatMap((k) => leafPaths(value[k]!, [...prefix, k]));
  }
  return [prefix];
}

/**
 * A structural clone with the leaf at `path` changed to something a producer
 * could have emitted in its place — a different number, a flipped boolean, a
 * different string, a non-null.
 */
function perturbAt(value: Json, path: (string | number)[]): Json {
  if (path.length === 0) return perturbLeaf(value);
  const [head, ...rest] = path;
  if (Array.isArray(value)) {
    return value.map((v, i) => (i === head ? perturbAt(v, rest) : v));
  }
  const obj = value as { [k: string]: Json };
  return { ...obj, [head as string]: perturbAt(obj[head as string]!, rest) };
}

function perturbLeaf(value: Json): Json {
  if (typeof value === 'number') return value + 1;
  if (typeof value === 'boolean') return !value;
  if (typeof value === 'string') return `${value}~`;
  return 0; // null → a value, which is exactly the "metric went missing" case
}

/**
 * The two IDENTITY reasons, which any hand-authored fixture necessarily trips.
 *
 * A fixture built in a test is not a run: it cannot reproduce a re-run of the
 * frozen corpus, and its rows cannot digest to the committed ledger. Fixtures
 * that assert "nothing else fires" filter these two out and say so — filtering
 * anything wider would hide the gate under test.
 */
function isIdentityReason(reason: string): boolean {
  return reason.includes('does not reproduce')
    || reason.includes('match the committed baseline')
    // the itemised half of the same pin — a hand-authored report moves these
    // for the same reason it moves the whole-report digest
    || reason.includes('pinned by value in the baseline');
}

const confidencesOf = (p: BenchPairRow): number[] => p.emissions.map((e) => e.confidence);
const ruleIdsOf = (p: BenchPairRow): string[] => p.emissions.map((e) => e.ruleId);

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
  const trueConfidences = trueRows.flatMap(confidencesOf);
  const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
  return {
    ...report,
    pairs: [...pairs],
    enginePairCount: sum(pairs.map((p) => p.emissions.length)),
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
    // No false edges means no false z-scores, so a separation here would be a
    // number the seed run could not have measured — the two fields describe
    // one run, and the gate says so before any tolerance is consulted.
    edgeEvidenceSeparation: falseEdges === 0 ? null : baseline.edgeEvidenceSeparation,
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
    total += r.emissions.length;
    const tally = perRule.get(r.ruleId);
    if (tally !== undefined) perRule.set(r.ruleId, tally + r.emissions.length);
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
        emissions: [{ ...src.emissions[0]!, ruleId }],
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

  it('reports explicit offline replay, correction-family, and inhibitory evidence', () => {
    const report = runCorrelationBenchmark() as unknown as Record<string, unknown>;
    const family = report.multipleTestingFamily as Record<string, unknown> | undefined;
    const rows = report.inhibitoryEdges as Array<Record<string, unknown>> | undefined;

    assert.equal(report.replayMode, 'offline-whole-corpus');
    assert.equal(family?.method, 'gaussian-union-bound');
    assert.equal(family?.tails, 2);
    assert.equal(report.plantedInhibitoryCount, 1);
    assert.equal(report.inhibitoryTruePositiveCount, 1);
    assert.equal(report.inhibitoryFalsePositiveCount, 0);
    assert.equal(report.inhibitoryPrecision, 1);
    assert.equal(report.inhibitoryRecall, 1);
    assert.equal(rows?.length, 1);
    assert.equal(rows?.[0]?.id, 'inhibits:calm-signal->escalation');
    assert.equal(rows?.[0]?.verdict, 'inhibitory');
    assert.ok((rows?.[0]?.antecedents as number) >= 5);
    assert.ok((rows?.[0]?.expectedRate as number) >= 0.2);
    assert.ok((rows?.[0]?.zScore as number) < 0);
  });

  it('re-derives inhibitory truth and summaries from the row ledger', () => {
    const report = runCorrelationBenchmark();
    const forged = {
      ...report,
      inhibitoryEdges: report.inhibitoryEdges.map((edge) => ({
        ...edge, verdict: 'false-positive' as const,
      })),
      inhibitoryTruePositiveCount: 0,
      inhibitoryFalsePositiveCount: 1,
      inhibitoryPrecision: 0,
      inhibitoryRecall: 0,
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(forged, loadBaseline());
    assert.equal(ok, false);
    assert.ok(reasons.some((reason) => reason.includes('planted truth derives inhibitory')));
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
      edgeType: 'co-located',
      detectedAt: new Date(Date.UTC(2026, 5, 1, 12, 0, 0)),
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
        emissions: [{
          ruleId: report.pairs[0]!.emissions[0]!.ruleId,
          edgeType: 'co-located' as const,
          fromId: decoy,
          toId: partner,
          confidence: 0.5,
          detectedAtMs: Date.UTC(2026, 5, 1, 12, 0, 0),
          confidenceDetailDigest: '0'.repeat(32),
          evidenceEdgeType: 'co-located',
          evidenceFromId: decoy,
          evidenceToId: partner,
        }],
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
          ? {
            ...r,
            emissions: [
              ...r.emissions,
              ...Array.from(
                { length: target - report.learnedRulePairCount },
                () => r.emissions[0]!,
              ),
            ],
          }
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
        emissions: p.emissions.map((e) => ({ ...e, confidence: 0.01 + (i % 5) / 10_000 })),
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
      significantEdgeCount: report.significantEdgeCount + 1,
      falseEdgeCount: report.falseEdgeCount + 1,
      unplantedFalsePositives: report.unplantedFalsePositives + 1,
      couplingPrecision: round4(5 / (report.significantEdgeCount + 1)),
      // The ledger has to grow with the summary or the consistency check fires
      // first and this test stops proving anything about the growth gate. The
      // fillers carry distinct endpoints (a cloned row is padding) and sit at
      // the existing false-edge z mean, so the derived separation is unmoved
      // and this stays a test of the false-edge count alone.
      edges: [
        ...report.edges,
        ...freeDomainPairs(report, 1).map(([from, to]) => ({
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
    const { reasons } = compareCorrelationBenchToBaseline(perfect, baseline);
    // A hand-authored report reproduces neither the re-run nor the committed
    // ledger digest, and both reasons are expected here — the property under
    // test is that NOTHING ELSE fires: no drop, no growth, no separation
    // regression. A real perfect miner would be re-seeded (identity fields are
    // exact by design), and reaches this same all-clear on the directional
    // gates.
    assert.deepEqual(reasons.filter((r) => !isIdentityReason(r)), []);
  });

  it('retains a null survivor separation as witnessed evidence', () => {
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
    assert.ok(reasons.some((r) => r.includes('edgeEvidenceSeparation')));
  });

  it('fails closed when a gated metric is missing outright, not just null', () => {
    // `null` separation is a legitimate perfect-miner state; a MISSING field is
    // a report that never measured it. `?? 0` cannot tell them apart.
    const { fixedCandidateEvidenceSeparation: _gone, ...partial } = report;
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
    assert.deepEqual(nearlyDark.causalLearnedRulePairsPerRule, [1, 0, 0, 0, 0]);
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
    const fabricated = { ...report, fixedCandidateEvidenceSeparation: 1e300 };
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
      .reduce((a, r) => a + r.emissions.length, 0);
    const silenced = [...report.causalLearnedRuleIds]
      .sort((a, b) => emissionsFor(a) - emissionsFor(b))[0]!;
    const oneDead = withLearnedPairRows(
      report,
      report.learnedPairs.filter((r) => r.ruleId !== silenced),
    );
    assert.equal(oneDead.causalLearnedRulePairsPerRule.at(-1), 0);
    const { ok, reasons } = compareCorrelationBenchToBaseline(oneDead, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('a causal learned rule went dark')));
  });

  it('rejects a baseline that re-seeds the separation gate at zero', () => {
    // The 8.49 -> 0 collapse is only visible because the baseline arms the
    // gate. Re-seeding both sides at 0 while 17 false edges remain retires it.
    const disarmed = { ...baseline, fixedCandidateEvidenceSeparation: 0 };
    const { ok, reasons } = compareCorrelationBenchToBaseline(report, disarmed);
    assert.equal(ok, false);
    assert.match(reasons[0]!, /fixedCandidateEvidenceSeparation/);
    assert.match(reasons[0]!, /permanently disarms the gate it feeds/);
  });

  it('rejects a per-rule tally that does not add up to its own summary', () => {
    const mismatched = { ...report, causalLearnedRulePairsPerRule: [7, 6, 7] };
    const { ok, reasons } = compareCorrelationBenchToBaseline(mismatched, baseline);
    assert.equal(ok, false);
    assert.ok(
      reasons.some((r) => r.includes('per-rule causal pair tallies')),
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
          emissions: [...first!.emissions, { ...first!.emissions[0]!, ruleId: 'not-a-rule' }],
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
        i === 0
          ? { ...p, nearMisses: p.nearMisses.map((m, j) => (j === 0 ? { ...m, rejected: false } : m)) }
          : p
      )),
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(permissive, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('near-miss fixture')));
  });

  it('rejects a ledger whose confidences are all a saturated constant', () => {
    const flat = {
      ...report,
      pairs: report.pairs.map((p) => ({
        ...p, emissions: p.emissions.map((e) => ({ ...e, confidence: 1 })),
      })),
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
      assert.ok(reasons.some((r) => r.includes('ordered domain-pair candidates')));
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

  it('rejects fabricated edge evidence that clears every per-row floor', () => {
    // The per-row checks are FLOORS and the column checks are shape checks, so
    // evidence invented to clear both — varied, admissible, internally
    // reconciled — satisfied all of them. Only re-running the miner over the
    // frozen corpus can say whether these are the values it produces.
    const stubbed = {
      ...report,
      edges: report.edges.map((e, i) => ({
        ...e,
        support: 3 + (i % 4),
        antecedents: 12 + i,
        lift: 2.5 + (i % 3) / 10,
        zScore: (e.verdict === 'causal' ? 9 : 2.5) + (i % 5) / 10,
        strength: 0.4 + (i % 6) / 100,
      })),
    };
    // …with the derived z means and separation recomputed off the invented
    // rows, so the derivation checks reconcile against them too.
    const zOf = (v: 'causal' | 'false'): number[] => stubbed.edges
      .filter((e) => (v === 'causal' ? e.verdict === 'causal' : e.verdict !== 'causal'))
      .map((e) => e.zScore ?? 50);
    const mean = (xs: number[]): number => round4(xs.reduce((a, b) => a + b, 0) / xs.length);
    const forged = {
      ...stubbed,
      meanCausalEdgeZ: mean(zOf('causal')),
      meanFalseEdgeZ: mean(zOf('false')),
      edgeEvidenceSeparation: round4(mean(zOf('causal')) - mean(zOf('false'))),
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(forged, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('does not reproduce')));
    assert.ok(reasons.some((r) => r.includes('edges[0].support')));
  });

  it('rejects a pair ledger that attributes every emission to the wrong rule', () => {
    // Deranging the attributions keeps every count, every rate and every
    // coverage set intact: each rule is registered, each emission is one row.
    // What it destroys is which matcher decided what, which no summary carries.
    const ids = [...new Set(report.pairs.flatMap(ruleIdsOf))].sort();
    const deranged = report.pairs.map((p) => ({
      ...p,
      emissions: p.emissions.map((e) => ({
        ...e, ruleId: ids[(ids.indexOf(e.ruleId) + 1) % ids.length]!,
      })),
    }));
    const { ok, reasons } = compareCorrelationBenchToBaseline(
      { ...report, pairs: deranged }, baseline,
    );
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('does not reproduce')));
  });

  it('re-runs the rule probes instead of reading what they reported', () => {
    // The probe gate reads the verdict booleans, so everything ELSE a probe row
    // carries — including which clause each near-miss violates, the whole reason
    // the probe means anything — was unchecked. The re-run reproduces the row.
    const [first, ...rest] = report.ruleProbes;
    const rewritten = [
      {
        ...first!,
        nearMisses: first!.nearMisses.map((m, j) => (
          j === 0 ? { ...m, clause: 'some other clause entirely' } : m
        )),
      },
      ...rest,
    ];
    const { ok, reasons } = compareCorrelationBenchToBaseline(
      { ...report, ruleProbes: rewritten }, baseline,
    );
    assert.equal(ok, false);
    // Since round 14 the gate re-executes the fixtures itself, so a re-aimed
    // clause is caught by the disagreement rather than by the ledger digest.
    assert.ok(
      reasons.some((r) => r.includes('ruleProbes[0].nearMisses')
        || r.includes('does not reproduce')),
      reasons.join(' | '),
    );
  });

  it('rejects a report that drops an advertised measurement outright', () => {
    // `meanCausalEdgeStrength` and friends are presented as benchmark evidence
    // but feed no gate, so deleting them changed no number the gate read.
    const { meanCausalEdgeStrength: _drop, ...trimmed } = report;
    const { ok, reasons } = compareCorrelationBenchToBaseline(
      trimmed as typeof report, baseline,
    );
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('meanCausalEdgeStrength')));
  });

  it('rejects a baseline whose candidate population sits below its own edges', () => {
    // Only the live side derived this from a ledger, so a baseline could pin
    // `minedEdgeCount` under its own `significantEdgeCount` — and the shrink
    // gate then licensed the live population collapsing from 256 to 22.
    const starved = { ...baseline, minedEdgeCount: baseline.significantEdgeCount - 2 };
    const { ok, reasons } = compareCorrelationBenchToBaseline(report, starved);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('baseline is internally inconsistent: minedEdgeCount')));
  });

  it('rejects a padded roster on the baseline side too', () => {
    // The set check ran on the live roster only, so both committed pins could
    // be padded without moving the symmetric difference they are compared by.
    const padded = {
      ...baseline,
      builtInRuleIds: [...baseline.builtInRuleIds, baseline.builtInRuleIds[0]!],
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(report, padded);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('baseline builtInRuleIds repeats')));
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

/**
 * The seam re-derivation cannot reach.
 *
 * Re-running the benchmark proves the report matches THIS commit's producer. It
 * says nothing about whether the producer still does what the last human to
 * read it thought it did: a change inside `runCorrelationBenchmark()` moves the
 * report and the re-run together, and the comparator agrees with itself. A
 * review demonstrated it — deranged pair attribution, four learned-pair rows in
 * place of 101, forged probe text and a deleted metric all PASSED when injected
 * into the producer rather than into the report.
 *
 * A later round found the anchor pinned the wrong half: it covered the row
 * ledgers, so deleting `meanCausalEdgeStrength` or `meanCausalEdgeZ` inside the
 * producer, or forging `causalCouplingsLostToCap`, still returned a clean PASS.
 * It now covers every field, which the exhaustive leaf sweep below asserts
 * field by field rather than by argument.
 *
 * The tests here cannot mutate the producer (it is the module under test), so
 * they exercise the anchor directly: whatever a mutated producer would emit,
 * `benchReportDigest` of it must not equal the digest committed in the baseline
 * JSON — a file no source change can move.
 */
describe('the committed report digest anchors the producer itself', () => {
  const report = runCorrelationBenchmark();
  const baseline = loadBaseline();

  it('pins the live run, and re-pins it identically', () => {
    assert.equal(benchReportDigest(report), baseline.reportDigest);
    assert.equal(benchReportDigest(runCorrelationBenchmark()), baseline.reportDigest);
  });

  it('moves when a producer collapses 101 learned-pair rows to four', () => {
    // The exact pass-B forgery from the review: four rows, one of them naming a
    // rule for a coupling that does not exist. Every counter it feeds was
    // re-derived from the rows, so the rows and the counters agreed.
    const collapsed = {
      ...report,
      learnedPairs: [
        {
          ruleId: 'learned:not-real->not-real',
          key: 'a|b',
          eventIdA: 'a',
          eventIdB: 'b',
          emissions: [{
            ruleId: 'learned:not-real->not-real',
            edgeType: 'causal-candidate' as const,
            fromId: 'a',
            toId: 'b',
            confidence: 0.5,
          }],
        },
        ...report.learnedPairs.slice(0, 3),
      ],
    };
    assert.notEqual(benchReportDigest(collapsed), baseline.reportDigest);
  });

  it('moves when a producer deranges pair attribution', () => {
    const ids = [...new Set(report.pairs.flatMap(ruleIdsOf))].sort();
    const deranged = report.pairs.map((p) => ({
      ...p,
      emissions: p.emissions.map((e) => ({
        ...e, ruleId: ids[(ids.indexOf(e.ruleId) + 1) % ids.length]!,
      })),
    }));
    assert.notEqual(benchReportDigest({ ...report, pairs: deranged }), baseline.reportDigest);
  });

  it('moves when a producer forges probe text or edge evidence', () => {
    const [first, ...rest] = report.ruleProbes;
    assert.notEqual(
      benchReportDigest({
        ...report,
        ruleProbes: [
          {
            ...first!,
            nearMisses: first!.nearMisses.map((m, j) => (
              j === 0 ? { ...m, clause: 'some other clause entirely' } : m
            )),
          },
          ...rest,
        ],
      }),
      baseline.reportDigest,
    );
    const [edge, ...others] = report.edges;
    assert.notEqual(
      benchReportDigest({ ...report, edges: [{ ...edge!, support: edge!.support + 1 }, ...others] }),
      baseline.reportDigest,
    );
  });

  it('survives the last-bit noise a cross-platform re-run can produce', () => {
    // Rounded to the precision the baseline already trusts: `zScore` and `lift`
    // come off Math.log/Math.exp, which are implementation-defined to the last
    // bit, and a digest that flaked between macOS and Linux CI would be deleted
    // within a week.
    const jittered = {
      ...report,
      edges: report.edges.map((e) => ({
        ...e,
        zScore: e.zScore === null ? null : e.zScore + Number.EPSILON * 4,
        strength: e.strength + Number.EPSILON * 4,
      })),
    };
    assert.equal(benchReportDigest(jittered), baseline.reportDigest);
  });

  it('moves when a producer deletes or forges a SUMMARY field', () => {
    // The four the review demonstrated passing against the row-only digest.
    // These are aggregates: no row moves, no re-derivation notices, and each
    // one is an advertised measurement of the thing under test.
    const forgeries: [string, CorrelationBenchReport][] = [
      ['meanCausalEdgeStrength deleted', omit(report, 'meanCausalEdgeStrength')],
      ['meanCausalEdgeZ deleted', omit(report, 'meanCausalEdgeZ')],
      ['causalCouplingsLostToCap forged', {
        ...report, causalCouplingsLostToCap: ['forged->coupling'],
      }],
      ['confidenceSeparation forged', { ...report, confidenceSeparation: 0.5 }],
      ['meanFalsePairConfidence forged', { ...report, meanFalsePairConfidence: 0.1 }],
    ];
    for (const [label, forged] of forgeries) {
      assert.notEqual(benchReportDigest(forged), baseline.reportDigest, label);
    }
  });

  it('moves on ANY single leaf of the report, exhaustively', () => {
    // The claim "the digest covers every field" is checked field by field
    // rather than asserted: walk the whole report, perturb one leaf at a time,
    // and require the digest to move. This is the sweep that would have caught
    // the summary-layer gap on the round it shipped, and it needs no source
    // mutation to do it — a producer change is only interesting here through
    // the values it emits, and this covers all of them.
    const paths = leafPaths(report as unknown as Json);
    assert.ok(paths.length > 500, `expected a large report, walked ${paths.length} leaves`);
    const missed: string[] = [];
    for (const path of paths) {
      const mutated = perturbAt(report as unknown as Json, path);
      if (benchReportDigest(mutated as unknown as CorrelationBenchReport)
        === baseline.reportDigest) missed.push(path.join('.'));
    }
    assert.deepEqual(missed, [], 'these leaves are invisible to the digest');
  });

  it('sees a change five orders of magnitude below the old rounding step', () => {
    // At 4 decimals a uniform `strength - 0.00001` across the whole producer
    // reproduced the digest exactly. 9 decimals closes that band without
    // reopening the cross-platform one the test above pins.
    const shaved = {
      ...report,
      edges: report.edges.map((e) => ({ ...e, strength: e.strength - 0.00001 })),
    };
    assert.notEqual(benchReportDigest(shaved), baseline.reportDigest);
  });

  it('reports the mismatch as a re-seed, not as a quality regression', () => {
    const stale = { ...baseline, reportDigest: 'f'.repeat(32) };
    const { ok, reasons } = compareCorrelationBenchToBaseline(report, stale);
    assert.equal(ok, false);
    const reason = reasons.find((r) => r.includes('match the committed baseline'));
    assert.ok(reason, `expected a ledger-digest reason, got ${JSON.stringify(reasons)}`);
    assert.ok(reason.includes('re-seed'), 'the reason must tell a human what to do');
  });

  it('rejects a baseline that pins the ledger to nothing', () => {
    const { reportDigest: _gone, ...naked } = baseline;
    const { ok, reasons } = compareCorrelationBenchToBaseline(
      report, naked as CorrelationBenchBaseline,
    );
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('baseline reportDigest is not a 32-character')));
  });
});

describe('the reproduction walk demands a plain, own-keyed report', () => {
  const report = runCorrelationBenchmark();
  const baseline = loadBaseline();

  it('rejects a report whose fields come from its prototype', () => {
    // `Object.create(realReport)` has zero own keys, serializes as `{}`, and
    // answers every property read with the real value. A union of Object.keys()
    // read through normal lookup reproduced it exactly.
    const shell = Object.create(report) as CorrelationBenchReport;
    const { ok, reasons } = compareCorrelationBenchToBaseline(shell, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('not a plain object')));
  });

  it('rejects a field deleted and re-supplied by a prototype', () => {
    const proto = { pairPrecision: report.pairPrecision };
    const forged = Object.assign(Object.create(proto) as object, report) as CorrelationBenchReport;
    delete (forged as Partial<CorrelationBenchReport>).pairPrecision;
    const { ok, reasons } = compareCorrelationBenchToBaseline(forged, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('not a plain object')));
  });

  it('rejects an extra own field, including one holding undefined', () => {
    const padded = { ...report, smuggled: undefined } as CorrelationBenchReport;
    const { ok, reasons } = compareCorrelationBenchToBaseline(padded, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('unexpected own field(s) [smuggled]')));
  });

  it('rejects a ledger array carrying extra own properties', () => {
    const edges = [...report.edges] as typeof report.edges & { note?: string };
    edges.note = 'ignore the rows, read this';
    const { ok, reasons } = compareCorrelationBenchToBaseline({ ...report, edges }, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('unexpected own field(s) [note]')));
  });

  it('rejects symbol-keyed properties the key walk never reports', () => {
    const tagged = { ...report, [Symbol.for('cb.bench')]: 'x' } as CorrelationBenchReport;
    const { ok, reasons } = compareCorrelationBenchToBaseline(tagged, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('symbol-keyed property')));
  });

  it('rejects a field that is an accessor rather than a stored value', () => {
    // A getter can answer differently on each read: once for the shape check,
    // once for the value comparison. The walk reads `descriptor.value`, so an
    // accessor never gets a second chance to tell a second story — and it is
    // refused outright rather than read once, which is why this getter is
    // HONEST. Nothing about the numbers is wrong here; the mechanism is.
    const forged = { ...report };
    Object.defineProperty(forged, 'pairPrecision', {
      enumerable: true,
      configurable: true,
      get: () => report.pairPrecision,
    });
    const { ok, reasons } = compareCorrelationBenchToBaseline(forged, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('is an accessor, not a data property')));
  });

  it('rejects a non-enumerable own field the key walk would skip', () => {
    // `Object.keys` skips it, `JSON.stringify` skips it, and a comparator built
    // on either would call the report unchanged while it carries a field.
    const forged = { ...report };
    Object.defineProperty(forged, 'smuggled', {
      enumerable: false, configurable: true, value: 'hidden',
    });
    const { ok, reasons } = compareCorrelationBenchToBaseline(forged, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('is a non-enumerable own property')));
  });

  it('still accepts the array length every real ledger carries', () => {
    // `length` is non-enumerable and own on every array — the exemption above
    // it must not be so tight that a genuine report trips the rule.
    const { ok } = compareCorrelationBenchToBaseline(runCorrelationBenchmark(), baseline);
    assert.equal(ok, true);
  });

  it('distinguishes -0 from 0', () => {
    const negZero = { ...report, meanFalsePairConfidence: -0 } as CorrelationBenchReport;
    const { reasons } = compareCorrelationBenchToBaseline(negZero, baseline);
    assert.ok(reasons.some((r) => r.includes('does not reproduce')));
  });
});

describe('a perfect miner can become the next baseline', () => {
  const report = runCorrelationBenchmark();

  /** The committed baseline as a perfect run would have re-seeded it. */
  function perfectBaseline(): CorrelationBenchBaseline {
    return {
      ...loadBaseline(),
      couplingPrecision: 1,
      significantEdgeCount: report.plantedCausalCount,
      falseEdgeCount: 0,
      confoundedFalsePositives: 0,
      mediatedFalsePositives: 0,
      independentFalsePositives: 0,
      inhibitoryEdgesReported: 0,
      unplantedFalsePositives: 0,
      learnedRuleFalsePositives: 0,
      // No false edges means no false learned rules, so the roster is exactly
      // the causal one — otherwise the baseline disagrees with itself and the
      // reconciliation fires before any gate does.
      learnedRuleCount: loadBaseline().causalLearnedRuleCount,
      edgeEvidenceSeparation: null,
    };
  }

  it('accepts a null separation on the committed side when no false edges exist', () => {
    // Round 9 left this un-seedable: a perfect run PASSED the old baseline and
    // then could not become the new one, because the committed side demanded a
    // finite, positive separation that a perfect run does not have.
    const { reasons } = compareCorrelationBenchToBaseline(report, perfectBaseline());
    assert.ok(
      !reasons.some((r) => r.includes('edgeEvidenceSeparation')),
      `separation should not be gated against a perfect baseline: ${JSON.stringify(reasons)}`,
    );
  });

  it('still fails the live run on the false edges it grew', () => {
    // The exemption must not become an escape hatch: the run being compared has
    // 17 false edges against a baseline of 0, and that is what should fail.
    const { ok, reasons } = compareCorrelationBenchToBaseline(report, perfectBaseline());
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('graded false edges grew')));
  });

  it('rejects a null separation the baseline has not earned', () => {
    const unearned = { ...loadBaseline(), edgeEvidenceSeparation: null };
    const { ok, reasons } = compareCorrelationBenchToBaseline(report, unearned);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('null but falseEdgeCount is')));
  });

  it('allows a perfect baseline exactly zero free false edges', () => {
    // The separation gate is skipped against a perfect baseline because
    // `falseEdgeGrowth` is said to cover it instead — which was only true if
    // that tolerance happened to be 0, and the shipped value is 3. So a perfect
    // baseline could have carried three ungated false edges with no separation
    // gate at all. Read the tolerance the reason reports rather than trusting
    // the comment.
    const slack = {
      ...perfectBaseline(),
      tolerances: { ...loadBaseline().tolerances, falseEdgeGrowth: 3 },
    };
    const { reasons } = compareCorrelationBenchToBaseline(report, slack);
    const grew = reasons.find((r) => r.startsWith('graded false edges grew'));
    assert.ok(grew, `expected a growth reason, got ${JSON.stringify(reasons)}`);
    assert.match(grew, /exceeds 0 tolerance/);
  });

  it('leaves the ordinary tolerance alone for an imperfect baseline', () => {
    // The clamp above is scoped to the exemption, not a global tightening: a
    // baseline that armed the separation gate keeps its shipped slack.
    // Four fewer unplanted false edges than the committed run, kept coherent:
    // the total, the significant-edge count and the precision all move with it,
    // or the reconciliation fires before any tolerance is consulted.
    const lower = {
      ...loadBaseline(),
      unplantedFalsePositives: 5,
      falseEdgeCount: 8,
      significantEdgeCount: 13,
      couplingPrecision: round4(5 / 13),
      tolerances: { ...loadBaseline().tolerances, falseEdgeGrowth: 3 },
    };
    const { reasons } = compareCorrelationBenchToBaseline(report, lower);
    const grew = reasons.find((r) => r.startsWith('graded false edges grew'));
    assert.ok(grew, `expected a growth reason, got ${JSON.stringify(reasons)}`);
    assert.match(grew, /exceeds 3 tolerance/);
  });

  it('rejects a separation the baseline could not have measured', () => {
    const impossible = { ...loadBaseline(), falseEdgeCount: 0 };
    const { ok, reasons } = compareCorrelationBenchToBaseline(report, impossible);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('no false z-scores to separate from')));
  });
});

/**
 * Pinning the whole report by digest means every real change — an improvement
 * included — fails on identity and has to be re-seeded. That is the intended
 * cost, but it is only a reasonable one if re-seeding is a command rather than
 * a hand-transcription of thirty numbers and a digest, because a transcription
 * error produces a baseline that passes and measures the wrong thing.
 */
describe('the re-seed emitter produces a baseline that passes', () => {
  const report = runCorrelationBenchmark();
  const committed = loadBaseline();
  const carriedOver = { note: committed.note, tolerances: committed.tolerances };

  it('round-trips the live run into a baseline the gate accepts', () => {
    const seeded = seedCorrelationBenchBaseline(report, carriedOver, '2026-08-03');
    const { ok, reasons } = compareCorrelationBenchToBaseline(report, seeded);
    assert.equal(ok, true, `re-seeded baseline should pass: ${JSON.stringify(reasons)}`);
  });

  it('pins every v13 replay, family, candidate, inhibition, and stream identity field', () => {
    const seeded = seedCorrelationBenchBaseline(report, carriedOver, '2026-08-03');
    assert.equal(seeded.schemaVersion, 13);
    assert.equal(seeded.replayMode, report.replayMode);
    assert.deepEqual(seeded.streamDigests, report.streamDigests);
    assert.deepEqual(seeded.multipleTestingFamily, report.multipleTestingFamily);
    assert.equal(
      seeded.fixedCandidateEvidenceSeparation,
      report.fixedCandidateEvidenceSeparation,
    );
    assert.equal(seeded.plantedInhibitoryCount, report.plantedInhibitoryCount);
    assert.equal(seeded.inhibitoryTruePositiveCount, report.inhibitoryTruePositiveCount);
    assert.equal(seeded.inhibitoryFalsePositiveCount, report.inhibitoryFalsePositiveCount);
    assert.equal(seeded.inhibitoryPrecision, report.inhibitoryPrecision);
    assert.equal(seeded.inhibitoryRecall, report.inhibitoryRecall);
  });

  it('reproduces the committed baseline field for field', () => {
    // The committed file was produced by this emitter. If the two ever diverge,
    // either the file was hand-edited or the emitter stopped pinning a field —
    // both of which mean the gate is measuring something nobody reviewed.
    const seeded = seedCorrelationBenchBaseline(
      report, carriedOver, committed.seededAt,
    );
    assert.deepEqual(seeded, committed);
  });

  it('copies the note and tolerances it is handed rather than generating them', () => {
    // Both encode human judgement: what a number means and how far it may move.
    // Feeding the COMMITTED block back in and finding it unchanged proves
    // nothing — equal in, equal out. Feeding a different block in is what shows
    // the emitter transcribes rather than invents. It cannot police the value:
    // it has no opinion about how wide a gate should be, and the test below is
    // what proves something does.
    const handEdited = {
      note: 'a re-seed carrying a hand-widened gate',
      tolerances: { ...committed.tolerances, falseEdgeGrowth: 2 },
    };
    const seeded = seedCorrelationBenchBaseline(report, handEdited, '2026-08-03');
    assert.equal(seeded.note, handEdited.note);
    assert.deepEqual(seeded.tolerances, handEdited.tolerances);
    assert.notDeepEqual(seeded.tolerances, committed.tolerances);
  });

  it('cannot launder a tolerance past its ceiling by re-seeding through it', () => {
    // The emitter passes tolerances through, so the ceiling is the only thing
    // standing between "I widened a gate by hand" and a green run.
    const overCeiling = {
      note: committed.note,
      tolerances: { ...committed.tolerances, falseEdgeGrowth: 99 },
    };
    const seeded = seedCorrelationBenchBaseline(report, overCeiling, '2026-08-03');
    assert.equal(seeded.tolerances.falseEdgeGrowth, 99);
    const { ok, reasons } = compareCorrelationBenchToBaseline(report, seeded);
    assert.equal(ok, false);
    assert.ok(
      reasons.some((r) => r.includes('falseEdgeGrowth')),
      `expected the ceiling to refuse it, got ${JSON.stringify(reasons)}`,
    );
  });

  it('emits JSON — no undefined, no non-finite, nothing that vanishes on write', () => {
    const seeded = seedCorrelationBenchBaseline(report, carriedOver, '2026-08-03');
    const written = JSON.parse(JSON.stringify(seeded)) as CorrelationBenchBaseline;
    assert.deepEqual(written, seeded);
    const { ok } = compareCorrelationBenchToBaseline(report, written);
    assert.equal(ok, true);
  });
});

describe('the re-seed guard compares against the previous baseline', () => {
  const report = runCorrelationBenchmark();
  const committed = loadBaseline();
  const reseedComparison = (
    previous: CorrelationBenchBaseline,
  ): { ok: boolean; reasons: string[] } => {
    const compare = (
      correlationBaseline as typeof correlationBaseline & {
        compareCorrelationBenchReseedToPrevious?: (
          live: CorrelationBenchReport,
          prior: CorrelationBenchBaseline,
        ) => { ok: boolean; reasons: string[] };
      }
    ).compareCorrelationBenchReseedToPrevious;
    assert.ok(compare, 'the CLI needs a dedicated previous-baseline reseed guard');
    return compare(report, previous);
  };

  it('refuses a candidate that regresses beyond the previous one-sided tolerance', () => {
    const previous = {
      ...baselineWithCausalEdges(committed, 17),
      reportDigest: 'a'.repeat(32),
    };
    const { ok, reasons } = reseedComparison(previous);
    assert.equal(ok, false);
    assert.ok(
      reasons.some((reason) => reason.includes('miner coupling precision regressed')),
      `expected the previous quality floor to reject the candidate: ${reasons.join(' | ')}`,
    );
    assert.ok(
      reasons.every((reason) => !reason.includes('reportDigest')),
      `a reseed must name the regression, not only identity drift: ${reasons.join(' | ')}`,
    );
  });

  it('allows a same-corpus improvement while replacing only reviewed exact anchors', () => {
    const previous: CorrelationBenchBaseline = {
      ...baselineWithCausalEdges(committed, 1, report),
      couplingRecall: round4(1 / committed.plantedCausalCount),
      pairPrecision: round4(1 / committed.distinctEnginePairCount),
      pairRecall: round4(1 / committed.truePairUniverse),
      edgeEvidenceSeparation: 1.5,
      meanTruePairConfidence: 0.1,
      learnedRulePairCount: 9999,
      reportDigest: 'a'.repeat(32),
      ruleCoverage: committed.ruleCoverage.slice(0, -1),
      witnessed: {
        ...committed.witnessed,
        meanCausalEdgeStrength: committed.witnessed.meanCausalEdgeStrength / 2,
        sectionDigests: {
          ...committed.witnessed.sectionDigests,
          edges: 'b'.repeat(32),
        },
      },
    };
    const { ok, reasons } = reseedComparison(previous);
    assert.deepEqual(reasons, []);
    assert.equal(ok, true);
  });

  it('fails closed when the previous baseline is malformed', () => {
    const malformed = {
      ...committed,
      reportDigest: 'not-a-digest',
      witnessed: {
        ...committed.witnessed,
        sectionDigests: { ...committed.witnessed.sectionDigests, pairs: 'missing' },
      },
    };
    const { ok, reasons } = reseedComparison(malformed);
    assert.equal(ok, false);
    assert.ok(reasons.some((reason) => reason.includes('previous reportDigest')));
    assert.ok(reasons.some((reason) => reason.includes('previous pairs ledger digest')));
  });

  it('refuses corpus drift instead of comparing incomparable measurements', () => {
    const drifted = { ...committed, corpusDigest: 'c'.repeat(32) };
    const { ok, reasons } = reseedComparison(drifted);
    assert.equal(ok, false);
    assert.ok(reasons.some((reason) => reason.includes('corpus content digest changed')));
  });

  it('keeps the built-in rule inventory pinned across a reseed', () => {
    const drifted = { ...committed, builtInRuleIds: committed.builtInRuleIds.slice(1) };
    const { ok, reasons } = reseedComparison(drifted);
    assert.equal(ok, false);
    assert.ok(reasons.some((reason) => reason.includes('built-in correlation rule set changed')));
  });

  it('refuses to reseed when a previously covered built-in rule goes dark', () => {
    const previouslyCovered = committed.builtInRuleIds.find(
      (id) => !report.ruleCoverage.includes(id),
    );
    assert.ok(previouslyCovered, 'fixture needs a registered rule outside live corpus coverage');
    const previous = {
      ...committed,
      ruleCoverage: [...committed.ruleCoverage, previouslyCovered].sort(),
    };
    const { ok, reasons } = reseedComparison(previous);
    assert.equal(ok, false);
    assert.ok(
      reasons.some((reason) => reason.includes('previously covered rule went dark')),
      reasons.join(' | '),
    );
  });

  it('makes --seed refuse a regression before emitting candidate JSON', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'crystalball-correlation-reseed-'));
    const previousPath = path.join(dir, 'previous.json');
    try {
      writeFileSync(
        previousPath,
        JSON.stringify({
          ...baselineWithCausalEdges(committed, 17),
          reportDigest: 'a'.repeat(32),
        }),
      );
      const child = spawnSync(
        process.execPath,
        [
          '--import', 'tsx', 'scripts/correlation-benchmark.mts', '--seed',
          '--previous-baseline', previousPath,
        ],
        { cwd: ROOT, encoding: 'utf8' },
      );
      assert.equal(child.status, 1, child.stderr);
      assert.equal(child.stdout, '', 'a refused seed must not emit candidate JSON');
      assert.match(child.stderr, /REFUSED/);
      assert.match(child.stderr, /miner coupling precision regressed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('directs every tracked-baseline replacement through a temporary candidate file', () => {
    const script = readFileSync(path.join(ROOT, 'scripts', 'correlation-benchmark.mts'), 'utf8');
    assert.doesNotMatch(
      script,
      /--seed\s*>\s*\$\{rel\}/,
      'operator guidance must never redirect stdout onto the tracked baseline before validation',
    );
    assert.match(script, /bench-correlation-baseline\.candidate\.json/);
  });

  it('guards a changed PR baseline against the base branch before the normal CI gate', () => {
    const workflow = readFileSync(path.join(ROOT, '.github', 'workflows', 'smoke.yml'), 'utf8');
    assert.match(workflow, /github\.event\.pull_request\.base\.sha/);
    assert.match(workflow, /github\.event\.merge_group\.base_sha/);
    assert.match(
      workflow,
      /if ! git cat-file -e "\$BASE_SHA\^\{commit\}"; then[\s\S]*?exit 1[\s\S]*?fi[\s\S]*?if ! git cat-file -e "\$BASE_SHA:\$BASELINE_PATH"/,
      'an unavailable base commit must fail closed before checking for an initial baseline',
    );
    assert.match(
      workflow,
      /if ! git cat-file -e "\$BASE_SHA:\$BASELINE_PATH"; then[\s\S]*?exit 0[\s\S]*?fi/,
      'the first baseline addition has no base-branch baseline to compare against',
    );
    assert.match(workflow, /git show "\$BASE_SHA:\$BASELINE_PATH"/);
    assert.match(workflow, /--seed --previous-baseline "\$PREVIOUS_BASELINE"/);
    assert.match(workflow, /> "\$RUNNER_TEMP\/bench-correlation-baseline\.candidate\.json"/);
  });
});

describe('the one-shot v11 to v12 migration gate', () => {
  const live = runCorrelationBenchmark();
  const previous: CorrelationBenchBaseline = {
    ...loadBaseline(),
    schemaVersion: 11,
    observationCount: 378,
    corpusDigest: '8411c23a6f009f2245ec779a7593685e',
    reportDigest: '4f63dfad203f2c37be09a1ec73d9d54d',
    couplingPrecision: 0.2273,
    couplingRecall: 1,
    minedEdgeCount: 256,
    significantEdgeCount: 22,
    falseEdgeCount: 17,
    edgeEvidenceSeparation: 8.4898,
    learnedRuleCount: 12,
    learnedRuleFalsePositives: 9,
    causalLearnedRuleCount: 3,
    learnedRulePairCount: 101,
    causalLearnedRulePairCount: 19,
    minCausalLearnedRulePairCount: 6,
  };
  const api = correlationBaseline as typeof correlationBaseline & {
    CORRELATION_BENCH_V11_TO_V12_MIGRATION?: unknown;
    validateCorrelationBenchV11ToV12Migration?: (
      report: CorrelationBenchReport,
      prior: CorrelationBenchBaseline,
      manifest: unknown,
    ) => { ok: boolean; reasons: string[] };
  };

  it('accepts only the pinned S9-only transition with all new gates armed', () => {
    assert.ok(api.CORRELATION_BENCH_V11_TO_V12_MIGRATION);
    assert.ok(api.validateCorrelationBenchV11ToV12Migration);
    const verdict = api.validateCorrelationBenchV11ToV12Migration(
      live,
      previous,
      api.CORRELATION_BENCH_V11_TO_V12_MIGRATION,
    );
    assert.deepEqual(verdict.reasons, []);
    assert.equal(verdict.ok, true);
  });

  it('rejects a migrated report whose learned execution path collapses behind one survivor', () => {
    assert.ok(api.validateCorrelationBenchV11ToV12Migration);
    const collapsed = {
      ...live,
      learnedRulePairCount: 1,
      causalLearnedRulePairCount: 1,
      causalLearnedRulePairsPerRule: [1, 0, 0, 0, 0],
      minCausalLearnedRulePairCount: 0,
      learnedPairs: [],
    };
    const verdict = api.validateCorrelationBenchV11ToV12Migration(
      collapsed,
      previous,
      api.CORRELATION_BENCH_V11_TO_V12_MIGRATION,
    );
    assert.equal(verdict.ok, false, verdict.reasons.join(' | '));
    assert.ok(
      verdict.reasons.some((reason) => reason.includes('causal learned rules went quiet')),
      verdict.reasons.join(' | '),
    );
    assert.ok(
      verdict.reasons.some((reason) => reason.includes('a causal learned rule went dark')),
      verdict.reasons.join(' | '),
    );
    assert.ok(
      verdict.reasons.some((reason) => reason.includes('learned-pair ledger accounts for 0')),
      verdict.reasons.join(' | '),
    );
  });

  it('rejects one dark causal learned rule even when aggregate learned volume stays healthy', () => {
    assert.ok(api.validateCorrelationBenchV11ToV12Migration);
    const counts = live.causalLearnedRuleIds.map(
      (ruleId, index) => [ruleId, index === live.causalLearnedRuleIds.length - 1 ? 0 : 8] as const,
    );
    const oneDarkRule = withLearnedPairRows(live, learnedRowsFor(live, counts));
    const verdict = api.validateCorrelationBenchV11ToV12Migration(
      oneDarkRule,
      previous,
      api.CORRELATION_BENCH_V11_TO_V12_MIGRATION,
    );
    assert.equal(verdict.ok, false, verdict.reasons.join(' | '));
    assert.ok(
      verdict.reasons.some((reason) => reason.includes('a causal learned rule went dark')),
      verdict.reasons.join(' | '),
    );
  });

  it('rejects collapsed built-in engine volume even when rates remain unchanged', () => {
    assert.ok(api.validateCorrelationBenchV11ToV12Migration);
    const collapsedEngine = {
      ...live,
      enginePairCount: 1,
      distinctEnginePairCount: 1,
    };
    const verdict = api.validateCorrelationBenchV11ToV12Migration(
      collapsedEngine,
      previous,
      api.CORRELATION_BENCH_V11_TO_V12_MIGRATION,
    );
    assert.equal(verdict.ok, false, verdict.reasons.join(' | '));
    assert.ok(
      verdict.reasons.some((reason) => reason.includes('distinct built-in pair emissions regressed')),
      verdict.reasons.join(' | '),
    );
  });

  it('fails closed on altered previous anchors, tolerances, manifest, family, or inhibition', () => {
    assert.ok(api.validateCorrelationBenchV11ToV12Migration);
    const validate = api.validateCorrelationBenchV11ToV12Migration;
    const manifest = api.CORRELATION_BENCH_V11_TO_V12_MIGRATION as Record<string, unknown>;
    const changed = manifest.changedStream as Record<string, unknown>;
    const unchanged = manifest.unchangedStreamDigests as Record<string, string>;
    const cases: Array<[string, CorrelationBenchReport, CorrelationBenchBaseline, unknown]> = [
      ['previous report anchor', live, { ...previous, reportDigest: 'a'.repeat(32) }, manifest],
      ['previous tolerance', live, {
        ...previous,
        tolerances: { ...previous.tolerances, couplingPrecisionDrop: 0.03 },
      }, manifest],
      ['changed stream id', live, previous, {
        ...manifest, changedStream: { ...changed, id: 'bursty-confounder' },
      }],
      ['empty reason', live, previous, {
        ...manifest, changedStream: { ...changed, reason: '' },
      }],
      ['unchanged stream anchor', live, previous, {
        ...manifest,
        unchangedStreamDigests: { ...unchanged, 'grid-storm': 'a'.repeat(32) },
      }],
      ['live unchanged stream drift', {
        ...live,
        streamDigests: { ...live.streamDigests, 'grid-storm': 'b'.repeat(32) },
      }, previous, manifest],
      ['invalid family', {
        ...live,
        multipleTestingFamily: { ...live.multipleTestingFamily, tails: 1 as 2 },
      }, previous, manifest],
      ['missing inhibitory precision', { ...live, inhibitoryPrecision: null }, previous, manifest],
      ['lost inhibitory recall', { ...live, inhibitoryRecall: 0 }, previous, manifest],
      ['inhibitory false positive', {
        ...live, inhibitoryFalsePositiveCount: 1,
      }, previous, manifest],
      ['candidate separation regression', {
        ...live, fixedCandidateEvidenceSeparation: 0,
      }, previous, manifest],
    ];

    for (const [label, report, prior, candidateManifest] of cases) {
      const verdict = validate(report, prior, candidateManifest);
      assert.equal(verdict.ok, false, label);
      assert.ok(verdict.reasons.length > 0, label);
    }
  });
});

/**
 * A probe reported two booleans and a sentence about fixtures the report did
 * not contain, so the fixtures were free to move underneath them.
 *
 * The demonstrated attack: move `n1b` off GDACS and delete the
 * earthquake-tsunami distance clause in the same commit. The positive still
 * matches. The near-miss still rejects — on the source gate now, not on the
 * radius it was written to test. The golden corpus carries no distance
 * counterexample, so nothing else notices, and `positiveMatched: true,
 * nearMissRejected: true` is reported about a clause that no longer exists.
 *
 * Round 13 closed the other half: one near-miss per rule tested ONE clause, so
 * every other guard the rule applies could be deleted with the probe still
 * reporting a clean rejection. Near-misses are now patches on the positive,
 * one per independently-defeatable clause.
 */
describe('rule probes pin the fixture, not only the verdict', () => {
  const report = runCorrelationBenchmark();
  const baseline = loadBaseline();

  it('gives every probe a well-formed fixture digest', () => {
    assert.ok(report.ruleProbes.length >= 9);
    for (const p of report.ruleProbes) {
      assert.match(p.fixtureDigest, /^[0-9a-f]{32}$/, p.ruleId);
    }
  });

  it('gives every rule a DIFFERENT fixture digest', () => {
    const digests = new Set(report.ruleProbes.map((p) => p.fixtureDigest));
    assert.equal(digests.size, report.ruleProbes.length);
  });

  it('covers more than one clause on every rule', () => {
    // The whole round-13 finding: a single near-miss is not coverage.
    for (const f of RULE_FIXTURES) {
      assert.ok(f.nearMisses.length >= 2, `${f.ruleId} tests ${f.nearMisses.length} clause(s)`);
      const clauses = new Set(f.nearMisses.map((m) => m.clause));
      assert.equal(clauses.size, f.nearMisses.length, `${f.ruleId} repeats a clause`);
    }
  });

  it('moves when a near-miss is re-aimed at a different clause', () => {
    const quake = RULE_FIXTURES.find((f) => f.ruleId === 'earthquake-tsunami')!;
    const before = digestRuleFixture(quake);
    // Codex's exact scenario: the near-miss now fails on SOURCE, not distance.
    const reaimed = {
      ...quake,
      nearMisses: quake.nearMisses.map((m, i) => (
        i === 0 ? { ...m, patch: { 1: { sourceId: 'some-other-feed' } } } : m
      )),
    };
    assert.notEqual(digestRuleFixture(reaimed), before);
  });

  it('moves when the near-miss RATIONALE is rewritten', () => {
    const first = RULE_FIXTURES[0]!;
    assert.notEqual(
      digestRuleFixture({
        ...first,
        nearMisses: first.nearMisses.map((m, i) => (
          i === 0 ? { ...m, clause: 'something else entirely' } : m
        )),
      }),
      digestRuleFixture(first),
    );
  });

  it('moves when a clause is dropped from the probe outright', () => {
    // Deleting a fixture is how a rule quietly stops being covered.
    const first = RULE_FIXTURES[0]!;
    assert.notEqual(
      digestRuleFixture({ ...first, nearMisses: first.nearMisses.slice(1) }),
      digestRuleFixture(first),
    );
  });

  it('moves on any single field of a positive fixture', () => {
    const first = RULE_FIXTURES[0]!;
    const before = digestRuleFixture(first);
    for (const key of ['sourceId', 'domain', 'offsetMs', 'severity'] as const) {
      const nudged = {
        ...first,
        positive: first.positive.map((e, i) => (
          i === 0
            ? { ...e, [key]: typeof e[key] === 'number' ? (e[key] as number) + 1 : `${e[key]}~` }
            : e
        )),
      };
      assert.notEqual(digestRuleFixture(nudged as typeof first), before, key);
    }
  });

  it('records the edge type and direction the positive fixture actually emitted', () => {
    // Five rules never fire over the corpus, so this is the ONLY observation of
    // what they assert. While the probe carried booleans alone, inverting
    // airquality-wildfire to `contradicts` moved no number in the report.
    const known = new Set(['co-located', 'temporally-adjacent', 'causal-candidate', 'contradicts']);
    for (const p of report.ruleProbes) {
      assert.ok(known.has(p.positiveEdgeType ?? ''), `${p.ruleId}: ${p.positiveEdgeType}`);
      assert.match(p.positiveDirection ?? '', /^\S+→\S+$/, p.ruleId);
    }
  });

  it('holds still when only the KEY ORDER of a fixture event changes', () => {
    // Otherwise a harmless reshuffle inside `ev()` reads as nine simultaneous
    // regressions and the next reviewer learns to re-seed without looking.
    const first = RULE_FIXTURES[0]!;
    const reordered = {
      ...first,
      positive: first.positive.map((e) => Object.fromEntries(
        Object.entries(e).reverse(),
      ) as typeof e) as unknown as typeof first.positive,
    };
    assert.equal(digestRuleFixture(reordered), digestRuleFixture(first));
  });

  it('refuses a probe carrying no fixture digest', () => {
    const forged = {
      ...report,
      ruleProbes: report.ruleProbes.map((p, i) => (
        i === 0 ? { ...p, fixtureDigest: '' } : p
      )),
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(forged, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('carries no fixture digest')));
  });

  it('names the probe ledger — not the whole report — when a fixture moves', () => {
    const forged = {
      ...report,
      ruleProbes: report.ruleProbes.map((p, i) => (
        i === 0 ? { ...p, fixtureDigest: 'f'.repeat(32) } : p
      )),
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(forged, baseline);
    assert.equal(ok, false);
    // Round 14 added an independent re-execution that runs BEFORE the ledger
    // digests and short-circuits, so a moved fixture is now named by whichever
    // of the two speaks first. Both name the probe ledger rather than the
    // whole report, which is what this test is about.
    assert.ok(
      reasons.some((r) => r.startsWith('probes ledger digest moved')
        || /reports fixtureDigest/.test(r)),
      reasons.join(' | '),
    );
  });
});

/**
 * The pair ledger keyed emissions by an ORDER-INDEPENDENT key and recorded a
 * rule id and a confidence — so the two things the engine actually asserts
 * about a pair, its direction and its edge type, were erased before hashing.
 *
 * Production does not treat those as interchangeable: `situation-store-v2`
 * maps both into the evidence graph, so flipping `causal-candidate A→B` to
 * `contradicts B→A` changes what the user is told. It used to change nothing
 * here.
 */
describe('the pair ledger keeps direction and edge type', () => {
  const report = runCorrelationBenchmark();
  const baseline = loadBaseline();

  it('records a known edge type and this pair"s own endpoints per emission', () => {
    const known = ['co-located', 'temporally-adjacent', 'causal-candidate', 'contradicts'];
    for (const row of report.pairs) {
      assert.ok(row.emissions.length > 0, row.key);
      for (const e of row.emissions) {
        assert.ok(known.includes(e.edgeType), `${row.key}: ${e.edgeType}`);
        assert.equal(pairKeyFor(e.fromId, e.toId), row.key);
        assert.notEqual(e.fromId, e.toId);
      }
    }
  });

  it('at least one emission is directed against the sorted key order', () => {
    // Without this the "directed" fields could be the sorted endpoints under
    // another name, and every inversion test below would pass on a tautology.
    const flipped = report.pairs.flatMap((p) => p.emissions).filter((e) => e.fromId > e.toId);
    assert.ok(flipped.length > 0, 'no emission runs against sort order — direction is not carried');
  });

  it('moves the report digest when every emission is INVERTED', () => {
    const inverted = {
      ...report,
      pairs: report.pairs.map((p) => ({
        ...p,
        emissions: p.emissions.map((e) => ({ ...e, fromId: e.toId, toId: e.fromId })),
      })),
    };
    assert.notEqual(benchReportDigest(inverted), baseline.reportDigest);
  });

  it('moves the report digest when an edge type is rewritten', () => {
    const contradicted = {
      ...report,
      pairs: report.pairs.map((p) => ({
        ...p,
        emissions: p.emissions.map((e) => ({ ...e, edgeType: 'contradicts' as const })),
      })),
    };
    assert.notEqual(benchReportDigest(contradicted), baseline.reportDigest);
  });

  it('refuses an emission pointing at events that are not this pair', () => {
    const stray = withPairLedger(report, report.pairs.map((p, i) => (
      i === 0
        ? { ...p, emissions: p.emissions.map((e) => ({ ...e, toId: 'no-such-event' })) }
        : p
    )));
    const { ok, reasons } = compareCorrelationBenchToBaseline(stray, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('do not build')));
  });

  it('refuses an edge type the engine cannot produce', () => {
    const bogus = withPairLedger(report, report.pairs.map((p, i) => (
      i === 0
        ? {
          ...p,
          emissions: p.emissions.map((e) => ({
            ...e, edgeType: 'definitely-caused' as unknown as typeof e.edgeType,
          })),
        }
        : p
    )));
    const { ok, reasons } = compareCorrelationBenchToBaseline(bogus, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('the engine cannot produce')));
  });
});

/**
 * `reportDigest` pins every number in the report. What it does not do is show
 * them: following the re-seed workflow after deleting a summary field produced
 * a diff in which one opaque 32-character string changed and nothing else.
 */
describe('the baseline itemises what the digest anchors', () => {
  const report = runCorrelationBenchmark();
  const baseline = loadBaseline();

  it('commits the advertised measurements by value', () => {
    assert.deepEqual(baseline.witnessed, benchWitnessedFields(report));
    assert.equal(typeof baseline.witnessed.meanCausalEdgeStrength, 'number');
    assert.match(baseline.witnessed.sectionDigests.pairs, /^[0-9a-f]{32}$/);
  });

  it('refuses a baseline with no witnessed block at all', () => {
    const { witnessed: _dropped, ...rest } = baseline;
    const { ok, reasons } = compareCorrelationBenchToBaseline(
      report, rest as CorrelationBenchBaseline,
    );
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('no "witnessed" block')));
  });

  it('NAMES the moved measurement instead of only reporting a digest', () => {
    const forged = { ...report, meanCausalEdgeZ: report.meanCausalEdgeZ + 1 };
    const { reasons } = compareCorrelationBenchToBaseline(forged, baseline);
    assert.ok(
      reasons.some((r) => r.startsWith('meanCausalEdgeZ moved from')),
      `expected a named reason, got ${JSON.stringify(reasons)}`,
    );
  });

  it('names the ledger that moved, not just that something did', () => {
    const forged = withPairLedger(report, report.pairs.map((p, i) => (
      i === 0
        ? { ...p, emissions: p.emissions.map((e) => ({ ...e, confidence: 0.4321 })) }
        : p
    )));
    const { reasons } = compareCorrelationBenchToBaseline(forged, baseline);
    assert.ok(reasons.some((r) => r.startsWith('pairs ledger digest moved')));
    assert.ok(!reasons.some((r) => r.startsWith('edges ledger digest moved')));
  });
});

/**
 * Round 13: the round-12 fixes each covered half of the surface they named.
 *
 * Every case below was demonstrated against the schemaVersion-10 gate as a
 * clean `{ok: true, reasons: []}` before the fix, so each test is a recording
 * of a forgery that used to work rather than a hypothesis about one.
 */
describe('round 13 — the halves round 12 missed', () => {
  const report = runCorrelationBenchmark();
  const baseline = loadBaseline();

  it('moves the digest when LEARNED rules invert their assertion', () => {
    // The pair ledger kept edge type; the learned ledger counted. Rewriting
    // every learned rule to the opposite claim left 101 rows byte-identical.
    const flipped = {
      ...report,
      learnedPairs: report.learnedPairs.map((r) => ({
        ...r,
        emissions: r.emissions.map((e) => ({ ...e, edgeType: 'contradicts' as const })),
      })),
    };
    assert.notEqual(benchReportDigest(flipped), baseline.reportDigest);
  });

  it('moves the digest when a learned emission is REVERSED', () => {
    const reversed = {
      ...report,
      learnedPairs: report.learnedPairs.map((r) => ({
        ...r,
        emissions: r.emissions.map((e) => ({ ...e, fromId: e.toId, toId: e.fromId })),
      })),
    };
    assert.notEqual(benchReportDigest(reversed), baseline.reportDigest);
  });

  it('rejects a learned emission whose endpoints are not this row"s pair', () => {
    const strayed = {
      ...report,
      learnedPairs: report.learnedPairs.map((r, i) => (
        i === 0
          ? { ...r, emissions: r.emissions.map((e) => ({ ...e, toId: 'no-such-event' })) }
          : r
      )),
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(strayed, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('learned')), reasons.join(' | '));
  });

  it('moves the digest when a rule the CORPUS never exercises inverts', () => {
    // Five of nine rules never fire over the golden corpus, so their probe row
    // is the only place their semantics are observed at all.
    const exercised = new Set(report.pairs.flatMap((p) => p.emissions.map((e) => e.ruleId)));
    const dark = report.ruleProbes.filter((p) => !exercised.has(p.ruleId));
    assert.ok(dark.length >= 4, `only ${dark.length} rules are dark to the corpus`);
    const forged = {
      ...report,
      ruleProbes: report.ruleProbes.map((p) => (
        p.ruleId === dark[0]!.ruleId ? { ...p, positiveEdgeType: 'contradicts' } : p
      )),
    };
    assert.notEqual(benchReportDigest(forged), baseline.reportDigest);
  });

  it('refuses a probe reporting an edge type the engine cannot emit', () => {
    const forged = {
      ...report,
      ruleProbes: report.ruleProbes.map((p, i) => (
        i === 0 ? { ...p, positiveEdgeType: 'vibes' } : p
      )),
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(forged, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('assertion being inverted')), reasons.join(' | '));
  });

  it('refuses a probe that reports no direction for its positive', () => {
    const forged = {
      ...report,
      ruleProbes: report.ruleProbes.map((p, i) => (
        i === 0 ? { ...p, positiveDirection: null } : p
      )),
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(forged, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('not interchangeable')), reasons.join(' | '));
  });

  it('gives every clause a fixture that differs from the positive', () => {
    // A near-miss identical to the positive would "reject" nothing; a patch
    // that names a field it does not change is the silent version of that.
    for (const f of RULE_FIXTURES) {
      const pos = JSON.stringify(positiveEvents(f));
      for (const m of f.nearMisses) {
        assert.notEqual(JSON.stringify(nearMissEvents(f, m)), pos, `${f.ruleId}: ${m.clause}`);
      }
    }
  });

  it('refuses a probe carrying fewer than two clauses', () => {
    const thin = {
      ...report,
      ruleProbes: report.ruleProbes.map((p, i) => (
        i === 0 ? { ...p, nearMisses: p.nearMisses.slice(0, 1) } : p
      )),
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(thin, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('near-miss')), reasons.join(' | '));
  });

  it('refuses a probe that pads its clause count by repeating one', () => {
    const padded = {
      ...report,
      ruleProbes: report.ruleProbes.map((p, i) => (
        i === 0 ? { ...p, nearMisses: [p.nearMisses[0]!, p.nearMisses[0]!] } : p
      )),
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(padded, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('near-miss')), reasons.join(' | '));
  });

  it('rejects the comma-join forgery of a witnessed list', () => {
    // `['macro->maritime','space->infra'].join(',')` and the single element
    // 'macro->maritime,space->infra' are the same string. They are not the
    // same claim, and the schemaVersion-10 gate passed the second one.
    const lost = ['macro->maritime', 'space->infra'];
    const forged = {
      ...baseline,
      witnessed: { ...baseline.witnessed, causalCouplingsLostToCap: [lost.join(',')] },
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(report, forged);
    assert.equal(ok, false);
    assert.ok(
      reasons.some((r) => r.includes('causalCouplingsLostToCap')),
      reasons.join(' | '),
    );
  });
});

describe('round 14 — the gate stops taking the producer at its word', () => {
  const report = runCorrelationBenchmark();
  const baseline = loadBaseline();

  it('re-derives every probe verdict independently of the producer', () => {
    // The finding: replacing all 73 near-miss executions with the constant
    // `rejected: true` reproduced the digest exactly, because the honest output
    // and the forged output are the same bytes. No output pin can separate
    // them — only a second executor can.
    const mine = verifyRuleProbes();
    assert.equal(mine.length, report.ruleProbes.length);
    assert.deepEqual(
      mine.map((p) => p.ruleId),
      report.ruleProbes.map((p) => p.ruleId),
    );
    for (const [i, p] of mine.entries()) {
      assert.deepEqual(p, report.ruleProbes[i], `probe ${p.ruleId} disagrees with the report`);
    }
  });

  it('fails when the report claims a near-miss the engine actually matched', () => {
    const forged = {
      ...report,
      ruleProbes: report.ruleProbes.map((p, i) => (
        i === 0
          ? { ...p, nearMisses: p.nearMisses.map((n) => ({ ...n, rejected: !n.rejected })) }
          : p
      )),
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(forged, baseline);
    assert.equal(ok, false);
    assert.ok(
      reasons.some((r) => r.includes('does not reproduce')),
      reasons.join(' | '),
    );
  });

  it('the verdicts do not depend on the instant they are graded at', () => {
    // `now` reaches only `detectedAt`, so a different instant must not move a
    // single match. If it ever does, the fixtures have drifted into the engine's
    // recency behaviour and the probe stopped being a pure matcher test.
    const later = verifyRuleProbes(new Date(Date.UTC(2027, 0, 9, 4, 30, 0)));
    assert.deepEqual(later, verifyRuleProbes());
  });

  it('every rule matches its positive fed BACK TO FRONT', () => {
    // `correlate-engine.ts:177` tries (b, a) when (a, b) misses. Every corpus
    // and fixture was antecedent-first, so deleting that branch changed nothing.
    for (const p of report.ruleProbes) {
      assert.equal(p.reversedMatched, true, `${p.ruleId} does not survive reversed input`);
    }
  });

  it('fails when a reversed positive stops matching', () => {
    const forged = {
      ...report,
      ruleProbes: report.ruleProbes.map((p, i) => (
        i === 0 ? { ...p, reversedMatched: false, reversedDirection: null } : p
      )),
    };
    const { ok } = compareCorrelationBenchToBaseline(forged, baseline);
    assert.equal(ok, false);
  });

  it('exercises every accepted branch of every disjunctive matcher', () => {
    // A positive that satisfies BOTH branches of an OR and a near-miss that
    // defeats both cannot see one branch being lost. Each branch gets its own
    // isolated positive.
    // Pinned per rule, OUTSIDE the fixture roster both the producer and the
    // independent executor read. `>= 4` let three rules lose every disjunct
    // they have and still pass, because both witnesses would simply stop
    // asking about them together.
    const EXPECTED_BRANCH_COUNTS: Readonly<Record<string, number>> = {
      'airquality-wildfire': 2,
      'conflict-displacement': 4,
      'earthquake-infrastructure': 2,
      'earthquake-tsunami': 1,
      'space-weather-infrastructure': 4,
      'weather-aviation': 1,
      'weather-wildfire': 3,
    };
    const withBranches = report.ruleProbes.filter((p) => p.disjuncts.length > 0);
    assert.deepEqual(
      Object.fromEntries(withBranches.map((p) => [p.ruleId, p.disjuncts.length])),
      EXPECTED_BRANCH_COUNTS,
      'the disjunct roster moved — add or remove the pin in a reviewed diff',
    );
    for (const p of withBranches) {
      for (const d of p.disjuncts) {
        assert.equal(d.matched, true, `${p.ruleId} lost branch ${d.branch}`);
      }
    }
  });

  it('fails when one accepted branch of a disjunction stops matching', () => {
    const idx = report.ruleProbes.findIndex((p) => p.disjuncts.length > 0);
    const forged = {
      ...report,
      ruleProbes: report.ruleProbes.map((p, i) => (
        i === idx
          ? { ...p, disjuncts: p.disjuncts.map((d, j) => (j === 0 ? { ...d, matched: false } : d)) }
          : p
      )),
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(forged, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('branch')), reasons.join(' | '));
  });

  it('moves the digest when a pair is emitted at the epoch', () => {
    const stale = {
      ...report,
      pairs: report.pairs.map((r) => ({
        ...r,
        emissions: r.emissions.map((e) => ({ ...e, detectedAtMs: 0 })),
      })),
    };
    assert.notEqual(benchReportDigest(stale), baseline.reportDigest);
    const { ok, reasons } = compareCorrelationBenchToBaseline(stale, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('detectedAt')), reasons.join(' | '));
  });

  it('fails when the confidence BREAKDOWN disappears behind the scalar', () => {
    const flat = {
      ...report,
      pairs: report.pairs.map((r) => ({
        ...r,
        emissions: r.emissions.map((e) => ({ ...e, confidenceDetailDigest: null })),
      })),
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(flat, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('breakdown')), reasons.join(' | '));
  });

  it('projects every pair into the evidence graph the store really builds', () => {
    for (const row of report.pairs) {
      for (const e of row.emissions) {
        const edge = pairToEdge({
          ruleId: e.ruleId,
          edgeType: e.edgeType,
          eventA: { id: e.fromId } as never,
          eventB: { id: e.toId } as never,
          confidence: e.confidence,
          detectedAt: new Date(e.detectedAtMs),
        } as never);
        assert.equal(e.evidenceEdgeType, edge.type);
        assert.equal(e.evidenceFromId, edge.sourceEventId);
        assert.equal(e.evidenceToId, edge.targetEventId);
      }
    }
  });

  it('fails when the projection contradicts the engine it came from', () => {
    // EDGE_TYPE_MAP inverted: real situation edges asserting the opposite
    // relationship, with every benchmark number unchanged.
    const inverted = {
      ...report,
      pairs: report.pairs.map((r) => ({
        ...r,
        emissions: r.emissions.map((e) => ({ ...e, evidenceEdgeType: 'contradicts' })),
      })),
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(inverted, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('evidence graph')), reasons.join(' | '));
  });

  it('proves a retired learned rule actually leaves the engine', () => {
    const p = report.learnedRuleResync;
    assert.ok(p.installed.length >= 2);
    assert.ok(p.installed.includes(p.retiredId));
    assert.ok(!p.afterRetirement.includes(p.retiredId));
    assert.equal(p.afterRetirement.length, p.installed.length - 1);
    assert.equal(p.reportedRemoved, 1);
    assert.equal(p.reportedAdded, 0);
    assert.equal(p.builtInsIntact, true);
  });

  it('fails when a retired rule stays registered but is reported removed', () => {
    const stuck = {
      ...report,
      learnedRuleResync: {
        ...report.learnedRuleResync,
        afterRetirement: report.learnedRuleResync.installed,
      },
    };
    const { ok, reasons } = compareCorrelationBenchToBaseline(stuck, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some((r) => r.includes('still registered')), reasons.join(' | '));
  });

  const scriptPath = path.join(here, '..', '..', '..', '..', 'scripts', 'correlation-benchmark.mts');
  const repoRoot = path.join(here, '..', '..', '..', '..');

  it('refuses to re-seed against a --previous-baseline whose tolerance the live run actually violates', () => {
    // Round 15: the prior version of this test only ran --seed against the
    // committed baseline, which passes today, so it could not distinguish a
    // working refusal path from one that always prints "Seeded" — a CLI that
    // never compared anything would satisfy the old assertion. This
    // constructs a previous baseline whose couplingPrecisionDrop tolerance is
    // zero and whose couplingPrecision is set one full point above what the
    // live corpus can possibly score (precision is a fraction, so 1.5 is
    // unreachable), which forces `checkDrop` to fire for real.
    const committed = loadBaseline();
    const dir = mkdtempSync(path.join(tmpdir(), 'acc501-broken-tolerance-'));
    const brokenPath = path.join(dir, 'broken-previous-baseline.json');
    try {
      const broken: CorrelationBenchBaseline = {
        ...committed,
        couplingPrecision: 1.5,
        tolerances: { ...committed.tolerances, couplingPrecisionDrop: 0 },
      };
      writeFileSync(brokenPath, JSON.stringify(broken, null, 2));

      const seed = spawnSync(
        'npx',
        ['tsx', scriptPath, '--seed', '--previous-baseline', brokenPath],
        { encoding: 'utf8', cwd: repoRoot },
      );

      assert.equal(seed.status, 1, `${seed.stdout}${seed.stderr}`.slice(-600));
      assert.match(seed.stderr, /REFUSED/);
      assert.match(seed.stderr, /miner coupling precision/);
      // A refusal must not also hand back a usable candidate on stdout.
      assert.doesNotMatch(seed.stdout, /"schemaVersion"/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('seeds cleanly against a --previous-baseline the live run genuinely satisfies', () => {
    // The counterpart to the refusal case above: the same
    // --previous-baseline mechanism, but pointed at an unmodified, internally
    // consistent copy of the reviewed baseline (which today's live run
    // legitimately meets), so the positive control proves the comparator ran
    // and passed on its own merits rather than the CLI having skipped it.
    const committed = loadBaseline();
    const dir = mkdtempSync(path.join(tmpdir(), 'acc501-satisfied-tolerance-'));
    const copyPath = path.join(dir, 'unmodified-previous-baseline.json');
    try {
      writeFileSync(copyPath, JSON.stringify(committed, null, 2));

      const seed = spawnSync(
        'npx',
        ['tsx', scriptPath, '--seed', '--previous-baseline', copyPath],
        { encoding: 'utf8', cwd: repoRoot },
      );

      assert.equal(seed.status, 0, `${seed.stdout}${seed.stderr}`.slice(-600));
      assert.match(seed.stderr, /Seeded from the current run/);
      assert.doesNotMatch(seed.stderr, /REFUSED/);
      const seeded = JSON.parse(seed.stdout) as CorrelationBenchBaseline;
      assert.equal(typeof seeded.schemaVersion, 'number');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('round 15 — the v12→v13 schema bump is a pinned migration, not a skipped check', () => {
  const report = runCorrelationBenchmark();
  const committed = loadBaseline();
  const carriedOver = { note: committed.note, tolerances: committed.tolerances };
  const manifest = correlationBaseline.CORRELATION_BENCH_V12_TO_V13_MIGRATION;

  // The reviewed v12 baseline differed from today's only in schemaVersion,
  // seededAt, and reportDigest — that IS the claim the migration makes. The
  // reconstruction is only admissible because `previousPayloadDigest` pins it:
  // if any forbidden field differed from the real reviewed v12 baseline, this
  // object would digest to something else and the validator would refuse it.
  // The test below asserts exactly that before using it.
  const previousV12 = (): correlationBaseline.CorrelationBenchBaseline => ({
    ...seedCorrelationBenchBaseline(report, carriedOver, committed.seededAt),
    schemaVersion: 12,
    reportDigest: manifest.previousReportDigest,
  } as unknown as correlationBaseline.CorrelationBenchBaseline);

  it('reconstructs the reviewed v12 payload exactly — the pin says so', () => {
    assert.equal(
      correlationBaseline.benchBaselinePayloadDigest(previousV12()),
      manifest.previousPayloadDigest,
    );
  });

  it('refuses a previous baseline whose payload is not the reviewed one', () => {
    // The reviewer moved minedEdgeCount in BOTH the report and the supplied
    // previous baseline and the field-by-field loop compared the moved value to
    // itself. The payload pin is what makes that self-consistent forgery fail.
    const { ok, reasons } = correlationBaseline.validateCorrelationBenchV12ToV13Migration(
      { ...report, minedEdgeCount: report.minedEdgeCount + 1 },
      { ...previousV12(), minedEdgeCount: report.minedEdgeCount + 1 },
      manifest,
    );
    assert.equal(ok, false);
    assert.match(reasons.join(' '), /does not carry the reviewed v12 payload/);
  });

  it('sees a forbidden field that was DROPPED, not just moved', () => {
    const prev = previousV12() as unknown as Record<string, unknown>;
    delete prev['minedEdgeCount'];
    const { ok, reasons } = correlationBaseline.validateCorrelationBenchV12ToV13Migration(
      report,
      prev as unknown as correlationBaseline.CorrelationBenchBaseline,
      manifest,
    );
    assert.equal(ok, false);
    assert.match(reasons.join(' '), /minedEdgeCount moved|reviewed v12 payload/);
  });

  it('accepts the real additive transition', () => {
    const { ok, reasons } = correlationBaseline.validateCorrelationBenchV12ToV13Migration(
      report,
      previousV12(),
      manifest,
    );
    assert.equal(ok, true, JSON.stringify(reasons));
  });

  it('refuses a manifest that is not the pinned one', () => {
    const { ok, reasons } = correlationBaseline.validateCorrelationBenchV12ToV13Migration(
      report,
      previousV12(),
      { ...manifest, reason: 'trust me' },
    );
    assert.equal(ok, false);
    assert.match(reasons.join(' '), /manifest does not match/);
  });

  it('refuses a source that is not the reviewed v12 baseline', () => {
    const { ok, reasons } = correlationBaseline.validateCorrelationBenchV12ToV13Migration(
      report,
      { ...previousV12(), reportDigest: 'f'.repeat(32) },
      manifest,
    );
    assert.equal(ok, false);
    assert.match(reasons.join(' '), /not the reviewed v12 report/);
  });

  it('refuses a source whose corpus digest is not the reviewed corpus', () => {
    const { ok, reasons } = correlationBaseline.validateCorrelationBenchV12ToV13Migration(
      report,
      { ...previousV12(), corpusDigest: 'e'.repeat(32) },
      manifest,
    );
    assert.equal(ok, false);
    assert.match(reasons.join(' '), /not the reviewed v12 corpus/);
  });

  it('refuses a graded metric that moved under cover of the schema bump', () => {
    const { ok, reasons } = correlationBaseline.validateCorrelationBenchV12ToV13Migration(
      report,
      { ...previousV12(), pairPrecision: 0.123456 },
      manifest,
    );
    assert.equal(ok, false);
    assert.match(reasons.join(' '), /additive-only, but pairPrecision moved/);
  });

  it('refuses a report digest that did not move — nothing was added', () => {
    const seeded = seedCorrelationBenchBaseline(report, carriedOver, committed.seededAt);
    const { ok, reasons } = correlationBaseline.validateCorrelationBenchV12ToV13Migration(
      report,
      { ...previousV12(), reportDigest: seeded.reportDigest },
      { ...manifest, previousReportDigest: seeded.reportDigest },
    );
    assert.equal(ok, false);
    assert.match(reasons.join(' '), /manifest does not match|digest did not move/);
  });

  it('pins the migration to exactly one hop', () => {
    assert.equal(manifest.fromSchemaVersion, 12);
    assert.equal(manifest.toSchemaVersion, 13);
    assert.equal(manifest.toSchemaVersion, CORRELATION_BENCH_SCHEMA_VERSION);
  });
});
