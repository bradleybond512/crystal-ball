/**
 * Correlation Benchmark (ACC-501) — replays the frozen golden streams through
 * the REAL correlation stack and grades the result against planted truth.
 *
 * Nothing here is a stand-in: the miner is `mineLeadLag` + `significantEdges`
 * exactly as `cascade-registration.computeSignificantEdges` calls them, the
 * rule builder is `learnedRulesFromEdges`, and the scorer is a live
 * `CorrelateEngine` carrying the shipped `builtInCorrelationRules`. A change
 * to any of those moves these numbers, which is the entire point.
 *
 * Two engine passes are reported because they answer different questions:
 *
 *   pass A — built-in rules only. Planted event-level truth is well defined
 *            here, so this is where pair precision / recall / decoy leakage /
 *            confidence separation are measured.
 *   pass B — built-ins plus the learned rules mined from this same corpus,
 *            i.e. the production configuration after a mining cycle. Only the
 *            learned-rule pair VOLUME is reported: a learned rule descended
 *            from a confounded or mediated edge sprays spurious pairs across
 *            two whole domains, and that volume is what ACC-503 / ACC-504
 *            have to bring down.
 *
 * Pure deterministic: fixed corpus, injected `timer: () => 0`, fixed `now`.
 * No DOM, no fetch, no clock reads, no Math.random.
 *
 * Consumers:
 *   - scripts/correlation-benchmark.mts (`npm run bench:correlation`, CI gate)
 *   - src/services/correlation/__tests__/bench-correlation.test.mts
 */

import type { ObservationEvent } from '@/types/intelligence';
import {
  CorrelateEngine, type CorrelatedPair, type CorrelationRule, type EdgeType,
} from '../intelligence/correlate-engine';
import { builtInCorrelationRules } from '../intelligence/built-in-correlation-rules';
import { pairToEdge } from '../intelligence/situation-store-v2';
import {
  mineLeadLag,
  type InhibitoryLeadLagEdge,
  type LeadLagEdge,
  type MultipleTestingFamily,
} from './lead-lag';
import {
  learnedRulesFromEdges,
  learnedRuleId,
  syncLearnedRules,
  LEARNED_RULE_PREFIX,
} from './learned-rules';
import {
  allGoldenObservations,
  decoyEventIds,
  digestRecords,
  goldenCorpusDigest,
  goldenStreamDigests,
  pairKeyFor,
  plantedCouplingIndex,
  plantedTruePairKeys,
  CORPUS_T0,
  CORPUS_SPAN_DAYS,
  GOLDEN_STREAMS,
  PLANTED_COUPLINGS,
  type PlantedCouplingKind,
} from './__bench__/golden-streams';
import { probeBuiltInRules, type BenchRuleProbe } from './__bench__/rule-probes';

export type { BenchRuleProbe } from './__bench__/rule-probes';

const DAY_MS = 86_400_000;

/** Fixed evaluation instant — one corpus span after T0. Never a clock read. */
const BENCH_NOW = new Date(CORPUS_T0 + CORPUS_SPAN_DAYS * DAY_MS);

/** How a significant edge was graded against planted truth. */
export type EdgeVerdict = PlantedCouplingKind | 'unplanted';

export interface BenchEdgeRow {
  from: string;
  to: string;
  verdict: EdgeVerdict;
  support: number;
  antecedents: number;
  /** null when the mined lift is non-finite (zero chance rate). */
  lift: number | null;
  /** null when the mined z-score is non-finite. */
  zScore: number | null;
  strength: number;
  windowHours: number;
  /** Whether this edge survived the MAX_LEARNED_RULES cap into a live rule. */
  becameLearnedRule: boolean;
}

export interface BenchInhibitoryEdgeRow {
  id: `inhibits:${string}->${string}`;
  from: string;
  to: string;
  windowMs: number;
  antecedents: number;
  support: number;
  followRate: number;
  expectedRate: number;
  lift: number;
  zScore: number;
  strength: number;
  verdict: 'inhibitory' | 'false-positive';
  explanation: string;
}

/**
 * One RAW emission of a pair, with the semantics the engine attached to it.
 *
 * The ledger used to record an emission as a rule id and a confidence, keyed by
 * an ORDER-INDEPENDENT pair key — so the two things the engine actually asserts
 * about a pair, its direction and its edge type, were erased before hashing.
 * Rewriting a rule from `causal-candidate cause→effect` to `contradicts
 * effect→cause` left every row, every count and the report digest byte-identical
 * (measured, not hypothesised). Production does not treat those as the same
 * claim: `situation-store-v2.ts:335` maps both the endpoint order and the edge
 * type into the evidence graph, so an inversion there changes what the user is
 * told while the benchmark reads unchanged.
 *
 * The pair KEY stays unordered on purpose — planted truth is a statement about
 * two events being related, not about which came first — so direction lives
 * here, per emission, where the engine produced it.
 */
