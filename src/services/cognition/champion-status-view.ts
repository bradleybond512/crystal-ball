/**
 * ACC-403 — Champion/challenger status view-model.
 *
 * Pure composition over the ACC-402 promotion machinery: takes the
 * active champion + history (champion-registry), each challenger's
 * joined-pair evidence (ACC-401 collectJoinedEvidence) and its gate
 * decision (evaluatePromotionGate), and produces a renderable view:
 *
 *   - active champion and version;
 *   - challengers and evidence counts (overall + per domain);
 *   - metric deltas (Brier, log loss) with two-sided bootstrap
 *     confidence intervals;
 *   - promotion / rejection / rollback / insufficient-evidence reasons.
 *
 * Pure module — no DOM, no fetch, no globals, no Date.now(). The
 * renderer (AlgorithmDiagnosticPanel) owns all HTML; this module owns
 * all judgment.
 */

import type { ChampionEntry } from './champion-registry';
import type { PromotionDecision } from './promotion-gate';
import {
  brierImprovementDiffs,
  logLossImprovementDiffs,
  pairedBootstrapInterval,
} from './promotion-gate';
import type { JoinedPairEvidence } from './shadow-rollout';

// ── Public types ──────────────────────────────────────────────────────

export interface ChallengerStatusInput {
  runId: string;
  challengerId: string;
  challengerVersion?: string;
  /** Exact joined-pair evidence for this challenger's shadow run. */
  pairs: readonly JoinedPairEvidence[];
  /** The ACC-402 gate decision computed on the same evidence. */
  decision: PromotionDecision;
}

export interface ChampionStatusViewInput {
  slot: string;
  /** Active champion, when one is installed. */
  active?: ChampionEntry;
  /** Slot activation history, oldest first (champion-registry shape). */
  history: readonly ChampionEntry[];
  challengers: readonly ChallengerStatusInput[];
  /** Two-sided CI confidence for metric deltas. Default 0.9. */
  ciConfidence?: number;
  /** Bootstrap resamples for the CIs. Default 1000. */
  bootstrapResamples?: number;
  /** Deterministic bootstrap seed. Default matches the gate's. */
  bootstrapSeed?: number;
}

export interface MetricDelta {
  metric: 'brier' | 'log-loss';
  /** Mean per-pair improvement, incumbent − challenger (positive =
   *  challenger better). */
  delta: number;
  ciLow: number;
  ciHigh: number;
  /** True when the whole interval sits above zero. */
  better: boolean;
  explanation: string;
}

export type ChallengerStatus = 'promotable' | 'rejected' | 'insufficient-evidence';

export interface ChallengerRow {
  runId: string;
  challengerId: string;
  challengerVersion?: string;
  status: ChallengerStatus;
  evidenceCount: number;
  perDomainCounts: Record<string, number>;
  /** Fraction of evidence resolved only by proxy signals. */
  proxyShare: number;
  deltas: MetricDelta[];
  /** Why this challenger is (not) promotable — gate details verbatim. */
  reasons: string[];
}

export interface ActivityRow {
  at: number;
  kind: 'initial' | 'promotion' | 'rollback';
  summary: string;
}

export interface ChampionStatusView {
  slot: string;
  /** Undefined when no champion is installed yet (pre-ACC-404 state). */
  championId?: string;
  championVersion?: string;
  championActivatedAt?: number;
  championActivationReason?: string;
  challengers: ChallengerRow[];
  /** Newest-first activation history with human summaries. */
  recentActivity: ActivityRow[];
}

const DEFAULT_CI_CONFIDENCE = 0.9;
const DEFAULT_RESAMPLES = 1000;
const DEFAULT_SEED = 0x40_2A_CC;
const MAX_ACTIVITY_ROWS = 6;

// ── Build ─────────────────────────────────────────────────────────────

export function buildChampionStatusView(input: ChampionStatusViewInput): ChampionStatusView {
  const challengers = input.challengers.map((c) => buildChallengerRow(c, input));
  return {
    slot: input.slot,
    ...(input.active === undefined ? {} : {
      championId: input.active.modelId,
      ...(input.active.version === undefined ? {} : { championVersion: input.active.version }),
      championActivatedAt: input.active.activatedAt,
      championActivationReason: describeActivation(input.active),
    }),
    challengers,
    recentActivity: buildActivity(input.history),
  };
}

