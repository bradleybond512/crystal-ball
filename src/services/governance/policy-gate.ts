/**
 * Policy Gate — the integration glue between safe-adjustment proposals
 * (and other automated actions) and the Policy Engine.
 *
 * Callers run the safe-adjustment engine, then wrap each proposal in
 * `gateAdjustmentProposal()` to get a PolicyVerdict. The verdict
 * tells the host whether to auto-apply, queue for user approval, send
 * to PR review, or refuse outright.
 *
 * Pure deterministic. No DOM, no fetch, no globals at import time.
 *
 * Plan invariants (post-PR197 integration handoff item 4):
 *   - The policy engine MUST gate any automated tuning, provider /
 *     model change, notification behavior change, or safety-sensitive
 *     self-improvement action.
 *   - This module never applies a change. It only emits the verdict.
 *   - Gate is purely a function of (action context) — same input ⇒
 *     same verdict.
 */

import type { AdjustmentProposal } from '@/services/algorithms/safe-adjustment';
import type { AlgorithmDefinition } from '@/services/algorithms/algorithm-registry';
import { evaluatePolicy, type PolicyVerdict, type PolicyContext } from './policy-engine';

// ── Public API ──────────────────────────────────────────────────────────

export interface GateInput {
  proposal: AdjustmentProposal;
  /** Registry definition for the algorithm (provides criticality +
   *  domain). When the algorithm isn't in the registry we fail-closed
   *  with require_user_approval. */
  algorithm?: Pick<AlgorithmDefinition, 'id' | 'criticality' | 'domain'>;
  /** Number of graded evaluations supporting this proposal. */
  evidenceCount: number;
  /** Whether the proposal passed replay-fixture verification. */
  replayPassed: boolean;
  /** Whether the proposal beat baseline in the backtest harness. */
  backtestPassed: boolean;
  /** True when the parameter being tuned controls notification
   *  behavior (rung, suppression window, bypass). */
  affectsNotifications?: boolean;
  /** True when the parameter touches private user data. */
  affectsPrivateData?: boolean;
}

export interface GatedProposal {
  proposal: AdjustmentProposal;
  verdict: PolicyVerdict;
}

/**
 * Convert a safe-adjustment proposal into a gated proposal by
 * evaluating it through the Policy Engine.
 *
 * The proposal's `verdict === 'apply'` is treated as the request to
 * auto-apply. For all other proposal verdicts (`noop`, `manual_review`,
 * `at_bound`, `no_tunable`) we still emit a policy verdict — typically
 * `allow_auto` for noops since there's nothing to apply, and
 * `require_user_approval` for the rest because the host has to decide
 * what to do with the manual-review hint.
 */
export function gateAdjustmentProposal(input: GateInput): GatedProposal {
  const ctx: PolicyContext = {
    actionKind: 'algorithm_tuning',
    targetId: input.proposal.algorithmId,
    domain: input.algorithm?.domain ?? 'unknown',
    criticality: input.algorithm?.criticality ?? 'medium',
    evidenceCount: input.evidenceCount,
    replayPassed: input.replayPassed,
    backtestPassed: input.backtestPassed,
    affectsNotifications: input.affectsNotifications ?? false,
    affectsPrivateData: input.affectsPrivateData ?? false,
  };
  // Special cases that the Policy Engine doesn't see: when the
  // proposal's own verdict is anything other than 'apply', we don't
  // need to spend the policy budget on a strict gate. But we still
  // run the policy check to catch safety-critical algorithms even
  // for noop proposals (they shouldn't auto-apply because the
  // algorithm itself is safety-tier).
  return { proposal: input.proposal, verdict: evaluatePolicy(ctx) };
}

/**
 * Convenience: gate a list of proposals. Verdicts come back in the
 * same order as the input.
 */
export function gateAdjustmentProposals(inputs: readonly GateInput[]): GatedProposal[] {
  return inputs.map((input) => gateAdjustmentProposal(input));
}

/** Filter helper: only the gated proposals the host can auto-apply
 *  without any human / PR involvement. */
export function autoApplyOnly(gated: readonly GatedProposal[]): GatedProposal[] {
  return gated.filter((g) => g.verdict.decision === 'allow_auto' && g.proposal.verdict === 'apply');
}

/** Filter helper: gated proposals that need explicit user approval. */
export function userApprovalOnly(gated: readonly GatedProposal[]): GatedProposal[] {
  return gated.filter((g) => g.verdict.decision === 'require_user_approval');
}
