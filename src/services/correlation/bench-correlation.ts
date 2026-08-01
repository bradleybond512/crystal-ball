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
  CorrelateEngine, type CorrelatedPair, type CorrelationRule,
} from '../intelligence/correlate-engine';
import { builtInCorrelationRules } from '../intelligence/built-in-correlation-rules';
import { mineLeadLag, significantEdges, type LeadLagEdge } from './lead-lag';
import {
  learnedRulesFromEdges,
  learnedRuleId,
  syncLearnedRules,
  LEARNED_RULE_PREFIX,
} from './learned-rules';
import {
  allGoldenObservations,
  decoyEventIds,
  pairKeyFor,
  plantedCouplingIndex,
  plantedTruePairKeys,
  CORPUS_T0,
  CORPUS_SPAN_DAYS,
  GOLDEN_STREAMS,
  PLANTED_COUPLINGS,
  type PlantedCouplingKind,
} from './__bench__/golden-streams';

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

export interface CorrelationBenchReport {
  // ── corpus identity (exact-equality drift detection) ──
  streamCount: number;
  observationCount: number;
  plantedCausalCount: number;

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

  // ── learned rules ──
  learnedRuleCount: number;
  /** Learned rules descended from a non-causal edge. */
  learnedRuleFalsePositives: number;
  /**
   * Planted-causal couplings the miner FOUND but that lost their slot at the
   * `MAX_LEARNED_RULES` cap to a higher-strength false positive. Real signal
   * evicted by noise — a direct cost of the precision problem.
   */
  causalCouplingsLostToCap: string[];

  // ── engine pass A: built-in rules only ──
  enginePairCount: number;
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

  // ── human-readable detail (not part of the gate) ──
  edges: BenchEdgeRow[];
}

export function runCorrelationBenchmark(): CorrelationBenchReport {
  const observations = allGoldenObservations();
  const truePairs = plantedTruePairKeys();
  const decoys = decoyEventIds();
  const plantedIndex = plantedCouplingIndex();

  // ── Miner ──────────────────────────────────────────────────────────────
  // Same call shape as cascade-registration.computeSignificantEdges().
  const domainEvents = observations.map((o) => ({ domain: o.domain, at: o.timestamp }));
  const mined = mineLeadLag(domainEvents);
  const significant = significantEdges(mined);

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

  // ── Engine pass A: built-ins only ─────────────────────────────────────
  const graded = gradeEnginePairs(runEngine(observations), truePairs, decoys);
  const { emittedTrueKeys, decoyPairsEmitted } = graded;
  const meanTrue = mean(graded.truePairConfidences);
  const meanFalse = graded.falsePairConfidences.length > 0
    ? mean(graded.falsePairConfidences)
    : null;

  // ── Engine pass B: built-ins + learned rules ──────────────────────────
  const learnedRulePairCount = runEngine(observations, learnedRules)
    .filter((p: CorrelatedPair) => p.ruleId.startsWith(LEARNED_RULE_PREFIX))
    .length;

  return {
    streamCount: GOLDEN_STREAMS.length,
    observationCount: observations.length,
    plantedCausalCount: plantedCausal.length,

    minedEdgeCount: mined.length,
    significantEdgeCount: significant.length,
    couplingPrecision: ratio(counts.causal, significant.length),
    couplingRecall: ratio(counts.causal, plantedCausal.length),
    missingCouplings,

    confoundedFalsePositives: counts.confounded,
    mediatedFalsePositives: counts.mediated,
    independentFalsePositives: counts.independent,
    inhibitoryEdgesReported: counts.inhibitory,
    unplantedFalsePositives: counts.unplanted,

    meanCausalEdgeStrength: round4(meanCausalStrength),
    meanFalseEdgeStrength: meanFalseStrength === null ? null : round4(meanFalseStrength),
    edgeStrengthSeparation:
      meanFalseStrength === null ? null : round4(meanCausalStrength - meanFalseStrength),

    meanCausalEdgeZ: round4(meanCausalZ),
    meanFalseEdgeZ: meanFalseZ === null ? null : round4(meanFalseZ),
    edgeEvidenceSeparation:
      meanFalseZ === null ? null : round4(meanCausalZ - meanFalseZ),

    learnedRuleCount: learnedRules.length,
    learnedRuleFalsePositives,
    causalCouplingsLostToCap,

    enginePairCount: graded.pairCount,
    pairPrecision: ratio(emittedTrueKeys.size, graded.pairCount),
    pairRecall: ratio(emittedTrueKeys.size, truePairs.size),
    decoyPairsEmitted,
    meanTruePairConfidence: round4(meanTrue),
    meanFalsePairConfidence: meanFalse === null ? null : round4(meanFalse),
    confidenceSeparation: meanFalse === null ? null : round4(meanTrue - meanFalse),

    learnedRulePairCount,

    edges,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * A fresh engine per pass. Rule registration is stateful and the learned rules
 * must not leak into the built-ins-only measurement, so pass A and pass B never
 * share an instance. `timer: () => 0` removes the only clock read in the engine.
 */
function runEngine(
  observations: readonly ObservationEvent[],
  learned: readonly CorrelationRule[] = [],
): readonly CorrelatedPair[] {
  const engine = new CorrelateEngine({ timer: () => 0 });
  for (const rule of builtInCorrelationRules) engine.registerRule(rule);
  if (learned.length > 0) syncLearnedRules(engine, learned);
  return engine.correlate(observations, BENCH_NOW).pairs;
}

interface GradedPairs {
  pairCount: number;
  /** Distinct planted true pairs the engine actually emitted — the recall numerator. */
  emittedTrueKeys: ReadonlySet<string>;
  truePairConfidences: number[];
  falsePairConfidences: number[];
  decoyPairsEmitted: number;
}

/** Grades emitted pairs against event-level planted truth. */
function gradeEnginePairs(
  pairs: readonly CorrelatedPair[],
  truePairs: ReadonlySet<string>,
  decoys: ReadonlySet<string>,
): GradedPairs {
  const truePairConfidences: number[] = [];
  const falsePairConfidences: number[] = [];
  const emittedTrueKeys = new Set<string>();
  let decoyPairsEmitted = 0;

  for (const pair of pairs) {
    if (decoys.has(pair.eventA.id) || decoys.has(pair.eventB.id)) decoyPairsEmitted += 1;
    const key = pairKeyFor(pair.eventA.id, pair.eventB.id);
    if (truePairs.has(key)) {
      emittedTrueKeys.add(key);
      truePairConfidences.push(pair.confidence);
    } else {
      falsePairConfidences.push(pair.confidence);
    }
  }

  return {
    pairCount: pairs.length,
    emittedTrueKeys,
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
 */
const Z_CAP = 50;

function cappedZ(z: number): number {
  if (!Number.isFinite(z)) return Z_CAP;
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
