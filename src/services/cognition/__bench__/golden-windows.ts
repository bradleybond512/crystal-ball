/**
 * Golden Windows — frozen fixture corpus for the Cognition Benchmark (PR 16).
 *
 * House pattern: mirrors src/services/ops/replay-fixtures-catalog.ts (frozen
 * historical-style fixtures with known outcomes, stable timestamps, no live
 * fetch). Twelve windows spanning conflict / markets / cyber / weather /
 * shortage(macro) / maritime / aviation / general, each with:
 *
 *   - a HypothesisLike descriptor (kind/statement/domains) so it exercises
 *     base-rates.matchReferenceClass() the same way a real hypothesis would;
 *   - a hand-picked ground-truth outcome (0 = fizzled, 1 = materialized) —
 *     these are FIXTURE labels, not live grading, exactly like
 *     replay-fixtures-catalog's synthetic-but-realistic mission traces;
 *   - a fixed "model-forecast" point estimate standing in for what the
 *     existing deterministic forecastHypothesis() pipeline would have
 *     produced (PR 3's deterministic-only floor never calls an LLM, so the
 *     benchmark never does either — fully offline, fully deterministic);
 *   - five hand-built episodic Recall fixtures (the same "construct a Recall
 *     object directly, no real vector search" pattern used throughout
 *     episodic-memory.test.mts) so analogScoreFor() and a precision@5 metric
 *     both have real, checkable input.
 *
 * Four of the twelve windows are additionally tagged with a `schemaClusterId`
 * marking which TRAINING_CLUSTER below their domain was designed against.
 * None of a window's own data (recalls, statement, IDs) ever appears in
 * TRAINING_EPISODES — the training corpus is a wholly separate, synthetic
 * set of episodes — so the schema stage is a genuine held-out evaluation,
 * not a tautology. Matching is domain-level (the same granularity
 * consolidation.ts's learned schemas actually operate at), so in practice
 * every window sharing a trained domain gets matched, not only the tagged
 * one — e.g. both 'conflict-*' windows match the conflict-cluster schema.
 * bench-cognition.ts's schemaTruePositiveRate is computed only over actually
 * positive (materialized) matched windows, so this over-matching doesn't
 * inflate the rate — it just means the schema stage is graded on 8 of 12
 * windows rather than 4, which is the more honest number to report.
 *
 * Everything here is pure data + one deterministic PRNG (mulberry32, fixed
 * seed) — no Math.random, no Date.now(), no DOM/fetch. Re-running the
 * benchmark against this file always produces byte-identical numbers, which
 * is the whole point of a CI regression gate.
 */

import type { HypothesisKind } from '@/services/analyst-loop';
import type { HypothesisLike } from '../base-rates';
import type { Recall, Episode } from '../episodic-memory';
import type { PredictionRecord } from '@/services/intelligence/forecast-calibration';
import type { FactDomain } from '@/services/intelligence/types';

