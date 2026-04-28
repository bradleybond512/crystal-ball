/**
 * Policy Engine — per
 * docs/CLAUDE_STRATEGIC_SELF_IMPROVEMENT_ROADMAP_2026-04-28.md Layer 1.
 *
 * Pure deterministic decision layer that gates app actions
 * (algorithm tunings, provider reconfigurations, notification
 * behavior changes, fact assertions, etc.) into one of:
 *
 *     allow_auto              — app can apply locally without asking
 *     require_user_approval   — needs explicit click-to-confirm
 *     require_pr_review       — needs a code/config PR + cross-agent
 *     deny                    — never auto-apply, even with evidence
 *
 * Plan invariants:
 *   - No DOM, no fetch, no globals — same input ⇒ same output.
 *   - Output is JSON-serializable for the diagnostics export bundle
 *     and for the agent handoff bundle (Layer 8 of the roadmap).
 *   - Hard rules win over heuristics: safety-critical setting
 *     auto-apply is denied at the top of the decision flow regardless
 *     of how much evidence accumulated.
 *   - Deterministic rule order — earlier rules short-circuit later
 *     ones, so a newer rule can override behavior simply by being
 *     added higher in the list.
 *   - The engine never *applies* an action; it only emits a verdict.
 *     Callers are responsible for actually executing or queuing.
 */

// ── Public API ──────────────────────────────────────────────────────────

export type PolicyDecision =
  | 'allow_auto'
  | 'require_user_approval'
  | 'require_pr_review'
  | 'deny';

export type ActionCriticality = 'low' | 'medium' | 'high' | 'safety';

/** Categorical action kind — keep this set small and stable so
 *  policies are easy to reason about. New action kinds get added to
 *  this union, not buried in `targetId`. */
export type PolicyActionKind =
  | 'algorithm_tuning'        // safe-adjustment proposal applying a parameter
  | 'algorithm_promote'       // promote a shadow-mode algorithm to production
  | 'notification_setting'    // change a notification threshold / quiet-hours bypass
  | 'provider_config'         // change a provider key, endpoint, weight
  | 'fact_assertion'          // claim something as truth (vs. tuning a score)
  | 'private_data_change'     // anything touching saved places, watchlists, identity
  | 'cache_purge'             // clear caches / refresh stale data
  | 'ui_preference'           // theme, sort order, dismiss-banner
  | 'feature_toggle';         // enable/disable a feature flag

export interface PolicyContext {
  actionKind: PolicyActionKind;
  /** Stable id for the target of the action (an algorithm id, a
   *  setting key, a feature id, a provider id). */
  targetId: string;
  /** Domain (mission domain or free-form) the action serves. */
  domain: string;
  /** Action criticality — pull from algorithm-registry / capability
   *  metadata where available. Defaults to medium when unknown. */
  criticality: ActionCriticality;
  /** Number of graded evaluation samples available to support the
   *  decision. */
  evidenceCount: number;
  /** True when the change has been validated against the replay
   *  fixture catalog (closed-loop ops layer). */
  replayPassed: boolean;
  /** True when a backtest comparison report rates the candidate
   *  better than the baseline. */
  backtestPassed: boolean;
  /** True when the action would alter user-facing notification
   *  behavior (rung, suppression, bypass). */
  affectsNotifications: boolean;
  /** True when the action touches private user data (saved places,
   *  watchlist contents, vault secrets). */
  affectsPrivateData: boolean;
}

export interface PolicyVerdict {
  decision: PolicyDecision;
  /** Free-text rationale for the decision, plan-readable. */
  reason: string;
  /** Concrete missing evidence required to relax to a less-strict
   *  decision (sorted by importance). Empty when the decision is
   *  already `allow_auto` or `deny`. */
  requiredEvidence: readonly string[];
  /** The rule id that fired (stable, JSON-serializable). Useful for
   *  the audit trail and the agent handoff bundle. */
  ruleId: string;
}

// ── Rule-based decision flow ────────────────────────────────────────────

