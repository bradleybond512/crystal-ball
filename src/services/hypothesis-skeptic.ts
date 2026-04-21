/**
 * Hypothesis Skeptic — opt-in second-pass review of ranked hypotheses.
 *
 * When enabled, after the analyst loop emits a snapshot, we pick the top
 * critical/high-risk hypotheses and ask a Claude agent to play devil's
 * advocate: flag contradictions, stale evidence, and missing counter-signals.
 * Results are attached to each hypothesis via a signature-keyed cache so the
 * HUD can render a collapsible "Skeptic" chip.
 *
 * Guardrails:
 *   - off by default; user opts in via setSkepticEnabled(true)
 *   - Ghost Mode suppresses
 *   - only reviews hypotheses with risk ≥ high
 *   - per-signature cooldown prevents re-querying the same thread every cycle
 *   - requires `aiClaude` runtime feature
 */

import { runClaudeAgent } from './claude-agent';
import { isGhostMode } from './mode-manager';
import { isFeatureAvailable } from './runtime-config';
import { signatureFor } from './hypothesis-feedback';
import type { Hypothesis, AnalystSnapshot } from './analyst-loop';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SkepticNote {
  signature: string;
  hypothesisId: string;
  generatedAt: number;
  /** Summary skeptic statement (≤ 240 chars). */
  summary: string;
  /** Full agent response. */
  text: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ENABLED_KEY = 'crystalball-skeptic-enabled';
const STORAGE_KEY = 'crystalball-skeptic-notes-v1';
const COOLDOWN_MS = 30 * 60 * 1000; // 30 min per signature
const MAX_REVIEWS_PER_CYCLE = 2;
const EVENT_NAME = 'cb:skeptic-note';

// ── Toggle ────────────────────────────────────────────────────────────────────

export function isSkepticEnabled(): boolean {
  try { return localStorage.getItem(ENABLED_KEY) === '1'; }
  catch { return false; }
}

export function setSkepticEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(ENABLED_KEY, '1');
    else localStorage.removeItem(ENABLED_KEY);
  } catch { /* ignore */ }
}

// ── Cache ────────────────────────────────────────────────────────────────────

const notes = new Map<string, SkepticNote>();
let loaded = false;

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, SkepticNote>;
    for (const [k, v] of Object.entries(obj)) notes.set(k, v);
  } catch { /* ignore */ }
}

function save(): void {
  const obj: Record<string, SkepticNote> = {};
  for (const [k, v] of notes) obj[k] = v;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); }
  catch { /* quota */ }
}

// ── Public read API ──────────────────────────────────────────────────────────

export function getSkepticNote(h: Pick<Hypothesis, 'kind' | 'evidence' | 'region'>): SkepticNote | null {
  load();
  return notes.get(signatureFor(h)) ?? null;
}

export function getAllSkepticNotes(): SkepticNote[] {
  load();
  return [...notes.values()].sort((a, b) => b.generatedAt - a.generatedAt);
}

// ── Prompt ────────────────────────────────────────────────────────────────────

function buildSkepticPrompt(h: Hypothesis): string {
  const evidenceLines = h.evidence
    .slice(0, 8)
    .map(e => `- [${e.source}] ${e.label}`)
    .join('\n');
  return (
    `You are a skeptical reviewer of an analyst hypothesis. Look for ` +
    `contradictions, stale evidence, or missing counter-signals that would ` +
    `weaken this claim.\n\n` +
    `Hypothesis (${h.kind}, ${h.risk} risk, ${(h.confidence * 100).toFixed(0)}% confidence):\n` +
    `"${h.statement}"\n\n` +
    `Supporting evidence:\n${evidenceLines || '- (none)'}\n\n` +
    `In 2–3 sentences: what might this hypothesis be missing or getting ` +
    `wrong? Name specific counter-signals if you can. If the hypothesis ` +
    `looks well-supported, say so briefly.`
  );
}

function summarize(text: string): string {
  const cleaned = text.trim().replace(/\s+/g, ' ');
  return cleaned.length > 240 ? `${cleaned.slice(0, 237)}...` : cleaned;
}

// ── Runner ────────────────────────────────────────────────────────────────────

const inFlight = new Set<string>();

async function reviewOne(h: Hypothesis): Promise<void> {
  const sig = signatureFor(h);
  if (inFlight.has(sig)) return;
  inFlight.add(sig);
  try {
    const res = await runClaudeAgent(buildSkepticPrompt(h));
    const note: SkepticNote = {
      signature: sig,
      hypothesisId: h.id,
      generatedAt: Date.now(),
      summary: summarize(res.response),
      text: res.response,
    };
    notes.set(sig, note);
    save();
    document.dispatchEvent(new CustomEvent<SkepticNote>(EVENT_NAME, { detail: note }));
  } catch {
    // swallow; cooldown below still applies so we don't hammer on repeated failures
    const placeholder: SkepticNote = {
      signature: sig,
      hypothesisId: h.id,
      generatedAt: Date.now(),
      summary: '(skeptic pass failed)',
      text: '',
    };
    notes.set(sig, placeholder);
    save();
  } finally {
    inFlight.delete(sig);
  }
}

function shouldReview(h: Hypothesis): boolean {
  if (h.risk !== 'critical' && h.risk !== 'high') return false;
  const existing = notes.get(signatureFor(h));
  if (!existing) return true;
  return Date.now() - existing.generatedAt >= COOLDOWN_MS;
}

function handleSnapshot(snapshot: AnalystSnapshot): void {
  if (!isSkepticEnabled()) return;
  if (isGhostMode()) return;
  if (!isFeatureAvailable('aiClaude')) return;

  const candidates = snapshot.hypotheses.filter(h => shouldReview(h)).slice(0, MAX_REVIEWS_PER_CYCLE);
  for (const h of candidates) void reviewOne(h);
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

let started = false;

export function startHypothesisSkeptic(): void {
  if (started) return;
  started = true;
  load();
  document.addEventListener('cb:analyst-hypotheses', (e: Event) => {
    const ce = e as CustomEvent<AnalystSnapshot>;
    handleSnapshot(ce.detail);
  });
}

export function subscribeSkeptic(cb: (note: SkepticNote) => void): () => void {
  const handler = (e: Event): void => {
    const ce = e as CustomEvent<SkepticNote>;
    cb(ce.detail);
  };
  document.addEventListener(EVENT_NAME, handler);
  return () => { document.removeEventListener(EVENT_NAME, handler); };
}