export interface BenchPairEmission {
  ruleId: string;
  /** The engine's claim about the pair — a semantic, not a formatting detail. */
  edgeType: EdgeType;
  /** Emission endpoints in EMISSION order, not sorted: `fromId` → `toId`. */
  fromId: string;
  toId: string;
  confidence: number;
  /**
   * `detectedAt` as epoch ms — the pair's own recency, which downstream filters
   * on.
   *
   * Constant here by construction (the benchmark injects a fixed `now`), and
   * pinned anyway: replacing `correlate-engine.ts:136`'s `detectedAt: now` with
   * `new Date(0)` left every count, every rate and the report digest identical,
   * while live pairs would have been discarded as ancient the moment they were
   * emitted.
   */
  detectedAtMs: number;
  /**
   * Digest over the confidence FACTORS, not just the scalar they collapse to.
   *
   * `confidence` is one number six factors multiply into, so dropping
   * `confidenceDetail` entirely preserved it — and with it every mean, every
   * separation and the digest — while the analyst-facing explanation and the
   * factor chips silently became undefined. `null` when the emission carries no
   * detail at all, which is itself the regression, visible as a moved digest.
   */
  confidenceDetailDigest: string | null;
  /**
   * The evidence-graph edge type SituationStoreV2 projects this pair to, via the
   * real `pairToEdge()`. `edgeType` above is the engine's raw claim; this is
   * what the analyst is actually told.
   */
  evidenceEdgeType: string;
  /** Projected endpoints — direction survives the translation, or it does not. */
  evidenceFromId: string;
  evidenceToId: string;
}

/**
 * One DISTINCT emitted event pair, with every emission that produced it.
 *
 * The pair summaries — `enginePairCount`, `distinctEnginePairCount`,
 * `pairPrecision`, `pairRecall`, `decoyPairsEmitted`, `meanTruePairConfidence`
 * — were six numbers produced by one pass with nothing behind them: hand-set
 * them coherently and the gate had no independent witness to contradict. This
 * ledger is that witness, so every one of those summaries is re-derivable from
 * row-level detail rather than merely self-consistent.
 */
export interface BenchPairRow {
  /** Order-independent event-pair key, as `pairKeyFor` builds it. */
  key: string;
  /**
   * The two event ids behind `key`, sorted, so the gate can REBUILD the key and
   * re-look-up planted truth rather than believe the three fields below. A row
   * that carries only its own conclusions is an assertion, not evidence.
   */
  eventIdA: string;
  eventIdB: string;
  /** One entry per RAW emission — two rules matching one pair is two entries. */
  emissions: BenchPairEmission[];
  /** Whether this pair is in the planted true-pair set. */
  isTruePair: boolean;
  /** Emissions of this pair that touched a near-miss decoy event. */
  decoyEmissions: number;
}

/**
 * One DISTINCT event pair emitted by ONE learned rule in pass B.
 *
 * Pass B used to report four bare counters — total pair volume, the causal
 * subset, the per-rule breakdown and its minimum — reconciled against nothing.
 * Forcing pass B to emit no pairs at all and restoring only those four numbers
 * produced a clean PASS: a dead synthesize → install → match path reads exactly
 * like a live one. The counters are now derived from these rows.
 */
export interface BenchLearnedPairRow {
  /** The emitting `learned:*` rule. */
  ruleId: string;
  key: string;
  /** The two event ids behind `key`, sorted, so the gate can rebuild it. */
  eventIdA: string;
  eventIdB: string;
  /**
   * Raw emissions, each carrying its own claim.
   *
   * A count is not a ledger of claims. While this was `emissions: number`,
   * rewriting every learned rule from `causal-candidate` to `contradicts` — the
   * opposite assertion, and a different evidence edge downstream — left all 101
   * rows and the report digest byte-identical. Same reason `BenchPairRow` keeps
   * `BenchPairEmission[]`; the learned ledger had simply been missed.
   */
  emissions: BenchPairEmission[];
}

export interface CorrelationBenchReport {
  // ── corpus identity (exact-equality drift detection) ──
  replayMode: 'offline-whole-corpus';
  streamCount: number;
  observationCount: number;
  plantedCausalCount: number;
  /**
   * Content hash over every observation field, every planted coupling, every
   * true pair key and every decoy id. Counts alone are NOT identity: timestamps,
   * domains, severities and truth labels can all be edited while the three
   * counts above stay constant, which is exactly how someone quietly makes the
   * corpus easier and reports the resulting numbers as an improvement.
   */
  corpusDigest: string;
  streamDigests: Record<string, string>;
  /**
   * Every built-in rule id registered for the graded pass, sorted.
   *
   * The engine measurements are membership-and-rate based, so a rule the corpus
   * never exercises can be DELETED with every number holding steady — five of
   * them were, and the gate passed. The inventory is pinned by exact set
   * equality against the baseline: the benchmark then fails when the shipped
   * rule set changes, which is the point at which a human should re-seed and
   * say why.
   */
  builtInRuleIds: string[];
  /**
   * Per-rule positive/near-miss coverage, from `probeBuiltInRules()`.
   *
   * Inventory equality proves an ID still exists, not that the matcher behind
   * it still works — and only four of the nine rules fire anywhere in the
   * corpus, so the other five could be turned permanently false with every
   * benchmark number unchanged. Each rule is therefore exercised against two
   * hand-built fixtures outside the corpus, and the gate requires all of them
   * to match their positive and reject their near-miss.
   */
  ruleProbes: BenchRuleProbe[];
  /**
   * The learned-rule SYNC lifecycle, exercised on a live engine.
   *
   * Every other learned-rule number here comes from `runEngine()`, which builds
   * a fresh engine every time — so it can only ever observe an install, never a
   * removal. Deleting `engine.unregisterRule(existing.id)` from
   * `syncLearnedRules()` left a retired coupling permanently installed and still
   * matching live events, while the function REPORTED it removed and the whole
   * benchmark passed unchanged. This probe re-syncs one engine with a smaller
   * set and records what is actually installed afterwards.
   */
  learnedRuleResync: BenchResyncProbe;
  /**
   * Built-in rules that emitted at least one pair over the corpus, sorted.
   *
   * Pinned by exact set equality: a rule that fires today and stops firing
   * tomorrow changes no rate enough to trip a tolerance, but it does change
   * this set.
   */
  ruleCoverage: string[];

