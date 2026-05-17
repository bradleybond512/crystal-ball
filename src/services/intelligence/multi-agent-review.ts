/**
 * Multi-Agent Review — Phase 4 cross-perspective consensus.
 *
 * Crystal Ball's intelligence conclusions are reviewed by six simulated
 * analytical lenses before being surfaced. Each perspective applies a
 * deterministic template against the Situation + (optional)
 * HypothesisSet and emits a 2-3 sentence assessment, a key insight,
 * and an agree/disagree verdict on the leading hypothesis. The
 * consensus rolls those up into an agreement rate and a
 * recommendedAction badge so the operator sees at a glance whether
 * the lenses pull in the same direction.
 *
 * Pure module — no DOM, no fetch, no LLM, no globals at import time.
 * Persists the most-recent 100 consensus records under
 * `wm-multi-agent-review`.
 */

import type {  HypothesisSet } from './hypothesis-engine';
import type { Situation } from './situation-store-v2';

// ── Public types ──────────────────────────────────────────────────────

export type AgentPerspective =
  | 'skeptic'
  | 'devil-advocate'
  | 'data-quality'
  | 'geopolitical'
  | 'historical'
  | 'worst-case';

export const AGENT_PERSPECTIVES: readonly AgentPerspective[] = [
  'skeptic',
  'devil-advocate',
  'data-quality',
  'geopolitical',
  'historical',
  'worst-case',
];

export interface AgentReview {
  id: string;
  perspective: AgentPerspective;
  targetSituationId: string;
  assessment: string;
  agreedWithLeading: boolean;
  alternativeLabel?: string;
  keyInsight: string;
  confidenceInAssessment: number;
  flaggedBiases?: string[];
  generatedAt: Date;
}

export interface MultiAgentConsensus {
  situationId: string;
  reviews: AgentReview[];
  agreementRate: number;
  divergentPerspectives: AgentPerspective[];
  consensusSummary: string;
  recommendedAction: string;
  generatedAt: Date;
}

export type MultiAgentListener = (consensuses: MultiAgentConsensus[]) => void;

// ── Constants ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'wm-multi-agent-review';
const MAX_RECORDS = 100;
/** Domains where political/strategic context matters most. The
 *  geopolitical perspective disagrees for these unless the leading
 *  hypothesis already names a political framing. */
const SENSITIVE_DOMAINS: ReadonlySet<string> = new Set([
  'cyber', 'maritime', 'military', 'aviation', 'energy', 'sanctions',
]);
/** Domains with deep historical event libraries. The historical
 *  perspective agrees by default for these (pattern matches a known
 *  precedent) and questions otherwise. */
const PRECEDENTED_DOMAINS: ReadonlySet<string> = new Set([
  'earthquake', 'weather', 'wildfire', 'biosurveillance', 'space-weather',
  'humanitarian', 'tsunami',
]);
/** Devil's advocate concedes (agreedWithLeading: true) when the leading
 *  hypothesis dominates beyond this posterior. Below it, the devil
 *  argues for the alternative. */
const DEVIL_CONCEDE_THRESHOLD = 0.7;
/** Observations older than this are "stale" for the data-quality lens. */
const STALE_AFTER_MS = 4 * 60 * 60 * 1000;
/** Recommendation threshold — >0.7 agreement → proceed, else review. */
export const PROCEED_THRESHOLD = 0.7;
/** Divergent consensus threshold — used by getDivergent(). */
export const DIVERGENT_THRESHOLD = 0.5;

// ── Helpers ───────────────────────────────────────────────────────────

interface LeadingFrame {
  id: string;
  label: string;
  posterior: number;
}

interface AlternativeFrame {
  label: string;
  posterior: number;
}

function pickLeading(set: HypothesisSet | undefined, situation: Situation): LeadingFrame {
  if (set && set.hypotheses.length > 0) {
    const leading = [...set.hypotheses].sort(
      (a, b) => b.posteriorProbability - a.posteriorProbability,
    )[0]!;
    return {
      id: leading.id,
      label: leading.label,
      posterior: leading.posteriorProbability,
    };
  }
  // Fall back to a synthesized framing from the Situation itself. We
  // anchor posterior on the Situation.confidence so the devil still has
  // a meaningful threshold to apply.
  return {
    id: `synth-${situation.id}`,
    label: situation.name,
    posterior: situation.confidence,
  };
}

