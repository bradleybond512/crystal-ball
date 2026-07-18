/**
 * Hypothesis Projection — "what if this plays out?" extension.
 *
 * For any hypothesis, produce a short forward-look (24h/48h) covering
 * expected second-order effects and risk factors. We use the local-first
 * LLM adapter so this runs on-device when Ollama is configured, else
 * falls back to the cloud agent.
 *
 * If the hypothesis mentions an infrastructure node that's registered
 * with cascade-simulator (by name match in entities), we also include
 * its simulated effects as a structured addendum. Most hypotheses won't
 * map to registered infra nodes; that's fine — the LLM projection alone
 * is still useful.
 *
 * Results cached in IDB by signature.
 */

import type { Hypothesis } from './analyst-loop';
import { signatureFor } from './hypothesis-feedback';
import { entitiesForHypothesis } from './hypothesis-entities';
import { simulateCascade, getInfraNodes, type CascadeSimResult } from './cascade-simulator';
import { generateText } from './llm-adapter';
import { sanitizeForPrompt } from '@/utils/prompt-sanitize';
import { getMemory, putMemory } from './reasoning-memory';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HypothesisProjection {
  signature: string;
  hypothesisId: string;
  /** Narrative forward-look from the LLM. */
  narrative: string;
  /** Provider that generated the narrative. */
  provider: 'local' | 'cloud-groq' | 'cloud-agent' | 'cloud-chat' | 'none';
  /** Cascade-simulator output if a matching infra node was found, else null. */
  cascade: CascadeSimResult | null;
  generatedAt: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'crystalball-hypothesis-projections-v1';
const MAX_CACHE = 80;
const EVENT_NAME = 'cb:hypothesis-projection';

// ── Cache ────────────────────────────────────────────────────────────────────

const cache = new Map<string, HypothesisProjection>();
let loaded = false;
let writtenSinceLoad = false;

function applyLoaded(arr: [string, HypothesisProjection][] | null): void {
  if (!arr) return;
  for (const [k, v] of arr) cache.set(k, v);
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) applyLoaded(JSON.parse(raw) as [string, HypothesisProjection][]);
  } catch { /* ignore */ }
  void getMemory<[string, HypothesisProjection][]>(STORAGE_KEY).then(arr => {
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

// ── Cascade lookup ───────────────────────────────────────────────────────────

function findMatchingCascadeNodeId(h: Hypothesis): string | null {
  const nodes = getInfraNodes();
  if (nodes.length === 0) return null;
  // Try entity-name matches first.
  const mentions = entitiesForHypothesis(h.id).map(m => m.entity.toLowerCase());
  const textHaystack = [h.statement, h.region ?? '', ...h.evidence.map(e => e.label)]
    .join(' ')
    .toLowerCase();
  for (const node of nodes) {
    const n = node.name.toLowerCase();
    if (mentions.some(m => n.includes(m) || m.includes(n))) return node.id;
    if (textHaystack.includes(n)) return node.id;
  }
  return null;
}

// ── Prompt ────────────────────────────────────────────────────────────────────

// Exported for the llm-prompt-injection regression test.
export function buildProjectionPrompt(h: Hypothesis): string {
  const evidenceLines = h.evidence
    .slice(0, 8)
    .map(e => `- [${sanitizeForPrompt(e.source, 40)}] ${sanitizeForPrompt(e.label, 200)}`)
    .join('\n');
  return (
    `Project how the following analyst hypothesis could realistically play out ` +
    `over the next 24 to 48 hours.\n\n` +
    `Hypothesis (${h.kind}, ${h.risk} risk, ${(h.confidence * 100).toFixed(0)}% confidence):\n` +
    `"${sanitizeForPrompt(h.statement, 280)}"\n\n` +
    `Supporting evidence:\n${evidenceLines || '- (none)'}\n\n` +
    `Answer in two short sections:\n` +
    `NEXT 24h: 2-3 bullets of the most likely near-term developments.\n` +
    `NEXT 48h: 2-3 bullets of second-order effects and escalation triggers to watch.\n` +
    `Be specific and grounded in the evidence provided.`
  );
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getCachedProjection(
  h: Pick<Hypothesis, 'kind' | 'evidence' | 'region'>,
): HypothesisProjection | null {
  load();
  return cache.get(signatureFor(h)) ?? null;
}

/**
 * Run the projection for a hypothesis. Uses local LLM if available, else
 * cloud-agent. Persists to IDB and fires `cb:hypothesis-projection`.
 */
export async function projectHypothesis(h: Hypothesis): Promise<HypothesisProjection> {
  load();
  const sig = signatureFor(h);
  const existing = cache.get(sig);
  // Reuse cached result if less than 15 minutes old.
  if (existing && Date.now() - existing.generatedAt < 15 * 60 * 1000) return existing;

  let cascadeNodeId: string | null = null;
  try { cascadeNodeId = findMatchingCascadeNodeId(h); } catch { cascadeNodeId = null; }
  let cascade: CascadeSimResult | null = null;
  if (cascadeNodeId) {
    try { cascade = simulateCascade(cascadeNodeId); }
    catch { cascade = null; }
  }

  const res = await generateText(buildProjectionPrompt(h), { maxTokens: 400 });
  const projection: HypothesisProjection = {
    signature: sig,
    hypothesisId: h.id,
    narrative: res.text || '(projection failed)',
    provider: res.provider,
    cascade,
    generatedAt: Date.now(),
  };

  // Don't cache failures (provider='none' / empty text) — that would pin
  // the "(projection failed)" placeholder for 15 minutes and block retry.
  if (res.provider !== 'none' && res.text) {
    cache.set(sig, projection);
    save();
  }
  document.dispatchEvent(new CustomEvent<HypothesisProjection>(EVENT_NAME, { detail: projection }));
  return projection;
}

export function subscribeProjection(cb: (p: HypothesisProjection) => void): () => void {
  const handler = (e: Event): void => {
    const ce = e as CustomEvent<HypothesisProjection>;
    cb(ce.detail);
  };
  document.addEventListener(EVENT_NAME, handler);
  return () => { document.removeEventListener(EVENT_NAME, handler); };
}