  multipleTestingFamily: MultipleTestingFamily;

  // ── miner: discovery quality ──
  minedEdgeCount: number;
  significantEdgeCount: number;
  /** Significant edges that are planted-causal, over all significant edges. */
  couplingPrecision: number;
  /** Planted-causal couplings recovered, over all planted-causal couplings. */
  couplingRecall: number;
  /** Planted-causal couplings the miner missed, as `from->to`. */
  missingCouplings: string[];

  // ── miner: false-positive breakdown (each has a named owner downstream) ──
  /** Burst artefacts — ACC-504 dispersion correction. */
  confoundedFalsePositives: number;
  /** Transitive edges — ACC-503 mediation filtering. */
  mediatedFalsePositives: number;
  /** Genuinely unrelated domains, including the base-rate trap. */
  independentFalsePositives: number;
  /** Positive edges reported on a suppressive pair — always wrong. */
  inhibitoryEdgesReported: number;
  /** Incidental cross-stream coincidences — ACC-502 multiple-comparison correction. */
  unplantedFalsePositives: number;
  /**
   * Every significant edge that is not planted-causal. Gated at zero growth:
   * the corpus is deterministic, so one extra false edge is a real precision
   * regression even when the precision RATIO still lands inside its tolerance.
   */
  falseEdgeCount: number;

  // ── miner: score separation ──
  /** Mean `strength` of planted-causal significant edges. */
  meanCausalEdgeStrength: number;
  /** Mean `strength` of every other significant edge; null when there are none. */
  meanFalseEdgeStrength: number | null;
  /**
   * Causal mean minus false mean, on `strength`. Near zero today, and that is
   * the finding: `strength` is a bounded blend that saturates at 1.0, so the
   * ranking deciding which edges survive `MAX_LEARNED_RULES` is nearly flat.
   * That flatness is exactly how two real couplings lost their slot — see
   * `causalCouplingsLostToCap`.
   */
  edgeStrengthSeparation: number | null;

  /** Mean z-score of planted-causal significant edges (non-finite clamped). */
  meanCausalEdgeZ: number;
  /** Mean z-score of every other significant edge; null when there are none. */
  meanFalseEdgeZ: number | null;
  /**
   * Causal mean minus false mean, on the z-score — the separation metric with
   * real dynamic range, and the one ACC-502..504 should move. Unlike
   * `strength` it does not saturate, so suppressing a burst artefact or a
   * transitive edge shows up here immediately.
   */
  edgeEvidenceSeparation: number | null;
  /** Fixed candidate-population z separation; the correction cannot improve it by thinning. */
  fixedCandidateEvidenceSeparation: number;

  plantedInhibitoryCount: number;
  inhibitoryTruePositiveCount: number;
  inhibitoryFalsePositiveCount: number;
  inhibitoryPrecision: number | null;
  inhibitoryRecall: number;

  // ── learned rules ──
  learnedRuleCount: number;
  /** Learned rules descended from a non-causal edge. */
  learnedRuleFalsePositives: number;
  /**
   * Learned rules descended from a planted-causal edge — the pipeline's
   * USEFULNESS, gated separately from its blast radius. Without this a miner
   * that returns no rules at all scores zero false positives and zero pair
   * volume, and a dead pipeline reads as a clean sweep.
   */
  causalLearnedRuleCount: number;
  /**
   * Planted-causal couplings the miner FOUND but that lost their slot at the
   * `MAX_LEARNED_RULES` cap to a higher-strength false positive. Real signal
   * evicted by noise — a direct cost of the precision problem.
   */
  causalCouplingsLostToCap: string[];

