/**
 * Self-Improvement Scheduler — per
 * docs/CLAUDE_STRATEGIC_SELF_IMPROVEMENT_ROADMAP_2026-04-28.md Layer 10.
 *
 * Pure deterministic ranker that picks the top N improvement
 * candidates this week, emits a Claude/Codex handoff outline for
 * the top item, and explains why the deferred items were not
 * picked. Inputs come from the Quality Debt registry (Layer 9),
 * recent algorithm-health snapshots, and the system-health summary.
 *
 * The scheduler NEVER creates branches or PRs. It produces a
 * recommendation report; the user (or a separate agent) decides
 * what to action. This separation keeps "what should we improve
 * next" explainable and auditable.
 *
 * Plan invariants:
 *   - No DOM, no fetch, no globals at import time.
 *   - JSON-serializable.
 *   - Deterministic — same inputs ⇒ same ranking.
 *   - Effort estimates are coarse buckets (small / medium / large)
 *     so we don't pretend to point-estimate scope.
 *   - Lower-ranked items always include a deferral reason.
 *   - The handoff outline is markdown-friendly so an agent can
 *     consume it directly.
 */

import type { DebtItem, DebtSeverity, DebtCategory } from './quality-debt';

// ── Public API ──────────────────────────────────────────────────────────

export type EffortBucket = 'small' | 'medium' | 'large';

export type ImprovementPriority = 'now' | 'next' | 'later' | 'deferred';

export interface ImprovementCandidate {
  id: string;
  /** Human-readable title for the candidate. */
  title: string;
  /** Source debt item the candidate derives from. */
  debtItemId: string;
  /** Coarse effort estimate. */
  effort: EffortBucket;
  /** Composite ranking score (severity × evidence × ease). */
  score: number;
  /** Why this score (top-3 contributing factors). */
  reasons: readonly string[];
  /** "Why now / why deferred" sentence. */
  rationale: string;
  priority: ImprovementPriority;
}

export interface HandoffOutline {
  candidateId: string;
  title: string;
  /** Markdown-friendly action list the receiving agent can paste
   *  into a PR body. */
  steps: readonly string[];
  /** Pre-built test command suggestions. */
  verificationCommands: readonly string[];
  /** Risk + rollback notes the agent should preserve. */
  notesForAgent: readonly string[];
}

export interface ImprovementReport {
  generatedAt: number;
  /** Top N candidates, ranked. */
  ranked: readonly ImprovementCandidate[];
  /** Markdown outline for the #1 candidate. */
  handoff?: HandoffOutline;
  /** Items below the top-N cutoff and why they didn't make it. */
  deferred: readonly { candidateId: string; reason: string }[];
  summary: string;
}

// ── Inputs ──────────────────────────────────────────────────────────────

export interface AlgorithmHealthSummary {
  algorithmId: string;
  /** Recent grade rate (0..1). Lower means more sample-size hunger. */
  gradeRate: number;
  /** Number of unresolved evaluations. */
  ungradedCount: number;
}

export interface SystemHealthSummary {
  /** Mission domains currently in 'critical' or 'unsafe' state. */
  unsafeDomains: readonly string[];
  /** True when the sidecar has been unreachable in the last hour. */
  sidecarUnreachable: boolean;
}

export interface SchedulerInput {
  /** Active (non-resolved) debt items from the Quality Debt registry. */
  activeDebt: readonly DebtItem[];
  algorithmHealth: readonly AlgorithmHealthSummary[];
  systemHealth: SystemHealthSummary;
  /** Top-N cutoff. Defaults to 5. */
  topN?: number;
  generatedAt?: number;
}

// ── Implementation ──────────────────────────────────────────────────────

const SEVERITY_VALUE: Record<DebtSeverity, number> = {
  critical: 12,
  high: 7,
  medium: 3,
  low: 1,
};

/** Coarse effort heuristic per debt category. The scheduler uses
 *  this to estimate ease — items with smaller effort score higher
 *  for the same severity. */
const CATEGORY_EFFORT: Record<DebtCategory, EffortBucket> = {
  unknown_algorithm_health: 'small',          // collect more samples
  ungraded_predictions: 'small',              // grade them
  stale_baselines: 'small',                   // rerun rebuild job
  noisy_algorithms: 'medium',                 // tune threshold
  unresolved_near_misses: 'medium',           // generate replay fixture
  weak_replay_coverage: 'medium',             // add scenarios
  insufficient_provider_redundancy: 'large',  // add fallback provider
  missing_sources: 'large',                   // wire new provider
  missing_mission_bridges: 'large',           // build a new bridge
  untested_domains: 'large',                  // build full test suite
};

const EFFORT_MULT: Record<EffortBucket, number> = {
  small: 1.5,
  medium: 1,
  large: 0.6,
};