// ── Deterministic PRNG (mulberry32) ─────────────────────────────────────────
// Fixed seed so CALIBRATION_POOL is byte-identical across runs/machines.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    // `| 0` here performs real int32-wraparound arithmetic (the algorithm's
    // defining property) — not interchangeable with Math.trunc.
    // eslint-disable-next-line unicorn/prefer-math-trunc
    a = (a + 0x6D_2B_79_F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// ── Golden window type ───────────────────────────────────────────────────────

export interface GoldenWindow {
  id: string;
  description: string;
  factDomain: FactDomain;
  hypothesis: HypothesisLike;
  /** Fixture ground truth: 1 = materialized, 0 = fizzled. */
  groundTruthOutcome: 0 | 1;
  /** Stand-in for the existing deterministic forecastHypothesis() output. */
  modelForecastP: number;
  /** Five hand-built analog recalls (for analogScoreFor + precision@5). */
  analogRecalls: Recall[];
  /** Index into TRAINING_CLUSTERS this window's pattern should match, if any. */
  schemaClusterId?: number;
}

function ep(id: string, outcome: Episode['outcome']): Episode {
  return {
    id,
    kind: 'hypothesis',
    signature: `sig-${id}`,
    summary: `analog: ${id}`,
    domains: [],
    entities: [],
    createdAt: 0,
    resolvedAt: 1,
    outcome,
    vector: [],
    tier: 'hashed',
  };
}

function recall(id: string, outcome: Episode['outcome'], similarity: number): Recall {
  return { episode: ep(id, outcome), similarity, ageDays: 30, explanation: `matched on: ${id}` };
}

// ── Golden windows (12) ──────────────────────────────────────────────────────

export const GOLDEN_WINDOWS: readonly GoldenWindow[] = [
  {
    id: 'conflict-black-sea-grain-corridor',
    description: 'Naval posturing near the Black Sea grain corridor as ceasefire talks stall.',
    factDomain: 'conflict',
    hypothesis: {
      kind: 'situation-escalation' as HypothesisKind,
      statement: 'Naval forces posture near the Black Sea grain corridor as ceasefire talks stall, raising escalation risk.',
      domains: ['conflict'],
    },
    groundTruthOutcome: 1,
    modelForecastP: 0.42,
    schemaClusterId: 0,
    analogRecalls: [
      recall('bs-1', 'materialized', 0.82),
      recall('bs-2', 'materialized', 0.71),
      recall('bs-3', 'fizzled', 0.62),
      recall('bs-4', 'materialized', 0.58),
      recall('bs-5', 'partial', 0.51),
    ],
  },
  {
    id: 'conflict-ceasefire-holds',
    description: 'A newly signed ceasefire shows early strain but ultimately holds.',
    factDomain: 'conflict',
    hypothesis: {
      kind: 'situation-escalation' as HypothesisKind,
      statement: 'A newly signed ceasefire and truce along the contested border shows early signs of strain.',
      domains: ['conflict'],
    },
    groundTruthOutcome: 0,
    modelForecastP: 0.22,
    analogRecalls: [
      recall('cf-1', 'fizzled', 0.79),
      recall('cf-2', 'fizzled', 0.68),
      recall('cf-3', 'materialized', 0.6),
      recall('cf-4', 'fizzled', 0.55),
      recall('cf-5', 'fizzled', 0.49),
    ],
  },
  {
    id: 'markets-equity-selloff',
    description: 'Equity futures plunge after a surprise Fed statement.',
    factDomain: 'markets',
    hypothesis: {
      kind: 'anomaly-convergence' as HypothesisKind,
      statement: 'Equity index futures plunge after a surprise Fed statement roils the S&P and VIX.',
      domains: ['markets'],
    },
    groundTruthOutcome: 1,
    modelForecastP: 0.35,
    schemaClusterId: 1,
    analogRecalls: [
      recall('eq-1', 'materialized', 0.85),
      recall('eq-2', 'materialized', 0.74),
      recall('eq-3', 'materialized', 0.65),
      recall('eq-4', 'fizzled', 0.55),
      recall('eq-5', 'partial', 0.5),
    ],
  },
  {
    id: 'markets-currency-stress',
    description: 'Emerging-market currency depreciation stress that does not cascade.',
    factDomain: 'markets',
    hypothesis: {
      kind: 'anomaly-convergence' as HypothesisKind,
      statement: 'Emerging-market currency depreciates sharply against the ruble amid FX exchange-rate stress.',
      domains: ['markets'],
    },
    groundTruthOutcome: 0,
    modelForecastP: 0.15,
    analogRecalls: [
      recall('fx-1', 'fizzled', 0.77),
      recall('fx-2', 'fizzled', 0.66),
      recall('fx-3', 'fizzled', 0.61),
      recall('fx-4', 'materialized', 0.52),
      recall('fx-5', 'fizzled', 0.47),
    ],
  },
  {
    id: 'cyber-ics-intrusion',
    description: 'A confirmed ICS/SCADA ransomware intrusion under investigation.',
    factDomain: 'cyber',
    hypothesis: {
      kind: 'anomaly-convergence' as HypothesisKind,
      statement: 'A confirmed ransomware intrusion into critical infrastructure SCADA systems is under investigation.',
      domains: ['cyber'],
    },
    groundTruthOutcome: 1,
    modelForecastP: 0.55,
    schemaClusterId: 2,
    analogRecalls: [
      recall('cy-1', 'fizzled', 0.8),
      recall('cy-2', 'fizzled', 0.7),
      recall('cy-3', 'materialized', 0.63),
      recall('cy-4', 'fizzled', 0.56),
      recall('cy-5', 'fizzled', 0.5),
    ],
  },
  {
    id: 'cyber-breach-contained',
    description: 'A reported PII breach stays contained under regulatory review.',
    factDomain: 'cyber',
    hypothesis: {
      kind: 'anomaly-convergence' as HypothesisKind,
      statement: 'A reported data breach exposing PII is under GDPR regulatory review.',
      domains: ['cyber'],
    },
    groundTruthOutcome: 0,
    modelForecastP: 0.2,
    analogRecalls: [
      recall('br-1', 'fizzled', 0.76),
      recall('br-2', 'fizzled', 0.67),
      recall('br-3', 'materialized', 0.6),
      recall('br-4', 'fizzled', 0.53),
      recall('br-5', 'fizzled', 0.48),
    ],
  },
  {
    id: 'weather-hurricane-track',
    description: 'A tropical storm strengthens toward a hurricane landfall threat.',
    factDomain: 'weather',
    hypothesis: {
      kind: 'situation-escalation' as HypothesisKind,
      statement: 'A tropical storm strengthens toward hurricane status with a landfall threat signal along the coast.',
      domains: ['weather'],
    },
    groundTruthOutcome: 1,
    modelForecastP: 0.4,
    schemaClusterId: 3,
    analogRecalls: [
      recall('hu-1', 'materialized', 0.88),
      recall('hu-2', 'materialized', 0.75),
      recall('hu-3', 'materialized', 0.66),
      recall('hu-4', 'fizzled', 0.57),
      recall('hu-5', 'partial', 0.52),
    ],
  },
  {
    id: 'weather-drought-watch',
    description: 'A D2 drought condition is monitored but does not escalate.',
    factDomain: 'weather',
    hypothesis: {
      kind: 'cross-domain-cluster' as HypothesisKind,
      statement: 'An ongoing D2 drought condition with rainfall deficit is being monitored for escalation.',
      domains: ['weather', 'shortage'],
    },
    groundTruthOutcome: 0,
    modelForecastP: 0.18,
    analogRecalls: [
      recall('dr-1', 'fizzled', 0.74),
      recall('dr-2', 'fizzled', 0.64),
      recall('dr-3', 'fizzled', 0.59),
      recall('dr-4', 'materialized', 0.53),
      recall('dr-5', 'fizzled', 0.46),
    ],
  },
  {
    id: 'shortage-wheat-spike',
    description: 'A chokepoint disruption threatens a wheat price spike.',
    factDomain: 'macro',
    hypothesis: {
      kind: 'cross-domain-cluster' as HypothesisKind,
      statement: 'Wheat supply disruption at a key chokepoint threatens a commodity price spike.',
      domains: ['shortage', 'macro'],
    },
    groundTruthOutcome: 1,
    modelForecastP: 0.5,
    analogRecalls: [
      recall('wh-1', 'materialized', 0.81),
      recall('wh-2', 'materialized', 0.7),
      recall('wh-3', 'partial', 0.62),
      recall('wh-4', 'fizzled', 0.54),
      recall('wh-5', 'materialized', 0.49),
    ],
  },
  {
    id: 'maritime-port-strike',
    description: 'A longshoremen strike closes a major port.',
    factDomain: 'maritime',
    hypothesis: {
      kind: 'alert-burst' as HypothesisKind,
      statement: 'A longshoremen strike closes a major port, container shipping delays expected.',
      domains: ['maritime', 'shortage'],
    },
    groundTruthOutcome: 1,
    modelForecastP: 0.65,
    analogRecalls: [
      recall('pt-1', 'materialized', 0.84),
      recall('pt-2', 'materialized', 0.73),
      recall('pt-3', 'materialized', 0.64),
      recall('pt-4', 'fizzled', 0.55),
      recall('pt-5', 'partial', 0.51),
    ],
  },
  {
    id: 'aviation-airspace-notam',
    description: 'A TFR NOTAM signal does not turn into a full airspace closure.',
    factDomain: 'aviation',
    hypothesis: {
      kind: 'alert-burst' as HypothesisKind,
      statement: 'A TFR flight restriction NOTAM signals a possible airspace closure over the region.',
      domains: ['aviation'],
    },
    groundTruthOutcome: 0,
    modelForecastP: 0.3,
    analogRecalls: [
      recall('av-1', 'fizzled', 0.72),
      recall('av-2', 'fizzled', 0.63),
      recall('av-3', 'materialized', 0.58),
      recall('av-4', 'fizzled', 0.52),
      recall('av-5', 'fizzled', 0.45),
    ],
  },
  {
    id: 'general-watchlist-convergence',
    description: 'Unrelated watchlist entities converge without a clear causal link.',
    factDomain: 'other',
    hypothesis: {
      kind: 'watchlist-convergence' as HypothesisKind,
      statement: 'Multiple unrelated watchlist entities converge in the same 24-hour window without a clear causal link.',
      domains: [],
    },
    groundTruthOutcome: 0,
    modelForecastP: 0.25,
    analogRecalls: [
      recall('wl-1', 'fizzled', 0.7),
      recall('wl-2', 'fizzled', 0.61),
      recall('wl-3', 'fizzled', 0.55),
      recall('wl-4', 'materialized', 0.5),
      recall('wl-5', 'fizzled', 0.46),
    ],
  },
];

// ── Training corpus for the schema stage (consolidation-style clusters) ────
//
// Four clusters of six resolved episodes each, one per matched golden window
// above (schemaClusterId 0-3). Vectors are "one-hot direction" per cluster —
// identical within a cluster (cosine similarity 1.0), near-orthogonal across
// clusters — the exact pattern consolidation.test.mts uses to get
// deterministic, controllable clustering without a real embedder.
//
// Rates are deliberately mixed: three clusters have a HIGH (0.83) rate that
// correctly predicts their matched window's "materialized" ground truth;
// one (cluster 2, cyber-ICS) has a LOW (0.17) rate that predicts "fizzled"
// against a window that actually materialized — a genuine miss, so the
// benchmark's schema true-positive rate is a real (< 100%) measurement, not
// a rigged one.

function trainingVector(clusterId: number, dim = 32): number[] {
  const v = Array.from<number>({ length: dim }).fill(0);
  const seed = clusterId * 13;
  v[seed % dim] = 1;
  v[(seed * 7 + 1) % dim] = (v[(seed * 7 + 1) % dim] ?? 0) + 0.5;
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map(x => (norm > 0 ? x / norm : 0));
}

function trainingEpisode(clusterId: number, domain: string, outcome: Episode['outcome'], idx: number): Episode {
  return {
    id: `train-${clusterId}-${idx}`,
    kind: 'hypothesis',
    signature: `train-sig-${clusterId}-${idx}`,
    summary: `training episode for cluster ${clusterId}`,
    domains: [domain],
    entities: [`cluster-${clusterId}-entity`],
    createdAt: 1_700_000_000_000,
    resolvedAt: 1_700_000_000_000 + 12 * 3_600_000,
    outcome,
    vector: trainingVector(clusterId),
    tier: 'hashed',
  };
}

/** Per-cluster outcome recipe: 5 materialized + 1 fizzled ⇒ rate 0.833 (high, informative); reversed ⇒ rate 0.167 (low, informative). */
const HIGH_RECIPE: Episode['outcome'][] = ['materialized', 'materialized', 'materialized', 'materialized', 'materialized', 'fizzled'];
const LOW_RECIPE: Episode['outcome'][] = ['fizzled', 'fizzled', 'fizzled', 'fizzled', 'fizzled', 'materialized'];

export interface TrainingCluster {
  clusterId: number;
  domain: string;
  episodes: Episode[];
}

export const TRAINING_CLUSTERS: readonly TrainingCluster[] = [
  { clusterId: 0, domain: 'conflict', episodes: HIGH_RECIPE.map((o, i) => trainingEpisode(0, 'conflict', o, i)) },
  { clusterId: 1, domain: 'markets', episodes: HIGH_RECIPE.map((o, i) => trainingEpisode(1, 'markets', o, i)) },
  { clusterId: 2, domain: 'cyber', episodes: LOW_RECIPE.map((o, i) => trainingEpisode(2, 'cyber', o, i)) },
  { clusterId: 3, domain: 'weather', episodes: HIGH_RECIPE.map((o, i) => trainingEpisode(3, 'weather', o, i)) },
];

export const TRAINING_EPISODES: readonly Episode[] = TRAINING_CLUSTERS.flatMap(c => c.episodes);

// ── Calibration pool (for recalibration + conformal stages) ────────────────
//
// A synthetic, WELL-CALIBRATED pool: each record's outcome is drawn
// Bernoulli(p) from a fixed-seed PRNG, so by construction the reliability
// curve is close to identity. This keeps the benchmark's interesting signal
// in the golden-window pipeline stages themselves (base rate blending,
// aggregation, schema matching) rather than in a contrived miscalibration
// story. 45 resolved records per domain (≥ MIN_DOMAIN_N for both
// recalibration [30] and conformal [40]) across the 8 domains the golden
// windows use.

const CALIBRATION_DOMAINS: readonly FactDomain[] = ['conflict', 'markets', 'cyber', 'weather', 'macro', 'maritime', 'aviation', 'other'];
const RECORDS_PER_DOMAIN = 45;

function buildCalibrationPool(): PredictionRecord[] {
  const rng = mulberry32(0xC0_FF_EE);
  const records: PredictionRecord[] = [];
  let seq = 0;
  for (const domain of CALIBRATION_DOMAINS) {
    for (let i = 0; i < RECORDS_PER_DOMAIN; i++) {
      seq += 1;
      // Spread predicted probabilities evenly across [0.05, 0.95].
      const p = 0.05 + (0.9 * i) / (RECORDS_PER_DOMAIN - 1);
      const draw = rng();
      const status: PredictionRecord['status'] = draw < p ? 'resolved_true' : 'resolved_false';
      records.push({
        id: `cal-${domain}-${seq}`,
        sourceId: 'bench-fixture',
        domain,
        claim: `synthetic calibration claim ${seq} (${domain})`,
        probability: Math.round(p * 1000) / 1000,
        predictedAt: 1_700_000_000_000,
        resolveBy: 1_700_000_000_000 + 7 * 24 * 3_600_000,
        status,
        resolvedAt: 1_700_000_000_000 + 24 * 3_600_000,
        algorithmVersion: 'bench-fixture-v1',
      });
    }
  }
  return records;
}

export const CALIBRATION_POOL: readonly PredictionRecord[] = buildCalibrationPool();