function pickAlternative(
  set: HypothesisSet | undefined,
  leading: LeadingFrame,
  situation: Situation,
): AlternativeFrame {
  if (set && set.hypotheses.length > 1) {
    // Lowest-posterior hypothesis among the non-leading ones. The
    // spec's "least likely" — the one the devil has to work hardest
    // to argue for.
    const others = set.hypotheses.filter((h) => h.id !== leading.id);
    const least = [...others].sort(
      (a, b) => a.posteriorProbability - b.posteriorProbability,
    )[0]!;
    return { label: least.label, posterior: least.posteriorProbability };
  }
  // Synthesize a domain-aware alternative framing.
  const alt = `routine ${situation.domain} background noise`;
  return { label: alt, posterior: 1 - situation.confidence };
}

function countContradictingObservations(situation: Situation): number {
  let count = 0;
  for (const e of situation.edges) {
    if (e.type === 'contradicts') count += 1;
  }
  return count;
}

function uniqueSources(situation: Situation): Set<string> {
  const set = new Set<string>();
  for (const o of situation.observations) set.add(o.sourceId);
  return set;
}

function staleObservationCount(situation: Situation, now: number): number {
  let count = 0;
  for (const o of situation.observations) {
    if (now - o.timestamp > STALE_AFTER_MS) count += 1;
  }
  return count;
}