interface PolicyRule {
  id: string;
  /** True when the rule applies to this context. */
  matches(ctx: PolicyContext): boolean;
  /** What verdict to emit when matched. */
  verdict(ctx: PolicyContext): PolicyVerdict;
}

const SAFETY_AUTO_DENY: PolicyRule = {
  id: 'safety_auto_deny',
  matches: (ctx) => ctx.criticality === 'safety' && ctx.actionKind !== 'cache_purge' && ctx.actionKind !== 'ui_preference',
  verdict: () => ({
    decision: 'deny',
    reason: 'Safety-critical actions cannot auto-apply. They must go through PR review with cross-agent sign-off.',
    requiredEvidence: [],
    ruleId: 'safety_auto_deny',
  }),
};

const PRIVATE_DATA_USER_APPROVAL: PolicyRule = {
  id: 'private_data_user_approval',
  matches: (ctx) => ctx.affectsPrivateData,
  verdict: () => ({
    decision: 'require_user_approval',
    reason: 'Private data changes (saved places, watchlist, identity, vault) require explicit user approval.',
    requiredEvidence: ['user click-to-confirm'],
    ruleId: 'private_data_user_approval',
  }),
};

const NOTIFICATION_USER_APPROVAL: PolicyRule = {
  id: 'notification_user_approval',
  matches: (ctx) => ctx.affectsNotifications,
  verdict: () => ({
    decision: 'require_user_approval',
    reason: 'Notification behavior changes require explicit user approval — silenced alerts cannot be undone.',
    requiredEvidence: ['user click-to-confirm', 'replay pass'],
    ruleId: 'notification_user_approval',
  }),
};

const FACT_ASSERTION_DENY: PolicyRule = {
  id: 'fact_assertion_deny',
  matches: (ctx) => ctx.actionKind === 'fact_assertion',
  verdict: () => ({
    decision: 'deny',
    reason: 'User dismissals tune relevance/noise — they cannot mark a fact false. Truth claims need source evidence, not user clicks.',
    requiredEvidence: [],
    ruleId: 'fact_assertion_deny',
  }),
};

const PROVIDER_CONFIG_PR: PolicyRule = {
  id: 'provider_config_pr_review',
  matches: (ctx) => ctx.actionKind === 'provider_config',
  verdict: () => ({
    decision: 'require_pr_review',
    reason: 'Provider key / endpoint / weight changes need PR review so credentials and rate-limit budgets stay tracked.',
    requiredEvidence: ['PR with cross-agent review'],
    ruleId: 'provider_config_pr_review',
  }),
};

const ALGO_PROMOTE_PR: PolicyRule = {
  id: 'algo_promote_pr_review',
  matches: (ctx) => ctx.actionKind === 'algorithm_promote',
  verdict: (ctx) => {
    const missing: string[] = [];
    if (!ctx.replayPassed) missing.push('replay-fixture pass');
    if (!ctx.backtestPassed) missing.push('backtest comparison pass');
    if (ctx.evidenceCount < 50) missing.push(`≥50 graded samples (have ${ctx.evidenceCount})`);
    return {
      decision: 'require_pr_review',
      reason: 'Promoting a shadow-mode algorithm to production needs PR review plus replay + backtest evidence.',
      requiredEvidence: missing,
      ruleId: 'algo_promote_pr_review',
    };
  },
};