  // ── engine pass A: built-in rules only ──
  /** Raw emissions, including one event pair matched by two rules. */
  enginePairCount: number;
  /** Distinct event pairs — the precision denominator. */
  distinctEnginePairCount: number;
  /**
   * How many planted true pairs EXIST — the recall denominator, and the ceiling
   * on how many true pairs any pass can have emitted. Reported so the gate can
   * reconcile precision against recall: `precision × distinct` and
   * `recall × universe` are two independent routes to the same true-pair count,
   * and a hand-edited report that keeps both rates at 1.0 while inflating the
   * pair counts is arithmetically impossible once they must agree.
   */
  truePairUniverse: number;
  pairPrecision: number;
  pairRecall: number;
  /** Pairs touching a near-miss decoy. Zero-tolerance gate. */
  decoyPairsEmitted: number;
  meanTruePairConfidence: number;
  /** null when the pass emitted no false pairs. */
  meanFalsePairConfidence: number | null;
  /** Mean true confidence minus mean false confidence; null with no false pairs. */
  confidenceSeparation: number | null;

  // ── engine pass B: built-ins + learned rules ──
  /** Pairs attributed to a `learned:*` rule — spurious-rule blast radius. */
  learnedRulePairCount: number;
  /**
   * The subset of those pairs whose rule descends from a planted-causal edge.
   * Gated as LIVENESS, not as volume: shrinking `learnedRulePairCount` is a
   * goal, but a run where the causal rules match nothing means the synthesize →
   * install → match path broke, which every count-based gate would miss.
   */
  causalLearnedRulePairCount: number;
  /**
   * Per-causal-rule pair volume, descending. The AGGREGATE above is a sum, and a
   * sum hides its own zeros: with three causal rules emitting 7/6/6, one of them
   * dying outright only moves the total to 13, which any proportional floor on
   * the aggregate waves through. Reported per rule so a single dead matcher is
   * visible.
   */
  causalLearnedRulePairsPerRule: number[];
  /**
   * The smallest per-rule volume above — 0 when a synthesized causal rule never
   * fired. This is the field the liveness gate reads.
   */
  minCausalLearnedRulePairCount: number;
  /**
   * Every synthesized rule descended from a planted-causal edge, sorted.
   *
   * The roster, not the firing set: a causal rule that emitted nothing still
   * appears here, which is what makes `minCausalLearnedRulePairCount` able to
   * report a zero. Independently re-derivable by the gate from the causal edge
   * rows that carry `becameLearnedRule`.
   */
  causalLearnedRuleIds: string[];

  // ── row-level ledgers: the gate re-derives the summaries above from these ──
  edges: BenchEdgeRow[];
  inhibitoryEdges: BenchInhibitoryEdgeRow[];
  pairs: BenchPairRow[];
  learnedPairs: BenchLearnedPairRow[];
}