function pluralS(n: number): string {
  return n === 1 ? '' : 's';
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// ── Perspective builders ──────────────────────────────────────────────

function skepticReview(
  situation: Situation,
  leading: LeadingFrame,
): Omit<AgentReview, 'id' | 'generatedAt'> {
  const contradictions = countContradictingObservations(situation);
  const sources = uniqueSources(situation);
  const flagged: string[] = ['confirmation bias'];
  if (sources.size <= 1) flagged.push('single-source bias');
  if (leading.posterior > 0.85) flagged.push('overconfidence');
  const assessment = contradictions > 0
    ? `The leading framing "${leading.label}" has ${contradictions} contradicting edge${pluralS(contradictions)} in evidence — those should be reconciled before declaring this resolved.`
    : `Even without explicit contradictions, the leading framing "${leading.label}" should be challenged. Confidence above 0.85 with single-source evidence is exactly when confirmation bias is most active.`;
  return {
    perspective: 'skeptic',
    targetSituationId: situation.id,
    assessment,
    agreedWithLeading: false,
    keyInsight: `Strongest counter-evidence: ${contradictions} contradicting edge${pluralS(contradictions)}, ${sources.size} unique source${pluralS(sources.size)}.`,
    confidenceInAssessment: 0.7,
    flaggedBiases: flagged,
  };
}

function devilAdvocateReview(
  situation: Situation,
  leading: LeadingFrame,
  alternative: AlternativeFrame,
): Omit<AgentReview, 'id' | 'generatedAt'> {
  const concedes = leading.posterior >= DEVIL_CONCEDE_THRESHOLD;
  const assessment = concedes
    ? `The leading framing "${leading.label}" is dominant at posterior ${leading.posterior.toFixed(2)}, but the alternative "${alternative.label}" is still worth keeping on the board until contradicting evidence is fully resolved.`
    : `Posterior ${leading.posterior.toFixed(2)} doesn't dominate. Arguing instead for "${alternative.label}": if even ${(alternative.posterior * 100).toFixed(0)}% of its conditions hold, current actions misallocate attention.`;
  return {
    perspective: 'devil-advocate',
    targetSituationId: situation.id,
    assessment,
    agreedWithLeading: concedes,
    alternativeLabel: alternative.label,
    keyInsight: `If "${alternative.label}" is correct, the response playbook changes — verify the cheapest distinguishing signal first.`,
    confidenceInAssessment: concedes ? 0.4 : 0.6,
  };
}

function dataQualityReview(
  situation: Situation,
  leading: LeadingFrame,
  now: number,
): Omit<AgentReview, 'id' | 'generatedAt'> {
  const sources = uniqueSources(situation);
  const stale = staleObservationCount(situation, now);
  const observationCount = situation.observations.length;
  const issues: string[] = [];
  if (sources.size <= 1) issues.push('single-source');
  if (stale > 0) issues.push(`${stale} stale observation${pluralS(stale)}`);
  if (observationCount < 3) issues.push('low observation count');
  const agreed = issues.length === 0;
  const assessment = agreed
    ? `Evidence base for "${leading.label}" is healthy: ${sources.size} sources, ${observationCount} observations, none stale beyond ${(STALE_AFTER_MS / 3_600_000).toFixed(0)}h.`
    : `Data-quality concerns on "${leading.label}": ${issues.join(', ')}. Conclusions drawn against this base inherit those gaps.`;
  return {
    perspective: 'data-quality',
    targetSituationId: situation.id,
    assessment,
    agreedWithLeading: agreed,
    keyInsight: agreed
      ? `No structural gaps detected in the evidence base.`
      : `Next-best move: backfill ${issues[0]}.`,
    confidenceInAssessment: agreed ? 0.85 : 0.75,
    flaggedBiases: agreed ? undefined : ['availability bias'],
  };
}

function geopoliticalReview(
  situation: Situation,
  leading: LeadingFrame,
): Omit<AgentReview, 'id' | 'generatedAt'> {
  const sensitive = SENSITIVE_DOMAINS.has(situation.domain);
  // The geopolitical lens disagrees when the domain is sensitive AND
  // the leading framing reads as purely technical (no political tag).
  const hasPoliticalTag = situation.tags.some(
    (t) => /political|sanction|geopolit|nation-state|state-actor/i.test(t),
  );
  const agreed = !sensitive || hasPoliticalTag;
  const assessment = agreed
    ? `Geopolitical framing of "${leading.label}" is consistent with the available political context.`
    : `Domain "${situation.domain}" is politically sensitive but the leading framing "${leading.label}" reads as purely technical. Strategic motive should be considered.`;
  return {
    perspective: 'geopolitical',
    targetSituationId: situation.id,
    assessment,
    agreedWithLeading: agreed,
    keyInsight: agreed
      ? `No additional political layer required.`
      : `Re-evaluate the actor and motive question alongside the technical signal.`,
    confidenceInAssessment: 0.6,
  };
}

function historicalReview(
  situation: Situation,
  leading: LeadingFrame,
): Omit<AgentReview, 'id' | 'generatedAt'> {
  const known = PRECEDENTED_DOMAINS.has(situation.domain);
  const assessment = known
    ? `The "${leading.label}" pattern in the ${situation.domain} domain matches a well-documented precedent class. Known response playbooks apply.`
    : `No clear historical precedent for "${leading.label}" in the ${situation.domain} domain at this severity. Treat playbook recommendations as provisional.`;
  return {
    perspective: 'historical',
    targetSituationId: situation.id,
    assessment,
    agreedWithLeading: known,
    keyInsight: known
      ? `Lean on prior responses for similar events.`
      : `Document this event carefully — it becomes the precedent for the next one.`,
    confidenceInAssessment: known ? 0.7 : 0.5,
  };
}

function worstCaseReview(
  situation: Situation,
): Omit<AgentReview, 'id' | 'generatedAt'> {
  // Worst-case is satisfied when the current severity is already at
  // critical. Below critical, this lens insists the ambiguous signals
  // could mean more.
  const atWorst = situation.severity === 'critical';
  const assessment = atWorst
    ? `Severity is already at critical and matches what the worst-case interpretation would produce. No further escalation warranted from this lens.`
    : `Current severity "${situation.severity}" assumes a benign reading of the ambiguous signals. The plausible severe interpretation puts this at critical until proven otherwise.`;
  return {
    perspective: 'worst-case',
    targetSituationId: situation.id,
    assessment,
    agreedWithLeading: atWorst,
    keyInsight: atWorst
      ? `Critical sustained — keep escalation runway clear.`
      : `Stand up the critical-severity playbook in standby. Time matters if the ambiguity resolves badly.`,
    confidenceInAssessment: 0.55,
  };
}

// ── Consensus builder ─────────────────────────────────────────────────

function buildConsensusSummary(
  reviews: readonly AgentReview[],
  agreementRate: number,
  leadingLabel: string,
  divergent: readonly AgentPerspective[],
): string {
  const agreeing = reviews.filter((r) => r.agreedWithLeading).length;
  const total = reviews.length;
  if (divergent.length === 0) {
    return `${agreeing}/${total} perspectives agree on "${leadingLabel}".`;
  }
  return `${agreeing}/${total} perspectives agree on "${leadingLabel}"; ${divergent.join(', ')} dissent (${(agreementRate * 100).toFixed(0)}% agreement).`;
}

function recommendedActionFor(agreementRate: number): string {
  return agreementRate > PROCEED_THRESHOLD
    ? 'Proceed with current assessment.'
    : 'Review with additional data before proceeding.';
}

// ── Service ───────────────────────────────────────────────────────────

export interface MultiAgentReviewOptions {
  clock?: () => number;
}

export class MultiAgentReviewService {
  private records: MultiAgentConsensus[] = [];
  private listeners = new Set<MultiAgentListener>();
  private hydrated = false;
  private idCounter = 0;
  private clock: () => number;

  constructor(options: MultiAgentReviewOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
  }

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    const store = safeStorage();
    if (!store) return;
    let raw: string | null = null;
    try { raw = store.getItem(STORAGE_KEY); } catch { return; }
    if (!raw) return;
    try {
      this.records = deserialize(JSON.parse(raw));
    } catch {
      // Corrupt blob — start clean.
    }
  }

  private persist(): void {
    const store = safeStorage();
    if (!store) return;
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(serialize(this.records)));
    } catch {
      // Quota or disabled — best-effort.
    }
  }

  private nextReviewId(now: number, perspective: AgentPerspective): string {
    this.idCounter += 1;
    return `mar-${perspective}-${now.toString(36)}-${this.idCounter}`;
  }

  private notify(): void {
    const snapshot = this.getAll();
    for (const l of this.listeners) {
      try { l(snapshot); } catch { /* listener crash isolation */ }
    }
  }

  /** Run all six perspectives against a Situation. If a HypothesisSet
   *  is provided, the leading hypothesis is its highest-posterior
   *  member; otherwise the leading framing is synthesised from the
   *  Situation. Returns a defensive copy of the new consensus and
   *  replaces any previous consensus for the same situationId. */
  reviewSituation(situation: Situation, hypothesisSet?: HypothesisSet): MultiAgentConsensus {
    this.ensureHydrated();
    const now = this.clock();
    const leading = pickLeading(hypothesisSet, situation);
    const alternative = pickAlternative(hypothesisSet, leading, situation);
    const drafts = [
      skepticReview(situation, leading),
      devilAdvocateReview(situation, leading, alternative),
      dataQualityReview(situation, leading, now),
      geopoliticalReview(situation, leading),
      historicalReview(situation, leading),
      worstCaseReview(situation),
    ];
    const reviews: AgentReview[] = drafts.map((d) => ({
      ...d,
      id: this.nextReviewId(now, d.perspective),
      confidenceInAssessment: clamp01(d.confidenceInAssessment),
      generatedAt: new Date(now),
    }));
    const agreeing = reviews.filter((r) => r.agreedWithLeading).length;
    const agreementRate = reviews.length === 0 ? 0 : agreeing / reviews.length;
    const divergentPerspectives = reviews
      .filter((r) => !r.agreedWithLeading)
      .map((r) => r.perspective);
    const consensus: MultiAgentConsensus = {
      situationId: situation.id,
      reviews,
      agreementRate,
      divergentPerspectives,
      consensusSummary: buildConsensusSummary(reviews, agreementRate, leading.label, divergentPerspectives),
      recommendedAction: recommendedActionFor(agreementRate),
      generatedAt: new Date(now),
    };
    // Replace-on-id semantics: only the most-recent consensus per
    // situation is retained. Avoids drift between stale and fresh
    // reviews for the same Situation.
    const existing = this.records.findIndex((c) => c.situationId === situation.id);
    if (existing !== -1) this.records.splice(existing, 1);
    this.records.push(consensus);
    this.enforceCapacity();
    this.persist();
    this.notify();
    return cloneConsensus(consensus);
  }

  private enforceCapacity(): void {
    if (this.records.length <= MAX_RECORDS) return;
    this.records.splice(0, this.records.length - MAX_RECORDS);
  }

  getConsensus(situationId: string): MultiAgentConsensus | undefined {
    this.ensureHydrated();
    const found = this.records.find((c) => c.situationId === situationId);
    return found ? cloneConsensus(found) : undefined;
  }

  getAll(): MultiAgentConsensus[] {
    this.ensureHydrated();
    return this.records.map((c) => cloneConsensus(c));
  }

  /** Consensuses where the agreement rate falls below the divergent
   *  threshold (<0.5) — useful for surfacing "the lenses disagree on
   *  this one" in the panel. */
  getDivergent(): MultiAgentConsensus[] {
    return this.getAll().filter((c) => c.agreementRate < DIVERGENT_THRESHOLD);
  }

  subscribe(listener: MultiAgentListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Test seam — empties the engine and the persisted blob. */
  resetForTesting(): void {
    this.records = [];
    this.listeners.clear();
    this.idCounter = 0;
    this.hydrated = true;
    const store = safeStorage();
    if (store) {
      try { store.removeItem(STORAGE_KEY); } catch { /* best effort */ }
    }
  }
}

