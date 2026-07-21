/**
 * Question Suggester — generates clickable investigation prompts per
 * hypothesis and runs them through the local-first LLM adapter.
 *
 * For each hypothesis we synthesize up to three natural-language
 * questions that a human analyst would plausibly ask next. The HUD
 * renders them as chips; clicking a chip:
 *   1. Calls generateText() (local-first, cloud fallback)
 *   2. Caches the answer keyed by signature+question
 *   3. Emits `cb:question-answered` so the HUD can expand inline
 *
 * The suggestions are derived from the hypothesis's evidence,
 * entities, and region — no LLM call is needed to generate them.
 * Only clicking a question incurs an LLM cost.
 */

import type { Hypothesis } from './analyst-loop';
import { entitiesForHypothesis, type EntityMention } from './hypothesis-entities';
import { signatureFor } from './hypothesis-feedback';
import { generateText } from './llm-adapter';
import { sanitizeForPrompt } from '@/utils/prompt-sanitize';
import { getMemory, putMemory } from './reasoning-memory';
import { buildCheckNextItems } from './cognition/evoi-surface';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QuestionAnswer {
  question: string;
  text: string;
  provider: 'local' | 'cloud-groq' | 'cloud-agent' | 'cloud-chat' | 'none';
  generatedAt: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'crystalball-question-answers-v1';
const MAX_CACHE_SIZE = 200;
const EVENT_NAME = 'cb:question-answered';

// ── Answer cache ─────────────────────────────────────────────────────────────

const cache = new Map<string, QuestionAnswer>();
let loaded = false;
let writtenSinceLoad = false;

function cacheKey(signature: string, question: string): string {
  return `${signature}||${question.slice(0, 120)}`;
}

function applyLoaded(arr: [string, QuestionAnswer][] | null): void {
  if (!arr) return;
  for (const [k, v] of arr) cache.set(k, v);
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) applyLoaded(JSON.parse(raw) as [string, QuestionAnswer][]);
  } catch { /* ignore */ }
  void getMemory<[string, QuestionAnswer][]>(STORAGE_KEY).then(arr => {
    if (writtenSinceLoad) return;
    applyLoaded(arr);
  });
}