export function runCorrelationBenchmark(): CorrelationBenchReport {
  const observations = allGoldenObservations();
  const truePairs = plantedTruePairKeys();
  const decoys = decoyEventIds();
  const plantedIndex = plantedCouplingIndex();

  // ── Miner ──────────────────────────────────────────────────────────────
  // The frozen corpus has complete coverage through its declared end. Passing
  // that boundary keeps inhibitory absence right-censored and deterministic.
  const domainEvents = observations.map((o) => ({ domain: o.domain, at: o.timestamp }));
  const mining = mineLeadLag(domainEvents, {
    observationEndMs: CORPUS_T0 + CORPUS_SPAN_DAYS * DAY_MS,
  });
  if (mining.family === null) throw new Error('correlation benchmark mining family is invalid');
  const significant = mining.promoting;

  const learnedRules = learnedRulesFromEdges(significant);
  const learnedIds = new Set(learnedRules.map((r) => r.id));

  const counts: Record<EdgeVerdict, number> = {
    causal: 0, mediated: 0, confounded: 0, independent: 0, inhibitory: 0, unplanted: 0,
  };
  const edges: BenchEdgeRow[] = significant.map((edge) => {
    const verdict = verdictFor(edge, plantedIndex);
    counts[verdict] += 1;
    return {
      from: edge.from,
      to: edge.to,
      verdict,
      support: edge.support,
      antecedents: edge.antecedents,
      lift: finiteOrNull(edge.lift),
      zScore: finiteOrNull(edge.zScore),
      strength: edge.strength,
      windowHours: Math.round(edge.windowMs / 3_600_000),
      becameLearnedRule: learnedIds.has(learnedRuleId(edge)),
    };
  });

  const plantedCausal = PLANTED_COUPLINGS.filter((c) => c.kind === 'causal');
  const detected = new Set(significant.map((e) => `${e.from}->${e.to}`));
  const missingCouplings = plantedCausal
    .map((c) => `${c.from}->${c.to}`)
    .filter((key) => !detected.has(key));

  const learnedRuleFalsePositives = significant
    .filter((e) => learnedIds.has(learnedRuleId(e)))
    .filter((e) => verdictFor(e, plantedIndex) !== 'causal')
    .length;

  const causalCouplingsLostToCap = significant
    .filter((e) => verdictFor(e, plantedIndex) === 'causal')
    .filter((e) => !learnedIds.has(learnedRuleId(e)))
    .map((e) => `${e.from}->${e.to}`);

  const causalEdges = significant.filter((e) => verdictFor(e, plantedIndex) === 'causal');
  const falseEdges = significant.filter((e) => verdictFor(e, plantedIndex) !== 'causal');

  const meanCausalStrength = mean(causalEdges.map((e) => e.strength));
  const meanFalseStrength = falseEdges.length > 0
    ? mean(falseEdges.map((e) => e.strength))
    : null;

  const meanCausalZ = mean(causalEdges.map((e) => cappedZ(e.zScore)));
  const meanFalseZ = falseEdges.length > 0
    ? mean(falseEdges.map((e) => cappedZ(e.zScore)))
    : null;

  const causalCandidates = mining.candidates.filter(
    (edge) => verdictFor(edge, plantedIndex) === 'causal',
  );
  const falseCandidates = mining.candidates.filter(
    (edge) => verdictFor(edge, plantedIndex) !== 'causal',
  );
  const fixedCandidateEvidenceSeparation = mean(
    causalCandidates.map((edge) => cappedZ(edge.zScore)),
  ) - mean(falseCandidates.map((edge) => cappedZ(edge.zScore)));

  const plantedInhibitoryCount = PLANTED_COUPLINGS.filter((c) => c.kind === 'inhibitory').length;
  const inhibitoryEdges = mining.inhibitory.map((edge) => inhibitoryRow(edge, plantedIndex));
  const inhibitoryTruePositiveCount = inhibitoryEdges.filter(
    (edge) => edge.verdict === 'inhibitory',
  ).length;
  const inhibitoryFalsePositiveCount = inhibitoryEdges.length - inhibitoryTruePositiveCount;

  // ── Engine pass A: built-ins only ─────────────────────────────────────
  const graded = gradeEnginePairs(runEngine(observations), truePairs, decoys);
  const { emittedTrueKeys, decoyPairsEmitted } = graded;
  const meanTrue = mean(graded.truePairConfidences);
  const meanFalse = graded.falsePairConfidences.length > 0
    ? mean(graded.falsePairConfidences)
    : null;

  // ── Engine pass B: built-ins + learned rules ──────────────────────────
  // Synthesizing a rule is not the same as that rule FIRING. Counting only the
  // synthesized set would let the whole install/match path go dark — zero
  // learned pairs — while the rule-count gates stayed perfectly green, so the
  // causal subset's pair volume is measured separately as a liveness signal.
  const causalLearnedRuleIds = new Set(
    significant
      .filter((e) => verdictFor(e, plantedIndex) === 'causal')
      .map((e) => learnedRuleId(e))
      .filter((id) => learnedIds.has(id)),
  );
  const emitted = runEngine(observations, learnedRules)
    .filter((p: CorrelatedPair) => p.ruleId.startsWith(LEARNED_RULE_PREFIX));
  const learnedPairs = ledgerLearnedPairs(emitted);
  const learnedRulePairCount = emitted.length;
  const causalLearnedRulePairCount = emitted
    .filter((p: CorrelatedPair) => causalLearnedRuleIds.has(p.ruleId))
    .length;
  // Seeded from the rule IDS, not from the emitted pairs: a rule that fired
  // nothing has no pairs to group by, and grouping by emission would drop it
  // from the tally entirely — which is precisely the rule the gate needs to see.
  const perCausalRule = new Map<string, number>(
    [...causalLearnedRuleIds].map((id) => [id, 0]),
  );
  for (const p of emitted) {
    const seen = perCausalRule.get(p.ruleId);
    if (seen !== undefined) perCausalRule.set(p.ruleId, seen + 1);
  }
  const causalLearnedRulePairsPerRule = [...perCausalRule.values()].sort((a, b) => b - a);

  const emittingRules = new Set(
    graded.pairs.flatMap((p) => p.emissions.map((e) => e.ruleId)),
  );

  return {
    replayMode: 'offline-whole-corpus',
    streamCount: GOLDEN_STREAMS.length,
    observationCount: observations.length,
    plantedCausalCount: plantedCausal.length,
    corpusDigest: goldenCorpusDigest(),
    streamDigests: goldenStreamDigests(),
    builtInRuleIds: builtInCorrelationRules.map((r) => r.id).sort((a, b) => a.localeCompare(b)),
    ruleProbes: probeBuiltInRules(),
    learnedRuleResync: probeLearnedRuleResync(learnedRules),
    ruleCoverage: builtInCorrelationRules
      .map((r) => r.id)
      .filter((id) => emittingRules.has(id))
      .sort((a, b) => a.localeCompare(b)),
    multipleTestingFamily: mining.family,

    minedEdgeCount: mining.candidates.length,
    significantEdgeCount: significant.length,
    couplingPrecision: ratio(counts.causal, significant.length),
    couplingRecall: ratio(counts.causal, plantedCausal.length),
    missingCouplings,

    confoundedFalsePositives: counts.confounded,
    mediatedFalsePositives: counts.mediated,
    independentFalsePositives: counts.independent,
    inhibitoryEdgesReported: counts.inhibitory,
    unplantedFalsePositives: counts.unplanted,
    falseEdgeCount: falseEdges.length,

    meanCausalEdgeStrength: round4(meanCausalStrength),
    meanFalseEdgeStrength: meanFalseStrength === null ? null : round4(meanFalseStrength),
    edgeStrengthSeparation:
      meanFalseStrength === null ? null : round4(meanCausalStrength - meanFalseStrength),

    meanCausalEdgeZ: round4(meanCausalZ),
    meanFalseEdgeZ: meanFalseZ === null ? null : round4(meanFalseZ),
    edgeEvidenceSeparation:
      meanFalseZ === null ? null : round4(meanCausalZ - meanFalseZ),
    fixedCandidateEvidenceSeparation: round4(fixedCandidateEvidenceSeparation),

    plantedInhibitoryCount,
    inhibitoryTruePositiveCount,
    inhibitoryFalsePositiveCount,
    inhibitoryPrecision: inhibitoryEdges.length === 0
      ? null
      : ratio(inhibitoryTruePositiveCount, inhibitoryEdges.length),
    inhibitoryRecall: ratio(inhibitoryTruePositiveCount, plantedInhibitoryCount),

    learnedRuleCount: learnedRules.length,
    learnedRuleFalsePositives,
    causalLearnedRuleCount: learnedRules.length - learnedRuleFalsePositives,
    causalCouplingsLostToCap,

    enginePairCount: graded.pairCount,
    distinctEnginePairCount: graded.distinctPairCount,
    truePairUniverse: truePairs.size,
    pairPrecision: graded.pairPrecision,
    pairRecall: ratio(emittedTrueKeys.size, truePairs.size),
    decoyPairsEmitted,
    meanTruePairConfidence: round4(meanTrue),
    meanFalsePairConfidence: meanFalse === null ? null : round4(meanFalse),
    confidenceSeparation: meanFalse === null ? null : round4(meanTrue - meanFalse),

    learnedRulePairCount,
    causalLearnedRulePairCount,
    causalLearnedRulePairsPerRule,
    // Sorted descending, so the last entry is the weakest rule. No rules at all
    // reads as 0, which the baseline's must-arm check then rejects outright.
    minCausalLearnedRulePairCount:
      causalLearnedRulePairsPerRule[causalLearnedRulePairsPerRule.length - 1] ?? 0,
    causalLearnedRuleIds: [...causalLearnedRuleIds].sort((a, b) => a.localeCompare(b)),

    edges,
    inhibitoryEdges,
    pairs: graded.pairs,
    learnedPairs,
  };
}

