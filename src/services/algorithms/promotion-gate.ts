/**
 * Promotion Gate — PR 8 of the Algorithm Accuracy Enhancement Plan.
 *
 * Formalizes the algorithm lifecycle:
 *
 *   draft -> shadow -> candidate -> live -> deprecated
 *
 * Transitions:
 *   draft -> shadow:     manual (developer marks ready for evaluation)
 *   shadow -> candidate: automatic when promotion criteria met
 *                        (PR 6: P>=0.70, R>=0.60, F1>=0.65, >=50 events)
 *   candidate -> live:   manual / explicit human approval
 *   live -> shadow:      auto-demotion when 7-day F1 < 0.50
 *   shadow -> deprecated: auto when 90 days without promotion
 *
 * All transitions captured in an audit trail.
 *
 * Pure deterministic. No DOM, no fetch.
 */

import {
  DEFAULT_PROMOTION_CRITERIA,
  evaluatePromotion,
  type PromotionCriteria,
  type ShadowDecision,
} from './shadow-mode';

// Public types

export type LifecycleState = 'draft' | 'shadow' | 'candidate' | 'live' | 'deprecated';

export interface LifecycleTransition {
  at: number;
  from: LifecycleState;
  to: LifecycleState;
  reason: string;
  /** Who/what initiated the transition. */
  initiator: 'auto' | 'human' | 'system';
}

export interface LifecycleEntry {
  algorithmId: string;
  state: LifecycleState;
  enteredStateAt: number;
  transitions: LifecycleTransition[];
}

export interface AutoDemoteCriteria {
  /** Window in ms over which the rolling F1 is computed. */
  windowMs: number;
  /** F1 floor below which a live algorithm gets demoted to shadow. */
  minF1: number;
}

export const DEFAULT_AUTO_DEMOTE: AutoDemoteCriteria = {
  windowMs: 7 * 24 * 60 * 60 * 1000,
  minF1: 0.5,
};

/** Time after which a still-shadow algorithm gets deprecated. */
export const DEFAULT_SHADOW_TIMEOUT_MS = 90 * 24 * 60 * 60 * 1000;

// State

const lifecycle = new Map<string, LifecycleEntry>();

// Read

export function getLifecycle(algorithmId: string): LifecycleEntry | undefined {
  const e = lifecycle.get(algorithmId);
  if (!e) return undefined;
  return { ...e, transitions: e.transitions.map((t) => ({ ...t })) };
}

export function listLifecycles(): LifecycleEntry[] {
  return [...lifecycle.values()].map((e) => ({
    ...e,
    transitions: e.transitions.map((t) => ({ ...t })),
  }));
}

export function listInState(state: LifecycleState): LifecycleEntry[] {
  return [...lifecycle.values()].filter((e) => e.state === state);
}

// Initialize

export function initLifecycle(
  algorithmId: string,
  initialState: LifecycleState = 'draft',
  now: () => number = Date.now,
): LifecycleEntry {
  if (lifecycle.has(algorithmId)) return getLifecycle(algorithmId)!;
  const entry: LifecycleEntry = {
    algorithmId,
    state: initialState,
    enteredStateAt: now(),
    transitions: [],
  };
  lifecycle.set(algorithmId, entry);
  return { ...entry, transitions: [] };
}

// Transitions

const VALID_TRANSITIONS: Record<LifecycleState, readonly LifecycleState[]> = {
  draft: ['shadow', 'deprecated'],
  shadow: ['candidate', 'deprecated', 'shadow'],
  candidate: ['live', 'shadow', 'deprecated'],
  live: ['shadow', 'deprecated'],
  deprecated: [],
};