// ── Storage ───────────────────────────────────────────────────────────

function safeStorage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

interface PersistedReview extends Omit<AgentReview, 'generatedAt'> {
  generatedAt: number;
}

interface PersistedConsensus extends Omit<MultiAgentConsensus, 'reviews' | 'generatedAt'> {
  reviews: PersistedReview[];
  generatedAt: number;
}

function serialize(records: readonly MultiAgentConsensus[]): PersistedConsensus[] {
  return records.map((c) => ({
    ...c,
    generatedAt: c.generatedAt.getTime(),
    reviews: c.reviews.map((r) => ({
      ...r,
      generatedAt: r.generatedAt.getTime(),
      flaggedBiases: r.flaggedBiases ? [...r.flaggedBiases] : undefined,
    })),
    divergentPerspectives: [...c.divergentPerspectives],
  }));
}

function deserializeReview(entry: unknown): AgentReview | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const e = entry as PersistedReview;
  if (typeof e.id !== 'string') return undefined;
  if (typeof e.generatedAt !== 'number') return undefined;
  if (typeof e.perspective !== 'string') return undefined;
  if (typeof e.agreedWithLeading !== 'boolean') return undefined;
  return {
    ...e,
    generatedAt: new Date(e.generatedAt),
    flaggedBiases: Array.isArray(e.flaggedBiases) ? [...e.flaggedBiases] : undefined,
  };
}