function inhibitoryRow(
  edge: InhibitoryLeadLagEdge,
  plantedIndex: ReadonlyMap<string, { kind: PlantedCouplingKind }>,
): BenchInhibitoryEdgeRow {
  const planted = plantedIndex.get(`${edge.from}->${edge.to}`);
  return {
    id: `inhibits:${edge.from}->${edge.to}`,
    from: edge.from,
    to: edge.to,
    windowMs: edge.windowMs,
    antecedents: edge.antecedents,
    support: edge.support,
    followRate: edge.followRate,
    expectedRate: edge.expectedRate,
    lift: edge.lift,
    zScore: edge.zScore,
    strength: edge.strength,
    verdict: planted?.kind === 'inhibitory' ? 'inhibitory' : 'false-positive',
    explanation: edge.explanation,
  };
}

/** One raw emission, keeping the claim the engine made rather than a tally. */
function emissionOf(pair: CorrelatedPair): BenchPairEmission {
  return {
    ruleId: pair.ruleId,
    edgeType: pair.edgeType,
    fromId: pair.eventA.id,
    toId: pair.eventB.id,
    confidence: pair.confidence,
    detectedAtMs: pair.detectedAt.getTime(),
    confidenceDetailDigest: confidenceDetailDigest(pair),
    ...projectedEdge(pair),
  };
}

/**
 * The pair as SituationStoreV2 actually projects it — the shape the evidence
 * graph and the analyst see.
 *
 * Everything else in this ledger describes the engine's own output, one
 * translation short of production. `EDGE_TYPE_MAP` is that translation, and
 * inverting a row of it ('causal-candidate' → contradicts) emitted real
 * situation edges claiming the opposite relationship while the benchmark, digest
 * included, read unchanged. So the benchmark calls the real projection rather
 * than restating the mapping it is supposed to be checking.
 */
function projectedEdge(pair: CorrelatedPair): {
  evidenceEdgeType: string;
  evidenceFromId: string;
  evidenceToId: string;
} {
  const edge = pairToEdge(pair);
  return {
    evidenceEdgeType: edge.type,
    evidenceFromId: edge.sourceEventId,
    evidenceToId: edge.targetEventId,
  };
}

/**
 * The factor breakdown behind `confidence`, as a digest.
 *
 * Factor VALUES rather than the explanation string alone: the explanation is
 * rendered prose and would move on any wording change, while the six factors
 * are the claim. Sorted by key so the record does not depend on how
 * `computeEdgeConfidence` happens to build the object.
 */
