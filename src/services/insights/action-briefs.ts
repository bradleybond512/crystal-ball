/**
 * Action briefs — per
 * docs/INSIGHTS_NOTIFICATIONS_PRESENTATION_PLAN.md section 5
 * (lines 111-143) and PR 3 (lines 389-397).
 *
 * Composes a per-situation "what should I do?" brief from a
 * SituationDescriptor + the playbook library. Unlike playbooks (static
 * data), action briefs are situation-specific: they pull the relevant
 * actions, adjust ordering by urgency, and produce a final
 * recommendation tier.
 *
 * Plan invariant: "Action guidance should be calm, specific, and
 * proportionate to confidence and urgency."
 */

import type { PlaybookCategory, ReactionPlaybook } from './reaction-playbooks';
import { getPlaybook } from './reaction-playbooks';

// ── Inputs ──────────────────────────────────────────────────────────────

export interface SituationDescriptor {
  /** Stable id (situation, alert, or fact id). */
  id: string;
  /** Human-readable title. */
  title: string;
  /** Maps the situation to a playbook category. */
  category: PlaybookCategory;
  /** 0-100 severity / risk score. */
  severityScore: number;
  /** 'low' / 'medium' / 'high' confidence in the situation. */
  confidence: 'low' | 'medium' | 'high';
  /** Optional minutes-until-impact estimate. When provided, the brief
   *  filters to actions that fit the available time. */
  minutesUntilImpact?: number;
  /** Optional list of confirming signals already observed (used to
   *  trim the confirmingSources list to "still missing"). */
  observedConfirming?: readonly string[];
}

// ── Output ──────────────────────────────────────────────────────────────

export type ActionTier = 'monitor' | 'prepare' | 'act_now' | 'shelter';

export interface ActionBrief {
  situationId: string;
  /** Categorical recommendation tier. */
  tier: ActionTier;
  /** Plain-English headline ("Severe weather inbound — shelter now"). */
  headline: string;
  /** Imperative actions, urgency-sorted, capped at `maxActions`. */
  recommendedActions: string[];
  /** Confirming sources STILL TO WATCH (excludes observedConfirming). */
  confirmingSources: string[];
  /** Sources that would invalidate the call. */
  invalidatingSources: string[];
  /** Recommended panels to open. */
  recommendedPanels: string[];
  /** Why this brief was generated this way (transparency). */
  reason: string;
}

// ── Options ─────────────────────────────────────────────────────────────

export interface ActionBriefOptions {
  /** Cap on recommended actions (default 5). */
  maxActions?: number;
}

// ── Top-level composer ──────────────────────────────────────────────────

export function buildActionBrief(
  situation: SituationDescriptor,
  options: ActionBriefOptions = {},
): ActionBrief {
  const max = options.maxActions ?? 5;
  const playbook = getPlaybook(situation.category);
  const tier = computeTier(situation);

  const recommendedActions = trimActionsForTier(
    playbook.userActions,
    tier,
    max,
  );

  const confirmingSources = pruneObserved(
    playbook.confirmingSources,
    situation.observedConfirming ?? [],
  );

  return {
    situationId: situation.id,
    tier,
    headline: buildHeadline(situation, tier, playbook),
    recommendedActions,
    confirmingSources,
    invalidatingSources: [...playbook.invalidatingSources],
    recommendedPanels: [...playbook.recommendedPanels],
    reason: buildReason(situation, tier),
  };
}

// ── Tier logic ──────────────────────────────────────────────────────────

function computeTier(situation: SituationDescriptor): ActionTier {
  // Plan: "calm, specific, and proportionate to confidence and urgency."
  // Severity below 30 → monitor only. 30-50 → prepare. 50+ → act_now,
  // unless severity is extreme (90+) and the category is shelter-style.
  const { severityScore, confidence, category, minutesUntilImpact } = situation;
  const shelterStyle = category === 'severe_weather';
  const isShortFuse = minutesUntilImpact !== undefined && minutesUntilImpact < 60;

  if (severityScore >= 90 && shelterStyle && isShortFuse && confidence !== 'low') return 'shelter';
  if (severityScore >= 75 && confidence !== 'low') return 'act_now';
  if (severityScore >= 50 && confidence === 'high') return 'act_now';
  if (severityScore >= 30) return 'prepare';
  return 'monitor';
}

// ── Action shaping ──────────────────────────────────────────────────────

function trimActionsForTier(
  actions: readonly string[],
  tier: ActionTier,
  max: number,
): string[] {
  // Monitor tier: just the first 1-2 (typically the "watch X" / "confirm
  // with Y" actions). Prepare: first half. Act_now / shelter: full list
  // up to `max`.
  if (tier === 'monitor') {
    const head = actions.slice(0, Math.min(2, actions.length));
    return head.length === 0 ? ['Monitor for changes'] : head;
  }
  if (tier === 'prepare') {
    return actions.slice(0, Math.min(Math.ceil(actions.length / 2), max));
  }
  return actions.slice(0, max);
}

function pruneObserved(
  sources: readonly string[],
  observed: readonly string[],
): string[] {
  const lc = observed.map((s) => s.toLowerCase());
  return sources.filter((s) => {
    const lower = s.toLowerCase();
    return !lc.some((o) => lower.includes(o) || o.includes(lower));
  });
}

// ── Headlines + reasons ─────────────────────────────────────────────────

function buildHeadline(
  situation: SituationDescriptor,
  tier: ActionTier,
  playbook: ReactionPlaybook,
): string {
  const verb = tierVerb(tier);
  if (tier === 'shelter') return `${situation.title} — shelter now`;
  return `${situation.title} — ${verb} (${playbook.timeWindow})`;
}

function tierVerb(tier: ActionTier): string {
  switch (tier) {
    case 'monitor': { return 'monitor';
    }
    case 'prepare': { return 'prepare';
    }
    case 'act_now': { return 'act now';
    }
    case 'shelter': { return 'shelter';
    }
  }
}

function buildReason(situation: SituationDescriptor, tier: ActionTier): string {
  const conf = `${situation.confidence} confidence`;
  const sev = `severity ${situation.severityScore}`;
  const fuse = situation.minutesUntilImpact === undefined
    ? ''
    : `, ${situation.minutesUntilImpact} min lead time`;
  return `${capitalize(tier.replace(/_/g, ' '))} tier: ${sev}, ${conf}${fuse}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