// ── Challenger rows ──────────────────────────────────────────────────

function buildChallengerRow(
  c: ChallengerStatusInput,
  input: ChampionStatusViewInput,
): ChallengerRow {
  const d = c.decision;
  const status = statusOf(d);
  const reasons = status === 'promotable'
    ? ['All promotion gates pass.', ...d.gates.map((g) => g.detail)]
    : d.gates.filter((g) => !g.pass).map((g) => g.detail);
  return {
    runId: c.runId,
    challengerId: c.challengerId,
    ...(c.challengerVersion === undefined ? {} : { challengerVersion: c.challengerVersion }),
    status,
    evidenceCount: d.pairCount,
    perDomainCounts: { ...d.perDomainCounts },
    proxyShare: d.proxyShare,
    deltas: buildDeltas(c.pairs, d, input),
    reasons,
  };
}

/** Insufficient evidence when either min-pairs gate fails; otherwise
 *  the gate recommendation decides promotable vs rejected. */
function statusOf(d: PromotionDecision): ChallengerStatus {
  const evidenceShort = d.gates.some(
    (g) => !g.pass && (g.id === 'min-pairs-overall' || g.id === 'min-pairs-per-domain'),
  );
  if (evidenceShort) return 'insufficient-evidence';
  return d.recommendation === 'promote' ? 'promotable' : 'rejected';
}

function buildDeltas(
  pairs: readonly JoinedPairEvidence[],
  d: PromotionDecision,
  input: ChampionStatusViewInput,
): MetricDelta[] {
  if (pairs.length === 0) return [];
  const confidence = input.ciConfidence ?? DEFAULT_CI_CONFIDENCE;
  const resamples = input.bootstrapResamples ?? DEFAULT_RESAMPLES;
  const seed = input.bootstrapSeed ?? DEFAULT_SEED;
  const out: MetricDelta[] = [];
  if (d.brierIncumbent !== undefined && d.brierChallenger !== undefined) {
    out.push(metricDelta(
      'brier',
      d.brierIncumbent - d.brierChallenger,
      brierImprovementDiffs(pairs),
      confidence, resamples, seed,
    ));
  }
  if (d.logLossIncumbent !== undefined && d.logLossChallenger !== undefined) {
    out.push(metricDelta(
      'log-loss',
      d.logLossIncumbent - d.logLossChallenger,
      logLossImprovementDiffs(pairs),
      confidence, resamples, seed,
    ));
  }
  return out;
}

function metricDelta(
  metric: MetricDelta['metric'],
  delta: number,
  diffs: readonly number[],
  confidence: number,
  resamples: number,
  seed: number,
): MetricDelta {
  const { low, high } = pairedBootstrapInterval(diffs, resamples, confidence, seed);
  const better = low > 0;
  const pct = Math.round(confidence * 100);
  let verdict = 'interval spans zero — not conclusive';
  if (better) verdict = 'challenger better across the whole interval';
  else if (high < 0) verdict = 'challenger worse across the whole interval';
  return {
    metric,
    delta,
    ciLow: low,
    ciHigh: high,
    better,
    explanation: `${metric} improvement ${delta.toFixed(4)} (${pct}% CI ${low.toFixed(4)} … ${high.toFixed(4)}) — ${verdict}.`,
  };
}

// ── Activity history ─────────────────────────────────────────────────

function describeActivation(e: ChampionEntry): string {
  switch (e.reason) {
    case 'initial': {
      return `Initial champion '${e.modelId}' installed.`;
    }
    case 'promotion': {
      const over = e.decision ? ` over '${e.decision.incumbentId}'` : '';
      const evidence = e.decision ? ` on ${e.decision.pairCount} joined pairs` : '';
      return `Promoted '${e.modelId}'${over}${evidence}.`;
    }
    case 'rollback': {
      return `Rolled back to '${e.modelId}'.`;
    }
  }
}

function buildActivity(history: readonly ChampionEntry[]): ActivityRow[] {
  const rows: ActivityRow[] = [];
  for (let i = history.length - 1; i >= 0 && rows.length < MAX_ACTIVITY_ROWS; i -= 1) {
    const e = history[i]!;
    rows.push({ at: e.activatedAt, kind: e.reason, summary: describeActivation(e) });
  }
  return rows;
}