export function planImprovements(input: SchedulerInput): ImprovementReport {
  const generatedAt = input.generatedAt ?? Date.now();
  const topN = input.topN ?? 5;

  const candidates: ImprovementCandidate[] = input.activeDebt.map((item) => {
    const effort: EffortBucket = CATEGORY_EFFORT[item.category] ?? 'medium';
    const severityValue: number = SEVERITY_VALUE[item.severity] ?? 1;
    const ageBoost = ageBoostFromRecorded(item.recordedAt, generatedAt);
    const evidenceBoost = item.evidence?.sourceId ? 1.1 : 0.9;
    const safetyBoost = touchesUnsafeDomain(item, input.systemHealth) ? 1.4 : 1;
    const effortMult: number = EFFORT_MULT[effort] ?? 1;
    const score = severityValue * effortMult * ageBoost * evidenceBoost * safetyBoost;
    const reasons: string[] = [
      `severity=${item.severity}`,
      `effort=${effort}`,
      ageBoost > 1 ? 'aged out of acknowledgement window' : 'fresh debt',
    ];
    return {
      id: `cand-${item.id}`,
      title: titleForCategory(item),
      debtItemId: item.id,
      effort,
      score,
      reasons,
      rationale: '',
      priority: 'later',
    };
  });

  candidates.sort((a, b) => b.score - a.score);

  const ranked = candidates.slice(0, topN).map((c, i) => ({
    ...c,
    priority: priorityForRank(i),
    rationale: rationaleForRank(i, c),
  }));
  const deferred = candidates.slice(topN).map((c) => ({
    candidateId: c.id,
    reason: `Outranked: top ${topN} candidates have higher safety × evidence × ease score (this one scored ${c.score.toFixed(2)})`,
  }));

  const handoff = ranked[0] ? buildHandoff(ranked[0], input.activeDebt) : undefined;
  const summary = buildSummary(ranked);

  return { generatedAt, ranked, handoff, deferred, summary };
}

// ── Helpers ─────────────────────────────────────────────────────────────

function ageBoostFromRecorded(recordedAt: number, now: number): number {
  const ageMs = now - recordedAt;
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  if (ageDays < 1) return 1;
  if (ageDays < 7) return 1.1;
  if (ageDays < 30) return 1.25;
  return 1.4;
}

function touchesUnsafeDomain(item: DebtItem, sys: SystemHealthSummary): boolean {
  if (sys.unsafeDomains.length === 0) return false;
  const text = `${item.impact} ${item.recommendedFix}`.toLowerCase();
  return sys.unsafeDomains.some((d) => text.includes(d.toLowerCase()) || text.includes(d.replace(/_/g, ' ').toLowerCase()));
}

function titleForCategory(item: DebtItem): string {
  switch (item.category) {
    case 'missing_sources': { return `Add backup provider — ${item.impact}`;
    }
    case 'ungraded_predictions': { return `Grade predictions — ${item.impact}`;
    }
    case 'stale_baselines': { return `Refresh baselines — ${item.impact}`;
    }
    case 'untested_domains': { return `Add tests — ${item.impact}`;
    }
    case 'noisy_algorithms': { return `Tune algorithm — ${item.impact}`;
    }
    case 'weak_replay_coverage': { return `Expand replay coverage — ${item.impact}`;
    }
    case 'missing_mission_bridges': { return `Wire mission bridge — ${item.impact}`;
    }
    case 'unresolved_near_misses': { return `Resolve near-miss — ${item.impact}`;
    }
    case 'unknown_algorithm_health': { return `Collect samples — ${item.impact}`;
    }
    case 'insufficient_provider_redundancy': { return `Add provider redundancy — ${item.impact}`;
    }
    default: { return item.impact;
    }
  }
}

function priorityForRank(rank: number): ImprovementPriority {
  if (rank === 0) return 'now';
  if (rank === 1) return 'next';
  return 'later';
}

function rationaleForRank(rank: number, c: ImprovementCandidate): string {
  if (rank === 0) return `Top of the list this week (score ${c.score.toFixed(2)}). Recommended for immediate handoff.`;
  if (rank === 1) return `Strong second-best (score ${c.score.toFixed(2)}). Pick up after the top item lands.`;
  return `Ranked #${rank + 1} (score ${c.score.toFixed(2)}). Fits into the queue once higher items resolve.`;
}

function buildHandoff(top: ImprovementCandidate, debt: readonly DebtItem[]): HandoffOutline {
  const item = debt.find((d) => d.id === top.debtItemId);
  const steps: string[] = [
    `Read the debt item ${top.debtItemId}: ${item?.impact ?? '(detail not available)'}.`,
    `Apply the recommended fix: ${item?.recommendedFix ?? '(no fix recorded)'}.`,
    'Branch off origin/main as `claude/<short-slug>`. Don\'t commit to main.',
    'Add focused tests proving the debt is resolved.',
    'Open a PR with a `Cross-agent review` marker in the body.',
  ];
  const verificationCommands = [
    'npm run lint:strict',
    'npm run typecheck:all',
    'npx tsx --test <new-test-files>',
    'npm run test:sidecar (if sidecar/api files changed)',
  ];
  const notesForAgent: string[] = [
    `Effort estimate: ${top.effort}. Don't expand scope beyond resolving the debt item.`,
    `Resolution requires evidence (Layer 9 invariant) — record DebtEvidence when calling resolve().`,
  ];
  if (item?.severity === 'critical') {
    notesForAgent.unshift('SAFETY-CRITICAL debt — go through the Policy Engine PR-review path, do not auto-apply.');
  }
  return {
    candidateId: top.id,
    title: top.title,
    steps,
    verificationCommands,
    notesForAgent,
  };
}

function buildSummary(ranked: readonly ImprovementCandidate[]): string {
  if (ranked.length === 0) return 'No improvement candidates this week — quality debt registry is empty or resolved.';
  const lines = ranked.map((c, i) => `${i + 1}. ${c.title}`).join('\n');
  return `Top improvements this week:\n${lines}`;
}
