/**
 * Competitive Hypothesis Engine (Phase 4).
 *
 * For every active Situation, maintain 2–3 rival explanations of what is
 * happening. The analyst sees all plausible interpretations rather than
 * anchoring on the top-scoring one.
 *
 * Pipeline:
 *   1. Seed hypotheses from `hypothesis-templates.ts` for the Situation's
 *      primary domain (falls back to GENERIC_TEMPLATES).
 *   2. Score each hypothesis against the Situation's observations:
 *      - count tag-match supporting / contradicting evidence
 *      - compute a likelihood P(E|H) from those counts
 *      - apply Bayes' rule and re-normalize so posteriors sum to 1
 *   3. Mark `leading` (top posterior), `contending` (>=0.1 below leader),
 *      `eliminated` (<0.1).
 *   4. Surface a `rivalryScore` (closeness of top-2) and
 *      `consensusReached` flag for the panel + briefings.
 *
 * Pure module: no DOM, no fetch, no globals at import time. Persists
 * the active sets to localStorage `wm-hypothesis-sets` (max 200 sets).
 */

import type { ObservationEvent } from './observation-adapters';
import type { Situation } from './situation-store-v2';
import {
  templatesForDomain,
  type HypothesisTemplate,
} from './hypothesis-templates';

// ── Public types ──────────────────────────────────────────────────────

export type HypothesisStatus = 'leading' | 'contending' | 'eliminated';

export interface Hypothesis {
  id: string;
  situationId: string;
  label: string;
  description: string;
  supportingObservationIds: string[];
  contradictingObservationIds: string[];
  priorProbability: number;
  posteriorProbability: number;
  confidenceInterval: [number, number];
  status: HypothesisStatus;
  eliminatedReason?: string;
  generatedAt: Date;
  updatedAt: Date;
}

export interface HypothesisSet {
  situationId: string;
  hypotheses: Hypothesis[];
  rivalryScore: number;
  consensusReached: boolean;
  lastUpdated: Date;
}

export type HypothesisListener = (set: HypothesisSet) => void;

// ── Constants ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'wm-hypothesis-sets';
const MAX_SETS = 200;
const ELIMINATED_THRESHOLD = 0.1;
const CONSENSUS_LEADER_THRESHOLD = 0.75;
const CONSENSUS_SECOND_CEILING = 0.2;
const MAX_HYPOTHESES_PER_SET = 3;
/** Pseudocount for Beta(α, β) CI — keeps intervals well-defined when
 *  observation counts are tiny. */
const BETA_PRIOR = 1;

// ── Engine ────────────────────────────────────────────────────────────

export interface HypothesisEngineOptions {
  clock?: () => number;
}

export class HypothesisEngine {
  private sets = new Map<string, HypothesisSet>();
  private listeners = new Set<HypothesisListener>();
  private clock: () => number;
  private idSeq = 0;
  private hydrated = false;

  constructor(options: HypothesisEngineOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
  }

  // ── Public API ──────────────────────────────────────────────────

  generateHypotheses(situation: Situation): HypothesisSet {
    this.ensureHydrated();
    const templates = pickTopTemplates(templatesForDomain(situation.domain));
    const now = this.clock();
    const hypotheses = templates.map((template) =>
      this.scoreTemplate(template, situation, now, this.nextId(now)),
    );
    const finalized = finalizeRanking(hypotheses);
    const set = this.buildSet(situation.id, finalized, now);
    this.sets.set(situation.id, set);
    this.enforceCapacity();
    this.persist();
    this.notify(set);
    return cloneSet(set);
  }

  updateHypotheses(situationId: string, observations: readonly ObservationEvent[]): HypothesisSet | undefined {
    this.ensureHydrated();
    const existing = this.sets.get(situationId);
    if (!existing) return undefined;
    const now = this.clock();
    const rescored = existing.hypotheses.map((h) =>
      this.rescoreHypothesis(h, observations, now),
    );
    const finalized = finalizeRanking(rescored);
    const set = this.buildSet(situationId, finalized, now);
    this.sets.set(situationId, set);
    this.persist();
    this.notify(set);
    return cloneSet(set);
  }

