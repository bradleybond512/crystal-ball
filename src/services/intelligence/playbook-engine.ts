import type { Playbook, PlaybookStep, ObservationEvent, ObservationSeverity } from '@/types/intelligence';
import {
  EARTHQUAKE_PLAYBOOK,
  WILDFIRE_PLAYBOOK,
  AVIATION_EMERGENCY_PLAYBOOK,
  HURRICANE_PLAYBOOK,
  CYBER_BREACH_PLAYBOOK,
} from './playbooks/index';

export interface AutomationResult {
  stepOrder: number;
  automationFn: string;
  /** Snapshot of the event that triggered execution, for provenance. */
  eventId: string;
  executedAt: number;
}

// ── Registry ─────────────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<ObservationSeverity, number> = {
  INFO: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

let _registry: Playbook[] = [
  EARTHQUAKE_PLAYBOOK,
  WILDFIRE_PLAYBOOK,
  AVIATION_EMERGENCY_PLAYBOOK,
  HURRICANE_PLAYBOOK,
  CYBER_BREACH_PLAYBOOK,
];

export function registerPlaybook(playbook: Playbook): void {
  _registry.push(playbook);
}

export function clearRegistry(): void {
  _registry = [];
}

// ── Matching ──────────────────────────────────────────────────────────────────

function domainMatches(playbook: Playbook, event: ObservationEvent): boolean {
  return playbook.triggerDomains.includes('*') || playbook.triggerDomains.includes(event.domain);
}

function severityMatches(playbook: Playbook, event: ObservationEvent): boolean {
  return (playbook.triggerSeverity as string[]).includes(event.severity);
}

function tagScore(playbook: Playbook, event: ObservationEvent): number {
  if (playbook.triggerTags.length === 0) return 0;
  return playbook.triggerTags.filter(t => event.tags.includes(t)).length;
}

/**
 * Returns the best-matching playbook for the given event, or null if none
 * meets the domain + severity requirements.
 *
 * Among candidates, prefers playbooks with the most tag overlap
 * (specificity) over generic domain-only matches.
 */
export function getPlaybook(event: ObservationEvent): Playbook | null {
  const candidates = _registry.filter(
    p => domainMatches(p, event) && severityMatches(p, event),
  );
  if (candidates.length === 0) return null;

  // Score by tag overlap; ties broken by registration order (first wins)
  let best: Playbook | null = null;
  let bestScore = -1;
  for (const p of candidates) {
    const score = tagScore(p, event);
    // Only beat current best if strictly higher — preserves first-registered order on ties
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

// ── Execution ─────────────────────────────────────────────────────────────────

/**
 * Returns automation result descriptors for all automated steps in the
 * playbook. Callers use the `automationFn` name to dispatch to the real
 * implementation — the engine itself stays pure and side-effect free.
 */
export function executeAutomatedSteps(
  playbook: Playbook,
  event: ObservationEvent,
): AutomationResult[] {
  const now = Date.now();
  return playbook.steps
    .filter((s): s is PlaybookStep & { automationFn: string } => s.automated && !!s.automationFn)
    .map(s => ({
      stepOrder: s.order,
      automationFn: s.automationFn,
      eventId: event.id,
      executedAt: now,
    }));
}

// ── Formatting ────────────────────────────────────────────────────────────────

/**
 * Returns a compact "What to do:" string suitable for a notification toast.
 * Includes the playbook name and the first two step actions.
 */
export function formatPlaybookForNotification(
  playbook: Playbook,
  event: ObservationEvent,
): string {
  const sorted = [...playbook.steps].sort((a, b) => a.order - b.order);
  const top = sorted.slice(0, 2).map(s => s.action);
  const steps = top.join(' → ');
  const result = `${playbook.name} [${event.title}]: ${steps}`;
  return result.length > 300 ? result.slice(0, 297) + '…' : result;
}

// ── Severity helpers (exported for sidecar route) ─────────────────────────────

export { SEVERITY_RANK };
