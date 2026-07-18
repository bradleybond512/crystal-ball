/**
 * Hypothesis Ensemble — multi-persona review of a single hypothesis.
 *
 * Today `hypothesis-skeptic` produces exactly one contrarian take.
 * This service fans the same hypothesis out to 2-3 distinct personas
 * (analyst, skeptic, pragmatist) and surfaces their disagreement as
 * a single "perspectives" block the HUD can expand.
 *
 * Each persona is a single LLM call, gated by `llm-budget` (so an
 * exhausted cloud cap short-circuits to partial results). Results are
 * cached by signature in IDB with a 60-min freshness window.
 *
 * Intentionally independent of hypothesis-skeptic: the two can coexist
 * (skeptic is a pure critique; the ensemble is a multi-angle view).
 */

import type { Hypothesis } from './analyst-loop';
import { signatureFor } from './hypothesis-feedback';
import { generateText, type LlmProvider } from './llm-adapter';
import { sanitizeForPrompt } from '@/utils/prompt-sanitize';
import { getMemory, putMemory } from './reasoning-memory';

// ── Types ─────────────────────────────────────────────────────────────────────

export type PersonaKind = 'analyst' | 'skeptic' | 'pragmatist';

export interface PersonaTake {
  persona: PersonaKind;
  text: string;
  provider: LlmProvider;
}

export interface EnsembleResult {
  signature: string;
  hypothesisId: string;
  generatedAt: number;
  takes: PersonaTake[];
  /** True if at least one persona ran; false means budget exhausted or nothing succeeded. */
  partial: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'crystalball-hypothesis-ensemble-v1';
const MAX_CACHE = 60;
const EVENT_NAME = 'cb:hypothesis-ensemble';
const FRESHNESS_MS = 60 * 60 * 1000;

const PERSONA_SYSTEMS: Record<PersonaKind, string> = {
  analyst:
    'You are a crisp geopolitical + financial analyst. Assess what this ' +
    'hypothesis most likely means and the single most informative thing a ' +
    'human operator should do next. Be declarative. 2-3 sentences.',
  skeptic:
    'You are a skeptical reviewer. Flag contradictions, stale evidence, ' +
    'or missing counter-signals. If the hypothesis looks solid, say so ' +
    'briefly. Be specific. 2-3 sentences.',
  pragmatist:
    'You are a pragmatist focused on actionable second-order effects. ' +
    'What concrete thing should change in the next 24 hours if this plays ' +
    'out? Skip abstractions. 2-3 sentences.',
};

// ── Cache ────────────────────────────────────────────────────────────────────

const cache = new Map<string, EnsembleResult>();
let loaded = false;
let writtenSinceLoad = false;

function applyLoaded(arr: [string, EnsembleResult][] | null): void {
  if (!arr) return;
  for (const [k, v] of arr) cache.set(k, v);
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) applyLoaded(JSON.parse(raw) as [string, EnsembleResult][]);
  } catch { /* ignore */ }
  void getMemory<[string, EnsembleResult][]>(STORAGE_KEY).then(arr => {
    if (writtenSinceLoad) return;
    applyLoaded(arr);
  }).catch(() => { /* IDB unavailable; localStorage bootstrap still valid */ });
}

function save(): void {
  writtenSinceLoad = true;
  const entries = [...cache.entries()];
  if (entries.length > MAX_CACHE) {
    entries.sort((a, b) => a[1].generatedAt - b[1].generatedAt);
    entries.splice(0, entries.length - MAX_CACHE);
    cache.clear();
    for (const [k, v] of entries) cache.set(k, v);
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch { /* quota */ }
  void putMemory(STORAGE_KEY, entries).catch(() => { /* IDB write failed */ });
}

// ── Prompt ────────────────────────────────────────────────────────────────────

// Exported for the llm-prompt-injection regression test.
export function buildEnsemblePrompt(h: Hypothesis, persona: PersonaKind): string {
  const evidenceLines = h.evidence
    .slice(0, 6)
    .map(e => `- [${sanitizeForPrompt(e.source, 40)}] ${sanitizeForPrompt(e.label, 200)}`)
    .join('\n');
  return (
    `${PERSONA_SYSTEMS[persona]}\n\n` +
    `Hypothesis (${h.kind}, ${h.risk} risk, ${(h.confidence * 100).toFixed(0)}% confidence):\n` +
    `"${sanitizeForPrompt(h.statement, 280)}"\n\n` +
    `Supporting evidence:\n${evidenceLines || '- (none)'}\n\n` +
    `Respond as the ${persona}.`
  );
}

// ── Runner ────────────────────────────────────────────────────────────────────

const inFlight = new Set<string>();

async function runOne(persona: PersonaKind, h: Hypothesis): Promise<PersonaTake | null> {
  const res = await generateText(buildEnsemblePrompt(h, persona), { maxTokens: 220 });
  if (!res.text) return null;
  return { persona, text: res.text.trim(), provider: res.provider };
}

/** Retrieve cached ensemble result if one exists and is still fresh. */
export function getCachedEnsemble(
  h: Pick<Hypothesis, 'kind' | 'evidence' | 'region'>,
): EnsembleResult | null {
  load();
  const hit = cache.get(signatureFor(h));
  if (!hit) return null;
  if (Date.now() - hit.generatedAt > FRESHNESS_MS) return null;
  return hit;
}

/**
 * Run all three personas in parallel and cache the result.
 * Safe to call repeatedly — returns the cached result if fresh.
 */
export async function runEnsemble(h: Hypothesis): Promise<EnsembleResult> {
  load();
  const sig = signatureFor(h);
  const existing = cache.get(sig);
  if (existing && Date.now() - existing.generatedAt < FRESHNESS_MS) return existing;
  if (inFlight.has(sig)) return existing ?? placeholder(h, sig);
  inFlight.add(sig);

  try {
    const personas: PersonaKind[] = ['analyst', 'skeptic', 'pragmatist'];
    const settled = await Promise.all(personas.map(p => runOne(p, h).catch(() => null)));
    const takes = settled.filter((t): t is PersonaTake => t !== null);
    const result: EnsembleResult = {
      signature: sig,
      hypothesisId: h.id,
      generatedAt: Date.now(),
      takes,
      partial: takes.length < personas.length,
    };
    // Don't cache total failures — we'd pin "(no takes)" for 60min and
    // prevent the user from retrying even after the cloud is back up.
    // Partial results (1-2 personas) are worth keeping.
    if (takes.length > 0) {
      cache.set(sig, result);
      save();
    }
    document.dispatchEvent(new CustomEvent<EnsembleResult>(EVENT_NAME, { detail: result }));
    return result;
  } finally {
    inFlight.delete(sig);
  }
}

function placeholder(h: Hypothesis, sig: string): EnsembleResult {
  return { signature: sig, hypothesisId: h.id, generatedAt: Date.now(), takes: [], partial: true };
}

export function subscribeEnsemble(cb: (result: EnsembleResult) => void): () => void {
  const handler = (e: Event): void => {
    const ce = e as CustomEvent<EnsembleResult>;
    cb(ce.detail);
  };
  document.addEventListener(EVENT_NAME, handler);
  return () => { document.removeEventListener(EVENT_NAME, handler); };
}