  getHypothesisSet(situationId: string): HypothesisSet | undefined {
    this.ensureHydrated();
    const set = this.sets.get(situationId);
    return set ? cloneSet(set) : undefined;
  }

  getAllSets(): HypothesisSet[] {
    this.ensureHydrated();
    return [...this.sets.values()].map((s) => cloneSet(s));
  }

  subscribe(listener: HypothesisListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Test seam — empties in-memory + persisted state. */
  resetForTesting(): void {
    this.sets.clear();
    this.listeners.clear();
    this.idSeq = 0;
    this.hydrated = true;
    const store = safeStorage();
    if (store) {
      try { store.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  }

  // ── Scoring ──────────────────────────────────────────────────────

  private scoreTemplate(
    template: HypothesisTemplate,
    situation: Situation,
    now: number,
    id: string,
  ): Hypothesis {
    const { supporting, contradicting } = partitionObservations(
      situation.observations,
      template,
    );
    const prior = clamp01(template.priorProbability);
    const posterior = bayesianPosterior(prior, supporting.length, contradicting.length);
    const ci = betaConfidenceInterval(supporting.length, contradicting.length);
    return {
      id,
      situationId: situation.id,
      label: template.label,
      description: template.description,
      supportingObservationIds: supporting.map((o) => o.id),
      contradictingObservationIds: contradicting.map((o) => o.id),
      priorProbability: Number(prior.toFixed(4)),
      posteriorProbability: Number(posterior.toFixed(4)),
      confidenceInterval: [Number(ci[0].toFixed(4)), Number(ci[1].toFixed(4))],
      status: 'contending',
      generatedAt: new Date(now),
      updatedAt: new Date(now),
    };
  }

  private rescoreHypothesis(
    current: Hypothesis,
    observations: readonly ObservationEvent[],
    now: number,
  ): Hypothesis {
    const template = templateFromHypothesis(current);
    const { supporting, contradicting } = partitionObservations(observations, template);
    const supportingIds = mergeIds(current.supportingObservationIds, supporting.map((o) => o.id));
    const contradictingIds = mergeIds(current.contradictingObservationIds, contradicting.map((o) => o.id));
    const posterior = bayesianPosterior(
      current.priorProbability,
      supportingIds.length,
      contradictingIds.length,
    );
    const ci = betaConfidenceInterval(supportingIds.length, contradictingIds.length);
    return {
      ...current,
      supportingObservationIds: supportingIds,
      contradictingObservationIds: contradictingIds,
      posteriorProbability: Number(posterior.toFixed(4)),
      confidenceInterval: [Number(ci[0].toFixed(4)), Number(ci[1].toFixed(4))],
      updatedAt: new Date(now),
    };
  }

  // ── Set assembly + lifecycle ─────────────────────────────────────

  private buildSet(situationId: string, hypotheses: Hypothesis[], now: number): HypothesisSet {
    return {
      situationId,
      hypotheses,
      rivalryScore: computeRivalryScore(hypotheses),
      consensusReached: hasConsensus(hypotheses),
      lastUpdated: new Date(now),
    };
  }

  private nextId(now: number): string {
    this.idSeq += 1;
    return `hyp-${now.toString(36)}-${this.idSeq}`;
  }

  private notify(set: HypothesisSet): void {
    const snapshot = cloneSet(set);
    for (const l of this.listeners) {
      try { l(snapshot); } catch { /* listener crash isolation */ }
    }
  }

  // ── Persistence ──────────────────────────────────────────────────

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    const store = safeStorage();
    if (!store) return;
    let raw: string | null = null;
    try { raw = store.getItem(STORAGE_KEY); } catch { return; }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as PersistedSet[] | null;
      if (!Array.isArray(parsed)) return;
      for (const entry of parsed) {
        const set = deserializeSet(entry);
        if (set) this.sets.set(set.situationId, set);
      }
    } catch {
      // corrupt — leave in-memory state empty
    }
  }

  private persist(): void {
    const store = safeStorage();
    if (!store) return;
    const payload = [...this.sets.values()].map((s) => serializeSet(s));
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // best effort
    }
  }