function confidenceDetailDigest(pair: CorrelatedPair): string | null {
  const detail = pair.confidenceDetail;
  if (detail === undefined) return null;
  const factors = detail.factors as unknown as Record<string, number>;
  return digestRecords([
    `value:${detail.value}`,
    `explained:${detail.explanation.length > 0}`,
    ...Object.keys(factors)
      .sort((a, b) => a.localeCompare(b))
      .map((k) => `${k}:${factors[k]}`),
  ]);
}

/**
 * Pass B's emissions, grouped one row per (rule, distinct event pair).
 *
 * Sorted by rule then key so the ledger is byte-stable across runs — the report
 * is committed as a baseline, and an unstable row order is a diff every re-seed
 * has to read past.
 */
function ledgerLearnedPairs(pairs: readonly CorrelatedPair[]): BenchLearnedPairRow[] {
  const rows = new Map<string, BenchLearnedPairRow>();
  for (const pair of pairs) {
    const key = pairKeyFor(pair.eventA.id, pair.eventB.id);
    const rowKey = `${pair.ruleId.length}:${pair.ruleId}${key}`;
    const row = rows.get(rowKey);
    if (row === undefined) {
      const [idA, idB] = pair.eventA.id < pair.eventB.id
        ? [pair.eventA.id, pair.eventB.id]
        : [pair.eventB.id, pair.eventA.id];
      rows.set(rowKey, {
        ruleId: pair.ruleId, key, eventIdA: idA, eventIdB: idB, emissions: [emissionOf(pair)],
      });
      continue;
    }
    row.emissions.push(emissionOf(pair));
  }
  return [...rows.values()].sort((a, b) =>
    a.ruleId.localeCompare(b.ruleId) || a.key.localeCompare(b.key));
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * A fresh engine per pass. Rule registration is stateful and the learned rules
 * must not leak into the built-ins-only measurement, so pass A and pass B never
 * share an instance. `timer: () => 0` removes the only clock read in the engine.
 */
/**
 * What `syncLearnedRules()` leaves installed across a retirement.
 *
 * `getRules()` after the fact, not the {added, removed} the function returns:
 * those counters are the CLAIM, and the defect this catches is precisely a
 * claim that no longer matches the engine.
 */
export interface BenchResyncProbe {
  /** learned:* ids installed after syncing the full mined set, sorted. */
  installed: readonly string[];
  /** The id deliberately retired on the second sync. */
  retiredId: string;
  /** learned:* ids installed after the retirement, sorted — must exclude `retiredId`. */
  afterRetirement: readonly string[];
  /** The second sync's own report of what it did. */
  reportedAdded: number;
  reportedRemoved: number;
  /** Built-in ids present and unchanged after both syncs — sync must not touch them. */
  builtInsIntact: boolean;
}

function probeLearnedRuleResync(learned: readonly CorrelationRule[]): BenchResyncProbe {
  const engine = new CorrelateEngine({ timer: () => 0 });
  for (const rule of builtInCorrelationRules) engine.registerRule(rule);
  const builtInIds = builtInCorrelationRules.map((r) => r.id).sort((a, b) => a.localeCompare(b));

  const learnedIdsOf = (): string[] => engine.getRules()
    .map((r) => r.id)
    .filter((id) => id.startsWith(LEARNED_RULE_PREFIX))
    .sort((a, b) => a.localeCompare(b));

  syncLearnedRules(engine, learned);
  const installed = learnedIdsOf();

  // Retire the LAST rule by id order rather than the first: a first-element
  // retirement is the one case a truncating loop bug would also produce.
  const retiredId = installed[installed.length - 1] ?? '';
  const kept = learned.filter((r) => r.id !== retiredId);
  const { added, removed } = syncLearnedRules(engine, kept);

  const nowBuiltIn = engine.getRules()
    .map((r) => r.id)
    .filter((id) => !id.startsWith(LEARNED_RULE_PREFIX))
    .sort((a, b) => a.localeCompare(b));

  return {
    installed,
    retiredId,
    afterRetirement: learnedIdsOf(),
    reportedAdded: added,
    reportedRemoved: removed,
    builtInsIntact: nowBuiltIn.length === builtInIds.length
      && nowBuiltIn.every((id, i) => id === builtInIds[i]),
  };
}

function runEngine(
  observations: readonly ObservationEvent[],
  learned: readonly CorrelationRule[] = [],
): readonly CorrelatedPair[] {
  const engine = new CorrelateEngine({ timer: () => 0 });
  for (const rule of builtInCorrelationRules) engine.registerRule(rule);
  if (learned.length > 0) syncLearnedRules(engine, learned);
  return engine.correlate(observations, BENCH_NOW).pairs;
}

export interface GradedPairs {
  /** Raw emissions, including the same event pair matched by two rules. */
  pairCount: number;
  /**
   * DISTINCT event pairs emitted. Precision divides distinct true keys by this,
   * never by `pairCount`: two legitimate rules matching one planted pair would
   * otherwise inflate the denominator without touching the numerator and report
   * a precision regression for correctly recognising the same true pair twice.
   */
  distinctPairCount: number;
  /** Distinct planted true pairs the engine actually emitted — the recall numerator. */
  emittedTrueKeys: ReadonlySet<string>;
  /**
   * Precision, computed HERE rather than at the report assembly, so the choice
   * of denominator lives in exactly one place — next to the two counts that
   * define it — and a test on this function is a test of the production value.
   */
  pairPrecision: number;
  truePairConfidences: number[];
  falsePairConfidences: number[];
  decoyPairsEmitted: number;
  /** Per-distinct-pair detail, in first-emission order. */
  pairs: BenchPairRow[];
}

/**
 * Precision over DISTINCT event pairs, never over raw emissions.
 *
 * On the live corpus the two counts are equal (22 raw / 22 distinct), so NO
 * end-to-end assertion driven through `runCorrelationBenchmark()` can tell the
 * denominators apart. Two things stand in for that missing coverage: this is
 * the only place in the module where a pair-precision denominator is chosen,
 * and the baseline gate reconciles `precision × distinct` against
 * `recall × truePairUniverse`, which diverges the moment a corpus does emit one
 * pair twice.
 */
export function enginePairPrecision(
  graded: Pick<GradedPairs, 'emittedTrueKeys' | 'distinctPairCount'>,
): number {
  return ratio(graded.emittedTrueKeys.size, graded.distinctPairCount);
}

/** Grades emitted pairs against event-level planted truth. */
export function gradeEnginePairs(
  pairs: readonly CorrelatedPair[],
  truePairs: ReadonlySet<string>,
  decoys: ReadonlySet<string>,
): GradedPairs {
  const truePairConfidences: number[] = [];
  const falsePairConfidences: number[] = [];
  const emittedTrueKeys = new Set<string>();
  const rows = new Map<string, BenchPairRow>();
  let decoyPairsEmitted = 0;

  for (const pair of pairs) {
    const touchesDecoy = decoys.has(pair.eventA.id) || decoys.has(pair.eventB.id);
    if (touchesDecoy) decoyPairsEmitted += 1;
    const key = pairKeyFor(pair.eventA.id, pair.eventB.id);
    const isTruePair = truePairs.has(key);
    let row = rows.get(key);
    if (row === undefined) {
      const [idA, idB] = pair.eventA.id < pair.eventB.id
        ? [pair.eventA.id, pair.eventB.id]
        : [pair.eventB.id, pair.eventA.id];
      row = {
        key, eventIdA: idA, eventIdB: idB,
        emissions: [], isTruePair, decoyEmissions: 0,
      };
      rows.set(key, row);
    }
    row.emissions.push(emissionOf(pair));
    if (touchesDecoy) row.decoyEmissions += 1;
    if (isTruePair) {
      emittedTrueKeys.add(key);
      truePairConfidences.push(pair.confidence);
    } else {
      falsePairConfidences.push(pair.confidence);
    }
  }

  return {
    pairCount: pairs.length,
    distinctPairCount: rows.size,
    pairs: [...rows.values()],
    emittedTrueKeys,
    pairPrecision: enginePairPrecision({ emittedTrueKeys, distinctPairCount: rows.size }),
    truePairConfidences,
    falsePairConfidences,
    decoyPairsEmitted,
  };
}

function verdictFor(
  edge: Pick<LeadLagEdge, 'from' | 'to'>,
  index: ReadonlyMap<string, { kind: PlantedCouplingKind }>,
): EdgeVerdict {
  return index.get(`${edge.from}->${edge.to}`)?.kind ?? 'unplanted';
}

/** `lift` and `zScore` are POSITIVE_INFINITY when the chance rate is zero, and
 *  JSON.stringify would silently turn that into `null` anyway — do it here so
 *  the type says so. */
function finiteOrNull(v: number): number | null {
  return Number.isFinite(v) ? v : null;
}

/**
 * `zScore` is POSITIVE_INFINITY when the consequent's chance rate is zero.
 * Averaging that poisons the whole metric, so clamp to a cap far above any
 * z a real corpus produces — an edge at z=50 and an edge at z=∞ are the same
 * verdict ("certain") and should not be distinguishable by the gate.
 *
 * ONLY positive infinity. `NaN` and `-Infinity` are miner bugs, not "certain",
 * and mapping them to the cap would render broken evidence as the strongest
 * possible evidence — a gate that reads maximally green precisely when the
 * thing it guards has failed. Fail closed instead.
 */
const Z_CAP = 50;

function cappedZ(z: number): number {
  if (z === Number.POSITIVE_INFINITY) return Z_CAP;
  if (!Number.isFinite(z)) {
    throw new TypeError(
      `lead-lag produced a non-finite, non-positive-infinite zScore (${z}) — ` +
      'this is a miner defect; the benchmark fails closed rather than scoring it',
    );
  }
  return Math.min(Z_CAP, z);
}

function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((sum, v) => sum + v, 0) / xs.length;
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return round4(numerator / denominator);
}

function round4(v: number): number {
  return Math.round(v * 10_000) / 10_000;
}
