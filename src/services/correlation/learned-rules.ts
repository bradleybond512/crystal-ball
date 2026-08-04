/**
 * Learned correlation rules — turns statistically significant lead-lag
 * edges into live CorrelationRules, so discovered couplings actually
 * correlate future events instead of only annotating compound risk.
 *
 * Learned rules carry no baseConfidence: the full PR 1 kernel scores
 * them, and PR 2's per-rule reliability corrects a bogus discovery over
 * time. Capped at MAX_LEARNED_RULES by strength.
 *
 * Pure. See docs/CORRELATION_NEXTGEN_PLAN.md §D4.
 */

import type { CorrelateEngine, CorrelationRule } from '../intelligence/correlate-engine';
import type { PromotingLeadLagEdge } from './lead-lag';
import { recordLearnedRulesInstalled } from './correlation-liveness';

export const LEARNED_RULE_PREFIX = 'learned:';
export const MAX_LEARNED_RULES = 12;

const HOUR_MS = 3_600_000;
const MIN_WINDOW_MS = HOUR_MS;
const MAX_WINDOW_MS = 7 * 24 * HOUR_MS;

export function learnedRuleId(edge: Pick<PromotingLeadLagEdge, 'from' | 'to'>): string {
  return `${LEARNED_RULE_PREFIX}${edge.from}->${edge.to}`;
}

/** Build capped, strength-ranked rules from significant edges. */
export function learnedRulesFromEdges(edges: readonly PromotingLeadLagEdge[]): CorrelationRule[] {
  const ranked = [...edges]
    .sort((a, b) => b.strength - a.strength || b.support - a.support)
    .slice(0, MAX_LEARNED_RULES);
  return ranked.map((edge) => toRule(edge));
}

function toRule(edge: PromotingLeadLagEdge): CorrelationRule {
  const from = edge.from;
  const to = edge.to;
  const windowMs = Math.max(MIN_WINDOW_MS, Math.min(MAX_WINDOW_MS, edge.lagP90Ms));
  return {
    id: learnedRuleId(edge),
    name: `Learned: ${from} → ${to}`,
    description: `Mined lead-lag coupling — ${edge.explanation}`,
    domains: [from, to],
    timeWindowMs: windowMs,
    edgeType: 'causal-candidate',
    // Directional: the consequent must come after the antecedent. The
    // engine also tries (b, a), so only the correct ordering matches.
    matchFn: (a, b) =>
      a.domain === from && b.domain === to && b.timestamp > a.timestamp,
  };
}

/** Install `rules` as the complete learned set on a live engine:
 *  stale learned:* rules are unregistered, current ones registered.
 *  Built-in (non-prefixed) rules are never touched. */
export function syncLearnedRules(
  engine: Pick<CorrelateEngine, 'registerRule' | 'unregisterRule' | 'getRules'>,
  rules: readonly CorrelationRule[],
): { added: number; removed: number } {
  const desired = new Map(rules.map((r) => [r.id, r]));
  let removed = 0;
  for (const existing of engine.getRules()) {
    if (!existing.id.startsWith(LEARNED_RULE_PREFIX)) continue;
    if (!desired.has(existing.id)) {
      engine.unregisterRule(existing.id);
      removed += 1;
    }
  }
  let added = 0;
  const current = new Set(engine.getRules().map((r) => r.id));
  for (const rule of desired.values()) {
    if (!rule.id.startsWith(LEARNED_RULE_PREFIX)) continue;
    if (!current.has(rule.id)) added += 1;
    engine.registerRule(rule);
  }
  try {
    const installed = engine.getRules().filter((rule) =>
      rule.id.startsWith(LEARNED_RULE_PREFIX)).length;
    recordLearnedRulesInstalled(engine, installed);
  } catch {
    // Diagnostics are fail-neutral and never affect rule installation.
  }
  return { added, removed };
}