  private enforceCapacity(): void {
    if (this.sets.size <= MAX_SETS) return;
    const sorted = [...this.sets.entries()]
      .sort((a, b) => a[1].lastUpdated.getTime() - b[1].lastUpdated.getTime());
    const overflow = this.sets.size - MAX_SETS;
    for (let i = 0; i < overflow; i += 1) {
      this.sets.delete(sorted[i]![0]);
    }
  }
}

// ── Scoring helpers ──────────────────────────────────────────────────

interface Partition {
  supporting: ObservationEvent[];
  contradicting: ObservationEvent[];
}

function partitionObservations(
  observations: readonly ObservationEvent[],
  template: HypothesisTemplate,
): Partition {
  const supports: ObservationEvent[] = [];
  const contradicts: ObservationEvent[] = [];
  for (const obs of observations) {
    const tags = obs.tags.map((t) => t.toLowerCase());
    if (matchesAny(tags, template.supportingTagFragments)) supports.push(obs);
    if (matchesAny(tags, template.contradictingTagFragments)) contradicts.push(obs);
  }
  return { supporting: supports, contradicting: contradicts };
}

function matchesAny(tags: readonly string[], fragments: readonly string[]): boolean {
  if (fragments.length === 0) return false;
  for (const fragment of fragments) {
    const needle = fragment.toLowerCase();
    for (const tag of tags) {
      if (tag.includes(needle)) return true;
    }
  }
  return false;
}

/** Bayesian update via log-odds with a fixed per-observation likelihood
 *  ratio (LR=2.5 per supporting, 1/2.5 per contradicting). Lets strong
 *  evidence promote a low-prior hypothesis past a higher-prior one;
 *  matches how human analysts re-rank when the story shifts. Pure
 *  unnormalized posterior — caller re-normalizes across the set. */
const SUPPORTING_LR = 2.5;
const CONTRADICTING_LR = 1 / SUPPORTING_LR;
const PROBABILITY_EPS = 1e-6;
function bayesianPosterior(prior: number, supporting: number, contradicting: number): number {
  const p = clamp01(prior);
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  // Clamp away from the asymptotes so log-odds stay finite.
  const safeP = Math.min(Math.max(p, PROBABILITY_EPS), 1 - PROBABILITY_EPS);
  const priorOdds = safeP / (1 - safeP);
  const supportingMul = Number.isFinite(supporting) ? SUPPORTING_LR ** supporting : Infinity;
  const contradictingMul = Number.isFinite(contradicting) ? CONTRADICTING_LR ** contradicting : 0;
  const updatedOdds = priorOdds * supportingMul * contradictingMul;
  if (!Number.isFinite(updatedOdds)) return updatedOdds > 0 ? 1 : 0;
  if (updatedOdds <= 0) return 0;
  return clamp01(updatedOdds / (1 + updatedOdds));
}

/** Beta(1+supporting, 1+contradicting) approximate 90% CI. We expose
 *  the same interval shape regardless of evidence count, which keeps
 *  the panel rendering deterministic. */
function betaConfidenceInterval(supporting: number, contradicting: number): [number, number] {
  const alpha = BETA_PRIOR + supporting;
  const beta = BETA_PRIOR + contradicting;
  const mean = alpha / (alpha + beta);
  const variance = (alpha * beta) / (((alpha + beta) ** 2) * (alpha + beta + 1));
  const sd = Math.sqrt(variance);
  // 90% CI via normal approximation; clamped to [0, 1].
  const lo = clamp01(mean - 1.645 * sd);
  const hi = clamp01(mean + 1.645 * sd);
  return [lo, hi];
}