const ALGO_TUNING_GATE: PolicyRule = {
  id: 'algo_tuning_gate',
  matches: (ctx) => ctx.actionKind === 'algorithm_tuning',
  verdict: (ctx) => {
    // Safety-critical tunings already denied above. By the time we
    // reach here, criticality is low/medium/high.
    if (ctx.criticality === 'high') {
      const missing: string[] = [];
      if (!ctx.replayPassed) missing.push('replay-fixture pass');
      if (!ctx.backtestPassed) missing.push('backtest comparison pass');
      if (ctx.evidenceCount < 30) missing.push(`≥30 graded samples (have ${ctx.evidenceCount})`);
      if (missing.length > 0) {
        return {
          decision: 'require_user_approval',
          reason: 'High-criticality tuning needs user approval until replay + backtest + sample size all pass.',
          requiredEvidence: missing,
          ruleId: 'algo_tuning_gate_high_pending',
        };
      }
      return {
        decision: 'allow_auto',
        reason: 'High-criticality tuning has replay pass, backtest pass, and ≥30 graded samples.',
        requiredEvidence: [],
        ruleId: 'algo_tuning_gate_high_ready',
      };
    }
    // Low / medium tunings — auto-apply once 20 graded samples + replay pass.
    const missing: string[] = [];
    if (!ctx.replayPassed) missing.push('replay-fixture pass');
    if (ctx.evidenceCount < 20) missing.push(`≥20 graded samples (have ${ctx.evidenceCount})`);
    if (missing.length > 0) {
      return {
        decision: 'require_user_approval',
        reason: 'Low/medium tuning needs user approval until replay pass and ≥20 graded samples.',
        requiredEvidence: missing,
        ruleId: 'algo_tuning_gate_lowmed_pending',
      };
    }
    return {
      decision: 'allow_auto',
      reason: 'Low/medium tuning has replay pass and ≥20 graded samples — safe to apply locally.',
      requiredEvidence: [],
      ruleId: 'algo_tuning_gate_lowmed_ready',
    };
  },
};

const FEATURE_TOGGLE_AUTO: PolicyRule = {
  id: 'feature_toggle_auto',
  matches: (ctx) => ctx.actionKind === 'feature_toggle',
  verdict: () => ({
    decision: 'allow_auto',
    reason: 'Feature toggles are reversible local preferences — auto-apply.',
    requiredEvidence: [],
    ruleId: 'feature_toggle_auto',
  }),
};

const UI_PREFERENCE_AUTO: PolicyRule = {
  id: 'ui_preference_auto',
  matches: (ctx) => ctx.actionKind === 'ui_preference',
  verdict: () => ({
    decision: 'allow_auto',
    reason: 'UI preferences are local-only and reversible.',
    requiredEvidence: [],
    ruleId: 'ui_preference_auto',
  }),
};

const CACHE_PURGE_AUTO: PolicyRule = {
  id: 'cache_purge_auto',
  matches: (ctx) => ctx.actionKind === 'cache_purge',
  verdict: () => ({
    decision: 'allow_auto',
    reason: 'Cache purges are recoverable — auto-apply.',
    requiredEvidence: [],
    ruleId: 'cache_purge_auto',
  }),
};

/** Default rule chain. Order matters: earlier rules win. */
const DEFAULT_RULES: readonly PolicyRule[] = [
  SAFETY_AUTO_DENY,
  PRIVATE_DATA_USER_APPROVAL,
  NOTIFICATION_USER_APPROVAL,
  FACT_ASSERTION_DENY,
  PROVIDER_CONFIG_PR,
  ALGO_PROMOTE_PR,
  ALGO_TUNING_GATE,
  FEATURE_TOGGLE_AUTO,
  UI_PREFERENCE_AUTO,
  CACHE_PURGE_AUTO,
];

const FALLBACK_VERDICT: PolicyVerdict = {
  decision: 'require_user_approval',
  reason: 'No matching rule. Falling back to user approval (fail-closed).',
  requiredEvidence: ['user click-to-confirm'],
  ruleId: 'fallback_user_approval',
};

/**
 * Evaluate a context against the (default or custom) rule chain and
 * return the first matching verdict. Rules are evaluated in order;
 * the first match wins. Falls back to require_user_approval when no
 * rule matches — fail-closed by design.
 */
export function evaluatePolicy(
  ctx: PolicyContext,
  rules: readonly PolicyRule[] = DEFAULT_RULES,
): PolicyVerdict {
  for (const rule of rules) {
    if (rule.matches(ctx)) return rule.verdict(ctx);
  }
  return FALLBACK_VERDICT;
}

// Test-only access for plan compliance: the rule list itself, so a
// future audit / test can verify ordering without re-deriving the
// default chain. Deliberately not exported by name so app code uses
// `evaluatePolicy` only.
export function getDefaultPolicyRulesForTesting(): readonly PolicyRule[] {
  return DEFAULT_RULES;
}