export function isValidTransition(from: LifecycleState, to: LifecycleState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function transition(
  algorithmId: string,
  to: LifecycleState,
  reason: string,
  initiator: LifecycleTransition['initiator'] = 'human',
  now: () => number = Date.now,
): LifecycleEntry {
  const existing = lifecycle.get(algorithmId);
  if (!existing) {
    throw new Error(`No lifecycle for algorithm "${algorithmId}". Call initLifecycle first.`);
  }
  if (!isValidTransition(existing.state, to)) {
    throw new Error(
      `Invalid transition for "${algorithmId}": ${existing.state} -> ${to}`,
    );
  }
  const at = now();
  const entry: LifecycleEntry = {
    algorithmId,
    state: to,
    enteredStateAt: at,
    transitions: [
      ...existing.transitions,
      { at, from: existing.state, to, reason, initiator },
    ],
  };
  lifecycle.set(algorithmId, entry);
  return { ...entry, transitions: entry.transitions.map((t) => ({ ...t })) };
}

// Auto promotion / demotion

export interface AutoEvaluateInput {
  algorithmId: string;
  shadowDecisions?: readonly ShadowDecision[];
  liveRecentF1?: number;
  now?: () => number;
  promotionCriteria?: PromotionCriteria;
  demoteCriteria?: AutoDemoteCriteria;
  shadowTimeoutMs?: number;
}

export interface AutoEvaluateResult {
  algorithmId: string;
  changed: boolean;
  newState?: LifecycleState;
  reason?: string;
}

/**
 * Apply auto-rules. Returns whether a transition fired.
 *
 *   shadow + meets criteria        -> candidate
 *   shadow + age > timeout         -> deprecated
 *   live + recent F1 < floor       -> shadow
 */
export function autoEvaluate(input: AutoEvaluateInput): AutoEvaluateResult {
  const entry = lifecycle.get(input.algorithmId);
  if (!entry) {
    return { algorithmId: input.algorithmId, changed: false };
  }
  const now = (input.now ?? Date.now)();
  const shadowTimeout = input.shadowTimeoutMs ?? DEFAULT_SHADOW_TIMEOUT_MS;
  const demote = input.demoteCriteria ?? DEFAULT_AUTO_DEMOTE;
  const criteria = input.promotionCriteria ?? DEFAULT_PROMOTION_CRITERIA;

  if (entry.state === 'shadow') {
    const ageMs = now - entry.enteredStateAt;
    const elig = evaluatePromotion(input.algorithmId, input.shadowDecisions ?? [], criteria);
    if (elig.eligible) {
      transition(
        input.algorithmId,
        'candidate',
        `auto-promote: P=${formatNum(elig.precision)} R=${formatNum(elig.recall)} F1=${formatNum(elig.f1)}`,
        'auto',
        () => now,
      );
      return { algorithmId: input.algorithmId, changed: true, newState: 'candidate' };
    }
    if (ageMs > shadowTimeout) {
      transition(
        input.algorithmId,
        'deprecated',
        `auto-deprecate: ${Math.round(ageMs / 86_400_000)} days in shadow without promotion`,
        'auto',
        () => now,
      );
      return { algorithmId: input.algorithmId, changed: true, newState: 'deprecated' };
    }
    return { algorithmId: input.algorithmId, changed: false };
  }

  if (entry.state === 'live') {
    const f1 = input.liveRecentF1;
    if (typeof f1 === 'number' && Number.isFinite(f1) && f1 < demote.minF1) {
      transition(
        input.algorithmId,
        'shadow',
        `auto-demote: 7-day F1 ${f1.toFixed(2)} below floor ${demote.minF1.toFixed(2)}`,
        'auto',
        () => now,
      );
      return { algorithmId: input.algorithmId, changed: true, newState: 'shadow' };
    }
  }

  return { algorithmId: input.algorithmId, changed: false };
}

// Manual promotion (candidate -> live)

export function promote(
  algorithmId: string,
  reason: string,
  now: () => number = Date.now,
): LifecycleEntry {
  const entry = lifecycle.get(algorithmId);
  if (!entry) throw new Error(`No lifecycle for algorithm "${algorithmId}"`);
  if (entry.state !== 'candidate') {
    throw new Error(
      `Cannot promote "${algorithmId}" from ${entry.state}; must be candidate`,
    );
  }
  return transition(algorithmId, 'live', reason, 'human', now);
}

// Cleanup

export function clearLifecycle(): void {
  lifecycle.clear();
}

function formatNum(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : 'n/a';
}