function finalizeRanking(hypotheses: readonly Hypothesis[]): Hypothesis[] {
  const sorted = [...hypotheses].sort((a, b) => b.posteriorProbability - a.posteriorProbability);
  const total = sorted.reduce((sum, h) => sum + h.posteriorProbability, 0);
  const normalized = sorted.map((h) => normalizePosterior(h, total));
  return normalized.map((h, i) => attachStatus(h, i));
}

function normalizePosterior(h: Hypothesis, total: number): Hypothesis {
  if (total <= 0) return { ...h, posteriorProbability: 0 };
  return {
    ...h,
    posteriorProbability: Number((h.posteriorProbability / total).toFixed(4)),
  };
}

function attachStatus(h: Hypothesis, rank: number): Hypothesis {
  if (h.posteriorProbability < ELIMINATED_THRESHOLD) {
    return {
      ...h,
      status: 'eliminated',
      eliminatedReason: `Posterior probability fell below ${ELIMINATED_THRESHOLD} after evidence update`,
    };
  }
  return {
    ...h,
    status: rank === 0 ? 'leading' : 'contending',
    eliminatedReason: undefined,
  };
}

function computeRivalryScore(hypotheses: readonly Hypothesis[]): number {
  if (hypotheses.length < 2) return 0;
  const ranked = [...hypotheses].sort((a, b) => b.posteriorProbability - a.posteriorProbability);
  const top = ranked[0]!.posteriorProbability;
  const second = ranked[1]!.posteriorProbability;
  if (top <= 0) return 0;
  // 1.0 when top == second (perfect tie), 0.0 when top dominates second.
  const ratio = second / top;
  return Number(clamp01(ratio).toFixed(4));
}

function hasConsensus(hypotheses: readonly Hypothesis[]): boolean {
  if (hypotheses.length === 0) return false;
  const ranked = [...hypotheses].sort((a, b) => b.posteriorProbability - a.posteriorProbability);
  const top = ranked[0]!.posteriorProbability;
  const second = ranked[1]?.posteriorProbability ?? 0;
  return top >= CONSENSUS_LEADER_THRESHOLD && second <= CONSENSUS_SECOND_CEILING;
}

function pickTopTemplates(templates: readonly HypothesisTemplate[]): HypothesisTemplate[] {
  return [...templates]
    .sort((a, b) => b.priorProbability - a.priorProbability)
    .slice(0, MAX_HYPOTHESES_PER_SET);
}

function templateFromHypothesis(h: Hypothesis): HypothesisTemplate {
  // Reconstruct a minimal template for re-scoring. We don't store the
  // tag fragments on the Hypothesis (the templates are static); look
  // them up from the static bank using the label.
  // First-fit across all domain banks — labels are unique within the
  // bundled templates.
  for (const candidate of allTemplates()) {
    if (candidate.label === h.label) return candidate;
  }
  return {
    label: h.label,
    description: h.description,
    priorProbability: h.priorProbability,
    supportingTagFragments: [],
    contradictingTagFragments: [],
  };
}

function allTemplates(): HypothesisTemplate[] {
  return [
    ...templatesForDomain('earthquake'),
    ...templatesForDomain('weather'),
    ...templatesForDomain('maritime'),
    ...templatesForDomain('aviation'),
    ...templatesForDomain('biosurveillance'),
    ...templatesForDomain('cyber'),
    ...templatesForDomain('space'),
    ...templatesForDomain('generic'),
  ];
}