function save(): void {
  writtenSinceLoad = true;
  const entries = [...cache.entries()];
  if (entries.length > MAX_CACHE_SIZE) {
    entries.sort((a, b) => a[1].generatedAt - b[1].generatedAt);
    entries.splice(0, entries.length - MAX_CACHE_SIZE);
    cache.clear();
    for (const [k, v] of entries) cache.set(k, v);
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch { /* quota */ }
  void putMemory(STORAGE_KEY, entries);
}

// ── Question generation ──────────────────────────────────────────────────────

/**
 * Build 1-3 investigative questions for a hypothesis. The questions are
 * derived from structure (entities, region, evidence sources) so generation
 * itself is cheap and deterministic.
 */
export function suggestQuestions(h: Hypothesis): string[] {
  const out: string[] = [];
  const mentions = entitiesForHypothesis(h.id);
  const sources = [...new Set(h.evidence.map(e => e.source))];
  const region = h.region ?? 'the affected region';

  // 1. Entity-pair connection question (if we have 2+ different-kind entities)
  const pair = pickEntityPair(mentions);
  if (pair) {
    out.push(`What is the connection between ${describeEntity(pair[0])} and ${describeEntity(pair[1])}?`);
  }

  // 2. Escalation pathway question
  if (h.risk === 'high' || h.risk === 'critical') {
    out.push(`What second-order effects should I watch for over the next 24 hours in ${region}?`);
  }

  // 3. Source-convergence question
  if (sources.length >= 2) {
    out.push(`Why are ${sources.join(' and ')} all flagging ${region} right now?`);
  }

  // Fallback if nothing else fit.
  if (out.length === 0) {
    out.push(`What else should I investigate about: "${h.statement.slice(0, 120)}"?`);
  }

  return out.slice(0, 3);
}

// ── EVOI-ranked chips (Prediction Uplift PR A3) ─────────────────────────────

/** Prior weight assigned to a heuristic chip so a real EVOI action (computed
 *  expected-information-gain bits) outranks it whenever one is available. */
const HEURISTIC_PRIOR_BITS = 0.1;

export interface RankedQuestion {
  question: string;
  bits: number;
  fromEvoi: boolean;
}

/**
 * Merge the cheap heuristic chips with EVOI-ranked "check next" actions
 * (`evoi-surface.ts`, already kill-switch gated) into one deduped, ranked
 * list capped at 3. EVOI actions carry a real expectedInfoGainBits score;
 * heuristic chips get a flat low prior so they only surface when EVOI has
 * nothing (or less) to offer for this hypothesis.
 */
export function suggestQuestionsRanked(
  h: Hypothesis,
  deps: {
    heuristics?: (h: Hypothesis) => string[];
    evoiActions?: (h: Hypothesis) => readonly { label: string; expectedInfoGainBits: number }[];
  } = {},
): RankedQuestion[] {
  const heuristic = (deps.heuristics ?? suggestQuestions)(h)
    .map((q) => ({ question: q, bits: HEURISTIC_PRIOR_BITS, fromEvoi: false }));
  const evoi = (deps.evoiActions ?? ((hh: Hypothesis) => buildCheckNextItems([
    { kind: hh.kind, statement: hh.statement, probability: hh.confidence },
  ])))(h).map((a) => ({ question: a.label, bits: a.expectedInfoGainBits, fromEvoi: true }));
  const seen = new Set<string>();
  return [...evoi, ...heuristic]
    .filter((r) => {
      const k = r.question.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => b.bits - a.bits)
    .slice(0, 3);
}

function describeEntity(m: EntityMention): string {
  switch (m.kind) {
    case 'country': { return `the country ${m.entity}`; }
    case 'ticker': { return `ticker ${m.entity}`; }
    case 'cve': { return `vulnerability ${m.entity}`; }
    case 'callsign': { return `callsign ${m.entity}`; }
    default: { return m.entity; }
  }
}

function pickEntityPair(mentions: EntityMention[]): [EntityMention, EntityMention] | null {
  if (mentions.length < 2) return null;
  // Prefer two different kinds so the question is non-trivial.
  for (let i = 0; i < mentions.length; i++) {
    for (let j = i + 1; j < mentions.length; j++) {
      const a = mentions[i];
      const b = mentions[j];
      if (a && b && a.kind !== b.kind) return [a, b];
    }
  }
  const a = mentions[0];
  const b = mentions[1];
  return a && b ? [a, b] : null;
}

// ── Ask / answer ─────────────────────────────────────────────────────────────

/** Retrieve a cached answer if we already ran this question. */
export function getCachedAnswer(
  h: Pick<Hypothesis, 'kind' | 'evidence' | 'region'>,
  question: string,
): QuestionAnswer | null {
  load();
  return cache.get(cacheKey(signatureFor(h), question)) ?? null;
}

// Build the ask-the-data prompt. Feed-derived h.statement + the (chip-derived or
// operator) question are sanitized so neither can forge a new instruction line.
// Exported for the llm-prompt-injection regression test.
export function buildAskQuestionPrompt(h: Hypothesis, question: string): string {
  return (
    `Analyst hypothesis (${h.kind}, ${h.risk} risk, ${(h.confidence * 100).toFixed(0)}% confidence):\n` +
    `"${sanitizeForPrompt(h.statement, 280)}"\n\n` +
    `Question from the operator: ${sanitizeForPrompt(question, 300)}\n\n` +
    `Answer in 2-4 sentences. Be specific, declarative, and cite concrete ` +
    `mechanisms or entities where applicable. If the question is speculative, ` +
    `say what would need to happen for it to be true.`
  );
}

/**
 * Run `question` through the LLM adapter in the context of hypothesis `h`.
 * Caches + emits cb:question-answered on completion.
 */
export async function askQuestion(h: Hypothesis, question: string): Promise<QuestionAnswer> {
  load();
  const key = cacheKey(signatureFor(h), question);
  const cached = cache.get(key);
  if (cached) return cached;

  const res = await generateText(buildAskQuestionPrompt(h, question), { maxTokens: 350 });
  const answer: QuestionAnswer = {
    question,
    text: res.text || '(no response)',
    provider: res.provider,
    generatedAt: Date.now(),
  };
  // Don't cache failed calls (budget exhausted, network down, etc.) —
  // caching '(no response)' for 200 entries would prevent retry even
  // after the cloud is back up. Only a successful generation is cached.
  if (res.provider !== 'none' && res.text) {
    cache.set(key, answer);
    save();
  }
  document.dispatchEvent(new CustomEvent<QuestionAnswer>(EVENT_NAME, { detail: answer }));
  return answer;
}

export function subscribeQuestionAnswered(cb: (answer: QuestionAnswer) => void): () => void {
  const handler = (e: Event): void => {
    const ce = e as CustomEvent<QuestionAnswer>;
    cb(ce.detail);
  };
  document.addEventListener(EVENT_NAME, handler);
  return () => { document.removeEventListener(EVENT_NAME, handler); };
}