function deserializeEntry(entry: unknown): MultiAgentConsensus | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const e = entry as PersistedConsensus;
  if (typeof e.situationId !== 'string') return undefined;
  if (typeof e.generatedAt !== 'number') return undefined;
  if (!Array.isArray(e.reviews)) return undefined;
  const reviews: AgentReview[] = [];
  for (const r of e.reviews) {
    const parsed = deserializeReview(r);
    if (parsed) reviews.push(parsed);
  }
  return {
    ...e,
    reviews,
    divergentPerspectives: Array.isArray(e.divergentPerspectives)
      ? [...e.divergentPerspectives]
      : [],
    generatedAt: new Date(e.generatedAt),
  };
}

function deserialize(raw: unknown): MultiAgentConsensus[] {
  if (!Array.isArray(raw)) return [];
  const out: MultiAgentConsensus[] = [];
  for (const entry of raw) {
    const parsed = deserializeEntry(entry);
    if (parsed) out.push(parsed);
  }
  return out;
}

function cloneConsensus(c: MultiAgentConsensus): MultiAgentConsensus {
  return {
    ...c,
    generatedAt: new Date(c.generatedAt),
    divergentPerspectives: [...c.divergentPerspectives],
    reviews: c.reviews.map((r) => ({
      ...r,
      generatedAt: new Date(r.generatedAt),
      flaggedBiases: r.flaggedBiases ? [...r.flaggedBiases] : undefined,
    })),
  };
}

// ── Singleton ─────────────────────────────────────────────────────────

let _singleton: MultiAgentReviewService | null = null;

export function getMultiAgentReviewService(): MultiAgentReviewService {
  _singleton ??= new MultiAgentReviewService();
  return _singleton;
}

/** Test seam — replaces the singleton with a fresh instance. */
export function __resetMultiAgentReviewSingleton(): void {
  _singleton = null;
}

// Re-export the imported Hypothesis types so callers can construct
// HypothesisSet inputs without pulling in hypothesis-engine directly.


export const __internals = {
  STORAGE_KEY,
  MAX_RECORDS,
  SENSITIVE_DOMAINS,
  PRECEDENTED_DOMAINS,
  DEVIL_CONCEDE_THRESHOLD,
  STALE_AFTER_MS,
  pickLeading,
  pickAlternative,
  buildConsensusSummary,
  recommendedActionFor,
};

export {type Hypothesis, type HypothesisSet} from './hypothesis-engine';