function mergeIds(existing: readonly string[], incoming: readonly string[]): string[] {
  const seen = new Set(existing);
  const out = [...existing];
  for (const id of incoming) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

// ── Serialization ────────────────────────────────────────────────────

interface PersistedHypothesis extends Omit<Hypothesis, 'generatedAt' | 'updatedAt'> {
  generatedAt: number;
  updatedAt: number;
}

interface PersistedSet extends Omit<HypothesisSet, 'hypotheses' | 'lastUpdated'> {
  hypotheses: PersistedHypothesis[];
  lastUpdated: number;
}

function serializeSet(set: HypothesisSet): PersistedSet {
  return {
    situationId: set.situationId,
    rivalryScore: set.rivalryScore,
    consensusReached: set.consensusReached,
    lastUpdated: set.lastUpdated.getTime(),
    hypotheses: set.hypotheses.map((h) => ({
      ...h,
      supportingObservationIds: [...h.supportingObservationIds],
      contradictingObservationIds: [...h.contradictingObservationIds],
      confidenceInterval: [...h.confidenceInterval] as [number, number],
      generatedAt: h.generatedAt.getTime(),
      updatedAt: h.updatedAt.getTime(),
    })),
  };
}

function deserializeSet(raw: unknown): HypothesisSet | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as PersistedSet;
  if (typeof r.situationId !== 'string' || !Array.isArray(r.hypotheses)) return undefined;
  return {
    situationId: r.situationId,
    rivalryScore: typeof r.rivalryScore === 'number' ? r.rivalryScore : 0,
    consensusReached: r.consensusReached === true,
    lastUpdated: new Date(typeof r.lastUpdated === 'number' ? r.lastUpdated : Date.now()),
    hypotheses: r.hypotheses.map((h) => deserializeHypothesis(h)).filter((h): h is Hypothesis => h !== undefined),
  };
}

function deserializeHypothesis(raw: unknown): Hypothesis | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const h = raw as PersistedHypothesis;
  if (typeof h.id !== 'string' || typeof h.label !== 'string') return undefined;
  const ci = Array.isArray(h.confidenceInterval) && h.confidenceInterval.length === 2
    ? [Number(h.confidenceInterval[0]), Number(h.confidenceInterval[1])] as [number, number]
    : [0, 1] as [number, number];
  return {
    id: h.id,
    situationId: h.situationId,
    label: h.label,
    description: h.description ?? '',
    supportingObservationIds: Array.isArray(h.supportingObservationIds) ? [...h.supportingObservationIds] : [],
    contradictingObservationIds: Array.isArray(h.contradictingObservationIds) ? [...h.contradictingObservationIds] : [],
    priorProbability: typeof h.priorProbability === 'number' ? h.priorProbability : 0,
    posteriorProbability: typeof h.posteriorProbability === 'number' ? h.posteriorProbability : 0,
    confidenceInterval: ci,
    status: (h.status ?? 'contending') as HypothesisStatus,
    eliminatedReason: h.eliminatedReason,
    generatedAt: new Date(typeof h.generatedAt === 'number' ? h.generatedAt : Date.now()),
    updatedAt: new Date(typeof h.updatedAt === 'number' ? h.updatedAt : Date.now()),
  };
}

function cloneSet(set: HypothesisSet): HypothesisSet {
  return {
    situationId: set.situationId,
    rivalryScore: set.rivalryScore,
    consensusReached: set.consensusReached,
    lastUpdated: new Date(set.lastUpdated),
    hypotheses: set.hypotheses.map((h) => ({
      ...h,
      supportingObservationIds: [...h.supportingObservationIds],
      contradictingObservationIds: [...h.contradictingObservationIds],
      confidenceInterval: [...h.confidenceInterval] as [number, number],
      generatedAt: new Date(h.generatedAt),
      updatedAt: new Date(h.updatedAt),
    })),
  };
}

function safeStorage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

// ── Singleton ────────────────────────────────────────────────────────

let _singleton: HypothesisEngine | null = null;

export function getHypothesisEngine(): HypothesisEngine {
  _singleton ??= new HypothesisEngine();
  return _singleton;
}

export function __resetHypothesisEngineSingleton(): void {
  _singleton = null;
}

export const __internals = {
  bayesianPosterior,
  betaConfidenceInterval,
  computeRivalryScore,
  hasConsensus,
  finalizeRanking,
  ELIMINATED_THRESHOLD,
  CONSENSUS_LEADER_THRESHOLD,
  CONSENSUS_SECOND_CEILING,
  MAX_HYPOTHESES_PER_SET,
};
